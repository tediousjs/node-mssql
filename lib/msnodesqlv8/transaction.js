'use strict'

const debug = require('debug')('mssql:msv8')
const BaseTransaction = require('../base/transaction')
const { IDS } = require('../utils')
const Request = require('./request')
const ISOLATION_LEVEL = require('../isolationlevel')
const TransactionError = require('../error/transaction-error')

const isolationLevelDeclaration = function (type) {
  switch (type) {
    case ISOLATION_LEVEL.READ_UNCOMMITTED: return 'READ UNCOMMITTED'
    case ISOLATION_LEVEL.READ_COMMITTED: return 'READ COMMITTED'
    case ISOLATION_LEVEL.REPEATABLE_READ: return 'REPEATABLE READ'
    case ISOLATION_LEVEL.SERIALIZABLE: return 'SERIALIZABLE'
    case ISOLATION_LEVEL.SNAPSHOT: return 'SNAPSHOT'
    default: throw new TransactionError('Invalid isolation level.')
  }
}

class Transaction extends BaseTransaction {
  _begin (isolationLevel, callback) {
    super._begin(isolationLevel, err => {
      if (err) return callback(err)

      // built before a connection is borrowed, so that an invalid isolation level is reported
      // with nothing to give back
      let statement
      try {
        statement = `set transaction isolation level ${isolationLevelDeclaration(this.isolationLevel)};begin tran;`
      } catch (err) {
        return callback(err)
      }

      debug('transaction(%d): begin', IDS.get(this))

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        this._acquiredConnection = connection
        this._acquiredConfig = config

        const req = new Request(this)
        req.stream = false
        req.query(statement, err => {
          if (err) {
            debug('transaction(%d): failed to begin', IDS.get(this), err)

            this._acquiredConnection = null
            this._acquiredConfig = null

            // the server may have begun the transaction even though the query failed (it can
            // time out after the server has run it), so the pool is left to close the connection
            // rather than lend it out again with a transaction nobody will end. It is not closed
            // here, as msnodesqlv8 never calls back from closing a connection that is already
            // closed, and the pool would wait for it to
            connection.hasError = true
            this.parent.release(connection)

            return callback(new TransactionError(err))
          }

          debug('transaction(%d): begun', IDS.get(this))

          callback(null)
        })
      })
    })
  }

  _commit (callback) {
    super._commit(err => {
      if (err) return callback(err)

      debug('transaction(%d): commit', IDS.get(this))

      const req = new Request(this)
      req.stream = false
      req.query('commit tran', err => {
        if (err) err = new TransactionError(err)

        this.parent.release(this._acquiredConnection)
        this._acquiredConnection = null
        this._acquiredConfig = null

        if (!err) debug('transaction(%d): commited', IDS.get(this))

        callback(err)
      })
    })
  }

  _rollback (callback) {
    super._rollback(err => {
      if (err) return callback(err)

      debug('transaction(%d): rollback', IDS.get(this))

      const req = new Request(this)
      req.stream = false
      req.query('rollback tran', err => {
        if (err) err = new TransactionError(err)

        this.parent.release(this._acquiredConnection)
        this._acquiredConnection = null
        this._acquiredConfig = null

        if (!err) debug('transaction(%d): rolled back', IDS.get(this))

        callback(err)
      })
    })
  }
}

module.exports = Transaction

'use strict'

const debug = require('debug')('mssql:tedi')
const BaseTransaction = require('../base/transaction')
const { IDS } = require('../utils')
const TransactionError = require('../error/transaction-error')
const { CHANNELS, publish } = require('../diagnostics')

class Transaction extends BaseTransaction {
  constructor (parent, overrides) {
    super(parent, overrides)

    this._abort = () => {
      if (!this._rollbackRequested) {
        // transaction interrupted because of XACT_ABORT

        const pc = this._acquiredConnection

        // defer releasing so connection can switch from SentClientRequest to LoggedIn state
        setImmediate(this.parent.release.bind(this.parent), pc)

        this._acquiredConnection.removeListener('rollbackTransaction', this._abort)
        this._acquiredConnection = null
        this._acquiredConfig = null
        this._aborted = true
        this._abortReason = this._abortReason || new Error('Transaction was rolled back by the server')

        publish(CHANNELS.TRANSACTION_ROLLBACK, () => ({
          transactionId: IDS.get(this),
          aborted: true
        }))
        this.emit('rollback', true)
      }
    }
  }

  _begin (isolationLevel, callback) {
    super._begin(isolationLevel, err => {
      if (err) return callback(err)

      debug('transaction(%d): begin', IDS.get(this))

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        this._acquiredConnection = connection
        this._acquiredConnection.on('rollbackTransaction', this._abort)
        this._acquiredConfig = config

        // the caller hears of one outcome, whatever tedious does
        let calledBack = false
        const done = (err, discard) => {
          if (calledBack) return
          calledBack = true

          if (!err) {
            debug('transaction(%d): begun', IDS.get(this))
            return callback(null)
          }

          debug('transaction(%d): failed to begin', IDS.get(this), err)

          connection.removeListener('rollbackTransaction', this._abort)
          this._acquiredConnection = null
          this._acquiredConfig = null

          // deferred so that tedious is done with the connection before it is closed, and so
          // that what the callback throws when tedious calls back at once is not caught below
          // as though tedious had thrown it
          setImmediate(() => {
            if (discard) connection.close()
            this.parent.release(connection)
            callback(new TransactionError(err))
          })
        }

        try {
          // the server may have begun the transaction even though the request failed (it can
          // time out after the server has run it), so the connection is closed rather than
          // lent out again with a transaction nobody will end
          connection.beginTransaction(err => done(err, true), this.name, this.isolationLevel)
        } catch (err) {
          // tedious validates the arguments before it sends anything
          done(err, false)
        }
      })
    })
  }

  _commit (callback) {
    super._commit(err => {
      if (err) return callback(err)

      debug('transaction(%d): commit', IDS.get(this))

      this._acquiredConnection.commitTransaction(err => {
        if (err) err = new TransactionError(err)

        this._acquiredConnection.removeListener('rollbackTransaction', this._abort)
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

      this._acquiredConnection.rollbackTransaction(err => {
        if (err) err = new TransactionError(err)

        this._acquiredConnection.removeListener('rollbackTransaction', this._abort)
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

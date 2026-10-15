'use strict'

const debug = require('debug')('mssql:tedi')
const BaseTransaction = require('../base/transaction')
const { IDS } = require('../utils')
const TransactionError = require('../error/transaction-error')

// From TDS 7.2 the driver sends the transaction name in a transaction manager request, where it
// is data. Before 7.2 it writes `BEGIN TRAN <name>` into a SQL batch instead, and there a bare
// name is read as SQL: whitespace, `;`, `:` or a comment ends it, and even a lone keyword such as
// `commit` runs as a statement of its own. So on those versions the name is sent as a quoted
// identifier, with `]`, the only character that can end it, doubled. The server then stores
// exactly the name given, as it does on the newer versions. An empty name means no name, and an
// empty quoted identifier is not allowed, so it is sent as it is.
const quoteTransactionName = (name) => name === '' ? name : `[${name.replace(/]/g, ']]')}]`

class Transaction extends BaseTransaction {
  constructor (parent) {
    super(parent)

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

        this.emit('rollback', true)
      }
    }
  }

  _begin (isolationLevel, callback) {
    super._begin(isolationLevel, err => {
      if (err) return callback(err)

      // Read once: the name checked here is the name sent, whatever a later read would return.
      let name
      try {
        name = this.name
      } catch (err) {
        return callback(err)
      }
      if (name == null) name = ''
      if (typeof name !== 'string') {
        return callback(new TransactionError('Invalid transaction name. A transaction name must be a string.', 'EINJECT'))
      }

      debug('transaction(%d): begin', IDS.get(this))

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        this._acquiredConnection = connection
        this._acquiredConnection.on('rollbackTransaction', this._abort)
        this._acquiredConfig = config

        // The driver records the TDS version the server agreed at login here, and makes the same
        // comparison to decide how to send the name.
        const sentName = connection.config.options.tdsVersion < '7_2' ? quoteTransactionName(name) : name

        connection.beginTransaction(err => {
          if (err) err = new TransactionError(err)

          debug('transaction(%d): begun', IDS.get(this))

          callback(err)
        }, sentName, this.isolationLevel)
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

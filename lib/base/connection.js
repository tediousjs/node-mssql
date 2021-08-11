const deepclone = require('rfdc/default')
const shared = require('../shared')
const { IDS } = require('../utils')
const { EventEmitter } = require('events')
const debug = require('debug')('mssql:base')
const ConnectionError = require('../error/connection-error')
const { TransactionError } = require('../error')
const globalConnection = require('../global-connection')

class Connection extends EventEmitter {
  /**
   * Create new Connection.
   *
   * @param {Object|String} config Connection configuration object or connection string.
   * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred.
   */

  constructor (configOrPool) {
    super()

    IDS.add(this, '@Connection')
    debug('@Connection (%d): created', IDS.get(this))
    this._connecting = false
    this._connection = undefined
    this._transaction = undefined
    this._activeRequest = undefined
    this._aborted = undefined
    if (!configOrPool) {
      configOrPool = globalConnection.pool
    }
    if (configOrPool instanceof shared.driver.ConnectionPool) {
      this._pool = configOrPool
      this.config = configOrPool.config
    } else {
      if (typeof config === 'string') {
        this.config = shared.driver.ConnectionPool.prototype.parseConnectionString.call(this, configOrPool)
      } else {
        this.config = deepclone(configOrPool)
      }

      // It is recommended to create a new function substitution
      // set defaults
      this.config.port = this.config.port || 1433
      this.config.options = this.config.options || {}
      this.config.stream = this.config.stream || false
      this.config.parseJSON = this.config.parseJSON || false
      this.config.arrayRowMode = this.config.arrayRowMode || false
      this.config.validateConnection = 'validateConnection' in this.config ? this.config.validateConnection : true

      if (/^(.*)\\(.*)$/.exec(this.config.server)) {
        this.config.server = RegExp.$1
        this.config.options.instanceName = RegExp.$2
      }
    }
  }

  get connected () {
    return !!this._connection
  }

  get inTransaction () {
    return !!this._transaction
  }

  open () {
    return this.connect()
  }

  /**
   * Open the conneciton
   *
   * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */
  async connect () {
    if (this._connecting) {
      throw new ConnectionError('Connection is connecting.')
    }
    if (this.connected) {
      throw new ConnectionError('Connection is already opened.')
    }

    this._connecting = true
    try {
      if (this._pool) {
        this._connection = await this._pool.acquire(this)
      } else {
        this._connection = await this._connect()
      }
    } finally {
      this._connecting = false
    }
  }

  async close () {
    if (!this.connected) {
      throw new ConnectionError('The connection has not been opened.')
    }
    if (this._closing) {
      throw new ConnectionError('The connection is closing.')
    }
    this._closing = true
    try {
      if (this._pool) {
        this._pool.release(this._connection)
      } else {
        await this._disconnect(this._connection)
      }
    } finally {
      this._closing = false
    }
  }

  /**
   * if use config, open a new connection.
   */
  _connect () {
    throw new Error('Not implementation.')
  }

  /**
   * if use config, close the connection.
   */
  _disconnect (_tedious) {
    throw new Error('Not implementation.')
  }

  /**
   * Acquire connection from this connection pool.
   *
   * @param {ConnectionPool|Transaction|PreparedStatement} instance Requester.
   * @param {acquireCallback} [callback] A callback which is called after connection has been acquired, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  acquire (instance, callback) {
    const retrn = (err) => {
      if (typeof callback === 'function') {
        if (err) {
          this.emit('error', err)
          return callback(err)
        }
        return callback(null, this._connection, this.config)
      }
      return shared.Promise.resolve(this._connection)
    }
    if (this._aborted) {
      return retrn(new TransactionError('The transaction is automatically rolled back due to a error, pls use `rollback()` to cancel transaction.', 'EABORT'))
    }
    if (this._activeRequest) {
      return retrn(new ConnectionError("Can't acquire connection for the request. There is another request in progress.", 'EREQINPROG'))
    }
    if (!this.connected) {
      return retrn(new ConnectionError('The connection has not been opened.'))
    }
    if (instance instanceof shared.driver.Transaction) {
      if (this._transaction) {
        return retrn(new TransactionError('The connection transaction is begun.', 'ETRANS'))
      }
      this._transaction = instance
      this._transaction.on('rollback', () => {
        this._transaction = null
      })
      this._transaction.on('commit', () => {
        this._transaction = null
      })
    } else {
      this._activeRequest = instance
    }
    return retrn()
  }

  async beginTrans (isolationLevel) {
    if (this._transaction) {
      throw new TransactionError('Connection transaction has been begun.', 'ETRANSEXISTS')
    }
    const trans = this.transaction()
    await trans.begin(isolationLevel)
    return trans
  }

  async commit () {
    if (!this._transaction) {
      throw new TransactionError('Connection transaction has not begun.', 'ENOTBEGUN')
    }
    await this._transaction.commit()
  }

  async rollback () {
    if (!this._transaction) {
      throw new TransactionError('Connection transaction has not begun.', 'ENOTBEGUN')
    }
    await this._transaction.rollback()
  }

  /**
   * 不再关闭或者释放连接，而是取消激活请求
   *
   * @param {Connection} connection Previously acquired connection.
   * @return {ConnectionPool}
   */

  // eslint-disable-next-line no-unused-vars
  release (_connection) {
    this._activeRequest = null
    return this
  }

  /**
   * Returns new request using this connection.
   *
   * @return {Request}
   */

  request () {
    return new shared.driver.Request(this)
  }

  /**
   * Returns new transaction using this connection.
   *
   * @return {Transaction}
   */

  transaction () {
    return new shared.driver.Transaction(this)
  }

  /**
   * Creates a new query using this connection from a tagged template string.
   *
   * @variation 1
   * @param {Array} strings Array of string literals.
   * @param {...*} keys Values.
   * @return {Request}
   */

  /**
   * Execute the SQL command.
   *
   * @variation 2
   * @param {String} command T-SQL command to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  query () {
    if (typeof arguments[0] === 'string') { return new shared.driver.Request(this).query(arguments[0], arguments[1]) }

    const values = Array.prototype.slice.call(arguments)
    const strings = values.shift()

    return new shared.driver.Request(this)._template(strings, values, 'query')
  }

  /**
   * Creates a new batch using this connection from a tagged template string.
   *
   * @variation 1
   * @param {Array} strings Array of string literals.
   * @param {...*} keys Values.
   * @return {Request}
   */

  /**
   * Execute the SQL command.
   *
   * @variation 2
   * @param {String} command T-SQL command to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  batch () {
    if (typeof arguments[0] === 'string') { return new shared.driver.Request(this).batch(arguments[0], arguments[1]) }

    const values = Array.prototype.slice.call(arguments)
    const strings = values.shift()

    return new shared.driver.Request(this)._template(strings, values, 'batch')
  }
}

module.exports = Connection

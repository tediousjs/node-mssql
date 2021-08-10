const { parseSqlConnectionString } = require('@tediousjs/connection-string')
const deepclone = require('rfdc/default')
const shared = require('../shared')
const { IDS } = require('../utils')
const { EventEmitter } = require('events')
const debug = require('debug')('mssql:base')
const ConnectionError = require('../error/connection-error')
const ISOLATION_LEVEL = require('../isolationlevel')
const { TransactionError } = require('../error')
const globalConnection = require('../global-connection')

class Connection extends EventEmitter {
  /**
   * Create new Connection.
   *
   * @param {Object|String} config Connection configuration object or connection string.
   * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred.
   */

  constructor(configOrPool) {
    super()

    IDS.add(this, '@Connection')
    debug('@Connection (%d): created', IDS.get(this))
    this._connecting = false
    this._connection = undefined;
    this._activeRequest = undefined;
    this._inTransaction = false;
    this._aborted = undefined;
    if (!configOrPool) {
      configOrPool = globalConnection.pool;
    }
    if (configOrPool instanceof shared.driver.ConnectionPool) {
      this._pool = configOrPool
      this.config = configOrPool.config
    } else {

      if (typeof config === 'string') {
        this.config = this._parseConnectionString(configOrPool)
      } else {
        this.config = deepclone(configOrPool)
      }

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

  _parseConnectionString(connectionString) {
    const parsed = parseSqlConnectionString(connectionString, true, true)
    return Object.entries(parsed).reduce((config, [key, value]) => {
      switch (key) {
        case 'application name':
          break
        case 'applicationintent':
          Object.assign(config.options, {
            readOnlyIntent: value === 'readonly'
          })
          break
        case 'asynchronous processing':
          break
        case 'attachdbfilename':
          break
        case 'authentication':
          break
        case 'column encryption setting':
          break
        case 'connection timeout':
          Object.assign(config, {
            connectionTimeout: value * 1000
          })
          break
        case 'connection lifetime':
          break
        case 'connectretrycount':
          break
        case 'connectretryinterval':
          Object.assign(config.options, {
            connectionRetryInterval: value * 1000
          })
          break
        case 'context connection':
          break
        case 'current language':
          Object.assign(config.options, {
            language: value
          })
          break
        case 'data source':
          {
            let server = value
            let instanceName
            let port = 1433
            if (/^np:/i.test(server)) {
              throw new Error('Connection via Named Pipes is not supported.')
            }
            if (/^tcp:/i.test(server)) {
              server = server.substr(4)
            }
            if (/^(.*)\\(.*)$/.exec(server)) {
              server = RegExp.$1
              instanceName = RegExp.$2
            }
            if (/^(.*),(.*)$/.exec(server)) {
              server = RegExp.$1.trim()
              port = parseInt(RegExp.$2.trim(), 10)
            }
            if (server === '.' || server === '(.)' || server.toLowerCase() === '(localdb)' || server.toLowerCase() === '(local)') {
              server = 'localhost'
            }
            Object.assign(config, {
              port,
              server
            })
            Object.assign(config.options, {
              instanceName
            })
            break
          }
        case 'encrypt':
          Object.assign(config.options, {
            encrypt: !!value
          })
          break
        case 'enlist':
          break
        case 'failover partner':
          break
        case 'initial catalog':
          Object.assign(config, {
            database: value
          })
          break
        case 'integrated security':
          break
        case 'max pool size':
          Object.assign(config.pool, {
            max: value
          })
          break
        case 'min pool size':
          Object.assign(config.pool, {
            min: value
          })
          break
        case 'multipleactiveresultsets':
          break
        case 'multisubnetfailover':
          Object.assign(config.options, {
            multiSubnetFailover: value
          })
          break
        case 'network library':
          break
        case 'packet size':
          Object.assign(config.options, {
            packetSize: value
          })
          break
        case 'password':
          Object.assign(config, {
            password: value
          })
          break
        case 'persist security info':
          break
        case 'poolblockingperiod':
          break
        case 'pooling':
          break
        case 'replication':
          break
        case 'transaction binding':
          Object.assign(config.options, {
            enableImplicitTransactions: value.toLowerCase() === 'implicit unbind'
          })
          break
        case 'transparentnetworkipresolution':
          break
        case 'trustservercertificate':
          Object.assign(config.options, {
            trustServerCertificate: value
          })
          break
        case 'type system version':
          break
        case 'user id': {
          let user = value
          let domain
          if (/^(.*)\\(.*)$/.exec(user)) {
            domain = RegExp.$1
            user = RegExp.$2
          }
          Object.assign(config, {
            domain,
            user
          })
          break
        }
        case 'user instance':
          break
        case 'workstation id':
          Object.assign(config.options, {
            workstationId: value
          })
          break
        case 'request timeout':
          Object.assign(config, {
            requestTimeout: parseInt(value, 10)
          })
          break
        case 'stream':
          Object.assign(config, {
            stream: !!value
          })
          break
        case 'useutc':
          Object.assign(config.options, {
            useUTC: !!value
          })
          break
        case 'parsejson':
          Object.assign(config, {
            parseJSON: !!value
          })
          break
      }
      return config
    }, { options: {}, pool: {} })
  }

  get connected() {
    return this.opened
  }

  get opened() {
    return !!this._connection
  }

  get inTransaction() {
    return this._inTransaction;
  }

  /**
   * Creates a new connection pool with one active connection. This one initial connection serves as a probe to find out whether the configuration is valid.
   *
   * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  async open() {
    if (this._connecting) {
      throw new ConnectionError('Connection is connecting.')
    }
    if (this.opened) {
      throw new ConnectionError('Connection is already opened.')
    }

    this._connecting = true;
    try {
      if (this._pool) {
        this._connection = await this._pool.acquire(this);
      } else {
        this._connection = await this._connect();
      }
    } finally {
      this._connecting = false;
    }
  }

  async close() {
    if (!this.opened) {
      throw new ConnectionError('The connection has not been opened.')
    }
    if (this._closing) {
      throw new ConnectionError('The connection is closing.')
    }
    this._closing = true;
    try {
      if (this._pool) {
        this._pool.release(this._connection)
      } else {
        await this._disconnect(this._connection);
      }
    } finally {
      this._closing = false;
    }
  }

  /**
   * Acquire connection from this connection pool.
   *
   * @param {ConnectionPool|Transaction|PreparedStatement} request Requester.
   * @param {acquireCallback} [callback] A callback which is called after connection has been acquired, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  acquire(request, callback) {
    const retrn = (err) => {
      if (typeof callback === 'function') {
        if (err) {
          this.emit('error', err)
          return callback(err)
        }
        this._activeRequest = request;
        return callback(null, this._connection, this.config)
      }
      this._activeRequest = request;
      return shared.Promise.resolve(this._connection)
    }
    if (this._aborted) {
      return retrn(new TransactionError("The transaction is automatically rolled back due to a error, pls use `rollback()` to cancel transaction.", 'EABORT'))
    }
    if (this._activeRequest) {
      return retrn(new ConnectionError("Can't acquire connection for the request. There is another request in progress.", 'EREQINPROG'))
    }
    if (!this.opened) {
      return retrn(new ConnectionError('The connection has not been opened.'))
    }
    return retrn()
  }

  /**
   * 不再关闭或者释放连接，而是取消激活请求
   *
   * @param {Connection} connection Previously acquired connection.
   * @return {ConnectionPool}
   */

  // eslint-disable-next-line no-unused-vars
  release(_connection) {
    this._activeRequest = null;
    return this
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

  query() {
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

  batch() {
    if (typeof arguments[0] === 'string') { return new shared.driver.Request(this).batch(arguments[0], arguments[1]) }

    const values = Array.prototype.slice.call(arguments)
    const strings = values.shift()

    return new shared.driver.Request(this)._template(strings, values, 'batch')
  }


  /**
   * Begin a transaction.
   *
   * @param {Number} [isolationLevel] Controls the locking and row versioning behavior of TSQL statements issued by a connection.
   * @param {basicCallback} [callback] A callback which is called after transaction has began, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */

  async beginTrans(isolationLevel) {
    if (!this.opened) {
      throw new ConnectionError('The connection has not been opened.')
    }

    if (this._inTransaction) {
      throw new TransactionError('Transaction has already begun.', 'EALREADYBEGUN')
    }
    if (isolationLevel) {
      if (!Object.keys(ISOLATION_LEVEL).some(key => ISOLATION_LEVEL[key] === isolationLevel)) {
        throw new TransactionError('Invalid isolation level.')
      }
    }
    try {
      debug('@Connection (%d): transaction begin', IDS.get(this))
      await this._beginTrans(this._connection, isolationLevel)
      debug('@Connection (%d): transaction begun', IDS.get(this))
      this.isolationLevel = isolationLevel
      this._inTransaction = true
      this.emit('begin')
    } catch (err) {
      this.emit('error', err)
      throw err;
    }
  }

  /**
   * Commit a transaction.
   *
   * @param {basicCallback} [callback] A callback which is called after transaction has commited, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */

  async commit() {
    if (this._aborted) {
      throw new TransactionError("The transaction is automatically rolled back due to a serious error, pls use `rollback()` to cancel transaction.", 'EABORT')
    }

    if (!this._inTransaction) {
      throw new TransactionError('Transaction has not begun. Call begin() first.', 'ENOTBEGUN')
    }

    if (this._activeRequest) {
      throw new TransactionError("Can't commit transaction. There is a request in progress.", 'EREQINPROG')
    }

    try {
      debug('@Connection (%d): transaction commit', IDS.get(this))
      await this._commit(this._connection)
      debug('@Connection (%d): transaction commited', IDS.get(this))
      this._inTransaction = false;
    } catch (err) {
      this.emit('commit')
      throw err
    }
  }

  /**
   * Rollback a transaction.
   *
   * @param {basicCallback} [callback] A callback which is called after transaction has rolled back, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */
  async rollback() {
    if (!this._inTransaction) {
      throw new TransactionError('Transaction has not begun. Call begin() first.', 'ENOTBEGUN')
    }

    if (this._activeRequest) {
      throw new TransactionError("Can't rollback transaction. There is a request in progress.", 'EREQINPROG')
    }

    try {
      debug('@Connection (%d): transaction rollback', IDS.get(this))
      this._inTransaction = false;
      if (!this._aborted) {
        await this._rollback(this._connection)
      }
      this.emit('rollback', this._aborted)
      this._aborted = undefined;
      debug('@Connection (%d): transaction rolled back', IDS.get(this))
    } catch (err) {
      this.emit('error', err)
      throw err
    }
  }

  /**
   * @private
   * @param {basicCallback} [callback]
   * @return {Transaction}
   */


  _connect() {
    throw new Error('Not implementation.')
  }

  // eslint-disable-next-line no-unused-vars
  _disconnect(_tedious) {
    throw new Error('Not implementation.')
  }

  // eslint-disable-next-line no-unused-vars
  _beginTrans(tedious, isolationLevel) {
    throw new Error('Not implementation.')
  }

  // eslint-disable-next-line no-unused-vars
  _commit(tedious) {
    throw new Error('Not implementation.')
  }

  // eslint-disable-next-line no-unused-vars
  _rollback(tedious) {
    throw new Error('Not implementation.')
  }

}

Connection.defaultIsolationLevel = ISOLATION_LEVEL.READ_COMMITTED

module.exports = Connection

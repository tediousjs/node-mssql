'use strict'

const { EventEmitter } = require('events')
const debug = require('debug')('mssql:base')
const tarn = require('tarn')
const { IDS } = require('../utils')
const ConnectionString = require('../connectionstring')
const ConnectionError = require('../error/connection-error')
const shared = require('../shared')

/**
 * Class ConnectionPool.
 *
 * Internally, each `Connection` instance is a separate pool of TDS connections. Once you create a new `Request`/`Transaction`/`Prepared Statement`, a new TDS connection is acquired from the pool and reserved for desired action. Once the action is complete, connection is released back to the pool.
 *
 * @property {Boolean} connected If true, connection is established.
 * @property {Boolean} connecting If true, connection is being established.
 *
 * @fires ConnectionPool#connect
 * @fires ConnectionPool#close
 */

class ConnectionPool extends EventEmitter {
  /**
   * Create new Connection.
   *
   * @param {Object|String} config Connection configuration object or connection string.
   * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred.
   */

  constructor (config, callback) {
    super()

    IDS.add(this, 'ConnectionPool')
    debug('pool(%d): created', IDS.get(this))

    this._connected = false
    this._connecting = false
    this._healthy = false

    if (typeof config === 'string') {
      try {
        this.config = ConnectionString.resolve(config, shared.driver.name)
      } catch (ex) {
        if (typeof callback === 'function') {
          return setImmediate(callback, ex)
        }
        throw ex
      }
    } else {
      this.config = Object.assign({}, config)
    }

    // set defaults
    this.config.port = this.config.port || 1433
    this.config.options = this.config.options || {}
    this.config.stream = this.config.stream || false
    this.config.parseJSON = this.config.parseJSON || false

    if (/^(.*)\\(.*)$/.exec(this.config.server)) {
      this.config.server = RegExp.$1
      this.config.options.instanceName = RegExp.$2
    }

    if (typeof callback === 'function') {
      this.connect(callback)
    }
  }

  get connected () {
    return this._connected
  }

  get connecting () {
    return this._connecting
  }

  get healthy () {
    return this._healthy
  }

  /**
   * Acquire connection from this connection pool.
   *
   * @param {ConnectionPool|Transaction|PreparedStatement} requester Requester.
   * @param {acquireCallback} [callback] A callback which is called after connection has been acquired, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  acquire (requester, callback) {
    const acquirePromise = shared.Promise.resolve(this._acquire().promise).catch(err => {
      this.emit('error', err)
      throw err
    })
    if (typeof callback === 'function') {
      acquirePromise.then(connection => callback(null, connection, this.config)).catch(callback)
      return this
    }

    return acquirePromise
  }

  _acquire () {
    if (!this.pool) {
      return shared.Promise.reject(new ConnectionError('Connection not yet open.', 'ENOTOPEN'))
    }

    return this.pool.acquire()
  }

  /**
   * Release connection back to the pool.
   *
   * @param {Connection} connection Previously acquired connection.
   * @return {ConnectionPool}
   */

  release (connection) {
    debug('connection(%d): released', IDS.get(connection))

    if (this.pool) {
      this.pool.release(connection)
    }
    return this
  }

  /**
   * Creates a new connection pool with one active connection. This one initial connection serves as a probe to find out whether the configuration is valid.
   *
   * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  connect (callback) {
    if (typeof callback === 'function') {
      this._connect(callback)
      return this
    }

    return new shared.Promise((resolve, reject) => {
      return this._connect(err => {
        if (err) return reject(err)
        resolve(this)
      })
    })
  }

  /**
   * @private
   * @param {basicCallback} callback
   */

  _connect (callback) {
    if (this._connected) {
      return setImmediate(callback, new ConnectionError('Database is already connected! Call close before connecting to different database.', 'EALREADYCONNECTED'))
    }

    if (this._connecting) {
      return setImmediate(callback, new ConnectionError('Already connecting to database! Call close before connecting to different database.', 'EALREADYCONNECTING'))
    }

    this._connecting = true
    debug('pool(%d): connecting', IDS.get(this))

    // create one test connection to check if everything is ok
    this._poolCreate().then((connection) => {
      debug('pool(%d): connected', IDS.get(this))
      this._healthy = true

      this._poolDestroy(connection).then(() => {
        if (!this._connecting) {
          debug('pool(%d): not connecting, exiting silently (was close called before connection established?)', IDS.get(this))
          return
        }

        // prepare pool
        this.pool = new tarn.Pool(
          Object.assign({
            create: () => this._poolCreate()
              .then(connection => {
                this._healthy = true
                return connection
              })
              .catch(err => {
                if (this.pool.numUsed() + this.pool.numFree() <= 0) {
                  this._healthy = false
                }
                throw err
              }),
            validate: this._poolValidate.bind(this),
            destroy: this._poolDestroy.bind(this),
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000,
            propagateCreateError: true
          }, this.config.pool)
        )
        const self = this
        Object.defineProperties(this.pool, {
          size: {
            get: () => {
              const message = 'the `size` property on pool is deprecated, access it directly on the `ConnectionPool`'
              self.emit('debug', message)
              process.emitWarning(message)
              return self.size
            }
          },
          available: {
            get: () => {
              const message = 'the `available` property on pool is deprecated, access it directly on the `ConnectionPool`'
              self.emit('debug', message)
              process.emitWarning(message)
              return self.available
            }
          },
          pending: {
            get: () => {
              const message = 'the `pending` property on pool is deprecate, access it directly on the `ConnectionPool`'
              self.emit('debug', message)
              process.emitWarning(message)
              return self.pending
            }
          },
          borrowed: {
            get: () => {
              const message = 'the `borrowed` property on pool is deprecated, access it directly on the `ConnectionPool`'
              self.emit('debug', message)
              process.emitWarning(message)
              return self.borrowed
            }
          }
        })

        this._connecting = false
        this._connected = true

        callback(null)
      })
    }).catch(err => {
      this._connecting = false
      callback(err)
    })
  }

  get size () {
    return this.pool.numFree() + this.pool.numUsed() + this.pool.numPendingCreates()
  }

  get available () {
    return this.pool.numFree()
  }

  get pending () {
    return this.pool.numPendingAcquires()
  }

  get borrowed () {
    return this.pool.numUsed()
  }

  /**
   * Close all active connections in the pool.
   *
   * @param {basicCallback} [callback] A callback which is called after connection has closed, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  close (callback) {
    if (typeof callback === 'function') {
      this._close(callback)
      return this
    }

    return new shared.Promise((resolve, reject) => {
      this._close(err => {
        if (err) return reject(err)
        resolve(this)
      })
    })
  }

  /**
   * @private
   * @param {basicCallback} callback
   */

  _close (callback) {
    this._connecting = this._connected = this._healthy = false

    if (!this.pool) return setImmediate(callback, null)

    this.pool.destroy()
    this.pool = null
    callback(null)
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

module.exports = ConnectionPool

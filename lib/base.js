'use strict'

const EventEmitter = require('events').EventEmitter
const debug = require('debug')('mssql:base')
const gp = require('generic-pool')

const TYPES = require('./datatypes').TYPES
const declare = require('./datatypes').declare
const ISOLATION_LEVEL = require('./isolationlevel')
const Table = require('./table')
const ConnectionString = require('./connectionstring')
const IDS = require('./utils').IDS

let globalConnection = null
let PromiseLibrary = Promise
const globalConnectionHandlers = {}
const map = []
const driver = {}

/**
 * Register you own type map.
 *
 * @path module.exports.map
 * @param {*} jstype JS data type.
 * @param {*} sqltype SQL data type.
 */

map.register = function (jstype, sqltype) {
  for (let index = 0; index < this.length; index++) {
    let item = this[index]
    if (item.js === jstype) {
      this.splice(index, 1)
      break
    }
  }

  this.push({
    js: jstype,
    sql: sqltype
  })

  return null
}

map.register(String, TYPES.NVarChar)
map.register(Number, TYPES.Int)
map.register(Boolean, TYPES.Bit)
map.register(Date, TYPES.DateTime)
map.register(Buffer, TYPES.VarBinary)
map.register(Table, TYPES.TVP)

/**
 * @ignore
 */

let getTypeByValue = function (value) {
  if ((value === null) || (value === undefined)) { return TYPES.NVarChar }

  switch (typeof value) {
    case 'string':
      for (var item of Array.from(map)) {
        if (item.js === String) {
          return item.sql
        }
      }

      return TYPES.NVarChar

    case 'number':
      if (value % 1 === 0) {
        return TYPES.Int
      } else {
        return TYPES.Float
      }

    case 'boolean':
      for (item of Array.from(map)) {
        if (item.js === Boolean) {
          return item.sql
        }
      }

      return TYPES.Bit

    case 'object':
      for (item of Array.from(map)) {
        if (value instanceof item.js) {
          return item.sql
        }
      }

      return TYPES.NVarChar

    default:
      return TYPES.NVarChar
  }
}

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

    if (typeof config === 'string') {
      try {
        this.config = ConnectionString.resolve(config, driver.name)
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

  /**
   * Acquire connection from this connection pool.
   *
   * @param {ConnectionPool|Transaction|PreparedStatement} requester Requester.
   * @param {acquireCallback} [callback] A callback which is called after connection has been acquired, or an error has occurred. If omited, method returns Promise.
   * @return {ConnectionPool|Promise}
   */

  acquire (requester, callback) {
    if (typeof callback === 'function') {
      this._acquire().then(connection => callback(null, connection, this.config)).catch(callback)
      return this
    }

    return this._acquire()
  }

  _acquire () {
    if (!this.pool) {
      return Promise.reject(new ConnectionError('Connection not yet open.', 'ENOTOPEN'))
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

    return new PromiseLibrary((resolve, reject) => {
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

      return this._poolDestroy(connection).then(() => {
        if (!this._connecting) {
          debug('pool(%d): not connecting, exiting silently (was close called before connection established?)', IDS.get(this))
          return
        }

        let createAttempt = 0

        function create () {
          // Create an "ID" to help track debugging messages
          const createId = createAttempt++
          const timeout = this.config.pool ? this.config.pool.acquireTimeoutMillis : undefined

          return this._poolCreateRetry(createId, 0, timeout)
        }

        // prepare pool
        this.pool = gp.createPool({
          create: create.bind(this),
          validate: this._poolValidate.bind(this),
          destroy: this._poolDestroy.bind(this)
        }, Object.assign({
          max: 10,
          min: 0,
          evictionRunIntervalMillis: 1000,
          idleTimeoutMillis: 30000,
          testOnBorrow: true
        }, this.config.pool))

        this.pool.on('factoryCreateError', this.emit.bind(this, 'error'))
        this.pool.on('factoryDestroyError', this.emit.bind(this, 'error'))

        this._connecting = false
        this._connected = true

        callback(null)
      })
    }).catch(err => {
      this._connecting = false
      callback(err)
    })
  }

  _poolCreateRetry (createId, retryCount, timeout) {
    const self = this
    let backoff
    debug('pool(%d): attempting to create connection resource(%d), attempt #%d', IDS.get(this), createId, retryCount)
    // increment our retry count on error and calculate a new backoff
    retryCount++
    return this._poolCreate().catch((e) => {
      // don't bother calculating backoffs > 8, this caps us at ~30s per retry
      backoff = retryCount > 8 ? backoff : Math.pow(2, retryCount) * 100
      if (typeof timeout !== 'undefined') {
        timeout -= backoff
        if (timeout <= 0) {
          throw e
        }
      }
      return new Promise((resolve, reject) => {
        // construct a timer-based promise to retry the connection attempt
        const timer = setTimeout(() => {
          debug('pool(%d): backoff timer complete resource(%d)', IDS.get(self), createId)
          // if the connection has been closed, reject
          if (!self.connecting && !self.connected) {
            debug('pool(%d): pool closed while trying to acquire a connection resource(%d)', IDS.get(self), createId)
            reject(new ConnectionError('Connection is closed.', 'ECONNCLOSED'))
          } else {
            resolve()
          }
        }, backoff)
        // don't let this timer block node from exiting
        timer.unref()
        debug('pool(%d): failed to create connection resource(%d), retrying with backoff of %dms', IDS.get(self), createId, backoff)
      }).then(this._poolCreateRetry.bind(this, createId, retryCount, timeout))
    })
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

    return new PromiseLibrary((resolve, reject) => {
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
    this._connecting = this._connected = false

    if (!this.pool) return setImmediate(callback, null)

    const pool = this.pool
    this.pool = null
    pool.drain().then(() => {
      return pool.clear()
    }).then(() => {
      callback(null)
    })
  }

  /**
   * Returns new request using this connection.
   *
   * @return {Request}
   */

  request () {
    return new driver.Request(this)
  }

  /**
   * Returns new transaction using this connection.
   *
   * @return {Transaction}
   */

  transaction () {
    return new driver.Transaction(this)
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
    if (typeof arguments[0] === 'string') { return new driver.Request(this).query(arguments[0], arguments[1]) }

    const values = Array.prototype.slice.call(arguments)
    const strings = values.shift()

    return new driver.Request(this)._template(strings, values, 'query')
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
    if (typeof arguments[0] === 'string') { return new driver.Request(this).batch(arguments[0], arguments[1]) }

    const values = Array.prototype.slice.call(arguments)
    const strings = values.shift()

    return new driver.Request(this)._template(strings, values, 'batch')
  }
}

/**
 * Class PreparedStatement.
 *
 * IMPORTANT: Rememeber that each prepared statement means one reserved connection from the pool. Don't forget to unprepare a prepared statement!
 *
 * @property {String} statement Prepared SQL statement.
 */

class PreparedStatement extends EventEmitter {
  /**
   * Creates a new Prepared Statement.
   *
   * @param {ConnectionPool|Transaction} [holder]
   */

  constructor (parent) {
    super()

    IDS.add(this, 'PreparedStatement')
    debug('ps(%d): created', IDS.get(this))

    this.parent = parent || globalConnection
    this._handle = 0
    this.prepared = false
    this.parameters = {}
  }

  get connected () {
    return this.parent.connected
  }

  /**
   * Acquire connection from connection pool.
   *
   * @param {Request} request Request.
   * @param {ConnectionPool~acquireCallback} [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
   * @return {PreparedStatement|Promise}
   */

  acquire (request, callback) {
    if (!this._acquiredConnection) {
      setImmediate(callback, new PreparedStatementError('Statement is not prepared. Call prepare() first.', 'ENOTPREPARED'))
      return this
    }

    if (this._activeRequest) {
      setImmediate(callback, new TransactionError("Can't acquire connection for the request. There is another request in progress.", 'EREQINPROG'))
      return this
    }

    this._activeRequest = request
    setImmediate(callback, null, this._acquiredConnection, this._acquiredConfig)
    return this
  }

  /**
   * Release connection back to the pool.
   *
   * @param {Connection} connection Previously acquired connection.
   * @return {PreparedStatement}
   */

  release (connection) {
    if (connection === this._acquiredConnection) {
      this._activeRequest = null
    }

    return this
  }

  /**
   * Add an input parameter to the prepared statement.
   *
   * @param {String} name Name of the input parameter without @ char.
   * @param {*} type SQL data type of input parameter.
   * @return {PreparedStatement}
   */

  input (name, type) {
    if ((/(--| |\/\*|\*\/|')/).test(name)) {
      throw new PreparedStatementError(`SQL injection warning for param '${name}'`, 'EINJECT')
    }

    if (arguments.length < 2) {
      throw new PreparedStatementError('Invalid number of arguments. 2 arguments expected.', 'EARGS')
    }

    if (type instanceof Function) {
      type = type()
    }

    this.parameters[name] = {
      name,
      type: type.type,
      io: 1,
      length: type.length,
      scale: type.scale,
      precision: type.precision,
      tvpType: type.tvpType
    }

    return this
  }

  /**
   * Add an output parameter to the prepared statement.
   *
   * @param {String} name Name of the output parameter without @ char.
   * @param {*} type SQL data type of output parameter.
   * @return {PreparedStatement}
   */

  output (name, type) {
    if (/(--| |\/\*|\*\/|')/.test(name)) {
      throw new PreparedStatementError(`SQL injection warning for param '${name}'`, 'EINJECT')
    }

    if (arguments.length < 2) {
      throw new PreparedStatementError('Invalid number of arguments. 2 arguments expected.', 'EARGS')
    }

    if (type instanceof Function) type = type()

    this.parameters[name] = {
      name,
      type: type.type,
      io: 2,
      length: type.length,
      scale: type.scale,
      precision: type.precision
    }

    return this
  }

  /**
   * Prepare a statement.
   *
   * @param {String} statement SQL statement to prepare.
   * @param {basicCallback} [callback] A callback which is called after preparation has completed, or an error has occurred. If omited, method returns Promise.
   * @return {PreparedStatement|Promise}
   */

  prepare (statement, callback) {
    if (typeof callback === 'function') {
      this._prepare(statement, callback)
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      this._prepare(statement, err => {
        if (err) return reject(err)
        resolve(this)
      })
    })
  }

  /**
   * @private
   * @param {String} statement
   * @param {basicCallback} callback
   */

  _prepare (statement, callback) {
    debug('ps(%d): prepare', IDS.get(this))

    if (typeof statement === 'function') {
      callback = statement
      statement = undefined
    }

    if (this.prepared) {
      return setImmediate(callback, new PreparedStatementError('Statement is already prepared.', 'EALREADYPREPARED'))
    }

    this.statement = statement || this.statement

    this.parent.acquire(this, (err, connection, config) => {
      if (err) return callback(err)

      this._acquiredConnection = connection
      this._acquiredConfig = config

      const req = new driver.Request(this)
      req.stream = false
      req.output('handle', TYPES.Int)
      req.input('params', TYPES.NVarChar, ((() => {
        let result = []
        for (let name in this.parameters) {
          let param = this.parameters[name]
          result.push(`@${name} ${declare(param.type, param)}${param.io === 2 ? ' output' : ''}`)
        }
        return result
      })()).join(','))
      req.input('stmt', TYPES.NVarChar, this.statement)
      req.execute('sp_prepare', (err, result) => {
        if (err) {
          this.parent.release(this._acquiredConnection)
          this._acquiredConnection = null
          this._acquiredConfig = null

          return callback(err)
        }

        debug('ps(%d): prepared', IDS.get(this))

        this._handle = result.output.handle
        this.prepared = true

        callback(null)
      })
    })
  }

  /**
   * Execute a prepared statement.
   *
   * @param {Object} values An object whose names correspond to the names of parameters that were added to the prepared statement before it was prepared.
   * @param {basicCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  execute (values, callback) {
    if (this.stream || (typeof callback === 'function')) {
      return this._execute(values, callback)
    }

    return new PromiseLibrary((resolve, reject) => {
      this._execute(values, (err, recordset) => {
        if (err) return reject(err)
        resolve(recordset)
      })
    })
  }

  /**
   * @private
   * @param {Object} values
   * @param {basicCallback} callback
   */

  _execute (values, callback) {
    const req = new driver.Request(this)
    req.stream = this.stream
    req.input('handle', TYPES.Int, this._handle)

    // copy parameters with new values
    for (let name in this.parameters) {
      let param = this.parameters[name]
      req.parameters[name] = {
        name,
        type: param.type,
        io: param.io,
        value: values[name],
        length: param.length,
        scale: param.scale,
        precision: param.precision
      }
    }

    req.execute('sp_execute', (err, result) => {
      if (err) return callback(err)

      callback(null, result)
    })

    return req
  }

  /**
   * Unprepare a prepared statement.
   *
   * @param {basicCallback} [callback] A callback which is called after unpreparation has completed, or an error has occurred. If omited, method returns Promise.
   * @return {PreparedStatement|Promise}
   */

  unprepare (callback) {
    if (typeof callback === 'function') {
      this._unprepare(callback)
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      this._unprepare(err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * @private
   * @param {basicCallback} callback
   */

  _unprepare (callback) {
    debug('ps(%d): unprepare', IDS.get(this))

    if (!this.prepared) {
      return setImmediate(callback, new PreparedStatementError('Statement is not prepared. Call prepare() first.', 'ENOTPREPARED'))
    }

    if (this._activeRequest) {
      return setImmediate(callback, new TransactionError("Can't unprepare the statement. There is a request in progress.", 'EREQINPROG'))
    }

    const req = new driver.Request(this)
    req.stream = false
    req.input('handle', TYPES.Int, this._handle)
    req.execute('sp_unprepare', err => {
      if (err) return callback(err)

      this.parent.release(this._acquiredConnection)
      this._acquiredConnection = null
      this._acquiredConfig = null
      this._handle = 0
      this.prepared = false

      debug('ps(%d): unprepared', IDS.get(this))

      return callback(null)
    })
  }
}

/**
 * Class Transaction.
 *
 * @property {Number} isolationLevel Controls the locking and row versioning behavior of TSQL statements issued by a connection. READ_COMMITTED by default.
 * @property {String} name Transaction name. Empty string by default.
 *
 * @fires Transaction#begin
 * @fires Transaction#commit
 * @fires Transaction#rollback
 */

class Transaction extends EventEmitter {
  /**
   * Create new Transaction.
   *
   * @param {Connection} [holder] If ommited, global connection is used instead.
   */

  constructor (parent) {
    super()

    IDS.add(this, 'Transaction')
    debug('transaction(%d): created', IDS.get(this))

    this.parent = parent || globalConnection
    this.isolationLevel = ISOLATION_LEVEL.READ_COMMITTED
    this.name = ''
  }

  get connected () {
    return this.parent.connected
  }

  /**
   * Acquire connection from connection pool.
   *
   * @param {Request} request Request.
   * @param {ConnectionPool~acquireCallback} [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */

  acquire (request, callback) {
    if (!this._acquiredConnection) {
      setImmediate(callback, new TransactionError('Transaction has not begun. Call begin() first.', 'ENOTBEGUN'))
      return this
    }

    if (this._activeRequest) {
      setImmediate(callback, new TransactionError("Can't acquire connection for the request. There is another request in progress.", 'EREQINPROG'))
      return this
    }

    this._activeRequest = request
    setImmediate(callback, null, this._acquiredConnection, this._acquiredConfig)
    return this
  }

  /**
   * Release connection back to the pool.
   *
   * @param {Connection} connection Previously acquired connection.
   * @return {Transaction}
   */

  release (connection) {
    if (connection === this._acquiredConnection) {
      this._activeRequest = null
    }

    return this
  }

  /**
   * Begin a transaction.
   *
   * @param {Number} [isolationLevel] Controls the locking and row versioning behavior of TSQL statements issued by a connection.
   * @param {basicCallback} [callback] A callback which is called after transaction has began, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */

  begin (isolationLevel, callback) {
    if (isolationLevel instanceof Function) {
      callback = isolationLevel
      isolationLevel = undefined
    }

    if (typeof callback === 'function') {
      this._begin(isolationLevel, err => {
        if (!err) {
          this.emit('begin')
        }
        callback(err)
      })
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      this._begin(isolationLevel, err => {
        if (err) return reject(err)
        this.emit('begin')
        resolve(this)
      })
    })
  }

  /**
   * @private
   * @param {Number} [isolationLevel]
   * @param {basicCallback} [callback]
   * @return {Transaction}
   */

  _begin (isolationLevel, callback) {
    if (this._acquiredConnection) {
      return setImmediate(callback, new TransactionError('Transaction has already begun.', 'EALREADYBEGUN'))
    }

    this._aborted = false
    this._rollbackRequested = false
    this.isolationLevel = isolationLevel || this.isolationLevel

    setImmediate(callback)
  }

  /**
   * Commit a transaction.
   *
   * @param {basicCallback} [callback] A callback which is called after transaction has commited, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */

  commit (callback) {
    if (typeof callback === 'function') {
      this._commit(err => {
        if (!err) {
          this.emit('commit')
        }
        callback(err)
      })
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      this._commit(err => {
        if (err) return reject(err)
        this.emit('commit')
        resolve()
      })
    })
  }

  /**
   * @private
   * @param {basicCallback} [callback]
   * @return {Transaction}
   */

  _commit (callback) {
    if (this._aborted) {
      return setImmediate(callback, new TransactionError('Transaction has been aborted.', 'EABORT'))
    }

    if (!this._acquiredConnection) {
      return setImmediate(callback, new TransactionError('Transaction has not begun. Call begin() first.', 'ENOTBEGUN'))
    }

    if (this._activeRequest) {
      return setImmediate(callback, new TransactionError("Can't commit transaction. There is a request in progress.", 'EREQINPROG'))
    }

    setImmediate(callback)
  }

  /**
   * Returns new request using this transaction.
   *
   * @return {Request}
   */

  request () {
    return new driver.Request(this)
  }

  /**
   * Rollback a transaction.
   *
   * @param {basicCallback} [callback] A callback which is called after transaction has rolled back, or an error has occurred. If omited, method returns Promise.
   * @return {Transaction|Promise}
   */

  rollback (callback) {
    if (typeof callback === 'function') {
      this._rollback(err => {
        if (!err) {
          this.emit('rollback', this._aborted)
        }
        callback(err)
      })
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      return this._rollback(err => {
        if (err) return reject(err)
        this.emit('rollback', this._aborted)
        resolve()
      })
    }
    )
  }

  /**
   * @private
   * @param {basicCallback} [callback]
   * @return {Transaction}
   */

  _rollback (callback) {
    if (this._aborted) {
      return setImmediate(callback, new TransactionError('Transaction has been aborted.', 'EABORT'))
    }

    if (!this._acquiredConnection) {
      return setImmediate(callback, new TransactionError('Transaction has not begun. Call begin() first.', 'ENOTBEGUN'))
    }

    if (this._activeRequest) {
      return setImmediate(callback, new TransactionError("Can't rollback transaction. There is a request in progress.", 'EREQINPROG'))
    }

    this._rollbackRequested = true

    setImmediate(callback)
  }
}

/**
 * Class Request.
 *
 * @property {Transaction} transaction Reference to transaction when request was created in transaction.
 * @property {*} parameters Collection of input and output parameters.
 * @property {Boolean} canceled `true` if request was canceled.
 *
 * @fires Request#recordset
 * @fires Request#row
 * @fires Request#done
 * @fires Request#error
 */

class Request extends EventEmitter {
  /**
   * Create new Request.
   *
   * @param {Connection|ConnectionPool|Transaction|PreparedStatement} parent If ommited, global connection is used instead.
   */

  constructor (parent) {
    super()

    IDS.add(this, 'Request')
    debug('request(%d): created', IDS.get(this))

    this.canceled = false
    this._paused = false
    this.parent = parent || globalConnection
    this.parameters = {}
  }

  /**
   * Fetch request from tagged template string.
   *
   * @private
   * @param {Array} strings
   * @param {Array} values
   * @param {String} [method] If provided, method is automtically called with serialized command on this object.
   * @return {Request}
   */

  _template (strings, values, method) {
    let command = [strings[0]]

    for (let index = 0; index < values.length; index++) {
      let value = values[index]
      // if value is an array, prepare each items as it's own comma separated parameter
      if (Array.isArray(value)) {
        for (let parameterIndex = 0; parameterIndex < value.length; parameterIndex++) {
          this.input(`param${index + 1}_${parameterIndex}`, value[parameterIndex])
          command.push(`@param${index + 1}_${parameterIndex}`)
          if (parameterIndex < value.length - 1) {
            command.push(', ')
          } else {
            command.push(strings[index + 1])
          }
        }
      } else {
        this.input(`param${index + 1}`, value)
        command.push(`@param${index + 1}`, strings[index + 1])
      }
    }

    if (method) {
      return this[method](command.join(''))
    } else {
      return command.join('')
    }
  }

  /**
   * Add an input parameter to the request.
   *
   * @param {String} name Name of the input parameter without @ char.
   * @param {*} [type] SQL data type of input parameter. If you omit type, module automaticaly decide which SQL data type should be used based on JS data type.
   * @param {*} value Input parameter value. `undefined` and `NaN` values are automatically converted to `null` values.
   * @return {Request}
   */

  input (name, type, value) {
    if ((/(--| |\/\*|\*\/|')/).test(name)) {
      throw new RequestError(`SQL injection warning for param '${name}'`, 'EINJECT')
    }

    if (arguments.length === 1) {
      throw new RequestError('Invalid number of arguments. At least 2 arguments expected.', 'EARGS')
    } else if (arguments.length === 2) {
      value = type
      type = getTypeByValue(value)
    }

    // support for custom data types
    if (value && typeof value.valueOf === 'function' && !(value instanceof Date)) value = value.valueOf()

    if (value === undefined) value = null // undefined to null
    if (typeof value === 'number' && isNaN(value)) value = null // NaN to null
    if (type instanceof Function) type = type()

    this.parameters[name] = {
      name,
      type: type.type,
      io: 1,
      value,
      length: type.length,
      scale: type.scale,
      precision: type.precision,
      tvpType: type.tvpType
    }

    return this
  }

  /**
   * Add an output parameter to the request.
   *
   * @param {String} name Name of the output parameter without @ char.
   * @param {*} type SQL data type of output parameter.
   * @param {*} [value] Output parameter value initial value. `undefined` and `NaN` values are automatically converted to `null` values. Optional.
   * @return {Request}
   */

  output (name, type, value) {
    if (!type) { type = TYPES.NVarChar }

    if ((/(--| |\/\*|\*\/|')/).test(name)) {
      throw new RequestError(`SQL injection warning for param '${name}'`, 'EINJECT')
    }

    if ((type === TYPES.Text) || (type === TYPES.NText) || (type === TYPES.Image)) {
      throw new RequestError('Deprecated types (Text, NText, Image) are not supported as OUTPUT parameters.', 'EDEPRECATED')
    }

    // support for custom data types
    if (value && typeof value.valueOf === 'function' && !(value instanceof Date)) value = value.valueOf()

    if (value === undefined) value = null // undefined to null
    if (typeof value === 'number' && isNaN(value)) value = null // NaN to null
    if (type instanceof Function) type = type()

    this.parameters[name] = {
      name,
      type: type.type,
      io: 2,
      value,
      length: type.length,
      scale: type.scale,
      precision: type.precision
    }

    return this
  }

  /**
   * Execute the SQL batch.
   *
   * @param {String} batch T-SQL batch to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  batch (batch, callback) {
    if (this.stream == null && this.connection) this.stream = this.connection.config.stream
    this.rowsAffected = 0

    if (typeof callback === 'function') {
      this._batch(batch, (err, recordsets, output, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected
          })
        }

        if (err) return callback(err)
        callback(null, {
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected
        })
      })
      return this
    }

    // Check is method was called as tagged template
    if (typeof batch === 'object') {
      const values = Array.prototype.slice.call(arguments)
      const strings = values.shift()
      batch = this._template(strings, values)
    }

    return new PromiseLibrary((resolve, reject) => {
      this._batch(batch, (err, recordsets, output, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected
          })
        }

        if (err) return reject(err)
        resolve({
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected
        })
      })
    })
  }

  /**
   * @private
   * @param {String} batch
   * @param {Request~requestCallback} callback
   */

  _batch (batch, callback) {
    if (!this.connection) {
      return setImmediate(callback, new RequestError('No connection is specified for that request.', 'ENOCONN'))
    }

    if (!this.connection.connected) {
      return setImmediate(callback, new ConnectionError('Connection is closed.', 'ECONNCLOSED'))
    }

    this.canceled = false
    setImmediate(callback)
  }

  /**
   * Bulk load.
   *
   * @param {Table} table SQL table.
   * @param {object} [options] Options to be passed to the underlying driver (tedious only).
   * @param {Request~bulkCallback} [callback] A callback which is called after bulk load has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  bulk (table, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    } else if (typeof options === 'undefined') {
      options = {}
    }

    if (this.stream == null && this.connection) this.stream = this.connection.config.stream

    if (this.stream || typeof callback === 'function') {
      this._bulk(table, options, (err, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          return this.emit('done', {
            rowsAffected
          })
        }

        if (err) return callback(err)
        callback(null, {
          rowsAffected
        })
      })
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      this._bulk(table, options, (err, rowsAffected) => {
        if (err) return reject(err)
        resolve({
          rowsAffected
        })
      })
    })
  }

  /**
   * @private
   * @param {Table} table
   * @param {object} options
   * @param {Request~bulkCallback} callback
   */

  _bulk (table, options, callback) {
    if (!this.parent) {
      return setImmediate(callback, new RequestError('No connection is specified for that request.', 'ENOCONN'))
    }

    if (!this.parent.connected) {
      return setImmediate(callback, new ConnectionError('Connection is closed.', 'ECONNCLOSED'))
    }

    this.canceled = false
    setImmediate(callback)
  }

  /**
   * Sets request to `stream` mode and pulls all rows from all recordsets to a given stream.
   *
   * @param {Stream} stream Stream to pipe data into.
   * @return {Stream}
   */

  pipe (stream) {
    this.stream = true
    this.on('row', stream.write.bind(stream))
    this.on('error', stream.emit.bind(stream, 'error'))
    this.on('done', () => {
      setImmediate(() => stream.end())
    })
    stream.emit('pipe', this)
    return stream
  }

  /**
   * Execute the SQL command.
   *
   * @param {String} command T-SQL command to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  query (command, callback) {
    if (this.stream == null && this.connection) this.stream = this.connection.config.stream
    this.rowsAffected = 0

    if (typeof callback === 'function') {
      this._query(command, (err, recordsets, output, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected
          })
        }

        if (err) return callback(err)
        callback(null, {
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected
        })
      })
      return this
    }

    // Check is method was called as tagged template
    if (typeof command === 'object') {
      const values = Array.prototype.slice.call(arguments)
      const strings = values.shift()
      command = this._template(strings, values)
    }

    return new PromiseLibrary((resolve, reject) => {
      this._query(command, (err, recordsets, output, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected
          })
        }

        if (err) return reject(err)
        resolve({
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected
        })
      })
    })
  }

  /**
   * @private
   * @param {String} command
   * @param {Request~bulkCallback} callback
   */

  _query (command, callback) {
    if (!this.parent) {
      return setImmediate(callback, new RequestError('No connection is specified for that request.', 'ENOCONN'))
    }

    if (!this.parent.connected) {
      return setImmediate(callback, new ConnectionError('Connection is closed.', 'ECONNCLOSED'))
    }

    this.canceled = false
    setImmediate(callback)
  }

  /**
   * Call a stored procedure.
   *
   * @param {String} procedure Name of the stored procedure to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  execute (command, callback) {
    if (this.stream == null && this.connection) this.stream = this.connection.config.stream
    this.rowsAffected = 0

    if (typeof callback === 'function') {
      this._execute(command, (err, recordsets, output, returnValue, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected,
            returnValue
          })
        }

        if (err) return callback(err)
        callback(null, {
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected,
          returnValue
        })
      })
      return this
    }

    return new PromiseLibrary((resolve, reject) => {
      this._execute(command, (err, recordsets, output, returnValue, rowsAffected) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected,
            returnValue
          })
        }

        if (err) return reject(err)
        resolve({
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected,
          returnValue
        })
      })
    })
  }

  /**
   * @private
   * @param {String} procedure
   * @param {Request~bulkCallback} callback
   */

  _execute (procedure, callback) {
    if (!this.parent) {
      return setImmediate(callback, new RequestError('No connection is specified for that request.', 'ENOCONN'))
    }

    if (!this.parent.connected) {
      return setImmediate(callback, new ConnectionError('Connection is closed.', 'ECONNCLOSED'))
    }

    this.canceled = false
    setImmediate(callback)
  }

  /**
   * Cancel currently executed request.
   *
   * @return {Boolean}
   */

  cancel () {
    this._cancel()
    return true
  }

  /**
   * @private
   */

  _cancel () {
    this.canceled = true
  }

  pause () {
    if (this.stream) {
      this._pause()
      return true
    }
    return false
  }

  _pause () {
    this._paused = true
  }

  resume () {
    if (this.stream) {
      this._resume()
      return true
    }
    return false
  }

  _resume () {
    this._paused = false
  }

  _setCurrentRequest (request) {
    this._currentRequest = request
    if (this._paused) {
      this.pause()
    }
    return this
  }
}

/**
 * Class ConnectionError.
 */

class ConnectionError extends Error {
  /**
   * Creates a new ConnectionError.
   *
   * @param {String} message Error message.
   * @param {String} [code] Error code.
   */

  constructor (message, code) {
    if (message instanceof Error) {
      super(message.message)
      this.code = message.code || code

      Error.captureStackTrace(this, this.constructor)
      Object.defineProperty(this, 'originalError', {enumerable: true, value: message})
    } else {
      super(message)
      this.code = code
    }

    this.name = 'ConnectionError'
  }
}

/**
 * Class TransactionError.
 */

class TransactionError extends Error {
  /**
   * Creates a new TransactionError.
   *
   * @param {String} message Error message.
   * @param {String} [code] Error code.
   */

  constructor (message, code) {
    if (message instanceof Error) {
      super(message.message)
      this.code = message.code || code

      Error.captureStackTrace(this, this.constructor)
      Object.defineProperty(this, 'originalError', {enumerable: true, value: message})
    } else {
      super(message)
      this.code = code
    }

    this.name = 'TransactionError'
  }
}

/**
 * Class RequestError.
 *
 * @property {String} number Error number.
 * @property {Number} lineNumber Line number.
 * @property {String} state Error state.
 * @property {String} class Error class.
 * @property {String} serverName Server name.
 * @property {String} procName Procedure name.
 */

class RequestError extends Error {
  /**
   * Creates a new RequestError.
   *
   * @param {String} message Error message.
   * @param {String} [code] Error code.
   */

  constructor (message, code) {
    if (message instanceof Error) {
      super(message.message)
      this.code = message.code || code

      if (message.info) {
        this.number = message.info.number || message.code // err.code is returned by msnodesql driver
        this.lineNumber = message.info.lineNumber
        this.state = message.info.state || message.sqlstate // err.sqlstate is returned by msnodesql driver
        this.class = message.info.class
        this.serverName = message.info.serverName
        this.procName = message.info.procName
      } else {
        this.number = message.code // err.code is returned by msnodesql driver
        this.state = message.sqlstate // err.sqlstate is returned by msnodesql driver
      }

      Error.captureStackTrace(this, this.constructor)
      Object.defineProperty(this, 'originalError', {enumerable: true, value: message})
    } else {
      super(message)
      this.code = code
    }

    this.name = 'RequestError'
    if ((/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(this.message)) {
      this.message = RegExp.$1
    }
  }
}

/**
 * Class PreparedStatementError.
 */

class PreparedStatementError extends Error {
  /**
   * Creates a new PreparedStatementError.
   *
   * @param {String} message Error message.
   * @param {String} [code] Error code.
   */

  constructor (message, code) {
    if (message instanceof Error) {
      super(message.message)
      this.code = message.code || code

      Error.captureStackTrace(this, this.constructor)
      Object.defineProperty(this, 'originalError', {enumerable: true, value: message})
    } else {
      super(message)
      this.code = code
    }

    this.name = 'PreparedStatementError'
  }
}

module.exports = {
  ConnectionPool,
  Transaction,
  Request,
  PreparedStatement,
  ConnectionError,
  TransactionError,
  RequestError,
  PreparedStatementError,
  driver,
  exports: {
    ConnectionError,
    TransactionError,
    RequestError,
    PreparedStatementError,
    Table,
    ISOLATION_LEVEL,
    TYPES,
    MAX: 65535, // (1 << 16) - 1
    map,
    getTypeByValue
  }
}

Object.defineProperty(module.exports, 'Promise', {
  get: () => {
    return PromiseLibrary
  },
  set: (value) => {
    PromiseLibrary = value
  }
})

// append datatypes to this modules export

for (let key in TYPES) {
  let value = TYPES[key]
  module.exports.exports[key] = value
  module.exports.exports[key.toUpperCase()] = value
}

/**
 * Open global connection pool.
 *
 * @param {Object|String} config Connection configuration object or connection string.
 * @param {basicCallback} [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
 * @return {ConnectionPool|Promise}
 */

module.exports.exports.connect = function connect (config, callback) {
  if (globalConnection) throw new Error('Global connection already exists. Call sql.close() first.')
  globalConnection = new driver.ConnectionPool(config)

  for (let event in globalConnectionHandlers) {
    for (let i = 0, l = globalConnectionHandlers[event].length; i < l; i++) {
      globalConnection.on(event, globalConnectionHandlers[event][i])
    }
  }

  return globalConnection.connect(callback)
}

/**
 * Close all active connections in the global pool.
 *
 * @param {basicCallback} [callback] A callback which is called after connection has closed, or an error has occurred. If omited, method returns Promise.
 * @return {ConnectionPool|Promise}
 */

module.exports.exports.close = function close (callback) {
  if (globalConnection) {
    // remove event handlers from the global connection
    for (let event in globalConnectionHandlers) {
      for (let i = 0, l = globalConnectionHandlers[event].length; i < l; i++) {
        globalConnection.removeListener(event, globalConnectionHandlers[event][i])
      }
    }

    // attach error handler to prevent process crash in case of error
    globalConnection.on('error', err => {
      if (globalConnectionHandlers['error']) {
        for (let i = 0, l = globalConnectionHandlers['error'].length; i < l; i++) {
          globalConnectionHandlers['error'][i].call(globalConnection, err)
        }
      }
    })

    const gc = globalConnection
    globalConnection = null
    return gc.close(callback)
  }

  if (typeof callback === 'function') {
    setImmediate(callback)
    return null
  }

  return new PromiseLibrary((resolve, reject) => {
    resolve(globalConnection)
  })
}

/**
 * Attach event handler to global connection pool.
 *
 * @param {String} event Event name.
 * @param {Function} handler Event handler.
 * @return {ConnectionPool}
 */

module.exports.exports.on = function on (event, handler) {
  if (!globalConnectionHandlers[event]) globalConnectionHandlers[event] = []
  globalConnectionHandlers[event].push(handler)

  if (globalConnection) globalConnection.on(event, handler)
  return globalConnection
}

/**
 * Detach event handler from global connection.
 *
 * @param {String} event Event name.
 * @param {Function} handler Event handler.
 * @return {ConnectionPool}
 */

module.exports.exports.removeListener = module.exports.exports.off = function removeListener (event, handler) {
  if (!globalConnectionHandlers[event]) return globalConnection
  const index = globalConnectionHandlers[event].indexOf(handler)
  if (index === -1) return globalConnection
  globalConnectionHandlers[event].splice(index, 1)
  if (globalConnectionHandlers[event].length === 0) globalConnectionHandlers[event] = undefined

  if (globalConnection) globalConnection.removeListener(event, handler)
  return globalConnection
}

/**
 * Creates a new query using global connection from a tagged template string.
 *
 * @variation 1
 * @param {Array|String} strings Array of string literals or sql command.
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

module.exports.exports.query = function query () {
  if (typeof arguments[0] === 'string') { return new driver.Request().query(arguments[0], arguments[1]) }

  const values = Array.prototype.slice.call(arguments)
  const strings = values.shift()

  return new driver.Request()._template(strings, values, 'query')
}

/**
 * Creates a new batch using global connection from a tagged template string.
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

module.exports.exports.batch = function batch () {
  if (typeof arguments[0] === 'string') { return new driver.Request().batch(arguments[0], arguments[1]) }

  const values = Array.prototype.slice.call(arguments)
  const strings = values.shift()

  return new driver.Request()._template(strings, values, 'batch')
}

/**
 * @callback Request~requestCallback
 * @param {Error} err Error on error, otherwise null.
 * @param {Object} result Request result.
 */

/**
 * @callback Request~bulkCallback
 * @param {Error} err Error on error, otherwise null.
 * @param {Number} rowsAffected Number of affected rows.
 */

/**
 * @callback basicCallback
 * @param {Error} err Error on error, otherwise null.
 * @param {Connection} connection Acquired connection.
 */

/**
 * @callback acquireCallback
 * @param {Error} err Error on error, otherwise null.
 * @param {Connection} connection Acquired connection.
 */

/**
 * Dispatched after connection has established.
 * @event ConnectionPool#connect
 */

/**
 * Dispatched after connection has closed a pool (by calling close).
 * @event ConnectionPool#close
 */

/**
 * Dispatched when transaction begin.
 * @event Transaction#begin
 */

/**
 * Dispatched on successful commit.
 * @event Transaction#commit
 */

/**
 * Dispatched on successful rollback.
 * @event Transaction#rollback
 */

/**
 * Dispatched when metadata for new recordset are parsed.
 * @event Request#recordset
 */

/**
 * Dispatched when new row is parsed.
 * @event Request#row
 */

/**
 * Dispatched when request is complete.
 * @event Request#done
 */

/**
 * Dispatched on error.
 * @event Request#error
 */

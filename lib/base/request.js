'use strict'

const debug = require('debug')('mssql:base')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const { IDS, objectHasProperty, getPoolId, isValidParameterName } = require('../utils')
const globalConnection = require('../global-connection')
const { RequestError, ConnectionError } = require('../error')
const { TYPES } = require('../datatypes')
const shared = require('../shared')
const { CHANNELS, tracePromise, traceCallback, publish } = require('../diagnostics')

// a Readable runs a single destroy hook, so one the caller passed in its stream options runs after
// `destroy`, with the stream as `this` as the Readable would have run it. The options are spread to
// read it, as they are for the Readable, so only an own `destroy` counts and null options are fine
function withDestroyHook (streamOptions, destroy) {
  const { destroy: hook } = { ...streamOptions }
  if (typeof hook !== 'function') return destroy
  return function (error, callback) {
    destroy(error, () => hook.call(this, error, callback))
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
   * @param {Connection|ConnectionPool|Transaction|PreparedStatement} [parent] If omitted, global connection is used instead.
   * @param {{ requestTimeout?: number }} [overrides]
   */

  constructor (parent, overrides = {}) {
    super()

    IDS.add(this, 'Request')
    debug('request(%d): created', IDS.get(this))

    this.canceled = false
    this._paused = false
    this._internal = false
    this.parent = parent || globalConnection.pool
    this.parameters = {}
    this.stream = null
    this.arrayRowMode = null
    this.overrides = {}
    if (Number.isFinite(overrides?.requestTimeout) && overrides.requestTimeout >= 0) {
      this.overrides.requestTimeout = overrides.requestTimeout
    }
  }

  get paused () {
    return this._paused
  }

  /**
   * Generate sql string and set input parameters from tagged template string.
   *
   * @param {Template literal} template
   * @return {String}
   */

  template () {
    const values = Array.prototype.slice.call(arguments)
    const strings = values.shift()
    return this._template(strings, values)
  }

  /**
   * Fetch request from tagged template string.
   *
   * @private
   * @param {Array} strings
   * @param {Array} values
   * @param {String} [method] If provided, method is automatically called with serialized command on this object.
   * @return {Request}
   */

  _template (strings, values, method) {
    const command = [strings[0]]

    for (let index = 0; index < values.length; index++) {
      const value = values[index]
      // if value is an array, prepare each items as it's own comma separated parameter
      if (Array.isArray(value)) {
        for (let parameterIndex = 0; parameterIndex < value.length; parameterIndex++) {
          this.input(`param${index + 1}_${parameterIndex}`, value[parameterIndex])
          command.push(`@param${index + 1}_${parameterIndex}`)
          if (parameterIndex < value.length - 1) {
            command.push(', ')
          }
        }
        command.push(strings[index + 1])
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
   * @param {*} [type] SQL data type of input parameter. If you omit type, module automatically decides which SQL data type should be used based on JS data type.
   * @param {*} value Input parameter value. `undefined` and `NaN` values are automatically converted to `null` values.
   * @return {Request}
   */

  input (name, type, value) {
    if (!isValidParameterName(name)) {
      throw new RequestError(`Invalid parameter name '${name}'. Parameter names may only contain identifier characters`, 'EINJECT')
    }

    if (arguments.length < 2) {
      throw new RequestError('Invalid number of arguments. At least 2 arguments expected.', 'EARGS')
    } else if (arguments.length === 2) {
      value = type
      type = shared.getTypeByValue(value)
    }

    // support for custom data types
    if (value && typeof value.valueOf === 'function' && !(value instanceof Date)) value = value.valueOf()

    if (value === undefined) value = null // undefined to null
    if (typeof value === 'number' && isNaN(value)) value = null // NaN to null
    if (type instanceof Function) type = type()

    if (objectHasProperty(this.parameters, name)) {
      throw new RequestError(`The parameter name ${name} has already been declared. Parameter names must be unique`, 'EDUPEPARAM')
    }

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
   * Replace an input parameter on the request.
   *
   * @param {String} name Name of the input parameter without @ char.
   * @param {*} [type] SQL data type of input parameter. If you omit type, module automatically decides which SQL data type should be used based on JS data type.
   * @param {*} value Input parameter value. `undefined` and `NaN` values are automatically converted to `null` values.
   * @return {Request}
   */

  replaceInput (name, type, value) {
    delete this.parameters[name]

    return this.input(name, type, value)
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

    if (!isValidParameterName(name)) {
      throw new RequestError(`Invalid parameter name '${name}'. Parameter names may only contain identifier characters`, 'EINJECT')
    }

    if ((type === TYPES.Text) || (type === TYPES.NText) || (type === TYPES.Image)) {
      throw new RequestError('Deprecated types (Text, NText, Image) are not supported as OUTPUT parameters.', 'EDEPRECATED')
    }

    // support for custom data types
    if (value && typeof value.valueOf === 'function' && !(value instanceof Date)) value = value.valueOf()

    if (value === undefined) value = null // undefined to null
    if (typeof value === 'number' && isNaN(value)) value = null // NaN to null
    if (type instanceof Function) type = type()

    if (objectHasProperty(this.parameters, name)) {
      throw new RequestError(`The parameter name ${name} has already been declared. Parameter names must be unique`, 'EDUPEPARAM')
    }

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
   * Replace an output parameter on the request.
   *
   * @param {String} name Name of the output parameter without @ char.
   * @param {*} type SQL data type of output parameter.
   * @param {*} [value] Output parameter value initial value. `undefined` and `NaN` values are automatically converted to `null` values. Optional.
   * @return {Request}
   */

  replaceOutput (name, type, value) {
    delete this.parameters[name]

    return this.output(name, type, value)
  }

  _getParameterNames () {
    return Object.keys(this.parameters)
  }

  _tracedPromise (channel, contextFactory, fn) {
    if (this._internal) {
      return fn()
    }
    return tracePromise(channel, fn, contextFactory)
  }

  _tracedCallback (channel, contextFactory, fn, position, args) {
    if (this._internal) {
      return fn.apply(this, args)
    }
    return traceCallback(channel, fn, position, contextFactory, this, args)
  }

  /**
   * Execute the SQL batch.
   *
   * @param {String} batch T-SQL batch to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  batch (batch, callback) {
    if (this.stream === null && this.parent) this.stream = this.parent.config.stream
    if (this.arrayRowMode === null && this.parent) this.arrayRowMode = this.parent.config.arrayRowMode
    this.rowsAffected = 0

    if (typeof callback === 'function') {
      this._tracedCallback(CHANNELS.TRACE_BATCH, () => ({
        command: batch,
        requestId: IDS.get(this),
        poolId: getPoolId(this)
      }), this._batch, 1, [batch, (err, recordsets, output, rowsAffected) => {
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
      }])
      return this
    }

    // Check if method was called as tagged template
    if (typeof batch === 'object') {
      const values = Array.prototype.slice.call(arguments)
      const strings = values.shift()
      batch = this._template(strings, values)
    }

    const batchCommand = batch
    return this._tracedPromise(CHANNELS.TRACE_BATCH, () => ({
      command: batchCommand,
      requestId: IDS.get(this),
      poolId: getPoolId(this)
    }), () => {
      return new shared.Promise((resolve, reject) => {
        this._batch(batchCommand, (err, recordsets, output, rowsAffected) => {
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
    })
  }

  /**
   * @private
   * @param {String} batch
   * @param {Request~requestCallback} callback
   */

  _batch (batch, callback) {
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

    if (this.stream === null && this.parent) this.stream = this.parent.config.stream
    if (this.arrayRowMode === null && this.parent) this.arrayRowMode = this.parent.config.arrayRowMode

    if (this.stream || typeof callback === 'function') {
      this._tracedCallback(CHANNELS.TRACE_BULK, () => ({
        table: table.path || table.name,
        rowCount: table.rows ? table.rows.length : 0,
        requestId: IDS.get(this),
        poolId: getPoolId(this)
      }), this._bulk, 2, [table, options, (err, rowsAffected) => {
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
      }])
      return this
    }

    return this._tracedPromise(CHANNELS.TRACE_BULK, () => ({
      table: table.path || table.name,
      rowCount: table.rows ? table.rows.length : 0,
      requestId: IDS.get(this),
      poolId: getPoolId(this)
    }), () => {
      return new shared.Promise((resolve, reject) => {
        this._bulk(table, options, (err, rowsAffected) => {
          if (err) return reject(err)
          resolve({
            rowsAffected
          })
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
   * Wrap original request in a Readable stream that supports back pressure and return.
   * It also sets request to `stream` mode and pulls all rows from all recordsets to a given stream.
   *
   * @param {Object} streamOptions - optional options to configure the readable stream with like highWaterMark
   * @return {Stream}
   */

  toReadableStream (streamOptions = {}) {
    this.stream = true
    this.pause()
    let requestDone = false
    let requestCanceled = false
    const readableStream = new Readable({
      ...streamOptions,
      objectMode: true,
      read: (/* size */) => {
        this.resume()
      },
      destroy: withDestroyHook(streamOptions, (error, callback) => {
        // nothing will read from the stream again, so the request must not be left paused: it
        // runs to the end, its remaining rows are dropped and its connection is released. A
        // cancelled request is left to its driver, which is already stopping it: msnodesqlv8
        // reports the cancel once the query is gone, and resuming it then reads a freed statement
        if (!requestDone && !requestCanceled && this.paused) this.resume()
        callback(error)
      })
    })
    this.on('row', (row) => {
      if (!readableStream.push(row) && !readableStream.destroyed) {
        this.pause()
      }
    })
    this.on('error', (error) => {
      if (error.code === 'ECANCEL') requestCanceled = true
      // the stream ends with the request's first error; destroying an already destroyed stream
      // does nothing, so later errors stay with the request
      readableStream.destroy(error)
    })
    this.on('done', () => {
      requestDone = true
      readableStream.push(null)
    })
    return readableStream
  }

  /**
   * Wrap original request in a Readable stream that supports back pressure and pipe to the Writable stream.
   * It also sets request to `stream` mode and pulls all rows from all recordsets to a given stream.
   * The Writable stream is destroyed with the request's first error. If the Writable stream fails or
   * closes first, the request runs to the end and its remaining rows are discarded.
   *
   * @param {Stream} stream Stream to pipe data into.
   * @return {Stream}
   */

  pipe (writableStream) {
    const readableStream = this.toReadableStream()
    // readable.pipe() leaves the source's errors to the source, but only the destination is
    // handed back, so pass them on to it as pipeline() does
    readableStream.on('error', (error) => {
      writableStream.destroy(error)
    })
    // and when the destination fails or closes first, readable.pipe() only unpipes from it, which
    // leaves the request paused with its connection: destroy the stream so the request runs to
    // the end. 'unpipe' comes even from a destination that never emits 'close', and unlike
    // finished() it adds no 'error' listener, which would stop an unhandled failure being thrown
    writableStream.on('unpipe', (source) => {
      if (source === readableStream && !readableStream.readableEnded) readableStream.destroy()
    })
    // a destination that is already destroyed will not fail or close again
    if (writableStream.destroyed) readableStream.destroy()
    return readableStream.pipe(writableStream)
  }

  /**
   * Execute the SQL command.
   *
   * @param {String} command T-SQL command to be executed.
   * @param {Request~requestCallback} [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
   * @return {Request|Promise}
   */

  query (command, callback) {
    if (this.stream === null && this.parent) this.stream = this.parent.config.stream
    if (this.arrayRowMode === null && this.parent) this.arrayRowMode = this.parent.config.arrayRowMode
    this.rowsAffected = 0

    if (typeof callback === 'function') {
      this._tracedCallback(CHANNELS.TRACE_QUERY, () => ({
        command,
        parameters: this._getParameterNames(),
        requestId: IDS.get(this),
        poolId: getPoolId(this)
      }), this._query, 1, [command, (err, recordsets, output, rowsAffected, columns) => {
        if (this.stream) {
          if (err) this.emit('error', err)
          err = null

          this.emit('done', {
            output,
            rowsAffected
          })
        }

        if (err) return callback(err)
        const result = {
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected
        }
        if (this.arrayRowMode) result.columns = columns
        callback(null, result)
      }])
      return this
    }

    // Check if method was called as tagged template
    if (typeof command === 'object') {
      const values = Array.prototype.slice.call(arguments)
      const strings = values.shift()
      command = this._template(strings, values)
    }

    return this._tracedPromise(CHANNELS.TRACE_QUERY, () => ({
      command,
      parameters: this._getParameterNames(),
      requestId: IDS.get(this),
      poolId: getPoolId(this)
    }), () => {
      return new shared.Promise((resolve, reject) => {
        this._query(command, (err, recordsets, output, rowsAffected, columns) => {
          if (this.stream) {
            if (err) this.emit('error', err)
            err = null

            this.emit('done', {
              output,
              rowsAffected
            })
          }

          if (err) return reject(err)
          const result = {
            recordsets,
            recordset: recordsets && recordsets[0],
            output,
            rowsAffected
          }
          if (this.arrayRowMode) result.columns = columns
          resolve(result)
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
    if (this.stream === null && this.parent) this.stream = this.parent.config.stream
    if (this.arrayRowMode === null && this.parent) this.arrayRowMode = this.parent.config.arrayRowMode
    this.rowsAffected = 0

    if (typeof callback === 'function') {
      this._tracedCallback(CHANNELS.TRACE_EXECUTE, () => ({
        procedure: command,
        parameters: this._getParameterNames(),
        requestId: IDS.get(this),
        poolId: getPoolId(this)
      }), this._execute, 1, [command, (err, recordsets, output, returnValue, rowsAffected, columns) => {
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
        const result = {
          recordsets,
          recordset: recordsets && recordsets[0],
          output,
          rowsAffected,
          returnValue
        }
        if (this.arrayRowMode) result.columns = columns
        callback(null, result)
      }])
      return this
    }

    return this._tracedPromise(CHANNELS.TRACE_EXECUTE, () => ({
      procedure: command,
      parameters: this._getParameterNames(),
      requestId: IDS.get(this),
      poolId: getPoolId(this)
    }), () => {
      return new shared.Promise((resolve, reject) => {
        this._execute(command, (err, recordsets, output, returnValue, rowsAffected, columns) => {
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
          const result = {
            recordsets,
            recordset: recordsets && recordsets[0],
            output,
            rowsAffected,
            returnValue
          }
          if (this.arrayRowMode) result.columns = columns
          resolve(result)
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
    if (!this._internal) {
      publish(CHANNELS.REQUEST_CANCEL, () => ({
        requestId: IDS.get(this)
      }))
    }
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

module.exports = Request

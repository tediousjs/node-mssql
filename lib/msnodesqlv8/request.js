'use strict'

const msnodesql = require('msnodesqlv8')
const debug = require('debug')('mssql:msv8')
const BaseRequest = require('../base/request')
const RequestError = require('../error/request-error')
const { IDS, objectHasProperty, assertSafeColumnName, assertSafeTypeName, assertSafeTypeSize, assertSafeProcedureName, stripOdbcPrefix } = require('../utils')
const { TYPES, DECLARATIONS, declare } = require('../datatypes')
const { PARSERS: UDT } = require('../udt')
const Table = require('../table')
const { valueHandler } = require('../shared')

const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B'
const EMPTY_BUFFER = Buffer.alloc(0)

// msnodesqlv8 fetches a result set's rows this many at a time. It is only safe to pause once
// it has handed over every row of the batch it fetched: paused part way through a result set's
// last, short batch, it moves on to the next result set, or ends the query, with the rest of
// that batch still to come.
const DRIVER_ROW_BATCH_SIZE = 50

// String() converts a Symbol, which only fails to convert implicitly; an object without a
// working toString falls back to its tag
const thrownMessage = function (value) {
  try {
    return String(value)
  } catch (e) {
    return Object.prototype.toString.call(value)
  }
}

// msnodesqlv8 >= 3 keeps the reader of a query on it, and the reader stops running as soon as
// the query ends, a few ticks before msnodesqlv8 reports the end with 'done' or 'free'
const stopped = function (query) {
  return query.queryWorker?.running === false
}

const castParameter = function (value, type) {
  if (value == null) {
    if ((type === TYPES.Binary) || (type === TYPES.VarBinary) || (type === TYPES.Image)) {
      // msnodesql has some problems with NULL values in those types, so we need to replace it with empty buffer
      return EMPTY_BUFFER
    }

    return null
  }

  switch (type) {
    case TYPES.VarChar:
    case TYPES.NVarChar:
    case TYPES.Char:
    case TYPES.NChar:
    case TYPES.Xml:
    case TYPES.Text:
    case TYPES.BigInt:
    case TYPES.NText:
      if ((typeof value !== 'string') && !(value instanceof String)) {
        value = value.toString()
      }
      break

    case TYPES.Int:
    case TYPES.TinyInt:
    case TYPES.SmallInt:
      if ((typeof value !== 'number') && !(value instanceof Number)) {
        value = parseInt(value)
        if (isNaN(value)) { value = null }
      }
      break

    case TYPES.Float:
    case TYPES.Real:
    case TYPES.Decimal:
    case TYPES.Numeric:
    case TYPES.SmallMoney:
    case TYPES.Money:
      if ((typeof value !== 'number') && !(value instanceof Number)) {
        value = parseFloat(value)
        if (isNaN(value)) { value = null }
      }
      break

    case TYPES.Bit:
      if ((typeof value !== 'boolean') && !(value instanceof Boolean)) {
        value = Boolean(value)
      }
      break

    case TYPES.DateTime:
    case TYPES.SmallDateTime:
    case TYPES.DateTimeOffset:
    case TYPES.Date:
      if (!(value instanceof Date)) {
        value = new Date(value)
      }
      break

    case TYPES.Binary:
    case TYPES.VarBinary:
    case TYPES.Image:
      if (!(value instanceof Buffer)) {
        value = Buffer.from(value.toString())
      }
      break
    case TYPES.TVP:
      value = msnodesql.TvpFromTable(value)
      break
  }

  return value
}

// ODBC names the type of an identity column after the type it holds, as 'int identity', and
// gives decimal and numeric the brackets of their precision, as 'decimal() identity'
const IDENTITY_SQL_TYPE = /^(tinyint|smallint|int|bigint|decimal|numeric)(?:\(\))? identity$/

// msnodesqlv8 describes a column by the name ODBC gives its type. An identity column is described
// by the type it holds instead, so that it is described, and its values read, as any other column
// of that type.
const describeColumn = function (column) {
  const identity = typeof column.sqlType === 'string' ? IDENTITY_SQL_TYPE.exec(column.sqlType) : null
  return identity ? { ...column, sqlType: identity[1], identity: true } : column
}

const createColumns = function (metadata, arrayRowMode) {
  let out = {}
  if (arrayRowMode) out = []
  for (let index = 0, length = metadata.length; index < length; index++) {
    const column = metadata[index]
    const colName = column.name
    const outColumn = {
      index,
      name: column.name,
      length: column.size,
      type: DECLARATIONS[column.sqlType],
      nullable: column.nullable,
      identity: column.identity === true
    }

    if (column.udtType != null) {
      outColumn.udt = {
        name: column.udtType
      }

      if (DECLARATIONS[column.udtType]) {
        outColumn.type = DECLARATIONS[column.udtType]
      }
    }
    if (arrayRowMode) {
      out.push(outColumn)
    } else {
      out[colName] = outColumn
    }
  }

  return out
}

const numericStringSqlTypes = new Set(['int', 'smallint', 'tinyint', 'float', 'real', 'numeric', 'decimal', 'money', 'smallmoney'])

const valueCorrection = function (value, metadata) {
  // a number msnodesqlv8 hands over as a string is read as a number before a value handler is
  // given it, as it is with the tedious driver
  if (typeof value === 'string') {
    if (numericStringSqlTypes.has(metadata.sqlType)) {
      value = Number(value)
    } else if (metadata.sqlType === 'sql_variant' && value !== '' && !isNaN(Number(value))) {
      value = Number(value)
    }
  }

  const type = metadata && objectHasProperty(metadata, 'sqlType') && objectHasProperty(DECLARATIONS, metadata.sqlType)
    ? DECLARATIONS[metadata.sqlType]
    : null
  if (type && valueHandler.has(type)) {
    return valueHandler.get(type)(value)
  } else if ((metadata.sqlType === 'time') && (value != null)) {
    value.setFullYear(1970)
    return value
  } else if ((metadata.sqlType === 'udt') && (value != null)) {
    if (UDT[metadata.udtType]) {
      return UDT[metadata.udtType](value)
    } else {
      return value
    }
  } else {
    return value
  }
}

class Request extends BaseRequest {
  _batch (batch, callback) {
    this._isBatch = true
    this._query(batch, callback)
  }

  _bulk (table, options, callback) {
    super._bulk(table, options, err => {
      if (err) return callback(err)

      try {
        table._makeBulk()
        // Checked before a connection is borrowed, so that a rejected name cannot leave
        // the pool short of one.
        table.columns.forEach(col => {
          assertSafeColumnName(col.name)
          // This driver hands the column definition to its table manager rather than writing
          // it into SQL, so a size never reaches a statement here. It is checked all the same,
          // so that a column either works on both drivers or on neither.
          assertSafeTypeSize(col.length)
          assertSafeTypeSize(col.precision)
          assertSafeTypeSize(col.scale)
        })
        // checked here too, so an ordering key is accepted or rejected the same way on
        // either driver even though this one does not build the statement itself
        if (options && options.order) {
          Object.keys(options.order).forEach(key => assertSafeTypeName(key))
        }
      } catch (e) {
        return callback(new RequestError(e, 'EREQUEST'))
      }

      if (!table.name) {
        return setImmediate(callback, new RequestError('Table name must be specified for bulk insert.', 'ENAME'))
      }

      if (table.name.charAt(0) === '@') {
        return setImmediate(callback, new RequestError("You can't use table variables for bulk insert.", 'ENAME'))
      }

      this.parent.acquire(this, (err, connection, config) => {
        let hasReturned = false
        if (!err) {
          debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

          if (this.canceled) {
            debug('request(%d): canceled', IDS.get(this))
            this.parent.release(connection)
            return callback(new RequestError('Canceled.', 'ECANCEL'))
          }

          // Disable useNumericString during bulk operations to avoid
          // msnodesqlv8 SQL generation bugs with its table manager
          connection.setUseNumericString(false)

          const done = (err, rowCount) => {
            if (hasReturned) {
              return
            }

            hasReturned = true

            connection.setUseNumericString(true)

            if (err) {
              if ((typeof err.sqlstate === 'string') && (err.sqlstate.toLowerCase() === '08s01')) {
                connection.hasError = true
              }

              // a rejected identifier keeps its own code; anything else is a driver
              // error, whose numeric code must not become the public one
              const rejectedIdentifier = err.code === 'EINJECT'
              err = new RequestError(err)
              err.code = rejectedIdentifier ? 'EINJECT' : 'EREQUEST'
            }

            this.parent.release(connection)

            // msnodesqlv8's table manager calls `done` from within promise chains, which would
            // catch what the caller's callback throws and pass it back here as the driver's
            // error, to be dropped. The caller is called back outside them, so that what its
            // callback throws reaches the process as it would from any other callback.
            if (err) {
              process.nextTick(callback, err)
            } else {
              process.nextTick(callback, null, table.rows.length)
            }
          }

          // msnodesqlv8 throws, rather than calls back, for a query on a connection it has
          // closed, so what it throws is handed to `done` as well, which releases the connection
          const attempt = run => {
            try {
              run()
            } catch (e) {
              done(e)
            }
          }

          const go = () => {
            const tm = connection.tableMgr()
            // the table manager reports a failed lookup as (null, err), not error first
            return tm.bind(table.path.replace(/\[|\]/g, ''), (mgr, err) => {
              if (err) {
                return done(err)
              }

              if (mgr.columns.length === 0) {
                return done(new RequestError('Table was not found on the server.', 'ENAME'))
              }

              const rows = []
              try {
                for (const col of table.columns) {
                  // re-checked here for the same reason as the name below, in case the
                  // definition changed since it was checked above
                  assertSafeTypeSize(col.length)
                  assertSafeTypeSize(col.precision)
                  assertSafeTypeSize(col.scale)
                }

                for (const row of Array.from(table.rows)) {
                  const item = {}
                  for (let index = 0; index < table.columns.length; index++) {
                    const col = table.columns[index]
                    // this driver hands the name to its table manager rather than writing
                    // it into SQL, but it is checked here all the same: a name either
                    // works on both drivers or on neither
                    item[assertSafeColumnName(col.name)] = row[index]
                  }

                  rows.push(item)
                }
              } catch (e) {
                return done(e)
              }

              mgr.insertRows(rows, done)
            })
          }

          if (table.create) {
            let objectid
            if (table.temporary) {
              objectid = `tempdb..[${table.name}]`
            } else {
              objectid = table.path
            }

            // A connection is held from here on, so a column name that changed since it
            // was checked above must be reported through `done`, which releases it.
            let statement
            try {
              statement = {
                query_str: `if object_id('${objectid.replace(/'/g, '\'\'')}') is null ${table.declare()}`,
                query_timeout: (this.overrides.requestTimeout ?? config.requestTimeout) / 1000 // msnodesqlv8 timeouts are in seconds (<1 second not supported)
              }
            } catch (e) {
              return done(e)
            }

            return attempt(() => connection.queryRaw(statement, function (err) {
              if (err) { return done(err) }
              attempt(go)
            }))
          } else {
            attempt(go)
          }
        } else {
          callback(err)
        }
      })
    })
  }

  _query (command, callback, bound) {
    super._query(command, err => {
      if (err) return callback(err)

      if (command.length === 0) {
        return callback(null, [])
      }

      const recordsets = []
      const recordsetcolumns = []
      const errors = []
      const errorHandlers = {}
      const output = {}
      const rowsAffected = []

      let hasReturned = false
      let row = null
      let columns = null
      let recordset = null
      let handleOutput = false
      let isChunkedRecordset = false
      let chunksBuffer = null
      let terminated = null
      // set while the error just collected is being dispatched, along with whatever came with it
      let failing = false
      let cancelRequested = false
      // 'done' or 'free' ends the request. msnodesqlv8 >= 5.6 emits 'done' as soon as a cancel is
      // through, and the query can go on emitting after it, so the listeners ignore anything that
      // follows
      let finished = false

      // A stream goes on receiving rows after it is paused, until the driver reaches the end of a
      // full batch (see DRIVER_ROW_BATCH_SIZE). What the stream emits waits here while it is
      // paused, and is emitted in the order it arrived once it is resumed.
      const pending = []
      let rowsInRecordset = 0
      let driverPaused = false
      // a cancel of a paused stream waits for the driver to reach a point where it can be paused
      let cancelDeferred = false
      // msnodesqlv8 has freed the statement, which it does without 'done' after an error ends the query
      let freed = false
      let resuming = false
      // a refused cancel undoes only the latest one
      let cancelAttempts = 0

      const emitInOrder = (isRow, emit) => {
        if (this.stream && (this.paused || pending.length)) {
          pending.push({ isRow, emit })
        } else {
          emit()
        }
      }

      // once a cancel is through, what is waiting is emitted at once, but for the rows of a
      // paused stream, which are dropped
      const emitPendingOnCancel = () => {
        // decided once, so that a listener that resumes the stream part way through cannot let
        // the rows of the cancelled stream through
        const dropRows = this.paused
        for (const { isRow, emit } of pending.splice(0)) {
          if (!isRow || !dropRows) emit()
        }
      }

      const handleError = (req, connection, info, moreErrors) => {
        // a cancel is reported from 'done'. msnodesqlv8 >= 5.6 also sends an 'Operation canceled'
        // error after a cancel, and one that arrives before 'done' is dropped here
        if (cancelRequested && info.sqlstate === 'HY008') {
          return
        }

        const doReturn = !moreErrors
        const err = new RequestError(info, 'EREQUEST')
        err.code = 'EREQUEST'

        if (this.stream) {
          emitInOrder(false, () => this.emit('error', err))
        } else {
          if (doReturn && !hasReturned) {
            if (req) {
              for (const event in errorHandlers) {
                req.removeListener(event, errorHandlers[event])
              }
            }
            if (connection) {
              this.parent.release(connection)
              delete this._cancel

              debug('request(%d): failed', IDS.get(this), err)
            }

            if (errors.length) {
              err.precedingErrors = errors.splice(0)
            }

            hasReturned = true
            callback(err)
          }
        }

        // we must collect errors even in stream mode
        errors.push(err)
        if (!failing) {
          failing = true
          queueMicrotask(() => { failing = false })
        }
      }

      // nested = function is called by this.execute

      if (!this._nested) {
        const input = []
        try {
          for (const name in this.parameters) {
            if (!objectHasProperty(this.parameters, name)) {
              continue
            }
            const param = this.parameters[name]
            // this callback is dispatched on its own tick, so a rejected declaration has
            // to be handed back rather than thrown
            input.push(`@${param.name} ${declare(param.type, param)}`)
          }
        } catch (e) {
          return callback(new RequestError(e, 'EREQUEST'))
        }

        const sets = []
        for (const name in this.parameters) {
          if (!objectHasProperty(this.parameters, name)) {
            continue
          }
          const param = this.parameters[name]
          // an output's initial value is bound with the inputs below, so it needs a marker too;
          // an output given no value is null, and 0, '' and false are values like any other
          if (param.io === 1 || (param.io === 2 && param.value != null)) {
            sets.push(`set @${param.name}=?`)
          }
        }

        const output = []
        for (const name in this.parameters) {
          if (!objectHasProperty(this.parameters, name)) {
            continue
          }
          const param = this.parameters[name]
          if (param.io === 2) {
            output.push(`@${param.name} as '${param.name}'`)
          }
        }

        if (input.length) command = `declare ${input.join(',')};${sets.join(';')};${command};`
        if (output.length) {
          command += `select ${output.join(',')};`
          handleOutput = true
        }
      }

      // values are bound to the markers by position, so a caller that writes its own
      // markers passes the parameters in the order it wrote them. They are converted before
      // a connection is borrowed, so that a value that cannot be converted is handed back
      // with nothing to release, rather than thrown while a connection is held.
      const params = []
      let converting
      try {
        if (bound) {
          for (const param of bound) {
            converting = param.name
            params.push(castParameter(param.value, param.type))
          }
        } else {
          for (const name in this.parameters) {
            if (!objectHasProperty(this.parameters, name)) {
              continue
            }
            const param = this.parameters[name]
            if (param.io === 1 || (param.io === 2 && param.value != null)) {
              converting = param.name
              params.push(castParameter(param.value, param.type))
            }
          }
        }
      } catch (e) {
        // what was thrown need not be an Error, nor convert to a string implicitly, and may
        // carry a code of its own
        const err = new RequestError(e instanceof Error ? e : thrownMessage(e), 'EPARAM')
        err.code = 'EPARAM'
        err.message = `Validation failed for parameter '${converting}'. ${err.message}`
        return callback(err)
      }

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

        if (this.canceled) {
          debug('request(%d): canceled', IDS.get(this))
          this.parent.release(connection)
          return callback(new RequestError('Canceled.', 'ECANCEL'))
        }

        debug('request(%d): query', IDS.get(this), command)

        // msnodesqlv8 throws, rather than calls back, for a query on a connection it has closed
        let req
        try {
          req = connection.queryRaw({
            query_str: command,
            query_timeout: (this.overrides.requestTimeout ?? config.requestTimeout) / 1000 // msnodesqlv8 timeouts are in seconds (<1 second not supported)
          }, params)
        } catch (e) {
          this.parent.release(connection)
          const err = new RequestError(e, 'EREQUEST')
          err.code = 'EREQUEST'
          return callback(err)
        }

        this._setCurrentRequest(req)

        // msnodesqlv8 does not check that a query is still running when it is paused or resumed.
        // Pausing and resuming one that has ended puts it back on its connection's work queue,
        // where it holds up whatever that connection is sent next, and resuming it can set it
        // reading again from a statement that is gone, or crash the process. So once msnodesqlv8
        // reports that the query has ended, the request no longer pauses, resumes or cancels it,
        // before anything the request emits from then on is handled. Before then it leaves the
        // query alone while an error that may end the batch is being handled and, from msnodesqlv8
        // 3, once the query's reader has stopped
        let detached = false
        let settingAside = false
        let cancelHeld = false
        const detach = () => {
          detached = true
        }
        const reachable = () => !detached && !settingAside && !stopped(req)

        const cancelDriver = (attempt = cancelAttempts) => {
          req.cancelQuery(err => {
            if (err) {
              debug('request(%d): failed to cancel', IDS.get(this), err)
              // msnodesqlv8 < 5.6 refuses to cancel a query that is neither paused nor polling,
              // and the query runs to the end; if it reached the end of a batch meanwhile, a
              // stream that is no longer paused resumes it
              if (!hasReturned && attempt === cancelAttempts) {
                cancelRequested = false
                this._resumeStream()
              }
            }
            // this fixes an issue where paused connections don't emit a done event; a query whose
            // cancel was refused goes on, though it may have paused at the end of a batch since
            try {
              if (!err && req.isPaused()) req.emit('done')
            } catch (err) {
              // do nothing
            }
          })
        }

        // every version of msnodesqlv8 cancels a paused query; it is paused here only where it stops
        // for a pause, with nothing of its own under way
        const pauseAndCancelDriver = () => {
          cancelDeferred = false
          // msnodesqlv8 5.0 to 5.5 send a query one cancel, which a cancel made before the query
          // started has used up and they refused, so the query runs on
          if (typeof req.getCancelSent === 'function' && req.getCancelSent()) {
            cancelRequested = false
            return false
          }
          driverPaused = true
          req.pauseQuery()
          cancelDriver()
          return true
        }

        // msnodesqlv8 6 ends a cancelled query only if it was paused when the cancel went out, or is
        // never paused after it: one paused after its cancel is held for good, and holds its
        // connection. So once a cancel has gone out, and until it is refused, the query is not paused
        const cancelSent = () => cancelRequested && typeof req.getCancelSent === 'function' && req.getCancelSent()

        // called with each row once it is complete
        const pauseDriverAtEndOfBatch = () => {
          if (driverPaused || rowsInRecordset % DRIVER_ROW_BATCH_SIZE !== 0) return
          if (cancelDeferred && pauseAndCancelDriver()) return
          if (this.stream && this.paused && !cancelSent()) {
            driverPaused = true
            req.pauseQuery()
          }
        }

        // until the first result set the driver has read nothing, so a stream paused before then,
        // or before its query starts, holds it back at once
        this._pauseStream = () => {
          if (!columns && !driverPaused && !finished && !cancelSent() && reachable()) {
            driverPaused = true
            req.pauseQuery()
          }
        }
        if (this.stream && this.paused) this._pauseStream()

        this._resumeStream = () => {
          // a listener that resumes the stream while it is emitting what was waiting leaves the
          // rest to this loop, so that every listener gets the events in order
          if (resuming) return
          resuming = true
          try {
            while (pending.length && !this.paused) {
              pending.shift().emit()
            }
          } finally {
            resuming = false
          }
          // cancelled while it emitted what was waiting after the query ended, and then paused, a
          // stream completes as cancelled straight away, as it does when it is paused first
          if (finished && cancelRequested && this.paused && pending.length) emitPendingOnCancel()
          // a query that is being cancelled stays paused, so that the cancel can go through
          if (!pending.length && !this.paused && driverPaused && !finished && !cancelRequested && reachable()) {
            driverPaused = false
            req.resumeQuery()
          }
        }

        const cancel = () => {
          debug('request(%d): cancel', IDS.get(this))
          // a query that has ended has nothing to cancel, nor one whose reader has stopped. The
          // cancel is held: it is made if msnodesqlv8 goes on to a result set after all, and once
          // the query is through a paused stream completes as cancelled, without waiting to be
          // resumed
          if (detached || stopped(req) || settingAside) {
            cancelHeld = true
            return
          }
          // newer msnodesqlv8 versions drop a repeat cancel without calling back, so the
          // outcome of the first one stands
          if (cancelDeferred || (typeof req.getCancelSent === 'function' && req.getCancelSent())) {
            return
          }
          cancelRequested = true
          cancelAttempts++
          if (!this.stream || !this.paused || driverPaused) {
            return cancelDriver()
          }
          // A paused stream holds the driver back only once it reaches the end of a batch. Until
          // then the driver goes on reading, and pausing or cancelling it part way through a fetch,
          // or as it moves to the next result set or ends the query, can leave its queue broken.
          // So it is paused and cancelled when it next stops, at the end of a batch or the start
          // of a result set, and a query that ends first, at the latest on the request timeout,
          // is reported as cancelled.
          if (freed) return req.emit('done')
          cancelDeferred = true
        }
        this._cancel = cancel

        req.on('meta', metadata => {
          if (finished) return
          // a query that goes on to a result set has not ended: msnodesqlv8 can give the last error
          // of a statement that fails first more=false, and carry on to the statements after it
          if (detached) {
            detached = false
            if (cancelHeld) {
              cancelHeld = false
              cancel()
            }
            // a stream resumed meanwhile left the query held back. msnodesqlv8 fetches as soon as
            // it is resumed, and again once 'meta' is handled, so the query is resumed a tick
            // later, once it has stopped at the result set
            if (!this.paused && driverPaused && !cancelRequested) setImmediate(this._resumeStream)
          }

          if (row) {
            if (isChunkedRecordset) {
              const concatenatedChunks = chunksBuffer.join('')
              if ((columns[0].name === JSON_COLUMN_ID) && (config.parseJSON === true)) {
                try {
                  if (concatenatedChunks === '') {
                    row = null
                  } else {
                    row = JSON.parse(concatenatedChunks)
                  }
                  if (!this.stream) { recordsets[recordsets.length - 1][0] = row }
                } catch (ex) {
                  row = null
                  const ex2 = new RequestError(`Failed to parse incoming JSON. ${ex.message}`, 'EJSON')

                  if (this.stream) {
                    emitInOrder(false, () => this.emit('error', ex2))
                  } else {
                    console.error(ex2)
                  }
                }
              } else {
                row[columns[0].name] = concatenatedChunks
              }

              chunksBuffer = null
              if (row && row.___return___ == null) {
                // row with ___return___ col is the last row
                const last = row
                if (this.stream) emitInOrder(true, () => this.emit('row', last))
              }
            }
          }

          row = null
          rowsInRecordset = 0
          columns = metadata.map(describeColumn)
          recordset = []

          Object.defineProperty(recordset, 'columns', {
            enumerable: false,
            configurable: true,
            value: createColumns(columns, this.arrayRowMode)
          })

          Object.defineProperty(recordset, 'toTable', {
            enumerable: false,
            configurable: true,
            value (name) { return Table.fromRecordset(this, name) }
          })

          isChunkedRecordset = false
          if ((metadata.length === 1) && (metadata[0].name === JSON_COLUMN_ID || metadata[0].name === XML_COLUMN_ID)) {
            isChunkedRecordset = true
            chunksBuffer = []
          }

          let hasReturnColumn = false
          if (recordset.columns.___return___ != null) {
            hasReturnColumn = true
          } else if (this.arrayRowMode) {
            for (let i = 0; i < columns.length; i++) {
              if (columns[i].name === '___return___') {
                hasReturnColumn = true
                break
              }
            }
          }
          if (this.stream) {
            if (!hasReturnColumn) {
              const recordsetColumns = recordset.columns
              emitInOrder(false, () => this.emit('recordset', recordsetColumns))
            }
          } else {
            recordsets.push(recordset)
          }
          if (this.arrayRowMode) recordsetcolumns.push(recordset.columns)

          // the driver fetches nothing of a result set it is paused at the start of
          if (cancelDeferred) pauseAndCancelDriver()
        })

        req.on('row', rownumber => {
          if (finished) return

          rowsInRecordset++
          if (row && isChunkedRecordset) return

          if (this.arrayRowMode) {
            row = []
          } else {
            row = {}
          }

          if (!this.stream) recordset.push(row)
        })

        req.on('column', (idx, data, more) => {
          if (finished) return

          if (isChunkedRecordset) {
            chunksBuffer.push(data)
          } else {
            data = valueCorrection(data, columns[idx])

            if (this.arrayRowMode) {
              row.push(data)
            } else {
              const exi = row[columns[idx].name]
              if (exi != null) {
                if (exi instanceof Array) {
                  exi.push(data)
                } else {
                  row[columns[idx].name] = [exi, data]
                }
              } else {
                row[columns[idx].name] = data
              }
            }
            let hasReturnColumn = false
            if (row && row.___return___ != null) {
              hasReturnColumn = true
            } else if (this.arrayRowMode) {
              for (let i = 0; i < columns.length; i++) {
                if (columns[i].name === '___return___') {
                  hasReturnColumn = true
                  break
                }
              }
            }
            if (!hasReturnColumn) {
              if (this.stream && idx === columns.length - 1) {
                const complete = row
                emitInOrder(true, () => this.emit('row', complete))
              }
            }
          }

          if (idx === columns.length - 1) pauseDriverAtEndOfBatch()
        })

        req.on('rowcount', rowCount => {
          if (finished) return

          rowsAffected.push(rowCount)
          if (this.stream) {
            emitInOrder(false, () => this.emit('rowsaffected', rowCount))
          }
        })

        req.on('info', (msg, more) => {
          if (finished) return

          msg.message = stripOdbcPrefix(msg.message)

          const info = {
            message: msg.message,
            number: msg.code,
            state: msg.sqlstate,
            class: msg.class || 0,
            lineNumber: msg.lineNumber || 0,
            serverName: msg.serverName,
            procName: msg.procName
          }
          emitInOrder(false, () => this.emit('info', info))

          // query terminated
          if (msg.code === 3621 && !hasReturned) {
            if (failing && !more) {
              // msnodesqlv8 2.0 ends a statement's error with more=true and this message, and then
              // nothing follows: the error just collected is the one that terminated the statement.
              // A stream has already emitted it
              detach()
              if (!this.stream) {
                const error = errors.pop()
                handleError(req, connection, error.originalError || error, false)
              }
            } else if (!terminated) {
              // msnodesqlv8 >= 5.6 emits a failed statement's info messages ahead of its error, and
              // carries on after it, so any error collected so far is an earlier statement's. The
              // error still to come, or 'done', settles the request; 'done' falls back to this
              terminated = msg
            }
          }
        })

        req.on('error', errorHandlers.error = (info, moreErrors) => {
          // a dead link is recorded even after 'done', so the pool does not lend the connection out again
          if ((typeof info.sqlstate === 'string') && (info.sqlstate.toLowerCase() === '08s01')) {
            connection.hasError = true
          }

          if (!moreErrors) {
            // an error with nothing more to follow ends the batch
            detach()
          } else if (!detached && !settingAside) {
            // the errors that end a batch are emitted together, all but the last with more=true,
            // and msnodesqlv8 >= 5.1 releases the statement as soon as they are, so the query is
            // set aside while they are handled, and a cancel made meanwhile waits until they have
            // been. If none of them ended the batch it is taken up again and, if the stream was
            // paused meanwhile before its first result set, paused, unless it is being cancelled.
            // A stream that is paused holds its events back, so none is resumed meanwhile
            settingAside = true
            queueMicrotask(() => {
              settingAside = false
              if (cancelHeld) {
                cancelHeld = false
                cancel()
              }
              if (!detached && !cancelRequested && this.paused && this._pauseStream) this._pauseStream()
            })
          }

          if (finished) return

          handleError(req, connection, info, moreErrors)
        })

        req.on('free', () => {
          freed = true
          if (cancelDeferred && !finished) {
            cancelDeferred = false
            req.emit('done')
          }
        })

        // msnodesqlv8 emits 'done' when a batch completes, but not when an error ends it; either
        // way it emits 'free' once it has released the statement. A stream reports its errors as
        // they arrive rather than settling on them, so without 'free' it would never complete
        // after such an error, nor give its connection back
        const complete = () => {
          finished = true
          detach()
          if (cancelHeld && this.stream && this.paused) cancelRequested = true

          if (hasReturned) {
            return
          }

          if (cancelRequested) {
            // msnodesqlv8 emits 'done' once a cancel is through: for a paused query in every
            // version, and for a running one from 5.6. What was read up to then is not a result.
            // The error listener stays attached and drops the 'Operation canceled' error that can
            // still arrive after 'done'.
            hasReturned = true
            delete this._cancel
            // released now, as at any 'done', rather than at the statement's later 'free':
            // msnodesqlv8 queues whatever the connection is sent next behind the cancelled
            // statement, and a transaction can carry on as soon as the cancel is reported
            this.parent.release(connection)

            debug('request(%d): canceled', IDS.get(this))

            const err = new RequestError('Canceled.', 'ECANCEL')
            if (this.stream) {
              delete this._resumeStream
              delete this._pauseStream
              emitPendingOnCancel()
              // as with tedious, a cancelled stream reports the cancel as an error and still
              // completes with what was read up to it
              this.emit('error', err)
              return callback(null, null, output, rowsAffected, recordsetcolumns)
            }
            return callback(err)
          }

          if (terminated && !errors.length) {
            // the statement was terminated, but no error followed to say why
            handleError(req, connection, terminated, false)
          } else if (errors.length && !this.stream) {
            // msnodesqlv8 >= 5.6 reports an error that does not end the batch with more=true and
            // carries on to 'done', so the request has failed although no error said it was the last
            const error = errors.pop()
            handleError(req, connection, error.originalError || error, false)
          }

          if (hasReturned) {
            return
          }

          hasReturned = true

          if (!this._nested) {
            if (row) {
              if (isChunkedRecordset) {
                const concatenatedChunks = chunksBuffer.join('')
                if ((columns[0].name === JSON_COLUMN_ID) && (config.parseJSON === true)) {
                  try {
                    if (concatenatedChunks === '') {
                      row = null
                    } else {
                      row = JSON.parse(concatenatedChunks)
                    }
                    if (!this.stream) { recordsets[recordsets.length - 1][0] = row }
                  } catch (ex) {
                    row = null
                    const ex2 = new RequestError(`Failed to parse incoming JSON. ${ex.message}`, 'EJSON')

                    if (this.stream) {
                      emitInOrder(false, () => this.emit('error', ex2))
                    } else {
                      console.error(ex2)
                    }
                  }
                } else {
                  row[columns[0].name] = concatenatedChunks
                }

                chunksBuffer = null
                if (row && row.___return___ == null) {
                  // row with ___return___ col is the last row
                  const last = row
                  if (this.stream) emitInOrder(true, () => this.emit('row', last))
                }
              }
            }

            // do we have output parameters to handle?
            if (handleOutput && recordsets.length) {
              const last = recordsets.pop()[0]

              for (const name in this.parameters) {
                if (!objectHasProperty(this.parameters, name)) {
                  continue
                }
                const param = this.parameters[name]
                if (param.io === 2) {
                  output[param.name] = last[param.name]
                }
              }
            }
          }

          this.parent.release(connection)

          debug('request(%d): completed', IDS.get(this))

          if (this.stream) {
            // the driver is through, but a paused stream completes once it has emitted what is
            // still waiting. Cancelled before then, it completes as cancelled: at once if it is
            // paused, dropping its rows, or else once it has emitted the rest
            this._cancel = () => {
              cancelRequested = true
              if (this.paused) emitPendingOnCancel()
            }
            const last = this._nested ? row : null
            emitInOrder(false, () => {
              delete this._cancel
              delete this._resumeStream
              delete this._pauseStream
              if (cancelRequested) {
                debug('request(%d): canceled', IDS.get(this))
                this.emit('error', new RequestError('Canceled.', 'ECANCEL'))
                return callback(null, null, output, rowsAffected, recordsetcolumns)
              }
              callback(null, last, output, rowsAffected, recordsetcolumns)
            })
          } else {
            delete this._cancel
            callback(null, recordsets, output, rowsAffected, recordsetcolumns)
          }
        }

        req.once('done', complete)
        req.once('free', complete)
      })
    })
  }

  _execute (procedure, callback) {
    super._execute(procedure, err => {
      if (err) return callback(err)

      const params = []
      let procedureName
      try {
        // this is built into `exec @___return___ = <name>` below and run as SQL text, so it is
        // checked before it is emitted
        procedureName = assertSafeProcedureName(procedure)
        for (const name in this.parameters) {
          if (!objectHasProperty(this.parameters, name)) {
            continue
          }
          const param = this.parameters[name]
          if (param.io === 2) {
            // this callback is dispatched on its own tick, so a rejected declaration has
            // to be handed back rather than thrown
            params.push(`@${param.name} ${declare(param.type, param)}`)
          } else {
            // An input parameter is bound rather than written into the command, so only an
            // output parameter's size is declared here and nothing would otherwise check an
            // input's. It is checked so that a size is accepted or rejected the same way
            // whichever driver is in use.
            assertSafeTypeSize(param.length)
            assertSafeTypeSize(param.precision)
            assertSafeTypeSize(param.scale)
          }
        }
      } catch (e) {
        return callback(new RequestError(e, 'EREQUEST'))
      }

      // the parameters in the order their markers are written: output initial values are set
      // before the call and inputs are passed to it, whatever order they were declared in
      const bound = []

      // set output params w/ values
      const sets = []
      for (const name in this.parameters) {
        if (!objectHasProperty(this.parameters, name)) {
          continue
        }
        const param = this.parameters[name]
        if (param.io === 2 && param.value != null) {
          sets.push(`set @${param.name}=?`)
          bound.push(param)
        }
      }

      let cmd = `declare ${['@___return___ int'].concat(params).join(', ')};${sets.join(';')};`
      cmd += `exec @___return___ = ${procedureName} `

      const spp = []
      for (const name in this.parameters) {
        if (!objectHasProperty(this.parameters, name)) {
          continue
        }
        const param = this.parameters[name]

        if (param.io === 2) {
          // output parameter
          spp.push(`@${param.name}=@${param.name} output`)
        } else {
          // input parameter
          spp.push(`@${param.name}=?`)
          bound.push(param)
        }
      }

      const params2 = []
      for (const name in this.parameters) {
        if (!objectHasProperty(this.parameters, name)) {
          continue
        }
        const param = this.parameters[name]
        if (param.io === 2) {
          params2.push(`@${param.name} as '${param.name}'`)
        }
      }

      cmd += `${spp.join(', ')};`
      cmd += `select ${['@___return___ as \'___return___\''].concat(params2).join(', ')};`

      this._nested = true

      this._query(cmd, (err, recordsets, output, rowsAffected, recordsetcolumns) => {
        this._nested = false

        if (err) return callback(err)

        let last, returnValue
        if (this.stream) {
          last = recordsets
        } else {
          last = recordsets.pop()
          if (last) last = last[0]
        }
        const lastColumns = recordsetcolumns.pop()

        if (last && this.arrayRowMode && lastColumns) {
          let returnColumnIdx = null
          const parametersNameToLastIdxDict = {}
          for (let i = 0; i < lastColumns.length; i++) {
            if (lastColumns[i].name === '___return___') {
              returnColumnIdx = i
            } else if (objectHasProperty(this.parameters, lastColumns[i].name)) {
              parametersNameToLastIdxDict[lastColumns[i].name] = i
            }
          }
          if (returnColumnIdx != null) {
            returnValue = last[returnColumnIdx]
          }
          for (const name in parametersNameToLastIdxDict) {
            if (!objectHasProperty(parametersNameToLastIdxDict, name)) {
              continue
            }
            const param = this.parameters[name]
            if (param.io === 2) {
              output[param.name] = last[parametersNameToLastIdxDict[name]]
            }
          }
        } else {
          if (last && (last.___return___ != null)) {
            returnValue = last.___return___

            for (const name in this.parameters) {
              if (!objectHasProperty(this.parameters, name)) {
                continue
              }
              const param = this.parameters[name]
              if (param.io === 2) {
                output[param.name] = last[param.name]
              }
            }
          }
        }
        if (this.stream) {
          callback(null, null, output, returnValue, rowsAffected, recordsetcolumns)
        } else {
          callback(null, recordsets, output, returnValue, rowsAffected, recordsetcolumns)
        }
      }, bound)
    })
  }

  // the query pauses the driver itself, mostly at the end of a batch (see DRIVER_ROW_BATCH_SIZE)
  _pause () {
    super._pause()
    if (this._pauseStream) {
      this._pauseStream()
    }
  }

  _resume () {
    super._resume()
    if (this._resumeStream) {
      this._resumeStream()
    }
  }
}

module.exports = Request

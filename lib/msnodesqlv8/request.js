'use strict'

const msnodesql = require('msnodesqlv8')
const debug = require('debug')('mssql:msv8')
const BaseRequest = require('../base/request')
const RequestError = require('../error/request-error')
const { IDS, objectHasProperty, assertSafeColumnName, assertSafeTypeName, assertSafeTypeSize, assertSafeProcedureName } = require('../utils')
const { TYPES, DECLARATIONS, declare } = require('../datatypes')
const { PARSERS: UDT } = require('../udt')
const Table = require('../table')
const { valueHandler } = require('../shared')

const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B'
const EMPTY_BUFFER = Buffer.alloc(0)

// String() converts a Symbol, which only fails to convert implicitly; an object without a
// working toString falls back to its tag
const thrownMessage = function (value) {
  try {
    return String(value)
  } catch (e) {
    return Object.prototype.toString.call(value)
  }
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
      nullable: column.nullable
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
  } else if (typeof value === 'string' && numericStringSqlTypes.has(metadata.sqlType)) {
    return Number(value)
  } else if (typeof value === 'string' && metadata.sqlType === 'sql_variant' && value !== '' && !isNaN(Number(value))) {
    return Number(value)
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

            if (err) {
              callback(err)
            } else {
              callback(null, table.rows.length)
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

            return connection.queryRaw(statement, function (err) {
              if (err) { return done(err) }
              go()
            })
          } else {
            go()
          }
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
      // 'done' ends the request. msnodesqlv8 >= 5.6 emits it as soon as a cancel is through, and
      // the query can go on emitting after it, so the listeners ignore anything that follows
      let finished = false

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
          this.emit('error', err)
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

        const req = connection.queryRaw({
          query_str: command,
          query_timeout: (this.overrides.requestTimeout ?? config.requestTimeout) / 1000 // msnodesqlv8 timeouts are in seconds (<1 second not supported)
        }, params)

        this._setCurrentRequest(req)

        this._cancel = () => {
          debug('request(%d): cancel', IDS.get(this))
          // newer msnodesqlv8 versions drop a repeat cancel without calling back, so the
          // outcome of the first one stands
          if (typeof req.getCancelSent === 'function' && req.getCancelSent()) {
            return
          }
          cancelRequested = true
          req.cancelQuery(err => {
            if (err) {
              debug('request(%d): failed to cancel', IDS.get(this), err)
              // msnodesqlv8 < 5.6 refuses to cancel a query that is neither paused nor polling,
              // and the query runs to the end
              if (!hasReturned) cancelRequested = false
            }
            // this fixes an issue where paused connections don't emit a done event
            try {
              if (req.isPaused()) req.emit('done')
            } catch (err) {
              // do nothing
            }
          })
        }

        req.on('meta', metadata => {
          if (finished) return

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
                    this.emit('error', ex2)
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
                if (this.stream && !this.paused) this.emit('row', row)
              }
            }
          }

          row = null
          columns = metadata
          recordset = []

          Object.defineProperty(recordset, 'columns', {
            enumerable: false,
            configurable: true,
            value: createColumns(metadata, this.arrayRowMode)
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
              this.emit('recordset', recordset.columns)
            }
          } else {
            recordsets.push(recordset)
          }
          if (this.arrayRowMode) recordsetcolumns.push(recordset.columns)
        })

        req.on('row', rownumber => {
          if (finished || (row && isChunkedRecordset)) return

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
              if (this.stream && !this.paused && idx === columns.length - 1) {
                this.emit('row', row)
              }
            }
          }
        })

        req.on('rowcount', rowCount => {
          if (finished) return

          rowsAffected.push(rowCount)
          if (this.stream) {
            this.emit('rowsaffected', rowCount)
          }
        })

        req.on('info', (msg, more) => {
          if (finished) return

          const parsedMessage = (/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(msg.message)
          if (parsedMessage) {
            msg.message = parsedMessage[1]
          }

          this.emit('info', {
            message: msg.message,
            number: msg.code,
            state: msg.sqlstate,
            class: msg.class || 0,
            lineNumber: msg.lineNumber || 0,
            serverName: msg.serverName,
            procName: msg.procName
          })

          // query terminated
          if (msg.code === 3621 && !hasReturned) {
            if (failing && !more) {
              // msnodesqlv8 2.0 ends a statement's error with more=true and this message, and then
              // nothing follows: the error just collected is the one that terminated the statement.
              // A stream has already emitted it
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

          if (finished) return

          handleError(req, connection, info, moreErrors)
        })

        req.once('done', () => {
          finished = true

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
                      this.emit('error', ex2)
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
                  if (this.stream && !this.paused) { this.emit('row', row) }
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

          delete this._cancel
          this.parent.release(connection)

          debug('request(%d): completed', IDS.get(this))

          if (this.stream) {
            callback(null, this._nested ? row : null, output, rowsAffected, recordsetcolumns)
          } else {
            callback(null, recordsets, output, rowsAffected, recordsetcolumns)
          }
        })
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

  _pause () {
    super._pause()
    if (this._currentRequest) {
      this._currentRequest.pauseQuery()
    }
  }

  _resume () {
    super._resume()
    if (this._currentRequest) {
      this._currentRequest.resumeQuery()
    }
  }
}

module.exports = Request

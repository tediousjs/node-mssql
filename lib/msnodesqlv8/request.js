'use strict'

const msnodesql = require('msnodesqlv8')
const debug = require('debug')('mssql:msv8')
const BaseRequest = require('../base/request')
const RequestError = require('../error/request-error')
const MSSQLError = require('../error/mssql-error')
const { IDS, objectHasProperty, isValidParameterName, assertSafeColumnName, assertSafeTypeName, assertSafeTypeSize, assertSafeProcedureName } = require('../utils')
const { TYPES, DECLARATIONS, declare } = require('../datatypes')
const { PARSERS: UDT } = require('../udt')
const Table = require('../table')
const { valueHandler } = require('../shared')

const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B'
const EMPTY_BUFFER = Buffer.alloc(0)

// msnodesqlv8 bulk loads through its table manager, which looks the table up by writing the
// name it is given into the text of a query of its own, splitting it on every `.` to do so.
// The last part, the table, and the one before it, the schema, are written inside quoted
// strings, which only a `'` can end, and a doubled one is how a string holds it. The part
// before the schema is the database, which is written bare, as an identifier, and also inside
// one of those strings. Any part before the database is held to the same rule, although the
// table manager drops it. The name of a table in tempdb is also written bare, whole, as the
// target of the INSERT that the table manager builds once it has found the table. A bare part
// may hold the characters a parameter name may (see lib/utils.js): those that cannot end an
// identifier.
const isBarePart = part => isValidParameterName(part)
// The database, and each part of the name of a table in tempdb, may also have space around it,
// which is read as space between words, or be in double quotes. In double quotes it is a quoted
// identifier, which only a `"` can end, or, with QUOTED_IDENTIFIER off, a string where no string
// is allowed, so the query does not compile and nothing in it runs. Neither form may hold a `'`.
// The database is also written inside a string, which a `'` would end, and in the INSERT a `'`
// would start one. The server reads NEL and ZERO WIDTH SPACE as space too, but `\s` does not
// match them.
const PADDING = /^[\s\u0085\u200b]+|[\s\u0085\u200b]+$/g
const isDatabasePart = part => {
  const trimmed = part.replace(PADDING, '')
  return isBarePart(trimmed) || /^"[^"']+"$/.test(trimmed)
}
const endsQuotedString = part => part.replace(/''/g, '').includes('\'')
// The table manager puts each part into its query with String.prototype.replace. That reads $`
// in the part as the text of the query before the placeholder, $' as the text after it, and $&
// as the placeholder. A name that holds one of these does not name the table it seems to. The
// text it copies brings the quotes of the query with it, so these are rejected in every part.
const COPIES_QUERY = /\$[`'&]/

// Takes the name the table manager is to be given, and returns what was read, so the name it
// is given is the one that was checked.
const assertSafeBulkTable = (name) => {
  const table = String(name)
  const parts = table.split('.')
  if (parts[parts.length - 1].charAt(0) === '#') {
    if (!parts.every(isBarePart)) {
      throw new MSSQLError(`Invalid table name '${table}'. msnodesqlv8 writes the name of a temporary table unquoted, so it may only contain identifier characters.`, 'EINJECT')
    }
  } else if (!parts.slice(0, -2).every(isDatabasePart)) {
    throw new MSSQLError(`Invalid table name '${table}'. msnodesqlv8 writes the database name unquoted, so it may only contain identifier characters, or be in double quotes and contain no '.`, 'EINJECT')
  } else if (parts.slice(-2).some(endsQuotedString)) {
    throw new MSSQLError(`Invalid table name '${table}'. msnodesqlv8 writes the table and schema names into a quoted string, which a ' would end.`, 'EINJECT')
  } else if (COPIES_QUERY.test(table)) {
    throw new MSSQLError(`Invalid table name '${table}'. msnodesqlv8 replaces $\`, $' and $& in a table name with parts of its own query.`, 'EINJECT')
  }
  return table
}

// Checked once the table manager has found the table, against what it found, since that is
// what it builds its INSERT from. A table in tempdb is written as the name it was given, so
// each part of that name is held to the database rule above. The connection's own database
// can be tempdb, so the name need not say so. Any other table is written as
// `[database].[schema].[table]`, from the names the server reported, and each column it writes
// to as `[name]`. In both, any `]` in a name is left as it is. The columns it writes to are
// those it does not count as read only. A driver without `isReadOnly()` on its columns, such
// as 2.0.0, counts these flags instead.
const isReadOnlyColumn = col => typeof col.isReadOnly === 'function'
  ? col.isReadOnly()
  : (col.is_identity || col.is_computed || col.is_hidden || col.generated_always_type)

const assertSafeBulkInsert = (table, columns) => {
  if (columns[0].table_catalog === 'tempdb' && !table.split('.').every(isDatabasePart)) {
    throw new MSSQLError(`Invalid table name '${table}'. msnodesqlv8 writes the name of a table in tempdb unquoted, so each part may only contain identifier characters, or be in double quotes and contain no '.`, 'EINJECT')
  }
  if (columns[0].table_catalog !== 'tempdb' && ['table_catalog', 'table_schema', 'table_name'].some(k => String(columns[0][k]).includes(']'))) {
    throw new MSSQLError(`Invalid table name '${columns[0].table_catalog}.${columns[0].table_schema}.${columns[0].table_name}'. msnodesqlv8 cannot bulk load into a table whose name contains ']'.`, 'EINJECT')
  }
  for (const col of columns) {
    if (!isReadOnlyColumn(col) && String(col.name).includes(']')) {
      throw new MSSQLError(`Invalid column name '${col.name}'. msnodesqlv8 cannot bulk load into a column whose name contains ']'.`, 'EINJECT')
    }
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
    case TYPES.NText:
      if ((typeof value !== 'string') && !(value instanceof String)) {
        value = value.toString()
      }
      break

    case TYPES.Int:
    case TYPES.TinyInt:
    case TYPES.BigInt:
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

      // The table manager is given the path with its brackets removed, as before, and it is
      // given the string that is checked here. The check is made before a connection is
      // borrowed, and on the path rather than where the table is built, because `path` is a
      // plain property that can be changed after the table is built.
      let target
      try {
        target = assertSafeBulkTable(table.path.replace(/\[|\]/g, ''))
      } catch (e) {
        return callback(new RequestError(e, 'EREQUEST'))
      }

      this.parent.acquire(this, (err, connection) => {
        let hasReturned = false
        if (!err) {
          debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

          if (this.canceled) {
            debug('request(%d): canceled', IDS.get(this))
            this.parent.release(connection)
            return callback(new RequestError('Canceled.', 'ECANCEL'))
          }

          const done = (err, rowCount) => {
            if (hasReturned) {
              return
            }

            hasReturned = true

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
            return tm.bind(target, (mgr, err) => {
              if (err) {
                return done(err)
              }

              if (mgr.columns.length === 0) {
                return done(new RequestError('Table was not found on the server.', 'ENAME'))
              }

              const rows = []
              try {
                assertSafeBulkInsert(target, mgr.columns)

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
              statement = `if object_id('${objectid.replace(/'/g, '\'\'')}') is null ${table.declare()}`
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

  _query (command, callback) {
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

      const handleError = (req, connection, info, moreErrors) => {
        const doReturn = !moreErrors
        if ((typeof info.sqlstate === 'string') && (info.sqlstate.toLowerCase() === '08s01')) {
          connection.hasError = true
        }

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

            let previous
            if (errors.length) {
              previous = errors.pop()
              if (!err.precedingErrors) {
                err.precedingErrors = []
              }
              err.precedingErrors.push(previous)
            }

            hasReturned = true
            callback(err)
          }
        }

        // we must collect errors even in stream mode
        errors.push(err)
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
          if (param.io === 1) {
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

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

        if (this.canceled) {
          debug('request(%d): canceled', IDS.get(this))
          this.parent.release(connection)
          return callback(new RequestError('Canceled.', 'ECANCEL'))
        }

        const params = []
        for (const name in this.parameters) {
          if (!objectHasProperty(this.parameters, name)) {
            continue
          }
          const param = this.parameters[name]
          if (param.io === 1 || (param.io === 2 && param.value)) {
            params.push(castParameter(param.value, param.type))
          }
        }

        debug('request(%d): query', IDS.get(this), command)

        const req = connection.queryRaw({
          query_str: command,
          query_timeout: config.requestTimeout / 1000 // msnodesqlv8 timeouts are in seconds (<1 second not supported)
        }, params)

        this._setCurrentRequest(req)

        this._cancel = () => {
          debug('request(%d): cancel', IDS.get(this))
          req.cancelQuery(err => {
            if (err) debug('request(%d): failed to cancel', IDS.get(this), err)
            // this fixes an issue where paused connections don't emit a done event
            try {
              if (req.isPaused()) req.emit('done')
            } catch (err) {
              // do nothing
            }
          })
        }

        req.on('meta', metadata => {
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
          if (row && isChunkedRecordset) return

          if (this.arrayRowMode) {
            row = []
          } else {
            row = {}
          }

          if (!this.stream) recordset.push(row)
        })

        req.on('column', (idx, data, more) => {
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
          rowsAffected.push(rowCount)
          if (this.stream) {
            this.emit('rowsaffected', rowCount)
          }
        })

        req.on('info', msg => {
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
            // if the query has been terminated it's probably best to throw the last meaningful error if there was one
            // pop it off the errors array so it doesn't get put in twice
            const error = errors.length > 0 ? errors.pop() : msg
            handleError(req, connection, error.originalError || error, false)
          }
        })

        req.on('error', errorHandlers.error = handleError.bind(null, req, connection))

        req.once('done', () => {
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

      // set output params w/ values
      const sets = []
      for (const name in this.parameters) {
        if (!objectHasProperty(this.parameters, name)) {
          continue
        }
        const param = this.parameters[name]
        if (param.io === 2 && param.value) {
          sets.push(`set @${param.name}=?`)
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
      })
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

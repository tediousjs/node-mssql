'use strict'

const msnodesql = require('msnodesqlv8')
const debug = require('debug')('mssql:msv8')
const BaseRequest = require('../base/request')
const RequestError = require('../error/request-error')
const { IDS, objectHasProperty } = require('../utils')
const { TYPES, DECLARATIONS, declare } = require('../datatypes')
const { PARSERS: UDT } = require('../udt')
const Table = require('../table')

const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B'
const EMPTY_BUFFER = Buffer.alloc(0)

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

const createColumns = function (metadata) {
  const out = {}
  for (let index = 0, length = metadata.length; index < length; index++) {
    const column = metadata[index]
    out[column.name] = {
      index,
      name: column.name,
      length: column.size,
      type: DECLARATIONS[column.sqlType],
      nullable: column.nullable
    }

    if (column.udtType != null) {
      out[column.name].udt = {
        name: column.udtType
      }

      if (DECLARATIONS[column.udtType]) {
        out[column.name].type = DECLARATIONS[column.udtType]
      }
    }
  }

  return out
}

const valueCorrection = function (value, metadata) {
  if ((metadata.sqlType === 'time') && (value != null)) {
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

      table._makeBulk()

      if (!table.name) {
        setImmediate(callback, new RequestError('Table name must be specified for bulk insert.', 'ENAME'))
      }

      if (table.name.charAt(0) === '@') {
        setImmediate(callback, new RequestError("You can't use table variables for bulk insert.", 'ENAME'))
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

              err = new RequestError(err)
              err.code = 'EREQUEST'
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
            return tm.bind(table.path.replace(/\[|\]/g, ''), mgr => {
              if (mgr.columns.length === 0) {
                return done(new RequestError('Table was not found on the server.', 'ENAME'))
              }

              const rows = []
              for (const row of Array.from(table.rows)) {
                const item = {}
                for (let index = 0; index < table.columns.length; index++) {
                  const col = table.columns[index]
                  item[col.name] = row[index]
                }

                rows.push(item)
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

            return connection.queryRaw(`if object_id('${objectid.replace(/'/g, '\'\'')}') is null ${table.declare()}`, function (err) {
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
        err.state = info.sqlstate

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
        for (const name in this.parameters) {
          if (!objectHasProperty(this.parameters, name)) {
            continue
          }
          const param = this.parameters[name]
          input.push(`@${param.name} ${declare(param.type, param)}`)
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
          if (param.io === 1) {
            params.push(castParameter(param.value, param.type, param))
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
            }

            if (row && row.___return___ == null) {
              // row with ___return___ col is the last row
              if (this.stream && !this.paused) this.emit('row', row)
            }
          }

          row = null
          columns = metadata
          recordset = []

          Object.defineProperty(recordset, 'columns', {
            enumerable: false,
            configurable: true,
            value: createColumns(metadata)
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

          if (this.stream) {
            if (recordset.columns.___return___ == null) {
              this.emit('recordset', recordset.columns)
            }
          } else {
            recordsets.push(recordset)
          }
        })

        req.on('row', rownumber => {
          if (row) {
            if (isChunkedRecordset) return

            if (row.___return___ == null) {
              // row with ___return___ col is the last row
              if (this.stream && !this.paused) this.emit('row', row)
            }
          }

          row = {}

          if (!this.stream) recordset.push(row)
        })

        req.on('column', (idx, data, more) => {
          if (isChunkedRecordset) {
            chunksBuffer.push(data)
          } else {
            data = valueCorrection(data, columns[idx])

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
        })

        req.on('rowcount', count => {
          rowsAffected.push(count)
        })

        req.on('info', msg => {
          if ((/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(msg.message)) {
            msg.message = RegExp.$1
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
              }

              if (row && row.___return___ == null) {
                // row with ___return___ col is the last row
                if (this.stream && !this.paused) { this.emit('row', row) }
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
            callback(null, this._nested ? row : null, output, rowsAffected)
          } else {
            callback(null, recordsets, output, rowsAffected)
          }
        })
      })
    })
  }

  _execute (procedure, callback) {
    super._execute(procedure, err => {
      if (err) return callback(err)

      const params = []
      for (const name in this.parameters) {
        if (!objectHasProperty(this.parameters, name)) {
          continue
        }
        const param = this.parameters[name]
        if (param.io === 2) {
          params.push(`@${param.name} ${declare(param.type, param)}`)
        }
      }

      let cmd = `declare ${['@___return___ int'].concat(params).join(', ')};`
      cmd += `exec @___return___ = ${procedure} `

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

      this._query(cmd, (err, recordsets, output, rowsAffected) => {
        this._nested = false

        if (err) return callback(err)

        let last, returnValue
        if (this.stream) {
          last = recordsets
        } else {
          last = recordsets.pop()
          if (last) last = last[0]
        }

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

        if (this.stream) {
          callback(null, null, output, returnValue, rowsAffected)
        } else {
          callback(null, recordsets, output, returnValue, rowsAffected)
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

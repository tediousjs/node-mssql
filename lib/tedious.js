'use strict'

const tds = require('tedious')
const debug = require('debug')('mssql:tedi')

const base = require('./base')
const TYPES = require('./datatypes').TYPES
const declare = require('./datatypes').declare
const cast = require('./datatypes').cast
const DECLARATIONS = require('./datatypes').DECLARATIONS
const UDT = require('./udt').PARSERS
const Table = require('./table')
const IDS = require('./utils').IDS

const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B'
const N_TYPES = {
  BitN: 0x68,
  DateTimeN: 0x6F,
  DecimalN: 0x6A,
  FloatN: 0x6D,
  IntN: 0x26,
  MoneyN: 0x6E,
  NumericN: 0x6C
}

const getTediousType = function (type) {
  switch (type) {
    case TYPES.VarChar: return tds.TYPES.VarChar
    case TYPES.NVarChar: return tds.TYPES.NVarChar
    case TYPES.Text: return tds.TYPES.Text
    case TYPES.Int: return tds.TYPES.Int
    case TYPES.BigInt: return tds.TYPES.BigInt
    case TYPES.TinyInt: return tds.TYPES.TinyInt
    case TYPES.SmallInt: return tds.TYPES.SmallInt
    case TYPES.Bit: return tds.TYPES.Bit
    case TYPES.Float: return tds.TYPES.Float
    case TYPES.Decimal: return tds.TYPES.Decimal
    case TYPES.Numeric: return tds.TYPES.Numeric
    case TYPES.Real: return tds.TYPES.Real
    case TYPES.Money: return tds.TYPES.Money
    case TYPES.SmallMoney: return tds.TYPES.SmallMoney
    case TYPES.Time: return tds.TYPES.Time
    case TYPES.Date: return tds.TYPES.Date
    case TYPES.DateTime: return tds.TYPES.DateTime
    case TYPES.DateTime2: return tds.TYPES.DateTime2
    case TYPES.DateTimeOffset: return tds.TYPES.DateTimeOffset
    case TYPES.SmallDateTime: return tds.TYPES.SmallDateTime
    case TYPES.UniqueIdentifier: return tds.TYPES.UniqueIdentifier
    case TYPES.Xml: return tds.TYPES.NVarChar
    case TYPES.Char: return tds.TYPES.Char
    case TYPES.NChar: return tds.TYPES.NChar
    case TYPES.NText: return tds.TYPES.NVarChar
    case TYPES.Image: return tds.TYPES.Image
    case TYPES.Binary: return tds.TYPES.Binary
    case TYPES.VarBinary: return tds.TYPES.VarBinary
    case TYPES.UDT: case TYPES.Geography: case TYPES.Geometry: return tds.TYPES.UDT
    case TYPES.TVP: return tds.TYPES.TVP
    case TYPES.Variant: return tds.TYPES.Variant
    default: return type
  }
}

const getMssqlType = function (type, length) {
  if (typeof type !== 'object') return undefined

  switch (type) {
    case tds.TYPES.Char: return TYPES.Char
    case tds.TYPES.NChar: return TYPES.NChar
    case tds.TYPES.VarChar: return TYPES.VarChar
    case tds.TYPES.NVarChar: return TYPES.NVarChar
    case tds.TYPES.Text: return TYPES.Text
    case tds.TYPES.NText: return TYPES.NText
    case tds.TYPES.Int: return TYPES.Int
    case tds.TYPES.BigInt: return TYPES.BigInt
    case tds.TYPES.TinyInt: return TYPES.TinyInt
    case tds.TYPES.SmallInt: return TYPES.SmallInt
    case tds.TYPES.Bit: return TYPES.Bit
    case tds.TYPES.Float: return TYPES.Float
    case tds.TYPES.Real: return TYPES.Real
    case tds.TYPES.Money: return TYPES.Money
    case tds.TYPES.SmallMoney: return TYPES.SmallMoney
    case tds.TYPES.Numeric: return TYPES.Numeric
    case tds.TYPES.Decimal: return TYPES.Decimal
    case tds.TYPES.DateTime: return TYPES.DateTime
    case tds.TYPES.Time: return TYPES.Time
    case tds.TYPES.Date: return TYPES.Date
    case tds.TYPES.DateTime2: return TYPES.DateTime2
    case tds.TYPES.DateTimeOffset: return TYPES.DateTimeOffset
    case tds.TYPES.SmallDateTime: return TYPES.SmallDateTime
    case tds.TYPES.UniqueIdentifier: return TYPES.UniqueIdentifier
    case tds.TYPES.Image: return TYPES.Image
    case tds.TYPES.Binary: return TYPES.Binary
    case tds.TYPES.VarBinary: return TYPES.VarBinary
    case tds.TYPES.Xml: return TYPES.Xml
    case tds.TYPES.UDT: return TYPES.UDT
    case tds.TYPES.TVP: return TYPES.TVP
    case tds.TYPES.Variant: return TYPES.Variant
    default:
      switch (type.id) {
        case N_TYPES.BitN: return TYPES.Bit
        case N_TYPES.NumericN: return TYPES.Numeric
        case N_TYPES.DecimalN: return TYPES.Decimal
        case N_TYPES.IntN:
          if (length === 8) return TYPES.BigInt
          if (length === 4) return TYPES.Int
          if (length === 2) return TYPES.SmallInt
          return TYPES.TinyInt
        case N_TYPES.FloatN:
          if (length === 8) return TYPES.Float
          return TYPES.Real
        case N_TYPES.MoneyN:
          if (length === 8) return TYPES.Money
          return TYPES.SmallMoney
        case N_TYPES.DateTimeN:
          if (length === 8) return TYPES.DateTime
          return TYPES.SmallDateTime
      }
  }
}

const createColumns = function (metadata) {
  let out = {}
  for (let index = 0, length = metadata.length; index < length; index++) {
    let column = metadata[index]
    out[column.colName] = {
      index,
      name: column.colName,
      length: column.dataLength,
      type: getMssqlType(column.type, column.dataLength),
      scale: column.scale,
      precision: column.precision,
      nullable: !!(column.flags & 0x01),
      caseSensitive: !!(column.flags & 0x02),
      identity: !!(column.flags & 0x10),
      readOnly: !(column.flags & 0x0C)
    }

    if (column.udtInfo) {
      out[column.colName].udt = {
        name: column.udtInfo.typeName,
        database: column.udtInfo.dbname,
        schema: column.udtInfo.owningSchema,
        assembly: column.udtInfo.assemblyName
      }

      if (DECLARATIONS[column.udtInfo.typeName]) {
        out[column.colName].type = DECLARATIONS[column.udtInfo.typeName]
      }
    }
  }

  return out
}

const valueCorrection = function (value, metadata) {
  if ((metadata.type === tds.TYPES.UDT) && (value != null)) {
    if (UDT[metadata.udtInfo.typeName]) {
      return UDT[metadata.udtInfo.typeName](value)
    } else {
      return value
    }
  } else {
    return value
  }
}

const parameterCorrection = function (value) {
  if (value instanceof Table) {
    const tvp = {
      name: value.name,
      schema: value.schema,
      columns: [],
      rows: value.rows
    }

    for (let col of value.columns) {
      tvp.columns.push({
        name: col.name,
        type: getTediousType(col.type),
        length: col.length,
        scale: col.scale,
        precision: col.precision
      })
    }

    return tvp
  } else {
    return value
  }
}

class ConnectionPool extends base.ConnectionPool {
  _poolCreate () {
    return new base.Promise((resolve, reject) => {
      const cfg = {
        server: this.config.server,
        options: Object.assign({
          encrypt: typeof this.config.encrypt === 'boolean' ? this.config.encrypt : false
        }, this.config.options),
        authentication: Object.assign({
          type: this.config.domain !== undefined ? 'ntlm' : 'default',
          options: {
            userName: this.config.user,
            password: this.config.password,
            domain: this.config.domain
          }
        }, this.config.authentication)
      }

      cfg.options.database = this.config.database
      cfg.options.port = this.config.port
      cfg.options.connectTimeout = this.config.connectionTimeout || this.config.timeout || 15000
      cfg.options.requestTimeout = this.config.requestTimeout != null ? this.config.requestTimeout : 15000
      cfg.options.tdsVersion = cfg.options.tdsVersion || '7_4'
      cfg.options.rowCollectionOnDone = false
      cfg.options.rowCollectionOnRequestCompletion = false
      cfg.options.useColumnNames = false
      cfg.options.appName = cfg.options.appName || 'node-mssql'

      // tedious always connect via tcp when port is specified
      if (cfg.options.instanceName) delete cfg.options.port

      if (isNaN(cfg.options.requestTimeout)) cfg.options.requestTimeout = 15000
      if (cfg.options.requestTimeout === Infinity) cfg.options.requestTimeout = 0
      if (cfg.options.requestTimeout < 0) cfg.options.requestTimeout = 0

      if (this.config.debug) {
        cfg.options.debug = {
          packet: true,
          token: true,
          data: true,
          payload: true
        }
      }

      const tedious = new tds.Connection(cfg)
      IDS.add(tedious, 'Connection')
      debug('pool(%d): connection #%d created', IDS.get(this), IDS.get(tedious))
      debug('connection(%d): establishing', IDS.get(tedious))

      tedious.once('connect', err => {
        if (err) {
          err = new base.ConnectionError(err)
          return reject(err)
        }

        debug('connection(%d): established', IDS.get(tedious))
        resolve(tedious)
      })

      tedious.on('error', err => {
        if (err.code === 'ESOCKET') {
          tedious.hasError = true
          reject(err)
          return
        }

        this.emit('error', err)
        reject(err)
      })

      if (this.config.debug) {
        tedious.on('debug', this.emit.bind(this, 'debug', tedious))
      }
      if (typeof this.config.beforeConnect === 'function') {
        this.config.beforeConnect(tedious)
      }
    })
  }

  _poolValidate (tedious) {
    return new base.Promise((resolve, reject) => {
      resolve(tedious && !tedious.closed && !tedious.hasError)
    })
  }

  _poolDestroy (tedious) {
    return new base.Promise((resolve, reject) => {
      if (!tedious) {
        resolve()
        return
      }
      debug('connection(%d): destroying', IDS.get(tedious))

      if (tedious.closed) {
        debug('connection(%d): already closed', IDS.get(tedious))
        resolve()
      } else {
        tedious.once('end', () => {
          debug('connection(%d): destroyed', IDS.get(tedious))
          resolve()
        })

        tedious.close()
      }
    })
  }
}

class Transaction extends base.Transaction {
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

      debug('transaction(%d): begin', IDS.get(this))

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        this._acquiredConnection = connection
        this._acquiredConnection.on('rollbackTransaction', this._abort)
        this._acquiredConfig = config

        connection.beginTransaction(err => {
          if (err) err = new base.TransactionError(err)

          debug('transaction(%d): begun', IDS.get(this))

          callback(err)
        }, this.name, this.isolationLevel)
      })
    })
  }

  _commit (callback) {
    super._commit(err => {
      if (err) return callback(err)

      debug('transaction(%d): commit', IDS.get(this))

      this._acquiredConnection.commitTransaction(err => {
        if (err) err = new base.TransactionError(err)

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
        if (err) err = new base.TransactionError(err)

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

class Request extends base.Request {
  /*
  Execute specified sql batch.
  */

  _batch (batch, callback) {
    this._isBatch = true
    this._query(batch, callback)
  }

  /*
  Bulk load.
  */

  _bulk (table, options, callback) {
    super._bulk(table, options, err => {
      if (err) return callback(err)

      table._makeBulk()

      if (!table.name) {
        return callback(new base.RequestError('Table name must be specified for bulk insert.', 'ENAME'))
      }

      if (table.name.charAt(0) === '@') {
        return callback(new base.RequestError("You can't use table variables for bulk insert.", 'ENAME'))
      }

      const errors = []
      const errorHandlers = {}
      let hasReturned = false

      const handleError = (doReturn, connection, info) => {
        let err = new Error(info.message)
        err.info = info
        err = new base.RequestError(err, 'EREQUEST')

        if (this.stream) {
          this.emit('error', err)
        } else {
          if (doReturn && !hasReturned) {
            if (connection) {
              for (let event in errorHandlers) {
                connection.removeListener(event, errorHandlers[event])
              }

              this.parent.release(connection)
            }

            hasReturned = true
            callback(err)
          }
        }

        // we must collect errors even in stream mode
        errors.push(err)
      }

      const handleInfo = msg => {
        this.emit('info', {
          message: msg.message,
          number: msg.number,
          state: msg.state,
          class: msg.class,
          lineNumber: msg.lineNumber,
          serverName: msg.serverName,
          procName: msg.procName
        })
      }

      this.parent.acquire(this, (err, connection) => {
        if (err) return callback(err)

        debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

        if (this.canceled) {
          debug('request(%d): canceled', IDS.get(this))
          this.parent.release(connection)
          return callback(new base.RequestError('Canceled.', 'ECANCEL'))
        }

        this._cancel = () => {
          debug('request(%d): cancel', IDS.get(this))
          connection.cancel()
        }

        // attach handler to handle multiple error messages
        connection.on('infoMessage', errorHandlers.infoMessage = handleInfo)
        connection.on('errorMessage', errorHandlers.errorMessage = handleError.bind(null, false, connection))
        connection.on('error', errorHandlers.error = handleError.bind(null, true, connection))

        const done = (err, rowCount) => {
          // to make sure we handle no-sql errors as well
          if (err && (!errors.length || (errors.length && err.message !== errors[errors.length - 1].message))) {
            err = new base.RequestError(err, 'EREQUEST')
            if (this.stream) this.emit('error', err)
            errors.push(err)
          }

          delete this._cancel

          let error
          if (errors.length && !this.stream) {
            error = errors.pop()
            error.precedingErrors = errors
          }

          if (!hasReturned) {
            for (let event in errorHandlers) {
              connection.removeListener(event, errorHandlers[event])
            }

            this.parent.release(connection)
            hasReturned = true

            if (this.stream) {
              callback(null, rowCount)
            } else {
              callback(error, rowCount)
            }
          }
        }

        const bulk = connection.newBulkLoad(table.path, options, done)

        for (let col of table.columns) {
          bulk.addColumn(col.name, getTediousType(col.type), {nullable: col.nullable, length: col.length, scale: col.scale, precision: col.precision})
        }

        for (let row of table.rows) {
          bulk.addRow(row)
        }

        if (table.create) {
          const objectid = table.temporary ? `tempdb..[${table.name}]` : table.path
          const req = new tds.Request(`if object_id('${objectid.replace(/'/g, '\'\'')}') is null ${table.declare()}`, err => {
            if (err) return done(err)

            connection.execBulkLoad(bulk)
          })
          this._setCurrentRequest(req)

          connection.execSqlBatch(req)
        } else {
          connection.execBulkLoad(bulk)
        }
      })
    })
  }

  /*
  Execute specified sql command.
  */

  _query (command, callback) {
    super._query(command, err => {
      if (err) return callback(err)

      const recordsets = []
      const errors = []
      const errorHandlers = {}
      const output = {}
      const rowsAffected = []

      let columns = {}
      let recordset = []
      let batchLastRow = null
      let batchHasOutput = false
      let isChunkedRecordset = false
      let chunksBuffer = null
      let hasReturned = false

      const handleError = (doReturn, connection, info) => {
        let err = new Error(info.message)
        err.info = info
        err = new base.RequestError(err, 'EREQUEST')

        if (this.stream) {
          this.emit('error', err)
        } else {
          if (doReturn && !hasReturned) {
            if (connection) {
              for (let event in errorHandlers) {
                connection.removeListener(event, errorHandlers[event])
              }

              this.parent.release(connection)
            }

            hasReturned = true
            callback(err)
          }
        }

        // we must collect errors even in stream mode
        errors.push(err)
      }

      const handleInfo = msg => {
        this.emit('info', {
          message: msg.message,
          number: msg.number,
          state: msg.state,
          class: msg.class,
          lineNumber: msg.lineNumber,
          serverName: msg.serverName,
          procName: msg.procName
        })
      }

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

        let row

        if (this.canceled) {
          debug('request(%d): canceled', IDS.get(this))
          this.parent.release(connection)
          return callback(new base.RequestError('Canceled.', 'ECANCEL'))
        }

        this._cancel = () => {
          debug('request(%d): cancel', IDS.get(this))
          connection.cancel()
        }

        // attach handler to handle multiple error messages
        connection.on('infoMessage', errorHandlers.infoMessage = handleInfo)
        connection.on('errorMessage', errorHandlers.errorMessage = handleError.bind(null, false, connection))
        connection.on('error', errorHandlers.error = handleError.bind(null, true, connection))

        debug('request(%d): query', IDS.get(this), command)

        const req = new tds.Request(command, err => {
          // to make sure we handle no-sql errors as well
          if (err && (!errors.length || (errors.length && err.message !== errors[errors.length - 1].message))) {
            err = new base.RequestError(err, 'EREQUEST')
            if (this.stream) this.emit('error', err)
            errors.push(err)
          }

          // process batch outputs
          if (batchHasOutput) {
            if (!this.stream) batchLastRow = recordsets.pop()[0]

            for (let name in batchLastRow) {
              let value = batchLastRow[name]
              if (name !== '___return___') {
                output[name] = value
              }
            }
          }

          delete this._cancel

          let error
          if (errors.length && !this.stream) {
            error = errors.pop()
            error.precedingErrors = errors
          }

          if (!hasReturned) {
            for (let event in errorHandlers) {
              connection.removeListener(event, errorHandlers[event])
            }

            this.parent.release(connection)
            hasReturned = true

            if (error) {
              debug('request(%d): failed', IDS.get(this), error)
            } else {
              debug('request(%d): completed', IDS.get(this))
            }

            if (this.stream) {
              callback(null, null, output, rowsAffected)
            } else {
              callback(error, recordsets, output, rowsAffected)
            }
          }
        })

        this._setCurrentRequest(req)

        req.on('columnMetadata', metadata => {
          columns = createColumns(metadata)

          isChunkedRecordset = false
          if (metadata.length === 1 && (metadata[0].colName === JSON_COLUMN_ID || metadata[0].colName === XML_COLUMN_ID)) {
            isChunkedRecordset = true
            chunksBuffer = []
          }

          if (this.stream) {
            if (this._isBatch) {
              // don't stream recordset with output values in batches
              if (!columns.___return___) {
                this.emit('recordset', columns)
              }
            } else {
              this.emit('recordset', columns)
            }
          }
        }
        )

        const doneHandler = (rowCount, more) => {
          if (rowCount != null) rowsAffected.push(rowCount)
          // this function is called even when select only set variables so we should skip adding a new recordset
          if (Object.keys(columns).length === 0) return

          if (isChunkedRecordset) {
            const concatenatedChunks = chunksBuffer.join('')
            if (columns[JSON_COLUMN_ID] && config.parseJSON === true) {
              try {
                if (concatenatedChunks === '') {
                  row = null
                } else {
                  row = JSON.parse(concatenatedChunks)
                }
              } catch (ex) {
                row = null
                const ex2 = new base.RequestError(new Error(`Failed to parse incoming JSON. ${ex.message}`), 'EJSON')

                if (this.stream) this.emit('error', ex2)

                // we must collect errors even in stream mode
                errors.push(ex2)
              }
            } else {
              row = {}
              row[Object.keys(columns)[0]] = concatenatedChunks
            }

            chunksBuffer = null

            if (this.stream) {
              this.emit('row', row)
            } else {
              recordset.push(row)
            }
          }

          if (!this.stream) {
            // all rows of current recordset loaded
            Object.defineProperty(recordset, 'columns', {
              enumerable: false,
              configurable: true,
              value: columns
            })

            Object.defineProperty(recordset, 'toTable', {
              enumerable: false,
              configurable: true,
              value (name) { return Table.fromRecordset(this, name) }
            })

            recordsets.push(recordset)
          }

          recordset = []
          columns = {}
        }

        req.on('doneInProc', doneHandler) // doneInProc handlers are used in both queries and batches
        req.on('done', doneHandler) // done handlers are used in batches

        req.on('returnValue', (parameterName, value, metadata) => {
          output[parameterName] = value
        })

        req.on('row', columns => {
          if (!recordset) recordset = []

          if (isChunkedRecordset) {
            return chunksBuffer.push(columns[0].value)
          }

          row = {}
          for (let col of columns) {
            col.value = valueCorrection(col.value, col.metadata)

            let exi = row[col.metadata.colName]
            if (exi != null) {
              if (exi instanceof Array) {
                exi.push(col.value)
              } else {
                row[col.metadata.colName] = [exi, col.value]
              }
            } else {
              row[col.metadata.colName] = col.value
            }
          }

          if (this.stream) {
            if (this._isBatch) {
              // dont stream recordset with output values in batches
              if (row.___return___) {
                batchLastRow = row
              } else {
                this.emit('row', row)
              }
            } else {
              this.emit('row', row)
            }
          } else {
            recordset.push(row)
          }
        })

        if (this._isBatch) {
          if (Object.keys(this.parameters).length) {
            for (let name in this.parameters) {
              let param = this.parameters[name]
              let value = getTediousType(param.type).validate(param.value)

              if (value instanceof TypeError) {
                value = new base.RequestError(`Validation failed for parameter '${name}'. ${value.message}`, 'EPARAM')

                this.parent.release(connection)
                return callback(value)
              }

              param.value = value
            }

            const declarations = []
            for (let name in this.parameters) {
              let param = this.parameters[name]
              declarations.push(`@${name} ${declare(param.type, param)}`)
            }

            const assigns = []
            for (let name in this.parameters) {
              let param = this.parameters[name]
              assigns.push(`@${name} = ${cast(param.value, param.type, param)}`)
            }

            const selects = []
            for (let name in this.parameters) {
              let param = this.parameters[name]
              if (param.io === 2) {
                selects.push(`@${name} as [${name}]`)
              }
            }

            batchHasOutput = selects.length > 0

            req.sqlTextOrProcedure = `declare ${declarations.join(', ')};select ${assigns.join(', ')};${req.sqlTextOrProcedure};${batchHasOutput ? (`select 1 as [___return___], ${selects.join(', ')}`) : ''}`
          }
        } else {
          for (let name in this.parameters) {
            let param = this.parameters[name]
            if (param.io === 1) {
              req.addParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision})
            } else {
              req.addOutputParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision})
            }
          }
        }

        connection[this._isBatch ? 'execSqlBatch' : 'execSql'](req)
      })
    })
  }

  /*
  Execute stored procedure with specified parameters.
  */

  _execute (procedure, callback) {
    super._execute(procedure, err => {
      if (err) return callback(err)

      const recordsets = []
      const errors = []
      const errorHandlers = {}
      const output = {}
      const rowsAffected = []

      let columns = {}
      let recordset = []
      let returnValue = 0
      let isChunkedRecordset = false
      let chunksBuffer = null
      let hasReturned = false

      const handleError = (doReturn, connection, info) => {
        let err = new Error(info.message)
        err.info = info
        err = new base.RequestError(err, 'EREQUEST')

        if (this.stream) {
          this.emit('error', err)
        } else {
          if (doReturn && !hasReturned) {
            if (connection) {
              for (let event in errorHandlers) {
                connection.removeListener(event, errorHandlers[event])
              }

              this.parent.release(connection)
            }

            hasReturned = true
            callback(err)
          }
        }

        // we must collect errors even in stream mode
        errors.push(err)
      }

      const handleInfo = msg => {
        this.emit('info', {
          message: msg.message,
          number: msg.number,
          state: msg.state,
          class: msg.class,
          lineNumber: msg.lineNumber,
          serverName: msg.serverName,
          procName: msg.procName
        })
      }

      this.parent.acquire(this, (err, connection, config) => {
        if (err) return callback(err)

        debug('connection(%d): borrowed to request #%d', IDS.get(connection), IDS.get(this))

        let row

        if (this.canceled) {
          debug('request(%d): canceled', IDS.get(this))
          this.parent.release(connection)
          return callback(new base.RequestError('Canceled.', 'ECANCEL'))
        }

        this._cancel = () => {
          debug('request(%d): cancel', IDS.get(this))
          connection.cancel()
        }

        // attach handler to handle multiple error messages
        connection.on('infoMessage', errorHandlers.infoMessage = handleInfo)
        connection.on('errorMessage', errorHandlers.errorMessage = handleError.bind(null, false, connection))
        connection.on('error', errorHandlers.error = handleError.bind(null, true, connection))

        debug('request(%d): execute', IDS.get(this), procedure)

        const req = new tds.Request(procedure, err => {
          // to make sure we handle no-sql errors as well
          if (err && (!errors.length || (errors.length && err.message !== errors[errors.length - 1].message))) {
            err = new base.RequestError(err, 'EREQUEST')
            if (this.stream) this.emit('error', err)
            errors.push(err)
          }

          delete this._cancel

          let error
          if (errors.length && !this.stream) {
            error = errors.pop()
            error.precedingErrors = errors
          }

          if (!hasReturned) {
            for (let event in errorHandlers) {
              connection.removeListener(event, errorHandlers[event])
            }

            this.parent.release(connection)
            hasReturned = true

            if (error) {
              debug('request(%d): failed', IDS.get(this), error)
            } else {
              debug('request(%d): complete', IDS.get(this))
            }

            if (this.stream) {
              callback(null, null, output, returnValue, rowsAffected)
            } else {
              callback(error, recordsets, output, returnValue, rowsAffected)
            }
          }
        })

        this._setCurrentRequest(req)

        req.on('columnMetadata', metadata => {
          columns = createColumns(metadata)

          isChunkedRecordset = false
          if ((metadata.length === 1) && (metadata[0].colName === JSON_COLUMN_ID || metadata[0].colName === XML_COLUMN_ID)) {
            isChunkedRecordset = true
            chunksBuffer = []
          }

          if (this.stream) this.emit('recordset', columns)
        })

        req.on('row', columns => {
          if (!recordset) recordset = []

          if (isChunkedRecordset) {
            return chunksBuffer.push(columns[0].value)
          }

          row = {}
          for (let col of columns) {
            col.value = valueCorrection(col.value, col.metadata)

            let exi = row[col.metadata.colName]
            if (exi != null) {
              if (exi instanceof Array) {
                exi.push(col.value)
              } else {
                row[col.metadata.colName] = [exi, col.value]
              }
            } else {
              row[col.metadata.colName] = col.value
            }
          }

          if (this.stream) {
            this.emit('row', row)
          } else {
            recordset.push(row)
          }
        })

        req.on('doneInProc', (rowCount, more) => {
          if (rowCount != null) rowsAffected.push(rowCount)

          // filter empty recordsets when NOCOUNT is OFF
          if (Object.keys(columns).length === 0) return

          if (isChunkedRecordset) {
            if (columns[JSON_COLUMN_ID] && config.parseJSON === true) {
              try {
                if (chunksBuffer.length === 0) {
                  row = null
                } else {
                  row = JSON.parse(chunksBuffer.join(''))
                }
              } catch (ex) {
                row = null
                const ex2 = new base.RequestError(new Error(`Failed to parse incoming JSON. ${ex.message}`), 'EJSON')

                if (this.stream) this.emit('error', ex2)

                // we must collect errors even in stream mode
                errors.push(ex2)
              }
            } else {
              row = {}
              row[Object.keys(columns)[0]] = chunksBuffer.join('')
            }

            chunksBuffer = null

            if (this.stream) {
              this.emit('row', row)
            } else {
              recordset.push(row)
            }
          }

          if (!this.stream) {
            // all rows of current recordset loaded
            Object.defineProperty(recordset, 'columns', {
              enumerable: false,
              configurable: true,
              value: columns
            })

            Object.defineProperty(recordset, 'toTable', {
              enumerable: false,
              configurable: true,
              value (name) { return Table.fromRecordset(this, name) }
            })

            recordsets.push(recordset)
          }

          recordset = []
          columns = {}
        })

        req.on('doneProc', (rowCount, more, returnStatus) => {
          returnValue = returnStatus
        })

        req.on('returnValue', (parameterName, value, metadata) => {
          output[parameterName] = value
        })

        for (let name in this.parameters) {
          let param = this.parameters[name]
          if (param.io === 1) {
            req.addParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision})
          } else {
            req.addOutputParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision})
          }
        }

        connection.callProcedure(req)
      })
    })
  }

  _pause () {
    super._pause()
    if (this._currentRequest) {
      this._currentRequest.pause()
    }
  }

  _resume () {
    super._resume()
    if (this._currentRequest) {
      this._currentRequest.resume()
    }
  }
}

module.exports = Object.assign({
  ConnectionPool,
  Transaction,
  Request,
  PreparedStatement: base.PreparedStatement
}, base.exports)

Object.defineProperty(module.exports, 'Promise', {
  enumerable: true,
  get: () => {
    return base.Promise
  },
  set: (value) => {
    base.Promise = value
  }
})

base.driver.name = 'tedious'
base.driver.ConnectionPool = ConnectionPool
base.driver.Transaction = Transaction
base.driver.Request = Request

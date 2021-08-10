'use strict'

const msnodesql = require('msnodesqlv8')
const debug = require('debug')('mssql:tedi')
const BaseConnection = require('../base/connection')
const { IDS, INCREMENT } = require('../utils')
// const TransactionError = require('../error/transaction-error')
// const Request = require('./request')
const ConnectionError = require('../error/connection-error')
const CONNECTION_STRING_PORT = 'Driver=SQL Server Native Client 11.0;Server=#{server},#{port};Database=#{database};Uid=#{user};Pwd=#{password};Trusted_Connection=#{trusted};Encrypt=#{encrypt};'
const CONNECTION_STRING_NAMED_INSTANCE = 'Driver=SQL Server Native Client 11.0;Server=#{server}\\#{instance};Database=#{database};Uid=#{user};Pwd=#{password};Trusted_Connection=#{trusted};Encrypt=#{encrypt};'
const shared = require('../shared')
// const ISOLATION_LEVEL = require('../isolationlevel')

// const isolationLevelDeclaration = function (type) {
//   switch (type) {
//     case ISOLATION_LEVEL.READ_UNCOMMITTED: return 'READ UNCOMMITTED'
//     case ISOLATION_LEVEL.READ_COMMITTED: return 'READ COMMITTED'
//     case ISOLATION_LEVEL.REPEATABLE_READ: return 'REPEATABLE READ'
//     case ISOLATION_LEVEL.SERIALIZABLE: return 'SERIALIZABLE'
//     case ISOLATION_LEVEL.SNAPSHOT: return 'SNAPSHOT'
//     default: throw new TransactionError('Invalid isolation level.')
//   }
// }

class Connection extends BaseConnection {
  constructor(poolOrConfig) {
    super(poolOrConfig)
  }

  _connect() {
    return new shared.Promise((resolve, reject) => {
      let defaultConnectionString = CONNECTION_STRING_PORT

      if (this.config.options.instanceName != null) {
        defaultConnectionString = CONNECTION_STRING_NAMED_INSTANCE
      }

      if (this.config.requestTimeout == null) {
        this.config.requestTimeout = 15000
      }

      const cfg = {
        conn_str: this.config.connectionString || defaultConnectionString,
        conn_timeout: (this.config.connectionTimeout || 15000) / 1000
      }

      cfg.conn_str = cfg.conn_str.replace(/#{([^}]*)}/g, (p) => {
        const key = p.substr(2, p.length - 3)

        switch (key) {
          case 'instance':
            return this.config.options.instanceName
          case 'trusted':
            return this.config.options.trustedConnection ? 'Yes' : 'No'
          case 'encrypt':
            return this.config.options.encrypt ? 'Yes' : 'No'
          default:
            return this.config[key] != null ? this.config[key] : ''
        }
      })

      const connedtionId = INCREMENT.Connection++
      debug('pool(%d): connection #%d created', IDS.get(this), connedtionId)
      debug('connection(%d): establishing', connedtionId)

      if (typeof this.config.beforeConnect === 'function') {
        this.config.beforeConnect(cfg)
      }

      msnodesql.open(cfg, (err, tds) => {
        if (err) {
          err = new ConnectionError(err)
          return reject(err)
        }

        IDS.add(tds, 'Connection', connedtionId)
        tds.setUseUTC(this.config.options.useUTC)
        debug('connection(%d): established', IDS.get(tds))
        resolve(tds)
      })
    })
  }

  _disconnect(connection) {
    return new shared.Promise((resolve, reject) => {
      if (!connection) {
        resolve()
        return
      }
      debug('connection(%d): destroying', IDS.get(connection))
      connection.close((err) => {
        if (err) {
          return reject(new ConnectionError(err))
        }
        debug('connection(%d): destroyed', IDS.get(connection))
        resolve()
      })
    })
  }

  // _beginTrans(connection, isolationLevel = Connection.defaultIsolationLevel) {
  //   return new shared.Promise((resolve, reject) => {
  //     const req = new Request(this)
  //     req.stream = false
  //     req.query(`set transaction isolation level ${isolationLevelDeclaration(isolationLevel)};begin tran;`, err => {
  //       if (err) {
  //         return reject(err)
  //       }

  //       debug('transaction(%d): begun', IDS.get(this))

  //       resolve()
  //     })
  //   })
  // }

  // // eslint-disable-next-line no-unused-vars
  // _commit(connection) {
  //   return new shared.Promise((resolve, reject) => {
  //     const req = new Request(this)
  //     req.stream = false
  //     req.query('commit tran', err => {
  //       if (err) {
  //         return reject(new TransactionError(err))
  //       }
  //       resolve()
  //     })
  //   })
  // }

  // // eslint-disable-next-line no-unused-vars
  // _rollback(connection) {
  //   return new shared.Promise((resolve, reject) => {
  //     const req = new Request(this)
  //     req.stream = false
  //     req.query('rollback tran', err => {
  //       if (err) {
  //         return reject(new TransactionError(err))
  //       }
  //       resolve()
  //     })
  //   })
  // }
}

module.exports = Connection

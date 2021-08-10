'use strict'

const debug = require('debug')('mssql:tedi')
const BaseConnection = require('../base/connection')
const { IDS } = require('../utils')
// const TransactionError = require('../error/transaction-error')
const ConnectionError = require('../error/connection-error')
const shared = require('../shared')
const tds = require('tedious')

class Connection extends BaseConnection {
  constructor(poolOrConfig) {
    super(poolOrConfig)
    this._abort = () => {
      if (this._inTransaction) {
        this._aborted = true
        this.release()
        this.rollback()
      }
    }
  }

  _connect() {
    return new shared.Promise((resolve, reject) => {
      const resolveOnce = (v) => {
        resolve(v)
        resolve = reject = () => { }
      }
      const rejectOnce = (e) => {
        reject(e)
        resolve = reject = () => { }
      }
      const cfg = {
        server: this.config.server,
        options: Object.assign({
          encrypt: typeof this.config.encrypt === 'boolean' ? this.config.encrypt : true,
          trustServerCertificate: typeof this.config.trustServerCertificate === 'boolean' ? this.config.trustServerCertificate : false
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
      let tedious
      try {
        tedious = new tds.Connection(cfg)
      } catch (err) {
        rejectOnce(err)
        return
      }
      tedious.connect(err => {
        if (err) {
          err = new ConnectionError(err)
          return rejectOnce(err)
        }

        debug('connection(%d): established', IDS.get(tedious))
        resolveOnce(tedious)
      })
      IDS.add(tedious, 'Connection')
      debug('pool(%d): connection #%d created', IDS.get(this), IDS.get(tedious))
      debug('connection(%d): establishing', IDS.get(tedious))

      tedious.on('end', () => {
        const err = new ConnectionError('The connection ended without ever completing the connection')
        rejectOnce(err)
      })
      tedious.on('error', err => {
        if (err.code === 'ESOCKET') {
          tedious.hasError = true
        } else {
          this.emit('error', err)
        }
        rejectOnce(err)
      })

      if (this.config.debug) {
        tedious.on('debug', this.emit.bind(this, 'debug', tedious))
      }
      if (typeof this.config.beforeConnect === 'function') {
        this.config.beforeConnect(tedious)
      }
    })
  }

  _disconnect(tedious) {
    // eslint-disable-next-line no-unused-vars
    return new shared.Promise((resolve, reject) => {
      // 是否存在关闭时遇到错误永远无返回的问题
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

  // _beginTrans(tedious, isolationLevel) {
  //   return new shared.Promise((resolve, reject) => {
  //     tedious.beginTransaction(err => {
  //       if (err) {
  //         err = new TransactionError(err)
  //         return reject(err)
  //       }
  //       tedious.on('rollbackTransaction', this._abort)
  //       resolve()
  //     }, this.name, isolationLevel)
  //   })
  // }

  // _commit(tedious) {
  //   return new shared.Promise((resolve, reject) => {
  //     tedious.commitTransaction(err => {
  //       if (err) {
  //         return reject(new TransactionError(err))
  //       }
  //       tedious.removeListener('rollbackTransaction', this._abort)

  //       this._acquiredConfig = null
  //       resolve()
  //     })
  //   })
  // }

  // _rollback(tedious) {
  //   return new shared.Promise((resolve, reject) => {
  //     tedious.rollbackTransaction((err) => {
  //       if (err) {
  //         return reject(err)
  //       }
  //       tedious.removeListener('rollbackTransaction', this._abort)
  //       resolve()
  //     })
  //   })
  // }
}

module.exports = Connection

'use strict'

const tds = require('tedious')
const debug = require('debug')('mssql:tedi')
const BaseConnectionPool = require('../base/connection-pool')
const { IDS } = require('../utils')
const shared = require('../shared')
const ConnectionError = require('../error/connection-error')
const { CHANNELS, publish } = require('../diagnostics')

class ConnectionPool extends BaseConnectionPool {
  _config () {
    const cfg = {
      server: this.config.server,
      options: Object.assign({
        encrypt: typeof this.config.encrypt === 'boolean' ? this.config.encrypt : true,
        trustServerCertificate: typeof this.config.trustServerCertificate === 'boolean' ? this.config.trustServerCertificate : false
      }, this.config.options),
      authentication: Object.assign({
        type: this.config.domain !== undefined ? 'ntlm' : this.config.authentication_type !== undefined ? this.config.authentication_type : 'default',
        options: Object.entries({
          userName: this.config.user,
          password: this.config.password,
          domain: this.config.domain,
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          tenantId: this.config.tenantId,
          token: this.config.token,
          msiEndpoint: this.config.msiEndpoint,
          msiSecret: this.config.msiSecret
        }).reduce((acc, [key, val]) => {
          if (typeof val !== 'undefined') {
            return { ...acc, [key]: val }
          }
          return acc
        }, {})
      }, this.config.authentication)
    }

    cfg.options.database = cfg.options.database || this.config.database
    cfg.options.port = cfg.options.port || this.config.port
    cfg.options.connectTimeout = cfg.options.connectTimeout ?? this.config.connectionTimeout ?? this.config.timeout ?? 15000
    cfg.options.requestTimeout = cfg.options.requestTimeout ?? this.config.requestTimeout ?? this.config.timeout ?? 15000
    cfg.options.tdsVersion = cfg.options.tdsVersion || '7_4'
    cfg.options.rowCollectionOnDone = cfg.options.rowCollectionOnDone || false
    cfg.options.rowCollectionOnRequestCompletion = cfg.options.rowCollectionOnRequestCompletion || false
    cfg.options.useColumnNames = cfg.options.useColumnNames || false
    cfg.options.appName = cfg.options.appName || 'node-mssql'

    // tedious always connect via tcp when port is specified
    if (cfg.options.instanceName) delete cfg.options.port

    if (isNaN(cfg.options.requestTimeout)) cfg.options.requestTimeout = 15000
    if (cfg.options.requestTimeout === Infinity || cfg.options.requestTimeout < 0) cfg.options.requestTimeout = 0

    if (!cfg.options.debug && this.config.debug) {
      cfg.options.debug = {
        packet: true,
        token: true,
        data: true,
        payload: true
      }
    }
    return cfg
  }

  _poolCreate () {
    return new shared.Promise((resolve, reject) => {
      const resolveOnce = (v) => {
        resolve(v)
        resolve = reject = () => {}
      }
      const rejectOnce = (e) => {
        reject(e)
        resolve = reject = () => {}
      }
      let tedious
      try {
        tedious = new tds.Connection(this._config())
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
        this.collation = tedious.databaseCollation
        publish(CHANNELS.CONNECTION_CREATE, () => ({
          connectionId: IDS.get(tedious),
          poolId: IDS.get(this),
          server: this.config.server,
          database: this.config.database
        }))
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

  _poolValidate (tedious) {
    if (!tedious || tedious.closed || tedious.hasError) {
      return false
    }

    const mode = this.config.validateConnection

    if (!mode) {
      return true
    }

    // Socket-level validation: check connection state and socket health
    // without executing a SQL query. Much cheaper than SELECT 1 at scale.
    if (mode === 'socket') {
      if (tedious.state !== tedious.STATE.LOGGED_IN) {
        return false
      }
      if (!tedious.socket || tedious.socket.destroyed || !tedious.socket.writable) {
        return false
      }
      return true
    }

    // SQL-level validation (default): execute SELECT 1 to verify the
    // connection is fully functional end-to-end.
    return new shared.Promise((resolve) => {
      const req = new tds.Request('SELECT 1;', (err) => {
        resolve(!err)
      })
      tedious.execSql(req)
    })
  }

  _poolDestroy (tedious) {
    return new shared.Promise((resolve, reject) => {
      if (!tedious) {
        resolve()
        return
      }
      debug('connection(%d): destroying', IDS.get(tedious))
      const connectionId = IDS.get(tedious)
      const poolId = IDS.get(this)

      if (tedious.closed) {
        debug('connection(%d): already closed', IDS.get(tedious))
        resolve()
      } else {
        tedious.once('end', () => {
          debug('connection(%d): destroyed', IDS.get(tedious))
          publish(CHANNELS.CONNECTION_DESTROY, () => ({
            connectionId,
            poolId
          }))
          resolve()
        })

        tedious.close()
      }
    })
  }
}

module.exports = ConnectionPool

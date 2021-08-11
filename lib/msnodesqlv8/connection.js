'use strict'

const debug = require('debug')('mssql:tedi')
const BaseConnection = require('../base/connection')
const { IDS } = require('../utils')
const ConnectionError = require('../error/connection-error')
const shared = require('../shared')

class Connection extends BaseConnection {
  _connect () {
    // It is recommended to create a new function substitution
    return shared.driver.ConnectionPool.prototype._poolCreate.call(this)
  }

  _disconnect (connection) {
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
}

module.exports = Connection

'use strict'

const debug = require('debug')('mssql:tedi')
const BaseConnection = require('../base/connection')
const { IDS } = require('../utils')
const shared = require('../shared')

class Connection extends BaseConnection {
  _connect () {
    // It is recommended to create a new function substitution
    return shared.driver.ConnectionPool.prototype._poolCreate.call(this)
  }

  _disconnect (tedious) {
    // eslint-disable-next-line no-unused-vars
    return new shared.Promise((resolve) => {
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
}

module.exports = Connection

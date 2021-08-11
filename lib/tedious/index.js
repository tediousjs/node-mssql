'use strict'

const base = require('../base')
const ConnectionPool = require('./connection-pool')
const Transaction = require('./transaction')
const Request = require('./request')
const Connection = require('./connection')

module.exports = Object.assign({
  ConnectionPool,
  Transaction,
  Request,
  Connection,
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
base.driver.Connection = Connection

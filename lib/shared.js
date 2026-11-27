'use strict'

const { TYPES } = require('./datatypes')
const Table = require('./table')
const RequestError = require('./error/request-error')
const { thrownMessage } = require('./utils')

let PromiseLibrary = Promise
const driver = {}
const map = []

/**
 * Register you own type map.
 *
 * @path module.exports.map
 * @param {*} jstype JS data type.
 * @param {*} sqltype SQL data type.
 */

map.register = function (jstype, sqltype) {
  for (let index = 0; index < this.length; index++) {
    const item = this[index]
    if (item.js === jstype) {
      this.splice(index, 1)
      break
    }
  }

  this.push({
    js: jstype,
    sql: sqltype
  })

  return null
}

map.register(String, TYPES.NVarChar)
map.register(Number, TYPES.Int)
map.register(Boolean, TYPES.Bit)
map.register(Date, TYPES.DateTime)
map.register(Buffer, TYPES.VarBinary)
map.register(Table, TYPES.TVP)

/**
 * @ignore
 */

const getTypeByValue = function (value) {
  if ((value === null) || (value === undefined)) { return TYPES.NVarChar }

  switch (typeof value) {
    case 'string':
      for (const item of Array.from(map)) {
        if (item.js === String) {
          return item.sql
        }
      }

      return TYPES.NVarChar

    case 'number':
      if (value % 1 === 0) {
        if (value < -2147483648 || value > 2147483647) {
          return TYPES.BigInt
        } else {
          return TYPES.Int
        }
      } else {
        return TYPES.Float
      }

    case 'bigint':
      if (value < -2147483648n || value > 2147483647n) {
        return TYPES.BigInt
      } else {
        return TYPES.Int
      }

    case 'boolean':
      for (const item of Array.from(map)) {
        if (item.js === Boolean) {
          return item.sql
        }
      }

      return TYPES.Bit

    case 'object':
      for (const item of Array.from(map)) {
        if (value instanceof item.js) {
          return item.sql
        }
      }

      return TYPES.NVarChar

    default:
      return TYPES.NVarChar
  }
}

// A value handler is the caller's code, which each driver runs as the rows arrive, and what it
// throws fails the request. Anything can be thrown, so it is made an Error, which the request's
// error keeps as its originalError. The request's error has the code of a request error,
// whatever code an Error that was thrown has. Nothing may be thrown from here into the driver,
// so a value that cannot be read, such as a revoked Proxy or an Error with a property that
// throws, becomes the cause of an Error that says so.
const valueHandlerError = function (thrown) {
  let err
  try {
    err = new RequestError(thrown instanceof Error ? thrown : new Error(thrownMessage(thrown)), 'EREQUEST')
  } catch (e) {
    err = new RequestError(new Error('A value handler threw a value that cannot be read.', { cause: thrown }), 'EREQUEST')
  }
  err.code = 'EREQUEST'
  return err
}

module.exports = {
  driver,
  getTypeByValue,
  map,
  valueHandlerError
}

Object.defineProperty(module.exports, 'Promise', {
  get: () => {
    return PromiseLibrary
  },
  set: (value) => {
    PromiseLibrary = value
  }
})

Object.defineProperty(module.exports, 'valueHandler', {
  enumerable: true,
  value: new Map(),
  writable: false,
  configurable: false
})

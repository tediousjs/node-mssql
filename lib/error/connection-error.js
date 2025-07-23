'use strict'

const MSSQLError = require('./mssql-error')

/**
 * Class ConnectionError.
 */

class ConnectionError extends MSSQLError {
  /**
   * Creates a new ConnectionError.
   *
   * @param {String} message Error message.
   * @param {String} [code] Error code.
   */

  constructor (message, code) {
    super(message, code)

    this.name = 'ConnectionError'
    this.message = message
  }
}

module.exports = ConnectionError

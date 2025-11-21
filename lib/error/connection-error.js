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

    let err = message?.details
    if (err instanceof Array && (err = err.at(-1))) {
      this.message = err.message
      this.originalError = err
    }
  }
}

module.exports = ConnectionError

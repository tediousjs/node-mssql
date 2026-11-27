'use strict'

const MSSQLError = require('./mssql-error')
const { stripOdbcPrefix } = require('../utils')

/**
 * Class RequestError.
 *
 * @property {Number} [number] SQL Server error number. Undefined for an error that did not come from SQL Server.
 * @property {Number} lineNumber Line number.
 * @property {String} state Error state.
 * @property {String} class Error class.
 * @property {String} serverName Server name.
 * @property {String} procName Procedure name.
 */

class RequestError extends MSSQLError {
  /**
   * Creates a new RequestError.
   *
   * @param {String} message Error message.
   * @param {String} [code] Error code.
   */

  constructor (message, code) {
    super(message, code)
    if (message instanceof Error) {
      // msnodesqlv8 gives the error number as `code`. tedious gives a string code, such as
      // ETIMEOUT or ECANCEL, which is not an error number.
      const codeNumber = typeof message.code === 'number' ? message.code : undefined
      if (message.info) {
        this.number = message.info.number || codeNumber
        this.lineNumber = message.info.lineNumber
        this.state = message.info.state || message.sqlstate // err.sqlstate is returned by msnodesql driver
        this.class = message.info.class
        this.serverName = message.info.serverName
        this.procName = message.info.procName
      } else {
        // Use err attributes returned by msnodesql driver
        this.number = codeNumber
        this.lineNumber = message.lineNumber
        this.state = message.sqlstate
        this.class = message.severity
        this.serverName = message.serverName
        this.procName = message.procName
      }
    }

    this.name = 'RequestError'
    this.message = stripOdbcPrefix(this.message)
  }
}

module.exports = RequestError

const MSSQLError = require('./error/mssql-error')

const IDS = new WeakMap()
const INCREMENT = {
  Connection: 1,
  ConnectionPool: 1,
  Request: 1,
  Transaction: 1,
  PreparedStatement: 1
}

// Parameter names are emitted into generated T-SQL as `@<name>`. The `@` occupies the
// identifier's first position, so every character of the name sits in a subsequent
// position, where T-SQL also permits digits and `$`. The set is deliberately wider than
// the names the server will accept: it excludes the characters that could end the
// identifier and let the rest of the name be read as SQL, and nothing else, so a name
// the server dislikes still fails there rather than becoming an error here. The
// exception is the invisible format characters, which are rejected outright.
// Only the two zero-width joiners are taken from the format characters; the rest of that
// category includes ZERO WIDTH SPACE, which the server does treat as a separator.
const PARAM_NAME = /^(?:[\p{L}\p{N}\p{M}\p{Pc}@#$・･]|\u200C|\u200D)*$/u
// A column name is emitted as a quoted identifier, `[name]`, by this module and again by
// the driver's own bulk load. Only `]` can terminate that quoting early, and doubling it
// is the documented way to include one literally.
const escapesQuotedIdentifier = (name) => String(name).replace(/]]/g, '').includes(']')

module.exports = {
  objectHasProperty: (object, property) => Object.prototype.hasOwnProperty.call(object, property),
  isValidParameterName: (name) => {
    // Only primitives are accepted: an object could return a different value from a second
    // toString() call, passing validation here and emitting something else into the SQL.
    const type = typeof name
    return (type === 'string' || type === 'number') && PARAM_NAME.test(String(name))
  },
  assertSafeColumnName: (name) => {
    const type = typeof name
    if (type !== 'string' && type !== 'number') {
      throw new MSSQLError(`Invalid column name '${String(name)}'. Column names must be a string or a number.`, 'EINJECT')
    }
    const column = String(name)
    if (escapesQuotedIdentifier(column)) {
      throw new MSSQLError(`Invalid column name '${column}'. A ']' in a column name must be written as ']]'.`, 'EINJECT')
    }
    return column
  },
  INCREMENT,
  IDS: {
    get: IDS.get.bind(IDS),
    add: (object, type, id) => {
      if (id) return IDS.set(object, id)
      IDS.set(object, INCREMENT[type]++)
    }
  }
}

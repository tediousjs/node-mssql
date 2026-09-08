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
// A table-valued parameter's type name is emitted into the parameter declaration, and a
// stored procedure's name is emitted into an `exec`, so both are checked the way the server
// reads a qualified name: one or more parts separated by `.`, each either bare, holding only
// the characters an identifier is made of, or quoted in brackets or double quotes, where
// anything goes until the closing mark. Nothing that gets through can end the statement it
// sits in and have the rest read as SQL.
const QUALIFIED_NAME_PART = '(?:\\[(?:[^\\]]|\\]\\])*\\]|"(?:[^"]|"")*"|[\\p{L}\\p{N}\\p{M}\\p{Pc}@#$]+)'
// An intermediate part may be omitted — `db..proc` and `server.db..proc` are ordinary
// T-SQL — but the first and last parts must be present, so a bare `.`, a leading `.proc`
// and a trailing `db..` are still refused. An empty part cannot end the identifier.
const QUALIFIED_NAME = new RegExp(`^(?:${QUALIFIED_NAME_PART}(?:\\.${QUALIFIED_NAME_PART}?)*\\.)?${QUALIFIED_NAME_PART}$`, 'u')

// A length, precision or scale is emitted into the same declaration. `max` is the only
// word the declaration takes there; everything else the server wants is a number.
const TYPE_SIZE = /^\w*$/

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
  assertSafeTypeName: (name) => {
    // A type name is optional: the tedious driver takes it from the Table passed as the
    // value, and only uses this one when it is given.
    if (name == null) {
      return name
    }
    // Read once, and return what was read. Whatever is emitted is what was checked, so a
    // value that reports a different name the second time cannot reach the SQL.
    const type = String(name).trim()
    if (!QUALIFIED_NAME.test(type)) {
      throw new MSSQLError(`Invalid type name '${type}'. Type names may only contain identifier characters.`, 'EINJECT')
    }
    return type
  },
  assertSafeProcedureName: (name) => {
    // The msnodesqlv8 driver builds `exec @___return___ = <name>` as SQL text, so the name is
    // checked before it is emitted. The tedious driver sends it as a bound RPC and cannot be
    // injected through it, but it is checked there too so that a name is accepted or rejected
    // the same way whichever driver is in use.
    // Read once, and return what was read, for the same reason as the type name.
    const procedure = String(name).trim()
    if (!QUALIFIED_NAME.test(procedure)) {
      throw new MSSQLError(`Invalid procedure name '${procedure}'. Procedure names may only contain identifier characters.`, 'EINJECT')
    }
    return procedure
  },
  assertSafeTypeSize: (value) => {
    if (value == null || typeof value === 'number') {
      return value
    }
    // Read once and return what was read, for the same reason as the type name. Padding is
    // trimmed rather than refused, and a word the server will reject still reaches it.
    const size = String(value).trim()
    if (!TYPE_SIZE.test(size)) {
      throw new MSSQLError(`Invalid type size '${size}'. A length, precision or scale must be a number.`, 'EINJECT')
    }
    return size
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

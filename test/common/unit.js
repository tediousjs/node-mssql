'use strict'

/* globals describe, it, before, after, afterEach */

const sql = require('../../')
const assert = require('assert')
const udt = require('../../lib/udt')
const { declare } = require('../../lib/datatypes')
const { assertSafeProcedureName } = require('../../lib/utils')
const BasePool = require('../../lib/base/connection-pool')

describe('Unit', () => {
  it('table', done => {
    let t = new sql.Table('MyTable')
    t.columns.add('a', sql.Int, { nullable: false })
    t.columns.add('b', sql.VarChar(50), { nullable: true })
    assert.strictEqual(t.declare(), 'create table [MyTable] ([a] int not null, [b] varchar (50) null)')

    t.rows.add(777, 'asdf')
    t.rows.add(453)
    t.rows.add(4535434)
    t.rows.add(12, 'XCXCDCDSCDSC')
    t.rows.add(1)
    t.rows.add(7278, '4524254')

    assert.strictEqual(t.name, 'MyTable')
    assert.strictEqual(t.schema, null)
    assert.strictEqual(t.database, null)
    assert.strictEqual(t.path, '[MyTable]')
    assert.strictEqual(t.columns.length, 2)
    assert.strictEqual(t.rows.length, 6)
    assert.deepStrictEqual(t.rows[3], [12, 'XCXCDCDSCDSC'])
    assert.strictEqual(t.temporary, false)

    t.rows.clear()
    assert.strictEqual(t.rows.length, 0)

    t = new sql.Table('schm.MyTable')

    assert.strictEqual(t.name, 'MyTable')
    assert.strictEqual(t.schema, 'schm')
    assert.strictEqual(t.database, null)
    assert.strictEqual(t.path, '[schm].[MyTable]')
    assert.strictEqual(t.temporary, false)

    t = new sql.Table('db.schm.MyTable')

    assert.strictEqual(t.name, 'MyTable')
    assert.strictEqual(t.schema, 'schm')
    assert.strictEqual(t.database, 'db')
    assert.strictEqual(t.path, '[db].[schm].[MyTable]')
    assert.strictEqual(t.temporary, false)

    t = new sql.Table('[db.db].[schm.schm].[MyTable.MyTable]')

    assert.strictEqual(t.name, 'MyTable.MyTable')
    assert.strictEqual(t.schema, 'schm.schm')
    assert.strictEqual(t.database, 'db.db')
    assert.strictEqual(t.path, '[db.db].[schm.schm].[MyTable.MyTable]')
    assert.strictEqual(t.temporary, false)

    t = new sql.Table('#temporary')

    assert.strictEqual(t.name, '#temporary')
    assert.strictEqual(t.schema, null)
    assert.strictEqual(t.database, null)
    assert.strictEqual(t.path, '[#temporary]')
    assert.strictEqual(t.temporary, true)

    const rs = [
      { a: { b: { c: 1, d: 2 }, x: 3, y: 4 } }
    ]
    rs.columns = {
      'JSON_F52E2B61-18A1-11d1-B105-00805F49916B': {
        name: 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B',
        type: sql.NVarChar
      }
    }

    t = sql.Table.fromRecordset(rs, 'tablename')
    assert.strictEqual(t.declare(), 'create table [tablename] ([JSON_F52E2B61-18A1-11d1-B105-00805F49916B] nvarchar (MAX))')

    assert.strictEqual(t.columns.length, 1)
    assert.strictEqual(t.rows.length, 1)
    assert.deepStrictEqual(t.rows[0], ['{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}'])

    t = new sql.Table('MyTable')
    t.columns.add('a', sql.Int, { primary: true })
    t.columns.add('b', sql.TinyInt, { nullable: true })
    assert.strictEqual(t.declare(), 'create table [MyTable] ([a] int primary key, [b] tinyint null)')

    t = new sql.Table('#mytemptable')
    t.columns.add('a', sql.Int, { primary: true })
    t.columns.add('b', sql.TinyInt, { nullable: true })
    t.columns.add('c', sql.TinyInt, { nullable: false, primary: true })
    assert.strictEqual(t.declare(), 'create table [#mytemptable] ([a] int, [b] tinyint null, [c] tinyint not null, constraint [PK_mytemptable] primary key ([a], [c]))')

    t = new sql.Table('MyTable')
    t.columns.add('name', sql.NVarChar, {
      length: Infinity
    })
    assert.strictEqual(t.columns[0].length, Infinity)
    return done()
  })

  it('custom promise library', done => {
    let resolved = false

    class FakePromise {
      constructor (cb) {
        setImmediate(cb, () => {
          resolved = true
          this._then()
        }, err => {
          this.catch(err)
        })
      }

      then (func) {
        this._then = func
      }
    }

    sql.Promise = FakePromise
    sql.close().then(() => {
      assert.strictEqual(resolved, true)
      done()
    })
  })

  it('infer type by value', () => {
    assert.strictEqual(sql.Int, sql.getTypeByValue(23))
    assert.strictEqual(sql.Float, sql.getTypeByValue(1.23))
  })

  it('tagged template literals', () => {
    function query () {
      const values = Array.prototype.slice.call(arguments)
      const strings = values.shift()
      const input = []

      return {
        input,
        command: sql.Request.prototype._template.call({
          input () { input.push(Array.prototype.slice.call(arguments)) }
        }, strings, values)
      }
    }

    assert.deepStrictEqual(query`select * from myTable where id = ${123}`, {
      input: [['param1', 123]],
      command: 'select * from myTable where id = @param1'
    })
  })

  it('tagged template arrays', () => {
    function query () {
      const values = Array.prototype.slice.call(arguments)
      const strings = values.shift()
      const input = []
      return {
        input,
        command: sql.Request.prototype._template.call({
          input () { input.push(Array.prototype.slice.call(arguments)) }
        }, strings, values)
      }
    }

    assert.deepStrictEqual(query`select * from myTable where id in (${[1, 2, 3]})`, {
      input: [['param1_0', 1], ['param1_1', 2], ['param1_2', 3]],
      command: 'select * from myTable where id in (@param1_0, @param1_1, @param1_2)'
    })

    assert.deepStrictEqual(query`select * from myTable where id in (${[]})`, {
      input: [],
      command: 'select * from myTable where id in ()'
    })
  })

  it('tagged template literal request', () => {
    const req = new sql.Request()
    const sqlstr = req.template`select * from myTable where id = ${123}`
    assert.strictEqual(sqlstr, 'select * from myTable where id = @param1')
    assert.strictEqual(req.parameters.param1.value, 123)
  })
})

describe('Geometry Parsing', () => {
  it('polygon v1', () => {
    // select geometry::STGeomFromText(N'POLYGON((1 1, 3 1, 3 7, 1 1))',4326)
    const buffer = Buffer.from('E6100000010404000000000000000000F03F000000000000F03F0000000000000840000000000000F03F00000000000008400000000000001C40000000000000F03F000000000000F03F01000000020000000001000000FFFFFFFF0000000003', 'hex')
    const geom = udt.PARSERS.geometry(buffer)

    /*
{
  srid: 4326,
  version: 1,
  points: [
    Point { x: 1, y: 1, z: null, m: null },
    Point { x: 1, y: 3, z: null, m: null },
    Point { x: 7, y: 3, z: null, m: null },
    Point { x: 1, y: 1, z: null, m: null }
  ],
  figures: [ { attribute: 2, pointOffset: 0 } ],
  shapes: [ { parentOffset: -1, figureOffset: 0, type: 3 } ],
  segments: []
}
     */
    assert.strictEqual(geom.version, 1)
    assert.strictEqual(geom.srid, 4326)
    assert.strictEqual(geom.points.length, 4)
    assert.strictEqual(geom.points[0].x, 1)
    assert.strictEqual(geom.points[0].y, 1)
    assert.strictEqual(geom.points[1].x, 3)
    assert.strictEqual(geom.points[1].y, 1)
    assert.strictEqual(geom.points[2].x, 3)
    assert.strictEqual(geom.points[2].y, 7)
    assert.strictEqual(geom.points[3].x, 1)
    assert.strictEqual(geom.points[3].y, 1)
  })

  it('polygon v2', () => {
    // select geometry::STGeomFromText(N'POLYGON((1 1, 3 1, 3 1, 1 1))',4326)
    // (then tweak it to switch to v2: s/010/020/, though without any segments, it's kind of a moot point.)
    const buffer = Buffer.from('E6100000020004000000000000000000F03F000000000000F03F0000000000000840000000000000F03F0000000000000840000000000000F03F000000000000F03F000000000000F03F01000000020000000001000000FFFFFFFF0000000003', 'hex')
    const geom = udt.PARSERS.geometry(buffer)

    /*
{
  srid: 4326,
  version: 2,
  points: [
    Point { x: 1, y: 1, z: null, m: null },
    Point { x: 1, y: 3, z: null, m: null },
    Point { x: 1, y: 3, z: null, m: null },
    Point { x: 1, y: 1, z: null, m: null }
  ],
  figures: [ { attribute: 1, pointOffset: 0 } ],
  shapes: [ { parentOffset: -1, figureOffset: 0, type: 3 } ],
  segments: []
}
     */
    assert.strictEqual(geom.version, 2)
    assert.strictEqual(geom.srid, 4326)
    assert.strictEqual(geom.points.length, 4)
    assert.strictEqual(geom.points[0].x, 1)
    assert.strictEqual(geom.points[0].y, 1)
    assert.strictEqual(geom.points[1].x, 3)
    assert.strictEqual(geom.points[1].y, 1)
    assert.strictEqual(geom.points[2].x, 3)
    assert.strictEqual(geom.points[2].y, 1)
    assert.strictEqual(geom.points[3].x, 1)
    assert.strictEqual(geom.points[3].y, 1)
  })
})

describe('Geography Parsing', () => {
  it('polygon v1', () => {
    // select geography::STGeomFromText(N'POLYGON((1 1, 3 1, 3 7, 1 1))',4326)
    const buffer = Buffer.from('E6100000010404000000000000000000F03F000000000000F03F000000000000F03F00000000000008400000000000001C400000000000000840000000000000F03F000000000000F03F01000000020000000001000000FFFFFFFF0000000003', 'hex')
    const geo = udt.PARSERS.geography(buffer)

    /*
{
  srid: 4326,
  version: 1,
  points: [
    Point { x: 1, y: 1, z: null, m: null, lat: 1, lng: 1 },
    Point { x: 1, y: 3, z: null, m: null, lat: 1, lng: 3 },
    Point { x: 7, y: 3, z: null, m: null, lat: 7, lng: 3 },
    Point { x: 1, y: 1, z: null, m: null, lat: 1, lng: 1 }
  ],
  figures: [ { attribute: 2, pointOffset: 0 } ],
  shapes: [ { parentOffset: -1, figureOffset: 0, type: 3 } ],
  segments: []
}
    */
    assert.strictEqual(geo.version, 1)
    assert.strictEqual(geo.srid, 4326)
    assert.strictEqual(geo.points.length, 4)

    assert.strictEqual(geo.points[0].lng, 1)
    assert.strictEqual(geo.points[0].lat, 1)
    assert.strictEqual(geo.points[1].lng, 3)
    assert.strictEqual(geo.points[1].lat, 1)
    assert.strictEqual(geo.points[2].lng, 3)
    assert.strictEqual(geo.points[2].lat, 7)
    assert.strictEqual(geo.points[3].lng, 1)
    assert.strictEqual(geo.points[3].lat, 1)

    // Backwards compatibility: Preserve flipped x and y.
    assert.strictEqual(geo.points[0].y, 1)
    assert.strictEqual(geo.points[0].x, 1)
    assert.strictEqual(geo.points[1].y, 3)
    assert.strictEqual(geo.points[1].x, 1)
    assert.strictEqual(geo.points[2].y, 3)
    assert.strictEqual(geo.points[2].x, 7)
    assert.strictEqual(geo.points[3].y, 1)
    assert.strictEqual(geo.points[3].x, 1)
  })

  it('polygon v2', () => {
    // select geography::STGeomFromText(N'POLYGON((1 1, 3 1, 3 1, 1 1))',4326)
    const buffer = Buffer.from('E6100000020004000000000000000000F03F000000000000F03F000000000000F03F0000000000000840000000000000F03F0000000000000840000000000000F03F000000000000F03F01000000010000000001000000FFFFFFFF0000000003', 'hex')
    const geo = udt.PARSERS.geography(buffer)

    /*
{
  srid: 4326,
  version: 2,
  points: [
    Point { x: 1, y: 1, z: null, m: null, lat: 1, lng: 1 },
    Point { x: 1, y: 3, z: null, m: null, lat: 1, lng: 3 },
    Point { x: 1, y: 3, z: null, m: null, lat: 1, lng: 3 },
    Point { x: 1, y: 1, z: null, m: null, lat: 1, lng: 1 }
  ],
  figures: [ { attribute: 1, pointOffset: 0 } ],
  shapes: [ { parentOffset: -1, figureOffset: 0, type: 3 } ],
  segments: []
}
    */
    assert.strictEqual(geo.version, 2)
    assert.strictEqual(geo.srid, 4326)
    assert.strictEqual(geo.points.length, 4)

    assert.strictEqual(geo.points[0].lng, 1)
    assert.strictEqual(geo.points[0].lat, 1)
    assert.strictEqual(geo.points[1].lng, 3)
    assert.strictEqual(geo.points[1].lat, 1)
    assert.strictEqual(geo.points[2].lng, 3)
    assert.strictEqual(geo.points[2].lat, 1)
    assert.strictEqual(geo.points[3].lng, 1)
    assert.strictEqual(geo.points[3].lat, 1)

    // Backwards compatibility: Preserve flipped x and y.
    assert.strictEqual(geo.points[0].y, 1)
    assert.strictEqual(geo.points[0].x, 1)
    assert.strictEqual(geo.points[1].y, 3)
    assert.strictEqual(geo.points[1].x, 1)
    assert.strictEqual(geo.points[2].y, 3)
    assert.strictEqual(geo.points[2].x, 1)
    assert.strictEqual(geo.points[3].y, 1)
    assert.strictEqual(geo.points[3].x, 1)
  })
})

describe('config cloning', () => {
  it('deeply clones configs', () => {
    const options = {}
    const pool = new BasePool({
      server: 'Instance\\Name',
      options
    })
    assert.notDeepStrictEqual(options, pool.config.options)
  })
})

describe('value handlers', () => {
  afterEach('reset valueHandler', () => {
    sql.valueHandler.clear()
  })
  it('can set a value handler', () => {
    assert.strictEqual(sql.valueHandler instanceof Map, true)
    assert.strictEqual(sql.valueHandler.size, 0)
    sql.valueHandler.set(sql.TYPES.Int, (value) => value.toUpperCase())
    assert.strictEqual(sql.valueHandler.size, 1)
    assert.strictEqual(sql.valueHandler.has(sql.TYPES.Int), true)
  })
  it('can delete a value handler', () => {
    assert.strictEqual(sql.valueHandler instanceof Map, true)
    assert.strictEqual(sql.valueHandler.size, 0)
    sql.valueHandler.set(sql.TYPES.Int, (value) => value.toUpperCase())
    assert.strictEqual(sql.valueHandler.size, 1)
    assert.strictEqual(sql.valueHandler.has(sql.TYPES.Int), true)
    sql.valueHandler.delete(sql.TYPES.Int)
    assert.strictEqual(sql.valueHandler.has(sql.TYPES.Int), false)
    assert.strictEqual(sql.valueHandler.size, 0)
  })
  it('can reset all value handlers', () => {
    assert.strictEqual(sql.valueHandler instanceof Map, true)
    assert.strictEqual(sql.valueHandler.size, 0)
    sql.valueHandler.set(sql.TYPES.Int, (value) => value.toUpperCase())
    sql.valueHandler.set(sql.TYPES.BigInt, (value) => value.toUpperCase())
    assert.strictEqual(sql.valueHandler.size, 2)
    assert.strictEqual(sql.valueHandler.has(sql.TYPES.Int), true)
    assert.strictEqual(sql.valueHandler.has(sql.TYPES.BigInt), true)
    sql.valueHandler.clear()
    assert.strictEqual(sql.valueHandler.size, 0)
  })
})

describe('connection string parser', () => {
  it('parses named instance and port', () => {
    const config = BasePool.parseConnectionString('Data source=instance\\database,1234')
    assert.deepStrictEqual(config, {
      options: {
        instanceName: 'database'
      },
      pool: {},
      port: 1234,
      server: 'instance'
    })
  })
  it('parses named instance and port (with instance port)', () => {
    const config = BasePool.parseConnectionString('Data source=instance,1234\\database')
    assert.deepStrictEqual(config, {
      options: {
        instanceName: 'database'
      },
      pool: {},
      port: 1234,
      server: 'instance'
    })
  })
  it('parses named instance', () => {
    const config = BasePool.parseConnectionString('Data source=instance\\database')
    assert.deepStrictEqual(config, {
      options: {
        instanceName: 'database'
      },
      pool: {},
      port: 1433,
      server: 'instance'
    })
  })
})

describe('parameter name validation', () => {
  // Names verified to produce working SQL against SQL Server. The library prepends '@',
  // so the name itself sits in an identifier's subsequent position, where T-SQL also
  // permits digits and '$'.
  const accepted = [
    'param1', 'input_parameter', '_leadingUnderscore', 'MixedCase123', 'p1_0',
    '0', '1', '1leadingDigit', '2fa_code', '$x', '$', 'a$b',
    '@leadingAt', '#leadingHash', 'naïve', 'náme', 'नाम', '用户', 'aⅨ',
    // characters SQL Server accepts inside an identifier: fullwidth underscore and
    // katakana middle dots, zero-width joiners, and connector punctuation
    'a\uFF3Fb', 'a\u30FBb', 'a\uFF65b', 'a\u200Cb', 'a\u200Db', 'a\u203Fb', 'a\u2040b'
  ]

  // Names containing a character that terminates or escapes the identifier. These are the
  // names that use tab as a T-SQL whitespace substitute, which the old denylist missed.
  const rejected = [
    'has space', "has'quote", 'has--comment', 'has/*comment', 'has*/comment',
    'has\ttab', 'has\nnewline', 'has\rreturn', 'has;semicolon', 'has=equals',
    'has[bracket', 'has]bracket', 'has(paren', 'has.dot', 'has-dash',
    'a=1;drop\ttable\tdbo.canary;declare\t@q\tint;select\t@q',
    'x\tint;create\ttable\tdbo.pwned(x\tint);select\t@x'
  ]

  it('request should accept names that produce working SQL', () => {
    for (const name of accepted) {
      const request = new sql.Request()
      request.input(name, sql.Int, 1)
      assert.strictEqual(request.parameters[name].name, name, `input() should accept '${name}'`)
      request.output(`out_${name}`, sql.Int)
    }
  })

  it('request should reject names that escape the identifier', () => {
    for (const name of rejected) {
      assert.throws(() => new sql.Request().input(name, sql.Int, 1),
        err => err.code === 'EINJECT', `input() should reject ${JSON.stringify(name)}`)
      assert.throws(() => new sql.Request().output(name, sql.Int),
        err => err.code === 'EINJECT', `output() should reject ${JSON.stringify(name)}`)
    }
  })

  it('prepared statement should accept names that produce working SQL', () => {
    for (const name of accepted) {
      const ps = new sql.PreparedStatement()
      ps.input(name, sql.Int)
      assert.strictEqual(ps.parameters[name].name, name, `input() should accept '${name}'`)
      ps.output(`out_${name}`, sql.Int)
    }
  })

  it('prepared statement should reject names that escape the identifier', () => {
    for (const name of rejected) {
      assert.throws(() => new sql.PreparedStatement().input(name, sql.Int),
        err => err.code === 'EINJECT', `input() should reject ${JSON.stringify(name)}`)
      assert.throws(() => new sql.PreparedStatement().output(name, sql.Int),
        err => err.code === 'EINJECT', `output() should reject ${JSON.stringify(name)}`)
    }
  })

  it('request should reject a non-primitive name whose toString can change', () => {
    let calls = 0
    const twoFaced = { toString () { return ++calls === 1 ? 'safe' : 'x];drop table dbo.t--' } }
    assert.throws(() => new sql.Request().input(twoFaced, sql.Int, 1),
      err => err.code === 'EINJECT', 'input() should reject a non-primitive name')
  })

  it('request should keep parameter values unrestricted', () => {
    const request = new sql.Request()
    request.input('safe', sql.VarChar, "x'; drop table dbo.canary--")
    assert.strictEqual(request.parameters.safe.value, "x'; drop table dbo.canary--",
      'values should not be validated as identifiers')
  })
})

describe('column name validation', () => {
  const hostile = 'a] int); create table dbo.pwned (z int); --'

  it('declare should reject a column name that closes the quoted identifier', () => {
    const table = new sql.Table('dbo.MyTable')
    table.columns.push({ name: hostile, type: sql.Int().type, nullable: true })
    assert.throws(() => table.declare(), /Invalid column name/,
      'declare() should reject a name pushed directly onto the columns array')
  })

  it('declare should reject a column name mutated after it was added', () => {
    const table = new sql.Table('dbo.MyTable')
    table.columns.add('a', sql.Int, { nullable: true })
    table.columns[0].name = hostile
    assert.throws(() => table.declare(), /Invalid column name/,
      'declare() should re-check the name at the point it builds SQL')
  })

  it('declare should accept a doubled bracket, which is the escaped form', () => {
    const table = new sql.Table('dbo.MyTable')
    table.columns.add('a]]b', sql.Int, { nullable: true })
    assert.strictEqual(table.declare(), 'create table [dbo].[MyTable] ([a]]b] int null)',
      'declare() should emit an escaped bracket unchanged')
  })

  it('declare should accept ordinary names including spaces', () => {
    const table = new sql.Table('dbo.MyTable')
    table.columns.add('normal', sql.Int, { nullable: true })
    table.columns.add('with space', sql.Int, { nullable: true })
    assert.strictEqual(table.declare(),
      'create table [dbo].[MyTable] ([normal] int null, [with space] int null)',
      'declare() should emit ordinary names as quoted identifiers')
  })

  it('fromRecordset should accept server-supplied names containing a bracket', () => {
    const recordset = []
    recordset.columns = { 'wei]rd': { type: sql.Int, nullable: true } }
    assert.doesNotThrow(() => sql.Table.fromRecordset(recordset, 'dbo.T'),
      'toTable() should not reject names the server produced, since TVPs never emit them as SQL')
  })
})

describe('table path validation', () => {
  // `create table` takes the table's path as it is, so a path changed after the table was built
  // must still be a name the server reads as one identifier. None of these runs anything on its
  // own: each only fails to compile.
  const unsafe = ['[t];x', 'dbo.t x', '[t] (', '[a]b]', 'db.dbo.', '']

  const declared = (path, name) => {
    const table = new sql.Table('dbo.t')
    table.columns.add('a', sql.Int, { nullable: true })
    if (path !== undefined) table.path = path
    if (name !== undefined) table.name = name
    return table
  }

  it('declare should reject a path that is not a qualified name', () => {
    for (const path of unsafe) {
      assert.throws(() => declared(path).declare(), err => err.code === 'EINJECT' && /Invalid table name/.test(err.message),
        `declare() should reject the path ${JSON.stringify(path)}`)
    }
  })

  it('declare should write the path the table was built with unchanged', () => {
    for (const name of ['t', 'dbo.t', 'db.dbo.[x y]', '#tmp', '[#t m p]', '"q".dbo.t', '[a.b].c', "[O''Brien]", '[dash--dash]', '[ünï]']) {
      const table = new sql.Table(name)
      table.columns.add('a', sql.Int, { nullable: true })
      assert.strictEqual(table.declare(), `create table ${table.path} ([a] int null)`, `declare() should write the path of ${JSON.stringify(name)} as it was built`)
    }
  })

  it('declare should accept a path set by hand that is a qualified name', () => {
    for (const path of ['dbo.t', '[db].[dbo].[t]', '"q".dbo.t', '[a]]b]', '[db]..[t]', '#tmp']) {
      assert.strictEqual(declared(path).declare(), `create table ${path} ([a] int null)`, `declare() should write the path ${JSON.stringify(path)} as it was set`)
    }
  })

  it('declare should write the path it read, so a second read cannot differ', () => {
    const table = declared()
    let reads = 0
    Object.defineProperty(table, 'path', { get () { return ++reads === 1 ? '[dbo].[t]' : '[t];x' } })
    assert.strictEqual(table.declare(), 'create table [dbo].[t] ([a] int null)', 'declare() should write the path it checked')
  })

  it('declare should reject a table name with a single ] when it names the primary key constraint', () => {
    const table = declared(undefined, 'a] x')
    table.columns.length = 0
    table.columns.add('a', sql.Int, { primary: true })
    table.columns.add('b', sql.Int, { primary: true })
    assert.throws(() => table.declare(), err => err.code === 'EINJECT' && /Invalid table name/.test(err.message),
      'declare() should reject a constraint name that the ] would end')
  })

  it('declare should check the constraint name of a temporary table as it is written, without its #', () => {
    for (const temporary of [true, false]) {
      const table = declared(undefined, ']]a b')
      table.temporary = temporary
      table.columns.length = 0
      table.columns.add('a', sql.Int, { primary: true })
      table.columns.add('b', sql.Int, { primary: true })
      if (temporary) {
        assert.throws(() => table.declare(), err => err.code === 'EINJECT',
          'declare() should reject a name whose first character it drops, leaving a single ]')
      } else {
        assert.match(table.declare(), /constraint \[PK_\]\]a b\] primary key/, 'declare() should keep a doubled ] in the constraint name')
      }
    }
  })

  it('declare should accept a path set by hand with any character a parameter name may hold', () => {
    for (const path of ['a・b', 'a･b', 'a\u200Cb', 'a\u200Db']) {
      assert.strictEqual(declared(path).declare(), `create table ${path} ([a] int null)`, `declare() should write the path ${JSON.stringify(path)} as it was set`)
    }
  })

  it('declare should accept a table name with a doubled ] in the primary key constraint', () => {
    const table = declared('[a]]b]', 'a]]b')
    table.columns.length = 0
    table.columns.add('a', sql.Int, { primary: true })
    table.columns.add('b', sql.Int, { primary: true })
    assert.strictEqual(table.declare(), 'create table [a]]b] ([a] int, [b] int, constraint [PK_a]]b] primary key ([a], [b]))',
      'declare() should write an escaped bracket in the constraint name unchanged')
  })
})

describe('table-valued parameter type name validation', () => {
  it('should accept type names that produce working SQL', () => {
    for (const name of ['MSSQLTestType', 'AI.UDT_StringArray', 'dbo.T1', '用户型',
      '[My Type]', 'dbo.[FR Space Type]', '[dbo].[FR Space Type]', '[a]]b]', 'dbo."My Type"']) {
      assert.strictEqual(declare(sql.TVP(name).type, sql.TVP(name)), `${name} readonly`,
        `TVP() should accept '${name}'`)
    }
  })

  it('should accept a type name the tedious driver takes from the value instead', () => {
    assert.doesNotThrow(() => declare(sql.TVP().type, sql.TVP()),
      'a missing type name should be left to the driver')
  })

  it('should accept a qualified name with an omitted part', () => {
    assert.strictEqual(declare(sql.TVP('mydb..MyType').type, sql.TVP('mydb..MyType')), 'mydb..MyType readonly',
      'an omitted schema should be accepted in a type name too')
    assert.throws(() => declare(sql.TVP('.MyType').type, sql.TVP('.MyType')), err => err.code === 'EINJECT',
      'a leading empty part should still be rejected')
  })

  it('should trim padding rather than refuse it', () => {
    assert.strictEqual(declare(sql.TVP('  dbo.T1  ').type, sql.TVP('  dbo.T1  ')), 'dbo.T1 readonly',
      'a padded type name should be trimmed')
  })

  it('should reject a type name that escapes the declaration, wherever it was set', () => {
    const payload = 'int; create table dbo.pwned (a int); --'
    // through the factory
    assert.throws(() => declare(sql.TVP(payload).type, sql.TVP(payload)),
      err => err.code === 'EINJECT', 'a hostile name given to TVP() should be rejected')
    // set on the descriptor afterwards, which does not go through the factory
    const descriptor = sql.TVP('dbo.Legit')
    descriptor.tvpType = payload
    assert.throws(() => declare(descriptor.type, descriptor),
      err => err.code === 'EINJECT', 'a name changed after construction should be rejected')
    // a descriptor built by hand, which never touches the factory at all
    assert.throws(() => declare(sql.TVP, { tvpType: payload }),
      err => err.code === 'EINJECT', 'a hand-built descriptor should be rejected')
  })
})

describe('type size validation', () => {
  it('should emit accepted sizes unchanged', () => {
    assert.strictEqual(declare(sql.VarChar, { length: 'max' }), 'varchar (max)', "'max' should pass through")
    assert.strictEqual(declare(sql.VarChar, { length: null }), 'varchar (MAX)', 'a missing length should become MAX')
    assert.strictEqual(declare(sql.VarChar, { length: 50 }), 'varchar (50)', 'a number should be emitted as given')
    assert.strictEqual(declare(sql.VarChar, { length: 9000 }), 'varchar (MAX)', 'an oversized length should become MAX')
    assert.strictEqual(declare(sql.VarChar, { length: Infinity }), 'varchar (MAX)', 'Infinity should ask for the maximum')
    assert.strictEqual(declare(sql.Decimal, { precision: 10, scale: 2 }), 'decimal (10, 2)', 'precision and scale should be emitted as given')
    assert.strictEqual(declare(sql.DateTime2, { scale: 3 }), 'datetime2 (3)', 'scale should be emitted as given')
  })

  it('should accept the values a caller can reasonably supply', () => {
    assert.strictEqual(declare(sql.VarChar, { length: '50 ' }), 'varchar (50)', 'padding should be trimmed')
    assert.strictEqual(declare(sql.VarChar, { length: ' 50' }), 'varchar (50)', 'padding should be trimmed')
    assert.strictEqual(declare(sql.VarChar, { length: 50n }), 'varchar (50)', 'a bigint should be accepted')
    // eslint-disable-next-line no-new-wrappers
    assert.strictEqual(declare(sql.VarChar, { length: new String('max') }), 'varchar (max)', 'a boxed string should be accepted')
    assert.strictEqual(declare(sql.NVarChar, { length: 'random' }), 'nvarchar (random)', 'a word the server will reject should still reach it')
  })

  it('should not require options for a type that takes no size', () => {
    assert.strictEqual(declare(sql.Int), 'int', 'a type with no size should declare without options')
    assert.strictEqual(declare(sql.Bit), 'bit', 'a type with no size should declare without options')
  })

  it('should reject sizes that escape the declaration', () => {
    const payload = '8000); create table dbo.pwned (a int); --'
    assert.throws(() => declare(sql.VarChar, { length: payload }), err => err.code === 'EINJECT',
      'a length that is not a number should be rejected')
    assert.throws(() => declare(sql.Decimal, { precision: payload, scale: 0 }), err => err.code === 'EINJECT',
      'a precision that is not a number should be rejected')
    assert.throws(() => declare(sql.DateTime2, { scale: payload }), err => err.code === 'EINJECT',
      'a scale that is not a number should be rejected')
  })

  it('should emit the value it checked, so a second read cannot differ', () => {
    let reads = 0
    const twoFaced = { toString () { return ++reads === 1 ? '50' : '8000); drop table dbo.t --' } }
    assert.strictEqual(declare(sql.VarChar, { length: twoFaced }), 'varchar (50)',
      'the checked value should be the one emitted')
  })

  it('should reject identifiers with a typed error', () => {
    assert.throws(() => declare(sql.VarChar, { length: 'a b' }), err => err instanceof sql.MSSQLError,
      'the rejection should be a library error, not a bare Error')
  })
})

describe('type declaration validation', () => {
  // A type that is not one of sql.TYPES writes its own declaration into the SQL that declares a
  // parameter or creates a table. None of these runs anything on its own: each only fails to
  // compile.
  const unsafe = ['int;x', 'int )', 'int x y', 'int--', '', 'int(5);x', 'int(5) x', 'nvarchar(50))', 'int(x)', 'int(5, 2, 1)']

  it('should write the declaration of every type in sql.TYPES as before', () => {
    for (const key of Object.keys(sql.TYPES)) {
      const type = sql.TYPES[key]
      assert.ok(declare(type, { tvpType: 'dbo.T' }).startsWith(key === 'TVP' ? 'dbo.T' : type.declaration), `sql.${key} should be declared as before`)
    }
  })

  it('should reject a type of its own whose declaration is not a type name', () => {
    for (const declaration of unsafe) {
      assert.throws(() => declare({ declaration }, {}), err => err.code === 'EINJECT' && /Invalid type declaration/.test(err.message),
        `the declaration ${JSON.stringify(declaration)} should be rejected`)
    }
  })

  it('should write the declaration of a type of its own that is a type name', () => {
    for (const declaration of ['int', 'dbo.MyType', '[my type]', 'nvarchar(50)', 'decimal(10, 2)', 'varchar (max)', 'VARCHAR(MAX)']) {
      assert.strictEqual(declare({ declaration }, {}), declaration, `the declaration ${JSON.stringify(declaration)} should be written as it is`)
    }
  })

  it('should write the declaration it read, so a second read cannot differ', () => {
    let reads = 0
    const type = { get declaration () { return ++reads === 1 ? 'int' : 'int;x' } }
    assert.strictEqual(declare(type, {}), 'int', 'the declaration written should be the one checked')
  })

  it('declare should reject a column whose type of its own has a declaration that is not a type name', () => {
    const table = new sql.Table('dbo.t')
    table.columns.add('a', sql.Int, { nullable: true })
    table.columns[0].type = { declaration: 'int;x' }
    assert.throws(() => table.declare(), err => err.code === 'EINJECT', 'declare() should reject the column type')
  })
})

describe('procedure name validation', () => {
  it('should accept the names a caller can reasonably supply', () => {
    assert.strictEqual(assertSafeProcedureName('sp_help'), 'sp_help', 'a bare name should be accepted')
    assert.strictEqual(assertSafeProcedureName('dbo.__test2'), 'dbo.__test2', 'a schema-qualified name should be accepted')
    assert.strictEqual(assertSafeProcedureName('[dbo].[__test2]'), '[dbo].[__test2]', 'a bracket-quoted name should be accepted')
    assert.strictEqual(assertSafeProcedureName('"dbo"."p"'), '"dbo"."p"', 'a double-quoted name should be accepted')
    assert.strictEqual(assertSafeProcedureName('db.dbo.p'), 'db.dbo.p', 'a database-qualified name should be accepted')
    assert.strictEqual(assertSafeProcedureName('#temp_proc'), '#temp_proc', 'a temporary procedure name should be accepted')
    assert.strictEqual(assertSafeProcedureName('[dbo].[my proc]'), '[dbo].[my proc]', 'a quoted name containing a space should be accepted')
    assert.strictEqual(assertSafeProcedureName(' dbo.p '), 'dbo.p', 'padding should be trimmed')
    assert.strictEqual(assertSafeProcedureName('srv.db.dbo.p'), 'srv.db.dbo.p', 'a four-part name should be accepted')
    assert.strictEqual(assertSafeProcedureName('master..sp_who'), 'master..sp_who', 'an omitted schema should be accepted')
    assert.strictEqual(assertSafeProcedureName('srv.db..proc'), 'srv.db..proc', 'an omitted intermediate part should be accepted')
    assert.strictEqual(assertSafeProcedureName('[db]..[proc]'), '[db]..[proc]', 'an omitted part between quoted parts should be accepted')
  })

  it('should emit the value it checked, so a second read cannot differ', () => {
    let reads = 0
    const name = { toString () { reads += 1; return reads <= 1 ? 'dbo.p' : 'dbo.p; drop table t --' } }
    assert.strictEqual(assertSafeProcedureName(name), 'dbo.p', 'the checked value should be the one returned')
  })

  it('should reject names that escape the exec', () => {
    for (const payload of [
      'dbo.p; create table dbo.pwned (a int); --',
      'dbo.p) ; select 1',
      'dbo.p --',
      'dbo p',
      'dbo.p\tselect 1',
      '.proc',
      'db..',
      '.',
      ''
    ]) {
      assert.throws(() => assertSafeProcedureName(payload), err => err.code === 'EINJECT',
        `${JSON.stringify(payload)} should be rejected`)
    }
  })
})

describe('transaction name', () => {
  const { EventEmitter } = require('events')
  const TediousTransaction = require('../../lib/tedious/transaction')

  // A pool holding one connection whose beginTransaction is supplied by the test.
  const setup = (tdsVersion, beginTransaction) => {
    const connection = new EventEmitter()
    connection.config = { options: { tdsVersion } }
    connection.beginTransaction = beginTransaction
    const pool = {
      acquired: 0,
      acquire (requester, callback) {
        pool.acquired++
        setImmediate(callback, null, connection, {})
        return pool
      },
      release () {
        return pool
      }
    }
    return pool
  }

  // Uses the callback form, so the result does not depend on whichever promise library is set.
  const begin = tx => new Promise((resolve, reject) => tx.begin(err => err ? reject(err) : resolve()))

  // Begin a transaction with the given name and report what the driver was asked to send.
  const sentName = (tdsVersion, name) => new Promise((resolve, reject) => {
    let sent
    const pool = setup(tdsVersion, (callback, n) => {
      sent = n
      setImmediate(callback, null)
    })
    const tx = new TediousTransaction(pool)
    tx.name = name
    tx.begin(err => err ? reject(err) : resolve(sent))
  })

  it('should send the name as a quoted identifier where the driver builds it into SQL', async () => {
    assert.strictEqual(await sentName('7_1', 'tx'), '[tx]', 'a plain name should be quoted')
    assert.strictEqual(await sentName('7_1', 'x;create table canary(z int)--'),
      '[x;create table canary(z int)--]', 'a name holding SQL should be quoted')
    assert.strictEqual(await sentName('7_1', 'commit'), '[commit]', 'a keyword should be quoted, or it runs as a statement')
    assert.strictEqual(await sentName('7_1', 'a];commit--'), '[a]];commit--]', 'a ] in the name should be doubled')
    assert.strictEqual(await sentName('7_1', ''), '', 'no name should be sent as no name')
    assert.strictEqual(await sentName('7_1', null), '', 'a null name should be sent as no name')
    assert.strictEqual(await sentName('7_1', undefined), '', 'an undefined name should be sent as no name')
  })

  it('should send the name as given where the driver sends it as data', async () => {
    for (const tdsVersion of ['7_2', '7_3_A', '7_3_B', '7_4']) {
      for (const name of ['tx', 'my tx', "x;drop table t;--'", '[x]', '']) {
        assert.strictEqual(await sentName(tdsVersion, name), name, `${JSON.stringify(name)} should be sent unchanged on TDS ${tdsVersion}`)
      }
    }
  })

  it('should send the name it read, so a second read cannot differ', async () => {
    let sent
    const pool = setup('7_1', (callback, n) => {
      sent = n
      setImmediate(callback, null)
    })
    const tx = new TediousTransaction(pool)
    let reads = 0
    Object.defineProperty(tx, 'name', { get () { return ++reads === 1 ? 'safe' : 'x;commit--' } })
    await begin(tx)
    assert.strictEqual(sent, '[safe]', 'the name sent should be the one first read')
  })

  it('should reject with what reading the name throws, without taking a connection', async () => {
    const thrown = new Error('no name')
    const pool = setup('7_4', () => assert.fail('beginTransaction should not be called'))
    const tx = new TediousTransaction(pool)
    Object.defineProperty(tx, 'name', { get () { throw thrown } })
    await assert.rejects(begin(tx), err => err === thrown, 'begin should reject with the error the name threw')
    assert.strictEqual(pool.acquired, 0, 'no connection should have been taken')
  })

  it('should reject a name that is not a string without taking a connection', async () => {
    for (const name of [5, true, ['tx'], { toString () { return 'tx' } }]) {
      const pool = setup('7_4', () => assert.fail('beginTransaction should not be called'))
      const tx = new TediousTransaction(pool)
      tx.name = name
      await assert.rejects(begin(tx), err => err instanceof sql.TransactionError && err.code === 'EINJECT',
        `${JSON.stringify(name)} should be rejected`)
      assert.strictEqual(pool.acquired, 0, 'no connection should have been taken')
    }
  })

  it('should reject a name longer than 32 UTF-16 code units without taking a connection', async () => {
    // 'é' is one code unit, '😀' is two
    for (const name of ['x'.repeat(33), 'é'.repeat(33), '😀'.repeat(16) + 'x', 'x'.repeat(128)]) {
      for (const tdsVersion of ['7_1', '7_4']) {
        const pool = setup(tdsVersion, () => assert.fail('beginTransaction should not be called'))
        const tx = new TediousTransaction(pool)
        tx.name = name
        await assert.rejects(begin(tx), err => err instanceof sql.TransactionError && err.code === 'EINJECT',
          `a name of ${name.length} code units should be rejected on TDS ${tdsVersion}`)
        assert.strictEqual(pool.acquired, 0, 'no connection should have been taken')
      }
    }
  })

  it('should send a name of 32 UTF-16 code units', async () => {
    for (const name of ['x'.repeat(32), '😀'.repeat(16), ']'.repeat(32)]) {
      assert.strictEqual(await sentName('7_4', name), name, `a name of ${name.length} code units should be sent on TDS 7.4`)
      assert.strictEqual(await sentName('7_1', name), `[${name.replace(/]/g, ']]')}]`, `a name of ${name.length} code units should be sent quoted on TDS 7.1`)
    }
  })
})

describe('msnodesqlv8 bulk load table names', () => {
  const Module = require('module')

  // msnodesqlv8's table manager looks a bulk load's table up by writing the name it is given
  // into a query of its own, then builds an INSERT from what it found. The stub stands in for
  // the driver; its table manager records the names it is given and finds `found` for each.
  const STUB = 'msnodesqlv8-stub'
  const REQUEST = require.resolve('../../lib/msnodesqlv8/request')
  let resolveFilename
  let Request

  before(() => {
    resolveFilename = Module._resolveFilename
    Module._resolveFilename = function (request, ...rest) {
      return request === 'msnodesqlv8' ? STUB : resolveFilename.call(this, request, ...rest)
    }
    require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: {} }
    delete require.cache[REQUEST]
    Request = require(REQUEST)
  })

  after(() => {
    Module._resolveFilename = resolveFilename
    delete require.cache[STUB]
    delete require.cache[REQUEST]
  })

  // a column as the table manager reports it, in a table the server found
  const column = (name, catalog = 'db', extra = {}) => Object.assign({ name, table_catalog: catalog, table_schema: 'dbo', table_name: 't' }, extra)

  const setup = (found = [column('a')]) => {
    const bound = []
    const inserted = []
    const queried = []
    const connection = {
      setUseNumericString () {},
      queryRaw (statement, callback) {
        queried.push(statement)
        setImmediate(callback, null)
      },
      tableMgr: () => ({
        bind (name, callback) {
          bound.push(name)
          setImmediate(callback, {
            columns: found,
            insertRows (rows, done) {
              inserted.push(rows)
              setImmediate(done, null)
            }
          })
        }
      })
    }
    const pool = {
      connected: true,
      config: {},
      acquired: 0,
      released: 0,
      acquire (request, callback) {
        this.acquired++
        callback(null, connection, { requestTimeout: 15000 })
      },
      release () { this.released++ }
    }
    return { request: new Request(pool), pool, bound, inserted, queried }
  }

  const table = (name, create = false) => {
    const t = new sql.Table(name)
    t.create = create
    t.columns.add('a', sql.Int, { nullable: true })
    t.rows.add(1)
    return t
  }

  // the callback form, so that a Promise library another test set on `sql` is not used here
  const bulk = (request, t) => new Promise((resolve, reject) => {
    request.bulk(t, (err, result) => err ? reject(err) : resolve(result))
  })

  const rejectsAsInjection = async (bulk, message) => {
    await assert.rejects(bulk, err => {
      assert.ok(err instanceof sql.RequestError, `the rejection should be a RequestError, got ${err}`)
      assert.strictEqual(err.code, 'EINJECT', 'the rejection should carry the identifier error code')
      assert.match(err.message, message, `the rejection should say why, got '${err.message}'`)
      return true
    })
  }

  // Rejected before a connection is borrowed, so neither the table manager nor the server
  // should see the name, even when the table is to be created.
  const rejectsBeforeBorrowing = async (names, message) => {
    for (const name of names) {
      for (const create of [false, true]) {
        const { request, pool, bound, queried } = setup()
        await rejectsAsInjection(bulk(request, table(name, create)), message)
        assert.deepStrictEqual(bound, [], `the table manager should not be given '${name}'`)
        assert.deepStrictEqual(queried, [], `no statement should be sent for '${name}'`)
        assert.strictEqual(pool.acquired, 0, `a connection should not be borrowed for '${name}'`)
      }
    }
  }

  // Rejected once the table manager has found the table, so the connection that was borrowed
  // should go back, and no row should be sent.
  const rejectsAfterLookup = async (found, t, message) => {
    const { request, pool, bound, inserted } = setup(found)
    await rejectsAsInjection(bulk(request, t), message)
    assert.strictEqual(bound.length, 1, `the table manager should be given '${t.path}' to look up`)
    assert.deepStrictEqual(inserted, [], `there should be no INSERT into '${t.path}'`)
    assert.strictEqual(pool.acquired, 1, 'one connection should be borrowed')
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  }

  const loads = async (names, found) => {
    for (const [name, expected] of Object.entries(names)) {
      const { request, pool, bound, inserted } = setup(found)
      const result = await bulk(request, table(name))
      assert.deepStrictEqual(bound, [expected], `the table manager should be given '${expected}' for '${name}'`)
      assert.deepStrictEqual(inserted, [[{ a: 1 }]], `the row should be inserted into '${name}'`)
      assert.strictEqual(result.rowsAffected, 1, `the bulk load into '${name}' should report the row`)
      assert.strictEqual(pool.released, 1, 'the connection should be released once')
    }
  }

  // names that are looked up today and found, whose bulk loads therefore work
  it('should give the table manager the name it was given before', async () => {
    await loads({
      plain: 'plain',
      'dbo.plain': 'dbo.plain',
      'mydb.dbo.plain': 'mydb.dbo.plain',
      '[mydb].[dbo].[plain]': 'mydb.dbo.plain',
      'notexistingdb.dbo.plain': 'notexistingdb.dbo.plain',
      '#temp': '#temp',
      '##global_temp': '##global_temp',
      '#tëmp_$1': '#tëmp_$1',
      '[with space]': 'with space',
      '[my schema].[dash-name]': 'my schema.dash-name',
      'dbo.[semi;colon]': 'dbo.semi;colon',
      '[dash--dash]': 'dash--dash',
      '[slash/*star*/]': 'slash/*star*/',
      '[close)paren]': 'close)paren',
      '[double"quote]': 'double"quote',
      '[ünï]': 'ünï',
      // a `$` is only replaced by the table manager when a `, ' or & follows it
      'dbo.[cost$]': 'dbo.cost$',
      'dbo.[a$1]': 'dbo.a$1',
      // a doubled quote is read as one by the table manager's lookup
      "[O''Brien]": "O''Brien",
      "[O''Schema].plain": "O''Schema.plain",
      // the table manager splits this on its `.` and looks up table b in schema a
      '[a.b]': 'a.b'
    })
  })

  it('should give the table manager a database name with space around it or in double quotes as before', async () => {
    await loads({
      '"mydb".dbo.plain': '"mydb".dbo.plain',
      '"my db".[dbo].[plain]': '"my db".dbo.plain',
      '[mydb ].dbo.plain': 'mydb .dbo.plain',
      '[ mydb].dbo.plain': ' mydb.dbo.plain',
      '[\tmydb\n].dbo.plain': '\tmydb\n.dbo.plain',
      // the server reads these as space, though JavaScript does not
      '[mydb\u0085].dbo.plain': 'mydb\u0085.dbo.plain',
      '[mydb\u200b].dbo.plain': 'mydb\u200b.dbo.plain',
      '[ "mydb" ].dbo.plain': ' "mydb" .dbo.plain'
    })
  })

  it('should reject a table or schema name that would end the quoted string it is looked up by', async () => {
    await rejectsBeforeBorrowing([
      "[O'Brien]",
      "[O'''Brien]",
      "dbo.[it's]",
      "[it's].plain",
      "mydb.[dbo'].plain"
    ], /quoted string/)
  })

  it('should reject a database name that is neither a bare identifier nor in double quotes', async () => {
    await rejectsBeforeBorrowing([
      '[my db].dbo.plain',
      '[my;db].dbo.plain',
      '[my-db].dbo.plain',
      "[d''b].dbo.plain",
      '[my/*db*/].dbo.plain',
      // NUL is not space to the server
      '[mydb\0].dbo.plain',
      '"mydb.dbo.plain',
      '[mydb"].dbo.plain',
      '[my"d"b].dbo.plain',
      '[""].dbo.plain',
      // a part before the database is held to the same rule, though the table manager drops it
      '[my server.mydb].dbo.plain'
    ], /database name/)
  })

  it('should reject a database name with a quote in it, with space around it or in double quotes', async () => {
    await rejectsBeforeBorrowing([
      "[d'b].dbo.plain",
      "\"my'db\".dbo.plain",
      "\"mydb'\".dbo.plain",
      "[my'db ].dbo.plain",
      "[ 'mydb].dbo.plain"
    ], /database name/)
  })

  it('should reject a temporary table name that is not a bare identifier', async () => {
    await rejectsBeforeBorrowing([
      '[#with space]',
      '[#dash-name]',
      '[#semi;colon]',
      "[#O''Brien]",
      '[#temp ]',
      '[my db].dbo.#temp'
    ], /temporary table/)
  })

  it('should reject a name with a $ that the table manager would replace with part of its query', async () => {
    await rejectsBeforeBorrowing([
      'dbo.[a$&b]',
      'dbo.[a$`b]',
      "dbo.[a$''b]",
      '[a$&b].plain',
      '"my$&db".dbo.plain',
      '"my$`db".dbo.plain'
    ], /replaces/)
  })

  it('should check the path the table manager is given, not the name the table was made with', async () => {
    const { request, pool, bound } = setup()
    const t = table('plain')
    t.path = "[it's]"
    await rejectsAsInjection(bulk(request, t), /quoted string/)
    assert.deepStrictEqual(bound, [], 'the table manager should not be given a path set after the table was made')
    assert.strictEqual(pool.acquired, 0, 'a connection should not be borrowed')
  })

  it('should give the table manager the path that was checked', async () => {
    const { request, pool, bound } = setup()
    const t = table('plain')
    // a path that changes once the connection is borrowed, after it was checked
    Object.defineProperty(t, 'path', {
      get () { return pool.acquired ? "[it's]" : '[plain]' },
      configurable: true
    })
    await bulk(request, t)
    assert.deepStrictEqual(bound, ['plain'], 'the table manager should be given the path as it was checked')
  })

  it('should reject a table in tempdb with a part that is neither bare nor in double quotes, once it is found', async () => {
    // the connection's own database can be tempdb, so a name found there need not say so
    for (const name of ['[with space]', 'tempdb.dbo.[with space]', 'TEMPDB.dbo.[semi;colon]', '[tempdb ].dbo.[a b]', 'tempdb.dbo.[a"b]', '"tempdb".dbo.[""]']) {
      await rejectsAfterLookup([column('a', 'tempdb')], table(name, true), /in tempdb/)
    }
  })

  it('should load a table in tempdb whose parts are bare, have space around them or are in double quotes', async () => {
    await loads({
      '#temp': '#temp',
      'tempdb.dbo.plain': 'tempdb.dbo.plain',
      plain: 'plain',
      '[tempdb ].dbo.plain': 'tempdb .dbo.plain',
      '"tempdb".dbo.plain': '"tempdb".dbo.plain',
      'tempdb.dbo."plain table"': 'tempdb.dbo."plain table"',
      'dbo."plain table"': 'dbo."plain table"'
    }, [column('a', 'tempdb')])
  })

  it('should reject a table whose name, as the server reports it, contains a ]', async () => {
    // the table manager writes the names it found as `[database].[schema].[table]`
    for (const key of ['table_catalog', 'table_schema', 'table_name']) {
      await rejectsAfterLookup([column('a', 'db', { [key]: 'x]y' }), column('b')], table('plain'), /Invalid table name '[^']*x\]y/)
    }
  })

  it('should load a table in tempdb by the name it was given, whatever the server reports its name as', async () => {
    // the table manager writes a table in tempdb as the name it was given, not the name it found
    await loads({ '#temp': '#temp' }, [column('a', 'tempdb', { table_schema: 'x]y', table_name: '#temp]' })])
  })

  it('should reject a table with a column the driver would write with a ] in its name', async () => {
    // node-mssql creates `a]]b` as the column `a]b`, which the driver then writes as `[a]b]`
    const t = table('plain', true)
    t.columns.add('a]]b', sql.Int, { nullable: true })
    t.rows[0].push(2)
    await rejectsAfterLookup([column('a'), column('a]b')], t, /Invalid column name 'a\]b'/)
  })

  it('should load a table whose only column with a ] in its name is one the driver does not write', async () => {
    const readOnly = [
      column('i]d', 'db', { is_identity: true }),
      column('c]c', 'db', { isReadOnly: () => true })
    ]
    await loads({ plain: 'plain' }, [column('a'), ...readOnly])
  })

  it('should reject a path set by hand that is not a qualified name, before borrowing, when the table is to be created', async () => {
    for (const path of ['[t];x', 'dbo.t x']) {
      const { request, pool, bound, queried } = setup()
      const t = table('dbo.t', true)
      t.path = path
      await rejectsAsInjection(bulk(request, t), /Invalid table name/)
      assert.deepStrictEqual(bound, [], `the table manager should not be given ${JSON.stringify(path)}`)
      assert.deepStrictEqual(queried, [], `no statement should be sent for ${JSON.stringify(path)}`)
      assert.strictEqual(pool.acquired, 0, `a connection should not be borrowed for ${JSON.stringify(path)}`)
    }
  })

  it('should give the table manager a path set by hand as before when the table is not to be created', async () => {
    const { request, bound, inserted } = setup()
    const t = table('dbo.t')
    t.path = 'dbo.my table'
    await bulk(request, t)
    assert.deepStrictEqual(bound, ['dbo.my table'], 'the table manager should be given the path it was given before')
    assert.deepStrictEqual(inserted, [[{ a: 1 }]], 'the row should be inserted')
  })
})

describe('tedious bulk load table path', () => {
  const TediousRequest = require('../../lib/tedious/request')
  const { EventEmitter } = require('events')

  // tedious writes the table's path as it is into `insert bulk`. The connection stands in for
  // tedious and records the path it is given.
  const setup = () => {
    const paths = []
    const batches = []
    const connection = Object.assign(new EventEmitter(), {
      cancel () {},
      newBulkLoad (path, options, done) {
        paths.push(path)
        return { addColumn () {}, done }
      },
      execBulkLoad (bulk, rows) {
        setImmediate(bulk.done, null, rows.length)
      },
      execSqlBatch (req) {
        batches.push(req.sqlTextOrProcedure)
        setImmediate(() => req.callback(null))
      }
    })
    const pool = {
      connected: true,
      config: {},
      acquired: 0,
      released: 0,
      acquire (request, callback) {
        this.acquired++
        callback(null, connection, {})
      },
      release () { this.released++ }
    }
    return { request: new TediousRequest(pool), pool, paths, batches }
  }

  const table = (path, create = false) => {
    const t = new sql.Table('dbo.t')
    if (path !== undefined) t.path = path
    t.create = create
    t.columns.add('a', sql.Int, { nullable: true })
    t.rows.add(1)
    return t
  }

  // the callback form, so that a Promise library another test set on `sql` is not used here
  const bulk = (request, t) => new Promise((resolve, reject) => {
    request.bulk(t, (err, result) => err ? reject(err) : resolve(result))
  })

  it('should reject a path that is not a qualified name before borrowing a connection', async () => {
    for (const path of ['[t];x', 'dbo.t x', '[a]b]']) {
      for (const create of [false, true]) {
        const { request, pool, paths, batches } = setup()
        await assert.rejects(bulk(request, table(path, create)), err => err instanceof sql.RequestError && err.code === 'EINJECT',
          `the path ${JSON.stringify(path)} should be rejected with EINJECT`)
        assert.strictEqual(pool.acquired, 0, `a connection should not be borrowed for ${JSON.stringify(path)}`)
        assert.deepStrictEqual(paths, [], `tedious should not be given ${JSON.stringify(path)}`)
        assert.deepStrictEqual(batches, [], `no statement should be sent for ${JSON.stringify(path)}`)
      }
    }
  })

  it('should give tedious the path the table was built with', async () => {
    for (const create of [false, true]) {
      const { request, pool, paths } = setup()
      const result = await bulk(request, table(undefined, create))
      assert.deepStrictEqual(paths, ['[dbo].[t]'], 'tedious should be given the path as it was built')
      assert.strictEqual(result.rowsAffected, 1, 'the bulk load should report the row')
      assert.strictEqual(pool.released, 1, 'the connection should be released once')
    }
  })

  it('should look the table up by the path as a string, not by a replace() of its own', async () => {
    const { request, batches } = setup()
    const path = { toString: () => '[dbo].[t]', trim: () => '[dbo].[t]', replace: () => 'REPLACED' }
    await bulk(request, table(path, true))
    assert.strictEqual(batches.length, 1, 'one create statement should be sent')
    assert.ok(batches[0].startsWith("if object_id('[dbo].[t]') is null create table [dbo].[t] "), `the create statement should look the table up by its path, got ${batches[0]}`)
    assert.ok(!batches[0].includes('REPLACED'), 'the path\'s own replace() should not be used')
  })

  it('should look the table up by the path it creates, with the space around it removed', async () => {
    const { request, batches, paths } = setup()
    await bulk(request, table(' [dbo].[t] ', true))
    assert.ok(batches[0].startsWith("if object_id('[dbo].[t]') is null create table [dbo].[t] "), `the table looked up should be the one created, got ${batches[0]}`)
    assert.deepStrictEqual(paths, ['[dbo].[t]'], 'tedious should be given the path without the space around it')
  })

  it('should refuse a column type that tedious has no type for, before borrowing a connection', async () => {
    for (const create of [false, true]) {
      const { request, pool, paths, batches } = setup()
      const t = table(undefined, create)
      t.columns[0].type = { declaration: 'int' }
      await assert.rejects(bulk(request, t), err => err instanceof sql.RequestError && /cannot bulk load/.test(err.message),
        'a column type tedious cannot bulk load should be refused')
      assert.strictEqual(pool.acquired, 0, 'a connection should not be borrowed')
      assert.deepStrictEqual(paths, [], 'tedious should not be given the table')
      assert.deepStrictEqual(batches, [], 'no statement should be sent')
    }
  })

  it('should bulk load a column whose type is a tedious type given directly', async () => {
    const { request, paths } = setup()
    const t = table()
    t.columns[0].type = require('tedious').TYPES.Int
    const result = await bulk(request, t)
    assert.deepStrictEqual(paths, ['[dbo].[t]'], 'tedious should be given the table')
    assert.strictEqual(result.rowsAffected, 1, 'the bulk load should report the row')
  })

  it('should refuse a column type that changes after it was checked, and release the connection', async () => {
    const { request, pool, paths } = setup()
    const t = table()
    let reads = 0
    Object.defineProperty(t.columns[0], 'type', { get () { return ++reads <= 2 ? sql.Int().type : { declaration: 'int' } } })
    await assert.rejects(bulk(request, t), err => /cannot bulk load/.test(err.message), 'a column type that changed should be refused where tedious is given it')
    assert.deepStrictEqual(paths, ['[dbo].[t]'], 'the bulk load should have been started')
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  it('should give tedious the path it checked, so a later read cannot differ', async () => {
    const { request, paths } = setup()
    const t = table()
    let reads = 0
    Object.defineProperty(t, 'path', { get () { return ++reads === 1 ? '[dbo].[t]' : '[t];x' } })
    await assert.rejects(bulk(request, t), err => err.code === 'EINJECT', 'a path that changes after it was checked should be rejected where it is written')
    assert.deepStrictEqual(paths, [], 'tedious should not be given the changed path')
  })
})

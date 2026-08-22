'use strict'

/* globals describe, it, afterEach */

const sql = require('../../')
const assert = require('assert')
const udt = require('../../lib/udt')
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

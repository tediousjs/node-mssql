'use strict'

/* globals describe, it */

const sql = require('../../')
const assert = require('assert')
const cs = require('../../lib/connectionstring')
const udt = require('../../lib/udt')
const BasePool = require('../../lib/base/connection-pool')

describe('Connection String', () => {
  it('Connection String #1', done => {
    const cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd')

    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, undefined)

    return done()
  })

  it('Connection String #2', done => {
    const cfg = cs.resolve('Server=tcp:192.168.0.1,1433;Database=testdb;User Id=testuser;Password=testpwd;TrustServerCertificate=true')

    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, 1433)
    assert.strictEqual(cfg.options.trustServerCertificate, true)

    return done()
  })

  it('Connection String #3', done => {
    const cfg = cs.resolve("Server=192.168.0.1;Database=testdb;User Id={testuser};Password='t;estpwd'", 'msnodesqlv8')

    assert.strictEqual(cfg.connectionString, "Server=192.168.0.1;Database=testdb;User Id={testuser};Password='t;estpwd';Driver={SQL Server Native Client 11.0}")

    return done()
  })

  it('Connection String #4', done => {
    const cfg = cs.resolve('mssql://username:password@localhost:1433/database?encrypt=true&stream=true&domain=mydomain&requestTimeout=30000')

    assert.strictEqual(cfg.user, 'username')
    assert.strictEqual(cfg.password, 'password')
    assert.strictEqual(cfg.database, 'database')
    assert.strictEqual(cfg.server, 'localhost')
    assert.strictEqual(cfg.domain, 'mydomain')
    assert.strictEqual(cfg.port, 1433)
    assert.strictEqual(cfg.options.encrypt, true)
    assert.strictEqual(cfg.requestTimeout, 30000)

    return done()
  })

  it('Connection String #5', done => {
    const cfg = cs.resolve('mssql://username:password@localhost/INSTANCE/database?encrypt=true&stream=true&domain=mydomain', 'msnodesqlv8')

    assert.strictEqual(cfg.connectionString, 'server={localhost\\INSTANCE};uid={mydomain\\username};pwd={password};database={database};encrypt={true};driver={SQL Server Native Client 11.0}')

    return done()
  })

  it('Connection String #6 (multiSubnetFailover)', done => {
    const cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd;MultiSubnetFailover=True')

    assert.strictEqual(cfg.options.multiSubnetFailover, true)
    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, undefined)

    return done()
  })

  it('Connection String #7 (connection timeout)', done => {
    const cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd;Connection Timeout=30')
    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, undefined)
    assert.strictEqual(cfg.connectionTimeout, 30000)

    return done()
  })

  it('Connection String #8 (url encoding)', done => {
    const cfg = cs.resolve('mssql://username:password%23@localhost:1433/database?encrypt=true')
    assert.strictEqual(cfg.user, 'username')
    assert.strictEqual(cfg.password, 'password#')
    assert.strictEqual(cfg.database, 'database')
    assert.strictEqual(cfg.server, 'localhost')
    assert.strictEqual(cfg.port, 1433)
    assert.strictEqual(cfg.options.encrypt, true)

    return done()
  })

  it('Pulls out read only ApplicationIntent', done => {
    const cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd;Connection Timeout=30;ApplicationIntent=ReadOnly')
    assert.strictEqual(cfg.options.readOnlyIntent, true)

    return done()
  })

  it('Pulls out read write ApplicationIntent', done => {
    const cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd;Connection Timeout=30;ApplicationIntent=ReadWrite')
    assert.strictEqual(cfg.options.readOnlyIntent, false)

    return done()
  })
})

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
    assert.strictEqual(t.declare(), 'create table [#mytemptable] ([a] int, [b] tinyint null, [c] tinyint not null, constraint PK_mytemptable primary key (a, c))')

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
        input: input,
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
        input: input,
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

describe('Geography Parsing', () => {
  it('polygon v1', () => {
    // select geography::STGeomFromText(N'POLYGON((1 1, 3 1, 3 7, 1 1))',4326)
    const buffer = Buffer.from('E6100000010404000000000000000000F03F000000000000F03F000000000000F03F00000000000008400000000000001C400000000000000840000000000000F03F000000000000F03F01000000020000000001000000FFFFFFFF0000000003', 'hex')
    const geo = udt.PARSERS.geography(buffer)

    assert.strictEqual(geo.version, 1)
    assert.strictEqual(geo.srid, 4326)
    assert.strictEqual(geo.points.length, 4)
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

    assert.strictEqual(geo.version, 2)
    assert.strictEqual(geo.srid, 4326)
    assert.strictEqual(geo.points.length, 4)
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

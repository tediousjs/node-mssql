'use strict'

/* globals describe, it */

const sql = require('../../')
const assert = require('assert')
const cs = require('../../lib/connectionstring')

describe('Connection String', () => {
  it('Connection String #1', done => {
    let cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd')

    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, undefined)

    return done()
  })

  it('Connection String #2', done => {
    let cfg = cs.resolve('Server=tcp:192.168.0.1,1433;Database=testdb;User Id=testuser;Password=testpwd')

    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, 1433)

    return done()
  })

  it('Connection String #3', done => {
    let cfg = cs.resolve("Server=192.168.0.1;Database=testdb;User Id={testuser};Password='t;estpwd'", 'msnodesqlv8')

    assert.strictEqual(cfg.connectionString, "Server=192.168.0.1;Database=testdb;User Id={testuser};Password='t;estpwd';Driver={SQL Server Native Client 11.0}")

    return done()
  })

  it('Connection String #4', done => {
    let cfg = cs.resolve('mssql://username:password@localhost:1433/database?encrypt=true&stream=true&domain=mydomain&requestTimeout=30000')

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
    let cfg = cs.resolve('mssql://username:password@localhost/INSTANCE/database?encrypt=true&stream=true&domain=mydomain', 'msnodesqlv8')

    assert.strictEqual(cfg.connectionString, 'server={localhost\\INSTANCE};uid={mydomain\\username};pwd={password};database={database};encrypt={true};driver={SQL Server Native Client 11.0}')

    return done()
  })

  it('Connection String #6 (multiSubnetFailover)', done => {
    let cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd;MultiSubnetFailover=True')

    assert.strictEqual(cfg.options.multiSubnetFailover, true)
    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, undefined)

    return done()
  })

  it('Connection String #7 (connection timeout)', done => {
    let cfg = cs.resolve('Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd;Connection Timeout=30')
    assert.strictEqual(cfg.user, 'testuser')
    assert.strictEqual(cfg.password, 'testpwd')
    assert.strictEqual(cfg.database, 'testdb')
    assert.strictEqual(cfg.server, '192.168.0.1')
    assert.strictEqual(cfg.port, undefined)
    assert.strictEqual(cfg.connectionTimeout, 30000)

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
    assert.deepEqual(t.rows[3], [12, 'XCXCDCDSCDSC'])
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

    let rs = [
      { 'a': { 'b': { 'c': 1, 'd': 2 }, 'x': 3, 'y': 4 } }
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
    assert.deepEqual(t.rows[0], ['{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}'])

    t = new sql.Table('MyTable')
    t.columns.add('a', sql.Int, { primary: true })
    t.columns.add('b', sql.TinyInt, { nullable: true })
    assert.strictEqual(t.declare(), 'create table [MyTable] ([a] int primary key, [b] tinyint null)')

    t = new sql.Table('#mytemptable')
    t.columns.add('a', sql.Int, { primary: true })
    t.columns.add('b', sql.TinyInt, { nullable: true })
    t.columns.add('c', sql.TinyInt, { nullable: false, primary: true })
    assert.strictEqual(t.declare(), 'create table [#mytemptable] ([a] int, [b] tinyint null, [c] tinyint not null, constraint PK_mytemptable primary key (a, c))')

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

    assert.deepEqual(query`select * from myTable where id = ${123}`, {
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

    assert.deepEqual(query`select * from myTable where id in (${[1, 2, 3]})`, {
      input: [['param1_0', 1], ['param1_1', 2], ['param1_2', 3]],
      command: 'select * from myTable where id in (@param1_0, @param1_1, @param1_2)'
    })
  })
})

'use strict'

/* globals describe, it, afterEach */

const sql = require('../../')
const assert = require('node:assert')
const udt = require('../../lib/udt')
const BasePool = require('../../lib/base/connection-pool')
const ConnectionPool = require('../../lib/tedious/connection-pool')

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

describe('connection string auth - base', () => {
  it('parses basic login', () => {
    const config = BasePool._parseConnectionString('Server=database.test.com;Database=test;User Id=test;Password=admin')
    assert.deepEqual(config, {
      database: 'test',
      options: {},
      password: 'admin',
      pool: {},
      port: 1433,
      server: 'database.test.com',
      user: 'test'
    })
  })

  it('parses basic login with explicit Sql Password as Authentication', () => {
    const config = BasePool._parseConnectionString('Authentication=Sql Password;Server=database.test.com;Database=test;User Id=test;Password=admin')
    assert.deepEqual(config, {
      authentication_type: 'default',
      database: 'test',
      options: {},
      password: 'admin',
      pool: {},
      port: 1433,
      server: 'database.test.com',
      user: 'test'
    })
  })

  it('parses active directory password', () => {
    const config = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Password;User Id=username;Password=password;Client Id=clientid;Tenant Id=tenantid;Encrypt=true')
    assert.deepEqual(config, {
      authentication_type: 'azure-active-directory-password',
      database: 'test',
      options: {
        encrypt: true
      },
      password: 'password',
      pool: {},
      port: 1433,
      server: '*.database.windows.net',
      user: 'username',
      clientId: 'clientid',
      tenantId: 'tenantid'
    })
  })

  it('parses active directory integrated token authentication', () => {
    const config = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;token=token;Encrypt=true')
    assert.deepEqual(config, {
      authentication_type: 'azure-active-directory-access-token',
      database: 'test',
      options: {
        encrypt: true
      },
      pool: {},
      port: 1433,
      server: '*.database.windows.net',
      token: 'token'
    })
  })

  it('parses active directory integrated client secret authentication', () => {
    const config = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;Client secret=clientsecret;Client Id=clientid;Tenant Id=tenantid;Encrypt=true')
    assert.deepEqual(config, {
      authentication_type: 'azure-active-directory-service-principal-secret',
      database: 'test',
      options: {
        encrypt: true
      },
      pool: {},
      port: 1433,
      server: '*.database.windows.net',
      clientId: 'clientid',
      tenantId: 'tenantid',
      clientSecret: 'clientsecret'
    })
  })

  it('parses active directory integrated managed service identity app vm', () => {
    const config = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;msi endpoint=msiendpoint;Client Id=clientid;Encrypt=true')
    assert.deepEqual(config, {
      authentication_type: 'azure-active-directory-msi-vm',
      database: 'test',
      options: {
        encrypt: true
      },
      pool: {},
      port: 1433,
      server: '*.database.windows.net',
      clientId: 'clientid',
      msiEndpoint: 'msiendpoint'
    })
  })

  it('parses active directory integrated managed service identity app service', () => {
    const config = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;msi endpoint=msiendpoint;Client Id=clientid;msi secret=msisecret;Encrypt=true')
    assert.deepEqual(config, {
      authentication_type: 'azure-active-directory-msi-app-service',
      database: 'test',
      options: {
        encrypt: true
      },
      pool: {},
      port: 1433,
      server: '*.database.windows.net',
      clientId: 'clientid',
      msiEndpoint: 'msiendpoint',
      msiSecret: 'msisecret'
    })
  })
})

describe('connection string auth - tedious', () => {
  it('parses basic login', () => {
    const baseConfig = BasePool._parseConnectionString('Server=database.test.com;Database=test;User Id=test;Password=admin')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: 'database.test.com',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'default',
        options: {
          userName: 'test',
          password: 'admin'
        }
      }
    })
  })

  it('parses basic login with explicit Sql Password as Authentication', () => {
    const baseConfig = BasePool._parseConnectionString('Authentication=Sql Password;Server=database.test.com;Database=test;User Id=test;Password=admin')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: 'database.test.com',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'default',
        options: {
          userName: 'test',
          password: 'admin'
        }
      }
    })
  })

  it('parses active directory password', () => {
    const baseConfig = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Password;User Id=username;Password=password;Client Id=clientid;Tenant Id=tenantid;Encrypt=true')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: '*.database.windows.net',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'azure-active-directory-password',
        options: {
          userName: 'username',
          password: 'password',
          clientId: 'clientid',
          tenantId: 'tenantid'
        }
      }
    })
  })

  it('parses active directory integrated token authentication', () => {
    const baseConfig = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;token=token;Encrypt=true')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: '*.database.windows.net',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'azure-active-directory-access-token',
        options: {
          token: 'token'
        }
      }
    })
  })

  it('parses active directory integrated client secret authentication', () => {
    const baseConfig = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;Client secret=clientsecret;Client Id=clientid;Tenant Id=tenantid;Encrypt=true')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: '*.database.windows.net',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'azure-active-directory-service-principal-secret',
        options: {
          clientId: 'clientid',
          clientSecret: 'clientsecret',
          tenantId: 'tenantid'
        }
      }
    })
  })

  it('parses active directory integrated managed service identity app vm', () => {
    const baseConfig = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;msi endpoint=msiendpoint;Client Id=clientid;Encrypt=true')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: '*.database.windows.net',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'azure-active-directory-msi-vm',
        options: {
          clientId: 'clientid',
          msiEndpoint: 'msiendpoint'
        }
      }
    })
  })

  it('parses active directory integrated managed service identity app service', () => {
    const baseConfig = BasePool._parseConnectionString('Server=*.database.windows.net;Database=test;Authentication=Active Directory Integrated;msi endpoint=msiendpoint;Client Id=clientid;msi secret=msisecret;Encrypt=true')
    const config = new ConnectionPool(baseConfig)._config()
    assert.deepEqual(config, {
      server: '*.database.windows.net',
      options: {
        encrypt: true,
        trustServerCertificate: false,
        database: 'test',
        port: 1433,
        connectTimeout: 15000,
        requestTimeout: 15000,
        tdsVersion: '7_4',
        rowCollectionOnDone: false,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        appName: 'node-mssql'
      },
      authentication: {
        type: 'azure-active-directory-msi-app-service',
        options: {
          clientId: 'clientid',
          msiEndpoint: 'msiendpoint',
          msiSecret: 'msisecret'
        }
      }
    })
  })
})

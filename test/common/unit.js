'use strict'

/* globals describe, it, before, after, afterEach */

const sql = require('../../')
const assert = require('node:assert')
const { Readable, Writable } = require('node:stream')
const udt = require('../../lib/udt')
const { assertSafeProcedureName } = require('../../lib/utils')
const { declare } = require('../../lib/datatypes')
const BasePool = require('../../lib/base/connection-pool')
const ConnectionPool = require('../../lib/tedious/connection-pool')

require('./diagnostics')

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

  it('bulk loads converted types as max', () => {
    const t = new sql.Table('MyTable')
    t.columns.add('x', sql.Xml, { nullable: true })
    t.columns.add('u', sql.UDT, { nullable: true })
    t.columns.add('g', sql.Geography, { nullable: true })
    t.columns.add('m', sql.Geometry, { nullable: true })
    t.columns.add('n', sql.UDT, { nullable: true, length: 50 })
    t._makeBulk()

    assert.strictEqual(t.columns[0].type, sql.NVarChar, 'an Xml column should be bulk loaded as an NVarChar')
    assert.strictEqual(t.columns[0].length, sql.MAX, 'an Xml column should be bulk loaded as max')
    for (const col of t.columns.slice(1, 4)) {
      assert.strictEqual(col.type, sql.VarBinary, `the ${col.name} column should be bulk loaded as a VarBinary`)
      assert.strictEqual(col.length, sql.MAX, `the ${col.name} column should be bulk loaded as max`)
    }
    assert.strictEqual(t.columns[4].length, 50, 'a length that was given should be kept')
    assert.strictEqual(t.declare(), 'create table [MyTable] ([x] nvarchar (MAX) null, [u] varbinary (MAX) null, [g] varbinary (MAX) null, [m] varbinary (MAX) null, [n] varbinary (50) null)', 'the created columns should be the same as before')
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
      sql.Promise = Promise
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

// Helper to build spatial binary buffers for testing
function buildSpatialBuffer (opts) {
  const parts = []
  const srid = Buffer.alloc(4)
  srid.writeInt32LE(opts.srid != null ? opts.srid : 4326, 0)
  parts.push(srid)
  parts.push(Buffer.from([opts.version || 1]))
  parts.push(Buffer.from([opts.flags || 0x04]))

  if (!(opts.flags & 0x08) && !(opts.flags & 0x10)) {
    const np = Buffer.alloc(4)
    np.writeUInt32LE(opts.points ? opts.points.length : 0, 0)
    parts.push(np)
  }

  if (opts.points) {
    for (const p of opts.points) {
      const pb = Buffer.alloc(16)
      pb.writeDoubleLE(p[0], 0)
      pb.writeDoubleLE(p[1], 8)
      parts.push(pb)
    }
  }

  if (opts.zValues) {
    for (const z of opts.zValues) {
      const zb = Buffer.alloc(8)
      zb.writeDoubleLE(z, 0)
      parts.push(zb)
    }
  }

  if (opts.mValues) {
    for (const m of opts.mValues) {
      const mb = Buffer.alloc(8)
      mb.writeDoubleLE(m, 0)
      parts.push(mb)
    }
  }

  if (!(opts.flags & 0x08) && !(opts.flags & 0x10)) {
    if (opts.figures) {
      const nf = Buffer.alloc(4)
      nf.writeUInt32LE(opts.figures.length, 0)
      parts.push(nf)
      for (const f of opts.figures) {
        const fb = Buffer.alloc(5)
        fb.writeUInt8(f[0], 0)
        fb.writeInt32LE(f[1], 1)
        parts.push(fb)
      }
    }
    if (opts.shapes) {
      const ns = Buffer.alloc(4)
      ns.writeUInt32LE(opts.shapes.length, 0)
      parts.push(ns)
      for (const s of opts.shapes) {
        const sb = Buffer.alloc(9)
        sb.writeInt32LE(s[0], 0)
        sb.writeInt32LE(s[1], 4)
        sb.writeUInt8(s[2], 8)
        parts.push(sb)
      }
    }
  }

  if (opts.segments) {
    const nseg = Buffer.alloc(4)
    nseg.writeUInt32LE(opts.segments.length, 0)
    parts.push(nseg)
    for (const seg of opts.segments) {
      parts.push(Buffer.from([seg]))
    }
  }

  if (opts.extraBytes) {
    parts.push(opts.extraBytes)
  }

  const buf = Buffer.concat(parts)
  buf.position = 0
  return buf
}

describe('Geography/Geometry - single point (P flag)', () => {
  it('parses single geography point', () => {
    // P flag = bit 3 = 0x08, V = bit 2 = 0x04 => 0x0C
    const buf = buildSpatialBuffer({
      flags: 0x0C,
      points: [[45.0, -93.0]]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.points.length, 1)
    assert.strictEqual(geo.points[0].lat, 45.0)
    assert.strictEqual(geo.points[0].lng, -93.0)
    assert.strictEqual(geo.figures.length, 1)
    assert.strictEqual(geo.shapes.length, 1)
    assert.strictEqual(geo.shapes[0].type, 0x01)
  })

  it('parses single geometry point', () => {
    const buf = buildSpatialBuffer({
      flags: 0x0C,
      points: [[10.0, 20.0]]
    })
    const geom = udt.PARSERS.geometry(buf)
    assert.strictEqual(geom.points.length, 1)
    assert.strictEqual(geom.points[0].x, 10.0)
    assert.strictEqual(geom.points[0].y, 20.0)
  })
})

describe('Geography/Geometry - single line (L flag)', () => {
  it('parses single line geography', () => {
    // L flag = bit 4 = 0x10, V = bit 2 = 0x04 => 0x14
    const buf = buildSpatialBuffer({
      flags: 0x14,
      points: [[0.0, 0.0], [1.0, 1.0]]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.points.length, 2)
    assert.strictEqual(geo.figures.length, 1)
    assert.strictEqual(geo.shapes.length, 1)
    assert.strictEqual(geo.shapes[0].type, 0x02)
  })
})

describe('Geography/Geometry - Z and M values', () => {
  it('parses geography with Z values', () => {
    // Z = bit 0 = 0x01, V = bit 2 = 0x04 => 0x05
    const buf = buildSpatialBuffer({
      flags: 0x05,
      points: [[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]],
      zValues: [100.0, 200.0, 300.0],
      figures: [[0x02, 0]],
      shapes: [[-1, 0, 0x02]]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.points.length, 3)
    assert.strictEqual(geo.points[0].z, 100.0)
    assert.strictEqual(geo.points[1].z, 200.0)
    assert.strictEqual(geo.points[2].z, 300.0)
  })

  it('parses geography with Z and M values', () => {
    // Z = 0x01, M = 0x02, V = 0x04 => 0x07
    const buf = buildSpatialBuffer({
      flags: 0x07,
      points: [[1.0, 2.0], [3.0, 4.0]],
      zValues: [10.0, 20.0],
      mValues: [0.5, 0.75],
      figures: [[0x01, 0]],
      shapes: [[-1, 0, 0x02]]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.points[0].z, 10.0)
    assert.strictEqual(geo.points[1].z, 20.0)
    assert.strictEqual(geo.points[0].m, 0.5)
    assert.strictEqual(geo.points[1].m, 0.75)
  })
})

describe('Geography/Geometry - v2 with segments', () => {
  it('parses v2 geography with circular arc segments', () => {
    const buf = buildSpatialBuffer({
      version: 2,
      flags: 0x04,
      points: [[0.0, 1.0], [1.0, 0.0], [0.0, -1.0]],
      figures: [[0x02, 0]],
      shapes: [[-1, 0, 0x08]],
      segments: [0x01]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.version, 2)
    assert.strictEqual(geo.points.length, 3)
    assert.strictEqual(geo.shapes[0].type, 0x08)
    assert.strictEqual(geo.segments.length, 1)
    assert.strictEqual(geo.segments[0].type, 0x01)
  })

  it('parses v2 with multiple segment types', () => {
    const buf = buildSpatialBuffer({
      version: 2,
      flags: 0x04,
      points: [[0, 0], [1, 0], [2, 0], [3, 1], [4, 0]],
      figures: [[0x03, 0]],
      shapes: [[-1, 0, 0x09]],
      segments: [0x03, 0x02]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.segments.length, 2)
    assert.strictEqual(geo.segments[0].type, 0x03)
    assert.strictEqual(geo.segments[1].type, 0x02)
  })
})

describe('Geography/Geometry - v2 H flag (IsLargerThanAHemisphere)', () => {
  it('correctly parses H flag on bit 5', () => {
    // V=0x04, H=0x20 => 0x24
    const buf = buildSpatialBuffer({
      version: 2,
      flags: 0x24,
      points: [[0.0, 1.0], [1.0, 0.0], [0.0, -1.0]],
      figures: [[0x02, 0]],
      shapes: [[-1, 0, 0x08]],
      segments: [0x01]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.version, 2)
    assert.strictEqual(geo.points.length, 3)
    // P flag (bit 3) should NOT be set
    assert.strictEqual(geo.figures.length, 1)
    assert.notStrictEqual(geo.figures[0].attribute, undefined)
  })
})

describe('Geography/Geometry - multi-shape geometries', () => {
  it('parses multipolygon with nested shapes', () => {
    const buf = buildSpatialBuffer({
      flags: 0x04,
      points: [[0, 0], [0, 10], [10, 10], [0, 0], [20, 20], [20, 30], [30, 30], [20, 20]],
      figures: [[0x02, 0], [0x02, 4]],
      shapes: [[-1, -1, 0x06], [0, 0, 0x03], [0, 1, 0x03]]
    })
    const geo = udt.PARSERS.geography(buf)
    assert.strictEqual(geo.points.length, 8)
    assert.strictEqual(geo.figures.length, 2)
    assert.strictEqual(geo.shapes.length, 3)
    assert.strictEqual(geo.shapes[0].type, 0x06)
    assert.strictEqual(geo.shapes[1].type, 0x03)
    assert.strictEqual(geo.shapes[2].type, 0x03)
  })

  it('parses geometry collection', () => {
    const buf = buildSpatialBuffer({
      flags: 0x04,
      points: [[1, 1], [0, 0], [1, 1], [2, 0]],
      figures: [[0x01, 0], [0x01, 1]],
      shapes: [[-1, -1, 0x07], [0, 0, 0x01], [0, 1, 0x02]]
    })
    const geom = udt.PARSERS.geometry(buf)
    assert.strictEqual(geom.shapes.length, 3)
    assert.strictEqual(geom.shapes[0].type, 0x07)
    assert.strictEqual(geom.shapes[1].type, 0x01)
    assert.strictEqual(geom.shapes[2].type, 0x02)
  })
})

describe('Geography/Geometry - null and empty', () => {
  it('returns null for null geometry (srid = -1)', () => {
    const buf = Buffer.alloc(6)
    buf.writeInt32LE(-1, 0)
    buf.writeUInt8(1, 4)
    buf.writeUInt8(0x04, 5)
    buf.position = 0
    const result = udt.PARSERS.geography(buf)
    assert.strictEqual(result, null)
  })

  it('parses empty geometry (zero points, figures, shapes)', () => {
    const buf = buildSpatialBuffer({
      flags: 0x04,
      points: [],
      figures: [],
      shapes: []
    })
    const geom = udt.PARSERS.geometry(buf)
    assert.strictEqual(geom.points.length, 0)
    assert.strictEqual(geom.figures.length, 0)
    assert.strictEqual(geom.shapes.length, 0)
  })
})

describe('Geography/Geometry - truncated data handling', () => {
  it('throws on buffer too short for header', () => {
    const buf = Buffer.alloc(3)
    buf.position = 0
    assert.throws(() => udt.PARSERS.geography(buf), /truncated/)
  })

  it('throws on truncated point data', () => {
    // Valid header claiming 100 points, but buffer only has room for 1
    const buf = buildSpatialBuffer({
      flags: 0x04,
      points: [[1.0, 2.0]]
    })
    // Corrupt the numberOfPoints field to claim 100 points
    buf.writeUInt32LE(100, 6)
    buf.position = 0
    assert.throws(() => udt.PARSERS.geography(buf), /truncated/)
  })

  it('throws on truncated figure data', () => {
    const buf = buildSpatialBuffer({
      flags: 0x04,
      points: [[1, 1], [2, 2], [3, 3]],
      figures: [[0x02, 0]],
      shapes: [[-1, 0, 0x03]]
    })
    // Corrupt numberOfFigures to claim 100 figures
    const figCountOffset = 6 + 4 + 3 * 16
    buf.writeUInt32LE(100, figCountOffset)
    buf.position = 0
    assert.throws(() => udt.PARSERS.geography(buf), /truncated/)
  })

  it('throws on truncated Z data', () => {
    // Z flag set but no room for Z values
    const buf = buildSpatialBuffer({
      flags: 0x05,
      points: [[1, 1], [2, 2]],
      // deliberately omit zValues
      figures: [[0x01, 0]],
      shapes: [[-1, 0, 0x02]]
    })
    buf.position = 0
    assert.throws(() => udt.PARSERS.geography(buf), /truncated/)
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

describe('connection string boolean options', () => {
  it('parses useUTC=False as false', () => {
    const config = BasePool._parseConnectionString('Server=localhost;useUTC=False')
    assert.strictEqual(config.options.useUTC, false)
  })

  it('parses useUTC=True as true', () => {
    const config = BasePool._parseConnectionString('Server=localhost;useUTC=True')
    assert.strictEqual(config.options.useUTC, true)
  })

  it('parses useUTC=false as false', () => {
    const config = BasePool._parseConnectionString('Server=localhost;useUTC=false')
    assert.strictEqual(config.options.useUTC, false)
  })

  it('parses stream=False as false', () => {
    const config = BasePool._parseConnectionString('Server=localhost;stream=False')
    assert.strictEqual(config.stream, false)
  })

  it('parses stream=True as true', () => {
    const config = BasePool._parseConnectionString('Server=localhost;stream=True')
    assert.strictEqual(config.stream, true)
  })

  it('parses parseJSON=False as false', () => {
    const config = BasePool._parseConnectionString('Server=localhost;parseJSON=False')
    assert.strictEqual(config.parseJSON, false)
  })

  it('parses parseJSON=True as true', () => {
    const config = BasePool._parseConnectionString('Server=localhost;parseJSON=True')
    assert.strictEqual(config.parseJSON, true)
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

  describe('TVP declaration with schema', () => {
    const tds = require('tedious')

    it('tedious includes schema in TVP declaration', () => {
      const tvp = new sql.Table('AI.UDT_StringArray')
      tvp.columns.add('Name', sql.NVarChar(128), { nullable: false })
      tvp.rows.add('TestValue1')

      const tvpValue = {
        name: tvp.name,
        schema: tvp.schema,
        columns: [],
        rows: tvp.rows
      }

      assert.strictEqual(tvp.name, 'UDT_StringArray')
      assert.strictEqual(tvp.schema, 'AI')

      const req = new tds.Request('SELECT 1')
      req.addParameter('InputList', tds.TYPES.TVP, tvpValue)
      const paramsStr = req.makeParamsParameter(req.parameters)
      assert.strictEqual(paramsStr, '@InputList AI.UDT_StringArray readonly')
    })

    it('tedious TVP works without schema', () => {
      const tvp = new sql.Table('UDT_StringArray')
      tvp.columns.add('Name', sql.NVarChar(128), { nullable: false })

      const tvpValue = {
        name: tvp.name,
        schema: tvp.schema,
        columns: [],
        rows: tvp.rows
      }

      assert.strictEqual(tvp.name, 'UDT_StringArray')
      assert.strictEqual(tvp.schema, null)

      const req = new tds.Request('SELECT 1')
      req.addParameter('InputList', tds.TYPES.TVP, tvpValue)
      const paramsStr = req.makeParamsParameter(req.parameters)
      assert.strictEqual(paramsStr, '@InputList UDT_StringArray readonly')
    })
  })

  describe('msnodesqlv8 TVP declaration', () => {
    const { declare, TYPES } = require('../../lib/datatypes')

    it('includes schema in TVP declaration when tvpType is schema-qualified', () => {
      // msnodesqlv8 uses declare() from datatypes.js, which uses tvpType
      // When tvpType includes the schema, the declaration is correct
      const result = declare(TYPES.TVP, { tvpType: 'AI.UDT_StringArray' })
      assert.strictEqual(result, 'AI.UDT_StringArray readonly')
    })

    it('works without schema in tvpType', () => {
      const result = declare(TYPES.TVP, { tvpType: 'UDT_StringArray' })
      assert.strictEqual(result, 'UDT_StringArray readonly')
    })
  })

  describe('TVP sql_variant validation', () => {
    it('throws a clear error when a TVP column uses sql_variant', (done) => {
      const tvp = new sql.Table('dbo.GridFilter')
      tvp.columns.add('FieldName', sql.NVarChar(128))
      tvp.columns.add('Value1', sql.Variant)

      const Request = require('../../lib/tedious/request')
      const fakeConn = { on: () => {}, removeListener: () => {} }
      const mockPool = {
        config: {},
        connected: true,
        acquire: (req, cb) => cb(null, fakeConn, {}),
        release: () => {}
      }
      const req = new Request(mockPool)
      req.input('Filters', tvp)

      req.query('SELECT 1', (err) => {
        assert.ok(err, 'Expected an error')
        assert.ok(err.message.includes('sql_variant'), `Error message should mention sql_variant, got: ${err.message}`)
        assert.ok(err.message.includes('Value1'), `Error message should mention column name, got: ${err.message}`)
        done()
      })
    })
  })

  describe('_poolValidate', () => {
    // Reset Promise in case earlier tests replaced it (e.g. FakePromise)
    before(() => { sql.Promise = Promise })

    function createMockConnection (overrides = {}) {
      return {
        closed: false,
        hasError: false,
        STATE: { LOGGED_IN: 'LoggedIn' },
        state: { name: 'LoggedIn' },
        socket: { destroyed: false, writable: true },
        ...overrides
      }
    }

    function createPool (validateConnection) {
      return new ConnectionPool({ validateConnection })
    }

    it('returns false for null connection', () => {
      const pool = createPool(true)
      assert.strictEqual(pool._poolValidate(null), false)
    })

    it('returns false for closed connection', () => {
      const pool = createPool(true)
      assert.strictEqual(pool._poolValidate(createMockConnection({ closed: true })), false)
    })

    it('returns false for errored connection', () => {
      const pool = createPool(true)
      assert.strictEqual(pool._poolValidate(createMockConnection({ hasError: true })), false)
    })

    it('returns true without validation when validateConnection is false', () => {
      const pool = createPool(false)
      assert.strictEqual(pool._poolValidate(createMockConnection()), true)
    })

    it('socket mode: returns true for healthy connection', () => {
      const pool = createPool('socket')
      const conn = createMockConnection()
      conn.STATE.LOGGED_IN = conn.state
      assert.strictEqual(pool._poolValidate(conn), true)
    })

    it('socket mode: returns false when state is not LOGGED_IN', () => {
      const pool = createPool('socket')
      const conn = createMockConnection()
      conn.state = { name: 'SentLogin7WithStandardLogin' }
      assert.strictEqual(pool._poolValidate(conn), false)
    })

    it('socket mode: returns false when socket is destroyed', () => {
      const pool = createPool('socket')
      const conn = createMockConnection()
      conn.STATE.LOGGED_IN = conn.state
      conn.socket = { destroyed: true, writable: false }
      assert.strictEqual(pool._poolValidate(conn), false)
    })

    it('socket mode: returns false when socket is not writable', () => {
      const pool = createPool('socket')
      const conn = createMockConnection()
      conn.STATE.LOGGED_IN = conn.state
      conn.socket = { destroyed: false, writable: false }
      assert.strictEqual(pool._poolValidate(conn), false)
    })

    it('socket mode: returns false when socket is null', () => {
      const pool = createPool('socket')
      const conn = createMockConnection()
      conn.STATE.LOGGED_IN = conn.state
      conn.socket = null
      assert.strictEqual(pool._poolValidate(conn), false)
    })

    it('query mode: returns a promise (SELECT 1)', () => {
      const pool = createPool(true)
      const conn = createMockConnection()
      conn.execSql = (req) => {
        req.callback(null)
      }
      const result = pool._poolValidate(conn)
      assert.ok(result instanceof Promise || (result && typeof result.then === 'function'))
      return Promise.resolve(result).then(valid => {
        assert.strictEqual(valid, true)
      })
    })

    it('query mode: resolves false on error', () => {
      const pool = createPool(true)
      const conn = createMockConnection()
      conn.execSql = (req) => {
        req.callback(new Error('connection lost'))
      }
      const result = pool._poolValidate(conn)
      return Promise.resolve(result).then(valid => {
        assert.strictEqual(valid, false)
      })
    })
  })

  describe('per-request requestTimeout overrides', () => {
    const BaseRequest = require('../../lib/base/request')
    const BaseTransaction = require('../../lib/base/transaction')
    const BasePreparedStatement = require('../../lib/base/prepared-statement')

    describe('Request', () => {
      it('stores valid requestTimeout override', () => {
        const req = new BaseRequest(null, { requestTimeout: 5000 })
        assert.strictEqual(req.overrides.requestTimeout, 5000)
      })

      it('accepts zero as a valid timeout', () => {
        const req = new BaseRequest(null, { requestTimeout: 0 })
        assert.strictEqual(req.overrides.requestTimeout, 0)
      })

      it('ignores NaN', () => {
        const req = new BaseRequest(null, { requestTimeout: NaN })
        assert.strictEqual(req.overrides.requestTimeout, undefined)
      })

      it('ignores Infinity', () => {
        const req = new BaseRequest(null, { requestTimeout: Infinity })
        assert.strictEqual(req.overrides.requestTimeout, undefined)
      })

      it('ignores negative values', () => {
        const req = new BaseRequest(null, { requestTimeout: -1 })
        assert.strictEqual(req.overrides.requestTimeout, undefined)
      })

      it('ignores non-number values', () => {
        const req = new BaseRequest(null, { requestTimeout: '5000' })
        assert.strictEqual(req.overrides.requestTimeout, undefined)
      })

      it('defaults to empty overrides when none provided', () => {
        const req = new BaseRequest(null)
        assert.deepStrictEqual(req.overrides, {})
      })
    })

    describe('Transaction', () => {
      it('stores valid requestTimeout override', () => {
        const tx = new BaseTransaction(null, { requestTimeout: 10000 })
        assert.strictEqual(tx.overrides.requestTimeout, 10000)
      })

      it('ignores invalid overrides', () => {
        const tx = new BaseTransaction(null, { requestTimeout: NaN })
        assert.strictEqual(tx.overrides.requestTimeout, undefined)
      })

      it('cascades overrides to request when no per-request config given', () => {
        const pool = new ConnectionPool({ server: 'localhost' })
        const tx = pool.transaction({ requestTimeout: 10000 })
        const req = tx.request()
        assert.strictEqual(req.overrides.requestTimeout, 10000)
      })

      it('per-request config overrides transaction overrides', () => {
        const pool = new ConnectionPool({ server: 'localhost' })
        const tx = pool.transaction({ requestTimeout: 10000 })
        const req = tx.request({ requestTimeout: 3000 })
        assert.strictEqual(req.overrides.requestTimeout, 3000)
      })

      it('per-request config merges with transaction overrides', () => {
        const pool = new ConnectionPool({ server: 'localhost' })
        const tx = pool.transaction({ requestTimeout: 10000 })
        const req = tx.request({})
        assert.strictEqual(req.overrides.requestTimeout, 10000)
      })
    })

    describe('PreparedStatement', () => {
      it('stores valid requestTimeout override', () => {
        const ps = new BasePreparedStatement(null, { requestTimeout: 8000 })
        assert.strictEqual(ps.overrides.requestTimeout, 8000)
      })

      it('ignores invalid overrides', () => {
        const ps = new BasePreparedStatement(null, { requestTimeout: -100 })
        assert.strictEqual(ps.overrides.requestTimeout, undefined)
      })
    })
  })

  describe('PreparedStatement streaming', () => {
    const BasePreparedStatement = require('../../lib/base/prepared-statement')
    const ConnectionPool = require('../../lib/tedious/connection-pool')

    it('execute does not throw when stream=true and no callback provided', (done) => {
      const pool = new ConnectionPool({ server: 'localhost' })
      const ps = new BasePreparedStatement(pool)
      ps.stream = true
      ps.prepared = true
      ps._handle = 1

      // Should not throw TypeError — returns the inner Request
      const req = ps.execute({})
      assert.ok(req, 'execute() should return the inner Request')
      // The request will error (no connection) — that's fine,
      // the point is it doesn't throw TypeError
      req.on('error', () => done())
    })
  })

  describe('Request readable stream', () => {
    const BaseRequest = require('../../lib/base/request')

    it('resumes the request once the stream is destroyed', () => {
      const req = new BaseRequest(null)
      const readableStream = req.toReadableStream({ highWaterMark: 1 })
      req.emit('row', { a: 1 })
      req.emit('row', { a: 2 })
      assert.strictEqual(req.paused, true, 'the request should be paused while nothing reads the stream')

      readableStream.destroy()
      assert.strictEqual(req.paused, false, 'destroying the stream should resume the request')

      req.emit('row', { a: 3 })
      assert.strictEqual(req.paused, false, 'the request should stay resumed while it sends the rest of its rows')
      req.emit('done')
    })

    it('runs a destroy hook passed in the stream options', done => {
      const failure = new Error('the destination failed')
      const cleanupFailure = new Error('the cleanup failed')
      const calls = []
      const errors = []
      const req = new BaseRequest(null)
      const readableStream = req.toReadableStream({
        highWaterMark: 1,
        destroy (error, callback) {
          calls.push({ stream: this, error, paused: req.paused })
          callback(cleanupFailure)
        }
      })
      readableStream.on('error', err => errors.push(err))
      readableStream.on('close', () => {
        assert.strictEqual(calls.length, 1, 'the hook should run once')
        assert.strictEqual(calls[0].stream, readableStream, 'the hook should run with the stream as `this`')
        assert.strictEqual(calls[0].error, failure, 'the hook should be given the error the stream was destroyed with')
        assert.strictEqual(calls[0].paused, false, 'the request should be resumed before the hook runs')
        assert.deepStrictEqual(errors, [cleanupFailure], 'the stream should emit the error the hook passed on')
        done()
      })

      readableStream.destroy(failure)
    })

    it('takes null stream options as no options', () => {
      const req = new BaseRequest(null)
      const readableStream = req.toReadableStream(null)
      assert.strictEqual(readableStream.readableObjectMode, true, 'the stream should be an object-mode stream')
      readableStream.destroy()
      assert.strictEqual(req.paused, false, 'destroying the stream should resume the request')
    })

    it('leaves a finished request alone when the stream is destroyed', () => {
      const req = new BaseRequest(null)
      const readableStream = req.toReadableStream({ highWaterMark: 1 })
      req.emit('row', { a: 1 })
      req.emit('done')

      readableStream.destroy()
      assert.strictEqual(req.paused, true, 'a request that has finished should not be resumed')
    })

    it('ends the stream with the request\'s first error', done => {
      const first = new Error('first')
      const errors = []
      const req = new BaseRequest(null)
      const readableStream = req.toReadableStream()
      readableStream.on('error', err => errors.push(err))
      readableStream.on('close', () => {
        assert.deepStrictEqual(errors, [first], 'the stream should be sent the first error only')
        assert.strictEqual(req.paused, false, 'the request should be resumed to run to the end')
        done()
      })

      req.emit('error', first)
      req.emit('row', { a: 1 })
      req.emit('error', new Error('second'))
      req.emit('done')
    })

    it('leaves a cancelled request to its driver when the stream is destroyed', () => {
      const req = new BaseRequest(null)
      const readableStream = req.toReadableStream({ highWaterMark: 1 })
      const errors = []
      readableStream.on('error', err => errors.push(err))
      req.emit('row', { a: 1 })
      assert.strictEqual(req.paused, true, 'the request should be paused while nothing reads the stream')

      req.emit('error', new sql.RequestError('Canceled.', 'ECANCEL'))
      assert.strictEqual(readableStream.destroyed, true, 'the cancel should destroy the stream')
      assert.strictEqual(req.paused, true, 'a cancelled request should be left for its driver to stop')
    })

    describe('releases a piped request whose destination will not read any more', () => {
      // the rest of a running request's rows, more than the stream buffers
      const sendTheRest = (req) => {
        for (let a = 100; a < 150; a++) req.emit('row', { a })
      }

      it('when the destination fails while the request is held back', done => {
        const failure = new Error('the destination failed')
        const errors = []
        let finishWrite
        const destination = new Writable({
          objectMode: true,
          highWaterMark: 1,
          write (row, encoding, callback) {
            // the first write never completes until the destination fails
            finishWrite = callback
          }
        })
        destination.on('error', err => errors.push(err))
        const req = new BaseRequest(null)
        req.pipe(destination)

        setImmediate(() => {
          for (let a = 0; a < 30; a++) req.emit('row', { a })
          assert.strictEqual(req.paused, true, 'the request should be held back while the destination is full')

          finishWrite(failure)
          setImmediate(() => {
            assert.deepStrictEqual(errors, [failure], 'the destination should report its own failure')
            sendTheRest(req)
            assert.strictEqual(req.paused, false, 'the request should not be held back once nothing reads its rows')
            req.emit('done')
            done()
          })
        })
      })

      it('when the destination fails without emitting close', done => {
        const failure = new Error('the destination failed')
        const destination = new Writable({
          objectMode: true,
          highWaterMark: 1,
          autoDestroy: false,
          emitClose: false,
          write (row, encoding, callback) {
            callback(failure)
          }
        })
        const req = new BaseRequest(null)
        destination.on('error', () => setImmediate(() => {
          sendTheRest(req)
          assert.strictEqual(req.paused, false, 'the request should not be held back once nothing reads its rows')
          req.emit('done')
          done()
        }))

        req.pipe(destination)
        req.emit('row', { a: 0 })
      })

      it('when the destination is already destroyed', () => {
        const destination = new Writable({
          objectMode: true,
          write (row, encoding, callback) {
            callback()
          }
        })
        destination.destroy()
        const req = new BaseRequest(null)

        req.pipe(destination)
        sendTheRest(req)
        assert.strictEqual(req.paused, false, 'the request should not be held back once nothing reads its rows')
        req.emit('done')
      })
    })

    it('leaves the errors of a pipe() destination to the caller', () => {
      const writable = () => new Writable({
        objectMode: true,
        write (row, encoding, callback) {
          callback()
        }
      })
      const plain = writable()
      new Readable({ objectMode: true, read () {} }).pipe(plain)
      const destination = writable()
      new BaseRequest(null).pipe(destination)
      assert.strictEqual(destination.listenerCount('error'), plain.listenerCount('error'), 'pipe() should add no error listener of its own, so an unhandled destination error is still thrown')
    })

    it('destroys the destination of pipe() with the request\'s first error', done => {
      const first = new Error('first')
      const errors = []
      const destination = new Writable({
        objectMode: true,
        write (row, encoding, callback) {
          callback()
        }
      })
      destination.on('error', err => errors.push(err))
      destination.on('close', () => {
        assert.deepStrictEqual(errors, [first], 'the destination should be sent the first error only')
        assert.strictEqual(destination.errored, first, 'the destination should be destroyed with the first error')
        done()
      })

      const req = new BaseRequest(null)
      req.pipe(destination)
      req.emit('error', first)
      req.emit('row', { a: 1 })
      req.emit('error', new Error('second'))
      req.emit('done')
    })
  })

  describe('Transaction EABORT originalError', () => {
    const BaseTransaction = require('../../lib/base/transaction')

    it('commit on aborted transaction returns EABORT with originalError', (done) => {
      const tx = new BaseTransaction(null)
      tx._aborted = true
      const reason = new Error('deadlock victim')
      reason.code = 'EREQUEST'
      tx._abortReason = reason

      tx.commit((err) => {
        assert.ok(err)
        assert.strictEqual(err.code, 'EABORT')
        assert.strictEqual(err.message, 'Transaction has been aborted.')
        assert.strictEqual(err.originalError, reason)
        assert.strictEqual(err.originalError.message, 'deadlock victim')
        done()
      })
    })

    it('rollback on aborted transaction returns EABORT with originalError', (done) => {
      const tx = new BaseTransaction(null)
      tx._aborted = true
      const reason = new Error('constraint violation')
      tx._abortReason = reason

      tx.rollback((err) => {
        assert.ok(err)
        assert.strictEqual(err.code, 'EABORT')
        assert.strictEqual(err.message, 'Transaction has been aborted.')
        assert.strictEqual(err.originalError, reason)
        done()
      })
    })

    it('commit on aborted transaction without _abortReason omits originalError', (done) => {
      const tx = new BaseTransaction(null)
      tx._aborted = true

      tx.commit((err) => {
        assert.ok(err)
        assert.strictEqual(err.code, 'EABORT')
        assert.strictEqual(err.originalError, undefined)
        done()
      })
    })

    it('_abortReason is reset on begin', (done) => {
      const tx = new BaseTransaction(null)
      tx._abortReason = new Error('old reason')
      tx._begin(undefined, (err) => {
        assert.ifError(err)
        assert.strictEqual(tx._abortReason, null)
        assert.strictEqual(tx._aborted, false)
        done()
      })
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

describe('msnodesqlv8 query events', () => {
  const Module = require('node:module')
  const { EventEmitter } = require('node:events')
  const RequestError = require('../../lib/error/request-error')

  // msnodesqlv8 is a native module that only the Windows CI jobs install. The request only
  // reaches into it for TVPs, so a bare object stands in for it, and each test plays the
  // events a version of it emits on the query it is given.
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
    Request = require(REQUEST)
  })

  after(() => {
    Module._resolveFilename = resolveFilename
    delete require.cache[STUB]
    delete require.cache[REQUEST]
  })

  const odbcError = (message, code, sqlstate) => Object.assign(new Error(message), { code, sqlstate })
  const PRIMARY_KEY = () => odbcError('Violation of PRIMARY KEY constraint \'PK_t\'.', 2627, '23000')
  const TERMINATED = () => odbcError('The statement has been terminated.', 3621, '01000')
  const CANCELED = () => odbcError('[msnodesql] Operation canceled', 0, 'HY008')
  const REFUSED = () => new Error('Error: [msnodesql] cancel only supported for statements where polling is enabled.')
  const tick = () => new Promise(resolve => setImmediate(resolve))

  // the request's pool, its connection and the query that connection runs; `play` is given
  // the query once it is running and emits on it what msnodesqlv8 would
  const setup = (play, query = {}) => {
    const notify = Object.assign(new EventEmitter(), {
      isPaused: () => false,
      cancelQuery () {}
    }, query)
    // msnodesqlv8 does not emit an error that nothing listens for
    notify.fail = (err, more) => {
      if (notify.listenerCount('error') > 0) notify.emit('error', err, more)
    }
    const connection = {
      queryRaw () {
        setImmediate(play, notify)
        return notify
      }
    }
    const pool = {
      connected: true,
      config: {},
      released: 0,
      acquire (request, callback) { callback(null, connection, { requestTimeout: 15000 }) },
      release () { this.released++ }
    }
    return { request: new Request(pool), notify, pool, connection }
  }

  const result = (meta, value) => notify => {
    notify.emit('meta', [{ name: meta, sqlType: 'int', size: 4, nullable: false }])
    notify.emit('row', 0)
    notify.emit('column', 0, value, false)
  }

  it('should reject when an error ends the batch', async () => {
    const { request, pool } = setup(notify => {
      notify.fail(PRIMARY_KEY(), false)
      notify.emit('done')
    })
    await assert.rejects(request.query('insert into t values (1)'), err => {
      assert.ok(err instanceof RequestError, 'the error should be a RequestError')
      assert.strictEqual(err.number, 2627, 'the error should be the one that ended the batch')
      assert.strictEqual(err.code, 'EREQUEST', 'the error should be a request error')
      return true
    })
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  // msnodesqlv8 >= 5.6
  it('should reject when an error does not end the batch', async () => {
    const { request, pool } = setup(notify => {
      notify.fail(odbcError('Something went wrong', 50000, '42000'), true)
      result('a', 1)(notify)
      notify.emit('done')
    })
    await assert.rejects(request.query('raiserror(N\'Something went wrong\', 16, 1); select 1 as a'), err => {
      assert.strictEqual(err.message, 'Something went wrong', 'the error should be the one the batch reported')
      assert.strictEqual(err.code, 'EREQUEST', 'the error should be a request error')
      return true
    })
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  // msnodesqlv8 >= 5.6
  it('should keep the errors that came before the last one in a batch that carries on', async () => {
    const { request } = setup(notify => {
      notify.fail(odbcError('first', 50000, '42000'), true)
      result('a', 1)(notify)
      notify.fail(odbcError('second', 50000, '42000'), true)
      result('b', 2)(notify)
      notify.fail(odbcError('third', 50000, '42000'), true)
      result('c', 3)(notify)
      notify.emit('done')
    })
    await assert.rejects(request.query('select 1'), err => {
      assert.strictEqual(err.message, 'third', 'the error should be the last one reported')
      assert.deepStrictEqual(err.precedingErrors.map(e => e.message), ['first', 'second'], 'the earlier errors should precede it')
      return true
    })
  })

  // msnodesqlv8 >= 5.6, which carries on to the select of the return value
  it('should reject an execute of a procedure that cannot be found', async () => {
    const { request, pool } = setup(notify => {
      notify.fail(odbcError('Could not find stored procedure \'missing\'.', 2812, '42000'), true)
      result('___return___', 0)(notify)
      notify.emit('done')
    })
    await assert.rejects(request.execute('missing'), err => {
      assert.strictEqual(err.number, 2812, 'the error should be the missing procedure')
      return true
    })
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  it('should stream an error that does not end the batch, then complete', async () => {
    const { request } = setup(notify => {
      notify.fail(odbcError('Something went wrong', 50000, '42000'), true)
      result('a', 1)(notify)
      notify.emit('done')
    })
    request.stream = true
    const errors = []
    const rows = []
    request.on('error', err => errors.push(err))
    request.on('row', row => rows.push(row))
    await new Promise(resolve => {
      request.on('done', resolve)
      request.query('select 1')
    })
    assert.deepStrictEqual(errors.map(e => e.message), ['Something went wrong'], 'the error should be streamed once')
    assert.deepStrictEqual(rows, [{ a: 1 }], 'the rows after the error should still be streamed')
  })

  // msnodesqlv8 >= 5.6 emits a failed statement's info messages ahead of its error
  it('should reject with the error a statement was terminated by when it follows the message', async () => {
    const { request } = setup(notify => {
      notify.emit('info', TERMINATED(), false)
      notify.fail(PRIMARY_KEY(), false)
      notify.emit('done')
    })
    await assert.rejects(request.query('insert into t values (1)'), err => {
      assert.strictEqual(err.number, 2627, 'the error should be the one that terminated the statement')
      return true
    })
  })

  // msnodesqlv8 >= 5.6, when the statement fails after an earlier result and the batch carries on
  it('should reject with the error a statement was terminated by when it follows the message and does not end the batch', async () => {
    const { request } = setup(notify => {
      notify.emit('info', TERMINATED(), false)
      notify.fail(PRIMARY_KEY(), true)
      result('___return___', 0)(notify)
      notify.emit('done')
    })
    await assert.rejects(request.execute('insert_t'), err => {
      assert.strictEqual(err.number, 2627, 'the error should be the one that terminated the statement')
      return true
    })
  })

  // msnodesqlv8 2.0 could stop after the message that the statement was terminated (node-mssql #1126)
  it('should reject with the error a statement was terminated by when it comes before the message', async () => {
    const { request } = setup(notify => {
      notify.fail(PRIMARY_KEY(), true)
      notify.emit('info', TERMINATED(), false)
    })
    await assert.rejects(request.query('insert into t values (1)'), err => {
      assert.strictEqual(err.number, 2627, 'the error should be the one that terminated the statement')
      return true
    })
  })

  it('should reject with the message that a statement was terminated when no error says why', async () => {
    const { request } = setup(notify => {
      notify.emit('info', TERMINATED(), false)
      notify.emit('done')
    })
    await assert.rejects(request.query('insert into t values (1)'), err => {
      assert.strictEqual(err.number, 3621, 'the error should be the termination')
      return true
    })
  })

  // msnodesqlv8 >= 5.6: the batch carries on after an earlier statement's error, and the
  // message that a later statement was terminated comes ahead of the error that terminated it
  it('should reject with the last error when a later statement is terminated', async () => {
    const { request, pool } = setup(async notify => {
      notify.fail(odbcError('Something went wrong', 50000, '42000'), true)
      await tick()
      notify.emit('info', TERMINATED(), false)
      notify.fail(PRIMARY_KEY(), true)
      await tick()
      result('a', 1)(notify)
      notify.emit('done')
    })
    await assert.rejects(request.query('raiserror(N\'Something went wrong\', 16, 1); insert into t values (1); select 1 as a'), err => {
      assert.strictEqual(err.number, 2627, 'the error should be the last one the batch reported')
      assert.deepStrictEqual(err.precedingErrors.map(e => e.number), [50000], 'the earlier error should precede it')
      return true
    })
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  // msnodesqlv8 >= 5.6: a procedure whose first statement fails reports the error ahead of the
  // message, and carries on to the select of the return value
  it('should reject an execute whose first statement is terminated, once the batch is done', async () => {
    let releasedBeforeDone
    const { request, pool } = setup(notify => {
      notify.fail(PRIMARY_KEY(), true)
      notify.emit('info', TERMINATED(), true)
      result('___return___', 0)(notify)
      releasedBeforeDone = pool.released
      notify.emit('done')
    })
    await assert.rejects(request.execute('insert_t'), err => {
      assert.strictEqual(err.number, 2627, 'the error should be the one that terminated the statement')
      return true
    })
    assert.strictEqual(releasedBeforeDone, 0, 'the connection should not be released before the batch is done')
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  it('should stream an error a statement was terminated by once', async () => {
    const { request } = setup(notify => {
      notify.fail(PRIMARY_KEY(), false)
      notify.emit('info', TERMINATED(), false)
      notify.emit('done')
    })
    request.stream = true
    const errors = []
    request.on('error', err => errors.push(err))
    await new Promise(resolve => {
      request.on('done', resolve)
      request.query('insert into t values (1)')
    })
    assert.deepStrictEqual(errors.map(e => e.number), [2627], 'the error should be streamed once')
  })

  // msnodesqlv8 >= 5.6: 'done' as soon as the cancel is through, then an error from the read
  // the cancel cut short, then 'free' once the statement is released
  const cancels = {
    cancelQuery (callback) {
      setImmediate(() => {
        this.emit('done')
        callback(null)
        setImmediate(() => {
          this.fail(CANCELED(), false)
          setImmediate(() => this.emit('free'))
        })
      })
    }
  }

  // msnodesqlv8 >= 5.6. The connection goes back with the cancel, not at the statement's 'free'
  it('should reject a running query that is cancelled', async () => {
    const { request, notify, pool } = setup(notify => {
      result('a', 1)(notify)
      request.cancel()
    }, cancels)
    const freed = new Promise(resolve => notify.once('free', resolve))
    await assert.rejects(request.query('waitfor delay \'00:00:05\'; select 1 as a'), err => {
      assert.strictEqual(err.code, 'ECANCEL', 'the error should be a cancel')
      return true
    })
    assert.strictEqual(pool.released, 1, 'the connection should be released with the cancel')
    await freed
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  // msnodesqlv8 >= 5.6
  it('should stream a cancel once, then complete', async () => {
    const { request } = setup(notify => {
      result('a', 1)(notify)
      request.cancel()
    }, cancels)
    request.stream = true
    const errors = []
    let done = 0
    request.on('error', err => errors.push(err))
    await new Promise(resolve => {
      request.on('done', () => {
        done++
        resolve()
      })
      request.query('select * from streaming')
    })
    // the error the cancel cut the read short with comes after 'done'
    await tick()
    await tick()
    assert.deepStrictEqual(errors.map(e => e.code), ['ECANCEL'], 'only the cancel should be streamed as an error')
    assert.strictEqual(done, 1, 'the stream should complete once')
  })

  // msnodesqlv8 >= 5.6 can report a cancel the statement refused as done, and the query goes on
  it('should stream nothing a cancelled query emits after done', async () => {
    const { request, pool } = setup(notify => {
      result('a', 1)(notify)
      request.cancel()
    }, {
      cancelQuery (callback) {
        setImmediate(() => {
          this.emit('done')
          callback(null)
          setImmediate(() => {
            result('b', 2)(this)
            this.emit('rowcount', 1)
            this.emit('info', odbcError('Still running', 0, '01000'), false)
            this.fail(odbcError('Something went wrong', 50000, '42000'), false)
            this.emit('done')
          })
        })
      }
    })
    request.stream = true
    const events = []
    request.on('recordset', () => events.push('recordset'))
    request.on('row', () => events.push('row'))
    request.on('rowsaffected', () => events.push('rowsaffected'))
    request.on('info', () => events.push('info'))
    request.on('error', err => events.push(`error ${err.code}`))
    request.on('done', () => events.push('done'))
    request.query('select * from streaming')
    while (!events.includes('done')) await tick()
    await tick()
    await tick()
    assert.deepStrictEqual(events, ['recordset', 'row', 'error ECANCEL', 'done'], 'nothing should be streamed after done')
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  // msnodesqlv8 < 5.6
  it('should complete a query whose cancel is refused', async () => {
    const { request } = setup(notify => {
      result('a', 1)(notify)
      request.cancel()
      setImmediate(() => setImmediate(() => notify.emit('done')))
    }, {
      cancelQuery (callback) {
        setImmediate(callback, REFUSED())
      }
    })
    const { recordset } = await request.query('select 1 as a')
    assert.deepStrictEqual(recordset, [{ a: 1 }], 'the query should complete')
  })

  // msnodesqlv8 5.1 to 5.5 note the first cancel, refused or not, and drop any after it
  it('should complete a query whose first cancel is refused and later ones dropped', async () => {
    let sent = false
    const { request } = setup(notify => {
      result('a', 1)(notify)
      request.cancel()
      setImmediate(() => setImmediate(() => {
        request.cancel()
        notify.emit('done')
      }))
    }, {
      getCancelSent: () => sent,
      cancelQuery (callback) {
        if (sent) return
        sent = true
        setImmediate(callback, REFUSED())
      }
    })
    const { recordset } = await request.query('select 1 as a')
    assert.deepStrictEqual(recordset, [{ a: 1 }], 'the query should complete')
  })

  // every msnodesqlv8 version cancels a paused query, and ends it with 'done' before calling back;
  // a stream paused part way through a result set is cancelled once the driver has handed over
  // the batch, so this query, whose batch is its last, ends first
  it('should stream a cancel of a paused query once, then complete with what was read', async () => {
    let paused = false
    const { request, pool } = setup(notify => {
      result('a', 1)(notify)
      notify.emit('rowcount', 1)
      result('b', 2)(notify)
      setImmediate(() => notify.emit('done'))
    }, {
      isPaused: () => paused,
      pauseQuery () { paused = true },
      resumeQuery () { paused = false },
      cancelQuery (callback) {
        setImmediate(() => {
          this.emit('done')
          callback(null)
        })
      }
    })
    request.stream = true
    const errors = []
    let completed = null
    request.on('error', err => errors.push(err))
    request.on('row', row => {
      if (row.b) {
        request.pause()
        request.cancel()
      }
    })
    await new Promise(resolve => {
      request.on('done', result => {
        completed = result
        resolve()
      })
      request.query('select * from streaming')
    })
    await tick()
    assert.deepStrictEqual(errors.map(e => e.code), ['ECANCEL'], 'the cancel should be streamed as an error')
    assert.deepStrictEqual(completed.rowsAffected, [1], 'the stream should complete with the rows affected so far')
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  // msnodesqlv8 >= 5.6 can fail the read a cancel cut short before the cancel is through
  it('should reject a cancelled query whose read fails before the cancel is through', async () => {
    const { request, pool } = setup(notify => request.cancel(), {
      cancelQuery (callback) {
        setImmediate(() => {
          this.fail(CANCELED(), false)
          this.emit('done')
          callback(null)
        })
      }
    })
    await assert.rejects(request.query('waitfor delay \'00:00:05\''), err => {
      assert.strictEqual(err.code, 'ECANCEL', 'the error should be a cancel')
      return true
    })
    assert.strictEqual(pool.released, 1, 'the connection should be released once')
  })

  it('should mark the connection broken when the link fails after a cancel', async () => {
    const { request, connection } = setup(notify => request.cancel(), {
      cancelQuery (callback) {
        setImmediate(() => {
          this.emit('done')
          callback(null)
          setImmediate(() => this.fail(odbcError('Communication link failure', 0, '08S01'), false))
        })
      }
    })
    await assert.rejects(request.query('select 1'))
    await tick()
    await tick()
    assert.strictEqual(connection.hasError, true, 'a link failure after a cancel should mark the connection as broken')
  })

  describe('stream back pressure', () => {
    const { Writable } = require('node:stream')
    const BATCH = 50

    // Plays `recordsets` ([column, row count] each) the way msnodesqlv8's reader does: it
    // fetches a result set's rows BATCH at a time and hands them over until it is paused. What
    // it does after a pause part way through a batch is what differs: up to 4.x it goes on as if
    // the batch was handed over; 5.0 to 5.5 do too, and when resumed after the last batch of a
    // result set, move on to the next one a second time; 5.6 waits for the rest of the batch,
    // unless it was paused on the batch's last row. `timeOutAtFetch` names a fetch that does not
    // come back before the request times out, and `failAtEnd` ends the query on an error; a query
    // that ends on an error emits 'free' and no 'done', as msnodesqlv8 does. `beginDelay` holds
    // back the end of the first statement, and `stallBegin` keeps it from ending.
    const reader = (version, recordsets, { timeOutAtFetch, failAtEnd, beginDelay, stallBegin } = {}) => {
      const pausedAt = []
      const calls = []
      let notify = null
      let queried = false
      let handle = false
      let token = null
      let cancelSent = false
      let fetches = 0
      let set = 0
      let read = 0
      let batch = null
      let index = 0
      let paused = false
      let running = true

      const meta = () => [{ name: recordsets[set][0], sqlType: 'int', size: 4, nullable: false }]

      const fetch = () => {
        const data = []
        while (data.length < BATCH && read < recordsets[set][1]) data.push(++read)
        // a fetch that comes back short has reached the end of the result set
        return { data, endOfRows: data.length < BATCH }
      }

      const isPaused = () => paused

      // handing over a row can pause the query, which stops the loop
      const dispatchRows = () => {
        if (!batch) return
        while (!isPaused() && index < batch.data.length) {
          notify.emit('row', index)
          notify.emit('column', 0, batch.data[index++], false)
        }
      }

      const nextResult = () => setImmediate(() => {
        if (!running) return
        set++
        read = 0
        if (set < recordsets.length) {
          notify.emit('meta', meta())
          dispatch()
        } else if (failAtEnd) {
          fail(Object.assign(new Error('Something went wrong'), { code: 50000, sqlstate: '42000' }))
        } else {
          running = false
          notify.emit('done')
          notify.emit('free')
        }
      })

      const fail = err => {
        running = false
        notify.fail(err, false)
        setImmediate(() => notify.emit('free'))
      }

      const dispatch = () => {
        if (!running || paused) return
        if (++fetches === timeOutAtFetch) {
          return setTimeout(fail, 10, Object.assign(new Error('Query timeout expired'), { code: 0, sqlstate: 'HYT00' }))
        }
        setImmediate(() => {
          if (!running) return
          batch = fetch()
          index = 0
          dispatchRows()
          if (version === '5.6' && paused && index < batch.data.length) return
          if (batch.endOfRows) {
            nextResult()
          } else {
            dispatch()
          }
        })
      }

      // every version cancels a paused query, and ends it with 'done' before calling back;
      // before 5.6 a query that is neither paused nor polling is not cancelled
      const sendCancel = callback => {
        if (version !== '5.6' && !paused) {
          calls.push('cancel refused')
          return setImmediate(callback, new Error('Error: [msnodesql] cancel only supported for statements where polling is enabled.'))
        }
        calls.push('cancel')
        running = false
        setImmediate(() => {
          notify.emit('done')
          callback(null)
        })
      }

      const query = {
        isPaused,
        pauseQuery () {
          calls.push('pause')
          pausedAt.push(batch ? `${index} of ${batch.data.length}` : 'before the first batch')
          paused = true
        },
        resumeQuery () {
          calls.push('resume')
          paused = false
          dispatchRows()
          if (paused) return
          if (version !== '2.x to 4.x' && batch && batch.endOfRows && index >= batch.data.length) {
            nextResult()
          } else {
            dispatch()
          }
        },
        // from 5.0 a query is sent one cancel: one made before the query has a statement waits
        // for it, and a repeat is dropped without calling back
        cancelQuery (callback) {
          if (version !== '2.x to 4.x') {
            if (cancelSent) return calls.push('cancel dropped')
            if (!handle) {
              token = callback
              return
            }
            cancelSent = true
          }
          sendCancel(callback)
        }
      }
      if (version !== '2.x to 4.x') query.getCancelSent = () => cancelSent

      return {
        pausedAt,
        calls,
        fetches: () => fetches,
        queried: () => queried,
        query,
        play (emitter) {
          notify = emitter
          queried = true
          const begin = () => {
            handle = true
            if (token) {
              const callback = token
              token = null
              cancelSent = true
              sendCancel(callback)
            }
            if (stallBegin || !running) return
            notify.emit('meta', meta())
            dispatch()
          }
          if (beginDelay) {
            setTimeout(begin, beginDelay)
          } else {
            begin()
          }
        }
      }
    }

    const setupReader = (version, recordsets, options) => {
      const query = reader(version, recordsets, options)
      return { ...setup(query.play, query.query), pausedAt: query.pausedAt, calls: query.calls, fetches: query.fetches, queried: query.queried }
    }

    const rowsOf = recordsets => recordsets.flatMap(([column, count]) => Array.from({ length: count }, (_, i) => `${column}=${i + 1}`))

    // the rows the stream hands to a writable that takes one at a time, so that it is paused
    // throughout
    const pipeToSlowWritable = request => new Promise((resolve, reject) => {
      const rows = []
      const writable = new Writable({
        objectMode: true,
        highWaterMark: 1,
        write (row, encoding, callback) {
          rows.push(Object.entries(row).map(([column, value]) => `${column}=${value}`).join())
          setImmediate(callback)
        }
      })
      writable.on('finish', () => resolve(rows))
      request.on('error', reject)
      request.pipe(writable)
    })

    // a short last batch in the first result set, a last batch of one row in the next, and a
    // short last batch in the last
    const RECORDSETS = [['a', 75], ['b', 51], ['c', 120]]

    for (const version of ['2.x to 4.x', '5.0 to 5.5', '5.6']) {
      it(`should pipe every row of every result set with msnodesqlv8 ${version}`, async () => {
        const { request, pausedAt } = setupReader(version, RECORDSETS)
        const completed = request.query('select a; select b; select c')
        const rows = await pipeToSlowWritable(request)
        await completed
        assert.deepStrictEqual(rows, rowsOf(RECORDSETS), 'every row should arrive once, in order, under its own column')
        assert.ok(pausedAt.length > 0, 'the driver should have been paused')
        assert.deepStrictEqual(pausedAt.filter(at => at !== `${BATCH} of ${BATCH}`), [], 'the driver should only be paused once it has handed over a whole batch')
      })
    }

    it('should emit nothing while a stream is paused, and complete once it is resumed', async () => {
      const { request, notify } = setupReader('5.6', [['a', 75]])
      request.stream = true
      const rows = []
      let completed = false
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 60) request.pause()
      })
      request.on('done', () => { completed = true })
      const finished = new Promise(resolve => notify.once('done', resolve))
      const result = request.query('select a')

      await finished
      await tick()
      assert.strictEqual(rows.length, 60, 'no row should be emitted while the stream is paused')
      assert.strictEqual(completed, false, 'the stream should not complete while rows are waiting')

      request.resume()
      await result
      assert.deepStrictEqual(rows, rowsOf([['a', 75]]).map(row => Number(row.slice(2))), 'the waiting rows should be emitted once the stream is resumed')
      assert.strictEqual(completed, true, 'the stream should complete once it has emitted the waiting rows')
    })

    it('should stream a cancel of a paused stream without emitting the rows still waiting', async () => {
      const { request, notify, pool } = setupReader('5.6', [['a', 75]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 10) request.pause()
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      // the driver goes on to the end of its batch
      while (!notify.isPaused()) await tick()
      request.cancel()
      await completed
      assert.strictEqual(rows.length, 10, 'no row should be emitted after the stream was paused')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
      assert.strictEqual(pool.released, 1, 'the connection should be released once')
    })

    it('should cancel a paused stream once the driver has handed over its batch', async () => {
      const { request, pausedAt, calls } = setupReader('5.6', [['a', 75]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 10) {
          request.pause()
          request.cancel()
        }
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      await completed
      assert.strictEqual(rows.length, 10, 'no row should be emitted after the stream was paused')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
      assert.deepStrictEqual(pausedAt, ['50 of 50'], 'the driver should be paused at the end of its batch')
      assert.deepStrictEqual(calls, ['pause', 'cancel'], 'the driver should be cancelled once it is paused')
    })

    it('should cancel a paused stream at the start of the next result set', async () => {
      const { request, calls } = setupReader('5.6', [['a', 30], ['b', 30]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row)
        if (rows.length === 10) {
          request.pause()
          request.cancel()
        }
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a; select b')

      await completed
      assert.strictEqual(rows.length, 10, 'no row should be emitted after the stream was paused')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
      assert.deepStrictEqual(calls, ['pause', 'cancel'], 'the driver should be paused and cancelled once, before it reads the next result set')
    })

    it('should not pause a driver that is ending the query when a paused stream is cancelled', async () => {
      const { request, notify, calls } = setupReader('5.6', [['a', 75]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 60) request.pause()
      })
      // once the driver has handed over its last, short batch it goes on to end the query
      notify.on('column', (index, value) => {
        if (value === 75) setImmediate(() => request.cancel())
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      await completed
      assert.strictEqual(rows.length, 60, 'no row should be emitted after the stream was paused')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'a stream that drops rows should report the cancel')
      assert.deepStrictEqual(calls, [], 'the driver should be left to end the query')
    })

    it('should stream a cancel of a paused stream whose query has ended with rows still waiting', async () => {
      const { request, notify, pool } = setupReader('5.6', [['a', 75]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 60) request.pause()
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      const finished = new Promise(resolve => notify.once('done', resolve))
      request.query('select a')

      await finished
      await tick()
      request.cancel()
      await completed
      assert.strictEqual(rows.length, 60, 'no row should be emitted after the stream was paused')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'a stream that drops rows should report the cancel')
      assert.strictEqual(pool.released, 1, 'the connection should be released once')
    })

    it('should keep the driver paused for a cancel made while a stream emits its waiting rows', async () => {
      const { request, notify, calls } = setupReader('5.0 to 5.5', [['a', 200]])
      request.stream = true
      const rows = []
      const errors = []
      let completedAfter = null
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        if (row.a === 10) request.pause()
        if (row.a === 30) request.cancel()
      })
      // a listener after the one that cancels
      request.on('row', row => rows.push(row.a))
      const completed = new Promise(resolve => request.on('done', () => {
        completedAfter = rows.length
        resolve()
      }))
      request.query('select a')

      // the driver goes on to the end of its batch, then the stream is resumed
      while (!notify.isPaused()) await tick()
      request.resume()
      await completed
      assert.deepStrictEqual(calls, ['pause', 'cancel'], 'the driver should not be resumed under the cancel')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be the only error')
      assert.deepStrictEqual(rows, Array.from({ length: 50 }, (_, i) => i + 1), 'the rows handed over before the cancel was through should be emitted in order')
      assert.strictEqual(completedAfter, 50, 'the stream should complete after its last row')
    })

    it('should go on piping every row when msnodesqlv8 refuses a cancel', async () => {
      const { request, calls } = setupReader('2.x to 4.x', [['a', 75], ['b', 51]])
      request.on('row', row => {
        if (row.a === 5) request.cancel()
      })
      const completed = request.query('select a; select b')
      const rows = await pipeToSlowWritable(request)
      await completed
      assert.strictEqual(calls[0], 'cancel refused', 'the cancel should have been refused')
      assert.deepStrictEqual(rows, rowsOf([['a', 75], ['b', 51]]), 'a query whose cancel is refused should run to the end')
    })

    it('should complete a cancelled paused stream once a fetch under way times out', async () => {
      const { request, calls } = setupReader('5.0 to 5.5', [['a', 200]], { timeOutAtFetch: 3 })
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => rows.push(row.a))
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      // the third fetch does not come back
      while (rows.length < 100) await tick()
      await tick()
      request.pause()
      request.cancel()
      await completed
      assert.deepStrictEqual(calls, [], 'the driver should not be paused or cancelled part way through a fetch')
      assert.deepStrictEqual(errors, ['EREQUEST', 'ECANCEL'], 'the timeout and then the cancel should be streamed')
      assert.strictEqual(rows.length, 100, 'no row should be emitted after the stream was paused')
    })

    it('should report a cancel of a paused stream although an earlier cancel was refused', async () => {
      const { request, calls } = setupReader('2.x to 4.x', [['a', 75]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        // refused, as the driver is not paused, but only once the next cancel is under way
        if (rows.length === 10) request.cancel()
        if (rows.length === 13) {
          request.pause()
          request.cancel()
        }
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      await completed
      assert.deepStrictEqual(calls, ['cancel refused', 'pause', 'cancel'], 'the second cancel should go through at the end of the batch')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel that went through should be streamed')
      assert.strictEqual(rows.length, 13, 'no row should be emitted after the stream was paused')
    })

    it('should hold the driver back from the start for a stream paused before its query', async () => {
      const { request, notify, calls, fetches } = setupReader('5.0 to 5.5', [['a', 75]])
      request.stream = true
      request.pause()
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => rows.push(row.a))
      const started = new Promise(resolve => notify.once('meta', resolve))
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      await started
      await tick()
      await tick()
      assert.strictEqual(fetches(), 0, 'the driver should fetch nothing while the stream is paused')
      request.cancel()
      await completed
      assert.deepStrictEqual(calls, ['pause', 'cancel'], 'the driver should be paused before it fetches, and cancelled there')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
      assert.strictEqual(rows.length, 0, 'no row should be emitted')
    })

    it('should complete a cancelled paused stream whose query ends on an error', async () => {
      const { request, notify, pool } = setupReader('5.6', [['a', 75]], { failAtEnd: true })
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 60) request.pause()
      })
      notify.on('column', (index, value) => {
        if (value === 75) setImmediate(() => request.cancel())
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      await completed
      assert.strictEqual(rows.length, 60, 'no row should be emitted after the stream was paused')
      assert.deepStrictEqual(errors, ['EREQUEST', 'ECANCEL'], 'the error and then the cancel should be streamed')
      assert.strictEqual(pool.released, 1, 'the connection should be released once')
    })

    it('should emit what was waiting in order to every listener when one resumes the stream', async () => {
      const { request } = setupReader('5.6', [['a', 120]])
      request.stream = true
      const rows = []
      request.on('row', row => {
        if (row.a === 10) {
          request.pause()
          setTimeout(() => request.resume(), 5)
        }
        // a stream that is not paused can be resumed all the same
        if (row.a > 10 && row.a < 15) request.resume()
      })
      // a listener after the one that resumes
      request.on('row', row => rows.push(row.a))
      await request.query('select a')
      assert.deepStrictEqual(rows, Array.from({ length: 120 }, (_, i) => i + 1), 'every listener should get the rows in order')
    })

    it('should complete as cancelled a stream cancelled and paused again while it emits what was waiting', async () => {
      const { request, notify } = setupReader('5.6', [['a', 30]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row.a)
        if (rows.length === 5) request.pause()
        if (rows.length === 10) {
          request.cancel()
          request.pause()
        }
      })
      const completed = new Promise(resolve => request.on('done', resolve))
      const finished = new Promise(resolve => notify.once('done', resolve))
      request.query('select a')

      // the query ends while the stream is paused, and the stream is resumed after it
      await finished
      await tick()
      request.resume()
      await completed
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
      assert.strictEqual(rows.length, 10, 'no row should be emitted after the stream was paused')
    })

    it('should cancel a paused stream whose first statement does not end', async () => {
      const { request, calls, queried } = setupReader('5.6', [['a', 75]], { stallBegin: true })
      request.stream = true
      const errors = []
      request.on('error', err => errors.push(err.code))
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      while (!queried()) await tick()
      request.pause()
      request.cancel()
      await completed
      assert.deepStrictEqual(calls, ['pause', 'cancel'], 'the driver should be paused and cancelled at once')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
    })

    it('should cancel a stream paused before its first statement ends, after a cancel made while it was flowing', async () => {
      const { request, calls, queried } = setupReader('5.0 to 5.5', [['a', 75]], { beginDelay: 10 })
      request.stream = true
      const errors = []
      request.on('error', err => errors.push(err.code))
      const completed = new Promise(resolve => request.on('done', resolve))
      request.query('select a')

      while (!queried()) await tick()
      // msnodesqlv8 holds this cancel until the query has a statement, and refuses it then
      request.cancel()
      request.pause()
      request.cancel()
      await completed
      assert.deepStrictEqual(calls, ['pause', 'cancel'], 'the driver should be paused at once, so that the cancel is accepted')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
    })

    it('should not emit the rows of a cancelled paused stream that a listener resumes', async () => {
      const { request, notify } = setupReader('5.6', [['a', 75], ['b', 30]])
      request.stream = true
      const rows = []
      const errors = []
      request.on('error', err => errors.push(err.code))
      request.on('row', row => {
        rows.push(row)
        if (rows.length === 60) request.pause()
      })
      // the next result set's 'recordset' waits ahead of its rows, and its listener resumes the stream
      request.on('recordset', () => request.resume())
      const completed = new Promise(resolve => request.on('done', resolve))
      const finished = new Promise(resolve => notify.once('done', resolve))
      request.query('select a; select b')

      await finished
      await tick()
      request.cancel()
      await completed
      assert.strictEqual(rows.length, 60, 'no row should be emitted after the stream was paused and cancelled')
      assert.deepStrictEqual(errors, ['ECANCEL'], 'the cancel should be streamed as an error')
    })

    it('should leave a cancel of a request that is no longer streaming to msnodesqlv8', async () => {
      const { request, notify, calls } = setupReader('2.x to 4.x', [['a', 120]])
      request.stream = true
      request.pause()
      request.stream = false
      notify.once('column', () => setImmediate(() => request.cancel()))
      const result = await request.query('select a')
      assert.deepStrictEqual(calls, ['cancel refused'], 'the driver should not be paused for the cancel')
      assert.strictEqual(result.recordset.length, 120, 'a query whose cancel is refused should run to the end')
    })

    it('should not pause the driver for a request that is no longer streaming', async () => {
      const { request, calls } = setupReader('5.6', [['a', 75]])
      request.stream = true
      request.pause()
      request.stream = false
      const result = await request.query('select a')
      assert.strictEqual(result.recordset.length, 75, 'every row should be read')
      assert.deepStrictEqual(calls, [], 'the driver should not be paused')
    })
  })
})

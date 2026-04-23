'use strict'

/* globals describe, it, before, afterEach */

const sql = require('../../')
const assert = require('node:assert')
const udt = require('../../lib/udt')
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

    it('documents upstream tedious bug: schema missing from TVP declaration', () => {
      const tvp = new sql.Table('AI.UDT_StringArray')
      tvp.columns.add('Name', sql.NVarChar(128), { nullable: false })
      tvp.rows.add('TestValue1')

      const tvpValue = {
        name: tvp.name,
        schema: tvp.schema,
        columns: [],
        rows: tvp.rows
      }

      // tedious's own TVP type does NOT include schema in declaration
      const req = new tds.Request('SELECT 1')
      req.addParameter('InputList', tds.TYPES.TVP, tvpValue)
      const paramsStr = req.makeParamsParameter(req.parameters)
      assert.strictEqual(paramsStr, '@InputList UDT_StringArray readonly',
        'tedious itself does not include schema - this documents the upstream bug')
    })

    it('schema-aware TVP type includes schema in declaration', () => {
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

      // Use the patched SchemaAwareTVP type from lib/tedious/request.js
      // Since it's not exported, recreate the same pattern to verify behavior
      const SchemaAwareTVP = Object.create(tds.TYPES.TVP, {
        declaration: {
          value: function (parameter) {
            const value = parameter.value
            if (value && value.schema) {
              return value.schema + '.' + value.name + ' readonly'
            }
            return value.name + ' readonly'
          },
          writable: true,
          configurable: true
        }
      })

      const req = new tds.Request('SELECT 1')
      req.addParameter('InputList', SchemaAwareTVP, tvpValue)
      const paramsStr = req.makeParamsParameter(req.parameters)
      assert.strictEqual(paramsStr, '@InputList AI.UDT_StringArray readonly')
    })

    it('schema-aware TVP works without schema', () => {
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

      const SchemaAwareTVP = Object.create(tds.TYPES.TVP, {
        declaration: {
          value: function (parameter) {
            const value = parameter.value
            if (value && value.schema) {
              return value.schema + '.' + value.name + ' readonly'
            }
            return value.name + ' readonly'
          },
          writable: true,
          configurable: true
        }
      })

      const req = new tds.Request('SELECT 1')
      req.addParameter('InputList', SchemaAwareTVP, tvpValue)
      const paramsStr = req.makeParamsParameter(req.parameters)
      assert.strictEqual(paramsStr, '@InputList UDT_StringArray readonly')
    })

    it('schema-aware TVP inherits generateTypeInfo from tedious TVP', () => {
      const SchemaAwareTVP = Object.create(tds.TYPES.TVP, {
        declaration: {
          value: function (parameter) {
            const value = parameter.value
            if (value && value.schema) {
              return value.schema + '.' + value.name + ' readonly'
            }
            return value.name + ' readonly'
          },
          writable: true,
          configurable: true
        }
      })

      // Verify it inherits all other methods from tedious TVP
      assert.strictEqual(SchemaAwareTVP.id, tds.TYPES.TVP.id)
      assert.strictEqual(SchemaAwareTVP.type, tds.TYPES.TVP.type)
      assert.strictEqual(SchemaAwareTVP.name, tds.TYPES.TVP.name)
      assert.strictEqual(SchemaAwareTVP.generateTypeInfo, tds.TYPES.TVP.generateTypeInfo)
      assert.strictEqual(SchemaAwareTVP.generateParameterLength, tds.TYPES.TVP.generateParameterLength)
      assert.strictEqual(SchemaAwareTVP.generateParameterData, tds.TYPES.TVP.generateParameterData)
      assert.strictEqual(SchemaAwareTVP.validate, tds.TYPES.TVP.validate)
      // declaration is overridden
      assert.notStrictEqual(SchemaAwareTVP.declaration, tds.TYPES.TVP.declaration)
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
})

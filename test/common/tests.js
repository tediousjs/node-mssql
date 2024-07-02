'use strict'

const assert = require('node:assert')
const stream = require('node:stream')
const { join } = require('node:path')
const { format } = require('node:util')
const ISOLATION_LEVELS = require('../../lib/isolationlevel')
const BaseTransaction = require('../../lib/base/transaction')
const versionHelper = require('./versionhelper')
const { ConnectionPool } = require('../../lib/base')

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  // application specific logging, throwing an error, or other logic here
})

class WritableStream extends stream.Writable {
  constructor () {
    super({
      objectMode: true
    })

    this.cache = []
  }

  _write (chunk, encoding, callback) {
    this.cache.push(chunk)
    setImmediate(() => callback(null))
  }
}

const readConfig = () => {
  return require(join(__dirname, '../.mssql.json'))
}

module.exports = (sql, driver) => {
  class TestRequest extends sql.Request {
    execute (method) {
      const results = []
      this.stream = false

      return new Promise((resolve, reject) => {
        // Callback style
        super.execute(method, (err, result) => {
          if (err) return reject(err)
          resolve(result)
        })
      }).then(result => {
        result.recordsets.forEach(recordset => Object.defineProperty(recordset, 'columns', { enumerable: true })) // Make columns enumerable for tests
        results.push(result)

        // Promise style
        return super.execute(method)
      }).then(result => {
        result.recordsets.forEach(recordset => Object.defineProperty(recordset, 'columns', { enumerable: true })) // Make columns enumerable for tests
        results.push(result)

        // Stream style
        return new Promise((resolve, reject) => {
          const recordsets = []
          const errors = []
          const recordsetcolumns = []

          this.stream = true
          super.execute(method)

          this.on('recordset', (columns) => {
            const recordset = []
            recordset.columns = columns
            recordsets.push(recordset)
            if (this.arrayRowMode) {
              let hasReturnColumn = false
              for (let i = 0; i < columns.length; i++) {
                if (columns[i].name === '___return___') {
                  hasReturnColumn = true
                  break
                }
              }
              if (!hasReturnColumn) recordsetcolumns.push(columns)
            }
          })
          this.on('row', row => recordsets[recordsets.length - 1].push(row))
          this.on('error', err => errors.push(err))
          this.on('done', result => {
            if (errors.length) return reject(errors.pop())
            if (this.arrayRowMode) result.columns = recordsetcolumns
            resolve(Object.assign(result, {
              recordsets,
              recordset: recordsets[0]
            }))
          })
        })
      }).then(result => {
        results.push(result)

        return new Promise((resolve, reject) => {
          assert.deepStrictEqual(results[0], results[1])
          assert.deepStrictEqual(results[1], results[2])

          assert.deepStrictEqual(results[0].output, results[1].output)
          assert.deepStrictEqual(results[1].output, results[2].output)

          resolve(results[0])
        })
      })
    }
  }

  class TestPreparedStatement extends sql.PreparedStatement {

  }

  class TestTransaction extends sql.Transaction {

  }

  class MSSQLTestType extends sql.Table {
    constructor () {
      super('dbo.MSSQLTestType')

      this.columns.add('a', sql.VarChar(50))
      this.columns.add('b', sql.Int)
    }
  }

  return {
    'config validation' (done) {
      const config = {
        ...readConfig()
      }
      Object.assign(config.options, {
        useColumnNames: false
      })
      try {
        // eslint-disable-next-line no-new
        new ConnectionPool(config)
      } catch (e) {
        assert.strictEqual(e.message, 'Invalid options `useColumnNames`, use `arrayRowMode` instead')
      }
      // eslint-disable-next-line no-new
      new ConnectionPool(config, (err) => {
        try {
          assert.strictEqual(err.message, 'Invalid options `useColumnNames`, use `arrayRowMode` instead')
        } catch (e) {
          done(e)
          return
        }
        done()
      })
      delete config.options.useColumnNames
    },
    'value handler' (done) {
      let callCount = 0
      const callArgs = []
      // assign a "spy" to the valuehandler for varchar
      sql.valueHandler.set(sql.TYPES.VarChar, function () { callCount++; callArgs.push(arguments); return arguments[0].toUpperCase() })
      sql.query('SELECT TOP 1 * FROM [streaming]  ').then((result) => {
        assert.strictEqual(callCount, 1)
        assert.strictEqual(result.recordset.length, 1)
        assert.notStrictEqual(result.recordset[0], callArgs[0])
        assert.notStrictEqual(result.recordset[0], callArgs[0][0].toUpperCase())
        done()
      }).catch(done)
    },
    'bigint inputs' (done) {
      const req = new TestRequest()
      req.input('bigintparam', BigInt('4294967294'))
      done()
    },
    'stored procedure' (mode, done) {
      const req = new TestRequest()
      req.input('in', sql.Int, null)
      req.input('in2', sql.BigInt, 0)
      req.input('in3', sql.NVarChar, 'anystring')
      req.input('in4', sql.UniqueIdentifier, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F')
      req.input('in5', sql.DateTime, new Date(1860, 0, 24, 1, 52))
      req.output('out', sql.Int)
      req.output('out2', sql.Int)
      req.output('out3', sql.UniqueIdentifier)
      req.output('out4', sql.DateTime)
      req.output('out5', sql.Char(10))
      req[mode](mode === 'batch' ? 'exec __test @in=@in, @in2=@in2, @in3=@in3, @in4=@in4, @in5=@in5, @out=@out output, @out2=@out2 output, @out3=@out3 output, @out4=@out4 output, @out5=@out5 output' : '__test').then(result => {
        // if (method !== 'batch') assert.strictEqual(result.returnValue, 11);
        assert.strictEqual(result.recordsets.length, 3)
        assert.strictEqual(result.recordsets[0].length, 2)
        assert.strictEqual(result.recordsets[0][0].a, 1)
        assert.strictEqual(result.recordsets[0][0].b, 2)
        assert.strictEqual(result.recordsets[0][1].a, 3)
        assert.strictEqual(result.recordsets[0][1].b, 4)
        assert.strictEqual(result.recordsets[1].length, 1)
        assert.strictEqual(result.recordsets[1][0].c, 5)
        assert.strictEqual(result.recordsets[1][0].d, 6)
        assert.strictEqual(result.recordsets[1][0].e.length, 3)

        assert.strictEqual(result.recordsets[1][0].e[0], 0)
        assert.strictEqual(result.recordsets[1][0].e[1], 111)
        assert.strictEqual(result.recordsets[1][0].e[2], 'asdf')

        assert.strictEqual(result.recordsets[1][0].f, null)
        assert.strictEqual(result.recordsets[1][0].g, 'anystring')
        assert.strictEqual(result.recordsets[2].length, 0)

        assert.strictEqual(result.output.out, 99)
        assert.strictEqual(result.output.out2, null)
        assert.strictEqual(result.output.out3, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F')
        assert.strictEqual(result.output.out4.getTime(), +new Date(1860, 0, 24, 1, 52))
        assert.strictEqual(result.output.out5, 'anystring ')

        assert.strictEqual(result.recordsets[0].columns.a.index, 0)
        assert.strictEqual(result.recordsets[0].columns.b.index, 1)

        done()
      }).catch(done)
    },

    'user defined types' (done) {
      const req = new TestRequest()
      req.query("declare @g geography = geography::[Null];select geography::STGeomFromText('LINESTRING(-122.360 47.656, -122.343 47.656 )', 4326) as geography, geometry::STGeomFromText('LINESTRING (100 100 10.3 12, 20 180, 180 180)', 0) geometry, @g as nullgeography").then(result => {
        // console.dir rst[0].geography
        // console.dir rst[0].geometry

        // assert.deepStrictEqual rst[0].geography, sample1
        // assert.deepStrictEqual rst[0].geometry, sample2

        // GEOGRAPHY
        assert.strictEqual(result.recordset[0].geography.srid, 4326)
        assert.strictEqual(result.recordset[0].geography.version, 1)

        assert.strictEqual(result.recordset[0].geography.points.length, 2)
        assert.strictEqual(result.recordset[0].geography.points[0].lng, -122.360)
        assert.strictEqual(result.recordset[0].geography.points[0].lat, 47.656)
        assert.strictEqual(result.recordset[0].geography.points[1].lng, -122.343)
        assert.strictEqual(result.recordset[0].geography.points[1].lat, 47.656)

        // Backwards compatibility: Preserve flipped x/y.
        assert.strictEqual(result.recordset[0].geography.points[0].y, -122.360)
        assert.strictEqual(result.recordset[0].geography.points[0].x, 47.656)
        assert.strictEqual(result.recordset[0].geography.points[1].y, -122.343)
        assert.strictEqual(result.recordset[0].geography.points[1].x, 47.656)

        assert.strictEqual(result.recordset[0].geography.figures.length, 1)
        assert.strictEqual(result.recordset[0].geography.figures[0].attribute, 0x01)

        assert.strictEqual(result.recordset[0].geography.shapes.length, 1)
        assert.strictEqual(result.recordset[0].geography.shapes[0].type, 0x02)

        assert.strictEqual(result.recordset[0].geography.segments.length, 0)

        // GEOMETRY
        assert.strictEqual(result.recordset[0].geometry.srid, 0)
        assert.strictEqual(result.recordset[0].geometry.version, 1)

        assert.strictEqual(result.recordset[0].geometry.points.length, 3)
        assert.strictEqual(result.recordset[0].geometry.points[0].z, 10.3)
        assert.strictEqual(result.recordset[0].geometry.points[0].m, 12)
        assert.strictEqual(result.recordset[0].geometry.points[1].x, 20)
        assert.strictEqual(result.recordset[0].geometry.points[2].y, 180)
        assert(isNaN(result.recordset[0].geometry.points[2].z))
        assert(isNaN(result.recordset[0].geometry.points[2].m))

        assert.strictEqual(result.recordset[0].geometry.figures.length, 1)
        assert.strictEqual(result.recordset[0].geometry.figures[0].attribute, 0x01)

        assert.strictEqual(result.recordset[0].geometry.shapes.length, 1)
        assert.strictEqual(result.recordset[0].geometry.shapes[0].type, 0x02)

        assert.strictEqual(result.recordset[0].geometry.segments.length, 0)

        assert(result.recordset.columns.geography.type === sql.Geography)
        assert(result.recordset.columns.geometry.type === sql.Geometry)
        assert.strictEqual(result.recordset.columns.geography.udt.name, 'geography')
        assert.strictEqual(result.recordset.columns.geometry.udt.name, 'geometry')
      }).then(() =>
        new TestRequest().query('DECLARE @geo GEOGRAPHY = geography::Point(90, 180, 4326); SELECT @geo AS geo, @geo.Lat AS expectedLat, @geo.Long AS expectedLng')
      ).then(result => {
        // Our notion of lat and lng should agree with SQL Server's notion.
        const record = result.recordset[0]
        const parsedPoint = record.geo.points[0]
        assert.strictEqual(parsedPoint.lat, record.expectedLat)
        assert.strictEqual(parsedPoint.lng, record.expectedLng)

        // Backwards compatibility: Preserve flipped x/y.
        assert.strictEqual(parsedPoint.x, record.expectedLat)
        assert.strictEqual(parsedPoint.y, record.expectedLng)
      }).then(done, done)
    },

    'binary data' (done) {
      const sample = Buffer.from([0x00, 0x01, 0xe2, 0x40])

      const req = new TestRequest()
      req.input('in', sql.Binary, sample)
      req.input('in2', sql.Binary, null)
      req.input('in3', sql.VarBinary, sample)
      req.input('in4', sql.VarBinary, null)
      req.input('in5', sql.Image, sample)
      req.input('in6', sql.Image, null)
      req.output('out', sql.Binary(4))
      req.output('out2', sql.VarBinary)
      req.execute('__test5').then(result => {
        assert.deepStrictEqual(result.recordsets[0][0].bin, sample)
        assert.deepStrictEqual(result.recordsets[0][0].in, sample)
        assert.strictEqual(result.recordsets[0][0].in2, null)
        assert.deepStrictEqual(result.recordsets[0][0].in3, sample)
        assert.strictEqual(result.recordsets[0][0].in4, null)
        assert.deepStrictEqual(result.recordsets[0][0].in5, sample)
        assert.strictEqual(result.recordsets[0][0].in6, null)

        assert.deepStrictEqual(result.output.out, sample)
        assert.deepStrictEqual(result.output.out2, sample)

        done()
      }).catch(done)
    },

    'variant data' (done) {
      const req = new TestRequest()
      req.query('select cast(11.77 as sql_variant) as variant').then(result => {
        assert.strictEqual(result.recordset.length, 1)
        assert.strictEqual(result.recordset[0].variant, 11.77)

        done()
      }).catch(done)
    },

    'stored procedure with one empty recordset' (done) {
      const req = new TestRequest()
      req.execute('__test2').then(result => {
        assert.strictEqual(result.returnValue, 11)
        assert.strictEqual(result.recordsets.length, 2)

        done()
      }).catch(done)
    },

    'stored procedure with duplicate output column names' (done) {
      const req = new TestRequest()
      req.arrayRowMode = true
      req.input('in', sql.Int, 1)
      req.input('in2', sql.Int, 2)
      req.output('out', sql.Int)
      req.output('out2', sql.Int)
      req.execute('__testDuplicateNames').then(result => {
        assert.strictEqual(result.returnValue, 12)
        assert.strictEqual(result.recordsets.length, 1)
        assert.ok(result.recordsets[0][0] instanceof Array)
        assert.strictEqual(result.recordsets[0][0][0], 1)
        assert.strictEqual(result.recordsets[0][0][1], 2)
        assert.strictEqual(result.recordsets[0].columns.length, 2)

        assert.strictEqual(result.output.out, 2)
        assert.strictEqual(result.output.out2, 1)

        done()
      }).catch(done)
    },

    'stored procedure with input/output column' (done) {
      const req = new TestRequest()
      req.arrayRowMode = true
      req.input('in', sql.Int, 1)
      req.output('out', sql.Int, 1)
      req.execute('__testInputOutputValue').then(result => {
        assert.strictEqual(result.output.out, 2)

        done()
      }).catch(done)
    },

    'empty query' (done) {
      const req = new TestRequest()
      req.query('').then(result => {
        assert.ok(!result.recordset)

        done()
      }).catch(done)
    },

    'query with no recordset' (done) {
      const req = new TestRequest()
      req.query('select * from sys.tables where name = \'______\'').then(result => {
        assert.strictEqual(result.recordset.length, 0)

        done()
      }).catch(done)
    },

    'query with one recordset' (done) {
      const req = new TestRequest()
      req.query('select \'asdf\' as text').then(result => {
        assert.strictEqual(result.recordset.length, 1)
        assert.strictEqual(result.recordset[0].text, 'asdf')

        done()
      }).catch(done)
    },

    'query with multiple recordsets' (done) {
      const req = new TestRequest()
      req.query('select 41 as test, 5 as num, 6 as num;select 999 as second').then(result => {
        assert.strictEqual(result.recordsets.length, 2)
        assert.strictEqual(result.recordsets[0].length, 1)
        assert.strictEqual(result.recordsets[0][0].test, 41)
        assert.strictEqual(result.recordsets[0][0].num.length, 2)
        assert.strictEqual(result.recordsets[0][0].num[0], 5)
        assert.strictEqual(result.recordsets[0][0].num[1], 6)
        assert.strictEqual(result.recordsets[1][0].second, 999)
        assert.strictEqual(result.recordsets[0].columns.test.type, sql.Int)

        done()
      }).catch(done)
    },

    'query with input parameters' (mode, done) {
      const buff = Buffer.from([0x00, 0x01, 0xe2, 0x40])

      const req = new sql.Request()
      req.input('id', 12)
      req.input('vch', sql.VarChar(300), 'asdf')
      req.input('vchm', sql.VarChar(sql.MAX), 'fdsa')
      req.input('vbin', buff)
      req[mode]('select @id as id, @vch as vch, @vchm as vchm, @vbin as vbin').then(result => {
        assert.strictEqual(result.recordset.length, 1)
        assert.strictEqual(result.recordset[0].id, 12)
        assert.strictEqual(result.recordset[0].vch, 'asdf')
        assert.strictEqual(result.recordset[0].vchm, 'fdsa')
        assert.deepStrictEqual(result.recordset[0].vbin, buff)

        done()
      }).catch(done)
    },

    'query with output parameters' (mode, done) {
      const req = new TestRequest()
      req.output('out', sql.VarChar)
      req[mode]('select @out = \'test\'').then(result => {
        assert.ok(!result.recordset)
        assert.strictEqual(result.output.out, 'test')

        done()
      }).catch(done)
    },

    'query with duplicate parameters throws' (done) {
      const req = new TestRequest()
      try {
        req.input('in', sql.Int, null)
        req.output('in', sql.Int)
      } catch (err) {
        assert.ok(err)
        assert.strictEqual(err.code, 'EDUPEPARAM')
        done()
        return
      }
      assert.fail('failed to throw on duplicate paramter')
      done()
    },

    'query parameters can be replaced' (done) {
      const req = new TestRequest()
      req.input('in', sql.Int, null)
      req.replaceInput('in', sql.VarChar, 'test')
      req.output('out', sql.VarChar)
      req.replaceOutput('out', sql.Int)
      assert.strictEqual(req.parameters.in.type, sql.VarChar().type)
      assert.strictEqual(req.parameters.out.type, sql.Int().type)
      done()
    },

    'query with error' (done) {
      const req = new TestRequest()
      req.query('select * from notexistingtable', err => {
        assert.strictEqual(err instanceof sql.RequestError, true)

        assert.strictEqual(err.message, 'Invalid object name \'notexistingtable\'.')
        assert.strictEqual(err.code, 'EREQUEST')
        assert.strictEqual(err.number, 208)
        assert.strictEqual(err.lineNumber, 1)
        assert.strictEqual(err.class, 16)

        if (driver !== 'msnodesqlv8') {
          assert.strictEqual(err.state, 1)
        } else {
          // ODBC uses different SQLSTATE values
          // https://docs.microsoft.com/en-us/sql/odbc/reference/appendixes/appendix-a-odbc-error-codes
          assert.strictEqual(err.state, '42S02')
        }

        done()
      })
    },

    'query with multiple errors' (done) {
      const req = new TestRequest()
      req.query('select a;select b;', err => {
        assert.strictEqual(err instanceof sql.RequestError, true)
        assert.strictEqual(err.message, 'Invalid column name \'b\'.')
        assert.strictEqual(err.precedingErrors.length, 1)
        assert.strictEqual(err.precedingErrors[0] instanceof sql.RequestError, true)
        assert.strictEqual(err.precedingErrors[0].message, 'Invalid column name \'a\'.')

        done()
      })
    },

    'query with raiseerror' (done) {
      const notices = []
      const req = new TestRequest()
      req.on('info', notices.push.bind(notices))
      req.query("print 'Print'; raiserror(N'Notice', 10, 1); raiserror(15097,-1,-1); raiserror (15600,-1,-1, 'mysp');", err => {
        assert.strictEqual(err instanceof sql.RequestError, true)
        assert.strictEqual(err.message, 'An invalid parameter or option was specified for procedure \'mysp\'.')
        assert.strictEqual(err.precedingErrors.length, 1)
        assert.strictEqual(err.precedingErrors[0] instanceof sql.RequestError, true)
        assert.strictEqual(err.precedingErrors[0].message, 'The size associated with an extended property cannot be more than 7,500 bytes.')

        assert.strictEqual(notices.length, 2)
        assert.strictEqual(notices[0].message, 'Print')
        assert.strictEqual(notices[0].number, 0)
        assert.strictEqual(notices[0].state, 1)
        assert.strictEqual(notices[1].message, 'Notice')
        assert.strictEqual(notices[1].number, 50000)
        assert.strictEqual(notices[1].state, 1)

        done()
      })
    },

    'query with toReadableStream' (done) {
      const stream = new WritableStream()
      stream.on('finish', () => {
        assert.strictEqual(stream.cache.length, 1)
        assert.strictEqual(stream.cache[0].text, 'asdf')
        done()
      })
      stream.on('error', err => {
        done(err)
      })

      const req = new sql.Request()
      const readableStream = req.toReadableStream()
      readableStream.pipe(stream)
      req.query('select \'asdf\' as text')
    },

    'query with pipe' (done) {
      const stream = new WritableStream()
      stream.on('finish', () => {
        assert.strictEqual(stream.cache.length, 1)
        assert.strictEqual(stream.cache[0].text, 'asdf')
        done()
      })
      stream.on('error', err => {
        done(err)
      })

      const req = new sql.Request()
      req.query('select \'asdf\' as text')
      req.pipe(stream)
    },

    'query with pipe and back pressure' (done) {
      const req = new sql.Request()
      const rowCountLimit = 2000 // table has 32768 rows
      const expectedBegEachRowText = 'Lorem ipsum dolor sit amet, consectetur'
      let readRowCount = 0
      let transformReadCount = 0
      const blockingTransformStream = new stream.Transform({
        readableObjectMode: true,
        writableObjectMode: true,
        transform (row, encoding, cb) {
          transformReadCount += 1
          if (transformReadCount < rowCountLimit && transformReadCount % 1000 === 0) {
            // every 1k rows, block for a second to test back pressure but not at end
            setTimeout(() => {
              // check that we are paused
              assert(req._paused, 'request should be paused')
              cb(null, row)
            }, 1000)
          } else {
            // otherwise go right through
            cb(null, row)
          }
        }
      })
      const wstream = new WritableStream()
      wstream.on('finish', () => {
        assert.strictEqual(readRowCount, rowCountLimit)
        assert.strictEqual(transformReadCount, rowCountLimit)
        assert.strictEqual(wstream.cache.length, rowCountLimit)
        wstream.cache.forEach(({ text }, idx) =>
          assert(
            text.startsWith(expectedBegEachRowText),
            `row[${idx}] does not start with '${expectedBegEachRowText}' text:${text}`
          )
        )
        done()
      })
      wstream.on('error', (err) => {
        done(err)
      })

      req.on('row', () => {
        readRowCount += 1
      })
      req.query(`select top ${rowCountLimit} * from streaming order by text`)
      req.pipe(blockingTransformStream).pipe(wstream)
    },

    'query with duplicate output column names' (done) {
      const req = new TestRequest()
      req.arrayRowMode = true
      req.query('select \'asdf\' as name, \'jkl\' as name').then(result => {
        assert.strictEqual(result.recordset.length, 1)
        assert.ok(result.recordset[0] instanceof Array)
        assert.strictEqual(result.recordset[0][0], 'asdf')
        assert.strictEqual(result.recordset[0][1], 'jkl')
        done()
      }).catch(done)
    },

    'batch' (done, stream) {
      const req = new TestRequest()
      req.batch('select 1 as num;select \'asdf\' as text').then(result => {
        assert.strictEqual(result.recordsets[0][0].num, 1)
        assert.strictEqual(result.recordsets[1][0].text, 'asdf')

        done()
      }).catch(done)
    },

    'create procedure batch' (done) {
      let req = new TestRequest()
      req.batch('create procedure #temporary as select 1 as num').then(result => {
        assert.ok(!result.recordset)

        req = new TestRequest()
        req.batch('exec #temporary').then(result => {
          assert.strictEqual(result.recordset[0].num, 1)

          req = new TestRequest()
          req.batch('exec #temporary;exec #temporary;exec #temporary').then(result => {
            assert.strictEqual(result.recordsets[0][0].num, 1)
            assert.strictEqual(result.recordsets[1][0].num, 1)
            assert.strictEqual(result.recordsets[2][0].num, 1)

            done()
          }).catch(done)
        }).catch(done)
      }).catch(done)
    },

    'bulk load' (name, done) {
      const t = new sql.Table(name)
      t.create = true
      t.columns.add('a', sql.Int, { nullable: false })
      t.columns.add('b', sql.VarChar(50), { nullable: true })
      t.rows.add(777, 'asdf')
      t.rows.add(453)
      t.rows.add(4535434)
      t.rows.add(12, 'XCXCDCDSCDSC')
      t.rows.add(1)
      t.rows.add(7278, '4524254')

      let req = new TestRequest()
      req.bulk(t).then(result => {
        assert.strictEqual(result.rowsAffected, 6)

        req = new sql.Request()
        req.batch(`select * from ${name}`).then(result => {
          assert.strictEqual(result.recordset[0].a, 777)
          assert.strictEqual(result.recordset[0].b, 'asdf')

          done()
        }).catch(done)
      }).catch(done)
    },

    'bulk load with varchar-max field' (name, done) {
      const t = new sql.Table(name)
      t.create = true
      t.columns.add('a', sql.NVarChar, {
        length: Infinity
      })

      t.rows.add('JP1016')
      let req = new TestRequest()
      req.bulk(t).then(result => {
        assert.strictEqual(result.rowsAffected, 1)

        req = new sql.Request()
        req.batch(`select * from ${name}`).then(result => {
          assert.strictEqual(result.recordset[0].a, 'JP1016')
          done()
        }).catch(done)
      }).catch(done)
    },

    'bulk converts dates' (done) {
      const t = new sql.Table('#bulkconverts')
      t.create = true
      t.columns.add('a', sql.Int, {
        nullable: false
      })
      t.columns.add('b', sql.DateTime2, {
        nullable: true
      })
      t.columns.add('c', sql.Date, {
        nullable: true
      })
      t.rows.add(1, new Date('2019-03-12T11:06:59.000Z'), new Date('2019-03-13'))
      t.rows.add(2, '2019-03-12T11:06:59.000Z', '2019-03-13T00:00:00.000Z')
      t.rows.add(3, 1552388819000, 1552499543000)

      let req = new TestRequest()
      req.bulk(t).then(result => {
        assert.strictEqual(result.rowsAffected, 3)

        req = new sql.Request()
        return req.batch('select * from #bulkconverts').then(result => {
          assert.strictEqual(result.recordset.length, 3)
          for (let i = 0; i < result.recordset.length; i++) {
            assert.strictEqual(result.recordset[i].b.toISOString(), '2019-03-12T11:06:59.000Z')
            assert.strictEqual(result.recordset[i].c.toISOString(), '2019-03-13T00:00:00.000Z')
          }

          done()
        })
      }).catch(done)
    },

    'bulk insert with length option as string other than max throws' (name, done) {
      const req = new TestRequest()
      const table = new sql.Table(name)
      table.create = true
      table.columns.add('name', sql.NVarChar, {
        length: 'random'
      })

      table.rows.add(table.rows, ['JP1016'])
      req.bulk(table).then(() => {
        assert.fail('it should throw error while insertion length with non-supported values')
        done()
      }).catch(err => {
        assert.strictEqual(err.message, "Incorrect syntax near 'random'.")
        assert.strictEqual(err.code, 'EREQUEST')
        assert.strictEqual(err.name, 'RequestError')
        done()
      }).catch(done)
    },

    'bulk insert with length option as undefined throws' (name, done) {
      const req = new TestRequest()
      const table = new sql.Table(name)
      table.create = true
      table.columns.add('name', sql.NVarChar, {
        length: undefined
      })

      table.rows.add(table.rows, ['JP1016'])
      req.bulk(table).then(() => {
        assert.fail('it should throw error while insertion length with non-supported values')
      }).catch(err => {
        assert.strictEqual(err.message, 'Invalid string.')
        assert.strictEqual(err.code, 'EREQUEST')
        assert.strictEqual(err.name, 'RequestError')
        done()
      }).catch(done)
    },

    'bulk insert with length as max' (name, done) {
      const t = new sql.Table(name)
      t.create = true
      t.columns.add('a', sql.NVarChar, {
        length: 'max'
      })

      t.rows.add('JP1016')
      let req = new TestRequest()
      req.bulk(t).then(result => {
        assert.strictEqual(result.rowsAffected, 1)

        req = new sql.Request()
        req.batch(`select * from ${name}`).then(result => {
          assert.strictEqual(result.recordset[0].a, 'JP1016')
          done()
        }).catch(done)
      }).catch(done)
    },

    'prepared statement' (done) {
      const ps = new TestPreparedStatement()
      ps.input('num', sql.Int)
      ps.input('num2', sql.Decimal(5, 2))
      ps.input('chr', sql.VarChar(sql.MAX))
      ps.input('chr2', sql.VarChar(sql.MAX))
      ps.input('chr3', sql.VarChar(5))
      ps.input('chr4', sql.VarChar(sql.MAX))
      ps.prepare('select @num as number, @num2 as number2, @chr as chars, @chr2 as chars2, @chr3 as chars3, @chr3 as chars4').then(() => {
        ps.execute({ num: 555, num2: 666.77, chr: 'asdf', chr2: null, chr3: '', chr4: '' }).then(result => {
          assert.strictEqual(result.recordset.length, 1)
          assert.strictEqual(result.recordset[0].number, 555)
          assert.strictEqual(result.recordset[0].number2, 666.77)
          assert.strictEqual(result.recordset[0].chars, 'asdf')
          assert.strictEqual(result.recordset[0].chars2, null)
          assert.strictEqual(result.recordset[0].chars3, '')
          assert.strictEqual(result.recordset[0].chars4, '')

          ps.unprepare(done)
        }).catch(err => {
          ps.unprepare(() => done(err))
        })
      }).catch(done)
    },

    'prepared statement that fails to prepare throws' (done) {
      const req = new TestPreparedStatement()
      req.prepare('some nonsense')
        .then(() => {
          return req.unprepare()
        })
        .then(() => {
          done(new Error('Unexpectedly prepared bad statement'))
        })
        .catch((err) => {
          // assert the error is as expected
          assert.ok(err)
          assert.strictEqual(err.code, 'EREQUEST')
          done()
        }).catch(done)
    },

    'prepared statement with duplicate parameters throws' (done) {
      const req = new TestPreparedStatement()
      try {
        req.input('in', sql.Int, null)
        req.output('in', sql.Int)
      } catch (err) {
        assert.ok(err)
        assert.strictEqual(err.code, 'EDUPEPARAM')
        done()
        return
      }
      assert.fail('failed to throw on duplicate paramter')
      done()
    },

    'prepared statement parameters can be replaced' (done) {
      const req = new TestPreparedStatement()
      req.input('in', sql.Int, null)
      req.replaceInput('in', sql.VarChar, 'test')
      req.output('out', sql.VarChar)
      req.replaceOutput('out', sql.Int)
      assert.strictEqual(req.parameters.in.type, sql.VarChar().type)
      assert.strictEqual(req.parameters.out.type, sql.Int().type)
      done()
    },

    'prepared statement with affected rows' (done) {
      const ps = new TestPreparedStatement()
      ps.input('data', sql.VarChar(50))
      ps.prepare('insert into prepstm_test values (@data);insert into prepstm_test values (@data);delete from prepstm_test;').then(result => {
        ps.execute({ data: 'abc' }).then(result => {
          assert.deepStrictEqual(result.rowsAffected, [1, 1, 2])

          ps.unprepare(done)
        }).catch(done)
      }).catch(done)
    },

    'prepared statement in transaction' (done) {
      const tran = new TestTransaction()
      tran.begin().then(() => {
        const ps = new TestPreparedStatement(tran)
        ps.input('num', sql.Int)
        ps.prepare('select @num as number').then(() => {
          assert.ok(tran._acquiredConnection === ps._acquiredConnection)

          ps.execute({ num: 555 }).then(result => {
            assert.strictEqual(result.recordsets[0].length, 1)
            assert.strictEqual(result.recordsets[0][0].number, 555)

            ps.unprepare().then(() => {
              tran.commit(done)
            }).catch(done)
          }).catch(done)
        }).catch(done)
      }).catch(done)
    },

    'prepared statement with duplicate output column names' (done) {
      const ps = new TestPreparedStatement()
      ps.arrayRowMode = true
      ps.input('num', sql.Int)
      ps.input('num2', sql.Decimal(5, 2))
      ps.prepare('select @num as number, @num2 as number').then(() => {
        ps.execute({ num: 555, num2: 666.77 }).then(result => {
          assert.strictEqual(result.recordset.length, 1)
          assert.ok(result.recordset[0] instanceof Array)
          assert.strictEqual(result.recordset[0][0], 555)
          assert.strictEqual(result.recordset[0][1], 666.77)

          ps.unprepare(done)
        }).catch(err => {
          ps.unprepare(() => done(err))
        })
      }).catch(done)
    },

    'transaction with rollback' (done) {
      let tbegin = false
      let tcommit = false
      let trollback = false

      const tran = new TestTransaction()
      tran.begin().then(() => {
        let req = tran.request()
        req.query('insert into tran_test values (\'test data\')').then(result => {
          let locked = true

          req = new TestRequest()
          req.query('select * from tran_test with (nolock)').then(result => {
            assert.strictEqual(result.recordset.length, 1)
            assert.strictEqual(result.recordset[0].data, 'test data')

            setTimeout(() => {
              if (!locked) return done(new Error('Unlocked before rollback.'))

              tran.rollback().catch(done)
            }, 100)
          }).catch(done)

          req = new TestRequest()
          req.query('select * from tran_test').then(result => {
            assert.strictEqual(result.recordset.length, 0)

            locked = false

            setTimeout(() => {
              assert.strictEqual(tbegin, true)
              assert.strictEqual(tcommit, false)
              assert.strictEqual(trollback, true)

              done()
            }, 100)
          }).catch(done)
        }).catch(done)
      }).catch(done)

      tran.on('begin', () => { tbegin = true })
      tran.on('commit', () => { tcommit = true })
      tran.on('rollback', (aborted) => {
        assert.strictEqual(aborted, false)
        trollback = true
      })
    },

    'transaction with commit' (done) {
      let tbegin = false
      let tcommit = false
      let trollback = false

      const tran = new TestTransaction()
      tran.begin().then(() => {
        let req = tran.request()
        req.query('insert into tran_test values (\'test data\')').then(result => {
          // In this case, table tran_test is locked until we call commit
          let locked = true

          req = new sql.Request()
          req.query('select * from tran_test').then(result => {
            assert.strictEqual(result.recordset.length, 1)
            assert.strictEqual(result.recordset[0].data, 'test data')

            locked = false
          }).catch(done)

          setTimeout(() => {
            if (!locked) return done(new Error('Unlocked before commit.'))

            tran.commit().then(result => {
              assert.strictEqual(tbegin, true)
              assert.strictEqual(tcommit, true)
              assert.strictEqual(trollback, false)

              setTimeout(() => {
                if (locked) { return done(new Error('Still locked after commit.')) }

                done()
              }, 200)
            }).catch(done)
          }, 200)
        }).catch(done)
      }).catch(done)

      tran.on('begin', () => { tbegin = true })
      tran.on('commit', () => { tcommit = true })
      tran.on('rollback', () => { trollback = true })
    },

    'transaction throws on bad isolation level' (done) {
      const tran = new TestTransaction()
      tran.begin('bad isolation level').then(() => {
        assert.fail('promise should not have resolved')
        done()
      }).catch(err => {
        assert.ok(err)
        assert.strictEqual(err.message, 'Invalid isolation level.')
        done()
      })
    },

    'transaction accepts good isolation levels' (done) {
      const promises = Object.keys(ISOLATION_LEVELS).map(level => {
        const tran = new TestTransaction()
        return tran.begin(ISOLATION_LEVELS[level]).then(() => {
          return tran.request().query('SELECT 1 AS num')
            .catch(err => {
              return tran.abort().then(() => Promise.reject(err))
            })
            .then(() => tran.commit())
        })
      })
      Promise.all(promises).then(() => done()).catch(err => {
        done(err)
      })
    },

    'transaction uses default isolation level' (done) {
      const originalIsolationLevel = BaseTransaction.defaultIsolationLevel
      assert.strictEqual(originalIsolationLevel, ISOLATION_LEVELS.READ_COMMITTED)
      BaseTransaction.defaultIsolationLevel = ISOLATION_LEVELS.READ_UNCOMMITTED
      const tran = new TestTransaction()
      assert.strictEqual(tran.isolationLevel, ISOLATION_LEVELS.READ_UNCOMMITTED)

      // Reset to originalIsolationLevel
      BaseTransaction.defaultIsolationLevel = originalIsolationLevel
      done()
    },

    'transaction with error' (done) {
      let expectedMessage = null
      versionHelper.isSQLServer2019OrNewer(sql).then(isSQLServer2019OrNewer => {
        const tran = new TestTransaction()
        tran.begin().then(() => {
          let rollbackHandled = false

          const req = tran.request()
          req.query('insert into tran_test values (\'asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasd\')').catch(err => {
            assert.ok(err)

            if (isSQLServer2019OrNewer) {
              const config = readConfig()
              const configDatabase = config.database
              const databaseName = configDatabase || 'master'
              expectedMessage = "String or binary data would be truncated in table '" + databaseName + ".dbo.tran_test', column 'data'. Truncated value: 'asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfas'."
            } else {
              expectedMessage = 'String or binary data would be truncated.'
            }
            assert.strictEqual(err.message, expectedMessage)

            tran.rollback().catch(err => {
              assert.ok(err)
              assert.strictEqual(err.message, 'Transaction has been aborted.')

              if (!rollbackHandled) { return done(new Error("Rollback event didn't fire.")) }

              done()
            }).catch(done)
          }).catch(done)

          tran.on('rollback', function (aborted) {
            try {
              assert.strictEqual(aborted, true)
            } catch (err) {
              done(err)
            }

            rollbackHandled = true
          })
        })
      }).catch(done)
    },

    'transaction with synchronous error' (done) {
      const tran = new TestTransaction()
      tran.begin().then(() => {
        const req = tran.request()
        req.input('date', sql.TinyInt, 1561651515615)

        req.execute('someStoreProc').catch(() => {
          tran.rollback(done)
        })
      }).catch(done)
    },

    'cancel request' (done, message) {
      const req = new TestRequest()
      req.query('waitfor delay \'00:00:05\';select 1').catch(err => {
        assert.ok((message ? (message.exec(err.message) != null) : (err instanceof sql.RequestError)))

        done()
      })

      req.cancel()
    },

    'repeat calls to connect resolve' (config, done) {
      const pool = new sql.ConnectionPool(config)
      Promise.all([pool.connect(), pool.connect()])
        .then(([pool1, pool2]) => {
          assert.strictEqual(pool, pool1)
          assert.strictEqual(pool, pool2)
          done()
        })
        .catch(done)
    },

    'calls to close during connection throw' (config, done) {
      const pool = new sql.ConnectionPool(config)
      Promise.all([
        pool.connect(),
        pool.close().catch((err) => {
          assert.strictEqual(err.message, 'Cannot close a pool while it is connecting')
        })
      ]).then(() => {
        assert.ok(pool.connected)
        done()
      }).catch(done)
    },

    'connection healthy works' (config, done) {
      const pool = new sql.ConnectionPool(config)
      assert.ok(!pool.healthy)
      pool.connect().then(() => {
        assert.ok(pool.healthy)
        return pool.close()
      }).then(() => {
        assert.ok(!pool.healthy)
        done()
      }).catch(done)
    },

    'healthy connection goes bad' (config, done) {
      const pool = new sql.ConnectionPool(Object.assign({}, config, {
        pool: {
          min: 0,
          max: 1
        }
      }))
      const ogCreate = pool._poolCreate.bind(pool)
      assert.ok(!pool.healthy)
      pool.connect().then(() => {
        assert.ok(pool.healthy)
        pool._poolCreate = () => {
          return Promise.reject(new sql.ConnectionError('Synthetic error'))
        }
        return pool.acquire().then((conn) => {
          try {
            assert.fail('acquire resolved unexpectedly')
          } finally {
            pool.release(conn)
          }
        }).catch(() => {
          assert.ok(pool.pool.numUsed() + pool.pool.numFree() <= 0)
          assert.ok(!pool.healthy)
        })
      }).then(() => {
        pool._poolCreate = ogCreate
        return pool.acquire().then((conn) => {
          try {
            assert.ok(pool.healthy)
          } finally {
            pool.release(conn)
          }
        })
      }).then(() => {
        return pool.close()
      }).then(() => {
        assert.ok(!pool.healthy)
        done()
      }).catch(done)
    },

    'request timeout' (done, driver, message) {
      const config = readConfig()
      config.driver = driver
      config.requestTimeout = 1000 // note: msnodesqlv8 doesn't support timeouts less than 1 second

      new sql.ConnectionPool(config).connect().then(conn => {
        const req = new TestRequest(conn)
        req.query('waitfor delay \'00:00:05\';select 1').catch(err => {
          assert.ok((message ? (message.exec(err.message) != null) : (err instanceof sql.RequestError)))

          conn.close()
          done()
        })
      })
    },

    'type validation' (mode, done) {
      const req = new TestRequest()
      req.input('image', sql.VarBinary, 'asdf')
      req[mode]('select * from @image').catch(err => {
        assert.strictEqual(err.message, "Validation failed for parameter 'image'. Invalid buffer.")

        done()
      }).catch(done)
    },

    'repeat calls to connect resolve in order' (connect, done) {
      Promise.all([
        connect().then((pool) => {
          assert.ok(pool.connected, 'Pool not connected')
          return Date.now()
        }),
        connect().then((pool) => {
          assert.ok(pool.connected, 'Pool not connected')
          return Date.now()
        })
      ]).then(([time1, time2]) => {
        assert.ok(time1 <= time2, 'Connections did not resolve in order')
        done()
      }).catch(done)
    },

    'json parser' (done) {
      const req = new TestRequest()
      req.query("select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for json path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for json path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for json auto;").then(result => {
        assert.deepStrictEqual(result.recordsets[0][0], [{ a: { b: { c: 1, d: 2 }, x: 3, y: 4 } }])
        assert.deepStrictEqual(result.recordsets[1][0], [{ a: { b: { c: 5, d: 6 }, x: 7, y: 8 } }])
        assert.strictEqual(result.recordsets[2][0].length, 1000)

        done()
      }).catch(done)
    },

    'empty json' (done) {
      const req = new TestRequest()
      req.query('declare @tbl table (id int); select * from @tbl for json path').then(result => {
        assert.ok(!result.recordsets[0][0])

        done()
      }).catch(done)
    },

    'chunked json support' (done) {
      const req = new TestRequest()
      req.query("select 1 as val;select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for json path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for json path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for json auto;select 'abc' as val;").then(result => {
        assert.strictEqual(result.recordsets[0][0].val, 1)
        assert.strictEqual(result.recordsets[0].length, 1)
        // assert.strictEqual(result.recordsets[1][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 39)
        // assert.strictEqual(result.recordsets[2][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 39)
        // assert.strictEqual(result.recordsets[3][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 9894)
        assert.strictEqual(result.recordsets[3].length, 1)
        assert.strictEqual(result.recordsets[4][0].val, 'abc')
        assert.strictEqual(result.recordsets[4].length, 1)

        done()
      }).catch(done)
    },

    'chunked xml support' (done) {
      let req = new TestRequest()
      req.query("select 1 as val;select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for xml path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for xml path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for xml auto;select 'abc' as val;").then(result => {
        assert.strictEqual(result.recordsets[0][0].val, 1)
        assert.strictEqual(result.recordsets[0].length, 1)
        assert.strictEqual(result.recordsets[1][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 67)
        assert.strictEqual(result.recordsets[2][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 67)
        assert.strictEqual(result.recordsets[3][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893)
        assert.strictEqual(result.recordsets[3].length, 1)
        assert.strictEqual(result.recordsets[4][0].val, 'abc')
        assert.strictEqual(result.recordsets[4].length, 1)

        req = new TestRequest()
        req.execute('__test3').then(result => {
          assert.strictEqual(result.recordset[0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893)

          done()
        }).catch(done)
      }).catch(done)
    },

    'dataLength type correction' (done) {
      sql.on('error', err => console.error(err))
      const req = new TestRequest()
      req.query('declare @t1 table (c1 bigint, c2 int);insert into @t1 (c1, c2) values (1, 2);with tt1 as ( select * from @t1 ), tt2 as (select count(c1) as x from tt1) select * from tt2 left outer join tt1 on 1=1').then(result => {
        assert.strictEqual(result.recordset.columns.x.type, sql.Int)
        assert.strictEqual(result.recordset.columns.c1.type, sql.BigInt)
        assert.strictEqual(result.recordset.columns.c2.type, sql.Int)

        done()
      }).catch(done)
    },

    'connection 1' (done, connection) {
      const req = connection.request()
      req.query('select @@SPID as id', (err, result) => {
        if (global.SPIDS[result.recordset[0].id]) return done(new Error('Existing SPID found.'))
        global.SPIDS[result.recordset[0].id] = true
        done(err)
      })
    },

    'connection 2' (done, connection) {
      const req = new sql.Request(connection)
      req.query('select @@SPID as id', (err, result) => {
        if (global.SPIDS[result.recordset[0].id]) return done(new Error('Existing SPID found.'))
        global.SPIDS[result.recordset[0].id] = true
        done(err)
      })
    },

    'global connection' (done) {
      const req = new sql.Request()
      req.query('select @@SPID as id', (err, result) => {
        if (global.SPIDS[result.recordset[0].id]) return done(new Error('Existing SPID found.'))
        global.SPIDS[result.recordset[0].id] = true
        done(err)
      })
    },

    'login failed' (done, message) {
      const config = readConfig()
      config.user = '__notexistinguser__'

      // eslint-disable-next-line no-new
      const conn = new sql.ConnectionPool(config, (err) => {
        assert.strictEqual((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true)
        conn.close()
        done()
      })
    },

    'timeout' (done, message) {
      // eslint-disable-next-line no-new
      const conn = new sql.ConnectionPool({
        user: '...',
        password: '...',
        server: '10.0.0.1',
        connectionTimeout: 1000,
        pool: { idleTimeoutMillis: 500 }
      }, (err) => {
        const isRunningUnderCI = process.env.CI && process.env.CI.toLowerCase() === 'true'
        if (!isRunningUnderCI) {
          // Skipping outside CI as this test relies on a controlled network environment.
          // See discussion at: https://github.com/tediousjs/node-mssql/issues/1277#issuecomment-886638039
          this.skip()
          return
        }

        const match = message.exec(err.message)
        assert.notStrictEqual(match, null, format('Expected timeout error message to match regexp', message, 'but instead received error message:', err.message))

        conn.close()
        done()
      })
    },

    'network error' (done, message) {
      // eslint-disable-next-line no-new
      const conn = new sql.ConnectionPool({
        user: '...',
        password: '...',
        server: '...'
      }, (err) => {
        assert.strictEqual((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true)
        conn.close()
        done()
      })
    },

    'max 10' (done, connection) {
      let countdown = 3
      const complete = () =>
        setTimeout(() => {
          // this must be delayed because destroying connection take some time
          assert.strictEqual(connection.size, 3)
          assert.strictEqual(connection.available, 3)
          assert.strictEqual(connection.pending, 0)
          assert.strictEqual(connection.borrowed, 0)
          done()
        }, 500)

      const r1 = new sql.Request(connection)
      r1.query('select 1 as id', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordset[0].id, 1)

        if (--countdown === 0) complete()
      })

      const r2 = new sql.Request(connection)
      r2.query('select 2 as id', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordset[0].id, 2)

        if (--countdown === 0) complete()
      })

      const r3 = new sql.Request(connection)
      r3.query('select 3 as id', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordset[0].id, 3)

        if (--countdown === 0) complete()
      })
    },

    'max 1' (done, connection) {
      let countdown = 3

      const r1 = new sql.Request(connection)
      r1.query('select 1 as id', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordset[0].id, 1)

        if (--countdown === 0) done()
      })

      const r2 = new sql.Request(connection)
      r2.query('select 2 as id', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordset[0].id, 2)

        if (--countdown === 0) done()
      })

      const r3 = new sql.Request(connection)
      r3.query('select 3 as id', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordset[0].id, 3)

        if (--countdown === 0) done()
      })

      setImmediate(() => {
        assert.strictEqual(connection.size, 1)
        assert.strictEqual(connection.available, 0)
        assert.strictEqual(connection.pending, 3)
        assert.strictEqual(connection.borrowed, 0)
      })
    },

    'interruption' (done, connection1, connection2) {
      let i = 0
      const go = function () {
        if (i++ >= 1) {
          return done(new Error('Stack overflow.'))
        }

        const r3 = new sql.Request(connection2)
        r3.query('select 1', function (err, result) {
          if (err) return done(err)

          assert.strictEqual(connection2.size, 1)
          assert.strictEqual(connection2.available, 1)
          assert.strictEqual(connection2.pending, 0)
          assert.strictEqual(connection2.borrowed, 0)

          done()
        })
      }

      const r1 = new sql.Request(connection2)
      r1.query('select @@spid as session', function (err, result) {
        if (err) return done(err)

        const r2 = new sql.Request(connection1)
        r2.query(`kill ${result.recordset[0].session}`, function (err, result) {
          if (err) return done(err)

          setTimeout(go, 1000)
        })
      })
    },

    'concurrent connections' (done, driver) {
      console.log('')

      let conns = []
      const peak = 500
      let curr = 0

      let mem = process.memoryUsage()
      console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

      const connected = function (err) {
        if (err) {
          console.error(err.stack)
          process.exit()
        }

        curr++
        if (curr === peak) {
          mem = process.memoryUsage()
          console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

          curr = 0
          Array.from(conns).map((c) =>
            c.close(closed))
        }
      }

      const closed = function () {
        curr++
        if (curr === peak) {
          conns = []
          global.gc()

          process.nextTick(function () {
            mem = process.memoryUsage()
            console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

            done()
          })
        }
      }

      __range__(1, peak, true).forEach((i) => {
        const c = new sql.ConnectionPool(readConfig())
        c.connect(connected)
        conns.push(c)
      })
    },

    'concurrent requests' (done, driver) {
      console.log('')

      const config = readConfig()
      config.driver = driver
      config.pool = { min: 0, max: 50 }

      const conn = new sql.ConnectionPool(config)

      conn.connect(function (err) {
        if (err) { return done(err) }

        const requests = []
        const peak = 10000
        let curr = 0

        let mem = process.memoryUsage()
        console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

        const completed = function (err, recordset) {
          if (err) {
            console.error(err.stack)
            process.exit()
          }

          assert.strictEqual(recordset[0].num, 123456)
          assert.strictEqual(recordset[0].str, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf')

          curr++
          if (curr === peak) {
            mem = process.memoryUsage()
            console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

            assert.strictEqual(conn.pool.getPoolSize(), 50)

            done()
          }
        }

        __range__(1, peak, true).forEach((i) => {
          const r = new sql.Request(conn)
          r.query("select 123456 as num, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf' as str", completed)
          requests.push(r)
        })
      })
    },

    'streaming off' (done) {
      const req = new TestRequest()
      req.query('select * from streaming').then(response => {
        const { recordset } = response

        assert.strictEqual(recordset.length, 32768)

        done()
      }).catch(done)
    },

    'streaming on' (done) {
      let rows = 0

      const req = new TestRequest()
      req.stream = true
      req.query('select * from streaming')
      req.on('error', err => {
        done(err)
      })

      req.on('row', row => rows++)

      req.on('done', function () {
        assert.strictEqual(rows, 32768)
        done()
      })
    },

    'streaming pause' (done) {
      let rows = 0

      const req = new TestRequest()
      req.stream = true
      req.query('select * from streaming')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          done(err)
        }
      })

      req.on('row', row => {
        rows++
        if (rows >= 10) {
          req.pause()
          // cancel the request in 1 second to give time for any more rows to come in
          setTimeout(() => {
            req.cancel()
            assert.strictEqual(rows, 10)
            done()
          }, 1000)
        }
      })
    },

    'a cancelled stream emits done event' (done) {
      let rows = 0

      const req = new TestRequest()
      req.stream = true
      req.query('select * from streaming')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          done(err)
        }
      })

      req.on('done', () => {
        done()
      })

      req.on('row', row => {
        rows++
        if (rows >= 10) {
          req.cancel()
        }
      })
    },

    'a cancelled paused stream emits done event' (done) {
      let rows = 0

      const req = new TestRequest()
      req.stream = true
      req.query('select * from streaming')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          done(err)
        }
      })

      req.on('done', () => {
        done()
      })

      req.on('row', row => {
        rows++
        if (rows >= 10) {
          req.pause()
          req.cancel()
        }
      })
    },

    'streaming resume' (done) {
      let rows = 0
      let started = false

      const req = new TestRequest()
      req.stream = true
      req.pause()
      req.query('select * from streaming')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          clearTimeout(timeout)
          done(err)
        }
      })

      // start the request after 1 second
      const timeout = setTimeout(() => {
        assert.ok(!started)
        assert.strictEqual(rows, 0)
        started = true
        req.resume()
      }, 1000)

      req.on('row', row => {
        assert.ok(started, 'row event received before stream resumed')
        rows++
        if (rows >= 10) {
          req.pause()
          req.cancel()
          assert.strictEqual(rows, 10)
          done()
        }
      })
    },

    'streaming rowsaffected' (done) {
      const req = new TestRequest()
      req.stream = true
      req.query('update rowsaffected_test set a = a')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          done(err)
        }
      })

      req.on('rowsaffected', (rowsAffected) => {
        assert.strictEqual(rowsAffected, 7)
        done()
      })
    },

    'streaming rowsaffected in stored procedure' (done) {
      const req = new TestRequest()
      req.stream = true
      req.execute('__testRowsAffected')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          done(err)
        }
      })

      req.on('rowsaffected', (rowsAffected) => {
        assert.strictEqual(rowsAffected, 7)
        done()
      })
    },

    'streaming trailing rows' (done) {
      let rows = 0
      const req = new TestRequest()
      req.stream = true
      req.query('select top 102 * from streaming')
      req.on('error', (err) => {
        if (err.code !== 'ECANCEL') {
          req.cancel()
          done(err)
        }
      })

      req.on('row', row => {
        rows++
        if (rows >= 102) {
          assert.strictEqual(rows, 102)
        }
      })
      req.on('done', () => {
        assert.strictEqual(rows, 102)
        done()
      })
    },

    'streaming with duplicate output column names' (done) {
      const result = []
      const recordsets = []
      const req = new TestRequest()
      req.stream = true
      req.arrayRowMode = true
      req.query('select top 2 text, \'test output\' as text from streaming')
      req.on('error', err => {
        done(err)
      })

      req.on('recordset', recordset => recordsets.push(recordset))

      req.on('row', row => result.push(row))

      req.on('done', function () {
        assert.strictEqual(recordsets.length, 1)
        assert.ok(recordsets[0] instanceof Array)
        assert.strictEqual(recordsets[0][0].index, 0)
        assert.strictEqual(recordsets[0][0].name, 'text')
        assert.strictEqual(recordsets[0][1].index, 1)
        assert.strictEqual(recordsets[0][1].name, 'text')
        assert.strictEqual(result.length, 2)
        done()
      })
    },

    'new Table' (done) {
      const tvp = new MSSQLTestType()
      tvp.rows.add('asdf', 15)

      const req = new TestRequest()
      req.input('tvp', tvp)
      req.execute('__test7').then(result => {
        assert.strictEqual(result.recordsets[0].length, 1)
        assert.strictEqual(result.recordsets[0][0].a, 'asdf')
        assert.strictEqual(result.recordsets[0][0].b, 15)

        done()
      }).catch(done)
    },

    'Recordset.toTable()' (done) {
      const req = new TestRequest()
      req.query('select \'asdf\' as a, 15 as b').then(result => {
        const tvp = result.recordset.toTable('dbo.MSSQLTestType')

        const req2 = new TestRequest()
        req2.input('tvp', tvp)
        req2.execute('__test7').then(result => {
          assert.strictEqual(result.recordsets[0].length, 1)
          assert.strictEqual(result.recordsets[0][0].a, 'asdf')
          assert.strictEqual(result.recordsets[0][0].b, 15)

          done()
        }).catch(done)
      }).catch(done)
    },

    'Recordset.toTable() from existing' (done) {
      const req = new TestRequest()
      req.query('select a, b, c from tvp_test').then(result => {
        const tvp = result.recordset.toTable('#tvp_test')

        assert.strictEqual(tvp.columns[1].nullable, true, 'the nullable property is not set as true')

        // note: msnodesqlv8 does not provide the identity and readOnly column metadata
        if (driver !== 'msnodesqlv8') {
          assert.strictEqual(tvp.columns[0].identity, true, 'the identity property is not set as true')
          assert.strictEqual(tvp.columns[2].readOnly, true, 'the readOnly property is not set as true')
        }

        done()
      }).catch(done)
    }
  }
}

function __range__ (left, right, inclusive) {
  const range = []
  const ascending = left < right
  const end = !inclusive ? right : ascending ? right + 1 : right - 1
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i)
  }
  return range
}

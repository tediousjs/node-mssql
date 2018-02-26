'use strict'

const assert = require('assert')
const stream = require('stream')

function clone (val) { return Object.assign({}, val) }

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
        result.recordsets.forEach(recordset => Object.defineProperty(recordset, 'columns', {enumerable: true})) // Make columns enumerable for tests
        results.push(result)

        // Promise style
        return super.execute(method)
      }).then(result => {
        result.recordsets.forEach(recordset => Object.defineProperty(recordset, 'columns', {enumerable: true})) // Make columns enumerable for tests
        results.push(result)

        // Stream style
        return new Promise((resolve, reject) => {
          const recordsets = []
          const errors = []

          this.stream = true
          super.execute(method)

          this.on('recordset', (columns) => {
            const recordset = []
            recordset.columns = columns
            recordsets.push(recordset)
          })
          this.on('row', row => recordsets[recordsets.length - 1].push(row))
          this.on('error', err => errors.push(err))
          this.on('done', result => {
            if (errors.length) return reject(errors.pop())
            resolve(Object.assign(result, {
              recordsets,
              recordset: recordsets[0]
            }))
          })
        })
      }).then(result => {
        results.push(result)

        return new Promise((resolve, reject) => {
          assert.deepEqual(results[0], results[1])
          assert.deepEqual(results[1], results[2])

          assert.deepEqual(results[0].output, results[1].output)
          assert.deepEqual(results[1].output, results[2].output)

          resolve(results[0])
        })
      })
    }
  }

  class TestPreparedStatement extends sql.PreparedStatement {

  }

  class TestTransaction extends sql.Transaction {

  }

  return {
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
        // if (method !== 'batch') assert.equal(result.returnValue, 11);
        assert.equal(result.recordsets.length, 3)
        assert.equal(result.recordsets[0].length, 2)
        assert.equal(result.recordsets[0][0].a, 1)
        assert.equal(result.recordsets[0][0].b, 2)
        assert.equal(result.recordsets[0][1].a, 3)
        assert.equal(result.recordsets[0][1].b, 4)
        assert.equal(result.recordsets[1].length, 1)
        assert.equal(result.recordsets[1][0].c, 5)
        assert.equal(result.recordsets[1][0].d, 6)
        assert.equal(result.recordsets[1][0].e.length, 3)

        assert.equal(result.recordsets[1][0].e[0], 0)
        assert.equal(result.recordsets[1][0].e[1], 111)
        assert.equal(result.recordsets[1][0].e[2], 'asdf')

        assert.equal(result.recordsets[1][0].f, null)
        assert.equal(result.recordsets[1][0].g, 'anystring')
        assert.equal(result.recordsets[2].length, 0)

        assert.equal(result.output.out, 99)
        assert.equal(result.output.out2, null)
        assert.equal(result.output.out3, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F')
        assert.equal(result.output.out4.getTime(), +new Date(1860, 0, 24, 1, 52))
        assert.equal(result.output.out5, 'anystring ')

        assert.equal(result.recordsets[0].columns.a.index, 0)
        assert.equal(result.recordsets[0].columns.b.index, 1)

        done()
      }).catch(done)
    },

    'user defined types' (done) {
      const req = new TestRequest()
      req.query("declare @g geography = geography::[Null];select geography::STGeomFromText('LINESTRING(-122.360 47.656, -122.343 47.656 )', 4326) as geography, geometry::STGeomFromText('LINESTRING (100 100 10.3 12, 20 180, 180 180)', 0) geometry, @g as nullgeography").then(result => {
        // console.dir rst[0].geography
        // console.dir rst[0].geometry

        // assert.deepEqual rst[0].geography, sample1
        // assert.deepEqual rst[0].geometry, sample2

        assert.strictEqual(result.recordset[0].geography.srid, 4326)
        assert.strictEqual(result.recordset[0].geography.version, 1)
        assert.strictEqual(result.recordset[0].geography.points.length, 2)
        assert.strictEqual(result.recordset[0].geography.points[0].x, 47.656)
        assert.strictEqual(result.recordset[0].geography.points[1].y, -122.343)
        assert.strictEqual(result.recordset[0].geography.figures.length, 1)
        assert.strictEqual(result.recordset[0].geography.figures[0].attribute, 0x01)
        assert.strictEqual(result.recordset[0].geography.shapes.length, 1)
        assert.strictEqual(result.recordset[0].geography.shapes[0].type, 0x02)
        assert.strictEqual(result.recordset[0].geography.segments.length, 0)

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
        assert.equal(result.recordset.columns.geography.udt.name, 'geography')
        assert.equal(result.recordset.columns.geometry.udt.name, 'geometry')

        done()
      }).catch(done)
    },

    'binary data' (done) {
      const sample = new Buffer([0x00, 0x01, 0xe2, 0x40])

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
        assert.deepEqual(result.recordsets[0][0].bin, sample)
        assert.deepEqual(result.recordsets[0][0].in, sample)
        assert.equal(result.recordsets[0][0].in2, null)
        assert.deepEqual(result.recordsets[0][0].in3, sample)
        assert.equal(result.recordsets[0][0].in4, null)
        assert.deepEqual(result.recordsets[0][0].in5, sample)
        assert.equal(result.recordsets[0][0].in6, null)

        assert.deepEqual(result.output.out, sample)
        assert.deepEqual(result.output.out2, sample)

        done()
      }).catch(done)
    },

    'variant data' (done) {
      const req = new TestRequest()
      req.query('select cast(11.77 as sql_variant) as variant').then(result => {
        assert.equal(result.recordset.length, 1)
        assert.strictEqual(result.recordset[0].variant, 11.77)

        done()
      }).catch(done)
    },

    'stored procedure with one empty recordset' (done) {
      const req = new TestRequest()
      req.execute('__test2').then(result => {
        assert.equal(result.returnValue, 11)
        assert.equal(result.recordsets.length, 2)

        done()
      }).catch(done)
    },

    'domain' (done) {
      let d = require('domain').create()
      d.run(function () {
        const req = new TestRequest()
        let domain = process.domain

        req.query('', function (err, recordset) {
          assert.strictEqual(domain, process.domain)

          done(err)
        })
      })
    },

    'empty query' (done) {
      const req = new TestRequest()
      req.query('').then(result => {
        assert.equal(result.recordset, null)

        done()
      }).catch(done)
    },

    'query with no recordset' (done) {
      const req = new TestRequest()
      req.query('select * from sys.tables where name = \'______\'').then(result => {
        assert.equal(result.recordset.length, 0)

        done()
      }).catch(done)
    },

    'query with one recordset' (done) {
      const req = new TestRequest()
      req.query('select \'asdf\' as text').then(result => {
        assert.equal(result.recordset.length, 1)
        assert.equal(result.recordset[0].text, 'asdf')

        done()
      }).catch(done)
    },

    'query with multiple recordsets' (done) {
      const req = new TestRequest()
      req.query('select 41 as test, 5 as num, 6 as num;select 999 as second').then(result => {
        assert.equal(result.recordsets.length, 2)
        assert.equal(result.recordsets[0].length, 1)
        assert.equal(result.recordsets[0][0].test, 41)
        assert.equal(result.recordsets[0][0].num.length, 2)
        assert.equal(result.recordsets[0][0].num[0], 5)
        assert.equal(result.recordsets[0][0].num[1], 6)
        assert.equal(result.recordsets[1][0].second, 999)
        assert.equal(result.recordsets[0].columns.test.type, sql.Int)

        done()
      }).catch(done)
    },

    'query with input parameters' (mode, done) {
      const buff = new Buffer([0x00, 0x01, 0xe2, 0x40])

      const req = new sql.Request()
      req.input('id', 12)
      req.input('vch', sql.VarChar(300), 'asdf')
      req.input('vchm', sql.VarChar(sql.MAX), 'fdsa')
      req.input('vbin', buff)
      req[mode]('select @id as id, @vch as vch, @vchm as vchm, @vbin as vbin').then(result => {
        assert.equal(result.recordset.length, 1)
        assert.equal(result.recordset[0].id, 12)
        assert.equal(result.recordset[0].vch, 'asdf')
        assert.equal(result.recordset[0].vchm, 'fdsa')
        assert.deepEqual(result.recordset[0].vbin, buff)

        done()
      }).catch(done)
    },

    'query with output parameters' (mode, done) {
      const req = new TestRequest()
      req.output('out', sql.VarChar)
      req[mode]('select @out = \'test\'').then(result => {
        assert.equal(result.recordset, null)
        assert.equal(result.output.out, 'test')

        done()
      }).catch(done)
    },

    'query with error' (done) {
      const req = new TestRequest()
      req.query('select * from notexistingtable', err => {
        assert.equal(err instanceof sql.RequestError, true)

        assert.strictEqual(err.message, 'Invalid object name \'notexistingtable\'.')
        assert.strictEqual(err.code, 'EREQUEST')
        assert.strictEqual(err.number, 208)

        if (driver !== 'msnodesqlv8') {
          assert.strictEqual(err.lineNumber, 1)
          assert.strictEqual(err.state, 1)
          assert.strictEqual(err.class, 16)
        }

        done()
      })
    },

    'query with multiple errors' (done) {
      const req = new TestRequest()
      req.query('select a;select b;', err => {
        assert.equal(err instanceof sql.RequestError, true)
        assert.equal(err.message, 'Invalid column name \'b\'.')
        assert.equal(err.precedingErrors.length, 1)
        assert.equal(err.precedingErrors[0] instanceof sql.RequestError, true)
        assert.equal(err.precedingErrors[0].message, 'Invalid column name \'a\'.')

        done()
      })
    },

    'query with raiseerror' (done) {
      const notices = []
      const req = new TestRequest()
      req.on('info', notices.push.bind(notices))
      req.query("print 'Print'; raiserror(N'Notice', 10, 1); raiserror(15097,-1,-1); raiserror (15600,-1,-1, 'mysp');", err => {
        assert.equal(err instanceof sql.RequestError, true)
        assert.equal(err.message, 'An invalid parameter or option was specified for procedure \'mysp\'.')
        assert.equal(err.precedingErrors.length, 1)
        assert.equal(err.precedingErrors[0] instanceof sql.RequestError, true)
        assert.equal(err.precedingErrors[0].message, 'The size associated with an extended property cannot be more than 7,500 bytes.')

        assert.equal(notices.length, 2)
        assert.equal(notices[0].message, 'Print')
        assert.equal(notices[0].number, 0)
        assert.equal(notices[0].state, 1)
        assert.equal(notices[1].message, 'Notice')
        assert.equal(notices[1].number, 50000)
        assert.equal(notices[1].state, 1)

        done()
      })
    },

    'query with pipe' (done) {
      const stream = new WritableStream()
      stream.on('finish', () => {
        assert.equal(stream.cache.length, 1)
        assert.equal(stream.cache[0].text, 'asdf')
        done()
      })
      stream.on('error', err => {
        done(err)
      })

      const req = new sql.Request()
      req.query('select \'asdf\' as text')
      req.pipe(stream)
    },

    'batch' (done, stream) {
      const req = new TestRequest()
      req.batch('select 1 as num;select \'asdf\' as text').then(result => {
        assert.equal(result.recordsets[0][0].num, 1)
        assert.equal(result.recordsets[1][0].text, 'asdf')

        done()
      }).catch(done)
    },

    'create procedure batch' (done) {
      let req = new TestRequest()
      req.batch('create procedure #temporary as select 1 as num').then(result => {
        assert.equal(result.recordset, null)

        req = new TestRequest()
        req.batch('exec #temporary').then(result => {
          assert.equal(result.recordset[0].num, 1)

          req = new TestRequest()
          req.multiple = true
          req.batch('exec #temporary;exec #temporary;exec #temporary').then(result => {
            assert.equal(result.recordsets[0][0].num, 1)
            assert.equal(result.recordsets[1][0].num, 1)
            assert.equal(result.recordsets[2][0].num, 1)

            done()
          }).catch(done)
        }).catch(done)
      }).catch(done)
    },

    'bulk load' (name, done) {
      let t = new sql.Table(name)
      t.create = true
      t.columns.add('a', sql.Int, {nullable: false})
      t.columns.add('b', sql.VarChar(50), {nullable: true})
      t.rows.add(777, 'asdf')
      t.rows.add(453)
      t.rows.add(4535434)
      t.rows.add(12, 'XCXCDCDSCDSC')
      t.rows.add(1)
      t.rows.add(7278, '4524254')

      let req = new TestRequest()
      req.bulk(t).then(result => {
        assert.equal(result.rowsAffected, 6)

        req = new sql.Request()
        req.batch(`select * from ${name}`).then(result => {
          assert.equal(result.recordset[0].a, 777)
          assert.equal(result.recordset[0].b, 'asdf')

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
        ps.execute({num: 555, num2: 666.77, chr: 'asdf', chr2: null, chr3: '', chr4: ''}).then(result => {
          assert.equal(result.recordset.length, 1)
          assert.equal(result.recordset[0].number, 555)
          assert.equal(result.recordset[0].number2, 666.77)
          assert.equal(result.recordset[0].chars, 'asdf')
          assert.equal(result.recordset[0].chars2, null)
          assert.equal(result.recordset[0].chars3, '')
          assert.equal(result.recordset[0].chars4, '')

          ps.unprepare(done)
        }).catch(err => {
          ps.unprepare(() => done(err))
        })
      }).catch(done)
    },

    'prepared statement with affected rows' (done) {
      let ps = new TestPreparedStatement()
      ps.input('data', sql.VarChar(50))
      ps.prepare('insert into prepstm_test values (@data);insert into prepstm_test values (@data);delete from prepstm_test;').then(result => {
        ps.execute({data: 'abc'}).then(result => {
          assert.deepEqual(result.rowsAffected, [1, 1, 2])

          ps.unprepare(done)
        }).catch(done)
      }).catch(done)
    },

    'prepared statement in transaction' (done) {
      let tran = new TestTransaction()
      tran.begin().then(() => {
        let ps = new TestPreparedStatement(tran)
        ps.input('num', sql.Int)
        ps.prepare('select @num as number').then(() => {
          assert.ok(tran._acquiredConnection === ps._acquiredConnection)

          ps.execute({num: 555}).then(result => {
            assert.equal(result.recordsets[0].length, 1)
            assert.equal(result.recordsets[0][0].number, 555)

            ps.unprepare().then(() => {
              tran.commit(done)
            }).catch(done)
          }).catch(done)
        }).catch(done)
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
            assert.equal(result.recordset.length, 1)
            assert.equal(result.recordset[0].data, 'test data')

            setTimeout(() => {
              if (!locked) return done(new Error('Unlocked before rollback.'))

              tran.rollback().catch(done)
            }, 100)
          }).catch(done)

          req = new TestRequest()
          req.query('select * from tran_test').then(result => {
            assert.equal(result.recordset.length, 0)

            locked = false

            setTimeout(() => {
              assert.equal(tbegin, true)
              assert.equal(tcommit, false)
              assert.equal(trollback, true)

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
      var tbegin = false
      var tcommit = false
      var trollback = false

      let tran = new TestTransaction()
      tran.begin().then(() => {
        let req = tran.request()
        req.query('insert into tran_test values (\'test data\')').then(result => {
          // In this case, table tran_test is locked until we call commit
          let locked = true

          req = new sql.Request()
          req.query('select * from tran_test').then(result => {
            assert.equal(result.recordset.length, 1)
            assert.equal(result.recordset[0].data, 'test data')

            locked = false
          }).catch(done)

          setTimeout(() => {
            if (!locked) return done(new Error('Unlocked before commit.'))

            tran.commit().then(result => {
              assert.equal(tbegin, true)
              assert.equal(tcommit, true)
              assert.equal(trollback, false)

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

    'transaction with error' (done) {
      let tran = new TestTransaction()
      tran.begin().then(() => {
        let rollbackHandled = false

        let req = tran.request()
        req.query('insert into tran_test values (\'asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasd\')').catch(err => {
          assert.ok(err)
          assert.equal(err.message, 'String or binary data would be truncated.')

          tran.rollback().catch(err => {
            assert.ok(err)
            assert.equal(err.message, 'Transaction has been aborted.')

            if (!rollbackHandled) { return done(new Error("Rollback event didn't fire.")) }

            done()
          })
        })

        tran.on('rollback', function (aborted) {
          assert.strictEqual(aborted, true)

          rollbackHandled = true
        })
      }).catch(done)
    },

    'transaction with synchronous error' (done) {
      let tran = new TestTransaction()
      tran.begin().then(() => {
        let req = tran.request()
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

    'request timeout' (done, driver, message) {
      const config = clone(require('../mssql-config'))
      config.driver = driver
      config.requestTimeout = 1000  // note: msnodesqlv8 doesn't support timeouts less than 1 second

      new sql.ConnectionPool(config).connect().then(conn => {
        const req = new TestRequest(conn)
        req.query('waitfor delay \'00:00:05\';select 1').catch(err => {
          assert.ok((message ? (message.exec(err.message) != null) : (err instanceof sql.RequestError)))

          done()
        })
      })
    },

    'type validation' (mode, done) {
      const req = new TestRequest()
      req.input('image', sql.VarBinary, 'asdf')
      req[mode]('select * from @image').catch(err => {
        assert.equal(err.message, "Validation failed for parameter 'image'. Invalid buffer.")

        done()
      })
    },

    'json parser' (done) {
      const req = new TestRequest()
      req.query("select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for json path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for json path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for json auto;").then(result => {
        assert.deepEqual(result.recordsets[0][0], [{'a': {'b': {'c': 1, 'd': 2}, 'x': 3, 'y': 4}}])
        assert.deepEqual(result.recordsets[1][0], [{'a': {'b': {'c': 5, 'd': 6}, 'x': 7, 'y': 8}}])
        assert.strictEqual(result.recordsets[2][0].length, 1000)

        done()
      }).catch(done)
    },

    'chunked json support' (done) {
      const req = new TestRequest()
      req.query("select 1 as val;select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for json path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for json path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for json auto;select 'abc' as val;").then(result => {
        assert.equal(result.recordsets[0][0].val, 1)
        assert.equal(result.recordsets[0].length, 1)
        assert.equal(result.recordsets[1][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 39)
        assert.equal(result.recordsets[2][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 39)
        assert.equal(result.recordsets[3][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 9894)
        assert.equal(result.recordsets[3].length, 1)
        assert.equal(result.recordsets[4][0].val, 'abc')
        assert.equal(result.recordsets[4].length, 1)

        done()
      }).catch(done)
    },

    'chunked xml support' (done) {
      let req = new TestRequest()
      req.query("select 1 as val;select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for xml path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for xml path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for xml auto;select 'abc' as val;").then(result => {
        assert.equal(result.recordsets[0][0].val, 1)
        assert.equal(result.recordsets[0].length, 1)
        assert.equal(result.recordsets[1][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 67)
        assert.equal(result.recordsets[2][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 67)
        assert.equal(result.recordsets[3][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893)
        assert.equal(result.recordsets[3].length, 1)
        assert.equal(result.recordsets[4][0].val, 'abc')
        assert.equal(result.recordsets[4].length, 1)

        req = new TestRequest()
        req.execute('__test3').then(result => {
          assert.equal(result.recordset[0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893)

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
      const config = clone(require('../mssql-config'))
      config.user = '__notexistinguser__'

      // eslint-disable-next-line no-new
      new sql.ConnectionPool(config, (err) => {
        assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true)
        done()
      })
    },

    'timeout' (done, message) {
      // eslint-disable-next-line no-new
      new sql.ConnectionPool({
        user: '...',
        password: '...',
        server: '10.0.0.1',
        connectionTimeout: 1000,
        pool: {idleTimeoutMillis: 500}
      }, (err) => {
        assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true)
        done()
      })
    },

    'network error' (done, message) {
      // eslint-disable-next-line no-new
      new sql.ConnectionPool({
        user: '...',
        password: '...',
        server: '...'
      }, (err) => {
        assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true)
        done()
      })
    },

    'max 10' (done, connection) {
      let countdown = 3
      const complete = () =>
        setTimeout(() => {
          // this must be delayed because destroying connection take some time
          assert.equal(connection.pool.size, 3)
          assert.equal(connection.pool.available, 3)
          assert.equal(connection.pool.pending, 0)
          assert.equal(connection.pool.borrowed, 0)
          done()
        }, 500)

      const r1 = new sql.Request(connection)
      r1.query('select 1 as id', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordset[0].id, 1)

        if (--countdown === 0) complete()
      })

      const r2 = new sql.Request(connection)
      r2.query('select 2 as id', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordset[0].id, 2)

        if (--countdown === 0) complete()
      })

      const r3 = new sql.Request(connection)
      r3.query('select 3 as id', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordset[0].id, 3)

        if (--countdown === 0) complete()
      })
    },

    'max 1' (done, connection) {
      let countdown = 3

      const r1 = new sql.Request(connection)
      r1.query('select 1 as id', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordset[0].id, 1)

        if (--countdown === 0) done()
      })

      const r2 = new sql.Request(connection)
      r2.query('select 2 as id', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordset[0].id, 2)

        if (--countdown === 0) done()
      })

      const r3 = new sql.Request(connection)
      r3.query('select 3 as id', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordset[0].id, 3)

        if (--countdown === 0) done()
      })

      setImmediate(() => {
        assert.equal(connection.pool.size, 1)
        assert.equal(connection.pool.available, 0)
        assert.equal(connection.pool.pending, 3)
        assert.equal(connection.pool.borrowed, 0)
      })
    },

    'interruption' (done, connection1, connection2) {
      let i = 0
      let go = function () {
        if (i++ >= 1) {
          return done(new Error('Stack overflow.'))
        }

        let r3 = new sql.Request(connection2)
        r3.query('select 1', function (err, result) {
          if (err) return done(err)

          assert.equal(connection2.pool.size, 1)
          assert.equal(connection2.pool.available, 1)
          assert.equal(connection2.pool.pending, 0)
          assert.equal(connection2.pool.borrowed, 0)

          done()
        })
      }

      let r1 = new sql.Request(connection2)
      r1.query('select @@spid as session', function (err, result) {
        if (err) return done(err)

        let r2 = new sql.Request(connection1)
        r2.query(`kill ${result.recordset[0].session}`, function (err, result) {
          if (err) return done(err)

          setTimeout(go, 1000)
        })
      })
    },

    'concurrent connections' (done, driver) {
      console.log('')

      let conns = []
      let peak = 500
      let curr = 0

      let mem = process.memoryUsage()
      console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

      let connected = function (err) {
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

      var closed = function () {
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

      __range__(1, peak, true).map((i) => {
        const c = new sql.ConnectionPool(require('../mssql-config'))
        c.connect(connected)
        conns.push(c)
      })
    },

    'concurrent requests' (done, driver) {
      console.log('')

      let config = clone(require('../mssql-config'))
      config.driver = driver
      config.pool = {min: 0, max: 50}

      let conn = new sql.ConnectionPool(config)

      conn.connect(function (err) {
        if (err) { return done(err) }

        let requests = []
        let peak = 10000
        let curr = 0

        let mem = process.memoryUsage()
        console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

        let completed = function (err, recordset) {
          if (err) {
            console.error(err.stack)
            process.exit()
          }

          assert.equal(recordset[0].num, 123456)
          assert.equal(recordset[0].str, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf')

          curr++
          if (curr === peak) {
            mem = process.memoryUsage()
            console.log('rss: %s, heapTotal: %s, heapUsed: %s', mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024)

            assert.equal(conn.pool.getPoolSize(), 50)

            done()
          }
        }

        __range__(1, peak, true).map((i) => {
          const r = new sql.Request(conn)
          r.query("select 123456 as num, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf' as str", completed)
          requests.push(r)
        })
      })
    },

    'streaming off' (done, driver) {
      let config = clone(require('../mssql-config'))
      config.driver = driver
      config.requestTimeout = 60000

      sql.connect(config, function (err) {
        if (err) { return done(err) }

        const req = new TestRequest()
        req.query('select * from streaming', function (err, recordset) {
          if (err) { return done(err) }

          console.log(`Got ${recordset.length} rows.`)

          done()
        })
      })
    },

    'streaming on' (done, driver) {
      let config = clone(require('../mssql-config'))
      config.driver = driver
      config.requestTimeout = 60000

      let rows = 0

      sql.connect(config, function (err) {
        if (err) { return done(err) }

        const req = new TestRequest()
        req.stream = true
        req.query('select * from streaming')
        req.on('error', err => console.error(err))

        req.on('row', row => rows++)

        req.on('done', function () {
          console.log(`Got ${rows} rows.`)

          done()
        })
      })
    }
  }
}

function __range__ (left, right, inclusive) {
  let range = []
  let ascending = left < right
  let end = !inclusive ? right : ascending ? right + 1 : right - 1
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i)
  }
  return range
}

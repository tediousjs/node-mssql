'use strict'

/* globals describe, it, before, after */

const sql = require('../../tedious.js')
const assert = require('assert')

const TESTS = require('../common/tests.js')(sql, 'tedious')
const TIMES = require('../common/times.js')(sql, 'tedious')
const TEMPLATE_STRING = require('../common/templatestring.js')(sql, 'tedious')

if (parseInt(process.version.match(/^v(\d+)\./)[1]) > 0) {
  require('../common/templatestring.js')
}

function clone (val) { return Object.assign({}, val) }

const config = function () {
  let cfg = clone(require('../mssql-config'))
  cfg.driver = 'tedious'
  return cfg
}

let connection1 = null
let connection2 = null

describe('tedious', () => {
  before(done =>
    sql.connect(config(), err => {
      if (err) return done(err)

      let req = new sql.Request()
      req.query(require('fs').readFileSync(`${__dirname}/../cleanup.sql`, 'utf8'), err => {
        if (err) return done(err)

        req = new sql.Request()
        req.query(require('fs').readFileSync(`${__dirname}/../prepare.sql`, 'utf8'), err => {
          if (err) return done(err)

          sql.close(done)
        })
      })
    })
  )

  describe('basic test suite', () => {
    before((done) => {
      let cfg = config()
      cfg.options.abortTransactionOnError = true
      sql.connect(cfg, done)
    })

    it('stored procedure (exec)', done => TESTS['stored procedure']('execute', done))
    it('stored procedure (batch)', done => TESTS['stored procedure']('batch', done))
    it('user defined types', done => TESTS['user defined types'](done))
    it('binary data', done => TESTS['binary data'](done))
    it('variant data (not yet published)', done => TESTS['variant data'](done))
    it('stored procedure with one empty recordset', done => TESTS['stored procedure with one empty recordset'](done))
    it('empty query', done => TESTS['empty query'](done))
    it('query with no recordset', done => TESTS['query with no recordset'](done))
    it('query with one recordset', done => TESTS['query with one recordset'](done))
    it('query with multiple recordsets', done => TESTS['query with multiple recordsets'](done))
    it('query with input parameters', done => TESTS['query with input parameters']('query', done))
    it('query with input parameters (batch)', done => TESTS['query with input parameters']('batch', done))
    it('query with output parameters', done => TESTS['query with output parameters']('query', done))
    it('query with output parameters (batch)', done => TESTS['query with output parameters']('batch', done))
    it('query with error', done => TESTS['query with error'](done))
    it('query with multiple errors', done => TESTS['query with multiple errors'](done))
    it('query with raiseerror', done => TESTS['query with raiseerror'](done))
    it('query with pipe', done => TESTS['query with pipe'](done))
    it('batch', done => TESTS['batch'](done))
    it('create procedure batch', done => TESTS['create procedure batch'](done))
    it('prepared statement', done => TESTS['prepared statement'](done))
    it('prepared statement with affected rows', done => TESTS['prepared statement with affected rows'](done))
    it('prepared statement in transaction', done => TESTS['prepared statement in transaction'](done))
    it('transaction with rollback', done => TESTS['transaction with rollback'](done))
    it('transaction with commit', done => TESTS['transaction with commit'](done))
    it('transaction with error (XACT_ABORT set to ON)', done => TESTS['transaction with error'](done))
    it('transaction with synchronous error', done => TESTS['transaction with synchronous error'](done))
    it('cancel request', done => TESTS['cancel request'](done, /Canceled./))
    it('request timeout', done => TESTS['request timeout'](done, 'tedious', /Timeout: Request failed to complete in 1000ms/))
    it('dataLength type correction', done => TESTS['dataLength type correction'](done))
    it('type validation', done => TESTS['type validation']('query', done))
    it('type validation (batch)', done => TESTS['type validation']('batch', done))
    it.skip('chunked json support (requires SQL Server 2016)', done => TESTS['chunked json support'](done))
    it('chunked xml support', done => TESTS['chunked xml support'](done))

    after(done => sql.close(done))
  })

  describe('json support (requires SQL Server 2016)', () => {
    before(function (done) {
      if (process.env.MSSQL_VERSION !== '2016') return this.skip()

      let cfg = config()
      cfg.parseJSON = true
      sql.connect(cfg, done)
    })

    it('parser', done => TESTS['json parser'](done))
    it('empty json', done => TESTS['empty json'](done))

    after(done => sql.close(done))
  })

  describe('bulk load', () => {
    before((done) => {
      sql.connect(config(), (err) => {
        if (err) return done(err)

        const req = new sql.Request()
        req.query('delete from bulk_table', done)
      })
    })

    it('bulk load (table)', done => TESTS['bulk load']('bulk_table', done))
    it('bulk load (temporary table)', done => TESTS['bulk load']('#anohter_bulk_table', done))

    after(done => sql.close(done))
  })

  describe('dates and times (local)', () => {
    before(function (done) {
      const cfg = config()
      cfg.options.useUTC = false
      sql.connect(cfg, done)
    })

    it('time', done => TIMES['time'](false, done))
    it('time as parameter', done => TIMES['time as parameter'](false, done))
    it('date', done => TIMES['date'](false, done))
    it('date as parameter', done => TIMES['date as parameter'](false, done))
    it('datetime', done => TIMES['datetime'](false, done))
    it('datetime as parameter', done => TIMES['datetime as parameter'](false, done))
    it('datetime2', done => TIMES['datetime2'](false, done))
    it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](false, done))
    it('datetimeoffset', done => TIMES['datetimeoffset'](false, done))
    it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](false, done))
    it('smalldatetime', done => TIMES['smalldatetime'](false, done))
    it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](false, done))

    return after(done => sql.close(done))
  })

  describe('dates and times (utc)', () => {
    before(function (done) {
      const cfg = config()
      cfg.options.useUTC = true
      sql.connect(cfg, done)
    })

    it('time', done => TIMES['time'](true, done))
    it('time as parameter', done => TIMES['time as parameter'](true, done))
    it('date', done => TIMES['date'](true, done))
    it('date as parameter', done => TIMES['date as parameter'](true, done))
    it('datetime', done => TIMES['datetime'](true, done))
    it('datetime as parameter', done => TIMES['datetime as parameter'](true, done))
    it('datetime2', done => TIMES['datetime2'](true, done))
    it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](true, done))
    it('datetimeoffset', done => TIMES['datetimeoffset'](true, done))
    it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](true, done))
    it('smalldatetime', done => TIMES['smalldatetime'](true, done))
    it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](true, done))

    after(done => sql.close(done))
  })

  describe('template strings', () => {
    before((done) => {
      sql.connect(config(), done)
    })

    it('query', done => TEMPLATE_STRING['query'](done))
    it('batch', done => TEMPLATE_STRING['batch'](done))

    after(done => sql.close(done))
  })

  describe('multiple connections test suite', () => {
    before((done) => {
      global.SPIDS = {}
      connection1 = new sql.ConnectionPool(config(), () => {
        connection2 = new sql.ConnectionPool(config(), () => sql.connect(config(), done))
      })
    })

    it('connection 1', done => TESTS['connection 1'](done, connection1))
    it('connection 2', done => TESTS['connection 2'](done, connection2))
    it('global connection', done => TESTS['global connection'](done))

    after((done) => {
      connection1.close()
      connection2.close()
      sql.close(done)
    })
  })

  describe('connection errors', function () {
    it('login failed', done => TESTS['login failed'](done, /Login failed for user '(.*)'/))
    it('timeout', done => TESTS['timeout'](done, /Failed to connect to 10.0.0.1:1433 in 1000ms/))
    it('network error', done => TESTS['network error'](done, /Failed to connect to \.\.\.:1433 - getaddrinfo ENOTFOUND/))
  })

  describe('connection pooling', () => {
    before(done => {
      connection1 = new sql.ConnectionPool(config(), () => {
        let cfg = config()
        cfg.pool = {max: 1}
        connection2 = new sql.ConnectionPool(cfg, done)
      })
    })

    it('max 10', done => TESTS['max 10'](done, connection1))
    it('max 1', done => TESTS['max 1'](done, connection2))
    it('interruption', done => TESTS['interruption'](done, connection1, connection2))

    after(() => {
      connection1.close()
      connection2.close()
    })
  })

  describe.skip('Stress', () => {
    it('concurrent connections', done => TESTS['concurrent connections'](done))
    it('concurrent requests', done => TESTS['concurrent requests'](done))

    it('streaming off', (done) => {
      this.timeout(600000)

      TESTS['streaming off'](done, 'tedious')
    })

    it('streaming on', (done) => {
      this.timeout(600000)

      TESTS['streaming on'](done, 'tedious')
    })
  })

  describe('tvp', function () {
    before((done) => {
      sql.connect(config(), done)
    })

    it('new Table', done => TESTS['new Table'](done))
    it('Recordset.toTable()', done => TESTS['Recordset.toTable()'](done))

    class MSSQLTestType extends sql.Table {
      constructor () {
        super('dbo.MSSQLTestType')

        this.columns.add('a', sql.VarChar(50))
        this.columns.add('b', sql.Int)
      }
    }

    it.skip('query (todo)', function (done) {
      let tvp = new MSSQLTestType()
      tvp.rows.add('asdf', 15)

      let r = new sql.Request()
      r.input('tvp', tvp)
      r.verbose = true
      r.query('select * from @tvp', function (err, result) {
        if (err) return done(err)

        assert.equal(result.recordsets[0].length, 1)
        assert.equal(result.recordsets[0][0].a, 'asdf')
        assert.equal(result.recordsets[0][0].b, 15)

        return done()
      })
    })

    it.skip('prepared statement (todo)', function (done) {
      let tvp = new MSSQLTestType()
      tvp.rows.add('asdf', 15)

      let ps = new sql.PreparedStatement()
      ps.input('tvp', sql.TVP('MSSQLTestType'))
      ps.prepare('select * from @tvp', function (err) {
        if (err) { return done(err) }

        ps.execute({tvp}, function (err, result) {
          if (err) { return done(err) }

          assert.equal(result.recordsets[0].length, 1)
          assert.equal(result.recordsets[0][0].a, 'asdf')
          assert.equal(result.recordsets[0][0].b, 15)

          ps.unprepare(done)
        })
      })
    })

    after(() => sql.close())
  })

  after(done =>
    sql.connect(config(), function (err) {
      if (err) return done(err)

      let req = new sql.Request()
      req.query(require('fs').readFileSync(`${__dirname}/../cleanup.sql`, 'utf8'), function (err) {
        if (err) return done(err)

        sql.close(done)
      })
    })
  )
})

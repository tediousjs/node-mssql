'use strict'

/* globals describe, it, before, after, afterEach */

const sql = require('../../tedious.js')
const assert = require('node:assert')
const { join } = require('node:path')

const TESTS = require('../common/tests.js')(sql, 'tedious')
const TIMES = require('../common/times.js')(sql, 'tedious')
const TEMPLATE_STRING = require('../common/templatestring.js')(sql, 'tedious')
const versionHelper = require('../common/versionhelper')

if (parseInt(process.version.match(/^v(\d+)\./)[1]) > 0) {
  require('../common/templatestring.js')
}

const config = function () {
  const cfg = JSON.parse(require('node:fs').readFileSync(join(__dirname, '../.mssql.json')))
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
      req.query(require('node:fs').readFileSync(join(__dirname, '../cleanup.sql'), 'utf8'), err => {
        if (err) return done(err)

        req = new sql.Request()
        req.query(require('node:fs').readFileSync(join(__dirname, '../prepare.sql'), 'utf8'), err => {
          if (err) return done(err)

          sql.close(done)
        })
      })
    })
  )
  afterEach(() => sql.valueHandler.clear())

  describe('basic test suite', () => {
    before((done) => {
      const cfg = config()
      cfg.options.abortTransactionOnError = true
      sql.connect(cfg, done)
    })

    it('config validation', done => TESTS['config validation'](done))
    it('value handler', done => TESTS['value handler'](done))
    it('bigint inputs', done => TESTS['bigint inputs'](done))
    it('stored procedure (exec)', done => TESTS['stored procedure']('execute', done))
    it('stored procedure (batch)', done => TESTS['stored procedure']('batch', done))
    it('user defined types', done => TESTS['user defined types'](done))
    it('binary data', done => TESTS['binary data'](done))
    it('variant data (not yet published)', done => TESTS['variant data'](done))
    it('stored procedure with one empty recordset', done => TESTS['stored procedure with one empty recordset'](done))
    it('stored procedure with duplicate output column names', done => TESTS['stored procedure with duplicate output column names'](done))
    it('stored procedure with input/output column', done => TESTS['stored procedure with input/output column'](done))
    it('empty query', done => TESTS['empty query'](done))
    it('query with no recordset', done => TESTS['query with no recordset'](done))
    it('query with one recordset', done => TESTS['query with one recordset'](done))
    it('query with multiple recordsets', done => TESTS['query with multiple recordsets'](done))
    it('query with input parameters', done => TESTS['query with input parameters']('query', done))
    it('query with input parameters (batch)', done => TESTS['query with input parameters']('batch', done))
    it('query with output parameters', done => TESTS['query with output parameters']('query', done))
    it('query with output parameters (batch)', done => TESTS['query with output parameters']('batch', done))
    it('query with duplicate parameters throws', done => TESTS['query with duplicate parameters throws'](done))
    it('query parameters can be replaced', done => TESTS['query parameters can be replaced'](done))
    it('query with error', done => TESTS['query with error'](done))
    it('query with multiple errors', done => TESTS['query with multiple errors'](done))
    it('query with raiseerror', done => TESTS['query with raiseerror'](done))
    it('query with toReadableStream', done => TESTS['query with toReadableStream'](done))
    it('query with pipe', done => TESTS['query with pipe'](done))
    it('query with pipe and back pressure', (done) => TESTS['query with pipe and back pressure'](done))
    it('query with duplicate output column names', done => TESTS['query with duplicate output column names'](done))
    it('batch', done => TESTS.batch(done))
    it('create procedure batch', done => TESTS['create procedure batch'](done))
    it('prepared statement', done => TESTS['prepared statement'](done))
    it('prepared statement that fails to prepare throws', done => TESTS['prepared statement that fails to prepare throws'](done))
    it('prepared statement with duplicate parameters throws', done => TESTS['prepared statement with duplicate parameters throws'](done))
    it('prepared statement parameters can be replaced', done => TESTS['prepared statement parameters can be replaced'](done))
    it('prepared statement with affected rows', done => TESTS['prepared statement with affected rows'](done))
    it('prepared statement in transaction', done => TESTS['prepared statement in transaction'](done))
    it('prepared statement with duplicate output column names', done => TESTS['prepared statement with duplicate output column names'](done))
    it('transaction with rollback', done => TESTS['transaction with rollback'](done))
    it('transaction with commit', done => TESTS['transaction with commit'](done))
    it('transaction throws on bad isolation level', done => TESTS['transaction throws on bad isolation level'](done))
    it('transaction accepts good isolation levels', done => TESTS['transaction accepts good isolation levels'](done))
    it('transaction uses default isolation level', done => TESTS['transaction uses default isolation level'](done))
    it('transaction with error (XACT_ABORT set to ON)', done => TESTS['transaction with error'](done))
    it('transaction with synchronous error', done => TESTS['transaction with synchronous error'](done))
    it('cancel request', done => TESTS['cancel request'](done, /Canceled./))
    it('allows repeat calls to connect', done => TESTS['repeat calls to connect resolve'](config(), done))
    it('calls to close during connection throw', done => TESTS['calls to close during connection throw'](config(), done))
    it('connection healthy works', done => TESTS['connection healthy works'](config(), done))
    it('healthy connection goes bad', done => TESTS['healthy connection goes bad'](config(), done))
    it('request timeout', done => TESTS['request timeout'](done, 'tedious', /Timeout: Request failed to complete in 1000ms/))
    it('dataLength type correction', done => TESTS['dataLength type correction'](done))
    it('type validation', done => TESTS['type validation']('query', done))
    it('type validation (batch)', done => TESTS['type validation']('batch', done))
    it('chunked xml support', done => TESTS['chunked xml support'](done))

    after(done => sql.close(done))
  })

  describe('global connection', () => {
    it('repeat calls to connect resolve in order', done => TESTS['repeat calls to connect resolve in order'](sql.connect.bind(sql, config()), done))
    afterEach(done => sql.close(done))
  })

  describe('json support (requires SQL Server 2016 or newer)', () => {
    before(function (done) {
      const cfg = config()
      cfg.parseJSON = true
      sql.connect(cfg)
        .then(() => versionHelper.isSQLServer2016OrNewer(sql)).then(isSQLServer2016OrNewer => {
          if (!isSQLServer2016OrNewer) {
            this.skip()
          }
          done()
        }).catch(done)
    })

    it('parser', done => TESTS['json parser'](done))
    it('empty json', done => TESTS['empty json'](done))
    it('chunked json support', done => TESTS['chunked json support'](done))

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
    it('bulk load with varchar-max field (table)', done => TESTS['bulk load with varchar-max field']('bulk_table2', done))
    it('bulk load (temporary table)', done => TESTS['bulk load']('#anohter_bulk_table', done))
    it('bulk converts dates', done => TESTS['bulk converts dates'](done))
    it('bulk insert with length option as undefined throws (table)', done => TESTS['bulk insert with length option as undefined throws']('bulk_table3', done))
    it('bulk insert with length option as string other than max throws (table)', done => TESTS['bulk insert with length option as string other than max throws']('bulk_table4', done))
    it('bulk insert with length as max (table)', done => TESTS['bulk insert with length as max']('bulk_table5', done))
    after(done => sql.close(done))
  })

  describe('dates and times (local)', () => {
    before(function (done) {
      const cfg = config()
      cfg.options.useUTC = false
      sql.connect(cfg, done)
    })

    it('time', done => TIMES.time(false, done))
    it('time as parameter', done => TIMES['time as parameter'](false, done))
    it('date', done => TIMES.date(false, done))
    it('date as parameter', done => TIMES['date as parameter'](false, done))
    it('datetime', done => TIMES.datetime(false, done))
    it('datetime as parameter', done => TIMES['datetime as parameter'](false, done))
    it('datetime2', done => TIMES.datetime2(false, done))
    it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](false, done))
    it('datetimeoffset', done => TIMES.datetimeoffset(false, done))
    it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](false, done))
    it('smalldatetime', done => TIMES.smalldatetime(false, done))
    it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](false, done))

    return after(done => sql.close(done))
  })

  describe('dates and times (utc)', () => {
    before(function (done) {
      const cfg = config()
      cfg.options.useUTC = true
      sql.connect(cfg, done)
    })

    it('time', done => TIMES.time(true, done))
    it('time as parameter', done => TIMES['time as parameter'](true, done))
    it('date', done => TIMES.date(true, done))
    it('date as parameter', done => TIMES['date as parameter'](true, done))
    it('datetime', done => TIMES.datetime(true, done))
    it('datetime as parameter', done => TIMES['datetime as parameter'](true, done))
    it('datetime2', done => TIMES.datetime2(true, done))
    it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](true, done))
    it('datetimeoffset', done => TIMES.datetimeoffset(true, done))
    it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](true, done))
    it('smalldatetime', done => TIMES.smalldatetime(true, done))
    it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](true, done))

    after(done => sql.close(done))
  })

  describe('template strings', () => {
    before((done) => {
      sql.connect(config(), done)
    })

    it('query', done => TEMPLATE_STRING.query(done))
    it('batch', done => TEMPLATE_STRING.batch(done))
    it('array params', done => TEMPLATE_STRING['array params'](done))

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
    // call(this) to enable the test to skip itself.
    it('timeout', function (done) { TESTS.timeout.call(this, done, /Failed to connect to 10.0.0.1:1433 in 1000ms/) })
    it('network error', done => TESTS['network error'](done, /Failed to connect to \.\.\.:1433 - getaddrinfo ENOTFOUND/))
  })

  describe('connection pooling', () => {
    before(done => {
      connection1 = new sql.ConnectionPool(config(), () => {
        const cfg = config()
        cfg.pool = { max: 1 }
        connection2 = new sql.ConnectionPool(cfg, done)
      })
    })

    it('max 10', done => TESTS['max 10'](done, connection1))
    it('max 1', done => TESTS['max 1'](done, connection2))
    it('interruption', done => TESTS.interruption(done, connection1, connection2))

    after(() => {
      connection1.close()
      connection2.close()
    })
  })

  describe('Stress', function stress () {
    before((done) => {
      const cfg = config()
      cfg.options.abortTransactionOnError = true
      // cfg.requestTimeout = 60000
      sql.connect(cfg, done)
    })

    it.skip('concurrent connections', done => TESTS['concurrent connections'](done))
    it.skip('concurrent requests', done => TESTS['concurrent requests'](done))
    it('streaming off', done => TESTS['streaming off'](done))
    it('streaming on', done => TESTS['streaming on'](done))
    it('streaming pause', done => TESTS['streaming pause'](done))
    it('streaming resume', done => TESTS['streaming resume'](done))
    it('streaming rowsaffected', done => TESTS['streaming rowsaffected'](done))
    it('streaming rowsaffected in stored procedure', done => TESTS['streaming rowsaffected in stored procedure'](done))
    it('streaming trailing rows', done => TESTS['streaming trailing rows'](done))
    it('streaming with duplicate output column names', done => TESTS['streaming with duplicate output column names'](done))
    it('a cancelled stream emits done event', done => TESTS['a cancelled stream emits done event'](done))
    it('a cancelled paused stream emits done event', done => TESTS['a cancelled paused stream emits done event'](done))

    after(done => sql.close(done))
  })

  describe('tvp', function () {
    before((done) => {
      sql.connect(config(), done)
    })

    it('new Table', done => TESTS['new Table'](done))
    it('Recordset.toTable()', done => TESTS['Recordset.toTable()'](done))
    it('Recordset.toTable() from existing', done => TESTS['Recordset.toTable() from existing'](done))

    class MSSQLTestType extends sql.Table {
      constructor () {
        super('dbo.MSSQLTestType')

        this.columns.add('a', sql.VarChar(50))
        this.columns.add('b', sql.Int)
      }
    }

    it.skip('query (todo)', function (done) {
      const tvp = new MSSQLTestType()
      tvp.rows.add('asdf', 15)

      const r = new sql.Request()
      r.input('tvp', tvp)
      r.verbose = true
      r.query('select * from @tvp', function (err, result) {
        if (err) return done(err)

        assert.strictEqual(result.recordsets[0].length, 1)
        assert.strictEqual(result.recordsets[0][0].a, 'asdf')
        assert.strictEqual(result.recordsets[0][0].b, 15)

        return done()
      })
    })

    it.skip('prepared statement (todo)', function (done) {
      const tvp = new MSSQLTestType()
      tvp.rows.add('asdf', 15)

      const ps = new sql.PreparedStatement()
      ps.input('tvp', sql.TVP('MSSQLTestType'))
      ps.prepare('select * from @tvp', function (err) {
        if (err) { return done(err) }

        ps.execute({ tvp }, function (err, result) {
          if (err) { return done(err) }

          assert.strictEqual(result.recordsets[0].length, 1)
          assert.strictEqual(result.recordsets[0][0].a, 'asdf')
          assert.strictEqual(result.recordsets[0][0].b, 15)

          ps.unprepare(done)
        })
      })
    })

    after(() => sql.close())
  })

  after(done =>
    sql.connect(config(), function (err) {
      if (err) return done(err)

      const req = new sql.Request()
      req.query(require('node:fs').readFileSync(join(__dirname, '../cleanup.sql'), 'utf8'), function (err) {
        if (err) return done(err)

        sql.close(done)
      })
    })
  )
})

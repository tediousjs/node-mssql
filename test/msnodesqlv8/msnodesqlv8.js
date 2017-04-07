'use strict'

/* globals describe, it, before, after */

const sql = require('../../msnodesqlv8')

const TESTS = require('../common/tests.js')(sql, 'msnodesqlv8')
const TIMES = require('../common/times.js')(sql, 'msnodesqlv8')

const config = function () {
  let cfg = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`))
  cfg.driver = 'msnodesqlv8'
  return cfg
}

let connection1 = null
let connection2 = null

describe('msnodesqlv8', function () {
  before(done =>
    sql.connect(config(), function (err) {
      if (err) return done(err)

      let req = new sql.Request()
      req.batch(require('fs').readFileSync(`${__dirname}/../cleanup.sql`, 'utf8'), function (err) {
        if (err) return done(err)

        req = new sql.Request()
        req.batch(require('fs').readFileSync(`${__dirname}/../prepare.sql`, 'utf8'), function (err) {
          if (err) return done(err)

          sql.close(done)
        })
      })
    })
  )

  describe('basic test suite', function () {
    before(function (done) {
      let cfg = config()
      cfg.parseJSON = true
      sql.connect(cfg, done)
    })

    it('stored procedure (exec)', done => TESTS['stored procedure']('execute', done))
    it('stored procedure (batch)', done => TESTS['stored procedure']('batch', done))
    it('user defined types', done => TESTS['user defined types'](done))
    it.skip('binary data (buggy in msnodesqlv8)', done => TESTS['binary data'](done))
    it.skip('variant data (not supported by msnodesqlv8)', done => TESTS['variant data'](done))
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
    it.skip('query with multiple errors (not supported by msnodesqlv8)', done => TESTS['query with multiple errors'](done))
    it.skip('query with raiseerror (not supported by msnodesqlv8)', done => TESTS['query with raiseerror'](done))
    it('query with pipe', done => TESTS['query with pipe'](done))
    it('batch', done => TESTS['batch'](done))
    it('batch (stream)', done => TESTS['batch'](done, true))
    it('create procedure batch', done => TESTS['create procedure batch'](done))
    it('prepared statement', done => TESTS['prepared statement'](done))
    it('prepared statement with affected rows', done => TESTS['prepared statement with affected rows'](done))
    it('prepared statement in transaction', done => TESTS['prepared statement in transaction'](done))
    it('transaction with rollback', done => TESTS['transaction with rollback'](done))
    it('transaction with commit', done => TESTS['transaction with commit'](done))
    it.skip('cancel request (not supported by msnodesqlv8)', done => TESTS['cancel request'](done))
    it.skip('request timeout (not supported by msnodesqlv8)', done => TESTS['request timeout'](done))
    it('dataLength type correction', done => TESTS['dataLength type correction'](done))
    it.skip('chunked json support (requires SQL Server 2016)', done => TESTS['chunked json support'](done))
    it('chunked xml support', done => TESTS['chunked xml support'](done))

    after(() => sql.close())
  })

  describe.skip('json support (requires SQL Server 2016)', function () {
    before(function (done) {
      let cfg = config()
      cfg.parseJSON = true
      sql.connect(cfg, done)
    })

    it('parser', done => TESTS['json parser'](done))

    after(done => sql.close(done))
  })

  describe('bulk load', function () {
    before(function (done) {
      sql.connect(config(), function (err) {
        if (err) return done(err)

        let req = new sql.Request()
        req.query('delete from bulk_table', done)
      })
    })

    it('bulk load (table)', done => TESTS['bulk load']('bulk_table', done))
    it.skip('bulk load (temporary table) (not supported by msnodesqlv8)', done => TESTS['bulk load']('#anohter_bulk_table', done))

    after(done => sql.close(done))
  })

  describe('msnodesqlv8 dates and times', function () {
    before(function (done) {
      sql.connect(config(), done)
    })

    it('time', done => TIMES['time'](true, done))
    it('time as parameter', done => TIMES['time as parameter'](true, done))
    it('date', done => TIMES['date'](true, done))
    it('date as parameter', done => TIMES['date as parameter'](true, done))
    it('datetime', done => TIMES['datetime'](true, done))
    it('datetime as parameter', done => TIMES['datetime as parameter'](true, done))
    it('datetime2', done => TIMES['datetime2'](true, done))
    it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](true, done))
    it('datetimeoffset', done => TIMES['datetimeoffset'](true, done))// https://github.com/WindowsAzure/node-sqlserver/issues/160
    it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](true, done)) // https://github.com/WindowsAzure/node-sqlserver/issues/160
    it('smalldatetime', done => TIMES['smalldatetime'](true, done))
    it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](true, done))

    after(() => sql.close())
  })

  describe('msnodesqlv8 multiple connections test suite', function () {
    before(function (done) {
      global.SPIDS = {}
      connection1 = new sql.ConnectionPool(config(), () => {
        connection2 = new sql.ConnectionPool(config(), () => sql.connect(config(), done))
      })
    })

    it('connection 1', done => TESTS['connection 1'](done, connection1))
    it('connection 2', done => TESTS['connection 2'](done, connection2))
    it('global connection', done => TESTS['global connection'](done))

    after(function () {
      connection1.close()
      connection2.close()
      sql.close()
    })
  })

  describe('msnodesqlv8 connection errors', function () {
    it('login failed', done => TESTS['login failed'](done, /Login failed for user '(.*)'\./))
    it.skip('timeout (not supported by msnodesqlv8)', done => TESTS['timeout'](done))
    it.skip('network error (not supported by msnodesqlv8)', done => TESTS['network error'](done))
  })

  describe('msnodesqlv8 connection pooling', function () {
    before(done => {
      connection1 = new sql.ConnectionPool(config(), function () {
        let cfg = config()
        cfg.pool = {max: 1}
        connection2 = new sql.ConnectionPool(cfg, done)
      })
    })

    it('max 10', done => TESTS['max 10'](done, connection1))
    it('max 1', done => TESTS['max 1'](done, connection2))
    it.skip('interruption (not supported by msnodesqlv8)', done => TESTS['interruption'](done, connection1, connection2))

    after(function () {
      connection1.close()
      connection2.close()
    })
  })

  describe('msnodesqlv8 stress', function () {
    it.skip('concurrent connections', done => TESTS['concurrent connections'](done))
    it.skip('concurrent requests', done => TESTS['concurrent requests'](done))
    it.skip('streaming off', done => TESTS['streaming off'](done, 'msnodesqlv8'))
    it.skip('streaming on', done => TESTS['streaming on'](done, 'msnodesqlv8'))
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

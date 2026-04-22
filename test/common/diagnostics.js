'use strict'

/* globals describe, it */

const assert = require('node:assert')
const dc = require('node:diagnostics_channel')
const { CHANNELS, tracingChannels, tracePromise, publish } = require('../../lib/diagnostics')

describe('Diagnostics Channel', () => {
  describe('CHANNELS', () => {
    it('exports all TracingChannel names', () => {
      assert.strictEqual(CHANNELS.TRACE_QUERY, 'mssql:query')
      assert.strictEqual(CHANNELS.TRACE_BATCH, 'mssql:batch')
      assert.strictEqual(CHANNELS.TRACE_EXECUTE, 'mssql:execute')
      assert.strictEqual(CHANNELS.TRACE_BULK, 'mssql:bulk')
      assert.strictEqual(CHANNELS.TRACE_CONNECT, 'mssql:connect')
      assert.strictEqual(CHANNELS.TRACE_POOL_ACQUIRE, 'mssql:pool:acquire')
      assert.strictEqual(CHANNELS.TRACE_PREPARED_STATEMENT_PREPARE, 'mssql:prepared-statement:prepare')
      assert.strictEqual(CHANNELS.TRACE_PREPARED_STATEMENT_EXECUTE, 'mssql:prepared-statement:execute')
    })

    it('exports all point-event channel names', () => {
      assert.strictEqual(CHANNELS.CONNECTION_ACQUIRE, 'mssql:connection:acquire')
      assert.strictEqual(CHANNELS.CONNECTION_RELEASE, 'mssql:connection:release')
      assert.strictEqual(CHANNELS.CONNECTION_CREATE, 'mssql:connection:create')
      assert.strictEqual(CHANNELS.CONNECTION_DESTROY, 'mssql:connection:destroy')
      assert.strictEqual(CHANNELS.POOL_CLOSE, 'mssql:pool:close')
      assert.strictEqual(CHANNELS.TRANSACTION_BEGIN, 'mssql:transaction:begin')
      assert.strictEqual(CHANNELS.TRANSACTION_COMMIT, 'mssql:transaction:commit')
      assert.strictEqual(CHANNELS.TRANSACTION_ROLLBACK, 'mssql:transaction:rollback')
      assert.strictEqual(CHANNELS.REQUEST_CANCEL, 'mssql:request:cancel')
      assert.strictEqual(CHANNELS.PREPARED_STATEMENT_UNPREPARE, 'mssql:prepared-statement:unprepare')
    })

    it('is frozen', () => {
      assert.ok(Object.isFrozen(CHANNELS))
    })

    it('has 18 total channels', () => {
      assert.strictEqual(Object.keys(CHANNELS).length, 18)
    })
  })

  describe('tracingChannels', () => {
    it('creates TracingChannel instances for all TRACE_ channels', () => {
      const traceKeys = Object.keys(CHANNELS).filter(k => k.startsWith('TRACE_'))
      assert.strictEqual(traceKeys.length, 8)
      for (const key of traceKeys) {
        const name = CHANNELS[key]
        const tc = tracingChannels[name]
        assert.ok(tc, `TracingChannel for ${name} should exist`)
        // Aggregate hasSubscribers is Node 22+. Sub-channels exist on all
        // supported versions and are what the helpers fall back to.
        assert.strictEqual(typeof tc.start.hasSubscribers, 'boolean', `${name}.start should expose hasSubscribers`)
      }
    })
  })

  describe('tracePromise()', () => {
    it('calls fn directly when no subscribers', async () => {
      let called = false
      const result = await tracePromise(CHANNELS.TRACE_QUERY, () => {
        called = true
        return Promise.resolve(42)
      }, () => ({ command: 'SELECT 1' }))
      assert.ok(called)
      assert.strictEqual(result, 42)
    })

    it('does not allocate context when no subscribers', async () => {
      let factoryCalled = false
      await tracePromise(CHANNELS.TRACE_QUERY, () => Promise.resolve(), () => {
        factoryCalled = true
        return {}
      })
      assert.ok(!factoryCalled, 'context factory should not be called when no subscribers')
    })

    it('traces through TracingChannel when subscribers exist', async () => {
      const events = []
      const tc = dc.tracingChannel(CHANNELS.TRACE_QUERY)
      const handlers = {
        start (ctx) { events.push({ event: 'start', command: ctx.command }) },
        end (ctx) { events.push({ event: 'end' }) },
        asyncStart (ctx) { events.push({ event: 'asyncStart' }) },
        asyncEnd (ctx) { events.push({ event: 'asyncEnd' }) },
        error (ctx) { events.push({ event: 'error' }) }
      }
      tc.subscribe(handlers)
      try {
        const result = await tracePromise(CHANNELS.TRACE_QUERY, () => {
          return Promise.resolve('data')
        }, () => ({ command: 'SELECT 1' }))
        assert.strictEqual(result, 'data')
        assert.ok(events.some(e => e.event === 'start' && e.command === 'SELECT 1'))
        assert.ok(events.some(e => e.event === 'asyncEnd'))
      } finally {
        tc.unsubscribe(handlers)
      }
    })

    it('reports errors through TracingChannel error event', async () => {
      const events = []
      const tc = dc.tracingChannel(CHANNELS.TRACE_BATCH)
      const handlers = {
        start () { events.push('start') },
        end () { events.push('end') },
        asyncStart () { events.push('asyncStart') },
        asyncEnd () { events.push('asyncEnd') },
        error (ctx) { events.push({ event: 'error', message: ctx.error.message }) }
      }
      tc.subscribe(handlers)
      try {
        await assert.rejects(
          () => tracePromise(CHANNELS.TRACE_BATCH, () => {
            return Promise.reject(new Error('test error'))
          }, () => ({ command: 'BAD SQL' })),
          { message: 'test error' }
        )
        assert.ok(events.some(e => e.event === 'error' && e.message === 'test error'))
      } finally {
        tc.unsubscribe(handlers)
      }
    })

    it('accepts a factory function for context', async () => {
      let factoryCalled = false
      const tc = dc.tracingChannel(CHANNELS.TRACE_EXECUTE)
      const handlers = {
        start (ctx) { assert.strictEqual(ctx.procedure, 'sp_test') },
        end () {},
        asyncStart () {},
        asyncEnd () {},
        error () {}
      }
      tc.subscribe(handlers)
      try {
        await tracePromise(CHANNELS.TRACE_EXECUTE, () => Promise.resolve(), () => {
          factoryCalled = true
          return { procedure: 'sp_test' }
        })
        assert.ok(factoryCalled, 'context factory should be called when subscribers exist')
      } finally {
        tc.unsubscribe(handlers)
      }
    })
  })

  describe('publish()', () => {
    it('does nothing when no subscribers', () => {
      let factoryCalled = false
      publish(CHANNELS.POOL_CLOSE, () => {
        factoryCalled = true
        return { poolId: 1 }
      })
      assert.ok(!factoryCalled, 'factory should not be called when no subscribers')
    })

    it('publishes message when subscribers exist', () => {
      const messages = []
      const handler = (msg) => { messages.push(msg) }
      dc.subscribe(CHANNELS.TRANSACTION_BEGIN, handler)
      try {
        publish(CHANNELS.TRANSACTION_BEGIN, () => ({
          transactionId: 42,
          isolationLevel: 0x02,
          isolationLevelName: 'READ_COMMITTED',
          poolId: 1
        }))
        assert.strictEqual(messages.length, 1)
        assert.strictEqual(messages[0].transactionId, 42)
        assert.strictEqual(messages[0].isolationLevel, 0x02)
        assert.strictEqual(messages[0].isolationLevelName, 'READ_COMMITTED')
      } finally {
        dc.unsubscribe(CHANNELS.TRANSACTION_BEGIN, handler)
      }
    })
  })

  describe('CHANNELS is exported from main module', () => {
    it('is accessible via require("mssql")', () => {
      const sql = require('../../')
      assert.ok(sql.CHANNELS)
      assert.strictEqual(sql.CHANNELS.TRACE_QUERY, 'mssql:query')
    })
  })

  describe('Request._internal flag', () => {
    it('is false by default', () => {
      const sql = require('../../')
      const req = new sql.Request()
      assert.strictEqual(req._internal, false)
    })
  })

  // Integration tests: drive the real Request / Transaction / ConnectionPool
  // classes (with stubbed drivers) to verify the diagnostics_channel
  // instrumentation fires end-to-end — not just that the helpers work.
  describe('Instrumentation integration', () => {
    const sql = require('../../')

    function collect (channel) {
      const events = []
      const handler = (msg) => events.push(msg)
      dc.subscribe(channel, handler)
      return {
        events,
        stop () { dc.unsubscribe(channel, handler) }
      }
    }

    function collectTraces (tracingChannel) {
      const events = []
      const handlers = {
        start: (ctx) => events.push({ event: 'start', ctx }),
        end: (ctx) => events.push({ event: 'end', ctx }),
        asyncStart: (ctx) => events.push({ event: 'asyncStart', ctx }),
        asyncEnd: (ctx) => events.push({ event: 'asyncEnd', ctx }),
        error: (ctx) => events.push({ event: 'error', ctx })
      }
      tracingChannel.subscribe(handlers)
      return {
        events,
        stop () { tracingChannel.unsubscribe(handlers) }
      }
    }

    it('request.query() emits TRACE_QUERY start/asyncEnd with context', async () => {
      const req = new sql.Request()
      req._query = (cmd, cb) => setImmediate(cb, null, [[{ x: 1 }]], {}, 1)
      req.input('id', sql.Int, 42)

      const tc = tracingChannels[CHANNELS.TRACE_QUERY]
      const { events, stop } = collectTraces(tc)
      try {
        await req.query('SELECT @id')
        const starts = events.filter(e => e.event === 'start')
        const asyncEnds = events.filter(e => e.event === 'asyncEnd')
        assert.strictEqual(starts.length, 1)
        assert.strictEqual(asyncEnds.length, 1)
        assert.strictEqual(starts[0].ctx.command, 'SELECT @id')
        assert.deepStrictEqual(starts[0].ctx.parameters, ['id'])
        assert.strictEqual(typeof starts[0].ctx.requestId, 'number')
      } finally {
        stop()
      }
    })

    it('request.query() emits TRACE_QUERY error on rejection', async () => {
      const req = new sql.Request()
      const boom = new Error('boom')
      req._query = (cmd, cb) => setImmediate(cb, boom)

      const tc = tracingChannels[CHANNELS.TRACE_QUERY]
      const { events, stop } = collectTraces(tc)
      try {
        await assert.rejects(() => req.query('SELECT 1'), { message: 'boom' })
        const errors = events.filter(e => e.event === 'error')
        assert.strictEqual(errors.length, 1)
        assert.strictEqual(errors[0].ctx.error, boom)
      } finally {
        stop()
      }
    })

    it('request marked as _internal does not emit TRACE_QUERY', async () => {
      const req = new sql.Request()
      req._internal = true
      req._query = (cmd, cb) => setImmediate(cb, null, [[]], {}, 0)

      const tc = tracingChannels[CHANNELS.TRACE_QUERY]
      const { events, stop } = collectTraces(tc)
      try {
        await req.query('SELECT 1')
        assert.strictEqual(events.length, 0)
      } finally {
        stop()
      }
    })

    it('request.execute() emits TRACE_EXECUTE with procedure name', async () => {
      const req = new sql.Request()
      req._execute = (cmd, cb) => setImmediate(cb, null, [[]], {}, 0, 0)

      const tc = tracingChannels[CHANNELS.TRACE_EXECUTE]
      const { events, stop } = collectTraces(tc)
      try {
        await req.execute('sp_test')
        const starts = events.filter(e => e.event === 'start')
        assert.strictEqual(starts.length, 1)
        assert.strictEqual(starts[0].ctx.procedure, 'sp_test')
      } finally {
        stop()
      }
    })

    it('request.cancel() emits REQUEST_CANCEL for user requests only', () => {
      const { events, stop } = collect(CHANNELS.REQUEST_CANCEL)
      try {
        const userReq = new sql.Request()
        userReq._cancel = () => {}
        userReq.cancel()
        assert.strictEqual(events.length, 1)
        assert.strictEqual(typeof events[0].requestId, 'number')

        const internalReq = new sql.Request()
        internalReq._internal = true
        internalReq._cancel = () => {}
        internalReq.cancel()
        assert.strictEqual(events.length, 1, 'internal cancel should not emit')
      } finally {
        stop()
      }
    })

    // Stub for Transaction._begin that mirrors what the real driver does:
    // assigns the requested isolation level and clears the aborted flag.
    function stubTransaction (tx) {
      tx._begin = function (level, cb) {
        if (level) this.isolationLevel = level
        this._aborted = false
        setImmediate(cb, null)
      }
      tx._commit = (cb) => setImmediate(cb, null)
      tx._rollback = (cb) => setImmediate(cb, null)
    }

    it('transaction.begin emits TRANSACTION_BEGIN with numeric + named isolation level', async () => {
      const tx = new sql.Transaction()
      stubTransaction(tx)

      const { events, stop } = collect(CHANNELS.TRANSACTION_BEGIN)
      try {
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
        assert.strictEqual(events.length, 1)
        assert.strictEqual(events[0].isolationLevel, sql.ISOLATION_LEVEL.SERIALIZABLE)
        assert.strictEqual(events[0].isolationLevelName, 'SERIALIZABLE')
        assert.strictEqual(typeof events[0].transactionId, 'number')
      } finally {
        stop()
      }
    })

    it('transaction.commit emits TRANSACTION_COMMIT', async () => {
      const tx = new sql.Transaction()
      stubTransaction(tx)

      await tx.begin()
      const { events, stop } = collect(CHANNELS.TRANSACTION_COMMIT)
      try {
        await tx.commit()
        assert.strictEqual(events.length, 1)
        assert.strictEqual(typeof events[0].transactionId, 'number')
      } finally {
        stop()
      }
    })

    it('transaction.rollback emits TRANSACTION_ROLLBACK with aborted flag', async () => {
      const tx = new sql.Transaction()
      stubTransaction(tx)

      await tx.begin()
      const { events, stop } = collect(CHANNELS.TRANSACTION_ROLLBACK)
      try {
        await tx.rollback()
        assert.strictEqual(events.length, 1)
        assert.strictEqual(events[0].aborted, false)
      } finally {
        stop()
      }
    })
  })

  // Exercise the callback API through TracingChannel#traceCallback, which
  // shares the sub-event channels (start/asyncEnd/error/...) with
  // tracePromise — subscribers should not need to branch by API style.
  describe('Callback API tracing', () => {
    const sql = require('../../')

    function collectTraces (tracingChannel) {
      const events = []
      const handlers = {
        start: (ctx) => events.push({ event: 'start', ctx }),
        end: (ctx) => events.push({ event: 'end', ctx }),
        asyncStart: (ctx) => events.push({ event: 'asyncStart', ctx }),
        asyncEnd: (ctx) => events.push({ event: 'asyncEnd', ctx }),
        error: (ctx) => events.push({ event: 'error', ctx })
      }
      tracingChannel.subscribe(handlers)
      return {
        events,
        stop () { tracingChannel.unsubscribe(handlers) }
      }
    }

    it('request.query(cb) emits TRACE_QUERY start/asyncEnd with context', (done) => {
      const req = new sql.Request()
      req._query = (cmd, cb) => setImmediate(cb, null, [[{ x: 1 }]], {}, 1)
      req.input('id', sql.Int, 42)

      const tc = tracingChannels[CHANNELS.TRACE_QUERY]
      const { events, stop } = collectTraces(tc)
      req.query('SELECT @id', (err, result) => {
        assert.ifError(err)
        assert.ok(result)
        // asyncEnd fires after this callback returns, so defer the check.
        setImmediate(() => {
          try {
            const starts = events.filter(e => e.event === 'start')
            const asyncEnds = events.filter(e => e.event === 'asyncEnd')
            assert.strictEqual(starts.length, 1)
            assert.strictEqual(asyncEnds.length, 1)
            assert.strictEqual(starts[0].ctx.command, 'SELECT @id')
            assert.deepStrictEqual(starts[0].ctx.parameters, ['id'])
            done()
          } catch (e) {
            done(e)
          } finally {
            stop()
          }
        })
      })
    })

    it('request.query(cb) emits TRACE_QUERY error on driver failure', (done) => {
      const req = new sql.Request()
      const boom = new Error('boom')
      req._query = (cmd, cb) => setImmediate(cb, boom)

      const tc = tracingChannels[CHANNELS.TRACE_QUERY]
      const { events, stop } = collectTraces(tc)
      req.query('SELECT 1', (err) => {
        try {
          assert.strictEqual(err, boom)
          const errors = events.filter(e => e.event === 'error')
          assert.strictEqual(errors.length, 1)
          assert.strictEqual(errors[0].ctx.error, boom)
          done()
        } catch (e) {
          done(e)
        } finally {
          stop()
        }
      })
    })

    it('callback path honours the _internal flag', (done) => {
      const req = new sql.Request()
      req._internal = true
      req._query = (cmd, cb) => setImmediate(cb, null, [[]], {}, 0)

      const tc = tracingChannels[CHANNELS.TRACE_QUERY]
      const { events, stop } = collectTraces(tc)
      req.query('SELECT 1', () => {
        try {
          assert.strictEqual(events.length, 0)
          done()
        } catch (e) {
          done(e)
        } finally {
          stop()
        }
      })
    })

    it('request.execute(cb) emits TRACE_EXECUTE', (done) => {
      const req = new sql.Request()
      req._execute = (cmd, cb) => setImmediate(cb, null, [[]], {}, 0, 0)

      const tc = tracingChannels[CHANNELS.TRACE_EXECUTE]
      const { events, stop } = collectTraces(tc)
      req.execute('sp_test', () => {
        try {
          const starts = events.filter(e => e.event === 'start')
          assert.strictEqual(starts.length, 1)
          assert.strictEqual(starts[0].ctx.procedure, 'sp_test')
          done()
        } catch (e) {
          done(e)
        } finally {
          stop()
        }
      })
    })
  })
})

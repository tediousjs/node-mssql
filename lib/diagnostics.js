'use strict'

const dc = require('node:diagnostics_channel')

// TracingChannel names
const TRACE_QUERY = 'mssql:query'
const TRACE_BATCH = 'mssql:batch'
const TRACE_EXECUTE = 'mssql:execute'
const TRACE_BULK = 'mssql:bulk'
const TRACE_CONNECT = 'mssql:connect'
const TRACE_POOL_ACQUIRE = 'mssql:pool:acquire'
const TRACE_PREPARE = 'mssql:prepare'
const TRACE_PREPARED_EXECUTE = 'mssql:prepared-execute'

// Point-event channel names
const CONNECTION_ACQUIRE = 'mssql:connection:acquire'
const CONNECTION_RELEASE = 'mssql:connection:release'
const CONNECTION_CREATE = 'mssql:connection:create'
const CONNECTION_DESTROY = 'mssql:connection:destroy'
const POOL_CLOSE = 'mssql:pool:close'
const TRANSACTION_BEGIN = 'mssql:transaction:begin'
const TRANSACTION_COMMIT = 'mssql:transaction:commit'
const TRANSACTION_ROLLBACK = 'mssql:transaction:rollback'
const REQUEST_CANCEL = 'mssql:request:cancel'
const PREPARED_STATEMENT_UNPREPARE = 'mssql:prepared-statement:unprepare'

const CHANNELS = Object.freeze({
  TRACE_QUERY,
  TRACE_BATCH,
  TRACE_EXECUTE,
  TRACE_BULK,
  TRACE_CONNECT,
  TRACE_POOL_ACQUIRE,
  TRACE_PREPARE,
  TRACE_PREPARED_EXECUTE,
  CONNECTION_ACQUIRE,
  CONNECTION_RELEASE,
  CONNECTION_CREATE,
  CONNECTION_DESTROY,
  POOL_CLOSE,
  TRANSACTION_BEGIN,
  TRANSACTION_COMMIT,
  TRANSACTION_ROLLBACK,
  REQUEST_CANCEL,
  PREPARED_STATEMENT_UNPREPARE
})

// Pre-create TracingChannel instances at module load time
const tracingChannels = {
  [TRACE_QUERY]: dc.tracingChannel(TRACE_QUERY),
  [TRACE_BATCH]: dc.tracingChannel(TRACE_BATCH),
  [TRACE_EXECUTE]: dc.tracingChannel(TRACE_EXECUTE),
  [TRACE_BULK]: dc.tracingChannel(TRACE_BULK),
  [TRACE_CONNECT]: dc.tracingChannel(TRACE_CONNECT),
  [TRACE_POOL_ACQUIRE]: dc.tracingChannel(TRACE_POOL_ACQUIRE),
  [TRACE_PREPARE]: dc.tracingChannel(TRACE_PREPARE),
  [TRACE_PREPARED_EXECUTE]: dc.tracingChannel(TRACE_PREPARED_EXECUTE)
}

// Pre-create point-event channel instances at module load time
const pointChannels = {
  [CONNECTION_ACQUIRE]: dc.channel(CONNECTION_ACQUIRE),
  [CONNECTION_RELEASE]: dc.channel(CONNECTION_RELEASE),
  [CONNECTION_CREATE]: dc.channel(CONNECTION_CREATE),
  [CONNECTION_DESTROY]: dc.channel(CONNECTION_DESTROY),
  [POOL_CLOSE]: dc.channel(POOL_CLOSE),
  [TRANSACTION_BEGIN]: dc.channel(TRANSACTION_BEGIN),
  [TRANSACTION_COMMIT]: dc.channel(TRANSACTION_COMMIT),
  [TRANSACTION_ROLLBACK]: dc.channel(TRANSACTION_ROLLBACK),
  [REQUEST_CANCEL]: dc.channel(REQUEST_CANCEL),
  [PREPARED_STATEMENT_UNPREPARE]: dc.channel(PREPARED_STATEMENT_UNPREPARE)
}

/**
 * Trace an async operation using a TracingChannel.
 *
 * When subscribers are active, wraps `fn` with TracingChannel.tracePromise()
 * for promise-returning functions. When no subscribers are active, calls `fn`
 * directly with zero overhead (no context allocation).
 *
 * @param {string} name - TracingChannel name (one of CHANNELS.TRACE_*)
 * @param {Function} fn - The function to trace (must return a Promise)
 * @param {Function|object} context - Context object or factory function returning one
 * @returns {Promise} The return value of fn
 */
function tracePromise (name, fn, context) {
  const channel = tracingChannels[name]
  if (channel.hasSubscribers) {
    const ctx = typeof context === 'function' ? context() : context
    return channel.tracePromise(fn, ctx)
  }
  return fn()
}

/**
 * Trace a callback-based async operation using a TracingChannel.
 *
 * @param {string} name - TracingChannel name (one of CHANNELS.TRACE_*)
 * @param {Function} fn - The callback-receiving function to trace
 * @param {number} position - Zero-indexed argument position of the callback
 * @param {object} context - Context object passed to subscribers
 * @param {*} thisArg - The receiver for the function call
 * @param {...*} args - Arguments to pass to the function
 * @returns {*} The return value of fn
 */
function traceCallback (name, fn, position, context, thisArg, ...args) {
  const channel = tracingChannels[name]
  if (channel.hasSubscribers) {
    return channel.traceCallback(fn, position, context, thisArg, ...args)
  }
  return fn.call(thisArg, ...args)
}

/**
 * Publish a point event on a named channel.
 *
 * Only allocates the message object when subscribers are active.
 *
 * @param {string} name - Point-event channel name (one of CHANNELS.*)
 * @param {Function} factory - Factory function that returns the message object
 */
function publish (name, factory) {
  const channel = pointChannels[name]
  if (channel.hasSubscribers) {
    channel.publish(factory())
  }
}

module.exports = {
  CHANNELS,
  tracingChannels,
  tracePromise,
  traceCallback,
  publish
}

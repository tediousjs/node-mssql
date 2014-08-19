sql = require '../'
assert = require "assert"
config = require('./_connection') 'tds'

connection1 = null
connection2 = null

describe 'node-tds test suite', ->
	before (done) ->
		global.DRIVER = 'tds'
		
		sql.connect config(), (err) ->
			if err then return done err
			
			req = new sql.Request
			req.query 'delete from tran_test', done
	
	beforeEach (done) ->
		global.MODE = 'query'
		done()
	
	it 'stored procedure', (done) ->
		TESTS['stored procedure'] done, false
	
	it 'stored procedure (stream)', (done) ->
		TESTS['stored procedure'] done, false, true
	
	it.skip 'user defined types (not supported by node-tds)', (done) ->
		TESTS['user defined types'] done
	
	it.skip 'binary data (not supported by node-tds)', (done) ->
		TESTS['binary data'] done
	
	it 'stored procedure with one empty recordset', (done) ->
		TESTS['stored procedure with one empty recordset'] done
	
	it 'empty query', (done) ->
		TESTS['empty query'] done
	
	it 'query with no recordset', (done) ->
		TESTS['query with no recordset'] done
	
	it 'query with one recordset', (done) ->
		TESTS['query with one recordset'] done
	
	it 'query with multiple recordsets', (done) ->
		TESTS['query with multiple recordsets'] done, false
	
	it 'query with multiple recordsets (stream)', (done) ->
		TESTS['query with multiple recordsets'] done, false, true
	
	it 'query with input parameters', (done) ->
		TESTS['query with input parameters'] done
	
	# This test generates no error, but request is stucked and console output is: Need 1836409877, length 43
	# There is possible bug with selects that doesn't return any values
	it.skip 'query with output parameters (buggy in node-tds)', (done) ->
		TESTS['query with output parameters'] done
	
	it 'query with error', (done) ->
		TESTS['query with error'] done
	
	it 'query with error (stream)', (done) ->
		TESTS['query with error'] done, true
	
	it 'query with multiple errors', (done) ->
		TESTS['query with multiple errors'] done
	
	it 'query with multiple errors (stream)', (done) ->
		TESTS['query with multiple errors'] done, true
	
	it 'batch', (done) ->
		TESTS['batch'] done
	
	it 'batch (stream)', (done) ->
		TESTS['batch'] done, true
	
	it 'create procedure batch', (done) ->
		TESTS['create procedure batch'] done
	
	it 'prepared statement', (done) ->
		TESTS['prepared statement'] false, done
	
	it 'prepared statement (stream)', (done) ->
		TESTS['prepared statement'] false, done, true
	
	it 'prepared statement in transaction', (done) ->
		TESTS['prepared statement in transaction'] done
	
	it 'transaction with rollback', (done) ->
		TESTS['transaction with rollback'] done
	
	it 'transaction with commit', (done) ->
		TESTS['transaction with commit'] done
	
	it 'transaction queue', (done) ->
		TESTS['transaction queue'] done
	
	it 'cancel request', (done) ->
		TESTS['cancel request'] done
	
	it.skip 'request timeout (not supported by node-tds)', (done) ->
		TESTS['request timeout'] done, 'tds'
	
	after ->
		sql.close()

describe 'tds dates and times', ->
	before (done) ->
		global.DRIVER = 'tds'
		
		sql.connect config(), done
			
	it.skip 'time (not supported by node-tds)', (done) ->
		TIMES['time'] done
		
	it.skip 'time as parameter (not supported by node-tds)', (done) ->
		TIMES['time as parameter'] done
		
	it.skip 'date (not supported by node-tds)', (done) ->
		TIMES['date'] done
		
	it.skip 'date as parameter (not supported by node-tds)', (done) ->
		TIMES['date as parameter'] done
		
	it 'datetime', (done) ->
		TIMES['datetime'] done
		
	it 'datetime as parameter', (done) ->
		TIMES['datetime as parameter'] done
		
	it.skip 'datetime2 (not supported by node-tds)', (done) ->
		TIMES['datetime2'] done
		
	it.skip 'datetime2 as parameter (not supported by node-tds)', (done) ->
		TIMES['datetime2 as parameter'] done
		
	it.skip 'datetimeoffset (not supported by node-tds)', (done) ->
		TIMES['datetimeoffset'] done
		
	it.skip 'datetimeoffset as parameter (not supported by node-tds)', (done) ->
		TIMES['datetimeoffset as parameter'] done
			
	it 'smalldatetime', (done) ->
		TIMES['smalldatetime'] done
		
	it 'smalldatetime as parameter', (done) ->
		TIMES['smalldatetime as parameter'] done
	
	after ->
		sql.close()

describe 'tds multiple connections test suite', ->
	before (done) ->
		connection1 = new sql.Connection config.user2(), ->
			connection2 = new sql.Connection config.user3(), ->
				sql.connect config(), done
	
	it 'connection 1', (done) ->
		TESTS['connection 1'] done, connection1
	
	it 'connection 2', (done) ->
		TESTS['connection 2'] done, connection2
	
	it 'global connection', (done) ->
		TESTS['global connection'] done

	after ->
		connection1.close()
		connection2.close()
		sql.close()

describe 'tds connection errors', ->
	it 'login failed', (done) ->
		TESTS['login failed'] done, 'tds', /Login failed for user 'xsp_test'\./

	it 'timeout', (done) ->
		TESTS['timeout'] done, 'tds', /Connection timeout./

	it 'network error', (done) ->
		TESTS['network error'] done, 'tds', /getaddrinfo ENOTFOUND/

describe 'tds connection pooling', ->
	before (done) ->
		connection1 = new sql.Connection config.user2(), ->
			connection2 = new sql.Connection config.user3(pool: max: 1), done
		
	it 'max 10', (done) ->
		TESTS['max 10'] done, connection1

	it 'max 1', (done) ->
		TESTS['max 1'] done, connection2
	
	after: ->
		connection1.close()
		connection2.close()

describe 'tds stress', ->
	it.skip 'concurrent connections', (done) ->
		TESTS['concurrent connections'] done, 'tds'
	
	it.skip 'concurrent requests', (done) ->
		TESTS['concurrent requests'] done, 'tds'

	it.skip 'streaming off', (done) ->
		TESTS['streaming off'] done, 'tds'

	it.skip 'streaming on', (done) ->
		TESTS['streaming on'] done, 'tds'
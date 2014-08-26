sql = require '../'
config = require('./_connection') 'tedious'

connection1 = null
connection2 = null

describe 'tedious test suite', ->
	before (done) ->
		global.DRIVER = 'tedious'
		
		sql.connect config(), (err) ->
			if err then return done err
			
			req = new sql.Request
			req.query 'delete from tran_test', done
	
	beforeEach (done) ->
		global.MODE = 'query'
		done()
	
	it 'stored procedure', (done) ->
		TESTS['stored procedure'] done, true
	
	it 'stored procedure (batch)', (done) ->
		global.MODE = 'batch'
		TESTS['stored procedure'] done, true
	
	it 'stored procedure (stream)', (done) ->
		TESTS['stored procedure'] done, true, true
	
	it 'stored procedure (batch, stream)', (done) ->
		global.MODE = 'batch'
		TESTS['stored procedure'] done, true, true
	
	it 'user defined types', (done) ->
		TESTS['user defined types'] done
	
	it 'binary data', (done) ->
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
		TESTS['query with multiple recordsets'] done, true
	
	it 'query with multiple recordsets (stream)', (done) ->
		TESTS['query with multiple recordsets'] done, true, true
	
	it 'query with input parameters', (done) ->
		TESTS['query with input parameters'] done
	
	it 'query with input parameters (batch)', (done) ->
		global.MODE = 'batch'
		TESTS['query with input parameters'] done
	
	it 'query with output parameters', (done) ->
		TESTS['query with output parameters'] done
	
	it 'query with output parameters (batch)', (done) ->
		global.MODE = 'batch'
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
		TESTS['prepared statement'] true, done
	
	it 'prepared statement (stream)', (done) ->
		TESTS['prepared statement'] true, done, true
	
	it 'prepared statement in transaction', (done) ->
		TESTS['prepared statement in transaction'] done
	
	it 'transaction with rollback', (done) ->
		TESTS['transaction with rollback'] done
	
	it 'transaction with commit', (done) ->
		TESTS['transaction with commit'] done
	
	it 'transaction queue', (done) ->
		TESTS['transaction queue'] done
	
	it 'cancel request', (done) ->
		TESTS['cancel request'] done, /Canceled./
	
	it 'request timeout', (done) ->
		TESTS['request timeout'] done, 'tedious', /Timeout: Request failed to complete in 500ms/
	
	after ->
		sql.close()

describe 'tedious bulk load', ->
	before (done) ->
		global.DRIVER = 'tedious'
		
		sql.connect config(), (err) ->
			if err then return done err
			
			req = new sql.Request
			req.query 'delete from bulk_table', done
		
	it 'bulk load (table)', (done) ->
		TESTS['bulk load'] 'bulk_table', done
		
	it 'bulk load (temporary table)', (done) ->
		TESTS['bulk load'] '#anohter_bulk_table', done
	
	after ->
		sql.close()
	

describe 'tedious dates and times', ->
	before (done) ->
		global.DRIVER = 'tedious'
		
		sql.connect config(), done
			
	it 'time', (done) ->
		TIMES['time'] done
		
	it 'time as parameter', (done) ->
		TIMES['time as parameter'] done
		
	it 'date', (done) ->
		TIMES['date'] done
		
	it 'date as parameter', (done) ->
		TIMES['date as parameter'] done
		
	it 'datetime', (done) ->
		TIMES['datetime'] done
		
	it 'datetime as parameter', (done) ->
		TIMES['datetime as parameter'] done
		
	it 'datetime2', (done) ->
		TIMES['datetime2'] done
		
	it 'datetime2 as parameter', (done) ->
		TIMES['datetime2 as parameter'] done
		
	it 'datetimeoffset', (done) ->
		TIMES['datetimeoffset'] done
		
	it 'datetimeoffset as parameter', (done) ->
		TIMES['datetimeoffset as parameter'] done
			
	it 'smalldatetime', (done) ->
		TIMES['smalldatetime'] done
		
	it 'smalldatetime as parameter', (done) ->
		TIMES['smalldatetime as parameter'] done
	
	after ->
		sql.close()

describe 'tedious multiple connections test suite', ->
	before (done) ->
		connection1 = new sql.Connection config.user2(), ->
			connection2 = new sql.Connection config.user3(), ->
				sql.connect config(), done
	
	beforeEach (done) ->
		global.MODE = 'query'
		done()
	
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

describe 'tedious connection errors', ->
	it 'login failed', (done) ->
		TESTS['login failed'] done, 'tedious', /Login failed for user 'xsp_test'/

	it 'timeout', (done) ->
		TESTS['timeout'] done, 'tedious', /Failed to connect to 10.0.0.1:1433 in 1000ms/

	it 'network error', (done) ->
		TESTS['network error'] done, 'tedious', /Failed to connect to \.\.\.:1433 - getaddrinfo ENOTFOUND/

describe 'tedious connection pooling', ->
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

describe 'tedious stress', ->
	it.skip 'concurrent connections', (done) ->
		TESTS['concurrent connections'] done, 'tedious'
	
	it.skip 'concurrent requests', (done) ->
		TESTS['concurrent requests'] done, 'tedious'

	it.skip 'streaming off', (done) ->
		TESTS['streaming off'] done, 'tedious'
	
	it.skip 'streaming on', (done) ->
		TESTS['streaming on'] done, 'tedious'
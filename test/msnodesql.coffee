sql = require '../'
assert = require "assert"
config = require('./_connection') 'msnodesql'

connection1 = null
connection2 = null

# msnodesql tests are only available on windows
if process.platform.match(/^win/)
	describe 'msnodesql test suite', ->
		before (done) ->
			global.DRIVER = 'msnodesql'
		
			sql.connect config(), (err) ->
				if err then return done err
				
				req = new sql.Request
				req.query 'delete from tran_test', done
		
		beforeEach (done) ->
			global.MODE = 'query'
			done()
		
		it 'stored procedure', (done) ->
			TESTS['stored procedure'] done, true
		
		it 'stored procedure (stream)', (done) ->
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
		
		it 'query with output parameters', (done) ->
			TESTS['query with output parameters'] done
		
		it 'query with error', (done) ->
			TESTS['query with error'] done
		
		it 'query with error (stream)', (done) ->
			TESTS['query with error'] done, true
	
		it.skip 'query with multiple errors (not supported by msnodesql)', (done) ->
			TESTS['query with multiple errors'] done
	
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
	
		it.skip 'cancel request (not supported by msnodesql)', (done) ->
			TESTS['cancel request'] done
	
		it.skip 'request timeout (not supported by node-tds)', (done) ->
			TESTS['request timeout'] done, 'msnodesql'
		
		after ->
			sql.close()
	
	describe 'msnodesql dates and times', ->
		before (done) ->
			global.DRIVER = 'msnodesql'
		
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
		
		# https://github.com/WindowsAzure/node-sqlserver/issues/160	
		it.skip 'datetimeoffset (buggy in msnodesql)', (done) ->
			TIMES['datetimeoffset'] done
		
		# https://github.com/WindowsAzure/node-sqlserver/issues/160	
		it.skip 'datetimeoffset as parameter (buggy in msnodesql)', (done) ->
			TIMES['datetimeoffset as parameter'] done
			
		it 'smalldatetime', (done) ->
			TIMES['smalldatetime'] done
			
		it 'smalldatetime as parameter', (done) ->
			TIMES['smalldatetime as parameter'] done
		
		after ->
			sql.close()

	describe 'msnodesql multiple connections test suite', ->
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
	
	describe 'msnodesql connection errors', ->
		it 'login failed', (done) ->
			TESTS['login failed'] done, 'msnodesql', /Login failed for user 'xsp_test'\./
	
		it.skip 'timeout', (done) ->
			TESTS['timeout'] done, 'msnodesql'
	
		it.skip 'network error', (done) ->
			TESTS['network error'] done, 'msnodesql'
	
	describe 'msnodesql connection pooling', ->
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

	describe 'msnodesql stress', ->
		it.skip 'concurrent connections', (done) ->
			TESTS['concurrent connections'] done, 'msnodesql'
		
		it.skip 'concurrent requests', (done) ->
			TESTS['concurrent requests'] done, 'msnodesql'
	
		it.skip 'streaming off', (done) ->
			TESTS['streaming off'] done, 'msnodesql'
		
		it.skip 'streaming on', (done) ->
			TESTS['streaming on'] done, 'msnodesql'
sql = require '../'
assert = require "assert"

connection1 = null
connection2 = null

# msnodesql tests are only available on windows
if process.platform.match(/^win/)
	describe 'msnodesql test suite', ->
		before (done) ->
			global.DRIVER = 'msnodesql'
		
			sql.connect
				driver: 'msnodesql'
				
				user: 'xsp_test'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				
			, (err) ->
				if err then return done err
				
				req = new sql.Request
				req.query 'delete from tran_test', done
		
		it 'stored procedure', (done) ->
			TESTS['stored procedure'] done
	
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
			TESTS['query with multiple recordsets'] done
		
		it 'query with input parameters', (done) ->
			TESTS['query with input parameters'] done
		
		it 'query with output parameters', (done) ->
			TESTS['query with output parameters'] done
		
		it 'query with error', (done) ->
			TESTS['query with error'] done
		
		it 'transaction with rollback', (done) ->
			TESTS['transaction with rollback'] done
		
		it 'transaction with commit', (done) ->
			TESTS['transaction with commit'] done
		
		it 'transaction queue', (done) ->
			TESTS['transaction queue'] done
		
		after ->
			sql.close()
	
	describe 'msnodesql dates and times', ->
		before (done) ->
			global.DRIVER = 'msnodesql'
		
			sql.connect
				driver: 'msnodesql'
				
				user: 'xsp_test'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				
			, done
				
		it 'time', (done) ->
			TIMES['time'] done
			
		it 'time as parameter', (done) ->
			TIMES['time as parameter'] done
			
		it 'date', (done) ->
			TIMES['date'] done
			
		it 'date as parameter', (done) ->
			TIMES['date as parameter'] done
			
		it.only 'datetime', (done) ->
			TIMES['datetime'] done
			
		it 'datetime as parameter', (done) ->
			TIMES['datetime as parameter'] done
			
		it 'datetime2', (done) ->
			TIMES['datetime2'] done
			
		it 'datetime2 as parameter', (done) ->
			TIMES['datetime2 as parameter'] done
		
		# https://github.com/WindowsAzure/node-sqlserver/issues/160	
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

	describe 'msnodesql multiple connections test suite', ->
		before (done) ->
			connection1 = new sql.Connection
				user: 'xsp_test2'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				driver: 'msnodesql'
				
			, ->
				connection2 = new sql.Connection
					user: 'xsp_test3'
					password: 'sweet'
					server: '192.168.2.2'
					database: 'xsp'
					driver: 'msnodesql'
					
				, ->
					sql.connect
						user: 'xsp_test'
						password: 'sweet'
						server: '192.168.2.2'
						database: 'xsp'
						driver: 'msnodesql'
						
					, done
		
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
			connection1 = new sql.Connection
				user: 'xsp_test2'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				driver: 'msnodesql'
				
			, ->
				connection2 = new sql.Connection
					user: 'xsp_test3'
					password: 'sweet'
					server: '192.168.2.2'
					database: 'xsp'
					driver: 'msnodesql'
					
					pool:
						max: 1
				
				, done
			
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
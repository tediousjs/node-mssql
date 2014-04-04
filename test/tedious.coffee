sql = require '../'

connection1 = null
connection2 = null

describe 'tedious test suite', ->
	before (done) ->
		global.DRIVER = 'tedious'
		
		sql.connect
			user: 'xsp_test'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
			options:
				tdsVersion: '7_4'
				debug:
					packet: true
					token: true
					data: true
					payload: true
			
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
	
	it 'prepared statement', (done) ->
		TESTS['prepared statement'] done
	
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
	
	after ->
		sql.close()

describe 'tedious dates and times', ->
	before (done) ->
		global.DRIVER = 'tedious'
		
		sql.connect
			user: 'xsp_test'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
			options:
				tdsVersion: '7_4'
				debug:
					packet: false
					token: false
					data: false
					payload: false
			
		, done
			
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
		connection1 = new sql.Connection
			user: 'xsp_test2'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
			
		, ->
			connection2 = new sql.Connection
				user: 'xsp_test3'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				
			, ->
				sql.connect
					user: 'xsp_test'
					password: 'sweet'
					server: '192.168.2.2'
					database: 'xsp'
					
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

describe 'tedious connection errors', ->
	it 'login failed', (done) ->
		TESTS['login failed'] done, 'tedious', /Login failed for user 'xsp_test'/

	it 'timeout', (done) ->
		TESTS['timeout'] done, 'tedious', /Failed to connect to 10.0.0.1:1433 in 1000ms/

	it 'network error', (done) ->
		TESTS['network error'] done, 'tedious', /Failed to connect to \.\.\.:1433 - getaddrinfo ENOTFOUND/

describe 'tedious connection pooling', ->
	before (done) ->
		connection1 = new sql.Connection
			user: 'xsp_test2'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
			
		, ->
			connection2 = new sql.Connection
				user: 'xsp_test3'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				
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

describe 'tedious stress', ->
	it.skip 'concurrent connections', (done) ->
		TESTS['concurrent connections'] done, 'tedious'
	
	it.skip 'concurrent requests', (done) ->
		TESTS['concurrent requests'] done, 'tedious'
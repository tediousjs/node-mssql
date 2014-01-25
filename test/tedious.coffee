sql = require '../'

connection1 = null
connection2 = null

describe 'tedious test suite', ->
	before (done) ->
		sql.connect
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
		TESTS['login failed'] done, 'tedious', /Login failed; one or more errorMessage events should have been emitted/

	it 'timeout', (done) ->
		TESTS['timeout'] done, 'tedious', /timeout : failed to connect to 10\.0\.0\.1:1433 in 1000ms/

	it 'network error', (done) ->
		TESTS['network error'] done, 'tedious', /connection to \.\.\.:1433 - failed Error: getaddrinfo ENOTFOUND/

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
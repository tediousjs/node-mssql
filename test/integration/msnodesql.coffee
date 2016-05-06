sql = require '../../'
assert = require "assert"

config = ->
	cfg = JSON.parse require('fs').readFileSync "#{__dirname}/../.mssql.json"
	cfg.driver = 'msnodesql'
	cfg

connection1 = null
connection2 = null

if process.versions.node.match(/^(0\.6\.|0\.8\.|0\.10\.)/)
	installed = true

	try
		require 'msnodesql'
	catch ex
		installed = false

# msnodesql tests are only available on windows
if process.platform.match(/^win/) and installed
	describe 'msnodesql', ->
		before (done) ->
			sql.connect config(), (err) ->
				if err then return done err
				
				req = new sql.Request
				req.batch require('fs').readFileSync("#{__dirname}/../cleanup.sql", 'utf8'), (err) ->
					if err then return done err
					
					req = new sql.Request
					req.batch require('fs').readFileSync("#{__dirname}/../prepare.sql", 'utf8'), (err) ->
						if err then return done err
						
						sql.close done

		describe 'basic test suite', ->
			before (done) ->
				global.DRIVER = 'msnodesql'
				
				cfg = config()
				cfg.parseJSON = true
				sql.connect cfg, done
			
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
		
			it.skip 'variant data (not supported by msnodesql)', (done) ->
				TESTS['variant data'] done
			
			it 'stored procedure with one empty recordset', (done) ->
				TESTS['stored procedure with one empty recordset'] done
		
			it 'domain', (done) ->
				TESTS['domain'] done
			
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
			
			it.skip 'query with raiseerror (not supported by msnodesqlv8)', (done) ->
				TESTS['query with raiseerror'] done
		
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
		
			it.skip 'prepared statement with affected rows (buggy in msnodesql)', (done) ->
				TESTS['prepared statement with affected rows'] done
		
			it 'prepared statement in transaction', (done) ->
				TESTS['prepared statement in transaction'] done
			
			it 'transaction with rollback', (done) ->
				TESTS['transaction with rollback'] done
		
			it 'transaction with rollback (manually interrupted)', (done) ->
				TESTS['transaction with rollback (manually interrupted)'] done
			
			it 'transaction with commit', (done) ->
				TESTS['transaction with commit'] done
			
			it 'transaction queue', (done) ->
				TESTS['transaction queue'] done
		
			it.skip 'cancel request (not supported by msnodesql)', (done) ->
				TESTS['cancel request'] done
		
			it.skip 'request timeout (not supported by msnodesql)', (done) ->
				TESTS['request timeout'] done, 'msnodesql'
		
			it 'dataLength type correction', (done) ->
				TESTS['dataLength type correction'] done
		
			it.skip 'chunked json support (requires SQL Server 2016)', (done) ->
				TESTS['chunked json support'] done
		
			it 'chunked xml support', (done) ->
				TESTS['chunked xml support'] done
			
			after ->
				sql.close()
		
		describe.skip 'json support (requires SQL Server 2016)', ->
			before (done) ->
				global.DRIVER = 'msnodesql'
				global.MODE = 'query'
				
				cfg = config()
				cfg.parseJSON = true
				sql.connect cfg, done
			
			it 'parser', (done) ->
				TESTS['json parser'] done
			
			after (done) ->
				sql.close done
		
		describe 'msnodesql dates and times', ->
			before (done) ->
				global.DRIVER = 'msnodesql'
			
				sql.connect config(), done
					
			it 'time', (done) ->
				TIMES['time'] true, done
				
			it 'time as parameter', (done) ->
				TIMES['time as parameter'] true, done
				
			it 'date', (done) ->
				TIMES['date'] true, done
				
			it 'date as parameter', (done) ->
				TIMES['date as parameter'] true, done
				
			it 'datetime', (done) ->
				TIMES['datetime'] true, done
				
			it 'datetime as parameter', (done) ->
				TIMES['datetime as parameter'] true, done
				
			it 'datetime2', (done) ->
				TIMES['datetime2'] true, done
				
			it 'datetime2 as parameter', (done) ->
				TIMES['datetime2 as parameter'] true, done
			
			# https://github.com/WindowsAzure/node-sqlserver/issues/160	
			it.skip 'datetimeoffset (buggy in msnodesql)', (done) ->
				TIMES['datetimeoffset'] true, done
			
			# https://github.com/WindowsAzure/node-sqlserver/issues/160	
			it.skip 'datetimeoffset as parameter (buggy in msnodesql)', (done) ->
				TIMES['datetimeoffset as parameter'] true, done
				
			it 'smalldatetime', (done) ->
				TIMES['smalldatetime'] true, done
				
			it 'smalldatetime as parameter', (done) ->
				TIMES['smalldatetime as parameter'] true, done
			
			after ->
				sql.close()
	
		describe 'msnodesql multiple connections test suite', ->
			before (done) ->
				global.SPIDS = {}
				connection1 = new sql.Connection config(), ->
					connection2 = new sql.Connection config(), ->
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
				TESTS['login failed'] done, 'msnodesql', /Login failed for user '(.*)'\./
		
			it.skip 'timeout', (done) ->
				TESTS['timeout'] done, 'msnodesql'
		
			it.skip 'network error', (done) ->
				TESTS['network error'] done, 'msnodesql'
		
		describe 'msnodesql connection pooling', ->
			before (done) ->
				connection1 = new sql.Connection config(), ->
					cfg = config()
					cfg.pool = max: 1
					connection2 = new sql.Connection cfg, done
		
			beforeEach (done) ->
				global.MODE = 'query'
				done()
				
			it 'max 10', (done) ->
				TESTS['max 10'] done, connection1
		
			it 'max 1', (done) ->
				TESTS['max 1'] done, connection2
		
			it.skip 'interruption (not supported by msnodesql)', (done) ->
				TESTS['interruption'] done, connection1, connection2
			
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
		
		after (done) ->
			sql.connect config(), (err) ->
				if err then return done err
				
				req = new sql.Request
				req.query require('fs').readFileSync("#{__dirname}/../cleanup.sql", 'utf8'), (err) ->
					if err then return done err
					
					sql.close done

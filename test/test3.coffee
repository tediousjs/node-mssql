sql = require '../'
assert = require "assert"

connection1 = null
connection2 = null

describe 'tedious multiple connections test suite', ->
	before (done) ->
		connection1 = new sql.Connection
			user: 'xsp_test2'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
			
			options:
				parametersCodepage: 'windows-1250'
			
		, ->
			connection2 = new sql.Connection
				user: 'xsp_test3'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				
				options:
					parametersCodepage: 'windows-1250'
				
			, done
			
	it 'connection 1', (done) ->
		request = connection1.request()
		request.query 'select SYSTEM_USER as u', (err, recordset) ->
			assert.equal recordset[0].u, 'xsp_test2'
			done err
			
	it 'connection 2', (done) ->
		request = new sql.Request connection2
		request.query 'select SYSTEM_USER as u', (err, recordset) ->
			assert.equal recordset[0].u, 'xsp_test3'
			done err
			
	it 'global connection', (done) ->
		request = new sql.Request()
		request.query 'select SYSTEM_USER as u', (err, recordset) ->
			assert.equal recordset[0].u, 'xsp_test'
			done err

describe 'tedious connection errors', ->
	it 'login failed', (done) ->
		conn = new sql.Connection
			user: 'xsp_test'
			password: 'sweetx'
			server: '192.168.2.2'
		
		, (err) ->
			assert.equal err.message, 'Login failed; one or more errorMessage events should have been emitted'
			done()

if process.platform.match(/^win/)
	describe 'msnodesql multiple connections test suite', ->
		before (done) ->
			connection1 = new sql.Connection
				user: 'xsp_test2'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				driver: 'msnodesql'
				
				options:
					parametersCodepage: 'windows-1250'
				
			, (err) ->
				if err then return done err
				
				connection2 = new sql.Connection
					user: 'xsp_test3'
					password: 'sweet'
					server: '192.168.2.2'
					database: 'xsp'
					driver: 'msnodesql'
					
					options:
						parametersCodepage: 'windows-1250'
					
				, done
				
		it 'connection 1', (done) ->
			request = connection1.request()
			request.query 'select SYSTEM_USER as u', (err, recordset) ->
				assert.equal recordset[0].u, 'xsp_test2'
				done err
				
		it 'connection 2', (done) ->
			request = new sql.Request connection2
			request.query 'select SYSTEM_USER as u', (err, recordset) ->
				assert.equal recordset[0].u, 'xsp_test3'
				done err
				
		it 'global connection', (done) ->
			request = new sql.Request()
			request.query 'select SYSTEM_USER as u', (err, recordset) ->
				assert.equal recordset[0].u, 'xsp_test'
				done err
	
	describe 'msnodesql connection errors', ->
		it 'login failed', (done) ->
			conn = new sql.Connection
				user: 'xsp_test'
				password: 'sweetx'
				server: '192.168.2.2'
				driver: 'msnodesql'
			
			, (err) ->
				assert.equal err.message, '[Microsoft][SQL Server Native Client 11.0][SQL Server]Login failed for user \'xsp_test\'.'
				done()
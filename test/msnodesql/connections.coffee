sql = require '../../'
assert = require "assert"

connection1 = null
connection2 = null

if process.platform.match(/^win/)
	describe 'msnodesql multiple connections test suite', ->
		before (done) ->
			connection1 = new sql.Connection
				user: 'xsp_test2'
				password: 'sweet'
				server: '192.168.2.2'
				database: 'xsp'
				driver: 'msnodesql'
				
			, (err) ->
				if err then return done err
				
				connection2 = new sql.Connection
					user: 'xsp_test3'
					password: 'sweet'
					server: '192.168.2.2'
					database: 'xsp'
					driver: 'msnodesql'
					
				, ->
				sql.connect
					driver: 'msnodesql'
					
					user: 'xsp_test'
					password: 'sweet'
					server: '192.168.2.2'
					database: 'xsp'
					driver: 'msnodesql'
					
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
	
		after ->
			connection1.close()
			connection2.close()
			sql.close()
	
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
			countdown = 3
			complete = ->
				setTimeout ->
					# this must be delayed because destroying connection take some time
					
					assert.equal connection1.pool.getPoolSize(), 3
					assert.equal connection1.pool.availableObjectsCount(), 3
					assert.equal connection1.pool.waitingClientsCount(), 0
					done()
					
				, 100
			
			r1 = new sql.Request connection1
			r1.query 'select 1 as id', (err, recordset) ->
				assert.equal recordset[0].id, 1
				
				if --countdown is 0 then complete()
				
			r2 = new sql.Request connection1
			r2.query 'select 2 as id', (err, recordset) ->
				assert.equal recordset[0].id, 2
				
				if --countdown is 0 then complete()
				
			r3 = new sql.Request connection1
			r3.query 'select 3 as id', (err, recordset) ->
				assert.equal recordset[0].id, 3
				
				if --countdown is 0 then complete()
	
		it 'max 1', (done) ->
			countdown = 3
			
			r1 = new sql.Request connection2
			r1.query 'select 1 as id', (err, recordset) ->
				assert.equal recordset[0].id, 1
				
				if --countdown is 0 then done()
				
			r2 = new sql.Request connection2
			r2.query 'select 2 as id', (err, recordset) ->
				assert.equal recordset[0].id, 2
				
				if --countdown is 0 then done()
				
			r3 = new sql.Request connection2
			r3.query 'select 3 as id', (err, recordset) ->
				assert.equal recordset[0].id, 3
				
				if --countdown is 0 then done()
			
			assert.equal connection2.pool.getPoolSize(), 1
			assert.equal connection2.pool.availableObjectsCount(), 0
			assert.equal connection2.pool.waitingClientsCount(), 2
		
		after: ->
			connection1.close()
			connection2.close()
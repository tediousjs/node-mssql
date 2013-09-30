sql = require '../'
assert = require "assert"

connection1 = null
connection2 = null

describe 'multiple connections test suite', ->
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
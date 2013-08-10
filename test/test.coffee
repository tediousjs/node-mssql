sql = require '../'
assert = require "assert"

describe 'mssql test suite', ->
	before (done) ->
		sql.pool =
			max: 1
			min: 0
			idleTimeoutMillis: 30000
		
		sql.connection =
			userName: 'xsp_test'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
		
		sql.init()
		done()
			
	it 'stored procedure', (done) ->
		request = new sql.Request
		request.append 'in', sql.TYPES.Int, sql.INPUT, 1
		request.append 'out', sql.TYPES.Int, sql.OUTPUT
		request.append 'out2', sql.TYPES.Int, sql.OUTPUT
		
		request.execute '__test', (err, recordsets, returnValue) ->
			unless err
				assert.equal returnValue, 11
				assert.equal recordsets.length, 3
				
				assert.equal recordsets[0].length, 2
				assert.equal recordsets[0][0].a, 1
				assert.equal recordsets[0][0].b, 2
				assert.equal recordsets[0][1].a, 3
				assert.equal recordsets[0][1].b, 4
				
				assert.equal recordsets[1].length, 1
				assert.equal recordsets[1][0].c, 5
				assert.equal recordsets[1][0].d, 6
				
				assert.equal recordsets[2].length, 0
				
				assert.equal request.output.out, 99
				assert.equal request.output.out2, 1
			
			done err
	
	it 'query', (done) ->
		r = new sql.Request
		r.query 'select 41 as test', (err, recordset) ->
			unless err
				assert.equal recordset.length, 1
				assert.equal recordset[0].test, 41

			done err
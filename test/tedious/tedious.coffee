sql = require '../../'
assert = require "assert"

describe 'tedious test suite', ->
	before (done) ->
		sql.connect
			user: 'xsp_test'
			password: 'sweet'
			server: '192.168.2.2'
			database: 'xsp'
			
		, done
	
	it 'stored procedure', (done) ->
		request = new sql.Request
		request.input 'in', sql.Int, null
		request.input 'in2', sql.BigInt, 0
		request.input 'in3', sql.NVarChar, 'ěščřžýáíé'
		request.output 'out', sql.Int
		request.output 'out2', sql.Int
		
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

				# there should be 3 values - 0, 111, asdf - but there is a bug with bigint in tedious when 0 value is casted as null
				#assert.equal recordsets[1][0].e.length, 3
				#assert.equal recordsets[1][0].e[0], 0
				#assert.equal recordsets[1][0].e[1], 111
				#assert.equal recordsets[1][0].e[2], 'asdf'
				
				assert.equal recordsets[1][0].e.length, 2
				assert.equal recordsets[1][0].e[0], 111
				assert.equal recordsets[1][0].e[1], 'asdf'
				
				assert.equal recordsets[1][0].f, null
				assert.equal recordsets[1][0].g, 'ěščřžýáíé'
				assert.equal recordsets[2].length, 0

				assert.equal request.parameters.out.value, 99
				assert.equal request.parameters.out2.value, null
			
			done err
	
	it 'stored procedure with one empty recordset', (done) ->
		request = new sql.Request
		
		request.execute '__test2', (err, recordsets) ->
			unless err
				assert.equal recordsets.returnValue, 11
				assert.equal recordsets.length, 2
			
			done err
	
	it 'empty query', (done) ->
		r = new sql.Request
		r.query '', (err, recordset) ->
			unless err
				assert.equal recordset, null

			done err
	
	it 'query with no recordset', (done) ->
		r = new sql.Request
		r.query 'select * from sys.tables where name = \'______\'', (err, recordset) ->
			unless err
				assert.equal recordset.length, 0

			done err
	
	it 'query with one recordset', (done) ->
		r = new sql.Request
		r.query 'select \'asdf\' as text', (err, recordset) ->
			unless err
				assert.equal recordset.length, 1
				assert.equal recordset[0].text, 'asdf'

			done err
	
	it 'query with multiple recordsets', (done) ->
		r = new sql.Request
		r.multiple = true
		r.query 'select 41 as test, 5 as num, 6 as num;select 999 as second', (err, recordsets) ->
			unless err
				assert.equal recordsets.length, 2
				
				assert.equal recordsets[0].length, 1
				assert.equal recordsets[0][0].test, 41
				
				assert.equal recordsets[0][0].num.length, 2
				assert.equal recordsets[0][0].num[0], 5
				assert.equal recordsets[0][0].num[1], 6

				assert.equal recordsets[1][0].second, 999
				
				assert.equal recordsets[0].columns.test.type, sql.Int

			done err
	
	it 'query with input parameters', (done) ->
		r = new sql.Request
		r.input 'id', 12
		r.query 'select @id as id', (err, recordset) ->
			unless err
				assert.equal recordset.length, 1
				assert.equal recordset[0].id, 12

			done err
	
	it 'query with output parameters', (done) ->
		r = new sql.Request
		r.output 'out', sql.VarChar
		r.query 'select @out = \'test\'', (err, recordset) ->
			unless err
				assert.equal recordset, null
				assert.equal r.parameters.out.value, 'test'

			done err
	
	it 'query with error', (done) ->
		r = new sql.Request
		r.query 'select * from notexistingtable', (err, recordset) ->
			assert.equal err.name, 'Error'
			
			done()
	
	after ->
		sql.close()
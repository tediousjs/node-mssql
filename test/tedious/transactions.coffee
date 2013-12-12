sql = require '../../'
assert = require "assert"

describe 'tedious transactions test suite', ->
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
			
	it 'transaction with rollback', (done) ->
		tran = new sql.Transaction
		tran.begin (err) ->
			if err then return done err

			req = tran.request()
			req.query 'insert into tran_test values (\'test data\')', (err, recordset) ->
				if err then return done err

				req = new sql.Request
				req.query 'select * from tran_test with (nolock)', (err, recordset) ->
					assert.equal recordset.length, 1
					assert.equal recordset[0].data, 'test data'
					
					tran.rollback (err) ->
						if err then return done err

				req = new sql.Request
				req.query 'select * from tran_test', (err, recordset) ->
					assert.equal recordset.length, 0

					done()

	it 'transaction with commit', (done) ->
		tran = new sql.Transaction
		tran.begin (err) ->
			if err then return done err

			req = tran.request()
			req.query 'insert into tran_test values (\'test data\')', (err, recordset) ->
				if err then return done err

				# In this case, table tran_test is locked, so queries out of the transaction cant receive data from the table.
				
				req = new sql.Request
				req.query 'select * from tran_test', (err, recordset) ->
					assert.equal recordset.length, 1
					assert.equal recordset[0].data, 'test data'
					
					# this block must be processed last in this test
					done()
					
				# After we call callback, previous request will complete with zero length recordset.
				
				tran.commit (err) ->
					if err then return done err
			
	it 'queue test', (done) ->
		tran = new sql.Transaction
		tran.begin (err) ->
			if err then return done err
			
			countdown = 5
			complete = ->
				req = new sql.Request
				req.query 'select * from tran_test with (nolock)', (err, recordset) ->
					assert.equal recordset.length, 6
					
					tran.rollback done

			req = tran.request()
			req.query 'insert into tran_test values (\'test data1\')', (err, recordset) ->
				if err then return done err
				if --countdown is 0 then complete()

			req = tran.request()
			req.query 'insert into tran_test values (\'test data2\')', (err, recordset) ->
				if err then return done err
				if --countdown is 0 then complete()

			req = tran.request()
			req.query 'insert into tran_test values (\'test data3\')', (err, recordset) ->
				if err then return done err
				if --countdown is 0 then complete()

			req = tran.request()
			req.query 'insert into tran_test values (\'test data4\')', (err, recordset) ->
				if err then return done err
				if --countdown is 0 then complete()

			req = tran.request()
			req.query 'insert into tran_test values (\'test data5\')', (err, recordset) ->
				if err then return done err
				if --countdown is 0 then complete()
	
	after ->
		sql.close()
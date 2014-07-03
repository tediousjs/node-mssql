sql = require '../'
assert = require "assert"

global.TESTS =
	'stored procedure': (done, checkmulti = true, stream = false) ->
		request = new sql.Request
		request.stream = stream
		request.input 'in', sql.Int, null
		request.input 'in2', sql.BigInt, 0
		request.input 'in3', sql.NVarChar, 'anystring'
		request.input 'in4', sql.UniqueIdentifier, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F'
		request.input 'in5', sql.DateTime, new Date(1860, 0, 24, 1, 52)
		request.output 'out', sql.Int
		request.output 'out2', sql.Int
		request.output 'out3', sql.UniqueIdentifier
		request.output 'out4', sql.DateTime
		request.output 'out5', sql.Char(10)
		
		complete = (err, recordsets, returnValue) ->
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
				assert.equal recordsets[1][0].e.length, 3
				
				if checkmulti
					assert.equal recordsets[1][0].e[0], 0
					assert.equal recordsets[1][0].e[1], 111
					assert.equal recordsets[1][0].e[2], 'asdf'
					
				assert.equal recordsets[1][0].f, null
				assert.equal recordsets[1][0].g, 'anystring'
				assert.equal recordsets[2].length, 0

				assert.equal request.parameters.out.value, 99
				assert.equal request.parameters.out2.value, null
				assert.equal request.parameters.out3.value, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F'
				assert.equal request.parameters.out4.value.getTime(), +new Date(1860, 0, 24, 1, 52)
				assert.equal request.parameters.out5.value, 'anystring '
			
			done err

		request.execute '__test', complete
		
		rsts = []
		errs = []
		
		if stream
			request.on 'recordset', (columns) ->
				rst = []
				rst.columns = columns
				rsts.push rst
			
			request.on 'row', (row) ->
				rsts[rsts.length - 1].push row
			
			request.on 'error', (err) ->
				errs.push err

			request.on 'done', (returnValue) ->
				complete errs.pop(), rsts, returnValue

	'user defined types': (done) ->
		request = new sql.Request
		request.query "declare @g geography = geography::[Null];select geography::STGeomFromText('LINESTRING(-122.360 47.656, -122.343 47.656 )', 4326) as geography, geometry::STGeomFromText('LINESTRING (100 100 10.3 12, 20 180, 180 180)', 0) geometry, @g as nullgeography", (err, rst) ->
			if err then return done err
			
			#console.dir rst[0].geography
			#console.dir rst[0].geometry

			#assert.deepEqual rst[0].geography, sample1
			#assert.deepEqual rst[0].geometry, sample2
			
			assert.strictEqual rst[0].geography.srid, 4326
			assert.strictEqual rst[0].geography.version, 1
			assert.strictEqual rst[0].geography.points.length, 2
			assert.strictEqual rst[0].geography.points[0].x, 47.656
			assert.strictEqual rst[0].geography.points[1].y, -122.343
			assert.strictEqual rst[0].geography.figures.length, 1
			assert.strictEqual rst[0].geography.figures[0].attribute, 0x01
			assert.strictEqual rst[0].geography.shapes.length, 1
			assert.strictEqual rst[0].geography.shapes[0].type, 0x02
			assert.strictEqual rst[0].geography.segments.length, 0
			
			assert.strictEqual rst[0].geometry.srid, 0
			assert.strictEqual rst[0].geometry.version, 1
			assert.strictEqual rst[0].geometry.points.length, 3
			assert.strictEqual rst[0].geometry.points[0].z, 10.3
			assert.strictEqual rst[0].geometry.points[0].m, 12
			assert.strictEqual rst[0].geometry.points[1].x, 20
			assert.strictEqual rst[0].geometry.points[2].y, 180
			assert isNaN(rst[0].geometry.points[2].z)
			assert isNaN(rst[0].geometry.points[2].m)
			assert.strictEqual rst[0].geometry.figures.length, 1
			assert.strictEqual rst[0].geometry.figures[0].attribute, 0x01
			assert.strictEqual rst[0].geometry.shapes.length, 1
			assert.strictEqual rst[0].geometry.shapes[0].type, 0x02
			assert.strictEqual rst[0].geometry.segments.length, 0
			
			if DRIVER in ['tedious', 'msnodesql']
				assert rst.columns.geography.type is sql.Geography
				assert rst.columns.geometry.type is sql.Geometry
				assert.equal rst.columns.geography.udt.name, 'geography'
				assert.equal rst.columns.geometry.udt.name, 'geometry'

			done()

	'binary data': (done) ->
		sample = new Buffer([0x00, 0x01, 0xe2, 0x40])
		
		request = new sql.Request
		request.input 'in', sql.Binary, sample
		request.input 'in2', sql.Binary, null
		request.input 'in3', sql.VarBinary, sample
		request.input 'in4', sql.VarBinary, null
		request.input 'in5', sql.Image, sample
		request.input 'in6', sql.Image, null
		request.output 'out', sql.Binary(4)
		request.output 'out2', sql.VarBinary
		request.execute '__test5', (err, recordsets) ->
			unless err
				assert.deepEqual recordsets[0][0].bin, sample
				assert.deepEqual recordsets[0][0].in, sample
				assert.equal recordsets[0][0].in2, null
				assert.deepEqual recordsets[0][0].in3, sample
				assert.equal recordsets[0][0].in4, null
				assert.deepEqual recordsets[0][0].in5, sample
				assert.equal recordsets[0][0].in6, null
				
				assert.deepEqual request.parameters.out.value, sample
				assert.deepEqual request.parameters.out2.value, sample

			done err
	
	'stored procedure with one empty recordset': (done) ->
		request = new sql.Request
		
		request.execute '__test2', (err, recordsets) ->
			unless err
				assert.equal recordsets.returnValue, 11
				assert.equal recordsets.length, 2
			
			done err
	
	'empty query': (done) ->
		r = new sql.Request
		r.query '', (err, recordset) ->
			unless err
				assert.equal recordset, null

			done err
	
	'query with no recordset': (done) ->
		r = new sql.Request
		r.query 'select * from sys.tables where name = \'______\'', (err, recordset) ->
			unless err
				assert.equal recordset.length, 0

			done err
	
	'query with one recordset': (done) ->
		r = new sql.Request
		r.query 'select \'asdf\' as text', (err, recordset) ->
			unless err
				assert.equal recordset.length, 1
				assert.equal recordset[0].text, 'asdf'

			done err
	
	'query with multiple recordsets': (done, checkmulti = true, stream = false) ->
		r = new sql.Request
		r.stream = stream
		r.multiple = true
		
		complete = (err, recordsets) ->
			unless err
				assert.equal recordsets.length, 2
				assert.equal recordsets[0].length, 1
				assert.equal recordsets[0][0].test, 41
				assert.equal recordsets[0][0].num.length, 2
				
				if checkmulti
					assert.equal recordsets[0][0].num[0], 5
					assert.equal recordsets[0][0].num[1], 6

				assert.equal recordsets[1][0].second, 999
				assert.equal recordsets[0].columns.test.type, sql.Int

			done err
		
		r.query 'select 41 as test, 5 as num, 6 as num;select 999 as second', complete
		
		rsts = []
		errs = []
		
		if stream
			r.on 'recordset', (columns) ->
				rst = []
				rst.columns = columns
				rsts.push rst
			
			r.on 'row', (row) ->
				rsts[rsts.length - 1].push row
			
			r.on 'error', (err) ->
				errs.push err

			r.on 'done', (returnValue) ->
				complete errs.pop(), rsts, returnValue
	
	'query with input parameters': (done) ->
		r = new sql.Request
		r.input 'id', 12
		r.query 'select @id as id', (err, recordset) ->
			unless err
				assert.equal recordset.length, 1
				assert.equal recordset[0].id, 12

			done err
	
	'query with output parameters': (done) ->
		r = new sql.Request
		r.output 'out', sql.VarChar
		r.query 'select @out = \'test\'', (err, recordset) ->
			unless err
				assert.equal recordset, null
				assert.equal r.parameters.out.value, 'test'

			done err
	
	'query with error': (done, stream = false) ->
		r = new sql.Request
		r.stream = stream
		
		complete = (err, recordset) ->
			assert.equal err instanceof sql.RequestError, true

			done()
		
		r.query 'select * from notexistingtable', complete
		
		if stream
			error = null
			
			r.on 'error', (err) ->
				error = err
			
			r.on 'done', ->
				complete error
	
	'query with multiple errors': (done, stream = false) ->
		r = new sql.Request
		r.stream = stream
		
		complete = (err, recordset) ->
			assert.equal err instanceof sql.RequestError, true
			assert.equal err.message, 'Invalid column name \'b\'.'
			assert.equal err.precedingErrors.length, 1
			assert.equal err.precedingErrors[0] instanceof sql.RequestError, true
			assert.equal err.precedingErrors[0].message, 'Invalid column name \'a\'.'

			done()
		
		r.query 'select a;select b;', complete
		
		if stream
			errors = []
			
			r.on 'error', (err) ->
				errors.push err
			
			r.on 'done', ->
				error = errors.pop()
				error.precedingErrors = errors
				
				complete error
	
	'prepared statement': (decimal, done) ->
		if decimal
			ps = new sql.PreparedStatement
			ps.input 'num', sql.Int
			ps.input 'num2', sql.Decimal(5, 2)
			ps.input 'chr', sql.VarChar(sql.MAX)
			ps.prepare 'select @num as number, @num2 as number2, @chr as chars', (err) ->
				if err then return done err
				
				ps.execute {num: 555, num2: 666.77, chr: 'asdf'}, (err, recordset) ->
					assert.equal recordset.length, 1
					assert.equal recordset[0].number, 555
					assert.equal recordset[0].number2, 666.77
					assert.equal recordset[0].chars, 'asdf'
					
					ps.unprepare done
		
		else
			# node-tds doesn't support decimal/numeric in PS
			ps = new sql.PreparedStatement
			ps.input 'num', sql.Int
			ps.prepare 'select @num as number', (err) ->
				if err then return done err
				
				ps.execute {num: 555}, (err, recordset) ->
					assert.equal recordset.length, 1
					assert.equal recordset[0].number, 555
					
					ps.unprepare done
	
	'prepared statement in transaction': (done) ->
		tran = new sql.Transaction
		tran.begin (err) ->
			if err then return done err
			
			ps = new sql.PreparedStatement tran
			ps.input 'num', sql.Int
			ps.prepare 'select @num as number', (err) ->
				if err then return done err
				
				assert.ok tran._pooledConnection is ps._pooledConnection
				
				ps.multiple = true
				ps.execute {num: 555}, (err, recordsets) ->
					assert.equal recordsets[0].length, 1
					assert.equal recordsets[0][0].number, 555
					
					ps.unprepare (err) ->
						if err then return done err
						
						tran.commit done
	
	'transaction with rollback': (done) ->
		tran = new sql.Transaction
		tran.begin (err) ->
			if err then return done err

			req = tran.request()
			req.query 'insert into tran_test values (\'test data\')', (err, recordset) ->
				if err then return done err
				
				locked = true

				req = new sql.Request
				req.query 'select * from tran_test with (nolock)', (err, recordset) ->
					assert.equal recordset.length, 1
					assert.equal recordset[0].data, 'test data'
					
					setTimeout ->
						unless locked then return done new Error "Unlocked before rollback."

						tran.rollback (err) ->
							if err then return done err
							
					, 500

				req = new sql.Request
				req.query 'select * from tran_test', (err, recordset) ->
					assert.equal recordset.length, 0
					
					assert.equal tbegin, true
					assert.equal tcommit, false
					assert.equal trollback, true
					
					locked = false

					done()
		
		tbegin = false
		tran.on 'begin', -> tbegin = true
		
		tcommit = false
		tran.on 'commit', -> tcommit = true
		
		trollback = false
		tran.on 'rollback', -> trollback = true

	'transaction with commit': (done) ->
		tran = new sql.Transaction
		tran.begin (err) ->
			if err then return done err

			req = tran.request()
			req.query 'insert into tran_test values (\'test data\')', (err, recordset) ->
				if err then return done err

				# In this case, table tran_test is locked until we call commit
				locked = true
				
				req = new sql.Request
				req.query 'select * from tran_test', (err, recordset) ->
					assert.equal recordset.length, 1
					assert.equal recordset[0].data, 'test data'
					
					locked = false
				
				setTimeout ->
					unless locked then return done new Error "Unlocked before commit."
					
					tran.commit (err) ->
						if err then return done err

						assert.equal tbegin, true
						assert.equal tcommit, true
						assert.equal trollback, false
						
						done()
						
				, 500
		
		tbegin = false
		tran.on 'begin', -> tbegin = true
		
		tcommit = false
		tran.on 'commit', -> tcommit = true
		
		trollback = false
		tran.on 'rollback', -> trollback = true
			
	'transaction queue': (done) ->
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
	
	'cancel request': (done, message) ->
		r = new sql.Request
		r.query 'waitfor delay \'00:00:05\';select 1', (err, recordset) ->
			assert.equal (if message then message.exec(err.message)? else (err instanceof sql.RequestError)), true

			done null
		
		r.cancel()
	
	'connection 1': (done, connection) ->
		request = connection.request()
		request.query 'select SYSTEM_USER as u', (err, recordset) ->
			assert.equal recordset[0].u, 'xsp_test2'
			done err
			
	'connection 2': (done, connection) ->
		request = new sql.Request connection
		request.query 'select SYSTEM_USER as u', (err, recordset) ->
			assert.equal recordset[0].u, 'xsp_test3'
			done err
			
	'global connection': (done) ->
		request = new sql.Request()
		request.query 'select SYSTEM_USER as u', (err, recordset) ->
			assert.equal recordset[0].u, 'xsp_test'
			done err
	
	'login failed': (done, driver, message) ->
		conn = new sql.Connection require('./_connection')(driver).bad()
		
		, (err) ->
			assert.equal (if message then message.exec(err.message)? else (err instanceof sql.ConnectionError)), true
			done()

	'timeout': (done, driver, message) ->
		conn = new sql.Connection
			user: '...'
			password: '...'
			server: '10.0.0.1'
			driver: driver
			timeout: 1000
			pool: {idleTimeoutMillis: 500}
			
		, (err) ->
			assert.equal (if message then message.exec(err.message)? else (err instanceof sql.ConnectionError)), true
			done()

	'network error': (done, driver, message) ->
		conn = new sql.Connection
			user: '...'
			password: '...'
			server: '...'
			driver: driver
			
		, (err) ->
			assert.equal (if message then message.exec(err.message)? else (err instanceof sql.ConnectionError)), true
			done()
	
	'max 10': (done, connection) ->
		countdown = 3
		complete = ->
			setTimeout ->
				# this must be delayed because destroying connection take some time
				
				assert.equal connection.pool.getPoolSize(), 3
				assert.equal connection.pool.availableObjectsCount(), 3
				assert.equal connection.pool.waitingClientsCount(), 0
				done()
				
			, 100
		
		r1 = new sql.Request connection
		r1.query 'select 1 as id', (err, recordset) ->
			assert.equal recordset[0].id, 1
			
			if --countdown is 0 then complete()
			
		r2 = new sql.Request connection
		r2.query 'select 2 as id', (err, recordset) ->
			assert.equal recordset[0].id, 2
			
			if --countdown is 0 then complete()
			
		r3 = new sql.Request connection
		r3.query 'select 3 as id', (err, recordset) ->
			assert.equal recordset[0].id, 3
			
			if --countdown is 0 then complete()

	'max 1': (done, connection) ->
		countdown = 3
		
		r1 = new sql.Request connection
		r1.query 'select 1 as id', (err, recordset) ->
			assert.equal recordset[0].id, 1
			
			if --countdown is 0 then done()
			
		r2 = new sql.Request connection
		r2.query 'select 2 as id', (err, recordset) ->
			assert.equal recordset[0].id, 2
			
			if --countdown is 0 then done()
			
		r3 = new sql.Request connection
		r3.query 'select 3 as id', (err, recordset) ->
			assert.equal recordset[0].id, 3
			
			if --countdown is 0 then done()
		
		assert.equal connection.pool.getPoolSize(), 1
		assert.equal connection.pool.availableObjectsCount(), 0
		assert.equal connection.pool.waitingClientsCount(), 2
	
	'concurrent connections': (done, driver) ->
		#return done null
		
		console.log ""
		
		conns = []
		peak = 500
		curr = 0
		
		mem = process.memoryUsage()
		console.log "rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024
		
		connected = (err) ->
			if err
				console.error err.stack
				process.exit()
				
			curr++
			if curr is peak
				mem = process.memoryUsage()
				console.log "rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024
				
				curr = 0
				for c in conns
					c.close closed

		closed = ->
			curr++
			if curr is peak
				conns = []
				global.gc()
				
				process.nextTick ->
					mem = process.memoryUsage()
					console.log "rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024
					
					done()
		
		for i in [1..peak]
			c = new sql.Connection require('./_connection')(driver)()

			c.connect connected
			conns.push c
	
	'concurrent requests': (done, driver) ->
		console.log ""
		
		conn = new sql.Connection require('./_connection')(driver)(pool: {min: 0, max: 50})
		
		conn.connect (err) ->
			if err then return done err
			
			requests = []
			peak = 10000
			curr = 0
			
			mem = process.memoryUsage()
			console.log "rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024
			
			completed = (err, recordset) ->
				if err
					console.error err.stack
					process.exit()
				
				assert.equal recordset[0].num, 123456
				assert.equal recordset[0].str, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf'
					
				curr++
				if curr is peak
					mem = process.memoryUsage()
					console.log "rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024
				
					assert.equal conn.pool.getPoolSize(), 50
					
					done()
			
			for i in [1..peak]
				r = new sql.Request conn
				r.query "select 123456 as num, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf' as str", completed
				requests.push r

	'streaming off': (done, driver) ->
		@timeout 60000
		
		sql.connect require('./_connection')(driver)(requestTimeout: 60000), (err) ->
			if err then return done err
			
			r = new sql.Request
			r.query 'select * from streaming', (err, recordset) ->
				if err then return done err
				
				console.log "Got #{recordset.length} rows."
	
				done()

	'streaming on': (done, driver) ->
		@timeout 60000
		
		rows = 0
		
		sql.connect require('./_connection')(driver)(requestTimeout: 60000), (err) ->
			if err then return done err
			
			r = new sql.Request
			r.stream = true
			r.query 'select * from streaming'
			r.on 'error', (err) ->
				console.error err
			
			r.on 'row', (row) ->
				rows++
			
			r.on 'done', ->
				console.log "Got #{rows} rows."
	
				done()
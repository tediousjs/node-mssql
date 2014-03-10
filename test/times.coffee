assert = require 'assert'
sql = require '../'

global.TIMES =
	'time': (done) ->
		r1 = new sql.Request
		r1.query "declare @t time(1) = null;select convert(time(0), '23:59:59.999999999') as t1, convert(time(4), '23:59:59.999999999') as t2, convert(time(7), '23:59:59.999999999') as t3, @t as t4", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].t1, 86399000
			assert.equal +rst[0].t2, 86399999
			assert.equal +rst[0].t3, 86399999
			assert.equal rst[0].t4, null
			assert.equal rst[0].t1.nanosecondsDelta, 0
			assert.equal rst[0].t2.nanosecondsDelta, 0.0009
			assert.equal rst[0].t3.nanosecondsDelta, 0.0009999
			
			if DRIVER is 'tedious'
				assert.equal rst.columns.t1.scale, 0
				assert.equal rst.columns.t2.scale, 4
				assert.equal rst.columns.t3.scale, 7
				assert.equal rst.columns.t4.scale, 1
			
			done()
	
	'time as parameter': (done) ->
		time = new Date(Date.UTC(2014, 0, 1, 23, 59, 59, 999))
		time.nanosecondDelta = 0.0009999
		
		r1 = new sql.Request
		r1.input 't1', sql.Time, time
		r1.input 't2', sql.Time, null
		r1.query "select @t1 as t1, @t2 as t2", (err, rst) ->
			if err then return done err
			
			assert.equal +rst[0].t1, 86399999
			assert.equal rst[0].t2, null
			
			if DRIVER is 'tedious'
				assert.equal rst[0].t1.nanosecondsDelta, 0.0009999 # msnodesql cant pass nanoseconds
				assert.equal rst.columns.t1.scale, 7
			
			done()
	
	'date': (done) ->
		r1 = new sql.Request
		r1.query "select convert(date, '2014-01-01') as d1", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].d1, new Date(Date.UTC(2014, 0, 1)).getTime()
			
			done()
	
	'date as parameter': (done) ->
		r1 = new sql.Request
		r1.input 'd1', sql.Date, new Date(Date.UTC(2014, 1, 14))
		r1.input 'd2', sql.Date, null
		r1.query "select @d1 as d1, @d2 as d2", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].d1, new Date(Date.UTC(2014, 1, 14)).getTime()
			assert.equal rst[0].d2, null
			
			done()
			
	'datetime': (done) ->
		r1 = new sql.Request
		r1.query "select convert(datetime, '2014-02-14 22:59:59') as dt1", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dt1, new Date(Date.UTC(2014, 1, 14, 22, 59, 59)).getTime()

			done()
	
	'datetime as parameter': (done) ->
		date = new Date(Date.UTC(2014, 1, 14, 22, 59, 59))

		r1 = new sql.Request
		r1.input 'dt1', sql.DateTime, date
		r1.input 'dt2', sql.DateTime, null
		r1.query "select @dt1 as dt1, @dt2 as dt2", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dt1, date.getTime()
			assert.equal rst[0].dt2, null

			done()
	
	'datetime2': (done) ->
		r1 = new sql.Request
		r1.query "select convert(datetime2(7), '1111-02-14 22:59:59.9999999') as dt1", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dt1, new Date(Date.UTC(1111, 1, 14, 22, 59, 59, 999)).getTime()
			assert.equal rst[0].dt1.nanosecondsDelta, 0.0009999
			
			if DRIVER is 'tedious'
				assert.equal rst.columns.dt1.scale, 7
			
			done()
	
	'datetime2 as parameter': (done) ->
		date = new Date(2014, 1, 14, 22, 59, 59, 999)
		date.nanosecondDelta = 0.0009999
		
		r1 = new sql.Request
		r1.input 'dt1', sql.DateTime2, date
		r1.input 'dt2', sql.DateTime2, null
		r1.query "select @dt1 as dt1, @dt2 as dt2", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dt1, date.getTime()
			assert.equal rst[0].dt2, null
			
			if DRIVER is 'tedious'
				assert.equal rst[0].dt1.nanosecondsDelta, 0.0009999 # msnodesql cant pass nanoseconds
				assert.equal rst.columns.dt1.scale, 7

			done()
	
	'datetimeoffset': (done) ->
		r1 = new sql.Request
		r1.query "select convert(datetimeoffset(7), '2014-02-14 22:59:59.9999999 +05:00') as dto1, convert(datetimeoffset(7), '2014-02-14 17:59:59.9999999 +00:00') as dto2", (err, rst) ->
			if err then return done err
			
			#console.log rst[0]
			#console.log new Date(Date.UTC(2014, 1, 14, 22, 59, 59, 999))
			
			assert.equal +rst[0].dto1, new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999)).getTime()
			assert.equal +rst[0].dto2, new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999)).getTime()
			assert.equal rst[0].dto1.nanosecondsDelta, 0.0009999 # msnodesql cant pass nanoseconds
			
			if DRIVER is 'tedious'
				assert.equal rst.columns.dto1.scale, 7
				assert.equal rst.columns.dto2.scale, 7
			
			done()
	
	'datetimeoffset as parameter': (done) ->
		r1 = new sql.Request
		r1.input 'dto1', sql.DateTimeOffset, new Date(2014, 1, 14, 11, 59, 59)
		r1.input 'dto2', sql.DateTimeOffset, new Date(Date.UTC(2014, 1, 14, 11, 59, 59))
		r1.input 'dto3', sql.DateTimeOffset, null
		r1.query "select @dto1 as dto1, @dto2 as dto2, @dto3 as dto3", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dto1, new Date(2014, 1, 14, 11, 59, 59).getTime()
			assert.equal +rst[0].dto2, new Date(Date.UTC(2014, 1, 14, 11, 59, 59)).getTime()
			assert.equal rst[0].dto3, null
			
			if DRIVER is 'tedious'
				assert.equal rst.columns.dto1.scale, 7
			
			done()
			
	'smalldatetime': (done) ->
		r1 = new sql.Request
		r1.query "select convert(datetime, '2014-02-14 22:59:59') as dt1", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dt1, new Date(Date.UTC(2014, 1, 14, 22, 59, 59)).getTime()

			done()
	
	'smalldatetime as parameter': (done) ->
		date = new Date(2014, 1, 14, 22, 59)
		
		r1 = new sql.Request
		r1.input 'dt1', sql.SmallDateTime, date
		r1.input 'dt2', sql.SmallDateTime, null
		r1.query "select @dt1 as dt1, @dt2 as dt2", (err, rst) ->
			if err then return done err

			assert.equal +rst[0].dt1, date.getTime()
			assert.equal rst[0].dt2, null

			done()
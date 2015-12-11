{Pool} = require 'generic-pool'
tds = require 'tedious'
util = require 'util'

{TYPES, declare, cast} = require './datatypes'
DECLARATIONS = require('./datatypes').DECLARATIONS
UDT = require('./udt').PARSERS
Table = require('./table')
JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'

###
@ignore
###

getTediousType = (type) ->
	switch type
		when TYPES.VarChar then return tds.TYPES.VarChar
		when TYPES.NVarChar then return tds.TYPES.NVarChar
		when TYPES.Text then return tds.TYPES.Text
		when TYPES.Int then return tds.TYPES.Int
		when TYPES.BigInt then return tds.TYPES.BigInt
		when TYPES.TinyInt then return tds.TYPES.TinyInt
		when TYPES.SmallInt then return tds.TYPES.SmallInt
		when TYPES.Bit then return tds.TYPES.Bit
		when TYPES.Float then return tds.TYPES.Float
		when TYPES.Decimal then return tds.TYPES.Decimal
		when TYPES.Numeric then return tds.TYPES.Numeric
		when TYPES.Real then return tds.TYPES.Real
		when TYPES.Money then return tds.TYPES.Money
		when TYPES.SmallMoney then return tds.TYPES.SmallMoney
		when TYPES.Time then return tds.TYPES.TimeN
		when TYPES.Date then return tds.TYPES.DateN
		when TYPES.DateTime then return tds.TYPES.DateTime
		when TYPES.DateTime2 then return tds.TYPES.DateTime2N
		when TYPES.DateTimeOffset then return tds.TYPES.DateTimeOffsetN
		when TYPES.SmallDateTime then return tds.TYPES.SmallDateTime
		when TYPES.UniqueIdentifier then return tds.TYPES.UniqueIdentifierN
		when TYPES.Xml then return tds.TYPES.VarChar
		when TYPES.Char then return tds.TYPES.Char
		when TYPES.NChar then return tds.TYPES.NChar
		when TYPES.NText then return tds.TYPES.NVarChar
		when TYPES.Image then return tds.TYPES.Image
		when TYPES.Binary then return tds.TYPES.Binary
		when TYPES.VarBinary then return tds.TYPES.VarBinary
		when TYPES.UDT, TYPES.Geography, TYPES.Geometry then return tds.TYPES.UDT
		when TYPES.TVP then return tds.TYPES.TVP
		else return type

###
@ignore
###

getMssqlType = (type, length) ->
	switch type
		when tds.TYPES.Char then return TYPES.Char
		when tds.TYPES.NChar then return TYPES.NChar
		when tds.TYPES.VarChar then return TYPES.VarChar
		when tds.TYPES.NVarChar then return TYPES.NVarChar
		when tds.TYPES.Text then return TYPES.Text
		when tds.TYPES.NText then return TYPES.NText
		when tds.TYPES.Int then return TYPES.Int
		when tds.TYPES.IntN
			if length is 8 then return TYPES.BigInt
			if length is 4 then return TYPES.Int
			if length is 2 then return TYPES.SmallInt
			return TYPES.TinyInt
			
		when tds.TYPES.BigInt then return TYPES.BigInt
		when tds.TYPES.TinyInt then return TYPES.TinyInt
		when tds.TYPES.SmallInt then return TYPES.SmallInt
		when tds.TYPES.Bit, tds.TYPES.BitN then return TYPES.Bit
		when tds.TYPES.Float then return TYPES.Float
		when tds.TYPES.FloatN
			if length is 8 then return TYPES.FloatN
			return TYPES.Real
		
		when tds.TYPES.Real then return TYPES.Real
		when tds.TYPES.Money then return TYPES.Money
		when tds.TYPES.MoneyN
			if length is 8 then return TYPES.Money
			return TYPES.SmallMoney
			
		when tds.TYPES.SmallMoney then return TYPES.SmallMoney
		when tds.TYPES.Numeric, tds.TYPES.NumericN then return TYPES.Numeric
		when tds.TYPES.Decimal, tds.TYPES.DecimalN then return TYPES.Decimal
		when tds.TYPES.DateTime then return TYPES.DateTime
		when tds.TYPES.DateTimeN
			if length is 8 then return TYPES.DateTime
			return TYPES.SmallDateTime
		
		when tds.TYPES.TimeN then return TYPES.Time
		when tds.TYPES.DateN then return TYPES.Date
		when tds.TYPES.DateTime2N then return TYPES.DateTime2
		when tds.TYPES.DateTimeOffsetN then return TYPES.DateTimeOffset
		when tds.TYPES.SmallDateTime then return TYPES.SmallDateTime
		when tds.TYPES.UniqueIdentifierN then return TYPES.UniqueIdentifier
		when tds.TYPES.Image then return TYPES.Image
		when tds.TYPES.Binary then return TYPES.Binary
		when tds.TYPES.VarBinary then return TYPES.VarBinary
		when tds.TYPES.Xml then return TYPES.Xml
		when tds.TYPES.UDT then return TYPES.UDT
		when tds.TYPES.TVP then return TYPES.TVP

###
@ignore
###

createColumns = (metadata) ->
	out = {}
	for column, index in metadata
		out[column.colName] =
			index: index
			name: column.colName
			length: column.dataLength
			type: getMssqlType(column.type, column.dataLength)
			scale: column.scale
			precision: column.precision
			nullable: !!(column.flags & 0x01)
			caseSensitive: !!(column.flags & 0x02)
			identity: !!(column.flags & 0x10)
			readOnly: !(column.flags & 0x0C)

		if column.udtInfo?
			out[column.colName].udt =
				name: column.udtInfo.typeName
				database: column.udtInfo.dbname
				schema: column.udtInfo.owningSchema
				assembly: column.udtInfo.assemblyName
			
			if DECLARATIONS[column.udtInfo.typeName]
				out[column.colName].type = DECLARATIONS[column.udtInfo.typeName]
	
	out

###
@ignore
###

valueCorrection = (value, metadata) ->
	if metadata.type is tds.TYPES.UDT and value?
		if UDT[metadata.udtInfo.typeName]
			UDT[metadata.udtInfo.typeName] value
			
		else
			value
		
	else
		value

###
@ignore
###

parameterCorrection = (value) ->
	if value instanceof Table
		tvp =
			name: value.name
			schema: value.schema
			columns: []
			rows: value.rows
			
		for col in value.columns
			tvp.columns.push
				name: col.name
				type: getTediousType col.type
				length: col.length
				scale: col.scale
				precision: col.precision
			
		tvp
			
	else
		value

###
@ignore
###

module.exports = (Connection, Transaction, Request, ConnectionError, TransactionError, RequestError) ->
	class TediousConnection extends Connection
		pool: null
		
		connect: (config, callback) ->
			cfg =
				userName: config.user
				password: config.password
				server: config.server
				options: config.options
				domain: config.domain
			
			cfg.options.database ?= config.database
			cfg.options.port ?= config.port
			cfg.options.connectTimeout ?= config.connectionTimeout ? config.timeout ? 15000 # config.timeout deprecated in 0.6.0
			cfg.options.requestTimeout ?= config.requestTimeout ? 15000
			cfg.options.tdsVersion ?= '7_4'
			cfg.options.rowCollectionOnDone = false
			cfg.options.rowCollectionOnRequestCompletion = false
			cfg.options.useColumnNames = false
			cfg.options.appName ?= 'node-mssql'
			
			# tedious always connect via tcp when port is specified
			if cfg.options.instanceName then delete cfg.options.port
			
			if isNaN cfg.options.requestTimeout then cfg.options.requestTimeout = 15000
			if cfg.options.requestTimeout is Infinity then cfg.options.requestTimeout = 0
			if cfg.options.requestTimeout < 0 then cfg.options.requestTimeout = 0
			
			if config.debug
				cfg.options.debug =
					packet: true
					token: true
					data: true
					payload: true

			cfg_pool =
				name: 'mssql'
				max: 10
				min: 0
				idleTimeoutMillis: 30000
				create: (callback) =>
					c = new tds.Connection cfg

					c.once 'connect', (err) ->
						if err then err = ConnectionError err
						if err then return callback err, null # there must be a second argument null
						callback null, c
					
					c.on 'error', (err) =>
						@emit 'error', err
					
					if config.debug
						c.on 'debug', (msg) => @_debug msg

				validate: (c) ->
					c? and !c.closed
				
				destroy: (c) ->
					c?.close()
					
					# there might be some unemitted events
					setTimeout ->
						c?.removeAllListeners()
					, 500
			
			if config.pool
				for key, value of config.pool
					cfg_pool[key] = value

			@pool = Pool cfg_pool, cfg
			
			#create one testing connection to check if everything is ok
			@pool.acquire (err, connection) =>
				if err
					@pool.drain => #prevent the pool from creating additional connections. we're done with it
						@pool?.destroyAllNow()
						@pool = null

				else
					# and release it immediately
					@pool.release connection
				
				callback err
		
		close: (callback) ->
			unless @pool then return callback null

			@pool.drain =>
				@pool?.destroyAllNow()
				@pool = null
				callback null
	
	class TediousTransaction extends Transaction
		_abort: ->
			if not @_rollbackRequested
				# transaction interrupted because of XACT_ABORT
				@_pooledConnection.removeListener 'rollbackTransaction', @_abort
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				@_aborted = true
				
				@emit 'rollback', true
			
		begin: (callback) ->
			@_aborted = false
			@_rollbackRequested = false
			
			@connection.pool.acquire (err, connection) =>
				if err then return callback err
				
				@_pooledConnection = connection
				@_pooledConnection.on 'rollbackTransaction', @_abort
					
				connection.beginTransaction (err) =>
					if err then err = TransactionError err
					callback err
				
				, @name, @isolationLevel
			
		commit: (callback) ->
			@_pooledConnection.commitTransaction (err) =>
				if err then err = TransactionError err
				
				@_pooledConnection.removeListener 'rollbackTransaction', @_abort
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				
				callback err

		rollback: (callback) ->
			@_rollbackRequested = true
			@_pooledConnection.rollbackTransaction (err) =>
				if err then err = TransactionError err
				
				@_pooledConnection.removeListener 'rollbackTransaction', @_abort
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				
				callback err
		
	class TediousRequest extends Request
		###
		Execute specified sql batch.
		###
		
		batch: (batch, callback) ->
			@_isBatch = true
			TediousRequest::query.call @, batch, callback
		
		###
		Bulk load.
		###
		
		bulk: (table, callback) ->
			table._makeBulk()
			
			unless table.name
				process.nextTick -> callback RequestError("Table name must be specified for bulk insert.", "ENAME")
				
			if table.name.charAt(0) is '@'
				process.nextTick -> callback RequestError("You can't use table variables for bulk insert.", "ENAME")

			started = Date.now()
			errors = []
			errorHandlers = {}
			hasReturned = false
			handleError = (doReturn, connection, info) =>
				err = new Error info.message
				err.info = info
				e = RequestError err, 'EREQUEST'

				if @stream
					@emit 'error', e
				else
					if (doReturn && !hasReturned)
						if connection?
							for event, handler of errorHandlers
								connection.removeListener event, handler
							@_release connection
						hasReturned = true
						callback?(e)

				# we must collect errors even in stream mode
				errors.push e

			@_acquire (err, connection) =>
				unless err
					if @verbose then @_log "-------- sql bulk load --------\n    table: #{table.name}"

					if @canceled
						if @verbose then @_log "---------- canceling ----------"
						@_release connection
						return callback? new RequestError "Canceled.", 'ECANCEL'
					
					@_cancel = =>
						if @verbose then @_log "---------- canceling ----------"
						connection.cancel()
					
					# attach handler to handle multiple error messages
					errorHandlers['errorMessage'] = handleError.bind(undefined, false, connection)
					errorHandlers['error']        = handleError.bind(undefined, true, connection)
					connection.on 'errorMessage', errorHandlers['errorMessage']
					connection.on 'error',        errorHandlers['error']

					
					done = (err, rowCount) =>
						# to make sure we handle no-sql errors as well
						if err and err.message isnt errors[errors.length - 1]?.message
							err = RequestError err, 'EREQUEST'
							
							if @stream
								@emit 'error', err
							
							errors.push err
						
						# TODO ----
						
						if @verbose 
							if errors.length
								@_log "    error: #{error}" for error in errors
							
							elapsed = Date.now() - started
							@_log " duration: #{elapsed}ms"
							@_log "---------- completed ----------"
			
						@_cancel = null
						
						if errors.length and not @stream
							error = errors.pop()
							error.precedingErrors = errors
						
						if (!hasReturned)
							for event, handler of errorHandlers
								connection.removeListener event, handler
							@_release connection
							hasReturned = true
						
							if @stream
								callback null, null
						
							else
								callback? error, rowCount
					
					bulk = connection.newBulkLoad table.path, done

					for col in table.columns
						bulk.addColumn col.name, getTediousType(col.type), {nullable: col.nullable, length: col.length, scale: col.scale, precision: col.precision}
					
					for row in table.rows
						bulk.addRow row
					
					if @verbose then @_log "---------- response -----------"
					
					if table.create
						if table.temporary
							objectid = "tempdb..[#{table.name}]"
						else
							objectid = table.path
						
						req = new tds.Request "if object_id('#{objectid.replace(/'/g, '\'\'')}') is null #{table.declare()}", (err) =>
							if err then return done err
							
							connection.execBulkLoad bulk
						
						connection.execSqlBatch req
							
					else
						connection.execBulkLoad bulk

		###
		Execute specified sql command.
		###

		query: (command, callback) ->
			columns = {}
			recordset = []
			recordsets = []
			started = Date.now()
			errors = []
			batchLastRow = null
			batchHasOutput = false
			isJSONRecordset = false
			jsonBuffer = null
			hasReturned = false
			errorHandlers = {}
			handleError = (doReturn, connection, info) =>
				err = new Error info.message
				err.info = info
				e = RequestError err, 'EREQUEST'
				
				if @stream
					@emit 'error', e
				else
					if (doReturn && !hasReturned)
						if connection?
							for event, handler of errorHandlers
								connection.removeListener event, handler
							@_release connection
						hasReturned = true
						callback?(e)

				# we must collect errors even in stream mode
				errors.push e
			
			@_acquire (err, connection) =>
				unless err
					if @verbose then @_log "---------- sql #{if @_isBatch then 'batch' else 'query'} ----------\n    #{if @_isBatch then 'batch' else 'query'}: #{command}"

					if @canceled
						if @verbose then @_log "---------- canceling ----------"
						@_release connection
						return callback? new RequestError "Canceled.", 'ECANCEL'
					
					@_cancel = =>
						if @verbose then @_log "---------- canceling ----------"
						connection.cancel()
					
					# attach handler to handle multiple error messages
					errorHandlers['errorMessage'] = handleError.bind(undefined, false, connection)
					errorHandlers['error']        = handleError.bind(undefined, true, connection)
					connection.on 'errorMessage', errorHandlers['errorMessage']
					connection.on 'error',        errorHandlers['error']
					
					req = new tds.Request command, (err) =>
						# to make sure we handle no-sql errors as well
						if err and err.message isnt errors[errors.length - 1]?.message
							err = RequestError err, 'EREQUEST'
							
							if @stream
								@emit 'error', err
							
							errors.push err
						
						# process batch outputs
						if batchHasOutput
							unless @stream
								batchLastRow = recordsets.pop()[0]
							
							for name, value of batchLastRow when name isnt '___return___'
								if @verbose
									if value is tds.TYPES.Null
										@_log "   output: @#{name}, null"
									else
										@_log "   output: @#{name}, #{@parameters[name].type.declaration.toLowerCase()}, #{value}"
								
								@parameters[name].value = if value is tds.TYPES.Null then null else value
						
						if @verbose 
							if errors.length
								@_log "    error: #{error}" for error in errors
							
							elapsed = Date.now() - started
							@_log " duration: #{elapsed}ms"
							@_log "---------- completed ----------"

						@_cancel = null
						
						if errors.length and not @stream
							error = errors.pop()
							error.precedingErrors = errors
						
						if (!hasReturned)
							for event, handler of errorHandlers
								connection.removeListener event, handler
							@_release connection
							hasReturned = true

							if @stream
								callback null, null
							
							else
								callback? error, if @multiple then recordsets else recordsets[0]
					
					req.on 'columnMetadata', (metadata) =>
						columns = createColumns metadata
						
						isJSONRecordset = false
						if @connection.config.parseJSON is true and metadata.length is 1 and metadata[0].colName is JSON_COLUMN_ID
							isJSONRecordset = true
							jsonBuffer = []
						
						if @stream
							if @_isBatch
								# don't stream recordset with output values in batches
								unless columns["___return___"]?
									@emit 'recordset', columns
							
							else
								@emit 'recordset', columns

					doneHandler = (rowCount, more, rows) =>
						# this function is called even when select only set variables so we should skip adding a new recordset
						if Object.keys(columns).length is 0 then return
						
						if isJSONRecordset
							try
								parsedJSON = JSON.parse jsonBuffer.join ''
							catch ex
								parsedJSON = null
								ex = RequestError new Error("Failed to parse incoming JSON. #{ex.message}"), 'EJSON'
								
								if @stream
									@emit 'error', ex
								
								# we must collect errors even in stream mode
								errors.push ex
							
							jsonBuffer = null
							
							if @verbose
								@_log util.inspect parsedJSON
								@_log "---------- --------------------"
							
							if @stream
								@emit 'row', parsedJSON
								
							else
								recordset.push parsedJSON

						unless @stream
							# all rows of current recordset loaded
							Object.defineProperty recordset, 'columns', 
								enumerable: false
								value: columns
								
							Object.defineProperty recordset, 'toTable', 
								enumerable: false
								value: -> Table.fromRecordset @
								
							recordsets.push recordset
							
						recordset = []
						columns = {}
					
					req.on 'doneInProc', doneHandler # doneInProc handlers are used in both queries and batches
					req.on 'done', doneHandler # done handlers are used in batches
					
					req.on 'returnValue', (parameterName, value, metadata) =>
						if @verbose
							if value is tds.TYPES.Null
								@_log "   output: @#{parameterName}, null"
							else
								@_log "   output: @#{parameterName}, #{@parameters[parameterName].type.declaration.toLowerCase()}, #{value}"
								
						@parameters[parameterName].value = if value is tds.TYPES.Null then null else value
					
					req.on 'row', (columns) =>
						unless recordset
							recordset = []
						
						if isJSONRecordset
							jsonBuffer.push columns[0].value
						
						else
							row = {}
							for col in columns
								col.value = valueCorrection col.value, col.metadata
								
								exi = row[col.metadata.colName]
								if exi?
									if exi instanceof Array
										exi.push col.value
										
									else
										row[col.metadata.colName] = [exi, col.value]
								
								else
									row[col.metadata.colName] = col.value
						
							if @verbose
								@_log util.inspect(row)
								@_log "---------- --------------------"
							
							if @stream
								if @_isBatch
									# dont stream recordset with output values in batches
									if row["___return___"]?
										batchLastRow = row
									
									else
										@emit 'row', row
								
								else
									@emit 'row', row
								
							else
								recordset.push row
					
					if @_isBatch
						if Object.keys(@parameters).length
							for name, param of @parameters
								value = getTediousType(param.type).validate param.value
								if value instanceof TypeError
									value = new RequestError "Validation failed for parameter \'#{name}\'. #{value.message}", 'EPARAM'
									
									if @verbose
										@_log "    error: #{value}"
										@_log "---------- completed ----------"
										
									@_release connection
									return callback? value
									
								param.value = value
							
							declarations = ("@#{name} #{declare(param.type, param)}" for name, param of @parameters)
							assigns = ("@#{name} = #{cast(param.value, param.type, param)}" for name, param of @parameters)
							selects = ("@#{name} as [#{name}]" for name, param of @parameters when param.io is 2)
							batchHasOutput = selects.length > 0
							
							req.sqlTextOrProcedure = "declare #{declarations.join(', ')};select #{assigns.join(', ')};#{req.sqlTextOrProcedure};#{if batchHasOutput then ('select 1 as [___return___], '+ selects.join(', ')) else ''}"
					
					else
						for name, param of @parameters
							if @verbose
								if param.value is tds.TYPES.Null
									@_log "   #{if param.io is 1 then " input" else "output"}: @#{param.name}, null"
								else
									@_log "   #{if param.io is 1 then " input" else "output"}: @#{param.name}, #{param.type.declaration.toLowerCase()}, #{param.value}"
							
							if param.io is 1
								req.addParameter param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision}
							else
								req.addOutputParameter param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision}
					
					if @verbose then @_log "---------- response -----------"
					connection[if @_isBatch then 'execSqlBatch' else 'execSql'] req
				
				else
					if connection then @_release connection
					callback? err
					
		###
		Execute stored procedure with specified parameters.
		###
		
		execute: (procedure, callback) ->
			columns = {}
			recordset = []
			recordsets = []
			returnValue = 0
			started = Date.now()
			errors = []
			isJSONRecordset = false
			jsonBuffer = null
			hasReturned = false
			errorHandlers = {}
			handleError = (doReturn, connection, info) =>
				err = new Error info.message
				err.info = info
				e = RequestError err, 'EREQUEST'
				
				if @stream
					@emit 'error', e
				else
					if (doReturn && !hasReturned)
						if connection?
							for event, handler of errorHandlers
								connection.removeListener event, handler
							@_release connection
						hasReturned = true
						callback?(e)
					
				# we must collect errors even in stream mode
				errors.push e

			@_acquire (err, connection) =>
				unless err
					if @verbose then @_log "---------- sql execute --------\n     proc: #{procedure}"
					
					if @canceled
						if @verbose then @_log "---------- canceling ----------"
						@_release connection
						return callback? new RequestError "Canceled.", 'ECANCEL'
					
					@_cancel = =>
						if @verbose then @_log "---------- canceling ----------"
						connection.cancel()
					
					# attach handler to handle multiple error messages
					errorHandlers['errorMessage'] = handleError.bind(undefined, false, connection)
					errorHandlers['error']        = handleError.bind(undefined, true, connection)
					connection.on 'errorMessage', errorHandlers['errorMessage']
					connection.on 'error',        errorHandlers['error']

					
					req = new tds.Request procedure, (err) =>
						# to make sure we handle no-sql errors as well
						if err and err.message isnt errors[errors.length - 1]?.message
							err = RequestError err, 'EREQUEST'
							
							if @stream
								@emit 'error', err
							
							errors.push err
						
						if @verbose 
							if errors.length
								@_log "    error: #{error}" for error in errors
							
							elapsed = Date.now() - started
							@_log "   return: #{returnValue}"
							@_log " duration: #{elapsed}ms"
							@_log "---------- completed ----------"
						
						@_cancel = null
						
						if errors.length and not @stream
							error = errors.pop()
							error.precedingErrors = errors
						
						if (!hasReturned)
							for event, handler of errorHandlers
								connection.removeListener event, handler
							@_release connection

							hasReturned = true

							if @stream
								callback null, null, returnValue
							else
								recordsets.returnValue = returnValue
								callback? error, recordsets, returnValue
					
					req.on 'columnMetadata', (metadata) =>
						columns = createColumns metadata
						
						isJSONRecordset = false
						if @connection.config.parseJSON is true and metadata.length is 1 and metadata[0].colName is JSON_COLUMN_ID
							isJSONRecordset = true
							jsonBuffer = []
						
						if @stream
							@emit 'recordset', columns
					
					req.on 'row', (columns) =>
						unless recordset
							recordset = []
						
						if isJSONRecordset
							jsonBuffer.push columns[0].value
						
						else
							row = {}
							for col in columns
								col.value = valueCorrection col.value, col.metadata
								
								exi = row[col.metadata.colName]
								if exi?
									if exi instanceof Array
										exi.push col.value
										
									else
										row[col.metadata.colName] = [exi, col.value]
								
								else
									row[col.metadata.colName] = col.value
						
							if @verbose
								@_log util.inspect(row)
								@_log "---------- --------------------"
							
							if @stream
								@emit 'row', row
							
							else
								recordset.push row
					
					req.on 'doneInProc', (rowCount, more, rows) =>
						# filter empty recordsets when NOCOUNT is OFF
						if Object.keys(columns).length is 0 then return
						
						if isJSONRecordset
							try
								parsedJSON = JSON.parse jsonBuffer.join ''
							catch ex
								parsedJSON = null
								ex = RequestError new Error("Failed to parse incoming JSON. #{ex.message}"), 'EJSON'
								
								if @stream
									@emit 'error', ex
								
								# we must collect errors even in stream mode
								errors.push ex
							
							jsonBuffer = null
							
							if @verbose
								@_log util.inspect parsedJSON
								@_log "---------- --------------------"
							
							if @stream
								@emit 'row', parsedJSON
								
							else
								recordset.push parsedJSON
						
						unless @stream
							# all rows of current recordset loaded
							Object.defineProperty recordset, 'columns', 
								enumerable: false
								value: columns
								
							Object.defineProperty recordset, 'toTable', 
								enumerable: false
								value: -> Table.fromRecordset @
							
							recordsets.push recordset
							
						recordset = []
						columns = {}
					
					req.on 'doneProc', (rowCount, more, returnStatus, rows) =>
						returnValue = returnStatus
					
					req.on 'returnValue', (parameterName, value, metadata) =>
						if @verbose
							if value is tds.TYPES.Null
								@_log "   output: @#{parameterName}, null"
							else
								@_log "   output: @#{parameterName}, #{@parameters[parameterName].type.declaration.toLowerCase()}, #{value}"
								
						@parameters[parameterName].value = if value is tds.TYPES.Null then null else value
					
					for name, param of @parameters
						if @verbose
							if param.value is tds.TYPES.Null
								@_log "   #{if param.io is 1 then " input" else "output"}: @#{param.name}, null"
							else
								@_log "   #{if param.io is 1 then " input" else "output"}: @#{param.name}, #{param.type.declaration.toLowerCase()}, #{param.value}"
						
						if param.io is 1
							req.addParameter param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision}
						else
							req.addOutputParameter param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision}

					if @verbose then @_log "---------- response -----------"
					connection.callProcedure req
				
				else
					if connection then @_release connection
					callback? err
				
		###
		Cancel currently executed request.
		###
		
		cancel: ->
			if @_cancel then return @_cancel()
			true
		
	return {
		Connection: TediousConnection
		Transaction: TediousTransaction
		Request: TediousRequest
		fix: -> # there is nothing to fix in this driver
	}

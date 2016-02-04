{Pool} = require 'generic-pool'
tds = require 'tds'
util = require 'util'

FIXED = false
{TYPES, declare} = require('./datatypes')
ISOLATION_LEVEL = require('./isolationlevel')

###
@ignore
###

castParameter = (value, type) ->
	unless value? then return null
	
	switch type
		when TYPES.VarChar, TYPES.NVarChar, TYPES.Char, TYPES.NChar, TYPES.Xml, TYPES.Text, TYPES.NText
			if typeof value isnt 'string' and value not instanceof String
				value = value.toString()
		
		when TYPES.Int, TYPES.TinyInt, TYPES.BigInt, TYPES.SmallInt
			if typeof value isnt 'number' and value not instanceof Number
				value = parseInt(value)
				if isNaN(value) then value = null
				
		when TYPES.Float, TYPES.Real, TYPES.Decimal, TYPES.Numeric, TYPES.SmallMoney, TYPES.Money
			if typeof value isnt 'number' and value not instanceof Number
				value = parseFloat(value)
				if isNaN(value) then value = null
		
		when TYPES.Bit
			if typeof value isnt 'boolean' and value not instanceof Boolean
				value = Boolean(value)
		
		when TYPES.DateTime, TYPES.SmallDateTime, TYPES.DateTimeOffset, TYPES.Date
			if value not instanceof Date
				value = new Date(value)
		
		when TYPES.Binary, TYPES.VarBinary, TYPES.Image
			if value not instanceof Buffer
				value = new Buffer(value.toString())
			
	value

###
@ignore
###

createParameterHeader = (param) ->
	header = 
		type: param.type.declaration
		
	switch param.type
		when TYPES.VarChar, TYPES.NVarChar, TYPES.VarBinary
			header.size = "MAX"
			
		when TYPES.Char, TYPES.NChar, TYPES.Binary
			header.size = param.length ? param.value?.length ? 1
	
	header
	
###
@ignore
###

createColumns = (metadata) ->
	out = {}
	for column, index in metadata
		out[column.name] =
			index: index
			name: column.name
			length: column.length
			type: TYPES[column.type.sqlType]
	
	out

###
@ignore
###

isolationLevelDeclaration = (type) ->
	switch type
		when ISOLATION_LEVEL.READ_UNCOMMITTED then return "READ UNCOMMITTED"
		when ISOLATION_LEVEL.READ_COMMITTED then return "READ COMMITTED"
		when ISOLATION_LEVEL.REPEATABLE_READ then return "REPEATABLE READ"
		when ISOLATION_LEVEL.SERIALIZABLE then return "SERIALIZABLE"
		when ISOLATION_LEVEL.SNAPSHOT then return "SNAPSHOT"
		else throw new TransactionError "Invalid isolation level."

###
Taken from Tedious.

@private
###

formatHex = (number) ->
	hex = number.toString(16)
	if hex.length == 1
		hex = '0' + hex
		
	hex

###
Taken from Tedious.

@private
###

parseGuid = (buffer) ->
	guid = formatHex(buffer[3]) +
		formatHex(buffer[2]) +
		formatHex(buffer[1]) +
		formatHex(buffer[0]) +
		'-' +
		formatHex(buffer[5]) +
		formatHex(buffer[4]) +
		'-' +
		formatHex(buffer[7]) +
		formatHex(buffer[6]) +
		'-' +
		formatHex(buffer[8]) +
		formatHex(buffer[9]) +
		'-' +
		formatHex(buffer[10]) +
		formatHex(buffer[11]) +
		formatHex(buffer[12]) +
		formatHex(buffer[13]) +
		formatHex(buffer[14]) +
		formatHex(buffer[15])
	
	guid.toUpperCase()

###
@ignore
###

module.exports = (Connection, Transaction, Request, ConnectionError, TransactionError, RequestError) ->
	class TDSConnection extends Connection
		pool: null
		
		connect: (config, callback) ->
			cfg =
				userName: config.user
				password: config.password
				host: config.server
				port: config.port
				database: config.database
			
			cfg_pool =
				name: 'mssql'
				max: 10
				min: 0
				idleTimeoutMillis: 30000
				create: (callback) =>
					c = new tds.Connection cfg
					
					c.on 'error', (err) =>
						if err.code is 'ECONNRESET'
							c.hasError = true
							return

						@emit 'error', err
					
					timeouted = false
					tmr = setTimeout ->
						timeouted = true
						c._client._socket.destroy()
						callback new ConnectionError("Connection timeout.", 'ETIMEOUT'), null # there must be a second argument null
						
					, config.timeout ? 15000

					c.connect (err) =>
						clearTimeout tmr
						if timeouted then return
						
						if err then err = ConnectionError err
						if err then return callback err, null # there must be a second argument null
						callback null, c
				
				validate: (c) ->
					c? and not c.hasError
				
				destroy: (c) ->
					c?.end()
			
			if config.pool
				for key, value of config.pool
					cfg_pool[key] = value

			@pool = Pool cfg_pool, cfg
			
			#create one testing connection to check if everything is ok
			@pool.acquire (err, connection) =>
				if err and err not instanceof Error then err = new Error err
				
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
	
	class TDSTransaction extends Transaction
		begin: (callback) ->
			@connection.pool.acquire (err, connection) =>
				if err then return callback err
				
				@_pooledConnection = connection
				@request().query "set transaction isolation level #{isolationLevelDeclaration(@isolationLevel)}", (err) =>
					if err then return TransactionError err
					
					connection.setAutoCommit false, callback
			
		commit: (callback) ->
			@_pooledConnection.commit (err) =>
				if err then err = TransactionError err
				
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				callback err

		rollback: (callback) ->
			@_pooledConnection.rollback (err) =>
				if err then err = TransactionError err
				
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				callback err
			
	class TDSRequest extends Request
		batch: (batch, callback) ->
			TDSRequest::query.call @, batch, callback
			
		bulk: (table, callback) ->
			process.nextTick -> callback RequestError("Bulk insert is not supported in 'msnodesql' driver.", 'ENOTSUPP')

		query: (command, callback) ->
			if @verbose and not @nested then @_log "---------- sql query ----------\n    query: #{command}"
			
			if command.length is 0
				return process.nextTick ->
					if @verbose and not @nested
						@_log "---------- response -----------"
						elapsed = Date.now() - started
						@_log " duration: #{elapsed}ms"
						@_log "---------- completed ----------"
		
					callback? null, if @multiple or @nested then [] else null

			recordset = null
			recordsets = []
			started = Date.now()
			handleOutput = false
			errors = []
			lastrow = null

			paramHeaders = {}
			paramValues = {}
			for name, param of @parameters when param.io is 1
				paramHeaders[name] = createParameterHeader param
				paramValues[name] = castParameter(param.value, param.type)
			
			# nested = function is called by this.execute
			
			unless @nested
				input = ("@#{param.name} #{declare(param.type, param)}" for name, param of @parameters when param.io is 2)
				output = ("@#{param.name} as '#{param.name}'" for name, param of @parameters when param.io is 2)
				if input.length then command = "declare #{input.join ','};#{command};"
				if output.length
					command += "select #{output.join ','};"
					handleOutput = true
			
			@_acquire (err, connection) =>
				unless err
					if @canceled
						if @verbose then @_log "---------- canceling ----------"
						@_release connection
						return callback? new RequestError "Canceled.", 'ECANCEL'
					
					@_cancel = =>
						if @verbose then @_log "---------- canceling ----------"
						req.cancel()
						
					req = connection.createStatement command, paramHeaders
					
					req.on 'row', (tdsrow) =>
						row = {}
						for col in tdsrow.metadata.columns
							value = tdsrow.getValue col.name
							
							if value?
								# convert uniqueidentifier to string
								if col.type.name is 'GUIDTYPE'
									value = parseGuid value
							
							exi = row[col.name]
							if exi?
								if exi instanceof Array
									exi.push col.value
									
								else
									row[col.name] = [exi, value]
							
							else
								row[col.name] = value

						if @verbose
							@_log util.inspect(row)
							@_log "---------- --------------------"
						
						unless row["___return___"]?
							# row with ___return___ col is the last row
							if @stream then @emit 'row', row
						else
							lastrow = row
						
						unless @stream
							recordset.push row
					
					req.on 'metadata', (metadata) =>
						recordset = []
						
						Object.defineProperty recordset, 'columns', 
							enumerable: false
							value: createColumns(metadata.columns)
							@nested
						
						if @stream
							unless recordset.columns["___return___"]?
								# row with ___return___ col is the last row
								@emit 'recordset', recordset.columns
						
						else
							recordsets.push recordset
					
					req.on 'done', (res) =>
						if @canceled
							e = new RequestError "Canceled.", 'ECANCEL'
							
							if @stream
								@emit 'error', e
							else
								errors.push e

						unless @nested
							# do we have output parameters to handle?
							if handleOutput
								last = recordsets.pop()?[0]
		
								for name, param of @parameters when param.io is 2
									param.value = last[param.name]
				
									if @verbose
										@_log "   output: @#{param.name}, #{param.type.declaration}, #{param.value}"
						
							if @verbose
								if errors.length
									@_log "    error: #{error}" for error in errors
									
								elapsed = Date.now() - started
								@_log " duration: #{elapsed}ms"
								@_log "---------- completed ----------"
						
						if errors.length and not @stream
							error = errors.pop()
							error.precedingErrors = errors
		
						@_release connection
						
						if @stream
							callback null, if @nested then lastrow else null
							
						else
							callback? error, if @multiple or @nested then recordsets else recordsets[0]
					
					req.on 'error', (err) =>
						e = RequestError err, 'EREQUEST'
						
						if @stream
							@emit 'error', e
						else
							errors.push e
		
					req.execute paramValues
				
				else
					if connection then @_release connection
					callback? err

		execute: (procedure, callback) ->
			if @verbose then @_log "---------- sql execute --------\n     proc: #{procedure}"
	
			started = Date.now()
			
			cmd = "declare #{['@___return___ int'].concat("@#{param.name} #{declare(param.type, param)}" for name, param of @parameters when param.io is 2).join ', '};"
			cmd += "exec @___return___ = #{procedure} "
			
			spp = []
			for name, param of @parameters
				if @verbose
					@_log "   #{if param.io is 1 then " input" else "output"}: @#{param.name}, #{param.type.declaration}, #{param.value}"
						
				if param.io is 2
					# output parameter
					spp.push "@#{param.name}=@#{param.name} output"
				else	
					# input parameter
					spp.push "@#{param.name}=@#{param.name}"
			
			cmd += "#{spp.join ', '};"
			cmd += "select #{['@___return___ as \'___return___\''].concat("@#{param.name} as '#{param.name}'" for name, param of @parameters when param.io is 2).join ', '};"
			
			if @verbose then @_log "---------- response -----------"
			
			@nested = true
			
			# direct call to query, in case method on main request object is overriden (e.g. co-mssql)
			TDSRequest::query.call @, cmd, (err, recordsets) =>
				@nested = false
				
				if err
					if @verbose
						elapsed = Date.now() - started
						@_log "    error: #{err}"
						@_log " duration: #{elapsed}ms"
						@_log "---------- completed ----------"
					
					callback? err
				
				else
					if @stream
						last = recordsets
					else
						last = recordsets.pop()?[0]
					
					if last and last.___return___?
						returnValue = last.___return___
						
						for name, param of @parameters when param.io is 2
							param.value = last[param.name]
		
							if @verbose
								@_log "   output: @#{param.name}, #{param.type.declaration}, #{param.value}"
		
					if @verbose
						elapsed = Date.now() - started
						@_log "   return: #{returnValue}"
						@_log " duration: #{elapsed}ms"
						@_log "---------- completed ----------"
					
					if @stream
						callback null, null, returnValue
					
					else
						recordsets.returnValue = returnValue
						callback? null, recordsets, returnValue
					
		###
		Cancel currently executed request.
		###
		
		cancel: ->
			if @_cancel then return @_cancel()
			true
		
	return {
		Connection: TDSConnection
		Transaction: TDSTransaction
		Request: TDSRequest
		fix: ->
			unless FIXED
				require './tds-fix'
				FIXED = true
	}

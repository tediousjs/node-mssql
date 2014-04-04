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

createColumns = (meta) ->
	out = {}
	for key, value of meta
		out[key] =
			name: value.name
			length: value.length
			type: TYPES[value.type.sqlType]
	
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
					
					timeouted = false
					tmr = setTimeout ->
						timeouted = true
						c._client._socket.destroy()
						callback new ConnectionError "Connection timeout.", null # there must be a second argument null
						
					, config.timeout ? 15000

					c.connect (err) =>
						clearTimeout tmr
						if timeouted then return
						
						if err then err = ConnectionError err
						if err then return callback err, null # there must be a second argument null
						callback null, c
				
				validate: (c) ->
					c?
				
				destroy: (c) ->
					c?.end()
			
			if config.pool
				for key, value of config.pool
					cfg_pool[key] = value

			@pool = Pool cfg_pool, cfg
			
			#create one testing connection to check if everything is ok
			@pool.acquire (err, connection) =>
				if err and err not instanceof Error then err = new Error err
				
				# and release it immediately
				@pool.release connection
				callback err

		close: (callback) ->
			unless @pool then return callback null
			
			@pool.drain =>
				@pool.destroyAllNow()
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
		query: (command, callback) ->
			if @verbose and not @nested then console.log "---------- sql query ----------\n    query: #{command}"
			
			if command.length is 0
				return process.nextTick ->
					if @verbose and not @nested
						console.log "---------- response -----------"
						elapsed = Date.now() - started
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
		
					callback? null, if @multiple or @nested then [] else null
			
			columns = null
			recordset = null
			recordsets = []
			started = Date.now()
			handleOutput = false
			error = null

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
							console.log util.inspect(row)
							console.log "---------- --------------------"
						
						unless row["___return___"]?
							# row with ___return___ col is the last row
							@emit 'row', row
						
						recordset.push row
					
					req.on 'metadata', (metadata) =>
						if recordset
							@emit 'recordset', recordset
							
						columns = metadata.columnsByName
						recordset = []
						
						Object.defineProperty recordset, 'columns', 
							enumerable: false
							value: createColumns(metadata.columnsByName)
							@nested

						recordsets.push recordset
					
					req.on 'done', (res) =>
						unless @nested
							# if nested queries, last recordset is full of return values
							if recordset
								@emit 'recordset', recordset
							
							# do we have output parameters to handle?
							if handleOutput
								last = recordsets.pop()?[0]
		
								for name, param of @parameters when param.io is 2
									param.value = last[param.name]
				
									if @verbose
										console.log "   output: @#{param.name}, #{param.type.declaration}, #{param.value}"
						
							if @verbose
								if error then console.log "    error: #{error}"
								elapsed = Date.now() - started
								console.log " duration: #{elapsed}ms"
								console.log "---------- completed ----------"
		
						@_release connection
						callback? error, if @multiple or @nested then recordsets else recordsets[0]
					
					req.on 'error', (err) ->
						error = RequestError err
		
					req.execute paramValues
				
				else
					if connection then @_release connection
					callback? err

		execute: (procedure, callback) ->
			if @verbose then console.log "---------- sql execute --------\n     proc: #{procedure}"
	
			started = Date.now()
			
			cmd = "declare #{['@___return___ int'].concat("@#{param.name} #{declare(param.type, param)}" for name, param of @parameters when param.io is 2).join ', '};"
			cmd += "exec @___return___ = #{procedure} "
			
			spp = []
			for name, param of @parameters
				if @verbose
					console.log "   #{if param.io is 1 then " input" else "output"}: @#{param.name}, #{param.type.declaration}, #{param.value}"
						
				if param.io is 2
					# output parameter
					spp.push "@#{param.name}=@#{param.name} output"
				else	
					# input parameter
					spp.push "@#{param.name}=@#{param.name}"
			
			cmd += "#{spp.join ', '};"
			cmd += "select #{['@___return___ as \'___return___\''].concat("@#{param.name} as '#{param.name}'" for name, param of @parameters when param.io is 2).join ', '};"
			
			if @verbose then console.log "---------- response -----------"
			
			@nested = true
			
			# direct call to query, in case method on main request object is overriden (e.g. co-mssql)
			TDSRequest::query.call @, cmd, (err, recordsets) =>
				@nested = false
				
				if err
					if @verbose
						elapsed = Date.now() - started
						console.log "    error: #{err}"
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
					
					callback? err
				
				else
					last = recordsets.pop()?[0]
					if last and last.___return___?
						returnValue = last.___return___
						
						for name, param of @parameters when param.io is 2
							param.value = last[param.name]
		
							if @verbose
								console.log "   output: @#{param.name}, #{param.type.declaration}, #{param.value}"
		
					if @verbose
						elapsed = Date.now() - started
						console.log "   return: #{returnValue}"
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
					
					recordsets.returnValue = returnValue
					callback? null, recordsets, returnValue
					
		###
		Cancel currently executed request.
		###
		
		cancel: ->
			false # Request canceling is not implemented by TDS driver.
		
	return {
		Connection: TDSConnection
		Transaction: TDSTransaction
		Request: TDSRequest
		fix: ->
			unless FIXED
				require './tds-fix'
				FIXED = true
	}
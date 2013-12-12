{Pool} = require 'generic-pool'
tds = require 'tds'
util = require 'util'

TYPES = require('./datatypes').TYPES

###
@ignore
###

castParameter = (value, type) ->
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

createColumns = (meta) ->
	out = {}
	for key, value of meta
		out[key] =
			name: value.name
			size: value.length
			type: TYPES[value.type.sqlType]
	
	out

###
@ignore
###

typeDeclaration = (type) ->
	switch type
		when TYPES.VarChar, TYPES.NVarChar, TYPES.Char, TYPES.NChar, TYPES.Xml, TYPES.Text, TYPES.NText
			return "#{type.name} (MAX)"
		else
			return type.name

###
@ignore
###

module.exports = (Connection, Transaction, Request) ->
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
					c.connect (err) =>
						if err then return callback err, null # there must be a second argument null
						callback null, c
				
				destroy: (c) ->
					c.end()
			
			if config.pool
				for key, value of config.pool
					cfg_pool[key] = value

			@pool = Pool cfg_pool, cfg
			
			#create one testing connection to check if everything is ok
			@pool.acquire (err, connection) =>
				if err and err not instanceof Error then err = new Error err
				
				# and release it immediately
				@pool.release connection
				callback? err

		close: (callback) ->
			@pool?.drain =>
				@pool.destroyAllNow()
				@pool = null
				callback? null
	
	class TDSTransaction extends Transaction
		begin: (callback) ->
			@connection.pool.acquire (err, connection) =>
				if err then return callback err
				
				@_pooledConnection = connection
				connection.setAutoCommit false, callback
			
		commit: (callback) ->
			@_pooledConnection.commit (err) =>
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				callback err

		rollback: (callback) ->
			@_pooledConnection.rollback (err) =>
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				callback err
			
	class TDSRequest extends Request
		connection: null # ref to connection
		
		_acquire: (callback) ->
			if @transaction
				@transaction.queue callback
			else
				@connection.pool.acquire callback
		
		_release: (connection) ->
			if @transaction
				@transaction.next()
			else
				@connection.pool.release connection
		
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
				paramHeaders[name] = type: param.type.name
				paramValues[name] = castParameter(param.value, param.type)
			
			# nested = function is called by this.execute
			
			unless @nested
				input = ("@#{param.name} #{typeDeclaration(param.type)}" for name, param of @parameters when param.io is 2)
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
							exi = row[col.name]
							if exi?
								if exi instanceof Array
									exi.push col.value
									
								else
									row[col.name] = [exi, tdsrow.getValue(col.name)]
							
							else
								row[col.name] = tdsrow.getValue col.name
		
						if @verbose
							console.log util.inspect(row)
							console.log "---------- --------------------"
						
						recordset.push row
					
					req.on 'metadata', (metadata) =>
						row = null
						columns = metadata.columnsByName
						recordset = []
						Object.defineProperty recordset, 'columns', 
							enumerable: false
							value: createColumns(metadata.columnsByName)
							@nested
						recordsets.push recordset
					
					req.on 'done', (res) =>
						unless @nested
							# do we have output parameters to handle?
							if handleOutput
								last = recordsets.pop()?[0]
		
								for name, param of @parameters when param.io is 2
									param.value = last[param.name]
				
									if @verbose
										console.log "   output: @#{param.name}, #{param.type.name}, #{param.value}"
						
							if @verbose
								if error then console.log "    error: #{error}"
								elapsed = Date.now() - started
								console.log " duration: #{elapsed}ms"
								console.log "---------- completed ----------"
		
						@_release connection
						callback? error, if @multiple or @nested then recordsets else recordsets[0]
					
					req.on 'error', (err) ->
						error = err	
		
					req.execute paramValues
				
				else
					if connection then @_release connection
					callback? err

		execute: (procedure, callback) ->
			if @verbose then console.log "---------- sql execute --------\n     proc: #{procedure}"
	
			started = Date.now()
			
			cmd = "declare #{['@__return int'].concat("@#{param.name} #{typeDeclaration(param.type)}" for name, param of @parameters when param.io is 2).join ', '};"
			cmd += "exec @__return = #{procedure} "
			
			spp = []
			for name, param of @parameters
				if param.io is 2
					# output parameter
					spp.push "@#{param.name}=@#{param.name} output"
				else
					if @verbose
						console.log "    input: @#{param.name}, #{param.type.name}, #{param.value}"
							
					# input parameter
					spp.push "@#{param.name}=@#{param.name}"
			
			cmd += "#{spp.join ', '};"
			cmd += "select #{['@__return as \'__return\''].concat("@#{param.name} as '#{param.name}'" for name, param of @parameters when param.io is 2).join ', '};"
			
			if @verbose then console.log "---------- response -----------"
			
			@nested = true
			@query cmd, (err, recordsets) =>
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
					if last and last.__return?
						returnValue = last.__return
						
						for name, param of @parameters when param.io is 2
							param.value = last[param.name]
		
							if @verbose
								console.log "   output: @#{param.name}, #{param.type.name}, #{param.value}"
		
					if @verbose
						elapsed = Date.now() - started
						console.log "   return: #{returnValue}"
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
					
					callback? null, recordsets, returnValue
		
		cancel: ->
			###
			Cancel currently executed request.
			###
			
			throw new Error "Request canceling is not implemented by TDS driver."
		
	return {connection: TDSConnection, transaction: TDSTransaction, request: TDSRequest}
msnodesql = require 'msnodesql'
util = require 'util'

TYPES = require('./datatypes').TYPES
DECLARATIONS = require('./datatypes').DECLARATIONS

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

createColumns = (meta) ->
	out = {}
	for value in meta
		out[value.name] =
			name: value.name
			size: value.size
			type: DECLARATIONS[value.sqlType]
			
	out

typeDeclaration = (type) ->
	switch type
		when TYPES.VarChar, TYPES.NVarChar, TYPES.Char, TYPES.NChar, TYPES.Xml, TYPES.Text, TYPES.NText
			return "#{type.name} (MAX)"
		else
			return type.name

module.exports = (Connection, Request) ->
	class MsnodesqlConnection extends Connection
		native: null # ref to native msnodesql connection
		
		connect: (config, callback) ->
			config.connectionString ?= 'Driver={SQL Server Native Client 11.0};Server=#{server},#{port};Database=#{database};Uid=#{user};Pwd=#{password};'
			
			connectionString = config.connectionString.replace new RegExp('#{([^}]*)}', 'g'), (p) ->
				config[p.substr(2, p.length - 3)] ? ''

			msnodesql.open connectionString, (err, conn) =>
				if err then return callback err
				@native = conn
				callback? null
			
		close: (callback) ->
			@native?.close()
			@native = null
			process.nextTick -> callback? null
	
	class MsnodesqlRequest extends Request
		connection: null # ref to connection

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
			
			row = null
			columns = null
			recordset = null
			recordsets = []
			started = Date.now()
			handleOutput = false
			
			# nested = function is called by this.execute
			
			unless @nested
				input = ("@#{param.name} #{typeDeclaration(param.type)}" for name, param of @parameters)
				sets = ("set @#{param.name}=?" for name, param of @parameters when param.io is 1)
				output = ("@#{param.name} as '#{param.name}'" for name, param of @parameters when param.io is 2)
				if input.length then command = "declare #{input.join ','};#{sets.join ';'};#{command};"
				if output.length
					command += "select #{output.join ','};"
					handleOutput = true

			req = @connection.native.queryRaw command, (castParameter(param.value, param.type) for name, param of @parameters when param.io is 1)
			if @verbose and not @nested then console.log "---------- response -----------"
			
			req.on 'meta', (metadata) =>
				if row and @verbose
					console.log util.inspect(row)
					console.log "---------- --------------------"
				
				row = null
				columns = metadata
				recordset = []
				Object.defineProperty recordset, 'columns', 
					enumerable: false
					value: createColumns(metadata)
					
				recordsets.push recordset
				
			req.on 'row', (rownumber) =>
				if row and @verbose
					console.log util.inspect(row)
					console.log "---------- --------------------"
				
				row = {}
				recordset.push row
				
			req.on 'column', (idx, data, more) =>
				exi = row[columns[idx].name]
				if exi?
					if exi instanceof Array
						exi.push data
						
					else
						row[columns[idx].name] = [exi, data]
				
				else
					row[columns[idx].name] = data
	
			req.once 'error', (err) =>
				if @verbose and not @nested
					elapsed = Date.now() - started
					console.log "    error: #{err}"
					console.log " duration: #{elapsed}ms"
					console.log "---------- completed ----------"
					
				callback? err
			
			req.once 'done', =>
				unless @nested
					if @verbose
						if row
							console.log util.inspect(row)
							console.log "---------- --------------------"

					# do we have output parameters to handle?
					if handleOutput
						last = recordsets.pop()?[0]

						for name, param of @parameters when param.io is 2
							param.value = last[param.name]
		
							if @verbose
								console.log "   output: @#{param.name}, #{param.type.name}, #{param.value}"
					
					if @verbose
						elapsed = Date.now() - started
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
	
				callback? null, if @multiple or @nested then recordsets else recordsets[0]
	
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
					spp.push "@#{param.name}=?"
			
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
	
	return {connection: MsnodesqlConnection, request: MsnodesqlRequest}
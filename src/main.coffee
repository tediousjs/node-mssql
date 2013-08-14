###
Data types: http://pekim.github.io/tedious/api-datatypes.html
###

tds = require 'tedious'
events = require 'events'
util = require 'util'

pool = null

map = []
map.register = (jstype, sqltype) ->
	for item, index in @ when item.js is jstype
		@splice index, 1
		break
		
	@push
		js: jstype
		sql: sqltype

map.register String, tds.TYPES.VarChar
map.register Number, tds.TYPES.Int
map.register Boolean, tds.TYPES.Bit
map.register Date, tds.TYPES.DateTime

# you can register your own mapped parameter by: sql.map.register <JS Type>, <SQL Type>

getTypeByValue = (value) ->
	unless value then return tds.TYPES.Bit
	
	switch typeof value
		when 'string' then return tds.TYPES.VarChar
		when 'number' then return tds.TYPES.BigInt
		when 'boolean' then return tds.TYPES.Bit
		when 'object'
			for item in map
				if value instanceof item.js
					return item.sql

			return tds.TYPES.VarChar
			
		else
			return tds.TYPES.VarChar

getNameOfType = (type) ->
	switch type
		when tds.TYPES.VarChar then return 'varchar'
		when tds.TYPES.NVarChar then return 'nvarchar'
		when tds.TYPES.Text then return 'text'
		when tds.TYPES.Int then return 'int'
		when tds.TYPES.SmallInt then return 'smallint'
		when tds.TYPES.TinyInt then return 'tinyint'
		when tds.TYPES.BigInt then return 'bigint'
		when tds.TYPES.Bit then return 'bit'
		when tds.TYPES.Float then return 'float'
		when tds.TYPES.Real then return 'real'
		when tds.TYPES.DateTime then return 'datetime'
		when tds.TYPES.SmallDateTime then return 'smalldatetime'
		when tds.TYPES.UniqueIdentifier then return 'uniqueidentifier'
		else 
			return 'unknown'

class Request
	parameters: null
	verbose: false
	
	constructor: ->
		@parameters = {}

	input: (name, type, value) ->
		###
		Append new input parameter to current request.
		
		Usage:
		request.append name, value
		request.append name, type, value
		###
		
		if arguments.length is 1
			throw new Error "Invalid number of arguments. At least 2 arguments expected."
			
		else if arguments.length is 2
			value = type
			type = getTypeByValue(value)
		
		unless type.writeParameterData
			throw new Error "Data type #{type.name} is not supported as procedure parameter. (parameter name: #{name})"

		# support for custom data types
		if value?.valueOf and value not instanceof Date then value = value.valueOf()
		
		# null to sql null
		if value is null or value is undefined then value = tds.TYPES.Null
		
		@parameters[name] =
			name: name
			type: type
			io: 1
			value: value
	
	output: (name, type) ->
		###
		Append new output parameter to current request.
		
		Usage:
		request.append name, type
		###
		
		unless type then type = tds.TYPES.VarChar
		
		@parameters[name] =
			name: name
			type: type
			io: 2
	
	query: (command, callback) ->
		###
		Execute specified sql command.
		###
		
		columns = {}
		recordset = null
		started = Date.now()
		
		unless pool
			callback new Error('MSSQL connection pool was not initialized!')
			return
		
		pool.requestConnection (err, connection) =>
			unless err
				if @verbose then console.log "---------- sql query ----------\n    query: #{command}"
				
				req = new tds.Request command, (err) =>
					if @verbose 
						elapsed = Date.now() - started
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
						
					if recordset
						Object.defineProperty recordset, 'columns', 
							enumerable: false
							value: columns
				
					connection.close()
					callback? err, recordset
				
				req.on 'columnMetadata', (metadata) =>
					for col in metadata
						columns[col.colName] = col
				
				req.on 'row', (columns) =>
					unless recordset
						recordset = []
						
					row = {}
					for col in columns
						row[col.metadata.colName] = col.value
					
					if @verbose
						console.log util.inspect(row)
						console.log "---------- --------------------"
					
					recordset.push row
				
				if @verbose then console.log "---------- response -----------"
				connection.execSql req
			
			else
				if connection then connection.close()
				callback? err
	
	execute: (procedure, callback) ->
		###
		Execute stored procedure with specified parameters.
		###
		
		columns = {}
		recordset = []
		recordsets = []
		returnValue = 0
		started = Date.now()
		
		unless pool
			callback new Error('MSSQL connection pool was not initialized!')
			return
		
		pool.requestConnection (err, connection) =>
			unless err
				if @verbose then console.log "---------- sql execute --------\n     proc: #{procedure}"
				
				req = new tds.Request procedure, (err) =>
					if @verbose 
						elapsed = Date.now() - started
						console.log "   return: #{returnValue}"
						console.log " duration: #{elapsed}ms"
						console.log "---------- completed ----------"
						
					connection.close()
					callback? err, recordsets, returnValue
				
				req.on 'columnMetadata', (metadata) =>
					for col in metadata
						columns[col.colName] = col
				
				req.on 'row', (columns) =>
					row = {}
					for col in columns
						row[col.metadata.colName] = col.value
					
					if @verbose
						console.log util.inspect(row)
						console.log "---------- --------------------"
						
					recordset.push row
				
				req.on 'doneInProc', (rowCount, more, rows) =>
					# all rows of current recordset loaded
					Object.defineProperty recordset, 'columns', 
						enumerable: false
						value: columns
					
					recordsets.push recordset
					recordset = []
					columns = {}
				
				req.on 'doneProc', (rowCount, more, returnStatus, rows) =>
					returnValue = returnStatus
				
				req.on 'returnValue', (parameterName, value, metadata) =>
					if @verbose
						if value is tds.TYPES.Null
							console.log "   output: @#{parameterName}, null"
						else
							console.log "   output: @#{parameterName}, #{getNameOfType(@parameters[parameterName].type)}, #{value}"
						
					@parameters[parameterName].value = value
				
				for name, param of @parameters when param.io is 1
					if @verbose
						if param.value is tds.TYPES.Null
							console.log "    input: @#{param.name}, null"
						else
							console.log "    input: @#{param.name}, #{getNameOfType(param.type)}, #{param.value}"
						
					req.addParameter param.name, param.type, param.value
					
				for name, param of @parameters when param.io is 2
					req.addOutputParameter param.name, param.type
				
				if @verbose then console.log "---------- response -----------"
				connection.callProcedure req
			
			else
				if connection then connection.close()
				callback? err

module.exports.pool =
	max: 10
	min: 0
	idleTimeoutMillis: 30000

module.exports.connection =
	userName: ''
	password: ''
	server: ''

module.exports.init = ->
	ConnectionPool = require 'tedious-connection-pool'
	pool = new ConnectionPool module.exports.pool, module.exports.connection

module.exports.Request = Request

module.exports.TYPES = tds.TYPES
module.exports.map = map

# Express datatypes

module.exports.VARCHAR = module.exports.VarChar = tds.TYPES.VarChar
module.exports.NVARCHAR = module.exports.NVarChar = tds.TYPES.NVarChar
module.exports.TEXT = module.exports.Text = tds.TYPES.Text
module.exports.INTEGER = module.exports.Integer = module.exports.INT = module.exports.Int = tds.TYPES.Int
module.exports.BIGINT = module.exports.BigInt = tds.TYPES.BigInt
module.exports.TINYINT = module.exports.TinyInt = tds.TYPES.TinyInt
module.exports.SMALLINT = module.exports.SmallInt = tds.TYPES.SmallInt
module.exports.BIT = module.exports.Bit = tds.TYPES.Bit
module.exports.FLOAT = module.exports.Float = tds.TYPES.Float
module.exports.REAL = module.exports.Real = tds.TYPES.Real
module.exports.DATETIME = module.exports.DateTime = tds.TYPES.DateTime
module.exports.SMALLDATETIME = module.exports.SmallDateTime = tds.TYPES.SmallDateTime
module.exports.UNIQUEIDENTIFIED = module.exports.UniqueIdentifier = tds.TYPES.UniqueIdentifier
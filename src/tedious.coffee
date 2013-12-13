{Pool} = require 'generic-pool'
tds = require 'tedious'
util = require 'util'

TYPES = require('./datatypes').TYPES

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
		when TYPES.Decimal then return tds.TYPES.Float
		when TYPES.Numeric then return tds.TYPES.Float
		when TYPES.Real then return tds.TYPES.Real
		when TYPES.Date then return tds.TYPES.DateTime
		when TYPES.DateTime then return tds.TYPES.DateTime
		when TYPES.DateTimeOffset then return tds.TYPES.DateTime
		when TYPES.SmallDateTime then return tds.TYPES.SmallDateTime
		when TYPES.UniqueIdentifier then return tds.TYPES.UniqueIdentifierN
		when TYPES.Xml then return tds.TYPES.VarChar
		when TYPES.Char then return tds.TYPES.VarChar
		when TYPES.NChar then return tds.TYPES.NVarChar
		when TYPES.NText then return tds.TYPES.NVarChar
		else return type

###
@ignore
###

getMssqlType = (type) ->
	switch type
		when tds.TYPES.Char then return TYPES.Char
		when tds.TYPES.NChar then return TYPES.NChar
		when tds.TYPES.VarChar then return TYPES.VarChar
		when tds.TYPES.NVarChar then return TYPES.NVarChar
		when tds.TYPES.Text then return TYPES.Text
		when tds.TYPES.NText then return TYPES.NText
		when tds.TYPES.Int, tds.TYPES.IntN then return TYPES.Int
		when tds.TYPES.BigInt then return TYPES.BigInt
		when tds.TYPES.TinyInt then return TYPES.TinyInt
		when tds.TYPES.SmallInt then return TYPES.SmallInt
		when tds.TYPES.Bit, tds.TYPES.BitN then return TYPES.Bit
		when tds.TYPES.Float, tds.TYPES.FloatN then return TYPES.Float
		when tds.TYPES.Real then return TYPES.Real
		when tds.TYPES.Money, tds.TYPES.MoneyN then return TYPES.Money
		when tds.TYPES.SmallMoney then return TYPES.SmallMoney
		when tds.TYPES.Numeric, tds.TYPES.NumericN then return TYPES.Numeric
		when tds.TYPES.Decimal, tds.TYPES.DecimalN then return TYPES.Decimal
		when tds.TYPES.DateTime, tds.TYPES.DateTimeN then return TYPES.DateTime
		when tds.TYPES.SmallDateTime then return TYPES.SmallDateTime
		when tds.TYPES.UniqueIdentifierN then return TYPES.UniqueIdentifier
		when tds.TYPES.Image then return TYPES.Image
		when tds.TYPES.Binary then return TYPES.Binary
		when tds.TYPES.VarBinary then return TYPES.VarBinary
		when tds.TYPES.Xml then return TYPES.Xml

###
@ignore
###

createColumns = (meta) ->
	out = {}
	for key, value of meta
		out[key] =
			name: value.colName
			size: value.dataLength
			type: getMssqlType(value.type)
	
	out

###
@ignore
###

module.exports = (Connection, Transaction, Request) ->
	class TediousConnection extends Connection
		pool: null
		
		connect: (config, callback) ->
			cfg =
				userName: config.user
				password: config.password
				server: config.server
				options: config.options
			
			cfg.options ?= {}
			cfg.options.database ?= config.database
			cfg.options.port ?= config.port
			
			cfg_pool =
				name: 'mssql'
				max: 10
				min: 0
				idleTimeoutMillis: 30000
				create: (callback) =>
					c = new tds.Connection cfg
					c.once 'connect', (err) =>
						if err then return callback err, null # there must be a second argument null
						callback null, c
				
				destroy: (c) ->
					c.close()
			
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
	
	class TediousTransaction extends Transaction
		begin: (callback) ->
			@connection.pool.acquire (err, connection) =>
				if err and err not instanceof Error then err = new Error err
				if err then return callback err
				
				@_pooledConnection = connection
				connection.beginTransaction callback
			
		commit: (callback) ->
			@_pooledConnection.commitTransaction (err) =>
				if err and err not instanceof Error then err = new Error err
				
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				callback err

		rollback: (callback) ->
			@_pooledConnection.rollbackTransaction (err) =>
				if err and err not instanceof Error then err = new Error err
				
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
				callback err
		
	class TediousRequest extends Request
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
		
		###
		Execute specified sql command.
		###

		query: (command, callback) ->
			
			columns = {}
			recordset = []
			recordsets = []
			started = Date.now()

			@_acquire (err, connection) =>
				unless err
					if @verbose then console.log "---------- sql query ----------\n    query: #{command}"
					
					req = new tds.Request command, (err) =>
						if err and err not instanceof Error then err = new Error err
						
						if @verbose 
							if err then console.log "    error: #{err}"
							elapsed = Date.now() - started
							console.log " duration: #{elapsed}ms"
							console.log "---------- completed ----------"

						if recordset
							Object.defineProperty recordset, 'columns', 
								enumerable: false
								value: columns
					
						@_release connection
						callback? err, if @multiple then recordsets else recordsets[0]
					
					req.on 'columnMetadata', (metadata) =>
						for col in metadata
							columns[col.colName] = col
					
					req.on 'doneInProc', (rowCount, more, rows) =>
						# this function is called even when select only set variables so we should skip adding a new recordset
						if Object.keys(columns).length is 0 then return
						
						# all rows of current recordset loaded
						Object.defineProperty recordset, 'columns', 
							enumerable: false
							value: createColumns(columns)
						
						recordsets.push recordset
						recordset = []
						columns = {}
					
					req.on 'returnValue', (parameterName, value, metadata) =>
						if @verbose
							if value is tds.TYPES.Null
								console.log "   output: @#{parameterName}, null"
							else
								console.log "   output: @#{parameterName}, #{@parameters[parameterName].type.name.toLowerCase()}, #{value}"
								
						@parameters[parameterName].value = if value is tds.TYPES.Null then null else value
					
					req.on 'row', (columns) =>
						unless recordset
							recordset = []
							
						row = {}
						for col in columns
							exi = row[col.metadata.colName]
							if exi?
								if exi instanceof Array
									exi.push col.value
									
								else
									row[col.metadata.colName] = [exi, col.value]
							
							else
								row[col.metadata.colName] = col.value
						
						if @verbose
							console.log util.inspect(row)
							console.log "---------- --------------------"
						
						recordset.push row
					
					for name, param of @parameters when param.io is 1
						if @verbose
							if param.value is tds.TYPES.Null
								console.log "    input: @#{param.name}, null"
							else
								console.log "    input: @#{param.name}, #{param.type.name.toLowerCase()}, #{param.value}"
						
						req.addParameter param.name, getTediousType(param.type), if param.value? then param.value else tds.TYPES.Null
					
					for name, param of @parameters when param.io is 2
						req.addOutputParameter param.name, getTediousType(param.type)
					
					if @verbose then console.log "---------- response -----------"
					connection.execSql req
				
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

			@_acquire (err, connection) =>
				unless err
					if @verbose then console.log "---------- sql execute --------\n     proc: #{procedure}"
					
					req = new tds.Request procedure, (err) =>
						if err and err not instanceof Error then err = new Error err
						
						if @verbose 
							if err then console.log "    error: #{err}"
							
							elapsed = Date.now() - started
							console.log "   return: #{returnValue}"
							console.log " duration: #{elapsed}ms"
							console.log "---------- completed ----------"
							
						@_release connection
						callback? err, recordsets, returnValue
					
					req.on 'columnMetadata', (metadata) =>
						for col in metadata
							columns[col.colName] = col
					
					req.on 'row', (columns) =>
						unless recordset
							recordset = []
							
						row = {}
						for col in columns
							exi = row[col.metadata.colName]
							if exi?
								if exi instanceof Array
									exi.push col.value
									
								else
									row[col.metadata.colName] = [exi, col.value]
							
							else
								row[col.metadata.colName] = col.value
						
						if @verbose
							console.log util.inspect(row)
							console.log "---------- --------------------"
							
						recordset.push row
					
					req.on 'doneInProc', (rowCount, more, rows) =>
						# filter empty recordsets when NOCOUNT is OFF
						if Object.keys(columns).length is 0 then return
						
						# all rows of current recordset loaded
						Object.defineProperty recordset, 'columns', 
							enumerable: false
							value: createColumns(columns)
						
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
								console.log "   output: @#{parameterName}, #{@parameters[parameterName].type.name.toLowerCase()}, #{value}"
								
						@parameters[parameterName].value = if value is tds.TYPES.Null then null else value
					
					for name, param of @parameters when param.io is 1
						if @verbose
							if param.value is tds.TYPES.Null
								console.log "    input: @#{param.name}, null"
							else
								console.log "    input: @#{param.name}, #{param.type.name.toLowerCase()}, #{param.value}"
						
						req.addParameter param.name, getTediousType(param.type), if param.value? then param.value else tds.TYPES.Null
						
					for name, param of @parameters when param.io is 2
						req.addOutputParameter param.name, getTediousType(param.type)
					
					if @verbose then console.log "---------- response -----------"
					connection.callProcedure req
				
				else
					if connection then @_release connection
					callback? err
				
		###
		Cancel currently executed request.
		###
		
		cancel: ->
			throw new Error "Request canceling is not implemented by Tedious driver."
		
	return {connection: TediousConnection, transaction: TediousTransaction, request: TediousRequest}
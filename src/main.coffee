events = require 'events'
util = require 'util'

TYPES = require('./datatypes').TYPES
Driver = null

connecting = false
connected = false

map = []
map.register = (jstype, sqltype) ->
	for item, index in @ when item.js is jstype
		@splice index, 1
		break
		
	@push
		js: jstype
		sql: sqltype

map.register String, TYPES.VarChar
map.register Number, TYPES.Int
map.register Boolean, TYPES.Bit
map.register Date, TYPES.DateTime

getTypeByValue = (value) ->
	if value is null or value is undefined then return TYPES.VarChar

	switch typeof value
		when 'string'
			for item in map when item.js is String
				return item.sql

			return TYPES.VarChar
			
		when 'number'
			for item in map when item.js is Number
				return item.sql

			return TYPES.Int
			
		when 'boolean'
			for item in map when item.js is Boolean
				return item.sql

			return TYPES.Bit
			
		when 'object'
			for item in map when value instanceof item.js
				return item.sql

			return TYPES.VarChar
			
		else
			return TYPES.VarChar

class Request
	parameters: null # array of sp parameters
	verbose: false # if true, execution is logged to console
	multiple: false # if true, query can obtain multiple recordsets
	
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
		
		# this should be enabled for tedious only
		#unless type.writeParameterData
		#	throw new Error "Data type #{type.name} is not supported as procedure parameter. (parameter name: #{name})"

		# support for custom data types
		if value?.valueOf and value not instanceof Date then value = value.valueOf()
		
		# undefined to null
		if value is undefined then value = null
		
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
		
		Driver::query.call @, command, callback
	
	execute: (procedure, callback) ->
		###
		Execute stored procedure with specified parameters.
		###
		
		Driver::execute.call @, procedure, callback

# public things

module.exports.connect = (config, callback) ->
	if connected
		err = new Error "Database is already connected! Call close before connecting to different database."
		
		if callback
			callback err
		else
			throw err
	
	if connecting
		err = new Error "Already connecting to database! Call close before connecting to different database."
		
		if callback
			callback err
		else
			throw err
	
	connecting = true
	
	# set defaults
	config.driver ?= 'tedious'
	config.port ?= 1433

	if config.driver is 'tedious'
		Driver = require('./tedious')(Request)
		
	else if config.driver is 'msnodesql'
		Driver = require('./msnodesql')(Request)
		
	else
		err = new Error "Unknown driver #{config.driver}!"
		
		if callback
			callback err
		else
			throw err

	Driver.connect config, (err) ->
		unless connecting then return
		
		connecting = false
		unless err then connected = true
		callback? err

module.exports.close = ->
	if connecting
		connecting = false
		
		Driver.close()
		Driver = null
		
	else if connected
		connected = false

		Driver.close()
		Driver = null

module.exports.Request = Request

module.exports.TYPES = TYPES
module.exports.map = map

# append datatypes to this modules export

for key, value of TYPES
	module.exports[key] = value
	module.exports[key.toUpperCase()] = value
	
# --- DEPRECATED IN 0.3.0 ------------------------------------------

module.exports.pool =
	max: 10
	min: 0
	idleTimeoutMillis: 30000

module.exports.connection =
	userName: ''
	password: ''
	server: ''

module.exports.init = ->
	module.exports.connect
		user: module.exports.connection.userName
		password: module.exports.connection.password
		server: module.exports.connection.server
		options: module.exports.connection.options
		
		driver: 'tedious'
		pool: module.exports.pool
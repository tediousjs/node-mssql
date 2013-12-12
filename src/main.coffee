events = require 'events'
util = require 'util'

TYPES = require('./datatypes').TYPES

global_connection = null

map = []

###
Register you own type map.

**Example:**
```
sql.map.register(MyClass, sql.Text);
```
You can also overwrite default type map.
```
sql.map.register(Number, sql.BigInt);
```

@path module.exports.map
@param {*} jstype JS data type.
@param {*} sqltype SQL data type.
###

map.register = (jstype, sqltype) ->
	for item, index in @ when item.js is jstype
		@splice index, 1
		break
		
	@push
		js: jstype
		sql: sqltype
	
	null

map.register String, TYPES.VarChar
map.register Number, TYPES.Int
map.register Boolean, TYPES.Bit
map.register Date, TYPES.DateTime

###
@ignore
###

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

###
Class Connection.

@property {Boolean} connected If true, connection is established.
@property {Boolean} connecting If true, connection is being established.
@property {*} driver Reference to configured Driver.
###

class Connection
	connected: false
	connecting: false
	driver: null
	
	###
	Create new Connection.
	
	@param {Object} config Connection configuration.
	@callback callback A callback which is called after connection has established, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	###
	
	constructor: (@config, callback) ->
		# set defaults
		@config.driver ?= 'tedious'
		@config.port ?= 1433
	
		if @config.driver is 'tedious'
			@driver = require('./tedious')(Connection, Transaction, Request)
			
		else if @config.driver is 'msnodesql'
			@driver = require('./msnodesql')(Connection, Transaction, Request)
			
		else if @config.driver is 'tds'
			@driver = require('./tds')(Connection, Transaction, Request)
		
		else
			err = new Error "Unknown driver #{@config.driver}!"
			
			if callback
				callback err
			else
				throw err

		if callback then @connect callback
	
	###
	Create connection to the server.
	
	@callback callback A callback which is called after connection has established, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	
	@returns {Connection}
	###
	
	connect: (callback) ->
		if @connected
			err = new Error "Database is already connected! Call close before connecting to different database."
			
			if callback
				callback err
			else
				throw err
		
		if @connecting
			err = new Error "Already connecting to database! Call close before connecting to different database."
			
			if callback
				callback err
			else
				throw err
		
		@connecting = true
		@driver.connection::connect.call @, @config, (err) =>
			unless @connecting then return
			
			@connecting = false
			unless err then @connected = true
			callback? err
		
		@
	
	###
	Close connection to the server.
	
	@returns {Connection}
	###
	
	close: ->
		if @connecting
			@connecting = false
			
			@driver.connection::close.call @
			@driver = null
			
		else if @connected
			@connected = false
	
			@driver.connection::close.call @
			@driver = null
		
		@
	
	###
	Returns new request using this connection.
	
	@returns {Request}
	###
	
	request: ->
		new Request @
	
	###
	Returns new transaction using this connection.
	
	@returns {Transaction}
	###
	
	transaction: ->
		new Transaction @

###
Class Transaction.

@property {Connection} connection Reference to used connection.
###

class Transaction
	_pooledConnection: null
	_queue: null
	_working: false # if true, there is a request running at the moment
	
	###
	Create new Transaction.
	
	@param {Connection} connection If ommited, global connection is used instead.
	###
	
	constructor: (connection) ->
		@connection = connection ? global_connection
		@_queue = []
		
	###
	Begin a transaction.
	
	@callback callback A callback which is called after transaction has began, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction}
	###
	
	begin: (callback) ->
		if @_pooledConnection
			callback new Error "Transaction is already running."
			return @
			
		@connection.driver.transaction::begin.call @, callback
		@
		
	###
	Commit a transaction.
	
	@callback callback A callback which is called after transaction has commited, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction}
	###
	
	commit: (callback) ->
		unless @_pooledConnection
			callback new Error "Transaction has not started. Call begin() first."
			return @
			
		@connection.driver.transaction::commit.call @, callback
		@
	
	###
	Execute next request in queue.
	
	@private
	@returns {Transaction}
	###
	
	next: ->
		if @_queue.length
			@_queue.shift() null, @_pooledConnection
		
		else
			@_working = false
	
	###
	Add request to queue for connection. If queue is empty, execute the request immediately.
	
	@private
	@callback callback A callback to call when connection in ready to execute request.
		@param {Error} err Error on error, otherwise null.
		@param {*} conn Internal driver's connection.
	@returns {Transaction}
	###
	
	queue: (callback) ->
		unless @_pooledConnection
			callback new Error "Transaction has not started. Call begin() first."
			return @
			
		if @_working
			@_queue.push callback
		
		else
			@_working = true
			callback null, @_pooledConnection
	
	###
	Returns new request using this transaction.
	
	@returns {Request}
	###
	
	request: ->
		new Request @
		
	###
	Rollback a transaction.
	
	@callback callback A callback which is called after transaction has rolled back, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction}
	###
		
	rollback: (callback) ->
		unless @_pooledConnection
			callback new Error "Transaction has not started. Call begin() first."
			return @
			
		@connection.driver.transaction::rollback.call @, callback
		@

###
Class Request.

@property {Connection} connection Reference to used connection.
@property {Transaction} transaction Reference to transaction when request was created in transaction.
@property {*} parameters Collection of input and output parameters.
@property {Boolean} verbose If `true`, debug messages are printed to message log.
@property {Boolean} multiple If `true`, `query` will handle multiple recordsets (`execute` always expect multiple recordsets).
###

class Request
	connection: null
	transaction: null
	parameters: null
	verbose: false
	multiple: false
	
	###
	Create new Request.
	
	@param {Connection} connection If ommited, global connection is used instead.
	###
	
	constructor: (connection) ->
		if connection instanceof Transaction
			@transaction = connection
			@connection = connection.connection
		
		else if connection instanceof Connection
			@connection = connection
		
		else
			@connection = global_connection
		
		@parameters = {}
	
	###
	Acquire connection for this request from connection.
	###
	
	_acquire: (callback) ->
		@connection.driver.request::_acquire.call @, callback
	
	###
	Release connection used by this request.
	###
	
	_release: (connection) ->
		@connection.driver.request::_release.call @, connection
	
	###
	Add an input parameter to the request.
	
	**Example:**
	```
	request.input('input_parameter', value);
	request.input('input_parameter', sql.Int, value);
	```
	
	@param {String} name Name of the input parameter without @ char.
	@param {*} [type] SQL data type of input parameter. If you omit type, module automaticaly decide which SQL data type should be used based on JS data type.
	@param {*} value Input parameter value. `undefined` and `NaN` values are automatically converted to `null` values.
	@returns {Request}
	###

	input: (name, type, value) ->
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
		
		# NaN to null
		if value isnt value then value = null
		
		@parameters[name] =
			name: name
			type: type
			io: 1
			value: value
		
		@
			
	###
	Add an output parameter to the request.
	
	**Example:**
	```
	request.output('output_parameter', sql.Int);
	```
	
	@param {String} name Name of the output parameter without @ char.
	@param {*} type SQL data type of output parameter.
	@returns {Request}
	###
	
	output: (name, type) ->
		unless type then type = tds.TYPES.VarChar
		
		@parameters[name] =
			name: name
			type: type
			io: 2
		
		@
			
	###
	Execute the SQL command.
	
	**Example:**
	```
	var request = new sql.Request();
	request.query('select 1 as number', function(err, recordset) {
	    console.log(recordset[0].number); // return 1
	
	    // ...
	});
	```
	
	You can enable multiple recordsets in querries by `request.multiple = true` command.
	
	```
	var request = new sql.Request();
	request.multiple = true;
	
	request.query('select 1 as number; select 2 as number', function(err, recordsets) {
	    console.log(recordsets[0][0].number); // return 1
	    console.log(recordsets[1][0].number); // return 2
	
	    // ...
	});
	```
	
	@param {String} command T-SQL command to be executed.
	@callback callback A callback which is called after execution has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
		@param {*} recordset Recordset.
	
	@returns {Request}
	###

	query: (command, callback) ->
		unless @connection
			return process.nextTick ->
				callback? new Error "No connection is specified for that request."
		
		@connection.driver.request::query.call @, command, callback
		@
	
	###
	Call a stored procedure.
	
	**Example:**
	```
	var request = new sql.Request();
	request.input('input_parameter', sql.Int, value);
	request.output('output_parameter', sql.Int);
	request.execute('procedure_name', function(err, recordsets, returnValue) {
	    console.log(recordsets.length); // count of recordsets returned by procedure
	    console.log(recordset[0].length); // count of rows contained in first recordset
	    console.log(returnValue); // procedure return value
	
	    console.log(request.parameters.output_parameter.value); // output value
	
	    // ...
	});
	```
	
	@param {String} procedure Name of the stored procedure to be executed.
	@callback callback A callback which is called after execution has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
		@param {*} recordset Recordset.
		@param {Number} returnValue Procedure return value.
	
	@returns {Request}
	###
	
	execute: (procedure, callback) ->
		unless @connection
			return process.nextTick ->
				callback? new Error "No connection is specified for that request."
		
		@connection.driver.request::execute.call @, procedure, callback
		@
		
	###
	Cancel currently executed request.
	
	@returns {Request}
	###
	
	cancel: ->
		@connection.driver.request::cancel.call @
		@

###
Open global connection.

@param {Object} config Connection configuration.
@callback callback A callback which is called after connection has established, or an error has occurred.
	@param {Error} err Error on error, otherwise null.
	
@returns {Connection}
###

module.exports.connect = (config, callback) ->
	global_connection = new Connection config
	global_connection.connect callback

###
Close global connection.
	
@returns {Connection}
###

module.exports.close = ->
	global_connection?.close()

module.exports.Connection = Connection
module.exports.Transaction = Transaction
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

###
Initialize Tedious connection pool.

@deprecated
###

module.exports.init = ->
	module.exports.connect
		user: module.exports.connection.userName
		password: module.exports.connection.password
		server: module.exports.connection.server
		options: module.exports.connection.options
		
		driver: 'tedious'
		pool: module.exports.pool
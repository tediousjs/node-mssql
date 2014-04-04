{EventEmitter} = require 'events'
util = require 'util'

{TYPES, declare} = require('./datatypes')
ISOLATION_LEVEL = require('./isolationlevel')
DRIVERS = ['msnodesql', 'tedious', 'tds']
Table = require('./table')

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

map.register String, TYPES.NVarChar
map.register Number, TYPES.Int
map.register Boolean, TYPES.Bit
map.register Date, TYPES.DateTime
map.register Buffer, TYPES.VarBinary
map.register Table, TYPES.TVP

###
@ignore
###

getTypeByValue = (value) ->
	if value is null or value is undefined then return TYPES.NVarChar

	switch typeof value
		when 'string'
			for item in map when item.js is String
				return item.sql

			return TYPES.NVarChar
			
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

			return TYPES.NVarChar
			
		else
			return TYPES.NVarChar

###
Class Connection.

@property {Boolean} connected If true, connection is established.
@property {Boolean} connecting If true, connection is being established.
@property {*} driver Reference to configured Driver.

@event connect Dispatched after connection has established.
@event close Dispatched after connection has closed a pool (by calling close).
###

class Connection extends EventEmitter
	connected: false
	connecting: false
	driver: null
	
	###
	Create new Connection.
	
	@param {Object} config Connection configuration.
	@callback [callback] A callback which is called after connection has established, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	###
	
	constructor: (@config, callback) ->
		# set defaults
		@config.driver ?= 'tedious'
		@config.port ?= 1433
		@config.options ?= {}
		
		if /^(.*)\\(.*)$/.exec @config.server
			@config.server = RegExp.$1
			@config.options.instanceName = RegExp.$2
		
		if @config.driver in DRIVERS
			@driver = @initializeDriver require("./#{@config.driver}")
			
			# fix the driver by default
			if module.exports.fix then @driver.fix()

		else
			err = new ConnectionError "Unknown driver #{@config.driver}!", 'EDRIVER'
			
			if callback
				callback err
			else
				throw err

		if callback then @connect callback
	
	###
	Initializes driver for this connection. Separated from constructor and used by co-mssql.
	
	@private
	@param {Function} driver Loaded driver.
	
	@returns {Connection}
	###
	
	initializeDriver: (driver) ->
		driver Connection, Transaction, Request, ConnectionError, TransactionError, RequestError
	
	###
	Create connection to the server.
	
	@callback [callback] A callback which is called after connection has established, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	
	@returns {Connection}
	###
	
	connect: (callback) ->
		if @connected
			err = new ConnectionError "Database is already connected! Call close before connecting to different database.", 'EALREADYCONNECTED'
			
			if callback
				callback err
			else
				throw err
		
		if @connecting
			err = new ConnectionError "Already connecting to database! Call close before connecting to different database.", 'EALREADYCONNECTING'
			
			if callback
				callback err
			else
				throw err
		
		@connecting = true
		@driver.Connection::connect.call @, @config, (err) =>
			unless @connecting then return
			
			@connecting = false
			unless err
				@connected = true
				@emit 'connect'
				
			callback? err
		
		@

	###
	Close connection to the server.
	
	@callback [callback] A callback which is called after connection has closed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	
	@returns {Connection}
	###
	
	close: (callback) ->
		if @connecting
			@connecting = false
			
			@driver.Connection::close.call @, (err) =>
				callback? err
			
			@driver = null
			
		else if @connected
			@connected = false
	
			@driver.Connection::close.call @, (err) =>
				unless err
					@connected = false
					@emit 'close'
				
				callback? err

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
Class PreparedStatement.

IMPORTANT: Rememeber that each prepared statement means one reserved connection from the pool. Don't forget to unprepare a prepared statement!

@property {Connection} connection Reference to used connection.
@property {Boolean} multiple If `true`, `execute` will handle multiple recordsets.
@property {String} statement Prepared SQL statement.
###

class PreparedStatement extends EventEmitter
	_pooledConnection: null
	_queue: null
	_working: false # if true, there is a request running at the moment
	_handle: 0 # sql prepared statement handle
	
	connection: null # sql.Connection
	transaction: null # !null in case we're in transaction
	prepared: false
	statement: null
	parameters: null
	multiple: false
	
	###
	Create new Prepared Statement.
	
	@param {String} statement SQL statement.
	@param {Connection} [connection] If ommited, global connection is used instead.
	###
	
	constructor: (connection) ->
		if connection instanceof Transaction
			@transaction = connection
			@connection = connection.connection
		
		else if connection instanceof Connection
			@connection = connection
		
		else
			@connection = global_connection

		@_queue = []
		@parameters = {}
	
	###
	Add an input parameter to the prepared statement.
	
	**Example:**
	```
	statement.input('input_parameter', sql.Int);
	statement.input('input_parameter', sql.VarChar(50));
	```
	
	@param {String} name Name of the input parameter without @ char.
	@param {*} type SQL data type of input parameter.
	@returns {PreparedStatement}
	###

	input: (name, type) ->
		if arguments.length < 2
			throw new PreparedStatementError "Invalid number of arguments. 2 arguments expected.", 'EARGS'

		if type instanceof Function
			type = type()
		
		@parameters[name] =
			name: name
			type: type.type
			io: 1
			length: type.length
			scale: type.scale
			precision: type.precision
		
		@
			
	###
	Add an output parameter to the prepared statement.
	
	**Example:**
	```
	statement.output('output_parameter', sql.Int);
	statement.output('output_parameter', sql.VarChar(50));
	```
	
	@param {String} name Name of the output parameter without @ char.
	@param {*} type SQL data type of output parameter.
	@returns {PreparedStatement}
	###
	
	output: (name, type) ->
		if arguments.length < 2
			throw new PreparedStatementError "Invalid number of arguments. 2 arguments expected.", 'EARGS'

		if type instanceof Function
			type = type()
		
		@parameters[name] =
			name: name
			type: type.type
			io: 2
			length: type.length
			scale: type.scale
			precision: type.precision
		
		@
	
	###
	Prepare a statement.
	
	@property {String} [statement] SQL statement to prepare.
	@callback [callback] A callback which is called after preparation has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {PreparedStatement}
	###
	
	prepare: (statement, callback) ->
		if @_pooledConnection
			callback? new PreparedStatementError "Statement is already prepared."
			return @
		
		if typeof statement is 'function'
			callback = statement
			statement = undefined
		
		@statement = statement if statement?
		
		done = (err, connection) =>
			if err then return callback? err
				
			@_pooledConnection = connection
				
			req = new Request @
			req.output 'handle', TYPES.Int
			req.input 'params', TYPES.NVarChar, ("@#{name} #{declare(param.type, param)}#{if param.io is 2 then " output" else ""}" for name, param of @parameters).join(',')
			req.input 'stmt', TYPES.NVarChar, @statement
			req.execute 'sp_prepare', (err) =>
				if err
					if @transaction
						@transaction.next()
					else
						@connection.pool.release @_pooledConnection
						@_pooledConnection = null
					
					return callback? err
				
				@_handle = req.parameters.handle.value
			
				callback? null
		
		if @transaction
			unless @transaction._pooledConnection
				callback? new PreparedStatementError "Transaction has not started. Call begin() first."
				return @
			
			@transaction.queue done
				
		else
			@connection.pool.acquire done
		
		@
	
	###
	Execute next request in queue.
	
	@private
	@returns {PreparedStatement}
	###
	
	next: ->
		if @_queue.length
			@_queue.shift() null, @_pooledConnection
		
		else
			@_working = false
		
		@
	
	###
	Add request to queue for connection. If queue is empty, execute the request immediately.
	
	@private
	@callback callback A callback to call when connection in ready to execute request.
		@param {Error} err Error on error, otherwise null.
		@param {*} conn Internal driver's connection.
	@returns {PreparedStatement}
	###
	
	queue: (callback) ->
		unless @_pooledConnection
			callback new PreparedStatementError "Statement is not prepared. Call prepare() first."
			return @
			
		if @_working
			@_queue.push callback
		
		else
			@_working = true
			callback null, @_pooledConnection
		
		@
	
	###
	Execute a prepared statement.
	
	@property {String} values An object whose names correspond to the names of parameters that were added to the prepared statement before it was prepared.
	@callback [callback] A callback which is called after execution has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Request}
	###
	
	execute: (values, callback) ->
		req = new Request @
		req.input 'handle', TYPES.Int, @_handle
		
		# copy parameters with new values
		for name, param of @parameters
			req.parameters[name] =
				name: name
				type: param.type
				io: param.io
				value: values[name]
				length: param.length
				scale: param.scale
				precision: param.precision
		
		req.execute 'sp_execute', (err, recordsets, returnValue) =>
			if err then return callback err
			
			callback null, (if @multiple then recordsets else recordsets[0])
		
		req
		
	###
	Unprepare a prepared statement.
	
	@callback [callback] A callback which is called after unpreparation has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {PreparedStatement}
	###
		
	unprepare: (callback) ->
		unless @_pooledConnection
			callback? new PreparedStatementError "Statement is not prepared. Call prepare() first."
			return @
		
		done = (err) =>
			if err then return callback? err
			
			if @transaction
				@transaction.next()
			else
				@connection.pool.release @_pooledConnection
				@_pooledConnection = null
			
			@_handle = 0
			
			callback? null

		req = new Request @
		req.input 'handle', TYPES.Int, @_handle
		req.execute 'sp_unprepare', done
			
		@

###
Class Transaction.

@property {Connection} connection Reference to used connection.
@property {Number} isolationLevel Controls the locking and row versioning behavior of TSQL statements issued by a connection. READ_COMMITTED by default.
@property {String} name Transaction name. Empty string by default.

@event begin Dispatched when transaction begin.
@event commit Dispatched on successful commit.
@event rollback Dispatched on successful rollback.
###

class Transaction extends EventEmitter
	_pooledConnection: null
	_queue: null
	_working: false # if true, there is a request running at the moment

	name: ""
	connection: null # sql.Connection
	isolationLevel: ISOLATION_LEVEL.READ_COMMITTED
	
	###
	Create new Transaction.
	
	@param {Connection} [connection] If ommited, global connection is used instead.
	###
	
	constructor: (connection) ->
		@connection = connection ? global_connection
		@_queue = []
		
	###
	Begin a transaction.
	
	@param {Number} [isolationLevel] Controls the locking and row versioning behavior of TSQL statements issued by a connection.
	@callback [callback] A callback which is called after transaction has began, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction}
	###
	
	begin: (isolationLevel, callback) ->
		if isolationLevel instanceof Function
			callback = isolationLevel
			isolationLevel = undefined
		
		@isolationLevel = isolationLevel if isolationLevel?
		
		if @_pooledConnection
			callback? new TransactionError "Transaction is already running."
			return @
			
		@connection.driver.Transaction::begin.call @, (err) =>
			unless err then @emit 'begin'
			callback? err
		
		@
		
	###
	Commit a transaction.
	
	@callback [callback] A callback which is called after transaction has commited, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction}
	###
	
	commit: (callback) ->
		unless @_pooledConnection
			callback? new TransactionError "Transaction has not started. Call begin() first."
			return @
			
		if @_working
			callback? new TransactionError "Can't commit transaction. There is a request in progress."
			return @

		@connection.driver.Transaction::commit.call @, (err) =>
			unless err then @emit 'commit'
			callback? err
			
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
		
		@
	
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
			callback new TransactionError "Transaction has not started. Call begin() first."
			return @
			
		if @_working
			@_queue.push callback
		
		else
			@_working = true
			callback null, @_pooledConnection
		
		@
	
	###
	Returns new request using this transaction.
	
	@returns {Request}
	###
	
	request: ->
		new Request @
		
	###
	Rollback a transaction.
	
	@callback [callback] A callback which is called after transaction has rolled back, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction}
	###
		
	rollback: (callback) ->
		unless @_pooledConnection
			callback? new TransactionError "Transaction has not started. Call begin() first."
			return @
			
		if @_working
			callback? new TransactionError "Can't rollback transaction. There is a request in progress."
			return @

		@connection.driver.Transaction::rollback.call @, (err) =>
			unless err then @emit 'rollback'
			callback? err
			
		@

###
Class Request.

@property {Connection} connection Reference to used connection.
@property {Transaction} transaction Reference to transaction when request was created in transaction.
@property {*} parameters Collection of input and output parameters.
@property {Boolean} verbose If `true`, debug messages are printed to message log.
@property {Boolean} multiple If `true`, `query` will handle multiple recordsets (`execute` always expect multiple recordsets).
@property {Boolean} canceled `true` if request was canceled.

@event recordset Dispatched when new recordset is parsed (with all rows).
@event row Dispatched when new row is parsed.
@event done Dispatched when request is complete.
###

class Request extends EventEmitter
	connection: null
	transaction: null
	pstatement: null
	parameters: null
	verbose: false
	multiple: false
	canceled: false
	
	###
	Create new Request.
	
	@param {Connection|Transaction} connection If ommited, global connection is used instead.
	###
	
	constructor: (connection) ->
		if connection instanceof Transaction
			@transaction = connection
			@connection = connection.connection
		
		else if connection instanceof PreparedStatement
			@pstatement = connection
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
		if @transaction
			@transaction.queue callback
		else if @pstatement
			@pstatement.queue callback
		else
			@connection.pool.acquire callback
	
	###
	Release connection used by this request.
	###
	
	_release: (connection) ->
		if @transaction
			@transaction.next()
		else if @pstatement
			@pstatement.next()
		else
			@connection.pool.release connection
	
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
			throw new RequestError "Invalid number of arguments. At least 2 arguments expected.", 'EARGS'
			
		else if arguments.length is 2
			value = type
			type = getTypeByValue(value)

		# support for custom data types
		if value?.valueOf and value not instanceof Date then value = value.valueOf()
		
		# undefined to null
		if value is undefined then value = null
		
		# NaN to null
		if value isnt value then value = null
		
		if type instanceof Function
			type = type()
		
		@parameters[name] =
			name: name
			type: type.type
			io: 1
			value: value
			length: type.length
			scale: type.scale
			precision: type.precision
		
		@
			
	###
	Add an output parameter to the request.
	
	**Example:**
	```
	request.output('output_parameter', sql.Int);
	request.output('output_parameter', sql.VarChar(50), 'abc');
	```
	
	@param {String} name Name of the output parameter without @ char.
	@param {*} type SQL data type of output parameter.
	@param {*} [value] Output parameter value initial value. `undefined` and `NaN` values are automatically converted to `null` values. Optional.
	@returns {Request}
	###
	
	output: (name, type, value) ->
		unless type then type = TYPES.NVarChar
		
		if type is TYPES.Text or type is TYPES.NText or type is TYPES.Image
			throw new RequestError "Deprecated types (Text, NText, Image) are not supported as OUTPUT parameters.", 'EDEPRECATED'
		
		# support for custom data types
		if value?.valueOf and value not instanceof Date then value = value.valueOf()
		
		# undefined to null
		if value is undefined then value = null
		
		# NaN to null
		if value isnt value then value = null
		
		if type instanceof Function
			type = type()
		
		@parameters[name] =
			name: name
			type: type.type
			io: 2
			value: value
			length: type.length
			scale: type.scale
			precision: type.precision
		
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
	@callback [callback] A callback which is called after execution has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
		@param {*} recordset Recordset.
	
	@returns {Request}
	###

	query: (command, callback) ->
		unless @connection
			return process.nextTick ->
				callback? new RequestError "No connection is specified for that request.", 'ENOCONN'
		
		@canceled = false
		
		@connection.driver.Request::query.call @, command, (err, recordset) =>
			unless err then @emit 'done', err, recordset
			
			callback? err, recordset
			
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
	    console.log(recordsets.returnValue); // procedure return value
	
	    console.log(request.parameters.output_parameter.value); // output value
	
	    // ...
	});
	```
	
	@param {String} procedure Name of the stored procedure to be executed.
	@callback [callback] A callback which is called after execution has completed, or an error has occurred.
		@param {Error} err Error on error, otherwise null.
		@param {Array} recordsets Recordsets.
		@param {Number} returnValue Procedure return value.
	
	@returns {Request}
	###
	
	execute: (procedure, callback) ->
		unless @connection
			return process.nextTick ->
				callback? new RequestError "No connection is specified for that request.", 'ENOCONN'
		
		@canceled = false
		
		@connection.driver.Request::execute.call @, procedure, (err, recordsets, returnValue) =>
			@emit 'done', err, recordsets
			callback? err, recordsets, returnValue
			
		@
	
	###
	Cancel currently executed request.
	
	@returns {Request}
	###
	
	cancel: ->
		@canceled = true
		@connection.driver.Request::cancel.call @
		@

class ConnectionError extends Error
	constructor: (message, code) ->
		unless @ instanceof ConnectionError
			if message instanceof Error
				err = new ConnectionError message.message, message.code
				err.originalError = message
				Error.captureStackTrace err, arguments.callee
				return err
				
			else
				err = new ConnectionError message
				Error.captureStackTrace err, arguments.callee
				return err
		
		@name = @constructor.name
		@message = message
		@code = code
		
		super()
		Error.captureStackTrace @, @constructor

class TransactionError extends Error
	constructor: (message, code) ->
		unless @ instanceof TransactionError
			if message instanceof Error
				err = new TransactionError message.message, message.code
				err.originalError = message
				Error.captureStackTrace err, arguments.callee
				return err
				
			else
				err = new TransactionError message
				Error.captureStackTrace err, arguments.callee
				return err
		
		@name = @constructor.name
		@message = message
		@code = code
		
		super()
		Error.captureStackTrace @, @constructor

class RequestError extends Error
	constructor: (message, code) ->
		unless @ instanceof RequestError
			if message instanceof Error
				err = new RequestError message.message, message.code
				err.originalError = message
				Error.captureStackTrace err, arguments.callee
				return err
				
			else
				err = new RequestError message
				Error.captureStackTrace err, arguments.callee
				return err
		
		@name = @constructor.name
		@message = message
		@code = code
		
		super()
		Error.captureStackTrace @, @constructor

class PreparedStatementError extends Error
	constructor: (message, code) ->
		unless @ instanceof PreparedStatementError
			if message instanceof Error
				err = new PreparedStatementError message.message, message.code
				err.originalError = message
				Error.captureStackTrace err, arguments.callee
				return err
				
			else
				err = new PreparedStatementError message
				Error.captureStackTrace err, arguments.callee
				return err
		
		@name = @constructor.name
		@message = message
		@code = code
		
		super()
		Error.captureStackTrace @, @constructor

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

module.exports.close = (callback) ->
	global_connection?.close callback

module.exports.Connection = Connection
module.exports.Transaction = Transaction
module.exports.Request = Request
module.exports.Table = Table
module.exports.PreparedStatement = PreparedStatement

module.exports.ConnectionError = ConnectionError
module.exports.TransactionError = TransactionError
module.exports.RequestError = RequestError
module.exports.PreparedStatementError = PreparedStatementError

module.exports.ISOLATION_LEVEL = ISOLATION_LEVEL
module.exports.DRIVERS = DRIVERS
module.exports.TYPES = TYPES
module.exports.MAX = 65535 # (1 << 16) - 1
module.exports.map = map
module.exports.fix = true

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
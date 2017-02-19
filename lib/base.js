'use strict'

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const fs = require('fs');
const debug = require('debug')('mssql');
const gp = require('generic-pool');

const TYPES = require('./datatypes').TYPES;
const declare = require('./datatypes').declare;
const ISOLATION_LEVEL = require('./isolationlevel');
const Table = require('./table');
const ConnectionString = require('./connectionstring');

let global_connection = null;
let promise_library = Promise;
const global_connection_handlers = {};
const map = [];
const driver = {};

/*
 * Register you own type map.
 * 
 * **Example:**
 * ```
 * sql.map.register(MyClass, sql.Text);
 * ```
 * You can also overwrite default type map.
 * ```
 * sql.map.register(Number, sql.BigInt);
 * ```
 * 
 * @path module.exports.map
 * @param {*} jstype JS data type.
 * @param {*} sqltype SQL data type.
 */

map.register = function(jstype, sqltype) {
	for (let index = 0; index < this.length; index++) {
		let item = this[index];
		if (item.js === jstype) {
			this.splice(index, 1);
			break;
		}
	}
		
	this.push({
		js: jstype,
		sql: sqltype
	});
	
	return null;
};

map.register(String, TYPES.NVarChar);
map.register(Number, TYPES.Int);
map.register(Boolean, TYPES.Bit);
map.register(Date, TYPES.DateTime);
map.register(Buffer, TYPES.VarBinary);
map.register(Table, TYPES.TVP);

/*
 * @ignore
 */

let getTypeByValue = function(value) {
	if ((value === null) || (value === undefined)) { return TYPES.NVarChar; }

	switch (typeof value) {
		case 'string':
			for (var item of Array.from(map)) {
				if (item.js === String) {
					return item.sql;
				}
			}

			return TYPES.NVarChar;
			
		case 'number':
			for (item of Array.from(map)) {
				if (item.js === Number) {
					return item.sql;
				}
			}

			return TYPES.Int;
			
		case 'boolean':
			for (item of Array.from(map)) {
				if (item.js === Boolean) {
					return item.sql;
				}
			}

			return TYPES.Bit;
			
		case 'object':
			for (item of Array.from(map)) {
				if (value instanceof item.js) {
					return item.sql;
				}
			}

			return TYPES.NVarChar;
			
		default:
			return TYPES.NVarChar;
	}
};

class Connection {
	constructor(ref) {
		this._ref = ref;
	}
}

/*
 * Class ConnectionPool.
 * 
 * Internally, each `Connection` instance is a separate pool of TDS connections. Once you create a new `Request`/`Transaction`/`Prepared Statement`, a new TDS connection is acquired from the pool and reserved for desired action. Once the action is complete, connection is released back to the pool.
 * 
 * @property {Boolean} connected If true, connection is established.
 * @property {Boolean} connecting If true, connection is being established.
 * @property {*} driver Reference to configured Driver.
 * 
 * @event connect Dispatched after connection has established.
 * @event close Dispatched after connection has closed a pool (by calling close).
 */

class ConnectionPool extends EventEmitter {
	/*
	 * Create new Connection.
	 * 
	 * @param {Object|String} config Connection configuration object or connection string.
	 * @callback [callback] A callback which is called after connection has established, or an error has occurred.
	 * 	@param {Error} err Error on error, otherwise null.
	 */
	
	constructor(config, callback) {
		super();
		
		this.config = config;
		this._connected = false;
		this._connecting = false;
		
		if ('string' === typeof this.config) {
			try {
				this.config = ConnectionString.resolve(this.config);
			} catch (ex) {
				if ('function' === typeof callback) {
					return callback(ex);
				}
				throw ex;
			}
		}
		
		// set defaults
		this.config.port = this.config.port || 1433;
		this.config.options = this.config.options || {};
		this.config.stream = this.config.stream || false;
		this.config.parseJSON = this.config.parseJSON || false;
		
		if (/^(.*)\\(.*)$/.exec(this.config.server)) {
			this.config.server = RegExp.$1;
			this.config.options.instanceName = RegExp.$2;
		}

		if ('function' === typeof callback) {
			this.connect(callback);
		}
	}
	
	get connected() {
		return this._connected;
	}
	
	get connecting() {
		return this._connecting;
	}
	
	/*
	Acquire connection from this connection pool.
	*/
	
	acquire(requester, callback) {
		debug('conn: acquire');
		
		if ('function' === typeof callback) {
			this._acquire().then(connection => callback(null, connection)).catch(callback);
			return this;
		}
		
		return this._acquire();
	}
	
	_acquire() {
		if (!this.pool) {
			setImmediate(callback, new ConnectionError("Connection not yet open.", 'ENOTOPEN'));
			return this;
		}
		
		return this.pool.acquire();
	}

	/*
	Release connection back to the pool.
	*/
	
	release(connection) {
		debug('conn: release');
		
		this.pool.release(connection);
		return this;
	}
	
	/*
	 * Creates a new connection pool with one active connection. This one initial connection serves as a probe to find out whether the configuration is valid.
	 * 
	 * @callback [callback] A callback which is called after connection has established, or an error has occurred. If omited, method returns Promise.
	 *     @param {Error} err Error on error, otherwise null.
	 * 
	 * @returns {Connection|Promise}
	 */
	
	connect(callback) {
		if ('function' === typeof callback) {
			this._connect(callback);
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			return this._connect(err => {
				if (err) return reject(err);
				resolve(this);
			})
		})
	}
	
	_connect(callback) {
		if (this._connected) {
			return callback(new ConnectionError("Database is already connected! Call close before connecting to different database.", 'EALREADYCONNECTED'));
		}
		
		if (this._connecting) {
			return callback(new ConnectionError("Already connecting to database! Call close before connecting to different database.", 'EALREADYCONNECTING'));
		}

		this._connecting = true;
		
		//create one testing connection to check if everything is ok
		this._poolCreate().then((connection) => {
			this._poolDestroy(connection);
			if (!this._connecting) {
				// close was called before connection was established
				return; // exit silently
			}
		
			// prepare pool
			const pool = this.pool = gp.createPool({
				create: this._poolCreate.bind(this),
				validate: this._poolValidate.bind(this),
				destroy: this._poolDestroy.bind(this)
			}, Object.assign({
				max: 10,
				min: 0,
				idleTimeoutMillis: 30000,
				testOnBorrow: true,
				autostart: false
			}, this.config.pool));
			
			this.pool.on('factoryCreateError', this.emit.bind(this, 'error'));
			this.pool.on('factoryDestroyError', this.emit.bind(this, 'error'));
			
			this._connecting = false;
			this._connected = true;
			
			callback(null);
		}).catch(err => {
			this._connecting = false;
			callback(err);
		});
	}

	/*
	 * Close all active connections in the pool.
	 * 
	 * @callback [callback] A callback which is called after connection has closed, or an error has occurred. If omited, method returns Promise.
	 *     @param {Error} err Error on error, otherwise null.
	 * 
	 * @returns {Connection|Promise}
	 */
	
	close(callback) {
		if ('function' === typeof callback) {
			this._close(callback);
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			this._close(err => {
				if (err) return reject(err);
				resolve(this);
			})
		})
	}
	
	_close(callback) {
		this._connecting = this._connected = false;
		
		if (!this.pool) return serImmediate(callback, null);
		
		const pool = this.pool;
		this.pool.drain().then(() => {
			pool.clear();
			callback(null);
		})
		
		this.pool = null;
	}
	
	/*
	 * Returns new request using this connection.
	 * 
	 * @returns {Request}
	 */
	
	request() {
		return new driver.Request(this);
	}
	
	/*
	 * Returns new transaction using this connection.
	 * 
	 * @returns {Transaction}
	 */
	
	transaction() {
		return new driver.Transaction(this);
	}
	
	/*
	 * Creates a new query using this connection from a tagged template string.
	 * 
	 * @param {Array} strings Array of string literals.
	 * @param {...*} keys Values.
	 * @returns {Request}
	 */
	
	query() {
		const values = Array.prototype.slice.call(arguments);
		const strings = values.shift();
		
		return new driver.Request(this)._template('query', strings, values);
	}
	
	/**
	 * Creates a new batch using this connection from a tagged template string.
	 * 
	 * @param {Array} strings Array of string literals.
	 * @param {...*} keys Values.
	 * @returns {Request}
	 */
	
	batch() {
		const values = Array.prototype.slice.call(arguments);
		const strings = values.shift();
		
		return new driver.Request(this)._template('batch', strings, values);
	}
}

/**
 * Class PreparedStatement.
 * 
 * IMPORTANT: Rememeber that each prepared statement means one reserved connection from the pool. Don't forget to unprepare a prepared statement!
 * 
 * @property {Connection} connection Reference to used connection.
 * @property {Boolean} multiple If `true`, `execute` will handle multiple recordsets.
 * @property {String} statement Prepared SQL statement.
 */

class PreparedStatement extends EventEmitter {
	/*
	Create new Prepared Statement.
	
	@param {String} statement SQL statement.
	@param {Connection} [connection] If ommited, global connection is used instead.
	*/
	
	constructor(parent) {
		super();
		
		this.parent = parent || global_connection;
		this._handle = 0;
		this.prepared = false;
		this.multiple = false;
		this.parameters = {};
	}
	
	get connected() {
		return this.parent.connected;
	}
	
	/*
	Acquire connection from this connection pool.
	*/
	
	acquire(request, callback) {
		debug('ps: acquire');
		
		if (!this._acquiredConnection) {
			setImmediate(callback, new PreparedStatementError("Statement is not prepared. Call prepare() first.", 'ENOTPREPARED'));
			return this;
		}
		
		if (this._activeRequest) {
			setImmediate(callback, new TransactionError("Can't acquire connection for the request. There is another request in progress.", 'EREQINPROG'));
			return this;
		}
		
		debug('ps: acquire ok');
		
		this._activeRequest = request;
		setImmediate(callback, null, this._acquiredConnection);
		return this;
	}

	/*
	Release connection back to the pool.
	*/
	
	release(connection) {
		debug('ps: release');
		
		if (connection === this._acquiredConnection) {
			this._activeRequest = null;
			debug('ps: release ok');
		}
		
		return this;
	}
	
	/*
	Add an input parameter to the prepared statement.
	
	**Example:**
	```
	statement.input('input_parameter', sql.Int);
	statement.input('input_parameter', sql.VarChar(50));
	```
	
	@param {String} name Name of the input parameter without @ char.
	@param {*} type SQL data type of input parameter.
	@returns {PreparedStatement}
	*/

	input(name, type) {
		if ((/(--| |\/\*|\*\/|')/).test(name)) {
			throw new PreparedStatementError(`SQL injection warning for param '${name}'`, 'EINJECT');
		}
			
		if (arguments.length < 2) {
			throw new PreparedStatementError("Invalid number of arguments. 2 arguments expected.", 'EARGS');
		}

		if (type instanceof Function) {
			type = type();
		}
		
		this.parameters[name] = {
			name,
			type: type.type,
			io: 1,
			length: type.length,
			scale: type.scale,
			precision: type.precision,
			tvpType: type.tvpType
		};
		
		return this;
	}
			
	/*
	Add an output parameter to the prepared statement.
	
	**Example:**
	```
	statement.output('output_parameter', sql.Int);
	statement.output('output_parameter', sql.VarChar(50));
	```
	
	@param {String} name Name of the output parameter without @ char.
	@param {*} type SQL data type of output parameter.
	@returns {PreparedStatement}
	*/
	
	output(name, type) {
		if (/(--| |\/\*|\*\/|')/.test(name)) {
			throw new PreparedStatementError(`SQL injection warning for param '${name}'`, 'EINJECT');
		}
			
		if (arguments.length < 2) {
			throw new PreparedStatementError("Invalid number of arguments. 2 arguments expected.", 'EARGS');
		}

		if (type instanceof Function) type = type();

		this.parameters[name] = {
			name,
			type: type.type,
			io: 2,
			length: type.length,
			scale: type.scale,
			precision: type.precision
		};
		
		return this;
	}
	
	/*
	Prepare a statement.
	
	@property {String} [statement] SQL statement to prepare.
	@callback [callback] A callback which is called after preparation has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	@returns {PreparedStatement|Promise}
	*/
	
	prepare(statement, callback) {
		if ('function' === typeof callback) {
			this._prepare(statement, callback);
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			this._prepare(statement, err => {
				if (err) return reject(err);
				resolve(this);
			})
		})
	}
	
	_prepare(statement, callback) {
		debug('ps: prepare');
		
		if (typeof statement === 'function') {
			callback = statement;
			statement = undefined;
		}
		
		if (this.prepared) {
			return setImmedaite(callback, new PreparedStatementError("Statement is already prepared.", 'EALREADYPREPARED'));
		}
		
		this.statement = statement || this.statement;
		
		this.parent.acquire(this, (err, connection) => {
			if (err) return callback(err);

			this._acquiredConnection = connection;
				
			const req = new driver.Request(this);
			req.stream = false;
			req.output('handle', TYPES.Int);
			req.input('params', TYPES.NVarChar, ((() => {
				let result = [];
				for (let name in this.parameters) {
					let param = this.parameters[name];
					result.push(`@${name} ${declare(param.type, param)}${param.io === 2 ? " output" : ""}`);
				}
				return result;
			})()).join(','));
			req.input('stmt', TYPES.NVarChar, this.statement);
			req.execute('sp_prepare', (err, result) => {
				if (err) {
					this.parent.release(this._acquiredConnection);
					this._acquiredConnection = null;

					return callback(err);
				}
				
				debug('ps: prepare ok');
				
				this._handle = result.output.handle;
				this.prepared = true;
			
				callback(null);
			})
		})
	}
	
	/*
	Execute a prepared statement.
	
	@property {String} values An object whose names correspond to the names of parameters that were added to the prepared statement before it was prepared.
	@callback [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	@returns {Request|Promise}
	*/
	
	execute(values, callback) {
		if (this.stream || ('function' === typeof callback)) {
			return this._execute(values, callback);
		}
		
		return new promise_library((resolve, reject) => {
			this._execute(values, (err, recordset) => {
				if (err) return reject(err);
				resolve(recordset);
			})
		})
	}
	
	_execute(values, callback) {
		const req = new driver.Request(this);
		req.stream = this.stream;
		req.input('handle', TYPES.Int, this._handle);
		
		// copy parameters with new values
		for (let name in this.parameters) {
			let param = this.parameters[name];
			req.parameters[name] = {
				name,
				type: param.type,
				io: param.io,
				value: values[name],
				length: param.length,
				scale: param.scale,
				precision: param.precision
			}
		}
		
		req.execute('sp_execute', (err, result) => {
			if (err) return callback(err);
			
			callback(null, result);
		})
		
		return req;
	}
		
	/*
	Unprepare a prepared statement.
	
	@callback [callback] A callback which is called after unpreparation has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	@returns {PreparedStatement|Promise}
	*/
	
	unprepare(callback) {
		if ('function' === typeof callback) {
			this._unprepare(callback);
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			this._unprepare(err => {
				if (err) return reject(err);
				resolve();
			})
		})
	}
		
	_unprepare(callback) {
		debug('ps: unprepare');
		
		if (!this.prepared) {
			return setImmediate(callback, new PreparedStatementError("Statement is not prepared. Call prepare() first.", 'ENOTPREPARED'));
		}
		
		if (this._activeRequest) {
			return setImmediate(callback, new TransactionError("Can't unprepare the statement. There is a request in progress.", 'EREQINPROG'));
		}

		const req = new driver.Request(this);
		req.stream = false;
		req.input('handle', TYPES.Int, this._handle);
		req.execute('sp_unprepare', err => {
			if (err) return callback(err);
			
			this.parent.release(this._acquiredConnection);
			this._acquiredConnection = null;
			this._handle = 0;
			this.prepared = false;
			
			debug('ps: unprepare ok');
			
			return callback(null);
		});
	}
}

/*
Class Transaction.

@property {Connection} connection Reference to used connection.
@property {Number} isolationLevel Controls the locking and row versioning behavior of TSQL statements issued by a connection. READ_COMMITTED by default.
@property {String} name Transaction name. Empty string by default.

@event begin Dispatched when transaction begin.
@event commit Dispatched on successful commit.
@event rollback Dispatched on successful rollback.
*/

class Transaction extends EventEmitter {
	/*
	Create new Transaction.
	
	@param {Connection} [connection] If ommited, global connection is used instead.
	*/
	
	constructor(parent) {
		super();
		
		this.parent = parent || global_connection;
		this.isolationLevel = ISOLATION_LEVEL.READ_COMMITTED;
		this.name = "";
	}
	
	get connected() {
		return this.parent.connected;
	}
	
	/*
	Acquire connection from this connection pool.
	*/
	
	acquire(request, callback) {
		debug('tran: acquire');
		
		if (!this._acquiredConnection) {
			setImmediate(callback, new TransactionError("Transaction has not begun. Call begin() first.", 'ENOTBEGUN'));
			return this;
		}
		
		if (this._activeRequest) {
			setImmediate(callback, new TransactionError("Can't acquire connection for the request. There is another request in progress.", 'EREQINPROG'));
			return this;
		}
		
		debug('tran: acquire ok');
		
		this._activeRequest = request;
		setImmediate(callback, null, this._acquiredConnection);
		return this;
	}

	/*
	Release connection back to the pool.
	*/
	
	release(connection) {
		debug('tran: release');
		
		if (connection === this._acquiredConnection) {
			this._activeRequest = null;
			debug('tran: release ok');
		}
		
		return this;
	}
	
	/*
	Begin a transaction.
	
	@param {Number} [isolationLevel] Controls the locking and row versioning behavior of TSQL statements issued by a connection.
	@callback [callback] A callback which is called after transaction has began, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction|Promise}
	*/
	
	begin(isolationLevel, callback) {
		if (isolationLevel instanceof Function) {
			callback = isolationLevel;
			isolationLevel = undefined;
		}
			
		if ('function' === typeof callback) {
			this._begin(isolationLevel, err => {
				if (!err) {
					this.emit('begin');
					debug('tran: begin ok');
				}
				callback(err);
			});
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			this._begin(isolationLevel, err => {
				if (err) return reject(err);
				this.emit('begin');
				debug('tran: begin ok');
				resolve(this);
			})
		})
	}
	
	_begin(isolationLevel, callback) {
		debug('tran: begin');
		
		if (this._acquiredConnection) {
			return setImmediate(callback, new TransactionError("Transaction has already begun.", 'EALREADYBEGUN'));
		}
		
		this._aborted = false;
		this._rollbackRequested = false;
		this.isolationLevel = isolationLevel || this.isolationLevel;
			
		setImmediate(callback);
	}
		
	/*
	Commit a transaction.
	
	@callback [callback] A callback which is called after transaction has commited, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction|Promise}
	*/
	
	commit(callback) {
		if ('function' === typeof callback) {
			this._commit(err => {
				if (!err) {
					this.emit('commit');
					debug('tran: commit');
				}
				callback(err);
			});
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			this._commit(err => {
				if (err) return reject(err);
				this.emit('commit');
				debug('tran: commit');
				resolve();
			})
		})
	}
	
	_commit(callback) {
		debug('tran: commit');
		
		if (this._aborted) {
			return setImmediate(callback, new TransactionError("Transaction has been aborted.", 'EABORT'));
		}
		
		if (!this._acquiredConnection) {
			return setImmediate(callback, new TransactionError("Transaction has not begun. Call begin() first.", 'ENOTBEGUN'));
		}
			
		if (this._activeRequest) {
			return setImmediate(callback, new TransactionError("Can't commit transaction. There is a request in progress.", 'EREQINPROG'));
		}
		
		setImmediate(callback);
	}

	/*
	Returns new request using this transaction.
	
	@returns {Request}
	*/
	
	request() {
		return new driver.Request(this);
	}
		
	/*
	Rollback a transaction.
	
	@callback [callback] A callback which is called after transaction has rolled back, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	@returns {Transaction|Promise}
	*/
	
	rollback(callback) {
		if ('function' === typeof callback) {
			this._rollback(err => {
				if (!err) {
					this.emit('rollback', this._aborted);
					debug('tran: rollback ok');
				}
				callback(err);
			});
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			return this._rollback(err => {
				if (err) return reject(err);
				this.emit('rollback', this._aborted);
				debug('tran: rollback ok');
				resolve();
			});
		}
		);
	}
		
	_rollback(callback) {
		debug('tran: rollback');
		
		if (this._aborted) {
			return setImmediate(callback, new TransactionError("Transaction has been aborted.", 'EABORT'));
		}
		
		if (!this._acquiredConnection) {
			return setImmediate(callback, new TransactionError("Transaction has not begun. Call begin() first.", 'ENOTBEGUN'));
		}
			
		if (this._activeRequest) {
			return setImmediate(callback, new TransactionError("Can't rollback transaction. There is a request in progress.", 'EREQINPROG'));
		}
		
		this._rollbackRequested = true;
		
		setImmediate(callback);
	}
}

/*
Class Request.

@property {Connection} connection Reference to used connection.
@property {Transaction} transaction Reference to transaction when request was created in transaction.
@property {*} parameters Collection of input and output parameters.
@property {Boolean} verbose If `true`, debug messages are printed to message log.
@property {Boolean} multiple If `true`, `query` will handle multiple recordsets (`execute` always expect multiple recordsets).
@property {Boolean} canceled `true` if request was canceled.

@event recordset Dispatched when metadata for new recordset are parsed.
@event row Dispatched when new row is parsed.
@event done Dispatched when request is complete.
@event error Dispatched on error.
*/

class Request extends EventEmitter {
	/*
	Create new Request.
	
	@param {Connection|ConnectionPool|Transaction|PreparedStatement} parent If ommited, global connection is used instead.
	*/
	
	constructor(parent) {
		super();
		
		this.verbose = false;
		this.multiple = false;
		this.canceled = false;
		this.parent = parent || global_connection;
		this.parameters = {};
	}
	
	/*
	Log to a function if assigned. Else, use console.log.
	*/

	_log(out) {
		if (typeof this.logger === "function") { return this.logger(out); } else { return console.log(out); }
	}
	
	/*
	Fetch request from tagged template string.
	*/
	
	_template(method, strings, values) {
		let command = [strings[0]];

		for (let index = 0; index < values.length; index++) {
			let value = values[index];
			this.input(`param${index + 1}`, value);
			command.push(`@param${index + 1}`, strings[index + 1]);
		}
		
		return this[method](command.join(''));
	}
	
	/*
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
	*/

	input(name, type, value) {
		if ((/(--| |\/\*|\*\/|')/).test(name)) {
			throw new RequestError(`SQL injection warning for param '${name}'`, 'EINJECT');
		}
			
		if (arguments.length === 1) {
			throw new RequestError("Invalid number of arguments. At least 2 arguments expected.", 'EARGS');
			
		} else if (arguments.length === 2) {
			value = type;
			type = getTypeByValue(value);
		}

		// support for custom data types
		if (value && 'function' === typeof value.valueOf && !(value instanceof Date)) value = value.valueOf();
		
		if (value === undefined) value = null; // undefined to null
		if (value !== value) value = null; // NaN to null
		if (type instanceof Function) type = type();

		this.parameters[name] = {
			name,
			type: type.type,
			io: 1,
			value,
			length: type.length,
			scale: type.scale,
			precision: type.precision,
			tvpType: type.tvpType
		};
		
		return this;
	}
			
	/*
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
	*/
	
	output(name, type, value) {
		if (!type) { type = TYPES.NVarChar; }
		
		if ((/(--| |\/\*|\*\/|')/).test(name)) {
			throw new RequestError(`SQL injection warning for param '${name}'`, 'EINJECT');
		}
		
		if ((type === TYPES.Text) || (type === TYPES.NText) || (type === TYPES.Image)) {
			throw new RequestError("Deprecated types (Text, NText, Image) are not supported as OUTPUT parameters.", 'EDEPRECATED');
		}
		
		// support for custom data types
		if (value && 'function' === typeof value.valueOf && !(value instanceof Date)) value = value.valueOf();

		if (value === undefined) value = null; // undefined to null
		if (value !== value) value = null; // NaN to null
		if (type instanceof Function) type = type();

		this.parameters[name] = {
			name,
			type: type.type,
			io: 2,
			value,
			length: type.length,
			scale: type.scale,
			precision: type.precision
		};
		
		return this;
	}
			
	/*
	Execute the SQL batch.

	@param {String} batch T-SQL batch to be executed.
	@callback [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
		@param {*} recordset Recordset.
	
	@returns {Request|Promise}
	*/
	
	batch(batch, callback) {
		if (this.stream == null && this.connection) this.stream = this.connection.config.stream;
		this.rowsAffected = 0;

		if (this.stream || 'function' === typeof callback) {
			this._batch(batch, (err, recordsets, output, rowsAffected) => {
				if (this.stream) {
					if (err) this.emit('error', err);
					return this.emit('done', {
						output,
						rowsAffected
					});
				}
				
				if (err) return callback(err);
				callback(null, {
					recordsets,
					recordset: recordsets[0],
					output,
					rowsAffected
				});
			})
			return this;
		}
		
		let p;
		return p = new promise_library((resolve, reject) => {
			return this._batch(batch, (err, recordsets, output, rowsAffected) => {
				setImmediate(() => {});
				if (err) return reject(err);
				resolve({
					recordsets,
					recordset: recordsets[0],
					output,
					rowsAffected
				});
			})
		})
	}

	_batch(batch, callback) {
		if (!this.connection) {
			return setImmediate(callback, new RequestError("No connection is specified for that request.", 'ENOCONN'));
		}
		
		if (!this.connection.connected) {
			return setImmediate(callback, new ConnectionError("Connection is closed.", 'ECONNCLOSED'));
		}
		
		this.canceled = false;
		setImmediate(callback);
	}
			
	/*
	Bulk load.

	@param {Table} table SQL table.
	@callback [callback] A callback which is called after bulk load has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
	
	@returns {Request|Promise}
	*/
	
	bulk(table, callback) {
		if (this.stream == null && this.connection) this.stream = this.connection.config.stream;

		if (this.stream || 'function' === typeof callback) {
			this._bulk(table, (err, rowsAffected) => {
				if (this.stream) {
					if (err) this.emit('error', err);
					return this.emit('done', {
						rowsAffected
					});
				}
				
				if (err) return callback(err);
				callback(null, {
					rowsAffected
				});
			})
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			return this._bulk(table, (err, rowsAffected) => {
				if (err) return reject(err);
				resolve({
					rowsAffected
				});
			})
		})
	}

	_bulk(table, callback) {
		if (!this.parent) {
			return setImmediate(callback, new RequestError("No connection is specified for that request.", 'ENOCONN'));
		}
		
		if (!this.parent.connected) {
			return setImmediate(callback, new ConnectionError("Connection is closed.", 'ECONNCLOSED'));
		}
		
		this.canceled = false;
		setImmediate(callback);
	}
	
	/*
	Sets request to `stream` mode and pulls all rows from all recordsets to a given stream.
	
	@param {Stream} stream Stream to pipe data into.
	@returns {Stream}
	*/
	
	pipe(stream) {
		this.stream = true;
		this.on('row', stream.write.bind(stream));
		this.on('error', stream.emit.bind(stream, 'error'));
		this.on('done', () => setImmediate(() => stream.end()));
		stream.emit('pipe', this);
		return stream;
	}
	
	/*
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
	@callback [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
		@param {*} recordset Recordset.
	
	@returns {Request|Promise}
	*/
	
	query(command, callback) {
		if (this.stream == null && this.connection) this.stream = this.connection.config.stream;
		this.rowsAffected = 0;

		if (this.stream || 'function' === typeof callback) {
			this._query(command, (err, recordsets, output, rowsAffected) => {
				if (this.stream) {
					if (err) this.emit('error', err);
					return this.emit('done', {
						output,
						rowsAffected
					});
				}
				
				if (err) return callback(err);
				callback(null, {
					recordsets,
					recordset: recordsets[0],
					output,
					rowsAffected
				});
			})
			return this;
		}
		
		let p;
		return p = new promise_library((resolve, reject) => {
			return this._query(command, (err, recordsets, output, rowsAffected) => {
				setImmediate(() => {});
				if (err) return reject(err);
				resolve({
					recordsets,
					recordset: recordsets[0],
					output,
					rowsAffected
				});
			})
		})
	}

	_query(command, callback) {
		if (!this.parent) {
			return setImmediate(callback, new RequestError("No connection is specified for that request.", 'ENOCONN'));
		}
		
		if (!this.parent.connected) {
			return setImmediate(callback, new ConnectionError("Connection is closed.", 'ECONNCLOSED'));
		}
		
		this.canceled = false;
		setImmediate(callback);
	}
	
	/*
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
	@callback [callback] A callback which is called after execution has completed, or an error has occurred. If omited, method returns Promise.
		@param {Error} err Error on error, otherwise null.
		@param {Array} recordsets Recordsets.
		@param {Number} returnValue Procedure return value.
	
	@returns {Request|Promise}
	*/
	
	execute(command, callback) {
		if (this.stream == null && this.connection) this.stream = this.connection.config.stream;
		this.rowsAffected = 0;
		
		if (this.stream || 'function' === typeof callback) {
			this._execute(command, (err, recordsets, output, returnValue, rowsAffected) => {
				if (this.stream) {
					if (err) this.emit('error', err);
					return this.emit('done', {
						output,
						rowsAffected,
						returnValue
					});
				}
				
				if (err) return callback(err);
				callback(null, {
					recordsets,
					recordset: recordsets[0],
					output,
					rowsAffected,
					returnValue
				});
			})
			return this;
		}
		
		return new promise_library((resolve, reject) => {
			return this._execute(command, function(err, recordsets, output, returnValue, rowsAffected) {
				if (err) return reject(err);
				resolve({
					recordsets,
					recordset: recordsets[0],
					output,
					rowsAffected,
					returnValue
				});
			})
		})
	}
	
	_execute(procedure, callback) {
		if (!this.parent) {
			return setImmediate(callback, new RequestError("No connection is specified for that request.", 'ENOCONN'));
		}
		
		if (!this.parent.connected) {
			return setImmediate(callback, new ConnectionError("Connection is closed.", 'ECONNCLOSED'));
		}
		
		this.canceled = false;
		setImmediate(callback);
	}
	
	/*
	Cancel currently executed request.
	
	@returns {Boolean}
	*/
	
	cancel() {
		this._cancel();
		return true;
	}
	
	_cancel() {
		this.canceled = true;
	}
}

class ConnectionError extends Error {
	constructor(message, code) {
		if (message instanceof Error) {
			super(message.message);
			this.code = message.code || code;

			Object.defineProperty(this, 'originalError', {enumerable: true, value: message});
		} else {
			super(message);
			this.code = code;
		}
		
		this.name = 'ConnectionError';

		//Error.captureStackTrace(this, this.constructor);
	}
}

class TransactionError extends Error {
	constructor(message, code) {
		if (message instanceof Error) {
			super(message.message);
			this.code = message.code || code;

			Object.defineProperty(this, 'originalError', {enumerable: true, value: message});
		} else {
			super(message);
			this.code = code;
		}
		
		this.name = 'TransactionError';

		//Error.captureStackTrace(this, this.constructor);
	}
}

class RequestError extends Error {
	constructor(message, code) {
		if (message instanceof Error) {
			super(message.message);
			this.code = message.code || code;
			
			if (message.info) {
				this.number = message.info.number || message.code; // err.code is returned by msnodesql driver
				this.lineNumber = message.info.lineNumber;
				this.state = message.info.state || message.sqlstate; // err.sqlstate is returned by msnodesql driver
				this.class = message.info.class;
				this.serverName = message.info.serverName;
				this.procName = message.info.procName;
			} else {
				this.number = message.code; // err.code is returned by msnodesql driver
				this.state = message.sqlstate; // err.sqlstate is returned by msnodesql driver
			}

			Object.defineProperty(this, 'originalError', {enumerable: true, value: message});
		} else {
			super(message);
			this.code = code;
		}
		
		this.name = 'RequestError';
		if ((/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(this.message)) {
			this.message = RegExp.$1;
		}

		//Error.captureStackTrace(this, this.constructor);
	}
}

class PreparedStatementError extends Error {
	constructor(message, code) {
		if (message instanceof Error) {
			super(message.message);
			this.code = message.code || code;

			Object.defineProperty(this, 'originalError', {enumerable: true, value: message});
		} else {
			super(message);
			this.code = code;
		}

		this.name = 'PreparedStatementError';
		
		//Error.captureStackTrace(this, this.constructor);
	}
}

// Exports

module.exports = {
	ConnectionPool,
	Transaction,
	Request,
	PreparedStatement,
	ConnectionError,
	TransactionError,
	RequestError,
	PreparedStatementError,
	exports: {
		ConnectionError,
		TransactionError,
		RequestError,
		PreparedStatementError,
		Table,
		ISOLATION_LEVEL,
		TYPES,
		MAX: 65535, // (1 << 16) - 1
		map
	},
	driver,
	Promise: global.Promise
}

Object.defineProperty(module.exports, 'Promise', {
	get: () => {
		return promise_library;
	},
	set: (value) => {
		promise_library = value;
	}
})

// append datatypes to this modules export

for (let key in TYPES) {
	let value = TYPES[key];
	module.exports.exports[key] = value;
	module.exports.exports[key.toUpperCase()] = value;
}

/*
Open global connection.

@param {Object} config Connection configuration.
@callback callback A callback which is called after connection has established, or an error has occurred.
	@param {Error} err Error on error, otherwise null.
	
@returns {Connection}
*/

module.exports.exports.connect = function connect(config, callback) {
	if (global_connection) throw new Error("Global connection already exists. Call sql.close() first.");
	global_connection = new driver.ConnectionPool(config);
	
	for (let event in global_connection_handlers) {
		for (let i = 0, l = global_connection_handlers[event].length; i < l; i++) {
			global_connection.on(event, global_connection_handlers[event][i]);
		}
	}
	
	return global_connection.connect(callback);
}

/*
Close global connection.
	
@returns {Connection}
*/

module.exports.exports.close = function close(callback) {
	if (global_connection) {
		// remove event handlers from the global connection
		for (let event in global_connection_handlers) {
			for (let i = 0, l = global_connection_handlers[event].length; i < l; i++) {
				global_connection.removeListener(event, global_connection_handlers[event][i]);
			}
		}
		
		// attach error handler to prevent process crash in case of error
		global_connection.on('error', err => {
			if (global_connection_handlers['error']) {
				for (let i = 0, l = global_connection_handlers['error'].length; i < l; i++) {
					global_connection_handlers['error'][i].call(global_connection, err);
				}
			}
		})
		
		const gc = global_connection;
		global_connection = null;
		return gc.close(callback);
	}
	
	if ('function' === typeof callback) {
		setImmediate(callback);
		return null;
	}
	
	return new promise_library((resolve, reject) => {
		resolve(global_connection);
	})
}

/*
Attach event handler to global connection.

@param {String} event Event name.
@param {Function} handler Event handler.
@returns {Connection}
*/

module.exports.exports.on = function on(event, handler) {
	if (!global_connection_handlers[event]) global_connection_handlers[event] = [];
	global_connection_handlers[event].push(handler);
	
	if (global_connection) global_connection.on(event, handler);
	return global_connection;
}

/*
Detach event handler from global connection.

@param {String} event Event name.
@param {Function} handler Event handler.
@returns {Connection}
*/

module.exports.exports.removeListener = module.exports.exports.off = function removeListener(event, handler) {
	if (!global_connection_handlers[event]) return global_connection;
	const index = global_connection_handlers[event].indexOf(handler);
	if (index === -1) return global_connection;
	global_connection_handlers[event].splice(index, 1);
	if (global_connection_handlers[event].length === 0) global_connection_handlers[event] = undefined;
	
	if (global_connection) global_connection.removeListener(event, handler);
	return global_connection;
}

/*
Creates a new query using global connection from a tagged template string.

@param {Array} strings Array of string literals.
@param {...*} keys Values.
@returns {Request}
*/

module.exports.exports.query = function query() {
	const values = Array.prototype.slice.call(arguments);
	const strings = values.shift();

	return new driver.Request()._template('query', strings, values);
}

/*
Creates a new batch using global connection from a tagged template string.

@param {Array} strings Array of string literals.
@param {...*} keys Values.
@returns {Request}
*/

module.exports.exports.batch = function batch() {
	const values = Array.prototype.slice.call(arguments);
	const strings = values.shift();
	
	return new driver.Request()._template('batch', strings, values);
}
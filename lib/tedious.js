'use strict'

const tds = require('tedious');
const util = require('util');
const debug = require('debug')('mssql:tedious');

const base = require('./base');
const TYPES = require('./datatypes').TYPES;
const declare = require('./datatypes').declare;
const cast = require('./datatypes').cast;
const DECLARATIONS = require('./datatypes').DECLARATIONS;
const UDT = require('./udt').PARSERS;
const Table = require('./table');

const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B';
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B';

/*
@ignore
*/

const bindDomain = function(cb) {
	if (process.domain) {
		return __guard__(process.domain, x => x.bind(cb));
	} else {
		return cb;
	}
};

/*
@ignore
*/

const getTediousType = function(type) {
	switch (type) {
		case TYPES.VarChar: return tds.TYPES.VarChar;
		case TYPES.NVarChar: return tds.TYPES.NVarChar;
		case TYPES.Text: return tds.TYPES.Text;
		case TYPES.Int: return tds.TYPES.Int;
		case TYPES.BigInt: return tds.TYPES.BigInt;
		case TYPES.TinyInt: return tds.TYPES.TinyInt;
		case TYPES.SmallInt: return tds.TYPES.SmallInt;
		case TYPES.Bit: return tds.TYPES.Bit;
		case TYPES.Float: return tds.TYPES.Float;
		case TYPES.Decimal: return tds.TYPES.Decimal;
		case TYPES.Numeric: return tds.TYPES.Numeric;
		case TYPES.Real: return tds.TYPES.Real;
		case TYPES.Money: return tds.TYPES.Money;
		case TYPES.SmallMoney: return tds.TYPES.SmallMoney;
		case TYPES.Time: return tds.TYPES.TimeN;
		case TYPES.Date: return tds.TYPES.DateN;
		case TYPES.DateTime: return tds.TYPES.DateTime;
		case TYPES.DateTime2: return tds.TYPES.DateTime2N;
		case TYPES.DateTimeOffset: return tds.TYPES.DateTimeOffsetN;
		case TYPES.SmallDateTime: return tds.TYPES.SmallDateTime;
		case TYPES.UniqueIdentifier: return tds.TYPES.UniqueIdentifierN;
		case TYPES.Xml: return tds.TYPES.NVarChar;
		case TYPES.Char: return tds.TYPES.Char;
		case TYPES.NChar: return tds.TYPES.NChar;
		case TYPES.NText: return tds.TYPES.NVarChar;
		case TYPES.Image: return tds.TYPES.Image;
		case TYPES.Binary: return tds.TYPES.Binary;
		case TYPES.VarBinary: return tds.TYPES.VarBinary;
		case TYPES.UDT: case TYPES.Geography: case TYPES.Geometry: return tds.TYPES.UDT;
		case TYPES.TVP: return tds.TYPES.TVP;
		case TYPES.Variant: return tds.TYPES.Variant;
		default: return type;
	}
};

/*
@ignore
*/

const getMssqlType = function(type, length) {
	switch (type) {
		case tds.TYPES.Char: return TYPES.Char;
		case tds.TYPES.NChar: return TYPES.NChar;
		case tds.TYPES.VarChar: return TYPES.VarChar;
		case tds.TYPES.NVarChar: return TYPES.NVarChar;
		case tds.TYPES.Text: return TYPES.Text;
		case tds.TYPES.NText: return TYPES.NText;
		case tds.TYPES.Int: return TYPES.Int;
		case tds.TYPES.IntN:
			if (length === 8) { return TYPES.BigInt; }
			if (length === 4) { return TYPES.Int; }
			if (length === 2) { return TYPES.SmallInt; }
			return TYPES.TinyInt;
			
		case tds.TYPES.BigInt: return TYPES.BigInt;
		case tds.TYPES.TinyInt: return TYPES.TinyInt;
		case tds.TYPES.SmallInt: return TYPES.SmallInt;
		case tds.TYPES.Bit: case tds.TYPES.BitN: return TYPES.Bit;
		case tds.TYPES.Float: return TYPES.Float;
		case tds.TYPES.FloatN:
			if (length === 8) { return TYPES.FloatN; }
			return TYPES.Real;
		
		case tds.TYPES.Real: return TYPES.Real;
		case tds.TYPES.Money: return TYPES.Money;
		case tds.TYPES.MoneyN:
			if (length === 8) { return TYPES.Money; }
			return TYPES.SmallMoney;
			
		case tds.TYPES.SmallMoney: return TYPES.SmallMoney;
		case tds.TYPES.Numeric: case tds.TYPES.NumericN: return TYPES.Numeric;
		case tds.TYPES.Decimal: case tds.TYPES.DecimalN: return TYPES.Decimal;
		case tds.TYPES.DateTime: return TYPES.DateTime;
		case tds.TYPES.DateTimeN:
			if (length === 8) { return TYPES.DateTime; }
			return TYPES.SmallDateTime;
		
		case tds.TYPES.TimeN: return TYPES.Time;
		case tds.TYPES.DateN: return TYPES.Date;
		case tds.TYPES.DateTime2N: return TYPES.DateTime2;
		case tds.TYPES.DateTimeOffsetN: return TYPES.DateTimeOffset;
		case tds.TYPES.SmallDateTime: return TYPES.SmallDateTime;
		case tds.TYPES.UniqueIdentifierN: return TYPES.UniqueIdentifier;
		case tds.TYPES.Image: return TYPES.Image;
		case tds.TYPES.Binary: return TYPES.Binary;
		case tds.TYPES.VarBinary: return TYPES.VarBinary;
		case tds.TYPES.Xml: return TYPES.Xml;
		case tds.TYPES.UDT: return TYPES.UDT;
		case tds.TYPES.TVP: return TYPES.TVP;
		case tds.TYPES.Variant: return TYPES.Variant;
	}
};

/*
@ignore
*/

const createColumns = function(metadata) {
	let out = {};
	for (let index = 0; index < metadata.length; index++) {
		let column = metadata[index];
		out[column.colName] = {
			index,
			name: column.colName,
			length: column.dataLength,
			type: getMssqlType(column.type, column.dataLength),
			scale: column.scale,
			precision: column.precision,
			nullable: !!(column.flags & 0x01),
			caseSensitive: !!(column.flags & 0x02),
			identity: !!(column.flags & 0x10),
			readOnly: !(column.flags & 0x0C)
		};

		if (column.udtInfo != null) {
			out[column.colName].udt = {
				name: column.udtInfo.typeName,
				database: column.udtInfo.dbname,
				schema: column.udtInfo.owningSchema,
				assembly: column.udtInfo.assemblyName
			};
			
			if (DECLARATIONS[column.udtInfo.typeName]) {
				out[column.colName].type = DECLARATIONS[column.udtInfo.typeName];
			}
		}
	}
	
	return out;
};

/*
@ignore
*/

const valueCorrection = function(value, metadata) {
	if ((metadata.type === tds.TYPES.UDT) && (value != null)) {
		if (UDT[metadata.udtInfo.typeName]) {
			return UDT[metadata.udtInfo.typeName](value);
			
		} else {
			return value;
		}
		
	} else {
		return value;
	}
};

/*
@ignore
*/

const parameterCorrection = function(value) {
	if (value instanceof Table) {
		let tvp = {
			name: value.name,
			schema: value.schema,
			columns: [],
			rows: value.rows
		};
			
		for (let col of Array.from(value.columns)) {
			tvp.columns.push({
				name: col.name,
				type: getTediousType(col.type),
				length: col.length,
				scale: col.scale,
				precision: col.precision
			});
		}
			
		return tvp;
			
	} else {
		return value;
	}
}

class ConnectionPool extends base.ConnectionPool {
	_poolCreate() {
		return new base.Promise((resolve, reject) => {
			const cfg = {
				userName: this.config.user,
				password: this.config.password,
				server: this.config.server,
				options: Object.assign({}, this.config.options),
				domain: this.config.domain
			};
			
			cfg.options.database = this.config.database;
			cfg.options.port = this.config.port;
			cfg.options.connectTimeout = this.config.connectionTimeout || this.config.timeout || 15000;
			cfg.options.requestTimeout = this.config.requestTimeout != null ? this.config.requestTimeout : 15000;
			cfg.options.tdsVersion = cfg.options.tdsVersion || '7_4';
			cfg.options.rowCollectionOnDone = false;
			cfg.options.rowCollectionOnRequestCompletion = false;
			cfg.options.useColumnNames = false;
			cfg.options.appName = cfg.options.appName || 'node-mssql';
			
			// tedious always connect via tcp when port is specified
			if (cfg.options.instanceName) delete cfg.options.port;
			
			if (isNaN(cfg.options.requestTimeout)) cfg.options.requestTimeout = 15000;
			if (cfg.options.requestTimeout === Infinity) cfg.options.requestTimeout = 0;
			if (cfg.options.requestTimeout < 0) cfg.options.requestTimeout = 0;
			
			if (this.config.debug) {
				cfg.options.debug = {
					packet: true,
					token: true,
					data: true,
					payload: true
				}
			}
			
			const tedious = new tds.Connection(cfg);

			tedious.once('connect', err => {
				if (err) {
					err = new base.ConnectionError(err);
					return reject(err);
				}
				
				resolve(tedious);
			})
			
			tedious.on('error', err => {
				if (err.code === 'ESOCKET') {
					tedious.hasError = true;
					return;
				}

				this.emit('error', err);
			})
			
			if (this.config.debug) {
				tedious.on('debug', msg => this._debug(msg));
			}
		})
	}
	
	_poolValidate(tedious) {
		return new base.Promise((resolve, reject) => {
			resolve(!tedious.closed && !tedious.hasError);
		})
	}
	
	_poolDestroy(tedious) {
		return new base.Promise((resolve, reject) => {
			tedious.once('end', () => {
				resolve();
			})
			
			tedious.close();
		})
	}
}

class Transaction extends base.Transaction {
	constructor(parent) {
		super(parent);
		
		this._abort = () => {
			if (!this._rollbackRequested) {
				// transaction interrupted because of XACT_ABORT
				
				const pc = this._acquiredConnection;
				
				// defer releasing so connection can switch from SentClientRequest to LoggedIn state
				setImmediate(this.parent.release.bind(this.parent), pc);

				this._acquiredConnection.removeListener('rollbackTransaction', this._abort);
				this._acquiredConnection = null;
				this._aborted = true;
				
				this.emit('rollback', true);
			}
		}
	}

	_begin(isolationLevel, callback) {
		super._begin(isolationLevel, err => {
			if (err) return callback(err);
			
			debug('tran: begin');
			
			this.parent.acquire(this, (err, connection) => {
				if (err) return callback(err);
				
				this._acquiredConnection = connection;
				this._acquiredConnection.on('rollbackTransaction', this._abort);

				connection.beginTransaction(err => {
					if (err) err = new base.TransactionError(err);
				
					debug('tran: begin ok');
					
					callback(err);
				}, this.name, this.isolationLevel);
			})
		})
	}
		
	_commit(callback) {
		super._commit(err => {
			if (err) return callback(err);
			
			debug('tran: commit');
			
			this._acquiredConnection.commitTransaction(err => {
				if (err) err = new base.TransactionError(err);
				
				this._acquiredConnection.removeListener('rollbackTransaction', this._abort);
				this.parent.release(this._acquiredConnection);
				this._acquiredConnection = null;
				
				if (!err) debug('tran: commit ok');
				
				callback(err);
			})
		})
	}

	_rollback(callback) {
		super._rollback(err => {
			if (err) return callback(err);
			
			debug('tran: rollback');
			
			this._acquiredConnection.rollbackTransaction(err => {
				if (err) err = new base.TransactionError(err);
				
				this._acquiredConnection.removeListener('rollbackTransaction', this._abort);
				this.parent.release(this._acquiredConnection);
				this._acquiredConnection = null;
				
				if (!err) debug('tran: rollback ok');
				
				callback(err);
			})
		})
	}
}
	
class Request extends base.Request {
	/*
	Execute specified sql batch.
	*/
	
	_batch(batch, callback) {
		this._isBatch = true;
		this._query(batch, callback);
	}
	
	/*
	Bulk load.
	*/
	
	_bulk(table, callback) {
		super._bulk(table, err => {
			if (err) return callback(err);
			
			let event, handler;
			table._makeBulk();
			
			if (!table.name) {
				process.nextTick(() => callback(new base.RequestError("Table name must be specified for bulk insert.", "ENAME")));
			}
				
			if (table.name.charAt(0) === '@') {
				process.nextTick(() => callback(new base.RequestError("You can't use table variables for bulk insert.", "ENAME")));
			}
	
			let started = Date.now();
			let errors = [];
			let errorHandlers = {};
			let hasReturned = false;
			let handleError = (doReturn, connection, info) => {
				let err = new Error(info.message);
				err.info = info;
				let e = new base.RequestError(err, 'EREQUEST');
	
				if (this.stream) {
					this.emit('error', e);
				
				} else {
					if (doReturn && !hasReturned) {
						if (connection != null) {
							for (event in errorHandlers) {
								handler = errorHandlers[event];
								connection.removeListener(event, handler);
							}
								
							this.parent.release(connection);
						}
							
						hasReturned = true;
						__guardFunc__(callback, f => f(e));
					}
				}
	
				// we must collect errors even in stream mode
				return errors.push(e);
			};
			
			let handleInfo = msg => {
				return this.emit('info', {
					message: msg.message,
					number: msg.number,
					state: msg.state,
					class: msg.class,
					lineNumber: msg.lineNumber,
					serverName: msg.serverName,
					procName: msg.procName
				}
				);
			};
	
			this.parent.acquire(this, (err, connection) => {
				if (!err) {
					if (this.verbose) { this._log(`-------- sql bulk load --------\n    table: ${table.name}`); }
	
					if (this.canceled) {
						debug('req: canceling');
						this.parent.release(connection);
						return __guardFunc__(callback, f => f(new base.RequestError("Canceled.", 'ECANCEL')));
					}
					
					this._cancel = () => {
						debug('req: cancel');
						return connection.cancel();
					};
					
					// attach handler to handle multiple error messages
					errorHandlers['infoMessage'] = handleInfo;
					errorHandlers['errorMessage'] = handleError.bind(undefined, false, connection);
					errorHandlers['error']        = handleError.bind(undefined, true, connection);
					connection.on('infoMessage', errorHandlers['infoMessage']);
					connection.on('errorMessage', errorHandlers['errorMessage']);
					connection.on('error',        errorHandlers['error']);
	
					let done = bindDomain((err, rowCount) => {
						// to make sure we handle no-sql errors as well
						let error;
						if (err && (err.message !== __guard__(errors[errors.length - 1], x => x.message))) {
							err = new base.RequestError(err, 'EREQUEST');
							
							if (this.stream) {
								this.emit('error', err);
							}
							
							errors.push(err);
						}
						
						// TODO ----
						
						if (this.verbose) { 
							if (errors.length) {
								for (error of Array.from(errors)) { this._log(`    error: ${error}`); }
							}
							
							let elapsed = Date.now() - started;
							this._log(` duration: ${elapsed}ms`);
							this._log("---------- completed ----------");
						}
			
						this._cancel = null;
						
						if (errors.length && !this.stream) {
							error = errors.pop();
							error.precedingErrors = errors;
						}
						
						if (!hasReturned) {
							for (event in errorHandlers) {
								handler = errorHandlers[event];
								connection.removeListener(event, handler);
							}
							this.parent.release(connection);
							hasReturned = true;
						
							if (this.stream) {
								return callback(null, null);
						
							} else {
								return __guardFunc__(callback, f1 => f1(error, rowCount));
							}
						}
					}
					);
					
					let bulk = connection.newBulkLoad(table.path, done);
	
					for (let col of Array.from(table.columns)) {
						bulk.addColumn(col.name, getTediousType(col.type), {nullable: col.nullable, length: col.length, scale: col.scale, precision: col.precision});
					}
					
					for (let row of Array.from(table.rows)) {
						bulk.addRow(row);
					}
					
					if (this.verbose) { this._log("---------- response -----------"); }
					
					if (table.create) {
						let objectid;
						if (table.temporary) {
							objectid = `tempdb..[${table.name}]`;
						} else {
							objectid = table.path;
						}
						
						let req = new tds.Request(`if object_id('${objectid.replace(/'/g, '\'\'')}') is null ${table.declare()}`, err => {
							if (err) { return done(err); }
							
							return connection.execBulkLoad(bulk);
						}
						);
						
						return connection.execSqlBatch(req);
							
					} else {
						return connection.execBulkLoad(bulk);
					}
				}
			}
			);
		})
	}

	/*
	Execute specified sql command.
	*/

	_query(command, callback) {
		super._query(command, err => {
			if (err) return callback(err);
			
			let event, handler;
			let columns = {};
			let recordset = [];
			let recordsets = [];
			let started = Date.now();
			let errors = [];
			let batchLastRow = null;
			let batchHasOutput = false;
			let isJSONRecordset = false;
			let isChunkedRecordset = false;
			let chunksBuffer = null;
			let xmlBuffer = null;
			let hasReturned = false;
			let errorHandlers = {};
			let handleError = (doReturn, connection, info) => {
				let err = new Error(info.message);
				err.info = info;
				let e = new base.RequestError(err, 'EREQUEST');
				
				if (this.stream) {
					this.emit('error', e);
				
				} else {
					if (doReturn && !hasReturned) {
						if (connection != null) {
							for (event in errorHandlers) {
								handler = errorHandlers[event];
								connection.removeListener(event, handler);
							}
							
							this.parent.release(connection);
						}
							
						hasReturned = true;
						__guardFunc__(callback, f => f(e));
					}
				}
	
				// we must collect errors even in stream mode
				return errors.push(e);
			};
			
			let handleInfo = msg => {
				return this.emit('info', {
					message: msg.message,
					number: msg.number,
					state: msg.state,
					class: msg.class,
					lineNumber: msg.lineNumber,
					serverName: msg.serverName,
					procName: msg.procName
				}
				);
			};
			
			this.parent.acquire(this, (err, connection) => {
				if (!err) {
					let name, param, row, value;
					if (this.verbose) { this._log(`---------- sql ${this._isBatch ? 'batch' : 'query'} ----------\n    ${this._isBatch ? 'batch' : 'query'}: ${command}`); }
	
					if (this.canceled) {
						debug('req: canceling');
						this.parent.release(connection);
						return __guardFunc__(callback, f => f(new base.RequestError("Canceled.", 'ECANCEL')));
					}
					
					this._cancel = () => {
						debug('req: cancel');
						return connection.cancel();
					};
					
					// attach handler to handle multiple error messages
					errorHandlers['infoMessage'] = handleInfo;
					errorHandlers['errorMessage'] = handleError.bind(undefined, false, connection);
					errorHandlers['error']        = handleError.bind(undefined, true, connection);
					connection.on('infoMessage', errorHandlers['infoMessage']);
					connection.on('errorMessage', errorHandlers['errorMessage']);
					connection.on('error',        errorHandlers['error']);
					
					let req = new tds.Request(command, bindDomain(err => {
						// to make sure we handle no-sql errors as well
						let error;
						if (err && (err.message !== __guard__(errors[errors.length - 1], x => x.message))) {
							err = new base.RequestError(err, 'EREQUEST');
							
							if (this.stream) {
								this.emit('error', err);
							}
							
							errors.push(err);
						}
						
						// process batch outputs
						if (batchHasOutput) {
							if (!this.stream) {
								batchLastRow = recordsets.pop()[0];
							}
							
							for (name in batchLastRow) {
								value = batchLastRow[name];
								if (name !== '___return___') {
									if (this.verbose) {
										if (value === tds.TYPES.Null) {
											this._log(`   output: @${name}, null`);
										} else {
											this._log(`   output: @${name}, ${this.parameters[name].type.declaration.toLowerCase()}, ${value}`);
										}
									}
								
									this.parameters[name].value = value === tds.TYPES.Null ? null : value;
								}
							}
						}
						
						if (this.verbose) { 
							if (errors.length) {
								for (error of Array.from(errors)) { this._log(`    error: ${error}`); }
							}
							
							let elapsed = Date.now() - started;
							this._log(` duration: ${elapsed}ms`);
							this._log("---------- completed ----------");
						}
	
						this._cancel = null;
						
						if (errors.length && !this.stream) {
							error = errors.pop();
							error.precedingErrors = errors;
						}
						
						if (!hasReturned) {
							for (event in errorHandlers) {
								handler = errorHandlers[event];
								connection.removeListener(event, handler);
							}
							
							this.parent.release(connection);
							hasReturned = true;
	
							if (this.stream) {
								return callback(null, null);
							
							} else {
								return __guardFunc__(callback, f1 => f1(error, this.multiple ? recordsets : recordsets[0]));
							}
						}
					}));
					
					req.on('columnMetadata', metadata => {
						columns = createColumns(metadata);
						
						isChunkedRecordset = false;
						if ((metadata.length === 1) && [JSON_COLUMN_ID, XML_COLUMN_ID].includes(metadata[0].colName)) {
							isChunkedRecordset = true;
							chunksBuffer = [];
						}
						
						if (this.stream) {
							if (this._isBatch) {
								// don't stream recordset with output values in batches
								if (columns["___return___"] == null) {
									return this.emit('recordset', columns);
								}
							
							} else {
								return this.emit('recordset', columns);
							}
						}
					}
					);
	
					let doneHandler = (rowCount, more) => {
						// this function is called even when select only set variables so we should skip adding a new recordset
						if (Object.keys(columns).length === 0) {
							if (rowCount > 0) { this.rowsAffected += rowCount; }
							return;
						}
						
						if (isChunkedRecordset) {
							if (columns[JSON_COLUMN_ID] && (this.connection.config.parseJSON === true)) {
								try {
									row = JSON.parse(chunksBuffer.join(''));
								} catch (ex) {
									row = null;
									ex = new base.RequestError(new Error(`Failed to parse incoming JSON. ${ex.message}`), 'EJSON');
									
									if (this.stream) {
										this.emit('error', ex);
									}
									
									// we must collect errors even in stream mode
									errors.push(ex);
								}
							
							} else {
								row = {};
								row[Object.keys(columns)[0]] = chunksBuffer.join('');
							}
							
							chunksBuffer = null;
	
							if (this.verbose) {
								this._log(util.inspect(row));
								this._log("---------- --------------------");
							}
							
							if (this.stream) {
								this.emit('row', row);
								
							} else {
								recordset.push(row);
							}
						}
	
						if (!this.stream) {
							// all rows of current recordset loaded
							Object.defineProperty(recordset, 'columns', { 
								enumerable: false,
								value: columns
							}
							);
								
							Object.defineProperty(recordset, 'toTable', { 
								enumerable: false,
								value() { return Table.fromRecordset(this); }
							}
							);
								
							recordsets.push(recordset);
						}
							
						recordset = [];
						return columns = {};
					};
					
					req.on('doneInProc', doneHandler); // doneInProc handlers are used in both queries and batches
					req.on('done', doneHandler); // done handlers are used in batches
					
					req.on('returnValue', (parameterName, value, metadata) => {
						if (this.verbose) {
							if (value === tds.TYPES.Null) {
								this._log(`   output: @${parameterName}, null`);
							} else {
								this._log(`   output: @${parameterName}, ${this.parameters[parameterName].type.declaration.toLowerCase()}, ${value}`);
							}
						}
								
						return this.parameters[parameterName].value = value === tds.TYPES.Null ? null : value;
					}
					);
					
					req.on('row', columns => {
						if (!recordset) {
							recordset = [];
						}
						
						if (isChunkedRecordset) {
							return chunksBuffer.push(columns[0].value);
						
						} else {
							row = {};
							for (let col of Array.from(columns)) {
								col.value = valueCorrection(col.value, col.metadata);
								
								let exi = row[col.metadata.colName];
								if (exi != null) {
									if (exi instanceof Array) {
										exi.push(col.value);
										
									} else {
										row[col.metadata.colName] = [exi, col.value];
									}
								
								} else {
									row[col.metadata.colName] = col.value;
								}
							}
						
							if (this.verbose) {
								this._log(util.inspect(row));
								this._log("---------- --------------------");
							}
							
							if (this.stream) {
								if (this._isBatch) {
									// dont stream recordset with output values in batches
									if (row["___return___"] != null) {
										return batchLastRow = row;
									
									} else {
										return this.emit('row', row);
									}
								
								} else {
									return this.emit('row', row);
								}
								
							} else {
								return recordset.push(row);
							}
						}
					}
					);
					
					if (this._isBatch) {
						if (Object.keys(this.parameters).length) {
							for (name in this.parameters) {
								param = this.parameters[name];
								value = getTediousType(param.type).validate(param.value);
								if (value instanceof TypeError) {
									value = new base.RequestError(`Validation failed for parameter \'${name}\'. ${value.message}`, 'EPARAM');
									
									if (this.verbose) {
										this._log(`    error: ${value}`);
										this._log("---------- completed ----------");
									}
										
									this.parent.release(connection);
									return __guardFunc__(callback, f1 => f1(value));
								}
									
								param.value = value;
							}
							
							let declarations = ((() => {
								let result = [];
								for (name in this.parameters) {
									param = this.parameters[name];
									result.push(`@${name} ${declare(param.type, param)}`);
								}
								return result;
							})());
							let assigns = ((() => {
								let result1 = [];
								for (name in this.parameters) {
									param = this.parameters[name];
									result1.push(`@${name} = ${cast(param.value, param.type, param)}`);
								}
								return result1;
							})());
							let selects = ((() => {
								let result2 = [];
								for (name in this.parameters) {
									param = this.parameters[name];
									if (param.io === 2) {
										result2.push(`@${name} as [${name}]`);
									}
								}
								return result2;
							})());
							batchHasOutput = selects.length > 0;
							
							req.sqlTextOrProcedure = `declare ${declarations.join(', ')};select ${assigns.join(', ')};${req.sqlTextOrProcedure};${batchHasOutput ? (`select 1 as [___return___], ${selects.join(', ')}`) : ''}`;
						}
					
					} else {
						for (name in this.parameters) {
							param = this.parameters[name];
							if (this.verbose) {
								if (param.value === tds.TYPES.Null) {
									this._log(`   ${param.io === 1 ? " input" : "output"}: @${param.name}, null`);
								} else {
									this._log(`   ${param.io === 1 ? " input" : "output"}: @${param.name}, ${param.type.declaration.toLowerCase()}, ${param.value}`);
								}
							}
							
							if (param.io === 1) {
								req.addParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision});
							} else {
								req.addOutputParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision});
							}
						}
					}
					
					if (this.verbose) { this._log("---------- response -----------"); }
					return connection[this._isBatch ? 'execSqlBatch' : 'execSql'](req);
				
				} else {
					if (connection) { this.parent.release(connection); }
					return __guardFunc__(callback, f2 => f2(err));
				}
			}
			);
		})
	}
				
	/*
	Execute stored procedure with specified parameters.
	*/
	
	_execute(procedure, callback) {
		super._execute(procedure, err => {
			if (err) return callback(err);
			
			let event, handler;
			let columns = {};
			let recordset = [];
			let recordsets = [];
			let returnValue = 0;
			let started = Date.now();
			let errors = [];
			let isChunkedRecordset = false;
			let chunksBuffer = null;
			let hasReturned = false;
			let errorHandlers = {};
			let handleError = (doReturn, connection, info) => {
				let err = new Error(info.message);
				err.info = info;
				let e = new base.RequestError(err, 'EREQUEST');
				
				if (this.stream) {
					this.emit('error', e);
				
				} else {
					if (doReturn && !hasReturned) {
						if (connection != null) {
							for (event in errorHandlers) {
								handler = errorHandlers[event];
								connection.removeListener(event, handler);
							}
							
							this._release(connection);
						}
						
						hasReturned = true;
						__guardFunc__(callback, f => f(e));
					}
				}
					
				// we must collect errors even in stream mode
				return errors.push(e);
			};
	
			this.parent.acquire(this, (err, connection) => {
				if (!err) {
					let row;
					if (this.verbose) { this._log(`---------- sql execute --------\n     proc: ${procedure}`); }
					
					if (this.canceled) {
						debug('req: canceling');
						this.parent.release(connection);
						return __guardFunc__(callback, f => f(new base.RequestError("Canceled.", 'ECANCEL')));
					}
					
					this._cancel = () => {
						debug('req: cancel');
						return connection.cancel();
					};
					
					// attach handler to handle multiple error messages
					errorHandlers['errorMessage'] = handleError.bind(undefined, false, connection);
					errorHandlers['error']        = handleError.bind(undefined, true, connection);
					connection.on('errorMessage', errorHandlers['errorMessage']);
					connection.on('error',        errorHandlers['error']);
	
					let req = new tds.Request(procedure, bindDomain(err => {
						// to make sure we handle no-sql errors as well
						let error;
						if (err && (err.message !== __guard__(errors[errors.length - 1], x => x.message))) {
							err = new base.RequestError(err, 'EREQUEST');
							
							if (this.stream) {
								this.emit('error', err);
							}
							
							errors.push(err);
						}
						
						if (this.verbose) { 
							if (errors.length) {
								for (error of Array.from(errors)) { this._log(`    error: ${error}`); }
							}
							
							let elapsed = Date.now() - started;
							this._log(`   return: ${returnValue}`);
							this._log(` duration: ${elapsed}ms`);
							this._log("---------- completed ----------");
						}
						
						this._cancel = null;
						
						if (errors.length && !this.stream) {
							error = errors.pop();
							error.precedingErrors = errors;
						}
						
						if (!hasReturned) {
							for (event in errorHandlers) {
								handler = errorHandlers[event];
								connection.removeListener(event, handler);
							}
							this.parent.release(connection);
	
							hasReturned = true;
	
							if (this.stream) {
								return callback(null, null, returnValue);
							} else {
								recordsets.returnValue = returnValue;
								return __guardFunc__(callback, f1 => f1(error, recordsets, returnValue));
							}
						}
					}
					)
					);
					
					req.on('columnMetadata', metadata => {
						columns = createColumns(metadata);
						
						isChunkedRecordset = false;
						if ((metadata.length === 1) && [JSON_COLUMN_ID, XML_COLUMN_ID].includes(metadata[0].colName)) {
							isChunkedRecordset = true;
							chunksBuffer = [];
						}
						
						if (this.stream) {
							return this.emit('recordset', columns);
						}
					}
					);
					
					req.on('row', columns => {
						if (!recordset) {
							recordset = [];
						}
						
						if (isChunkedRecordset) {
							return chunksBuffer.push(columns[0].value);
						
						} else {
							row = {};
							for (let col of Array.from(columns)) {
								col.value = valueCorrection(col.value, col.metadata);
								
								let exi = row[col.metadata.colName];
								if (exi != null) {
									if (exi instanceof Array) {
										exi.push(col.value);
										
									} else {
										row[col.metadata.colName] = [exi, col.value];
									}
								
								} else {
									row[col.metadata.colName] = col.value;
								}
							}
						
							if (this.verbose) {
								this._log(util.inspect(row));
								this._log("---------- --------------------");
							}
							
							if (this.stream) {
								return this.emit('row', row);
							
							} else {
								return recordset.push(row);
							}
						}
					}
					);
					
					req.on('doneInProc', (rowCount, more) => {
						// filter empty recordsets when NOCOUNT is OFF
						if (Object.keys(columns).length === 0) {
							if (rowCount > 0) { this.rowsAffected += rowCount; }
							return;
						}
						
						if (isChunkedRecordset) {
							if (columns[JSON_COLUMN_ID] && (this.connection.config.parseJSON === true)) {
								try {
									row = JSON.parse(chunksBuffer.join(''));
								} catch (ex) {
									row = null;
									ex = new base.RequestError(new Error(`Failed to parse incoming JSON. ${ex.message}`), 'EJSON');
									
									if (this.stream) {
										this.emit('error', ex);
									}
									
									// we must collect errors even in stream mode
									errors.push(ex);
								}
							
							} else {
								row = {};
								row[Object.keys(columns)[0]] = chunksBuffer.join('');
							}
							
							chunksBuffer = null;
	
							if (this.verbose) {
								this._log(util.inspect(row));
								this._log("---------- --------------------");
							}
							
							if (this.stream) {
								this.emit('row', row);
								
							} else {
								recordset.push(row);
							}
						}
						
						if (!this.stream) {
							// all rows of current recordset loaded
							Object.defineProperty(recordset, 'columns', { 
								enumerable: false,
								value: columns
							}
							);
								
							Object.defineProperty(recordset, 'toTable', { 
								enumerable: false,
								value() { return Table.fromRecordset(this); }
							}
							);
							
							recordsets.push(recordset);
						}
							
						recordset = [];
						return columns = {};
					});
					
					req.on('doneProc', (rowCount, more, returnStatus) => {
						return returnValue = returnStatus;
					}
					);
					
					req.on('returnValue', (parameterName, value, metadata) => {
						if (this.verbose) {
							if (value === tds.TYPES.Null) {
								this._log(`   output: @${parameterName}, null`);
							} else {
								this._log(`   output: @${parameterName}, ${this.parameters[parameterName].type.declaration.toLowerCase()}, ${value}`);
							}
						}
								
						return this.parameters[parameterName].value = value === tds.TYPES.Null ? null : value;
					}
					);
					
					for (let name in this.parameters) {
						let param = this.parameters[name];
						if (this.verbose) {
							if (param.value === tds.TYPES.Null) {
								this._log(`   ${param.io === 1 ? " input" : "output"}: @${param.name}, null`);
							} else {
								this._log(`   ${param.io === 1 ? " input" : "output"}: @${param.name}, ${param.type.declaration.toLowerCase()}, ${param.value}`);
							}
						}
						
						if (param.io === 1) {
							req.addParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision});
						} else {
							req.addOutputParameter(param.name, getTediousType(param.type), parameterCorrection(param.value), {length: param.length, scale: param.scale, precision: param.precision});
						}
					}
	
					if (this.verbose) { this._log("---------- response -----------"); }
					return connection.callProcedure(req);
				
				} else {
					if (connection) this.parent.release(connection);
					return __guardFunc__(callback, f1 => f1(err));
				}
			})
		})
	}
}
	
module.exports = Object.assign({
	ConnectionPool,
	Transaction,
	Request,
	PreparedStatement: base.PreparedStatement
}, base.exports);

base.driver.ConnectionPool = ConnectionPool;
base.driver.Transaction = Transaction;
base.driver.Request = Request;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
function __guardFunc__(func, transform) {
  return typeof func === 'function' ? transform(func) : undefined;
}
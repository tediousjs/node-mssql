'use strict'

const msnodesql = require('msnodesqlv8');
const util = require('util');
const debug = require('debug')('mssql:msnodesql');

const base = require('./base');
const TYPES = require('./datatypes').TYPES;
const declare = require('./datatypes').declare;
const UDT = require('./udt').PARSERS;
const DECLARATIONS = require('./datatypes').DECLARATIONS;
const ISOLATION_LEVEL = require('./isolationlevel');

const EMPTY_BUFFER = new Buffer(0);
const JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B';
const XML_COLUMN_ID = 'XML_F52E2B61-18A1-11d1-B105-00805F49916B';

const CONNECTION_STRING_PORT = 'Driver={SQL Server Native Client 11.0};Server={#{server},#{port}};Database={#{database}};Uid={#{user}};Pwd={#{password}};Trusted_Connection={#{trusted}};';
const CONNECTION_STRING_NAMED_INSTANCE = 'Driver={SQL Server Native Client 11.0};Server={#{server}\\#{instance}};Database={#{database}};Uid={#{user}};Pwd={#{password}};Trusted_Connection={#{trusted}};';

/*
@ignore
*/

let castParameter = function(value, type) {
	if (value == null) {
		if ((type === TYPES.Binary) || (type === TYPES.VarBinary) || (type === TYPES.Image)) {
			// msnodesql has some problems with NULL values in those types, so we need to replace it with empty buffer
			return EMPTY_BUFFER;
		}
		
		return null;
	}
	
	switch (type) {
		case TYPES.VarChar: case TYPES.NVarChar: case TYPES.Char: case TYPES.NChar: case TYPES.Xml: case TYPES.Text: case TYPES.NText:
			if ((typeof value !== 'string') && !(value instanceof String)) {
				value = value.toString();
			}
			break;
		
		case TYPES.Int: case TYPES.TinyInt: case TYPES.BigInt: case TYPES.SmallInt:
			if ((typeof value !== 'number') && !(value instanceof Number)) {
				value = parseInt(value);
				if (isNaN(value)) { value = null; }
			}
			break;
				
		case TYPES.Float: case TYPES.Real: case TYPES.Decimal: case TYPES.Numeric: case TYPES.SmallMoney: case TYPES.Money:
			if ((typeof value !== 'number') && !(value instanceof Number)) {
				value = parseFloat(value);
				if (isNaN(value)) { value = null; }
			}
			break;
		
		case TYPES.Bit:
			if ((typeof value !== 'boolean') && !(value instanceof Boolean)) {
				value = Boolean(value);
			}
			break;
		
		case TYPES.DateTime: case TYPES.SmallDateTime: case TYPES.DateTimeOffset: case TYPES.Date:
			if (!(value instanceof Date)) {
				value = new Date(value);
			}
			break;
		
		case TYPES.Binary: case TYPES.VarBinary: case TYPES.Image:
			if (!(value instanceof Buffer)) {
				value = new Buffer(value.toString());
			}
			break;
	}

	return value;
};

/*
@ignore
*/

let createColumns = function(metadata) {
	let out = {};
	for (let index = 0; index < metadata.length; index++) {
		let column = metadata[index];
		out[column.name] = {
			index,
			name: column.name,
			length: column.size,
			type: DECLARATIONS[column.sqlType]
		};
		
		if (column.udtType != null) {
			out[column.name].udt =
				{name: column.udtType};
			
			if (DECLARATIONS[column.udtType]) {
				out[column.name].type = DECLARATIONS[column.udtType];
			}
		}
	}
			
	return out;
};

/*
@ignore
*/

let isolationLevelDeclaration = function(type) {
	switch (type) {
		case ISOLATION_LEVEL.READ_UNCOMMITTED: return "READ UNCOMMITTED";
		case ISOLATION_LEVEL.READ_COMMITTED: return "READ COMMITTED";
		case ISOLATION_LEVEL.REPEATABLE_READ: return "REPEATABLE READ";
		case ISOLATION_LEVEL.SERIALIZABLE: return "SERIALIZABLE";
		case ISOLATION_LEVEL.SNAPSHOT: return "SNAPSHOT";
		default: throw new TransactionError("Invalid isolation level.");
	}
};

/*
@ignore
*/

let valueCorrection = function(value, metadata) {
	if ((metadata.sqlType === 'time') && (value != null)) {
		value.setFullYear(1970);
		return value;
		
	} else if ((metadata.sqlType === 'udt') && (value != null)) {
		if (UDT[metadata.udtType]) {
			return UDT[metadata.udtType](value);
			
		} else {
			return value;
		}
		
	} else {
		return value;
	}
};

class ConnectionPool extends base.ConnectionPool {
	_poolCreate() {
		return new base.Promise((resolve, reject) => {
			debug('pool: create');
			
			let defaultConnectionString = CONNECTION_STRING_PORT;
			
			if (this.config.options.instanceName != null) {
				defaultConnectionString = CONNECTION_STRING_NAMED_INSTANCE;
			}
			
			const cfg = {
				conn_str: this.config.connectionString || defaultConnectionString,
				conn_timeout: (this.config.connectionTimeout || 15000) / 1000
			}
			
			cfg.conn_str = cfg.conn_str.replace(new RegExp('#{([^}]*)}', 'g'), (p) => {
				let key = p.substr(2, p.length - 3);
				
				switch (key) {
					case 'instance':
						return this.config.options.instanceName;
					case 'trusted':
						return this.config.options.trustedConnection ? 'Yes' : 'No';
					default:
						return this.config[key] != null ? this.config[key] : '';
				}
			})
			
			msnodesql.open(cfg, (err, tds) => {
				if (err) {
					err = new base.ConnectionError(err);
					return reject(err);
				}
				
				debug('pool: create ok');

				resolve(tds);
			})
		})
	}
	
	_poolValidate(tds) {
		return new base.Promise((resolve, reject) => {
			resolve(!tds.hasError);
		})
	}
	
	_poolDestroy(tds) {
		return new base.Promise((resolve, reject) => {
			debug('pool: destroy');
			
			tds.close();
			resolve();
		})
	}
}

class Transaction extends base.Transaction {
	_begin(isolationLevel, callback) {
		super._begin(isolationLevel, err => {
			if (err) return callback(err);
			
			debug('tran: begin');
			
			this.parent.acquire(this, (err, connection) => {
				if (err) return callback(err);
				
				this._acquiredConnection = connection;

				const req = new Request(this);
				req.stream = false;
				req.query(`set transaction isolation level ${isolationLevelDeclaration(this.isolationLevel)};begin tran;`, err => {
					if (err) {
						this.parent.release(this._acquiredConnection);
						this._acquiredConnection = null;
	
						return callback(err);
					}
					
					debug('tran: begin ok');

					callback(null);
				})
			})
		})
	}
		
	_commit(callback) {
		super._commit(err => {
			if (err) return callback(err);
			
			debug('tran: commit');
			
			const req = new Request(this);
			req.stream = false;
			req.query(`commit tran`, err => {
				if (err) err = new base.TransactionError(err);
				
				this.parent.release(this._acquiredConnection);
				this._acquiredConnection = null;
				
				if (!err) debug('tran: commit ok');

				callback(null);
			})
		})
	}

	_rollback(callback) {
		super._commit(err => {
			if (err) return callback(err);
			
			debug('tran: rollback');
			
			const req = new Request(this);
			req.stream = false;
			req.query(`rollback tran`, err => {
				if (err) err = new base.TransactionError(err);
				
				this.parent.release(this._acquiredConnection);
				this._acquiredConnection = null;
				
				if (!err) debug('tran: rollback ok');

				callback(null);
			})
		})
	}
}

class Request extends base.Request {
	_batch(batch, callback) {
		this._isBatch = true;
		this._query(batch, callback);
	}
		
	_bulk(table, callback) {
		super._bulk(table, err => {
			if (err) return callback(err);
			
			table._makeBulk();
			
			if (!table.name) {
				process.nextTick(() => callback(RequestError("Table name must be specified for bulk insert.", "ENAME")));
			}
				
			if (table.name.charAt(0) === '@') {
				process.nextTick(() => callback(RequestError("You can't use table variables for bulk insert.", "ENAME")));
			}
	
			let started = Date.now();
			
			this.parent.acquire(this, (err, connection) => {
				if (!err) {
					let elapsed;
					if (this.verbose) { this._log(`-------- sql bulk load --------\n    table: ${table.name}`); }
					
					let done = (err, rowCount) => {
						let e;
						if (err) {
							if (('string' === typeof err.sqlstate) && (err.sqlstate.toLowerCase() === '08s01')) {
								connection.hasError = true;
							}
		
							e = RequestError(err);
							if ((/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(err.message)) {
								e.message = RegExp.$1;
							}
							
							e.code = 'EREQUEST';
							
							if (this.verbose && !this.nested) {
								this._log(`    error: ${e}`);
							}
						}
								
						if (this.verbose) { 
							elapsed = Date.now() - started;
							this._log(` duration: ${elapsed}ms`);
							this._log("---------- completed ----------");
						}
	
						this.parent.release(connection);
					
						if (e) {
							return __guardFunc__(callback, f => f(e));
							
						} else {
							return __guardFunc__(callback, f1 => f1(null, table.rows.length));
						}
					};
					
					let go = () => {
						let tm = connection.tableMgr();
						return tm.bind(table.path.replace(/\[|\]/g, ''), mgr => {
							if (mgr.columns.length === 0) {
								return done(new RequestError("Table was not found on the server.", "ENAME"));
							}
							
							let rows = [];
							for (let row of Array.from(table.rows)) {
								let item = {};
								for (let index = 0; index < table.columns.length; index++) {
									let col = table.columns[index];
									item[col.name] = row[index];
								}
								
								rows.push(item);
							}
							
							return mgr.insertRows(rows, done);
						}
						);
					};
					
					if (table.create) {
						let objectid, req;
						if (table.temporary) {
							objectid = `tempdb..[${table.name}]`;
						} else {
							objectid = table.path;
						}
						
						if (this.verbose) { 
							elapsed = Date.now() - started;
							this._log(`  message: attempting to create table ${table.path} if not exists`);
						}
							
						return req = connection.queryRaw(`if object_id('${objectid.replace(/'/g, '\'\'')}') is null ${table.declare()}`, function(err) {
							if (err) { return done(err); }
							return go();
						});
							
					} else {
						return go();
					}
				}
			})
		})
	}
		
	_query(command, callback) {
		super._query(command, err => {
			if (err) return callback(err);
			
			debug('req: query');
			
			if (command.length === 0) {
				return callback(null, this.multiple || this.nested ? [] : null);
			}
			
			let name, param;
			let row = null;
			let columns = null;
			let recordset = null;
			let recordsets = [];
			var started = Date.now();
			let handleOutput = false;
			let isChunkedRecordset = false;
			let chunksBuffer = null;
			
			// nested = function is called by this.execute
			
			if (!this.nested) {
				let input = ((() => {
					let result = [];
					for (name in this.parameters) {
						param = this.parameters[name];
						result.push(`@${param.name} ${declare(param.type, param)}`);
					}
					return result;
				})());
				let sets = ((() => {
					let result1 = [];
					for (name in this.parameters) {
						param = this.parameters[name];
						if (param.io === 1) {
							result1.push(`set @${param.name}=?`);
						}
					}
					return result1;
				})());
				let output = ((() => {
					let result2 = [];
					for (name in this.parameters) {
						param = this.parameters[name];
						if (param.io === 2) {
							result2.push(`@${param.name} as '${param.name}'`);
						}
					}
					return result2;
				})());
				if (input.length) { command = `declare ${input.join(',')};${sets.join(';')};${command};`; }
				if (output.length) {
					command += `select ${output.join(',')};`;
					handleOutput = true;
				}
			}
			
			this.parent.acquire(this, (err, connection) => {
				if (err) return callback(err);
				
				debug('req:connection acquired');

				let elapsed;

				let req = connection.queryRaw(command, ((() => {
					let result3 = [];
					for (name in this.parameters) {
						param = this.parameters[name];
						if (param.io === 1) {
							result3.push(castParameter(param.value, param.type));
						}
					}
					return result3;
				})()));

				req.on('meta', metadata => {
					if (row) {
						if (isChunkedRecordset) {
							if ((columns[0].name === JSON_COLUMN_ID) && (this.connection.config.parseJSON === true)) {
								try {
									row = JSON.parse(chunksBuffer.join(''));
									if (!this.stream) { recordsets[recordsets.length - 1][0] = row; }
								} catch (ex) {
									row = null;
									ex = RequestError(new Error(`Failed to parse incoming JSON. ${ex.message}`), 'EJSON');
									
									if (this.stream) {
										this.emit('error', ex);
									
									} else {
										console.error(ex);
									}
								}
							
							} else {
								row[columns[0].name] = chunksBuffer.join('');
							}
							
							chunksBuffer = null;
						}
							
						if (this.verbose) {
							this._log(util.inspect(row));
							this._log("---------- --------------------");
						}

						if (row["___return___"] == null) {
							// row with ___return___ col is the last row
							if (this.stream) { this.emit('row', row); }
						}
					}
					
					row = null;
					columns = metadata;
					recordset = [];
					Object.defineProperty(recordset, 'columns', { 
						enumerable: false,
						value: createColumns(metadata)
					}
					);
					
					isChunkedRecordset = false;
					if ((metadata.length === 1) && [JSON_COLUMN_ID, XML_COLUMN_ID].includes(metadata[0].name)) {
						isChunkedRecordset = true;
						chunksBuffer = [];
					}
					
					if (this.stream) {
						if (recordset.columns.___return___ == null) {
							this.emit('recordset', recordset.columns);
						}
					} else {
						recordsets.push(recordset);
					}
				})
					
				req.on('row', rownumber => {
					if (row) {
						if (isChunkedRecordset) return;

						if (row.___return___ == null) {
							// row with ___return___ col is the last row
							if (this.stream) this.emit('row', row);
						}
					}
					
					row = {};
					
					if (!this.stream) recordset.push(row);
				})
					
				req.on('column', (idx, data, more) => {
					if (isChunkedRecordset) {
						chunksBuffer.push(data);
					
					} else {
						data = valueCorrection(data, columns[idx]);

						let exi = row[columns[idx].name];
						if (exi != null) {
							if (exi instanceof Array) {
								exi.push(data);
							} else {
								row[columns[idx].name] = [exi, data];
							}
						} else {
							row[columns[idx].name] = data;
						}
					}
				})
				
				req.on('rowcount', count => {
					if (count > 0) this.rowsAffected += count;
				})
		
				req.once('error', err => {
					if (('string' === typeof err.sqlstate) && (err.sqlstate.toLowerCase() === '08s01')) {
						connection.hasError = true;
					}

					err = new base.RequestError(err);
					err.code = 'EREQUEST';
					if ((/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(err.message)) {
						err.message = RegExp.$1;
					}

					this.parent.release(connection);
					
					debug('req: query failed', err);
					callback(err);
				})
				
				req.once('done', () => {
					if (!this.nested) {
						if (row) {
							if (isChunkedRecordset) {
								if ((columns[0].name === JSON_COLUMN_ID) && (this.connection.config.parseJSON === true)) {
									try {
										row = JSON.parse(chunksBuffer.join(''));
										if (!this.stream) { recordsets[recordsets.length - 1][0] = row; }
									} catch (ex) {
										row = null;
										ex = RequestError(new Error(`Failed to parse incoming JSON. ${ex.message}`), 'EJSON');
										
										if (this.stream) {
											this.emit('error', ex);
										
										} else {
											console.error(ex);
										}
									}
								
								} else {
									row[columns[0].name] = chunksBuffer.join('');
								}
								
								chunksBuffer = null;
							}
							
							if (this.verbose) {
								this._log(util.inspect(row));
								this._log("---------- --------------------");
							}
							
							if (row["___return___"] == null) {
								// row with ___return___ col is the last row
								if (this.stream) { this.emit('row', row); }
							}
						}
	
						// do we have output parameters to handle?
						if (handleOutput) {
							let last = __guard__(recordsets.pop(), x => x[0]);
	
							for (name in this.parameters) {
								param = this.parameters[name];
								if (param.io === 2) {
									param.value = last[param.name];
			
									if (this.verbose) {
										this._log(`   output: @${param.name}, ${param.type.declaration}, ${param.value}`);
									}
								}
							}
						}
						
						if (this.verbose) {
							elapsed = Date.now() - started;
							this._log(` duration: ${elapsed}ms`);
							this._log("---------- completed ----------");
						}
					}

					this.parent.release(connection);
					
					debug('req: query ok');
					
					if (this.stream) {
						callback(null, this.nested ? row : null);
					
					} else {
						__guardFunc__(callback, f => f(null, this.multiple || this.nested ? recordsets : recordsets[0]));
					}
				});
			})
		})
	}

	_execute(procedure, callback) {
		super._execute(procedure, err => {
			if (err) return callback(err);
			
			let name, param;
			if (this.verbose) { this._log(`---------- sql execute --------\n     proc: ${procedure}`); }
	
			let started = Date.now();
			
			let cmd = `declare ${['@___return___ int'].concat((() => {
				let result = [];
				for (name in this.parameters) {
					param = this.parameters[name];
					if (param.io === 2) {
						result.push(`@${param.name} ${declare(param.type, param)}`);
					}
				}
				return result;
			})()).join(', ')};`;
			cmd += `exec @___return___ = ${procedure} `;
			
			let spp = [];
			for (name in this.parameters) {
				param = this.parameters[name];
				if (this.verbose) {
					this._log(`   ${param.io === 1 ? " input" : "output"}: @${param.name}, ${param.type.declaration}, ${param.value}`);
				}
						
				if (param.io === 2) {
					// output parameter
					spp.push(`@${param.name}=@${param.name} output`);
				} else {
					// input parameter
					spp.push(`@${param.name}=?`);
				}
			}
			
			cmd += `${spp.join(', ')};`;
			cmd += `select ${['@___return___ as \'___return___\''].concat((() => {
				let result1 = [];
				for (name in this.parameters) {
					param = this.parameters[name];
					if (param.io === 2) {
						result1.push(`@${param.name} as '${param.name}'`);
					}
				}
				return result1;
			})()).join(', ')};`;
			
			if (this.verbose) { this._log("---------- response -----------"); }
			
			this.nested = true;
			
			// direct call to query, in case method on main request object is overriden (e.g. co-mssql)
			this._query(cmd, (err, recordsets) => {
				let elapsed;
				this.nested = false;
				
				if (err) {
					if (this.verbose) {
						elapsed = Date.now() - started;
						this._log(`    error: ${err}`);
						this._log(` duration: ${elapsed}ms`);
						this._log("---------- completed ----------");
					}
					
					return __guardFunc__(callback, f => f(err));
				
				} else {
					let last, returnValue;
					if (this.stream) {
						last = recordsets;
					} else {
						last = __guard__(recordsets.pop(), x => x[0]);
					}
						
					if (last && (last.___return___ != null)) {
						returnValue = last.___return___;
						
						for (name in this.parameters) {
							param = this.parameters[name];
							if (param.io === 2) {
								param.value = last[param.name];
		
								if (this.verbose) {
									this._log(`   output: @${param.name}, ${param.type.declaration}, ${param.value}`);
								}
							}
						}
					}
		
					if (this.verbose) {
						elapsed = Date.now() - started;
						this._log(`   return: ${returnValue}`);
						this._log(` duration: ${elapsed}ms`);
						this._log("---------- completed ----------");
					}
					
					if (this.stream) {
						callback(null, null, returnValue);
						
					} else {
						recordsets.returnValue = returnValue;
						__guardFunc__(callback, f1 => f1(null, recordsets, returnValue));
					}
				}
			})
		})
	}
				
	/*
	Cancel currently executed request.
	*/
	
	cancel() {
		return false; // Request canceling is not implemented by msnodesql driver.
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
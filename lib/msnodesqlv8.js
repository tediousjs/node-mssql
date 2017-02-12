const {Pool} = require('generic-pool');
const msnodesql = require('msnodesqlv8');
const util = require('util');

const {TYPES, declare} = require('./datatypes');
const UDT = require('./udt').PARSERS;
const ISOLATION_LEVEL = require('./isolationlevel');
const {DECLARATIONS} = require('./datatypes');
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

/*
@ignore
*/

export default function(Connection, Transaction, Request, ConnectionError, TransactionError, RequestError) {
	class MsnodesqlConnection extends Connection {
		static initClass() {
			this.prototype.pool = null;
		}
		
		connect(config, callback) {
			let left;
			let defaultConnectionString = CONNECTION_STRING_PORT;
			
			if (config.options.instanceName != null) {
				defaultConnectionString = CONNECTION_STRING_NAMED_INSTANCE;
			}
			
			let cfg = {
				conn_str: config.connectionString != null ? config.connectionString : defaultConnectionString,
				conn_timeout: ((left = config.connectionTimeout != null ? config.connectionTimeout : config.timeout) != null ? left : 15000) / 1000 // config.timeout deprecated in 0.6.0
			};
			
			cfg.conn_str = cfg.conn_str.replace(new RegExp('#{([^}]*)}', 'g'), function(p) {
				let key = p.substr(2, p.length - 3);
				if (key === 'instance') {
					return config.options.instanceName;
				} else if (key === 'trusted') {
					return config.options.trustedConnection ? 'Yes' : 'No';
				} else {
					return config[key] != null ? config[key] : '';
				}
			});

			let cfg_pool = {
				name: 'mssql',
				max: 10,
				min: 0,
				idleTimeoutMillis: 30000,
				create: callback => {
					return msnodesql.open(cfg, (err, c) => {
						if (err) { err = ConnectionError(err); }
						if (err) { return callback(err, null); } // there must be a second argument null
						return callback(null, c);
					}
					);
				},
				
				validate(c) {
					return (c != null) && !c.hasError;
				},
				
				destroy(c) {
					return __guard__(c, x => x.close());
				}
			};
			
			if (config.pool) {
				for (let key in config.pool) {
					let value = config.pool[key];
					cfg_pool[key] = value;
				}
			}

			this.pool = Pool(cfg_pool, cfg);
			
			//create one testing connection to check if everything is ok
			return this.pool.acquire((err, connection) => {
				if (err && !(err instanceof Error)) { err = new Error(err); }
				
				if (err) {
					this.pool.drain(() => { //prevent the pool from creating additional connections. we're done with it
						__guard__(this.pool, x => x.destroyAllNow());
						return this.pool = null;
					}
					);

				} else {
					// and release it immediately
					this.pool.release(connection);
				}
				
				return callback(err);
			}
			);
		}
			
		close(callback) {
			if (!this.pool) { return callback(null); }
			
			return this.pool.drain(() => {
				__guard__(this.pool, x => x.destroyAllNow());
				this.pool = null;
				return callback(null);
			}
			);
		}
	}
	MsnodesqlConnection.initClass();
	
	class MsnodesqlTransaction extends Transaction {
		begin(callback) {
			return this.connection.pool.acquire((err, connection) => {
				if (err) { return callback(err); }
				
				this._pooledConnection = connection;
				
				return this.request()._dedicated(this._pooledConnection).query(`set transaction isolation level ${isolationLevelDeclaration(this.isolationLevel)};begin tran;`, callback);
			}
			);
		}
			
		commit(callback) {
			return this.request()._dedicated(this._pooledConnection).query('commit tran', err => {
				this.connection.pool.release(this._pooledConnection);
				this._pooledConnection = null;
				return callback(err);
			}
			);
		}

		rollback(callback) {
			return this.request()._dedicated(this._pooledConnection).query('rollback tran', err => {
				this.connection.pool.release(this._pooledConnection);
				this._pooledConnection = null;
				return callback(err);
			}
			);
		}
	}

	class MsnodesqlRequest extends Request {
		batch(batch, callback) {
			return MsnodesqlRequest.prototype.query.call(this, batch, callback);
		}
			
		bulk(table, callback) {
			table._makeBulk();
			
			if (!table.name) {
				process.nextTick(() => callback(RequestError("Table name must be specified for bulk insert.", "ENAME")));
			}
				
			if (table.name.charAt(0) === '@') {
				process.nextTick(() => callback(RequestError("You can't use table variables for bulk insert.", "ENAME")));
			}

			let started = Date.now();
			
			return this._acquire((err, connection) => {
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

						this._release(connection);
					
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
			}
			);
		}
			
		query(command, callback) {
			let name, param;
			if (command.length === 0) {
				return process.nextTick(function() {
					if (this.verbose && !this.nested) {
						this._log("---------- response -----------");
						let elapsed = Date.now() - started;
						this._log(` duration: ${elapsed}ms`);
						this._log("---------- completed ----------");
					}
		
					return __guardFunc__(callback, f => f(null, this.multiple || this.nested ? [] : null));
				});
			}
			
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
			
			return this._acquire((err, connection) => {
				if (!err) {
					let elapsed;
					if (this.verbose && !this.nested) { this._log(`---------- sql query ----------\n    query: ${command}`); }
					
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
					if (this.verbose && !this.nested) { this._log("---------- response -----------"); }
					
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
							if (recordset.columns["___return___"] == null) {
								return this.emit('recordset', recordset.columns);
							}
						
						} else {
							return recordsets.push(recordset);
						}
					}
					);
						
					req.on('row', rownumber => {
						if (row) {
							if (isChunkedRecordset) { return; }
							
							if (this.verbose) {
								this._log(util.inspect(row));
								this._log("---------- --------------------");
							}

							if (row["___return___"] == null) {
								// row with ___return___ col is the last row
								if (this.stream) { this.emit('row', row); }
							}
						}
						
						row = {};
						
						if (!this.stream) {
							return recordset.push(row);
						}
					}
					);
						
					req.on('column', (idx, data, more) => {
						if (isChunkedRecordset) {
							return chunksBuffer.push(data);
						
						} else {
							data = valueCorrection(data, columns[idx]);
	
							let exi = row[columns[idx].name];
							if (exi != null) {
								if (exi instanceof Array) {
									return exi.push(data);
									
								} else {
									return row[columns[idx].name] = [exi, data];
								}
							
							} else {
								return row[columns[idx].name] = data;
							}
						}
					}
					);
					
					req.on('rowcount', count => {
						if (count > 0) { return this.rowsAffected += count; }
					}
					);
			
					req.once('error', err => {
						if (('string' === typeof err.sqlstate) && (err.sqlstate.toLowerCase() === '08s01')) {
							connection.hasError = true;
						}

						let e = RequestError(err);
						if ((/^\[Microsoft\]\[SQL Server Native Client 11\.0\](?:\[SQL Server\])?([\s\S]*)$/).exec(err.message)) {
							e.message = RegExp.$1;
						}
						
						e.code = 'EREQUEST';
						
						if (this.verbose && !this.nested) {
							elapsed = Date.now() - started;
							this._log(`    error: ${err}`);
							this._log(` duration: ${elapsed}ms`);
							this._log("---------- completed ----------");
						}
						
						this._release(connection);

						return __guardFunc__(callback, f => f(e));
					}
					);
					
					return req.once('done', () => {
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

						this._release(connection);
						
						if (this.stream) {
							return callback(null, this.nested ? row : null);
						
						} else {
							return __guardFunc__(callback, f => f(null, this.multiple || this.nested ? recordsets : recordsets[0]));
						}
					});
				
				} else {
					if (connection) { this._release(connection); }
					return __guardFunc__(callback, f => f(err));
				}
			}
			);
		}
	
		execute(procedure, callback) {
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
			return MsnodesqlRequest.prototype.query.call(this, cmd, (err, recordsets) => {
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
						return callback(null, null, returnValue);
						
					} else {
						recordsets.returnValue = returnValue;
						return __guardFunc__(callback, f1 => f1(null, recordsets, returnValue));
					}
				}
			}
			);
		}
					
		/*
		Cancel currently executed request.
		*/
		
		cancel() {
			return false; // Request canceling is not implemented by msnodesql driver.
		}
	}
	
	return {
		Connection: MsnodesqlConnection,
		Transaction: MsnodesqlTransaction,
		Request: MsnodesqlRequest,
		fix() {} // there is nothing to fix in this driver
	};
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
function __guardFunc__(func, transform) {
  return typeof func === 'function' ? transform(func) : undefined;
}
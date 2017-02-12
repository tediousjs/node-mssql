'use strict'

const sql = require('../../');
const assert = require("assert");
const stream = require('stream');

class WritableStream extends stream.Writable {
	static initClass() {
		this.prototype.cache = null;
	}
	
	constructor() {
		super({
			objectMode: true});
			
		this.cache = [];
	}
		
	_write(chunk, encoding, callback) {
		this.cache.push(chunk);
		return setImmediate(() => callback(null));
	}
}
WritableStream.initClass();

global.TESTS = {
	['stored procedure'](done, checkmulti, stream) {
		let p;
		if (checkmulti == null) { checkmulti = true; }
		if (stream == null) { stream = false; }
		let request = new sql.Request;
		request.stream = stream;
		request.input('in', sql.Int, null);
		request.input('in2', sql.BigInt, 0);
		request.input('in3', sql.NVarChar, 'anystring');
		request.input('in4', sql.UniqueIdentifier, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F');
		request.input('in5', sql.DateTime, new Date(1860, 0, 24, 1, 52));
		request.output('out', sql.Int);
		request.output('out2', sql.Int);
		request.output('out3', sql.UniqueIdentifier);
		request.output('out4', sql.DateTime);
		request.output('out5', sql.Char(10));
		
		let complete = function(err, recordsets, returnValue) {
			if (!err) {
				if (MODE !== 'batch') { assert.equal(returnValue, 11); }
				assert.equal(recordsets.length, 3);
				assert.equal(recordsets[0].length, 2);
				assert.equal(recordsets[0][0].a, 1);
				assert.equal(recordsets[0][0].b, 2);
				assert.equal(recordsets[0][1].a, 3);
				assert.equal(recordsets[0][1].b, 4);
				assert.equal(recordsets[1].length, 1);
				assert.equal(recordsets[1][0].c, 5);
				assert.equal(recordsets[1][0].d, 6);
				assert.equal(recordsets[1][0].e.length, 3);
				
				if (checkmulti) {
					assert.equal(recordsets[1][0].e[0], 0);
					assert.equal(recordsets[1][0].e[1], 111);
					assert.equal(recordsets[1][0].e[2], 'asdf');
				}
					
				assert.equal(recordsets[1][0].f, null);
				assert.equal(recordsets[1][0].g, 'anystring');
				assert.equal(recordsets[2].length, 0);

				assert.equal(request.parameters.out.value, 99);
				assert.equal(request.parameters.out2.value, null);
				assert.equal(request.parameters.out3.value, 'D916DD31-5CB3-44A7-83D4-2DD83E40279F');
				assert.equal(request.parameters.out4.value.getTime(), +new Date(1860, 0, 24, 1, 52));
				assert.equal(request.parameters.out5.value, 'anystring ');
				
				assert.equal(recordsets[0].columns.a.index, 0);
				assert.equal(recordsets[0].columns.b.index, 1);
			}
			
			return done(err);
		};
		
		if (MODE === 'batch') {
			request.multiple = true;
			p = request.batch('exec __test @in=@in, @in2=@in2, @in3=@in3, @in4=@in4, @in5=@in5, @out=@out output, @out2=@out2 output, @out3=@out3 output, @out4=@out4 output, @out5=@out5 output');
		
		} else {
			p = request.execute('__test');
		}
		
		let rsts = [];
		let errs = [];
		let next = null;
		
		if (stream) {
			let ws = new WritableStream;
			request.pipe(ws);
			ws.on('finish', function() {
				if (!next) { done(new Error("Stream finished before request:done.")); }
				
				assert.equal(ws.cache.length, 3);
				assert.strictEqual(rsts[0][0], ws.cache[0]);
				assert.strictEqual(rsts[0][1], ws.cache[1]);
				assert.strictEqual(rsts[1][0], ws.cache[2]);
				
				return __guardFunc__(next, f => f());
			});
				
			request.on('recordset', function(columns) {
				let rst = [];
				rst.columns = columns;
				return rsts.push(rst);
			});
			
			request.on('row', row => rsts[rsts.length - 1].push(row));
			
			request.on('error', err => errs.push(err));

			return request.on('done', returnValue =>
				next = () => complete(errs.pop(), rsts, returnValue)
			);
		
		} else {
			return p.then((recordsets, returnValue) => complete(null, recordsets, recordsets.returnValue)
			, complete);
		}
	},

	['user defined types'](done) {
		let request = new sql.Request;
		return request[MODE]("declare @g geography = geography::[Null];select geography::STGeomFromText('LINESTRING(-122.360 47.656, -122.343 47.656 )', 4326) as geography, geometry::STGeomFromText('LINESTRING (100 100 10.3 12, 20 180, 180 180)', 0) geometry, @g as nullgeography", function(err, rst) {
			if (err) { return done(err); }
			
			//console.dir rst[0].geography
			//console.dir rst[0].geometry

			//assert.deepEqual rst[0].geography, sample1
			//assert.deepEqual rst[0].geometry, sample2
			
			assert.strictEqual(rst[0].geography.srid, 4326);
			assert.strictEqual(rst[0].geography.version, 1);
			assert.strictEqual(rst[0].geography.points.length, 2);
			assert.strictEqual(rst[0].geography.points[0].x, 47.656);
			assert.strictEqual(rst[0].geography.points[1].y, -122.343);
			assert.strictEqual(rst[0].geography.figures.length, 1);
			assert.strictEqual(rst[0].geography.figures[0].attribute, 0x01);
			assert.strictEqual(rst[0].geography.shapes.length, 1);
			assert.strictEqual(rst[0].geography.shapes[0].type, 0x02);
			assert.strictEqual(rst[0].geography.segments.length, 0);
			
			assert.strictEqual(rst[0].geometry.srid, 0);
			assert.strictEqual(rst[0].geometry.version, 1);
			assert.strictEqual(rst[0].geometry.points.length, 3);
			assert.strictEqual(rst[0].geometry.points[0].z, 10.3);
			assert.strictEqual(rst[0].geometry.points[0].m, 12);
			assert.strictEqual(rst[0].geometry.points[1].x, 20);
			assert.strictEqual(rst[0].geometry.points[2].y, 180);
			assert(isNaN(rst[0].geometry.points[2].z));
			assert(isNaN(rst[0].geometry.points[2].m));
			assert.strictEqual(rst[0].geometry.figures.length, 1);
			assert.strictEqual(rst[0].geometry.figures[0].attribute, 0x01);
			assert.strictEqual(rst[0].geometry.shapes.length, 1);
			assert.strictEqual(rst[0].geometry.shapes[0].type, 0x02);
			assert.strictEqual(rst[0].geometry.segments.length, 0);
			
			if (['tedious', 'msnodesql', 'msnodesqlv8'].includes(DRIVER)) {
				assert(rst.columns.geography.type === sql.Geography);
				assert(rst.columns.geometry.type === sql.Geometry);
				assert.equal(rst.columns.geography.udt.name, 'geography');
				assert.equal(rst.columns.geometry.udt.name, 'geometry');
			}

			return done();
		});
	},

	['binary data'](done) {
		let sample = new Buffer([0x00, 0x01, 0xe2, 0x40]);
		
		let request = new sql.Request;
		request.input('in', sql.Binary, sample);
		request.input('in2', sql.Binary, null);
		request.input('in3', sql.VarBinary, sample);
		request.input('in4', sql.VarBinary, null);
		request.input('in5', sql.Image, sample);
		request.input('in6', sql.Image, null);
		request.output('out', sql.Binary(4));
		request.output('out2', sql.VarBinary);
		return request.execute('__test5', function(err, recordsets) {
			if (!err) {
				assert.deepEqual(recordsets[0][0].bin, sample);
				assert.deepEqual(recordsets[0][0].in, sample);
				assert.equal(recordsets[0][0].in2, null);
				assert.deepEqual(recordsets[0][0].in3, sample);
				assert.equal(recordsets[0][0].in4, null);
				assert.deepEqual(recordsets[0][0].in5, sample);
				assert.equal(recordsets[0][0].in6, null);
				
				assert.deepEqual(request.parameters.out.value, sample);
				assert.deepEqual(request.parameters.out2.value, sample);
			}

			return done(err);
		});
	},
	
	['variant data'](done) {
		let r = new sql.Request;
		return r[MODE]('select cast(11.77 as sql_variant) as variant', function(err, recordset) {
			if (!err) {
				assert.equal(recordset.length, 1);
				assert.strictEqual(recordset[0].variant, 11.77);
			}

			return done(err);
		});
	},
	
	['stored procedure with one empty recordset'](done) {
		let request = new sql.Request;
		
		return request.execute('__test2', function(err, recordsets) {
			if (!err) {
				assert.equal(recordsets.returnValue, 11);
				assert.equal(recordsets.length, 2);
			}
			
			return done(err);
		});
	},
	
	['domain'](done) {
		let d = require('domain').create();
		return d.run(function() {
			let r = new sql.Request;
			let { domain } = process;
			
			return r[MODE]('', function(err, recordset) {
				assert.strictEqual(domain, process.domain);
	
				return done(err);
			});
		});
	},
	
	['empty query'](done) {
		let r = new sql.Request;
		return r[MODE]('', function(err, recordset) {
			if (!err) {
				assert.equal(recordset, null);
			}

			return done(err);
		});
	},
	
	['query with no recordset'](done) {
		let r = new sql.Request;
		return r[MODE]('select * from sys.tables where name = \'______\'', function(err, recordset) {
			if (!err) {
				assert.equal(recordset.length, 0);
			}

			return done(err);
		});
	},
	
	['query with one recordset'](done) {
		let r = new sql.Request;
		return r[MODE]('select \'asdf\' as text', function(err, recordset) {
			if (!err) {
				assert.equal(recordset.length, 1);
				assert.equal(recordset[0].text, 'asdf');
			}

			return done(err);
		});
	},
	
	['query with multiple recordsets'](done, checkmulti, stream) {
		if (checkmulti == null) { checkmulti = true; }
		if (stream == null) { stream = false; }
		let r = new sql.Request;
		r.stream = stream;
		r.multiple = true;
		
		let complete = function(err, recordsets) {
			if (!err) {
				assert.equal(recordsets.length, 2);
				assert.equal(recordsets[0].length, 1);
				assert.equal(recordsets[0][0].test, 41);
				assert.equal(recordsets[0][0].num.length, 2);
				
				if (checkmulti) {
					assert.equal(recordsets[0][0].num[0], 5);
					assert.equal(recordsets[0][0].num[1], 6);
				}

				assert.equal(recordsets[1][0].second, 999);
				assert.equal(recordsets[0].columns.test.type, sql.Int);
			}

			return done(err);
		};
		
		r[MODE]('select 41 as test, 5 as num, 6 as num;select 999 as second', complete);
		
		let rsts = [];
		let errs = [];
		
		if (stream) {
			r.on('recordset', function(columns) {
				let rst = [];
				rst.columns = columns;
				return rsts.push(rst);
			});
			
			r.on('row', row => rsts[rsts.length - 1].push(row));
			
			r.on('error', err => errs.push(err));

			return r.on('done', returnValue => complete(errs.pop(), rsts, returnValue));
		}
	},
	
	['query with input parameters'](done) {
		let r;
		let buff = new Buffer([0x00, 0x01, 0xe2, 0x40]);
		
		if (global.DRIVER === 'tds') {
			r = new sql.Request;
			r.input('id', 12);
			return r[MODE]('select @id as id', function(err, recordset) {
				if (!err) {
					assert.equal(recordset.length, 1);
					assert.equal(recordset[0].id, 12);
				}
	
				return done(err);
			});
		
		} else {
			r = new sql.Request;
			r.input('id', 12);
			r.input('vch', sql.VarChar(300), 'asdf');
			r.input('vchm', sql.VarChar(sql.MAX), 'fdsa');
			r.input('vbin', buff);
			return r[MODE]('select @id as id, @vch as vch, @vchm as vchm, @vbin as vbin', function(err, recordset) {
				if (!err) {
					assert.equal(recordset.length, 1);
					assert.equal(recordset[0].id, 12);
					assert.equal(recordset[0].vch, 'asdf');
					assert.equal(recordset[0].vchm, 'fdsa');
					assert.deepEqual(recordset[0].vbin, buff);
				}
	
				return done(err);
			});
		}
	},
	
	['query with output parameters'](done) {
		let r = new sql.Request;
		r.output('out', sql.VarChar);
		let p = r[MODE]('select @out = \'test\'');
		
		return p.then(function(recordset) {
			assert.equal(recordset, null);
			assert.equal(r.parameters.out.value, 'test');
			
			return done();
		}

		, done);
	},
	
	['query with error'](done, stream) {
		if (stream == null) { stream = false; }
		let r = new sql.Request;
		r.stream = stream;
		
		let complete = function(err, recordset) {
			assert.equal(err instanceof sql.RequestError, true);
			
			assert.strictEqual(err.message, 'Invalid object name \'notexistingtable\'.');
			assert.strictEqual(err.code, 'EREQUEST');
			assert.strictEqual(err.number, 208);
			
			if (!['msnodesql', 'msnodesqlv8'].includes(global.DRIVER)) {
				assert.strictEqual(err.lineNumber, 1);
				assert.strictEqual(err.state, 1);
				assert.strictEqual(err.class, 16);
			}

			return done();
		};
		
		let p = r[MODE]('select * from notexistingtable');
		
		if (stream) {
			let error = null;
			
			r.on('error', err => error = err);
			
			return r.on('done', () => complete(error));
		
		} else {
			return p.then(recordset => complete(null, recordset)
			, complete);
		}
	},
	
	['query with multiple errors'](done, stream) {
		if (stream == null) { stream = false; }
		let r = new sql.Request;
		r.stream = stream;
		
		let complete = function(err, recordset) {
			assert.equal(err instanceof sql.RequestError, true);
			assert.equal(err.message, 'Invalid column name \'b\'.');
			assert.equal(err.precedingErrors.length, 1);
			assert.equal(err.precedingErrors[0] instanceof sql.RequestError, true);
			assert.equal(err.precedingErrors[0].message, 'Invalid column name \'a\'.');

			return done();
		};
		
		r[MODE]('select a;select b;', complete);
		
		if (stream) {
			let errors = [];
			
			r.on('error', err => errors.push(err));
			
			return r.on('done', function() {
				let error = errors.pop();
				error.precedingErrors = errors;
				
				return complete(error);
			});
		}
	},
	
	['query with raiseerror'](done, stream) {
		if (stream == null) { stream = false; }
		let r = new sql.Request;
		r.stream = stream;
		
		let notices = [];
		r.on('info', notices.push.bind(notices));
		
		let complete = function(err, recordset) {
			assert.equal(err instanceof sql.RequestError, true);
			assert.equal(err.message, 'An invalid parameter or option was specified for procedure \'mysp\'.');
			assert.equal(err.precedingErrors.length, 1);
			assert.equal(err.precedingErrors[0] instanceof sql.RequestError, true);
			assert.equal(err.precedingErrors[0].message, 'The size associated with an extended property cannot be more than 7,500 bytes.');
			
			assert.equal(notices.length, 2);
			assert.equal(notices[0].message, 'Print');
			assert.equal(notices[0].number, 0);
			assert.equal(notices[0].state, 1);
			assert.equal(notices[1].message, 'Notice');
			assert.equal(notices[1].number, 50000);
			assert.equal(notices[1].state, 1);

			return done();
		};
		
		r[MODE]("print 'Print'; raiserror(N'Notice', 10, 1); raiserror(15097,-1,-1); raiserror (15600,-1,-1, 'mysp');", complete);
		
		if (stream) {
			let errors = [];
			
			r.on('error', err => errors.push(err));
			
			return r.on('done', function() {
				let error = errors.pop();
				error.precedingErrors = errors;
				
				return complete(error);
			});
		}
	},
	
	['batch'](done, stream) {
		if (stream == null) { stream = false; }
		let r = new sql.Request;
		r.stream = stream;
		r.multiple = true;
		
		let complete = function(err, recordsets) {
			if (err) { return done(err); }
			
			assert.equal(recordsets[0][0].num, 1);
			assert.equal(recordsets[1][0].text, 'asdf');
		
			return done();
		};
		
		r.batch('select 1 as num;select \'asdf\' as text', complete);
		
		let rsts = [];
		let errs = [];
		
		if (stream) {
			r.on('recordset', function(columns) {
				let rst = [];
				rst.columns = columns;
				return rsts.push(rst);
			});
			
			r.on('row', row => rsts[rsts.length - 1].push(row));
			
			r.on('error', err => errs.push(err));

			return r.on('done', () => complete(errs.pop(), rsts));
		}
	},
	
	['create procedure batch'](done) {
		let r = new sql.Request;
		return r.batch('create procedure #temporary as select 1 as num', function(err, recordset) {
			if (err) { return done(err); }
			
			assert.equal(recordset, null);
			
			r = new sql.Request;
			return r.batch('exec #temporary', function(err, recordset) {
				if (err) { return done(err); }
				
				assert.equal(recordset[0].num, 1);
			
				r = new sql.Request;
				r.multiple = true;
				return r.batch('exec #temporary;exec #temporary;exec #temporary', function(err, recordsets) {
					if (err) { return done(err); }
					
					assert.equal(recordsets[0][0].num, 1);
					assert.equal(recordsets[1][0].num, 1);
					assert.equal(recordsets[2][0].num, 1);
		
					return done();
				});
			});
		});
	},
	
	['bulk load'](name, done) {
		let t = new sql.Table(name);
		t.create = true;
		t.columns.add('a', sql.Int, {nullable: false});
		t.columns.add('b', sql.VarChar(50), {nullable: true});
		t.rows.add(777, 'asdf');
		t.rows.add(453);
		t.rows.add(4535434);
		t.rows.add(12, 'XCXCDCDSCDSC');
		t.rows.add(1);
		t.rows.add(7278, '4524254');
		
		let r = new sql.Request;
		return r.bulk(t, function(err, rowCount) {
			if (err) { return done(err); }
			
			assert.equal(rowCount, 6);
			
			r = new sql.Request;
			return r.batch(`select * from ${name}`, function(err, recordset) {
				if (err) { return done(err); }
				
				assert.equal(recordset[0].a, 777);
				assert.equal(recordset[0].b, 'asdf');
			
				return done();
			});
		});
	},
	
	['prepared statement'](decimal, done, stream) {
		let ps;
		if (stream == null) { stream = false; }
		if (decimal) {
			ps = new sql.PreparedStatement;
			ps.input('num', sql.Int);
			ps.input('num2', sql.Decimal(5, 2));
			ps.input('chr', sql.VarChar(sql.MAX));
			ps.input('chr2', sql.VarChar(sql.MAX));
			ps.input('chr3', sql.VarChar(5));
			ps.input('chr4', sql.VarChar(sql.MAX));
			return ps.prepare('select @num as number, @num2 as number2, @chr as chars, @chr2 as chars2, @chr3 as chars3, @chr3 as chars4', function(err) {
				if (err) { return done(err); }

				let complete = function(err, recordset) {
					if (err) {
						return ps.unprepare(() => done(err));
					}
					
					assert.equal(recordset.length, 1);
					assert.equal(recordset[0].number, 555);
					assert.equal(recordset[0].number2, 666.77);
					assert.equal(recordset[0].chars, 'asdf');
					assert.equal(recordset[0].chars2, null);
					assert.equal(recordset[0].chars3, '');
					assert.equal(recordset[0].chars4, '');
					assert.strictEqual(ps.lastRequest, r);
					
					return ps.unprepare(done);
				};
				
				ps.stream = stream;
				var r = ps.execute({num: 555, num2: 666.77, chr: 'asdf', chr2: null, chr3: '', chr4: ''}, complete);
			
				let rsts = [];
				let errs = [];
				
				if (stream) {
					r.on('recordset', function(columns) {
						let rst = [];
						rst.columns = columns;
						return rsts.push(rst);
					});
					
					r.on('row', row => rsts[rsts.length - 1].push(row));
					
					r.on('error', err => errs.push(err));
		
					return r.on('done', () => complete(errs.pop(), rsts.shift()));
				}
			});
		
		} else {
			// node-tds doesn't support decimal/numeric in PS
			ps = new sql.PreparedStatement;
			ps.input('num', sql.Int);
			return ps.prepare('select @num as number', function(err) {
				if (err) { return done(err); }
				
				let complete = function(err, recordset) {
					assert.equal(recordset.length, 1);
					assert.equal(recordset[0].number, 555);
					assert.strictEqual(ps.lastRequest, r);
					
					return ps.unprepare(done);
				};
				
				ps.stream = stream;
				var r = ps.execute({num: 555}, complete);
				
				let rsts = [];
				let errs = [];
				
				if (stream) {
					r.on('recordset', function(columns) {
						let rst = [];
						rst.columns = columns;
						return rsts.push(rst);
					});
					
					r.on('row', row => rsts[rsts.length - 1].push(row));
					
					r.on('error', err => errs.push(err));
		
					return r.on('done', () => complete(errs.pop(), rsts.shift()));
				}
			});
		}
	},
	
	['prepared statement with affected rows'](done) {
		let ps = new sql.PreparedStatement;
		ps.input('data', sql.VarChar(50));
		return ps.prepare('insert into prepstm_test values (@data);insert into prepstm_test values (@data);delete from prepstm_test;', function(err) {
			let r;
			if (err) { return done(err); }
			
			return r = ps.execute({data: 'abc'}, function(err, recordsets, affected) {
				assert.equal(affected, 4);
				assert.equal(r.rowsAffected, 4);
				assert.strictEqual(ps.lastRequest, r);
				
				return ps.unprepare(done);
			});
		});
	},
	
	['prepared statement in transaction'](done) {
		let tran = new sql.Transaction;
		return tran.begin(function(err) {
			if (err) { return done(err); }
			
			let ps = new sql.PreparedStatement(tran);
			ps.input('num', sql.Int);
			return ps.prepare('select @num as number', function(err) {
				let r;
				if (err) { return done(err); }
				
				assert.ok(tran._pooledConnection === ps._pooledConnection);
				
				ps.multiple = true;
				return r = ps.execute({num: 555}, function(err, recordsets) {
					assert.equal(recordsets[0].length, 1);
					assert.equal(recordsets[0][0].number, 555);
					assert.strictEqual(ps.lastRequest, r);
					
					return ps.unprepare(function(err) {
						if (err) { return done(err); }
						
						return tran.commit(done);
					});
				});
			});
		});
	},
	
	['transaction with rollback'](done) {
		let tran = new sql.Transaction;
		tran.begin(function(err) {
			if (err) { return done(err); }

			let req = tran.request();
			return req[MODE]('insert into tran_test values (\'test data\')', function(err, recordset) {
				if (err) { return done(err); }
				
				let locked = true;

				req = new sql.Request;
				req[MODE]('select * from tran_test with (nolock)', function(err, recordset) {
					assert.equal(recordset.length, 1);
					assert.equal(recordset[0].data, 'test data');
					
					return setTimeout(function() {
						if (!locked) { return done(new Error("Unlocked before rollback.")); }

						return tran.rollback(function(err) {
							if (err) { return done(err); }
						});
					}
							
					, 500);
				});

				req = new sql.Request;
				return req[MODE]('select * from tran_test', function(err, recordset) {
					assert.equal(recordset.length, 0);
					
					assert.equal(tbegin, true);
					assert.equal(tcommit, false);
					assert.equal(trollback, true);
					
					locked = false;
					
					return setTimeout(() => done()
						
					, 200);
				});
			});
		});
		
		var tbegin = false;
		tran.on('begin', () => tbegin = true);
		
		var tcommit = false;
		tran.on('commit', () => tcommit = true);
		
		var trollback = false;
		return tran.on('rollback', function(aborted) {
			assert.strictEqual(aborted, false);
			return trollback = true;
		});
	},

	['transaction with commit'](done) {
		let tran = new sql.Transaction;
		tran.begin(function(err) {
			if (err) { return done(err); }

			let req = tran.request();
			return req[MODE]('insert into tran_test values (\'test data\')', function(err, recordset) {
				if (err) { return done(err); }

				// In this case, table tran_test is locked until we call commit
				let locked = true;
				
				req = new sql.Request;
				req[MODE]('select * from tran_test', function(err, recordset) {
					assert.equal(recordset.length, 1);
					assert.equal(recordset[0].data, 'test data');
					
					return locked = false;
				});
				
				return setTimeout(function() {
					if (!locked) { return done(new Error("Unlocked before commit.")); }
					
					return tran.commit(function(err) {
						if (err) { return done(err); }

						assert.equal(tbegin, true);
						assert.equal(tcommit, true);
						assert.equal(trollback, false);
						
						return setTimeout(function() {
							if (locked) { return done(new Error("Still locked after commit.")); }
							
							return done();
						}
							
						, 200);
					});
				}
						
				, 200);
			});
		});
		
		var tbegin = false;
		tran.on('begin', () => tbegin = true);
		
		var tcommit = false;
		tran.on('commit', () => tcommit = true);
		
		var trollback = false;
		return tran.on('rollback', () => trollback = true);
	},

	['transaction with error'](done) {
		let tran = new sql.Transaction;
		return tran.begin(function(err) {
			if (err) { return done(err); }
			
			let rollbackHandled = false;

			let req = tran.request();
			req[MODE]('insert into tran_test values (\'asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasd\')', function(err, recordset) {
				assert.ok(err);
				assert.equal(err.message, 'String or binary data would be truncated.');
				
				return tran.rollback(function(err) {
					assert.ok(err);
					assert.equal(err.message, 'Transaction has been aborted.');

					if (!rollbackHandled) { return done(new Error("Rollback event didn't fire.")); }
					
					return done();
				});
			});

			return tran.on('rollback', function(aborted) {
				assert.strictEqual(aborted, true);
				
				return rollbackHandled = true;
			});
		});
	},
	
	['transaction with synchronous error'](done) {
		let tran = new sql.Transaction;
		return tran.begin(function(err) {
			if (err) { return done(err); }

			let req = tran.request();
			req.input('date', sql.TinyInt, 1561651515615);
			
			return req.execute('someStoreProc', function(err) {
				if (err) {
					return tran.rollback(done);
				}
				
				return done(new Error("Should throw an error."));
			});
		});
	},

	['cancel request'](done, message) {
		let r = new sql.Request;
		r[MODE]('waitfor delay \'00:00:05\';select 1', function(err, recordset) {
			assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.RequestError)), true);

			return done(null);
		});
		
		return r.cancel();
	},
	
	['request timeout'](done, driver, message) {
		let config = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
		config.driver = driver;
		config.requestTimeout = 500;
		
		return new sql.ConnectionPool(config).connect().then(function(conn) {
			let r = new sql.Request(conn);
			return r[MODE]('waitfor delay \'00:00:05\';select 1', function(err, recordset) {
				assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.RequestError)), true);
	
				return done(null);
			});}).catch(done);
	},
	
	['type validation'](done) {
		let r = new sql.Request;
		r.input('image', sql.VarBinary, 'asdf');
		let p = r[MODE]('select * from @image');
		
		p.then(recordset => done(new Error("Statement should fail.")));

		return p.catch(function(err) {
			try {
				assert.equal(err.message, "Validation failed for parameter 'image'. Invalid buffer.");
			} catch (ex) {
				return done(ex);
			}
				
			return done();
		});
	},
	
	['json parser'](done) {
		let r = new sql.Request;
		r.multiple = true;
		let p = r[MODE]("select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for json path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for json path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for json auto;");
		
		p.then(function(recordsets) {
			try {
				assert.deepEqual(recordsets[0][0], [{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}]);
				assert.deepEqual(recordsets[1][0], [{"a":{"b":{"c":5,"d":6},"x":7,"y":8}}]);
				assert.strictEqual(recordsets[2][0].length, 1000);
			} catch (ex) {
				return done(ex);
			}

			return done();
		});

		return p.catch(done);
	},
	
	['chunked json support'](done) {
		let r = new sql.Request;
		r.multiple = true;
		let p = r[MODE]("select 1 as val;select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for json path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for json path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for json auto;select 'abc' as val;");
		
		p.then(function(recordsets) {
			try {
				assert.equal(recordsets[0][0].val, 1);
				assert.equal(recordsets[0].length, 1);
				assert.equal(recordsets[1][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 39);
				assert.equal(recordsets[2][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 39);
				assert.equal(recordsets[3][0]['JSON_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 9894);
				assert.equal(recordsets[3].length, 1);
				assert.equal(recordsets[4][0].val, 'abc');
				assert.equal(recordsets[4].length, 1);
			} catch (ex) {
				return done(ex);
			}

			return done();
		});

		return p.catch(done);
	},
	
	['chunked xml support'](done) {
		let r = new sql.Request;
		r.multiple = true;
		let p = r[MODE]("select 1 as val;select 1 as 'a.b.c', 2 as 'a.b.d', 3 as 'a.x', 4 as 'a.y' for xml path;select 5 as 'a.b.c', 6 as 'a.b.d', 7 as 'a.x', 8 as 'a.y' for xml path;with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for xml auto;select 'abc' as val;");
		
		p.then(function(recordsets) {
			try {
				assert.equal(recordsets[0][0].val, 1);
				assert.equal(recordsets[0].length, 1);
				assert.equal(recordsets[1][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 67);
				assert.equal(recordsets[2][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 67);
				assert.equal(recordsets[3][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893);
				assert.equal(recordsets[3].length, 1);
				assert.equal(recordsets[4][0].val, 'abc');
				assert.equal(recordsets[4].length, 1);
			} catch (ex) {
				return done(ex);
			}
			
			r = new sql.Request;
			return r.execute('__test3', function(err, recordset) {
				if (err) { return done(err); }

				assert.equal(recordset[0][0]['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893);
				
				let error = null;
				
				r = new sql.Request;
				r.stream = true;
				r.execute('__test3');
				r.on('error', err => error = err);
				
				r.on('row', row => assert.equal(row['XML_F52E2B61-18A1-11d1-B105-00805F49916B'].length, 11893));
				
				return r.on('done', () => done(error));
			});
		});

		return p.catch(done);
	},
	
	['dataLength type correction'](done) {
		sql.on('error', err => console.error(err));
		let r = new sql.Request;
		return r.query('declare @t1 table (c1 bigint, c2 int);insert into @t1 (c1, c2) values (1, 2);with tt1 as ( select * from @t1 ), tt2 as (select count(c1) as x from tt1) select * from tt2 left outer join tt1 on 1=1', function(err, recordset) {
			if (!err) {
				if (err) { return done(err); }
				
				assert.strictEqual(recordset.columns.x.type, sql.Int);
				assert.strictEqual(recordset.columns.c1.type, sql.BigInt);
				assert.strictEqual(recordset.columns.c2.type, sql.Int);
			}

			return done(err);
		});
	},
	
	['connection 1'](done, connection) {
		let request = connection.request();
		return request[MODE]('select @@SPID as id', function(err, recordset) {
			if (global.SPIDS[recordset[0].id]) { return done(new Error("Existing SPID found.")); }
			global.SPIDS[recordset[0].id] = true;
			return done(err);
		});
	},
			
	['connection 2'](done, connection) {
		let request = new sql.Request(connection);
		return request[MODE]('select @@SPID as id', function(err, recordset) {
			if (global.SPIDS[recordset[0].id]) { return done(new Error("Existing SPID found.")); }
			global.SPIDS[recordset[0].id] = true;
			return done(err);
		});
	},
			
	['global connection'](done) {
		let request = new sql.Request();
		return request[MODE]('select @@SPID as id', function(err, recordset) {
			if (global.SPIDS[recordset[0].id]) { return done(new Error("Existing SPID found.")); }
			global.SPIDS[recordset[0].id] = true;
			return done(err);
		});
	},
	
	['login failed'](done, driver, message) {
		let conn;
		let config = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
		config.driver = driver;
		config.user = '__notexistinguser__';
		return conn = new sql.ConnectionPool(config
		
		, function(err) {
			assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true);
			return done();
		});
	},

	['timeout'](done, driver, message) {
		let conn;
		return conn = new sql.ConnectionPool({
			user: '...',
			password: '...',
			server: '10.0.0.1',
			driver,
			connectionTimeout: 1000,
			pool: {idleTimeoutMillis: 500}
		}
			
		, function(err) {
			assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true);
			return done();
		});
	},

	['network error'](done, driver, message) {
		let conn;
		return conn = new sql.ConnectionPool({
			user: '...',
			password: '...',
			server: '...',
			driver
		}
			
		, function(err) {
			assert.equal((message ? (message.exec(err.message) != null) : (err instanceof sql.ConnectionPoolError)), true);
			return done();
		});
	},
	
	['max 10'](done, connection) {
		let countdown = 3;
		let complete = () =>
			setTimeout(function() {
				// this must be delayed because destroying connection take some time
				assert.equal(connection.pool.size, 3);
				assert.equal(connection.pool.available, 3);
				assert.equal(connection.pool.pending, 0);
				assert.equal(connection.pool.borrowed, 0);
				return done();
			}
			
			, 500)
		;
		
		let r1 = new sql.Request(connection);
		r1[MODE]('select 1 as id', function(err, recordset) {
			assert.equal(recordset[0].id, 1);
			
			if (--countdown === 0) { return complete(); }
		});
			
		let r2 = new sql.Request(connection);
		r2[MODE]('select 2 as id', function(err, recordset) {
			assert.equal(recordset[0].id, 2);
			
			if (--countdown === 0) { return complete(); }
		});
			
		let r3 = new sql.Request(connection);
		return r3[MODE]('select 3 as id', function(err, recordset) {
			assert.equal(recordset[0].id, 3);
			
			if (--countdown === 0) { return complete(); }
		});
	},

	['max 1'](done, connection) {
		let countdown = 3;

		let r1 = new sql.Request(connection);
		r1[MODE]('select 1 as id', function(err, recordset) {
			assert.equal(recordset[0].id, 1);
			
			if (--countdown === 0) done();
		});
			
		let r2 = new sql.Request(connection);
		r2[MODE]('select 2 as id', function(err, recordset) {
			assert.equal(recordset[0].id, 2);
			
			if (--countdown === 0) done();
		});
			
		let r3 = new sql.Request(connection);
		r3[MODE]('select 3 as id', function(err, recordset) {
			assert.equal(recordset[0].id, 3);
			
			if (--countdown === 0) done();
		});
		
		setImmediate(() => {
			assert.equal(connection.pool.size, 1);
			assert.equal(connection.pool.available, 0);
			assert.equal(connection.pool.pending, 3);
			assert.equal(connection.pool.borrowed, 0);
		})
	},

	['interruption'](done, connection1, connection2) {
		let i = 0;
		//connection2.on 'error', (err) ->
		let go = function() {
			if (i++ >= 1) {
				return done(new Error("Stack overflow."));
			}

			let r3 = new sql.Request(connection2);
			return r3[MODE]('select 1', function(err, recordset) {
				if (err) { return done(err); }

				assert.equal(connection2.pool.size, 1);
				assert.equal(connection2.pool.available, 1);
				assert.equal(connection2.pool.pending, 0);
				assert.equal(connection2.pool.borrowed, 0);
				
				return done();
			});
		};
		
		let r1 = new sql.Request(connection2);
		return r1[MODE]('select @@spid as session', function(err, recordset) {
			if (err) { return done(err); }

			let r2 = new sql.Request(connection1);
			return r2[MODE](`kill ${recordset[0].session}`, function(err, recordset) {
				if (err) { return done(err); }
				
				return setTimeout(go, 1000);
			});
		});
	},
	
	['concurrent connections'](done, driver) {
		//return done null
		
		let c;
		console.log("");
		
		let conns = [];
		let peak = 500;
		let curr = 0;
		
		let mem = process.memoryUsage();
		console.log("rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024);
		
		let connected = function(err) {
			if (err) {
				console.error(err.stack);
				process.exit();
			}
				
			curr++;
			if (curr === peak) {
				mem = process.memoryUsage();
				console.log("rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024);
				
				curr = 0;
				return Array.from(conns).map((c) =>
					c.close(closed));
			}
		};

		var closed = function() {
			curr++;
			if (curr === peak) {
				conns = [];
				global.gc();
				
				return process.nextTick(function() {
					mem = process.memoryUsage();
					console.log("rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024);
					
					return done();
				});
			}
		};
		
		return __range__(1, peak, true).map((i) =>
			(c = new sql.ConnectionPool(JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`))),

			c.connect(connected),
			conns.push(c)));
	},
	
	['concurrent requests'](done, driver) {
		console.log("");
		
		let config = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
		config.driver = driver;
		config.pool = {min: 0, max: 50};
		
		let conn = new sql.ConnectionPool(config);
		
		return conn.connect(function(err) {
			let r;
			if (err) { return done(err); }
			
			let requests = [];
			let peak = 10000;
			let curr = 0;
			
			let mem = process.memoryUsage();
			console.log("rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024);
			
			let completed = function(err, recordset) {
				if (err) {
					console.error(err.stack);
					process.exit();
				}
				
				assert.equal(recordset[0].num, 123456);
				assert.equal(recordset[0].str, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf');
					
				curr++;
				if (curr === peak) {
					mem = process.memoryUsage();
					console.log("rss: %s, heapTotal: %s, heapUsed: %s", mem.rss / 1024 / 1024, mem.heapTotal / 1024 / 1024, mem.heapUsed / 1024 / 1024);
				
					assert.equal(conn.pool.getPoolSize(), 50);
					
					return done();
				}
			};
			
			return __range__(1, peak, true).map((i) =>
				(r = new sql.Request(conn),
				r[MODE]("select 123456 as num, 'asdfasdfasdfasdfasdfasdfasdfasdfasdf' as str", completed),
				requests.push(r)));
		});
	},

	['streaming off'](done, driver) {
		let config = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
		config.driver = driver;
		config.requestTimeout = 60000;
		
		return sql.connect(config, function(err) {
			if (err) { return done(err); }
			
			let r = new sql.Request;
			return r[MODE]('select * from streaming', function(err, recordset) {
				if (err) { return done(err); }
				
				console.log(`Got ${recordset.length} rows.`);
	
				return done();
			});
		});
	},

	['streaming on'](done, driver) {
		let config = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
		config.driver = driver;
		config.requestTimeout = 60000;

		let rows = 0;
		
		return sql.connect(config, function(err) {
			if (err) { return done(err); }
			
			let r = new sql.Request;
			r.stream = true;
			r[MODE]('select * from streaming');
			r.on('error', err => console.error(err));
			
			r.on('row', row => rows++);
			
			return r.on('done', function() {
				console.log(`Got ${rows} rows.`);
	
				return done();
			});
		});
	}
};

function __guardFunc__(func, transform) {
  return typeof func === 'function' ? transform(func) : undefined;
}
function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
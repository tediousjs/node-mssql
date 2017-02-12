const sql = require('../../tedious.js');
const assert = require("assert");

if (parseInt(process.version.match(/^v(\d+)\./)[1]) > 0) {
	require('../es6/templatestring.js');
}

const config = function() {
	let cfg = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
	cfg.driver = 'tedious';
	return cfg;
};

let connection1 = null;
let connection2 = null;

class MSSQLTestType extends sql.Table {
	constructor() {
		super('dbo.MSSQLTestType');
		
		this.columns.add('a', sql.VarChar(50));
		this.columns.add('b', sql.Int);
	}
}

describe('tedious', function() {
	before(done =>
		sql.connect(config(), function(err) {
			if (err) { return done(err); }
			
			let req = new sql.Request;
			return req.query(require('fs').readFileSync(`${__dirname}/../cleanup.sql`, 'utf8'), function(err) {
				if (err) { return done(err); }
				
				req = new sql.Request;
				return req.query(require('fs').readFileSync(`${__dirname}/../prepare.sql`, 'utf8'), function(err) {
					if (err) { return done(err); }
					
					return sql.close(done);
				});
			});
		})
	);
				
	describe('basic test suite', function() {
		before(function(done) {
			global.DRIVER = 'tedious';
			
			let cfg = config();
			cfg.options.abortTransactionOnError = true;
			return sql.connect(cfg, done);
		});
		
		beforeEach(function(done) {
			global.MODE = 'query';
			return done();
		});
		
		it('stored procedure', done => TESTS['stored procedure'](done, true));
		
		it('stored procedure (batch)', function(done) {
			global.MODE = 'batch';
			return TESTS['stored procedure'](done, true);
		});
		
		it('stored procedure (stream)', done => TESTS['stored procedure'](done, true, true));
		
		it('stored procedure (batch, stream)', function(done) {
			global.MODE = 'batch';
			return TESTS['stored procedure'](done, true, true);
		});
		
		it('user defined types', done => TESTS['user defined types'](done));
		
		it('binary data', done => TESTS['binary data'](done));
		
		it('variant data (not yet published)', done => TESTS['variant data'](done));
		
		it('stored procedure with one empty recordset', done => TESTS['stored procedure with one empty recordset'](done));
		
		it.skip('domain', done => TESTS['domain'](done));
		
		it('empty query', done => TESTS['empty query'](done));
		
		it('query with no recordset', done => TESTS['query with no recordset'](done));
		
		it('query with one recordset', done => TESTS['query with one recordset'](done));
		
		it('query with multiple recordsets', done => TESTS['query with multiple recordsets'](done, true));
		
		it('query with multiple recordsets (stream)', done => TESTS['query with multiple recordsets'](done, true, true));
		
		it('query with input parameters', done => TESTS['query with input parameters'](done));
		
		it('query with input parameters (batch)', function(done) {
			global.MODE = 'batch';
			return TESTS['query with input parameters'](done);
		});
		
		it('query with output parameters', done => TESTS['query with output parameters'](done));
		
		it('query with output parameters (batch)', function(done) {
			global.MODE = 'batch';
			return TESTS['query with output parameters'](done);
		});
		
		it('query with error', done => TESTS['query with error'](done));
		
		it('query with error (stream)', done => TESTS['query with error'](done, true));
		
		it('query with multiple errors', done => TESTS['query with multiple errors'](done));
		
		it('query with multiple errors (stream)', done => TESTS['query with multiple errors'](done, true));
		
		it('query with raiseerror', done => TESTS['query with raiseerror'](done));
		
		it('batch', done => TESTS['batch'](done));
		
		it('batch (stream)', done => TESTS['batch'](done, true));
		
		it('create procedure batch', done => TESTS['create procedure batch'](done));
		
		it('prepared statement', done => TESTS['prepared statement'](true, done));
		
		it('prepared statement (stream)', done => TESTS['prepared statement'](true, done, true));
		
		it('prepared statement with affected rows', done => TESTS['prepared statement with affected rows'](done));
		
		it('prepared statement in transaction', done => TESTS['prepared statement in transaction'](done));
		
		it('transaction with rollback', done => TESTS['transaction with rollback'](done));
		
		it('transaction with commit', done => TESTS['transaction with commit'](done));
		
		it('transaction with error (XACT_ABORT set to ON)', done => TESTS['transaction with error'](done));
		
		it('transaction with synchronous error', done => TESTS['transaction with synchronous error'](done));

		it('cancel request', done => TESTS['cancel request'](done, /Canceled./));
		
		it('request timeout', done => TESTS['request timeout'](done, 'tedious', /Timeout: Request failed to complete in 500ms/));
		
		it('type validation', done => TESTS['type validation'](done));
		
		it('dataLength type correction', done => TESTS['dataLength type correction'](done));
		
		it('type validation (batch)', function(done) {
			global.MODE = 'batch';
			return TESTS['type validation'](done);
		});

		it.skip('chunked json support (requires SQL Server 2016)', done => TESTS['chunked json support'](done));
		
		it('chunked xml support', done => TESTS['chunked xml support'](done));
		
		return after(done => sql.close(done));
	});
	
	describe.skip('json support (requires SQL Server 2016)', function() {
		before(function(done) {
			global.DRIVER = 'tedious';
			global.MODE = 'query';
			
			let cfg = config();
			cfg.parseJSON = true;
			return sql.connect(cfg, done);
		});
		
		it('parser', done => TESTS['json parser'](done));
		
		return after(done => sql.close(done));
	});
	
	describe('bulk load', function() {
		before(function(done) {
			global.DRIVER = 'tedious';
			
			return sql.connect(config(), function(err) {
				if (err) { return done(err); }
				
				let req = new sql.Request;
				return req.query('delete from bulk_table', done);
			});
		});
		
		it('bulk load (table)', done => TESTS['bulk load']('bulk_table', done));
			
		it('bulk load (temporary table)', done => TESTS['bulk load']('#anohter_bulk_table', done));
		
		return after(done => sql.close(done));
	});
	
	describe('dates and times (local)', function() {
		before(function(done) {
			global.DRIVER = 'tedious';
			
			let cfg = config();
			cfg.options.useUTC = false;
			return sql.connect(cfg, done);
		});
	
		beforeEach(function(done) {
			global.MODE = 'query';
			return done();
		});
	
		it('time', done => TIMES['time'](false, done));
			
		it('time as parameter', done => TIMES['time as parameter'](false, done));
			
		it('date', done => TIMES['date'](false, done));
			
		it('date as parameter', done => TIMES['date as parameter'](false, done));
			
		it('datetime', done => TIMES['datetime'](false, done));
			
		it('datetime as parameter', done => TIMES['datetime as parameter'](false, done));
			
		it('datetime2', done => TIMES['datetime2'](false, done));
			
		it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](false, done));
			
		it('datetimeoffset', done => TIMES['datetimeoffset'](false, done));
			
		it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](false, done));
				
		it('smalldatetime', done => TIMES['smalldatetime'](false, done));
			
		it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](false, done));
		
		return after(done => sql.close(done));
	});
	
	describe('dates and times (utc)', function() {
		before(function(done) {
			global.DRIVER = 'tedious';
			
			let cfg = config();
			cfg.options.useUTC = true;
			return sql.connect(cfg, done);
		});
	
		beforeEach(function(done) {
			global.MODE = 'query';
			return done();
		});
	
		it('time', done => TIMES['time'](true, done));
			
		it('time as parameter', done => TIMES['time as parameter'](true, done));
			
		it('date', done => TIMES['date'](true, done));
			
		it('date as parameter', done => TIMES['date as parameter'](true, done));
			
		it('datetime', done => TIMES['datetime'](true, done));
			
		it('datetime as parameter', done => TIMES['datetime as parameter'](true, done));
			
		it('datetime2', done => TIMES['datetime2'](true, done));
			
		it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](true, done));
			
		it('datetimeoffset', done => TIMES['datetimeoffset'](true, done));
			
		it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](true, done));
				
		it('smalldatetime', done => TIMES['smalldatetime'](true, done));
			
		it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](true, done));
		
		return after(done => sql.close(done));
	});
	
	if (global.TEMPLATE_STRING) {
		describe('template strings', function() {
			before(function(done) {
				global.DRIVER = 'tedious';
				return sql.connect(config(), done);
			});
			
			it('query', done => TEMPLATE_STRING['query'](done));
			
			it('batch', done => TEMPLATE_STRING['batch'](done));
			
			return after(done => sql.close(done));
		});
	}
	
	describe('multiple connections test suite', function() {
		before(function(done) {
			global.SPIDS = {};
			return connection1 = new sql.ConnectionPool(config(), () =>
				connection2 = new sql.ConnectionPool(config(), () => sql.connect(config(), done))
			);
		});
		
		beforeEach(function(done) {
			global.MODE = 'query';
			return done();
		});
		
		it('connection 1', done => TESTS['connection 1'](done, connection1));
		
		it('connection 2', done => TESTS['connection 2'](done, connection2));
		
		it('global connection', done => TESTS['global connection'](done));
	
		return after(function(done) {
			connection1.close();
			connection2.close();
			return sql.close(done);
		});
	});
	
	describe('connection errors', function() {
		it('login failed', done => TESTS['login failed'](done, 'tedious', /Login failed for user '(.*)'/));
	
		it('timeout', done => TESTS['timeout'](done, 'tedious', /Failed to connect to 10.0.0.1:1433 in 1000ms/));
	
		return it('network error', done => TESTS['network error'](done, 'tedious', /Failed to connect to \.\.\.:1433 - getaddrinfo ENOTFOUND/));
	});
	
	describe('connection pooling', function() {
		before(done =>
			connection1 = new sql.ConnectionPool(config(), function() {
				let cfg = config();
				cfg.pool = {max: 1};
				return connection2 = new sql.ConnectionPool(cfg, done);
			})
		);
		
		beforeEach(() => {
			global.MODE = 'query';
		});
			
		it('max 10', done => TESTS['max 10'](done, connection1));
	
		it('max 1', done => TESTS['max 1'](done, connection2));
		
		it('interruption', done => TESTS['interruption'](done, connection1, connection2));
		
		return {
			after() {
				connection1.close();
				return connection2.close();
			}
		};
	});
	
	describe.skip('Stress', function() {
		beforeEach(function(done) {
			global.MODE = 'query';
			return done();
		});
			
		it('concurrent connections', done => TESTS['concurrent connections'](done, 'tedious'));
		
		it('concurrent requests', done => TESTS['concurrent requests'](done, 'tedious'));
	
		it('streaming off', function(done) {
			this.timeout(600000);
			
			return TESTS['streaming off'](done, 'tedious');
		});
		
		return it('streaming on', function(done) {
			this.timeout(600000);
			
			return TESTS['streaming on'](done, 'tedious');
		});
	});
	
	describe('tvp', function() {
		before(function(done) {
			global.DRIVER = 'tedious';
			
			return sql.connect(config(), done);
		});
			
		it('new Table', function(done) {
			let tvp = new MSSQLTestType;
			tvp.rows.add('asdf', 15);
	
			let r = new sql.Request;
			r.input('tvp', tvp);
			return r.execute('__test7', function(err, recordsets) {
				if (err) { return done(err); }
				
				assert.equal(recordsets[0].length, 1);
				assert.equal(recordsets[0][0].a, 'asdf');
				assert.equal(recordsets[0][0].b, 15);
				
				return done();
			});
		});
			
		it('Recordset.toTable()', function(done) {
			let r = new sql.Request;
			return r.query('select \'asdf\' as a, 15 as b', function(err, recordset) {
				if (err) { return done(err); }
	
				let tvp = recordset.toTable();
	
				let r2 = new sql.Request;
				r2.input('tvp', tvp);
				return r2.execute('__test7', function(err, recordsets) {
					assert.equal(recordsets[0].length, 1);
					assert.equal(recordsets[0][0].a, 'asdf');
					assert.equal(recordsets[0][0].b, 15);
					
					return done(err);
				});
			});
		});
		
		it.skip('query (todo)', function(done) {
			let tvp = new MSSQLTestType;
			tvp.rows.add('asdf', 15);
			
			let r = new sql.Request;
			r.input('tvp', tvp);
			r.verbose = true;
			return r.query('select * from @tvp', function(err, recordsets) {
				if (err) { return done(err); }
				
				assert.equal(recordsets[0].length, 1);
				assert.equal(recordsets[0][0].a, 'asdf');
				assert.equal(recordsets[0][0].b, 15);
				
				return done();
			});
		});
		
		it.skip('prepared statement (todo)', function(done) {
			let tvp = new MSSQLTestType;
			tvp.rows.add('asdf', 15);
			
			let ps = new sql.PreparedStatement;
			ps.input('tvp', sql.TVP('MSSQLTestType'));
			return ps.prepare('select * from @tvp', function(err) {
				if (err) { return done(err); }
	
				return ps.execute({tvp}, function(err, recordset) {
					if (err) { return done(err); }
					
					assert.equal(recordsets[0].length, 1);
					assert.equal(recordsets[0][0].a, 'asdf');
					assert.equal(recordsets[0][0].b, 15);
					
					return ps.unprepare(done);
				});
			});
		});
		
		return after(() => sql.close());
	});
	
	return after(done =>
		sql.connect(config(), function(err) {
			if (err) { return done(err); }
			
			let req = new sql.Request;
			return req.query(require('fs').readFileSync(`${__dirname}/../cleanup.sql`, 'utf8'), function(err) {
				if (err) { return done(err); }
				
				return sql.close(done);
			});
		})
	);
});

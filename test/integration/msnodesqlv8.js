let installed;
const sql = require('../../');
const assert = require("assert");

const config = function() {
	let cfg = JSON.parse(require('fs').readFileSync(`${__dirname}/../.mssql.json`));
	cfg.driver = 'msnodesqlv8';
	return cfg;
};

let connection1 = null;
let connection2 = null;

if (process.versions.node.match(/^(0\.12\.|4\.)/)) {
	installed = true;

	try {
		require('msnodesqlv8');
	} catch (ex) {
		installed = false;
	}
}

// msnodesqlv8 tests are only available on windows
if (process.platform.match(/^win/) && installed) {
	describe('msnodesqlv8', function() {
		before(done =>
			sql.connect(config(), function(err) {
				if (err) { return done(err); }
				
				let req = new sql.Request;
				return req.batch(require('fs').readFileSync(`${__dirname}/../cleanup.sql`, 'utf8'), function(err) {
					if (err) { return done(err); }
					
					req = new sql.Request;
					return req.batch(require('fs').readFileSync(`${__dirname}/../prepare.sql`, 'utf8'), function(err) {
						if (err) { return done(err); }
						
						return sql.close(done);
					});
				});
			})
		);

		describe('basic test suite', function() {
			before(function(done) {
				global.DRIVER = 'msnodesqlv8';
				
				let cfg = config();
				cfg.parseJSON = true;
				return sql.connect(cfg, done);
			});
			
			beforeEach(function(done) {
				global.MODE = 'query';
				return done();
			});
			
			it('stored procedure', done => TESTS['stored procedure'](done, true));
			
			it('stored procedure (stream)', done => TESTS['stored procedure'](done, true, true));
		
			it('user defined types', done => TESTS['user defined types'](done));
			
			it.skip('binary data (buggy in msnodesqlv8)', done => TESTS['binary data'](done));
		
			it.skip('variant data (not supported by msnodesql)', done => TESTS['variant data'](done));
			
			it('stored procedure with one empty recordset', done => TESTS['stored procedure with one empty recordset'](done));
		
			it('domain', done => TESTS['domain'](done));
			
			it('empty query', done => TESTS['empty query'](done));
			
			it('query with no recordset', done => TESTS['query with no recordset'](done));
			
			it('query with one recordset', done => TESTS['query with one recordset'](done));
			
			it('query with multiple recordsets', done => TESTS['query with multiple recordsets'](done, true));
			
			it('query with multiple recordsets (stream)', done => TESTS['query with multiple recordsets'](done, true, true));
			
			it('query with input parameters', done => TESTS['query with input parameters'](done));
			
			it('query with output parameters', done => TESTS['query with output parameters'](done));
			
			it('query with error', done => TESTS['query with error'](done));
			
			it('query with error (stream)', done => TESTS['query with error'](done, true));
		
			it.skip('query with multiple errors (not supported by msnodesqlv8)', done => TESTS['query with multiple errors'](done));
			
			it.skip('query with raiseerror (not supported by msnodesqlv8)', done => TESTS['query with raiseerror'](done));
		
			it('batch', done => TESTS['batch'](done));
			
			it('batch (stream)', done => TESTS['batch'](done, true));
			
			it('create procedure batch', done => TESTS['create procedure batch'](done));
		
			it('prepared statement', done => TESTS['prepared statement'](true, done));
			
			it('prepared statement (stream)', done => TESTS['prepared statement'](true, done, true));
		
			it('prepared statement with affected rows', done => TESTS['prepared statement with affected rows'](done));
		
			it('prepared statement in transaction', done => TESTS['prepared statement in transaction'](done));
			
			it('transaction with rollback', done => TESTS['transaction with rollback'](done));
		
			it('transaction with rollback (manually interrupted)', done => TESTS['transaction with rollback (manually interrupted)'](done));
			
			it('transaction with commit', done => TESTS['transaction with commit'](done));
			
			it('transaction queue', done => TESTS['transaction queue'](done));
		
			it.skip('cancel request (not supported by msnodesqlv8)', done => TESTS['cancel request'](done));
		
			it.skip('request timeout (not supported by msnodesqlv8)', done => TESTS['request timeout'](done, 'msnodesqlv8'));
		
			it('dataLength type correction', done => TESTS['dataLength type correction'](done));
		
			it.skip('chunked json support (requires SQL Server 2016)', done => TESTS['chunked json support'](done));
		
			it('chunked xml support', done => TESTS['chunked xml support'](done));
			
			return after(() => sql.close());
		});
		
		describe.skip('json support (requires SQL Server 2016)', function() {
			before(function(done) {
				global.DRIVER = 'msnodesqlv8';
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
				global.DRIVER = 'msnodesqlv8';
				
				return sql.connect(config(), function(err) {
					if (err) { return done(err); }
					
					let req = new sql.Request;
					return req.query('delete from bulk_table', done);
				});
			});
			
			it('bulk load (table)', done => TESTS['bulk load']('bulk_table', done));
				
			it.skip('bulk load (temporary table) (not supported by msnodesqlv8)', done => TESTS['bulk load']('#anohter_bulk_table', done));
			
			return after(done => sql.close(done));
		});
		
		describe('msnodesqlv8 dates and times', function() {
			before(function(done) {
				global.DRIVER = 'msnodesqlv8';
			
				return sql.connect(config(), done);
			});
					
			it('time', done => TIMES['time'](true, done));
				
			it('time as parameter', done => TIMES['time as parameter'](true, done));
				
			it('date', done => TIMES['date'](true, done));
				
			it('date as parameter', done => TIMES['date as parameter'](true, done));
				
			it('datetime', done => TIMES['datetime'](true, done));
				
			it('datetime as parameter', done => TIMES['datetime as parameter'](true, done));
				
			it('datetime2', done => TIMES['datetime2'](true, done));
				
			it('datetime2 as parameter', done => TIMES['datetime2 as parameter'](true, done));
			
			// https://github.com/WindowsAzure/node-sqlserver/issues/160	
			it('datetimeoffset', done => TIMES['datetimeoffset'](true, done));
			
			// https://github.com/WindowsAzure/node-sqlserver/issues/160	
			it('datetimeoffset as parameter', done => TIMES['datetimeoffset as parameter'](true, done));
				
			it('smalldatetime', done => TIMES['smalldatetime'](true, done));
				
			it('smalldatetime as parameter', done => TIMES['smalldatetime as parameter'](true, done));
			
			return after(() => sql.close());
		});
	
		describe('msnodesqlv8 multiple connections test suite', function() {
			before(function(done) {
				global.MODE = 'query';
				global.SPIDS = {};
				return connection1 = new sql.Connection(config(), () =>
					connection2 = new sql.Connection(config(), () => sql.connect(config(), done))
				);
			});
			
			it('connection 1', done => TESTS['connection 1'](done, connection1));
			
			it('connection 2', done => TESTS['connection 2'](done, connection2));
			
			it('global connection', done => TESTS['global connection'](done));
		
			return after(function() {
				connection1.close();
				connection2.close();
				return sql.close();
			});
		});
		
		describe('msnodesqlv8 connection errors', function() {
			it('login failed', done => TESTS['login failed'](done, 'msnodesqlv8', /Login failed for user '(.*)'\./));
		
			it.skip('timeout (not supported by msnodesqlv8)', done => TESTS['timeout'](done, 'msnodesqlv8'));
		
			return it.skip('network error (not supported by msnodesqlv8)', done => TESTS['network error'](done, 'msnodesqlv8'));
		});
		
		describe('msnodesqlv8 connection pooling', function() {
			before(done =>
				connection1 = new sql.Connection(config(), function() {
					let cfg = config();
					cfg.pool = {max: 1};
					return connection2 = new sql.Connection(cfg, done);
				})
			);
		
			beforeEach(function(done) {
				global.MODE = 'query';
				return done();
			});
				
			it('max 10', done => TESTS['max 10'](done, connection1));
		
			it('max 1', done => TESTS['max 1'](done, connection2));
		
			it.skip('interruption (not supported by msnodesqlv8)', done => TESTS['interruption'](done, connection1, connection2));
			
			return {
				after() {
					connection1.close();
					return connection2.close();
				}
			};
		});
	
		describe('msnodesqlv8 stress', function() {
			it.skip('concurrent connections', done => TESTS['concurrent connections'](done, 'msnodesqlv8'));
			
			it.skip('concurrent requests', done => TESTS['concurrent requests'](done, 'msnodesqlv8'));
		
			it.skip('streaming off', done => TESTS['streaming off'](done, 'msnodesqlv8'));
			
			return it.skip('streaming on', done => TESTS['streaming on'](done, 'msnodesqlv8'));
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
}


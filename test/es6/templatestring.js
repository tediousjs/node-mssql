var assert = require('assert');
var sql = require('../../');

global.TEMPLATE_STRING = {
	'query': function(done) {
		sql.query`select getdate() as date\n\n, ${1337} as num, ${true} as bool`.then(function(recordset) {
			assert.ok(recordset[0].date instanceof Date);
			assert.strictEqual(recordset[0].num, 1337);
			assert.strictEqual(recordset[0].bool, true);
			
			done(null);
		}).catch(function(err) {
			done(err);
		});
	},
	'batch': function(done) {
		sql.batch`select newid() as uid`.then(function(recordset) {
			assert.strictEqual(recordset.columns.uid.type, sql.UniqueIdentifier);
			
			done(null);
		}).catch(function(err) {
			done(err);
		});
	}
}

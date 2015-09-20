sql = require '../../'
assert = require 'assert'

describe 'Unit', ->
	it 'table', (done) ->
		t = new sql.Table 'MyTable'
		t.columns.add 'a', sql.Int, nullable: false
		t.columns.add 'b', sql.VarChar(50), nullable: true
		t.rows.add 777, 'asdf'
		t.rows.add 453
		t.rows.add 4535434
		t.rows.add 12, 'XCXCDCDSCDSC'
		t.rows.add 1
		t.rows.add 7278, '4524254'
		
		assert.strictEqual t.name, 'MyTable'
		assert.strictEqual t.schema, null
		assert.strictEqual t.database, null
		assert.strictEqual t.path, '[MyTable]'
		assert.strictEqual t.columns.length, 2
		assert.strictEqual t.rows.length, 6
		assert.deepEqual t.rows[3], [12, 'XCXCDCDSCDSC']
		assert.strictEqual t.temporary, false
		
		t = new sql.Table 'schm.MyTable'
		
		assert.strictEqual t.name, 'MyTable'
		assert.strictEqual t.schema, 'schm'
		assert.strictEqual t.database, null
		assert.strictEqual t.path, '[schm].[MyTable]'
		assert.strictEqual t.temporary, false
		
		t = new sql.Table 'db.schm.MyTable'
		
		assert.strictEqual t.name, 'MyTable'
		assert.strictEqual t.schema, 'schm'
		assert.strictEqual t.database, 'db'
		assert.strictEqual t.path, '[db].[schm].[MyTable]'
		assert.strictEqual t.temporary, false
		
		t = new sql.Table '[db.db].[schm.schm].[MyTable.MyTable]'
		
		assert.strictEqual t.name, 'MyTable.MyTable'
		assert.strictEqual t.schema, 'schm.schm'
		assert.strictEqual t.database, 'db.db'
		assert.strictEqual t.path, '[db.db].[schm.schm].[MyTable.MyTable]'
		assert.strictEqual t.temporary, false
		
		t = new sql.Table '#temporary'
		
		assert.strictEqual t.name, '#temporary'
		assert.strictEqual t.schema, null
		assert.strictEqual t.database, null
		assert.strictEqual t.path, '[#temporary]'
		assert.strictEqual t.temporary, true
		
		rs = [
			{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}
		]
		rs.columns =
			'JSON_F52E2B61-18A1-11d1-B105-00805F49916B':
				name: 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'
		
		t = sql.Table.fromRecordset rs
		
		assert.strictEqual t.columns.length, 1
		assert.strictEqual t.rows.length, 1
		assert.deepEqual t.rows[0], ['{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}']
		
		done()
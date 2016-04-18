sql = require '../../'
assert = require 'assert'
cs = require '../../lib/connectionstring'

describe 'Connection String', ->
	it 'Connection String #1', (done) ->
		cfg = cs.resolve "Server=192.168.0.1;Database=testdb;User Id=testuser;Password=testpwd"
		
		assert.strictEqual cfg.driver, undefined
		assert.strictEqual cfg.user, 'testuser'
		assert.strictEqual cfg.password, 'testpwd'
		assert.strictEqual cfg.database, 'testdb'
		assert.strictEqual cfg.server, '192.168.0.1'
		assert.strictEqual cfg.port, undefined
		
		done()
	
	it 'Connection String #2', (done) ->
		cfg = cs.resolve "Server=tcp:192.168.0.1,1433;Database=testdb;User Id=testuser;Password=testpwd"
		
		assert.strictEqual cfg.driver, undefined
		assert.strictEqual cfg.user, 'testuser'
		assert.strictEqual cfg.password, 'testpwd'
		assert.strictEqual cfg.database, 'testdb'
		assert.strictEqual cfg.server, '192.168.0.1'
		assert.strictEqual cfg.port, 1433
		
		done()
	
	it 'Connection String #3', (done) ->
		cfg = cs.resolve "Driver=msnodesql;Server=192.168.0.1;Database=testdb;User Id={testuser};Password='t;estpwd'"

		assert.strictEqual cfg.driver, 'msnodesql'
		assert.strictEqual cfg.connectionString, "Driver={SQL Server Native Client 11.0};Server=192.168.0.1;Database=testdb;User Id={testuser};Password='t;estpwd'"
		
		done()
	
	it 'Connection String #4', (done) ->
		cfg = cs.resolve "mssql://username:password@localhost:1433/database?encrypt=true&stream=true&domain=mydomain&requestTimeout=30000"
		
		assert.strictEqual cfg.driver, undefined
		assert.strictEqual cfg.user, 'username'
		assert.strictEqual cfg.password, 'password'
		assert.strictEqual cfg.database, 'database'
		assert.strictEqual cfg.server, 'localhost'
		assert.strictEqual cfg.domain, 'mydomain'
		assert.strictEqual cfg.port, 1433
		assert.strictEqual cfg.options.encrypt, true
		assert.strictEqual cfg.requestTimeout, 30000

		done()
	
	it 'Connection String #5', (done) ->
		cfg = cs.resolve "mssql://username:password@localhost/INSTANCE/database?encrypt=true&stream=true&domain=mydomain&driver=msnodesql"
		
		assert.strictEqual cfg.driver, 'msnodesql'
		assert.strictEqual cfg.connectionString, "server={localhost\\INSTANCE};uid={mydomain\\username};pwd={password};database={database};encrypt={true};driver={SQL Server Native Client 11.0}"
		
		done()

describe 'Unit', ->	
	it 'table', (done) ->
		t = new sql.Table 'MyTable'
		t.columns.add 'a', sql.Int, nullable: false
		t.columns.add 'b', sql.VarChar(50), nullable: true
		assert.strictEqual t.declare(), 'create table [MyTable] ([a] int not null, [b] varchar (50) null)'
		
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
				type: sql.NVarChar
		
		t = sql.Table.fromRecordset rs, 'tablename'
		assert.strictEqual t.declare(), 'create table [tablename] ([JSON_F52E2B61-18A1-11d1-B105-00805F49916B] nvarchar (MAX))'
		
		assert.strictEqual t.columns.length, 1
		assert.strictEqual t.rows.length, 1
		assert.deepEqual t.rows[0], ['{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}']
		
		t = new sql.Table 'MyTable'
		t.columns.add 'a', sql.Int, primary: true
		t.columns.add 'b', sql.TinyInt, nullable: true
		assert.strictEqual t.declare(), 'create table [MyTable] ([a] int primary key, [b] tinyint null)'
		
		t = new sql.Table '#mytemptable'
		t.columns.add 'a', sql.Int, primary: true
		t.columns.add 'b', sql.TinyInt, nullable: true
		t.columns.add 'c', sql.TinyInt, nullable: false, primary: true
		assert.strictEqual t.declare(), 'create table [#mytemptable] ([a] int, [b] tinyint null, [c] tinyint not null, constraint PK_mytemptable primary key (a, c))'
		
		done()

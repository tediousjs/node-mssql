# node-mssql

An easy-to-use MSSQL database connector for Node.js / io.js.

[![NPM Version][npm-image]][npm-url] [![NPM Downloads][downloads-image]][downloads-url] [![Travis CI][travis-image]][travis-url] [![Appveyor CI][appveyor-image]][appveyor-url] [![Join the chat at https://gitter.im/patriksimek/node-mssql](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/patriksimek/node-mssql?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

**node-mssql**
- Has unified interface for multiple TDS drivers.
- Has built-in connection pooling.
- Supports built-in JSON serialization instroduced in SQL Server 2016.
- Supports Stored Procedures, Transactions, Prepared Statements, Bulk Load and TVP.
- Supports serialization of Geography and Geometry CLR types.
- Has smart JS data type to SQL data type mapper.
- Supports Promises, Streams and standard callbacks.
- Is stable and has no breaking change since 2013.
- Is tested in production environment.
- Is well documented.

There is also [co](https://github.com/visionmedia/co) wrapper available - [co-mssql](https://github.com/patriksimek/co-mssql).             
If you're looking for session store for connect/express, visit [connect-mssql](https://github.com/patriksimek/connect-mssql).

Supported TDS drivers:
- [![Github Stars][tedious-image] Tedious][tedious-url] by Mike D Pilsbury (pure javascript - windows/osx/linux)
- [![Github Stars][msnodesql-image] Microsoft Driver for Node.js for SQL Server][msnodesql-url] by Microsoft Corporation (native - windows only)
- [![Github Stars][tds-image] node-tds][tds-url] by Chad Retz (pure javascript - windows/osx/linux)

node-mssql uses Tedious as the default driver.

## Installation

    npm install mssql

## Quick Example

```javascript
var sql = require('mssql'); 

var config = {
    user: '...',
    password: '...',
    server: 'localhost', // You can use 'localhost\\instance' to connect to named instance
    database: '...',
    
    options: {
        encrypt: true // Use this if you're on Windows Azure
    }
}

var connection = new sql.Connection(config, function(err) {
    // ... error checks
    
    // Query
	
    var request = new sql.Request(connection); // or: var request = connection.request();
    request.query('select 1 as number', function(err, recordset) {
        // ... error checks
        
        console.dir(recordset);
    });
	
    // Stored Procedure
	
    var request = new sql.Request(connection);
    request.input('input_parameter', sql.Int, 10);
    request.output('output_parameter', sql.VarChar(50));
    request.execute('procedure_name', function(err, recordsets, returnValue) {
        // ... error checks
        
        console.dir(recordsets);
    });
});

connection.on('error', function(err) {
	// ... error handler
});
```

### Quick Example with one global connection

```javascript
var sql = require('mssql'); 

var config = {
    user: '...',
    password: '...',
    server: 'localhost', // You can use 'localhost\\instance' to connect to named instance
    database: '...',
    
    options: {
        encrypt: true // Use this if you're on Windows Azure
    }
}

sql.connect(config, function(err) {
    // ... error checks
	
    // Query
	
    var request = new sql.Request();
    request.query('select 1 as number', function(err, recordset) {
        // ... error checks

        console.dir(recordset);
    });
	
    // Stored Procedure
	
    var request = new sql.Request();
    request.input('input_parameter', sql.Int, value);
    request.output('output_parameter', sql.VarChar(50));
    request.execute('procedure_name', function(err, recordsets, returnValue) {
        // ... error checks

        console.dir(recordsets);
    });
});

sql.on('error', function(err) {
	// ... error handler
});
```

<a name="streaming" />
### Streaming example with one global connection

If you plan to work with large amount of rows, you should always use streaming. Once you enable this, you must listen for events to receive data.

```javascript
var sql = require('mssql'); 

var config = {
    user: '...',
    password: '...',
    server: 'localhost', // You can use 'localhost\\instance' to connect to named instance
    database: '...',
    stream: true, // You can enable streaming globally
    
    options: {
        encrypt: true // Use this if you're on Windows Azure
    }
}

sql.connect(config, function(err) {
    // ... error checks
	
    var request = new sql.Request();
    request.stream = true; // You can set streaming differently for each request
    request.query('select * from verylargetable'); // or request.execute(procedure);
    
    request.on('recordset', function(columns) {
    	// Emitted once for each recordset in a query
    });
    
    request.on('row', function(row) {
    	// Emitted for each row in a recordset
    });
    
    request.on('error', function(err) {
    	// May be emitted multiple times
    });
    
    request.on('done', function(returnValue) {
    	// Always emitted as the last one
    });
});

sql.on('error', function(err) {
	// ... error handler
});
```

## Documentation

### Configuration

* [Basic](#cfg-basic)
* [Tedious](#cfg-tedious)
* [Microsoft Driver for Node.js for SQL Server](#cfg-msnodesql)
* [node-tds](#cfg-node-tds)

### Connections

* [Connection](#connection)
* [connect](#connect)
* [close](#close)

### Requests

* [Request](#request)
* [execute](#execute)
* [input](#input)
* [output](#output)
* [pipe](#pipe)
* [query](#query)
* [batch](#batch)
* [bulk](#bulk)
* [cancel](#cancel)

### Transactions

* [Transaction](#transaction)
* [begin](#begin)
* [commit](#commit)
* [rollback](#rollback)

### Prepared Statements

* [PreparedStatement](#prepared-statement)
* [input](#prepared-statement-input)
* [output](#prepared-statement-output)
* [prepare](#prepare)
* [execute](#prepared-statement-execute)
* [unprepare](#unprepare)

### Other

* [CLI](#cli)
* [Geography and Geometry](#geography)
* [Table-Valued Parameter](#tvp)
* [JSON support](#json)
* [Errors](#errors)
* [Promises](#promises)
* [Metadata](#meta)
* [Data Types](#data-types)
* [SQL injection](#injection)
* [Verbose Mode](#verbose)
* [Known Issues](#issues)
* [Contributing](https://github.com/patriksimek/node-mssql/wiki/Contributing)

## Configuration

```javascript
var config = {
    user: '...',
    password: '...',
    server: 'localhost',
    database: '...',
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
}
```

<a name="cfg-basic" />
### Basic configuration is same for all drivers.

- **driver** - Driver to use (default: `tedious`). Possible values: `tedious`, `msnodesql` or `tds`.
- **user** - User name to use for authentication.
- **password** - Password to use for authentication.
- **server** - Server to connect to. You can use 'localhost\\instance' to connect to named instance.
- **port** - Port to connect to (default: `1433`). Don't set when connecting to named instance.
- **domain** - Once you set domain, driver will connect to SQL Server using domain login.
- **database** - Database to connect to (default: dependent on server configuration).
- **connectionTimeout** - Connection timeout in ms (default: `15000`).
- **requestTimeout** - Request timeout in ms (default: `15000`).
- **stream** - Stream recordsets/rows instead of returning them all at once as an argument of callback (default: `false`). You can also enable streaming for each request independently (`request.stream = true`). Always set to `true` if you plan to work with large amount of rows.
- **parseJSON** - Parse JSON recordsets to JS objects (default: `false`). For more information please see section [JSON support](#json).
- **pool.max** - The maximum number of connections there can be in the pool (default: `10`).
- **pool.min** - The minimun of connections there can be in the pool (default: `0`).
- **pool.idleTimeoutMillis** - The Number of milliseconds before closing an unused connection (default: `30000`).

<a name="cfg-tedious" />
### Tedious

- **options.instanceName** - The instance name to connect to. The SQL Server Browser service must be running on the database server, and UDP port 1444 on the database server must be reachable.
- **options.useUTC** - A boolean determining whether or not use UTC time for values without time zone offset (default: `true`).
- **options.encrypt** - A boolean determining whether or not the connection will be encrypted (default: `false`) Encryption support is experimental.
- **options.tdsVersion** - The version of TDS to use (default: `7_4`, available: `7_1`, `7_2`, `7_3_A`, `7_3_B`, `7_4`).
- **options.appName** - Application name used for SQL server logging.
- **options.abortTransactionOnError** - A boolean determining whether to rollback a transaction automatically if any error is encountered during the given transaction's execution. This sets the value for `XACT_ABORT` during the initial SQL phase of a connection.

More information about Tedious specific options: http://pekim.github.io/tedious/api-connection.html

<a name="cfg-msnodesql" />
### Microsoft Driver for Node.js for SQL Server

This driver is not part of the default package and must be installed separately by `npm install msnodesql`. If you are looking for compiled binaries, see [node-sqlserver-binary](https://github.com/jorgeazevedo/node-sqlserver-binary).

- **connectionString** - Connection string (default: see below).
- **options.instanceName** - The instance name to connect to. The SQL Server Browser service must be running on the database server, and UDP port 1444 on the database server must be reachable.
- **options.trustedConnection** - Use Windows Authentication (default: `false`).
- **options.useUTC** - A boolean determining whether or not to use UTC time for values without time zone offset (default: `true`).

Default connection string when connecting to port:
```
Driver={SQL Server Native Client 11.0};Server={#{server},#{port}};Database={#{database}};Uid={#{user}};Pwd={#{password}};Trusted_Connection={#{trusted}};
```

Default connection string when connecting to named instance:
```
Driver={SQL Server Native Client 11.0};Server={#{server}\\#{instance}};Database={#{database}};Uid={#{user}};Pwd={#{password}};Trusted_Connection={#{trusted}};
```

<a name="cfg-node-tds" />
### node-tds

This driver is not part of the default package and must be installed separately by `npm install tds`.

_This module updates the node-tds driver with extra features and bug fixes by overriding some of its internal functions. If you want to disable this, require module with `var sql = require('mssql/nofix')`._

<a name="connection" />
## Connections

Internally, each `Connection` instance is a separate pool of TDS connections. Once you create a new `Request`/`Transaction`/`Prepared Statement`, a new TDS connection is acquired from the pool and reserved for desired action. Once the action is complete, connection is released back to the pool. Connection health check is built-in so once the dead connection is discovered, it is immediately replaced with a new one.

**IMPORTANT**: Always attach an `error` listener to created connection. Whenever something goes wrong with the connection it will emit an error and if there is no listener (and no domain listener as a backup) it will crash the application as an uncaught error.

```javascript
var connection = new sql.Connection({ /* config */ });
```

__Errors__
- EDRIVER (`ConnectionError`) - Unknown driver.

### Events

- **connect** - Dispatched after connection has established.
- **close** - Dispatched after connection has closed a pool (by calling `close`).
- **error(err)** - Dispatched on connection error.

---------------------------------------

<a name="connect" />
### connect([callback])

Create a new connection pool with one active connection. This one initial connection serves as a probe to find out whether the configuration is valid.

__Arguments__

- **callback(err)** - A callback which is called after connection has established, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var connection = new sql.Connection({
    user: '...',
    password: '...',
    server: 'localhost',
    database: '...'
});

connection.connect(function(err) {
    // ...
});
```

__Errors__
- ELOGIN (`ConnectionError`) - Login failed.
- ETIMEOUT (`ConnectionError`) - Connection timeout.
- EALREADYCONNECTED (`ConnectionError`) - Database is already connected!
- EALREADYCONNECTING (`ConnectionError`) - Already connecting to database!
- EINSTLOOKUP (`ConnectionError`) - Instance lookup failed.
- ESOCKET (`ConnectionError`) - Socket error.

---------------------------------------

<a name="close" />
### close()

Close all active connections in the pool.

__Example__

```javascript
connection.close();
```

<a name="request" />
## Requests

```javascript
var request = new sql.Request(/* [connection] */);
```

If you omit connection argument, global connection is used instead.

### Events

- **recordset(columns)** - Dispatched when metadata for new recordset are parsed.
- **row(row)** - Dispatched when new row is parsed.
- **done(returnValue)** - Dispatched when request is complete.
- **error(err)** - Dispatched on error.

---------------------------------------

<a name="execute" />
### execute(procedure, [callback])

Call a stored procedure.

__Arguments__

- **procedure** - Name of the stored procedure to be executed.
- **callback(err, recordsets, returnValue)** - A callback which is called after execution has completed, or an error has occurred. `returnValue` is also accessible as property of recordsets. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var request = new sql.Request();
request.input('input_parameter', sql.Int, value);
request.output('output_parameter', sql.Int);
request.execute('procedure_name', function(err, recordsets, returnValue) {
    // ... error checks
    
    console.log(recordsets.length); // count of recordsets returned by the procedure
    console.log(recordsets[0].length); // count of rows contained in first recordset
    console.log(returnValue); // procedure return value
    console.log(recordsets.returnValue); // same as previous line
	
    console.log(request.parameters.output_parameter.value); // output value
	
    // ...
});
```

__Errors__
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Canceled.
- ETIMEOUT (`RequestError`) - Request timeout.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

---------------------------------------

<a name="input" />
### input(name, [type], value)

Add an input parameter to the request.

__Arguments__

- **name** - Name of the input parameter without @ char.
- **type** - SQL data type of input parameter. If you omit type, module automaticaly decide which SQL data type should be used based on JS data type.
- **value** - Input parameter value. `undefined` ans `NaN` values are automatically converted to `null` values.

__Example__

```javascript
request.input('input_parameter', value);
request.input('input_parameter', sql.Int, value);
```

__JS Data Type To SQL Data Type Map__

- `String` -> `sql.NVarChar`
- `Number` -> `sql.Int`
- `Boolean` -> `sql.Bit`
- `Date` -> `sql.DateTime`
- `Buffer` -> `sql.VarBinary`
- `sql.Table` -> `sql.TVP`

Default data type for unknown object is `sql.NVarChar`.

You can define your own type map.

```javascript
sql.map.register(MyClass, sql.Text);
```

You can also overwrite the default type map.

```javascript
sql.map.register(Number, sql.BigInt);
```

__Errors__ (synchronous)
- EARGS (`RequestError`) - Invalid number of arguments.
- EINJECT (`RequestError`) - SQL injection warning.

---------------------------------------

<a name="output" />
### output(name, type, [value])

Add an output parameter to the request.

__Arguments__

- **name** - Name of the output parameter without @ char.
- **type** - SQL data type of output parameter.
- **value** - Output parameter value initial value. `undefined` and `NaN` values are automatically converted to `null` values. Optional.

__Example__

```javascript
request.output('output_parameter', sql.Int);
request.output('output_parameter', sql.VarChar(50), 'abc');
```

__Errors__ (synchronous)
- EARGS (`RequestError`) - Invalid number of arguments.
- EINJECT (`RequestError`) - SQL injection warning.

---------------------------------------

<a name="pipe" />
### pipe(stream)

Sets request to `stream` mode and pulls all rows from all recordsets to a given stream.

__Arguments__

- **stream** - Writable stream in object mode.

__Example__

```javascript
var request = new sql.Request();
request.pipe(stream);
request.query('select * from mytable');
stream.on('error', function(err) {
    // ...
});
stream.on('finish', function() {
    // ...
});
```

__Version__

2.0

---------------------------------------

<a name="query" />
### query(command, [callback])

Execute the SQL command. To execute commands like `create procedure` or if you plan to work with local temporary tables, use [batch](#batch) instead.

__Arguments__

- **command** - T-SQL command to be executed.
- **callback(err, recordset)** - A callback which is called after execution has completed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var request = new sql.Request();
request.query('select 1 as number', function(err, recordset) {
    // ... error checks
    
    console.log(recordset[0].number); // return 1
	
    // ...
});
```

__Errors__
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Canceled.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

You can enable multiple recordsets in queries with the `request.multiple = true` command.

```javascript
var request = new sql.Request();
request.multiple = true;

request.query('select 1 as number; select 2 as number', function(err, recordsets) {
    // ... error checks
    
    console.log(recordsets[0][0].number); // return 1
    console.log(recordsets[1][0].number); // return 2
});
```

---------------------------------------

<a name="batch" />
### batch(batch, [callback])

Execute the SQL command. Unlike [query](#query), it doesn't use `sp_executesql`, so is not likely that SQL Server will reuse the execution plan it generates for the SQL. Use this only in special cases, for example when you need to execute commands like `create procedure` which can't be executed with [query](#query) or if you're executing statements longer than 4000 chars on SQL Server 2000. Also you should use this if you're plan to work with local temporary tables ([more information here](http://weblogs.sqlteam.com/mladenp/archive/2006/11/03/17197.aspx)).

NOTE: Table-Valued Parameter (TVP) is not supported in batch.

__Arguments__

- **batch** - T-SQL command to be executed.
- **callback(err, recordset)** - A callback which is called after execution has completed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var request = new sql.Request();
request.batch('create procedure #temporary as select * from table', function(err, recordset) {
    // ... error checks
});
```

__Errors__
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Canceled.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

You can enable multiple recordsets in queries with the `request.multiple = true` command.

---------------------------------------

<a name="bulk" />
### bulk(table, [callback])

Perform a bulk insert.

__Arguments__

- **table** - `sql.Table` instance.
- **callback(err, rowCount)** - A callback which is called after bulk insert has completed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var table = new sql.Table('table_name'); // or temporary table, e.g. #temptable
table.create = true;
table.columns.add('a', sql.Int, {nullable: true});
table.columns.add('b', sql.VarChar(50), {nullable: false});
table.rows.add(777, 'test');

var request = new sql.Request();
request.bulk(table, function(err, rowCount) {
    // ... error checks
});
```

**IMPORTANT**: Always indicate whether the column is nullable or not!

**TIP**: If you set `table.create` to `true`, module will check if the table exists before it start sending data. If it doesn't, it will automatically create it.

**TIP**: You can also create Table variable from any recordset with `recordset.toTable()`.

__Errors__
- ENAME (`RequestError`) - Table name must be specified for bulk insert.
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Canceled.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

---------------------------------------

<a name="cancel" />
### cancel()

Cancel currently executing request. Return `true` if cancellation packet was send successfully.

__Example__

```javascript
var request = new sql.Request();
request.query('waitfor delay \'00:00:05\'; select 1 as number', function(err, recordset) {
    console.log(err instanceof sql.RequestError);  // true
    console.log(err.message);                      // Canceled.
    console.log(err.code);                         // ECANCEL
	
    // ...
});

request.cancel();
```

<a name="transaction" />
## Transactions

**IMPORTANT:** always use `Transaction` class to create transactions - it ensures that all your requests are executed on one connection. Once you call `begin`, a single connection is acquired from the connection pool and all subsequent requests (initialized with the `Transaction` object) are executed exclusively on this connection. Transaction also contains a queue to make sure your requests are executed in series. After you call `commit` or `rollback`, connection is then released back to the connection pool.

```javascript
var transaction = new sql.Transaction(/* [connection] */);
```

If you omit connection argument, global connection is used instead.

__Example__

```javascript
var transaction = new sql.Transaction(/* [connection] */);
transaction.begin(function(err) {
    // ... error checks

    var request = new sql.Request(transaction);
    request.query('insert into mytable (mycolumn) values (12345)', function(err, recordset) {
        // ... error checks

        transaction.commit(function(err, recordset) {
            // ... error checks
            
            console.log("Transaction commited.");
        });
    });
});
```

Transaction can also be created by `var transaction = connection.transaction();`. Requests can also be created by `var request = transaction.request();`.

__Aborted transactions__

This example shows how you should correctly handle transaction errors when `abortTransactionOnError` (`XACT_ABORT`) is enabled. Added in 2.0.

```javascript
var transaction = new sql.Transaction(/* [connection] */);
transaction.begin(function(err) {
    // ... error checks
    
    var rolledBack = false;
    
    transaction.on('rollback', function(aborted) {
	    // emited with aborted === true
	    
	    rolledBack = true;
    });

    var request = new sql.Request(transaction);
    request.query('insert into mytable (bitcolumn) values (2)', function(err, recordset) {
        // insert should fail because of invalid value

		if (err) {
			if (!rolledBack) {
		        transaction.rollback(function(err) {
		            // ... error checks
		        });
		    }
		} else {
			transaction.commit(function(err) {
	            // ... error checks
	        });
		}
    });
});
```

### Events

- **begin** - Dispatched when transaction begin.
- **commit** - Dispatched on successful commit.
- **rollback(aborted)** - Dispatched on successful rollback with an argument determining if the transaction was aborted (by user or because of an error).

---------------------------------------

<a name="begin" />
### begin([isolationLevel], [callback])

Begin a transaction.

__Arguments__

- **isolationLevel** - Controls the locking and row versioning behavior of TSQL statements issued by a connection. Optional. `READ_COMMITTED` by default. For possible values see `sql.ISOLATION_LEVEL`.
- **callback(err)** - A callback which is called after transaction has began, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var transaction = new sql.Transaction();
transaction.begin(function(err) {
    // ... error checks
});
```

__Errors__
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- EALREADYBEGUN (`TransactionError`) - Transaction has already begun.

---------------------------------------

<a name="commit" />
### commit([callback])

Commit a transaction.

__Arguments__

- **callback(err)** - A callback which is called after transaction has committed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var transaction = new sql.Transaction();
transaction.begin(function(err) {
    // ... error checks
    
    transaction.commit(function(err) {
        // ... error checks
    })
});
```

__Errors__
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EREQINPROG (`TransactionError`) - Can't commit transaction. There is a request in progress.

---------------------------------------

<a name="rollback" />
### rollback([callback])

Rollback a transaction. If the queue isn't empty, all queued requests will be canceled and the transaction will be marked as aborted.

__Arguments__

- **callback(err)** - A callback which is called after transaction has rolled back, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var transaction = new sql.Transaction();
transaction.begin(function(err) {
    // ... error checks
    
    transaction.rollback(function(err) {
        // ... error checks
    })
});
```

__Errors__
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EREQINPROG (`TransactionError`) - Can't rollback transaction. There is a request in progress.

<a name="prepared-statement" />
## PreparedStatement

**IMPORTANT:** always use `PreparedStatement` class to create prepared statements - it ensures that all your executions of prepared statement are executed on one connection. Once you call `prepare`, a single connection is aquired from the connection pool and all subsequent executions are executed exclusively on this connection. Prepared Statement also contains a queue to make sure your executions are executed in series. After you call `unprepare`, the connection is then released back to the connection pool.

```javascript
var ps = new sql.PreparedStatement(/* [connection] */);
```

If you omit the connection argument, the global connection is used instead.

__Example__

```javascript
var ps = new sql.PreparedStatement(/* [connection] */);
ps.input('param', sql.Int);
ps.prepare('select @param as value', function(err) {
    // ... error checks

    ps.execute({param: 12345}, function(err, recordset) {
        // ... error checks

        ps.unprepare(function(err) {
            // ... error checks
            
        });
    });
});
```

**IMPORTANT**: Remember that each prepared statement means one reserved connection from the pool. Don't forget to unprepare a prepared statement!

**TIP**: You can also create prepared statements in transactions (`new sql.PreparedStatement(transaction)`), but keep in mind you can't execute other requests in the transaction until you call `unprepare`.

---------------------------------------

<a name="prepared-statement-input" />
### input(name, type)

Add an input parameter to the prepared statement.

__Arguments__

- **name** - Name of the input parameter without @ char.
- **type** - SQL data type of input parameter.

__Example__

```javascript
ps.input('input_parameter', sql.Int);
ps.input('input_parameter', sql.VarChar(50));
```

__Errors__ (synchronous)
- EARGS (`PreparedStatementError`) - Invalid number of arguments.
- EINJECT (`PreparedStatementError`) - SQL injection warning.

---------------------------------------

<a name="prepared-statement-output" />
### output(name, type)

Add an output parameter to the prepared statement.

__Arguments__

- **name** - Name of the output parameter without @ char.
- **type** - SQL data type of output parameter.

__Example__

```javascript
ps.output('output_parameter', sql.Int);
ps.output('output_parameter', sql.VarChar(50));
```

__Errors__ (synchronous)
- EARGS (`PreparedStatementError`) - Invalid number of arguments.
- EINJECT (`PreparedStatementError`) - SQL injection warning.

---------------------------------------

<a name="prepare" />
### prepare(statement, [callback])

Prepare a statement.

__Arguments__

- **statement** - T-SQL statement to prepare.
- **callback(err)** - A callback which is called after preparation has completed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var ps = new sql.PreparedStatement();
ps.prepare('select @param as value', function(err) {
    // ... error checks
});
```

__Errors__
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- EALREADYPREPARED (`PreparedStatementError`) - Statement is already prepared.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.

---------------------------------------

<a name="prepared-statement-execute" />
### execute(values, [callback])

Execute a prepared statement.

__Arguments__

- **values** - An object whose names correspond to the names of parameters that were added to the prepared statement before it was prepared.
- **callback(err)** - A callback which is called after execution has completed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var ps = new sql.PreparedStatement();
ps.input('param', sql.Int);
ps.prepare('select @param as value', function(err) {
    // ... error checks
    
    ps.execute({param: 12345}, function(err, recordset) {
        // ... error checks
        
        console.log(recordset[0].value); // return 12345
    });
});
```

You can enable multiple recordsets by `ps.multiple = true` command.

```javascript
var ps = new sql.PreparedStatement();
ps.input('param', sql.Int);
ps.prepare('select @param as value', function(err) {
    // ... error checks
    
    ps.multiple = true;
    ps.execute({param: 12345}, function(err, recordsets) {
        // ... error checks
        
        console.log(recordsets[0][0].value); // return 12345
    });
});
```

You can also stream executed request.

```javascript
var ps = new sql.PreparedStatement();
ps.input('param', sql.Int);
ps.prepare('select @param as value', function(err) {
    // ... error checks
    
    ps.stream = true;
    request = ps.execute({param: 12345});
    
    request.on('recordset', function(columns) {
    	// Emitted once for each recordset in a query
    });
    
    request.on('row', function(row) {
    	// Emitted for each row in a recordset
    });
    
    request.on('error', function(err) {
    	// May be emitted multiple times
    });
    
    request.on('done', function(returnValue) {
    	// Always emitted as the last one
    });
});
```

__Errors__
- ENOTPREPARED (`PreparedStatementError`) - Statement is not prepared.
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Canceled.

---------------------------------------

<a name="unprepare" />
### unprepare([callback])

Unprepare a prepared statement.

__Arguments__

- **callback(err)** - A callback which is called after unpreparation has completed, or an error has occurred. Optional. If omited, returns [Promise](#promises).

__Example__

```javascript
var ps = new sql.PreparedStatement();
ps.input('param', sql.Int);
ps.prepare('select @param as value', function(err, recordsets) {
    // ... error checks

    ps.unprepare(function(err) {
        // ... error checks
        
    });
});
```

__Errors__
- ENOTPREPARED (`PreparedStatementError`) - Statement is not prepared.

<a name="cli" />
## CLI

Before you can start using CLI, you must install `mssql` globally with `npm install mssql -g`. Once you do that you will be able to execute `mssql` command.

__Setup__

Create a `.mssql.json` configuration file (anywhere). Structure of the file is the same as the standard configuration object.

```json
{
    "user": "...",
    "password": "...",
    "server": "localhost",
    "database": "..."
}
```

__Example__

```shell
echo "select * from mytable" | mssql /path/to/config
```
Results in:
```json
[[{"username":"patriksimek","password":"tooeasy"}]]
```

You can also query for multiple recordsets.

```shell
echo "select * from mytable; select * from myothertable" | mssql
```
Results in:
```json
[[{"username":"patriksimek","password":"tooeasy"}],[{"id":15,"name":"Product name"}]]
```

If you omit config path argument, mssql will try to load it from current working directory.

__Version__

2.0

<a name="geography" />
## Geography and Geometry

node-mssql has built-in serializer for Geography and Geometry CLR data types.

```sql
select geography::STGeomFromText('LINESTRING(-122.360 47.656, -122.343 47.656 )', 4326)
select geometry::STGeomFromText('LINESTRING (100 100 10.3 12, 20 180, 180 180)', 0)
```

Results in:

```javascript
{ srid: 4326,
  version: 1,
  points: [ { x: 47.656, y: -122.36 }, { x: 47.656, y: -122.343 } ],
  figures: [ { attribute: 1, pointOffset: 0 } ],
  shapes: [ { parentOffset: -1, figureOffset: 0, type: 2 } ],
  segments: [] }
  
{ srid: 0,
  version: 1,
  points: 
   [ { x: 100, y: 100, z: 10.3, m: 12 },
     { x: 20, y: 180, z: NaN, m: NaN },
     { x: 180, y: 180, z: NaN, m: NaN } ],
  figures: [ { attribute: 1, pointOffset: 0 } ],
  shapes: [ { parentOffset: -1, figureOffset: 0, type: 2 } ],
  segments: [] }
```

<a name="tvp" />
## Table-Valued Parameter (TVP)

Supported on SQL Server 2008 and later. You can pass a data table as a parameter to stored procedure. First, we have to create custom type in our database.

```sql
CREATE TYPE TestType AS TABLE ( a VARCHAR(50), b INT );
```

Next we will need a stored procedure.

```sql
CREATE PROCEDURE MyCustomStoredProcedure (@tvp TestType readonly) AS SELECT * FROM @tvp
```

Now let's go back to our Node.js app.

```javascript
var tvp = new sql.Table()

// Columns must correspond with type we have created in database.
tvp.columns.add('a', sql.VarChar(50));
tvp.columns.add('b', sql.Int);

// Add rows
tvp.rows.add('hello tvp', 777); // Values are in same order as columns.
```

You can send table as a parameter to stored procedure.

```javascript
var request = new sql.Request();
request.input('tvp', tvp);
request.execute('MyCustomStoredProcedure', function(err, recordsets, returnValue) {
    // ... error checks
    
    console.dir(recordsets[0][0]); // {a: 'hello tvp', b: 777}
});
```

**TIP**: You can also create Table variable from any recordset with `recordset.toTable()`.

<a name="json" />
## JSON support (experimental)

SQL Server 2016 introduced built-in JSON serialization. By default, JSON is returned as a plain text in a special column named `JSON_F52E2B61-18A1-11d1-B105-00805F49916B`.

Example
```sql
SELECT
    1 AS 'a.b.c',
    2 AS 'a.b.d',
    3 AS 'a.x',
    4 AS 'a.y'
FOR JSON PATH
```

Results in:
```javascript
recordset = [ { 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B': '{"a":{"b":{"c":1,"d":2},"x":3,"y":4}}' } ]
```

You can enable built-in JSON parser with `config.parseJSON = true`. Once you enable this, recordset will contain rows of parsed JS objects. Given the same example, result will look like this:
```javascript
recordset = [ { a: { b: { c: 1, d: 2 }, x: 3, y: 4 } } ]
```

**IMPORTANT**: In order for this to work, there must be exactly one column named `JSON_F52E2B61-18A1-11d1-B105-00805F49916B` in the recordset.

More information about JSON support can be found in [official documentation](https://msdn.microsoft.com/en-us/library/dn921882.aspx).

__Version__

2.3

<a name="promises" />
## Promises

You can retrieve a Promise when you omit a callback argument.

```javascript
var connection = new sql.Connection(config);
connection.connect().then(function() {
	var request = new sql.Request(connection);
	request.query('select * from mytable').then(function(recordset) {
		// ...
	}).catch(function(err) {
		// ...
	});
}).catch(function(err) {
	// ...
});
```

Native Promise is returned by default. You can easily change this with `sql.Promise = require('myownpromisepackage')`.

__Version__

2.0

<a name="errors" />
## Errors

There are 4 types of errors you can handle:

- **ConnectionError** - Errors related to connections and connection pool.
- **TransactionError** - Errors related to creating, commiting and rolling back transactions.
- **RequestError** - Errors related to queries and stored procedures execution.
- **PreparedStatementError** - Errors related to prepared statements.

Those errors are initialized in node-mssql module and its original stack may be cropped. You can always access original error with `err.originalError`.

SQL Server may generate more than one error for one request so you can access preceding errors with `err.precedingErrors`.

### Error Codes

Each known error has `code` property.

Type | Code | Description
:--- | :--- | :---
`ConnectionError` | ELOGIN | Login failed.
`ConnectionError` | ETIMEOUT | Connection timeout.
`ConnectionError` | EDRIVER | Unknown driver.
`ConnectionError` | EALREADYCONNECTED | Database is already connected!
`ConnectionError` | EALREADYCONNECTING | Already connecting to database!
`ConnectionError` | ENOTOPEN | Connection not yet open.
`ConnectionError` | EINSTLOOKUP | Instance lookup failed.
`ConnectionError` | ESOCKET | Scoket error.
`ConnectionError` | ECONNCLOSED | Connection is closed.
`TransactionError` | ENOTBEGUN | Transaction has not begun.
`TransactionError` | EALREADYBEGUN | Transaction has already begun.
`TransactionError` | EREQINPROG | Can't commit/rollback transaction. There is a request in progress.
`TransactionError` | EABORT | Transaction has been aborted.
`RequestError` | EREQUEST | Message from SQL Server. Error object contains additional details.
`RequestError` | ECANCEL | Canceled.
`RequestError` | ETIMEOUT | Request timeout.
`RequestError` | EARGS | Invalid number of arguments.
`RequestError` | EINJECT | SQL injection warning.
`RequestError` | ENOCONN | No connection is specified for that request.
`PreparedStatementError` | EARGS | Invalid number of arguments.
`PreparedStatementError` | EINJECT | SQL injection warning.
`PreparedStatementError` | EALREADYPREPARED | Statement is already prepared.
`PreparedStatementError` | ENOTPREPARED | Statement is not prepared.

### Detailed SQL Errors

SQL errors (`RequestError` with `err.code` equal to `EREQUEST`) contains additional details.

- **err.number** - The error number.
- **err.state** - The error state, used as a modifier to the error number.
- **err.class** - The class (severity) of the error. A class of less than 10 indicates an informational message. Detailed explanation can be found [here](https://msdn.microsoft.com/en-us/library/dd304156.aspx).
- **err.lineNumber** - The line number in the SQL batch or stored procedure that caused the error. Line numbers begin at 1; therefore, if the line number is not applicable to the message, the value of LineNumber will be 0.
- **err.serverName** - The server name.
- **err.procName** - The stored procedure name.

<a name="meta" />
## Metadata

Recordset metadata are accessible through the `recordset.columns` property.

```javascript
var request = new sql.Request();
request.query('select convert(decimal(18, 4), 1) as first, \'asdf\' as second', function(err, recordset) {
    console.dir(recordset.columns);
	
    console.log(recordset.columns.first.type === sql.Decimal); // true
    console.log(recordset.columns.second.type === sql.VarChar); // true
});
```

Columns structure for example above:

```javascript
{
	first: {
		index: 0,
		name: 'first',
		length: 17,
		type: [sql.Decimal],
		scale: 4,
		precision: 18,
		nullable: true,
		caseSensitive: false
		identity: false
		readOnly: true
	},
	second: {
		index: 1,
		name: 'second',
		length: 4,
		type: [sql.VarChar],
		nullable: false,
		caseSensitive: false
		identity: false
		readOnly: true
	}
}
```

<a name="data-types" />
## Data Types

You can define data types with length/precision/scale:

```javascript
request.input("name", sql.VarChar, "abc");               // varchar(3)
request.input("name", sql.VarChar(50), "abc");           // varchar(50)
request.input("name", sql.VarChar(sql.MAX), "abc");      // varchar(MAX)
request.output("name", sql.VarChar);                     // varchar(8000)
request.output("name", sql.VarChar, "abc");              // varchar(3)

request.input("name", sql.Decimal, 155.33);              // decimal(18, 0)
request.input("name", sql.Decimal(10), 155.33);          // decimal(10, 0)
request.input("name", sql.Decimal(10, 2), 155.33);       // decimal(10, 2)

request.input("name", sql.DateTime2, new Date());        // datetime2(7)
request.input("name", sql.DateTime2(5), new Date());     // datetime2(5)
```

List of supported data types:

```
sql.Bit
sql.BigInt
sql.Decimal ([precision], [scale])
sql.Float
sql.Int
sql.Money
sql.Numeric ([precision], [scale])
sql.SmallInt
sql.SmallMoney
sql.Real
sql.TinyInt

sql.Char ([length])
sql.NChar ([length])
sql.Text
sql.NText
sql.VarChar ([length])
sql.NVarChar ([length])
sql.Xml

sql.Time ([scale])
sql.Date
sql.DateTime
sql.DateTime2 ([scale])
sql.DateTimeOffset ([scale])
sql.SmallDateTime

sql.UniqueIdentifier

sql.Binary
sql.VarBinary ([length])
sql.Image

sql.UDT
sql.Geography
sql.Geometry
```

To setup MAX length for `VarChar`, `NVarChar` and `VarBinary` use `sql.MAX` length. Type `sql.XML` is not supported as input parameter.

<a name="injection" />
## SQL injection

This module has built-in SQL injection protection. Always use parameters to pass sanitized values to your queries.

```javascript
var request = new sql.Request();
request.input('myval', sql.VarChar, '-- commented');
request.query('select @myval as myval', function(err, recordset) {
    console.dir(recordset);
});
```

<a name="verbose" />
## Verbose Mode

You can enable verbose mode by `request.verbose = true` command.

```javascript
var request = new sql.Request();
request.verbose = true;
request.input('username', 'patriksimek');
request.input('password', 'dontuseplaintextpassword');
request.input('attempts', 2);
request.execute('my_stored_procedure');
```

Output for the example above could look similar to this.

```
---------- sql execute --------
     proc: my_stored_procedure
    input: @username, varchar, patriksimek
    input: @password, varchar, dontuseplaintextpassword
    input: @attempts, bigint, 2
---------- response -----------
{ id: 1,
  username: 'patriksimek',
  password: 'dontuseplaintextpassword',
  email: null,
  language: 'en',
  attempts: 2 }
---------- --------------------
   return: 0
 duration: 5ms
---------- completed ----------
```

<a name="issues" />
## Known issues

### Tedious

- If you're facing problems with connecting SQL Server 2000, try setting the default TDS version to 7.1 with `config.options.tdsVersion = '7_1'` ([issue](https://github.com/patriksimek/node-mssql/issues/36))
- If you're executing a statement longer than 4000 chars on SQL Server 2000, alway use [batch](#batch) instead of [query](#query) ([issue](https://github.com/patriksimek/node-mssql/issues/68))

### msnodesql

- There is a serious problem with errors during transactions - [reported here](https://github.com/patriksimek/node-mssql/issues/77).
- msnodesql 0.2.1 contains bug in DateTimeOffset ([reported](https://github.com/WindowsAzure/node-sqlserver/issues/160))
- msnodesql 0.2.1 doesn't support TVP data type.
- msnodesql 0.2.1 doesn't support request timeout.
- msnodesql 0.2.1 doesn't support request cancellation.

### node-tds

- If you're facing problems with date, try changing your tsql language `set language 'English';`.
- node-tds 0.1.0 doesn't support connecting to named instances.
- node-tds 0.1.0 contains bug and return same value for columns with same name.
- node-tds 0.1.0 doesn't support codepage of input parameters.
- node-tds 0.1.0 contains bug in selects that doesn't return any values *(select @param = 'value')*.
- node-tds 0.1.0 doesn't support Binary, VarBinary and Image as parameters.
- node-tds 0.1.0 always return date/time values in local time.
- node-tds 0.1.0 has serious problems with MAX types.
- node-tds 0.1.0 doesn't support TVP data type.
- node-tds 0.1.0 doesn't support request timeout.
- node-tds 0.1.0 doesn't support built-in JSON serialization introduced in SQL Server 2016.

<a name="license" />
## License

Copyright (c) 2013-2015 Patrik Simek

The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

[npm-image]: https://img.shields.io/npm/v/mssql.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/mssql
[downloads-image]: https://img.shields.io/npm/dm/mssql.svg?style=flat-square
[downloads-url]: https://www.npmjs.com/package/mssql
[david-image]: https://img.shields.io/david/patriksimek/node-mssql.svg?style=flat-square
[david-url]: https://david-dm.org/patriksimek/node-mssql
[travis-image]: https://img.shields.io/travis/patriksimek/node-mssql/master.svg?style=flat-square&label=unit
[travis-url]: https://travis-ci.org/patriksimek/node-mssql
[appveyor-image]: https://img.shields.io/appveyor/ci/patriksimek/node-mssql/master.svg?style=flat-square&label=integration
[appveyor-url]: https://ci.appveyor.com/project/patriksimek/node-mssql

[tedious-url]: https://www.npmjs.com/package/tedious
[tedious-image]: https://img.shields.io/github/stars/pekim/tedious.svg?style=flat-square&label=%E2%98%85
[msnodesql-url]: https://www.npmjs.com/package/msnodesql
[msnodesql-image]: https://img.shields.io/github/stars/Azure/node-sqlserver.svg?style=flat-square&label=%E2%98%85
[tds-url]: https://www.npmjs.com/package/tds
[tds-image]: https://img.shields.io/github/stars/cretz/node-tds.svg?style=flat-square&label=%E2%98%85
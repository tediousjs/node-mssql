# node-mssql

Microsoft SQL Server client for Node.js

[![NPM Version][npm-image]][npm-url] [![NPM Downloads][downloads-image]][downloads-url] [![Travis CI][travis-image]][travis-url] [![Appveyor CI][appveyor-image]][appveyor-url] [![Join the chat at https://gitter.im/patriksimek/node-mssql](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/patriksimek/node-mssql?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

Supported TDS drivers:
- [Tedious][tedious-url] (pure JavaScript - Windows/macOS/Linux, default)
- [Microsoft / Contributors Node V8 Driver for Node.js for SQL Server][msnodesqlv8-url] (native - Windows only)

## Installation

    npm install mssql

## Quick Example

```javascript
const sql = require('mssql')

async () => {
    try {
        await sql.connect('mssql://username:password@localhost/database')
        const result = await sql.query`select * from mytable where id = ${value}`
        console.dir(result)
    } catch (err) {
        // ... error checks
    }
}
```

If you're on Windows Azure, add `?encrypt=true` to your connection string. See [docs](#configuration) to learn more.

## Documentation

### Examples

* [Async/Await](#asyncawait)
* [Promises](#promises)
* [ES6 Tagged template literals](#es6-tagged-template-literals)
* [Callbacks](#callbacks)
* [Streaming](#streaming)
* [Connection Pools](#connection-pools)

### Configuration

* [General](#general-same-for-all-drivers)
* [Formats](#formats)

### Drivers

* [Tedious](#tedious)
* [Microsoft / Contributors Node V8 Driver for Node.js for SQL Server](#microsoft--contributors-node-v8-driver-for-nodejs-for-sql-server)

### Connections

* [ConnectionPool](#connections-1)
* [connect](#connect-callback)
* [close](#close)

### Requests

* [Request](#request)
* [execute](#execute-procedure-callback)
* [input](#input-name-type-value)
* [output](#output-name-type-value)
* [pipe](#pipe-stream)
* [query](#query-command-callback)
* [batch](#batch-batch-callback)
* [bulk](#bulk-table-callback)
* [cancel](#cancel)

### Transactions

* [Transaction](#transaction)
* [begin](#begin-isolationlevel-callback)
* [commit](#commit-callback)
* [rollback](#rollback-callback)

### Prepared Statements

* [PreparedStatement](#prepared-statement)
* [input](#input-name-type)
* [output](#output-name-type)
* [prepare](#prepare-statement-callback)
* [execute](#execute-values-callback)
* [unprepare](#unprepare-callback)

### Other

* [CLI](#cli)
* [Geography and Geometry](#geography-and-geometry)
* [Table-Valued Parameter](#table-valued-parameter-tvp)
* [Affected Rows](#affected-rows)
* [JSON support](#json-support)
* [Errors](#errors)
* [Informational messages](#informational-messages)
* [Metadata](#metadata)
* [Data Types](#data-types)
* [SQL injection](#sql-injection)
* [Known Issues](#known-issues)
* [Contributing](https://github.com/tediousjs/node-mssql/wiki/Contributing)
* [3.x to 4.x changes](#3x-to-4x-changes)
* [3.x Documentation](https://github.com/tediousjs/node-mssql/blob/1893969195045a250f0fdeeb2de7f30dcf6689ad/README.md)

## Examples

### Config

```javascript
const config = {
    user: '...',
    password: '...',
    server: 'localhost', // You can use 'localhost\\instance' to connect to named instance
    database: '...',

    options: {
        encrypt: true // Use this if you're on Windows Azure
    }
}
```


### Async/Await

```javascript
const sql = require('mssql')

(async function () {
    try {
        let pool = await sql.connect(config)
        let result1 = await pool.request()
            .input('input_parameter', sql.Int, value)
            .query('select * from mytable where id = @input_parameter')
            
        console.dir(result1)
    
        // Stored procedure
        
        let result2 = await pool.request()
            .input('input_parameter', sql.Int, value)
            .output('output_parameter', sql.VarChar(50))
            .execute('procedure_name')
        
        console.dir(result2)
    } catch (err) {
        // ... error checks
    }
})()

sql.on('error', err => {
    // ... error handler
})
```

### Promises

```javascript
const sql = require('mssql')

sql.connect(config).then(pool => {
    // Query
    
    return pool.request()
    .input('input_parameter', sql.Int, value)
    .query('select * from mytable where id = @input_parameter')
}).then(result => {
    console.dir(result)
    
    // Stored procedure
    
    return pool.request()
    .input('input_parameter', sql.Int, value)
    .output('output_parameter', sql.VarChar(50))
    .execute('procedure_name')
}).then(result => {
    console.dir(result)
}).catch(err => {
    // ... error checks
})

sql.on('error', err => {
    // ... error handler
})
```

Native Promise is used by default. You can easily change this with `sql.Promise = require('myownpromisepackage')`.

### ES6 Tagged template literals

```javascript
const sql = require('mssql')

sql.connect(config).then(() => {
    return sql.query`select * from mytable where id = ${value}`
}).then(result => {
    console.dir(result)
}).catch(err => {
    // ... error checks
})

sql.on('error', err => {
    // ... error handler
})
```

All values are automatically sanitized against sql injection.

### Callbacks

```javascript
const sql = require('mssql')

sql.connect(config, err => {
    // ... error checks

    // Query

    new sql.Request().query('select 1 as number', (err, result) => {
        // ... error checks

        console.dir(result)
    })

    // Stored Procedure

    new sql.Request()
    .input('input_parameter', sql.Int, value)
    .output('output_parameter', sql.VarChar(50))
    .execute('procedure_name', (err, result) => {
        // ... error checks

        console.dir(result)
    })
})

sql.on('error', err => {
    // ... error handler
})
```

### Streaming

If you plan to work with large amount of rows, you should always use streaming. Once you enable this, you must listen for events to receive data.

```javascript
const sql = require('mssql')

sql.connect(config, err => {
    // ... error checks

    const request = new sql.Request()
    request.stream = true // You can set streaming differently for each request
    request.query('select * from verylargetable') // or request.execute(procedure)

    request.on('recordset', columns => {
        // Emitted once for each recordset in a query
    })

    request.on('row', row => {
        // Emitted for each row in a recordset
    })

    request.on('error', err => {
        // May be emitted multiple times
    })

    request.on('done', result => {
        // Always emitted as the last one
    })
})

sql.on('error', err => {
    // ... error handler
})
```

When streaming large sets of data you want to back-off or chunk the amount of data you're processing
 to prevent memory exhaustion issues; you can use the `Request.pause()` function to do this. Here is
 an example of managing rows in batches of 15:

```javascript
let rowsToProcess = [];
request.on('row', row => {
  rowsToProcess.push(row);
  if (rowsToProcess.length >= 15) {
    request.pause();
    processRows();
  }
});
request.on('done', () => {
    processRows();
});

function processRows() {
  // process rows
  rowsToProcess = [];
  request.resume();
}
```

## Connection Pools

Using a single connection pool for your application/service is recommended.
Instantiating a pool with a callback, or immediately calling `.connect`, is asynchronous to ensure a connection can be
established before returning. From that point, you're able to acquire connections as normal:  

```javascript
const sql = require('mssql')

// async/await style:
const pool1 = new sql.ConnectionPool(config).connect();

pool1.on('error', err => {
    // ... error handler
})

async function messageHandler() {
    await pool1; // ensures that the pool has been created
    try {
    	const request = pool1.request(); // or: new sql.Request(pool1)
    	const result = request.query('select 1 as number')
    	console.dir(result)
    	return result;
	} catch (err) {
        console.error('SQL error', err);
	}
}

// promise style:
const pool2 = new sql.ConnectionPool(config, err => {
    // ... error checks
}).connect();

pool2.on('error', err => {
    // ... error handler
})

function runStoredProcedure() {
    return pool2.then((pool) => {
		pool.request() // or: new sql.Request(pool2)
		.input('input_parameter', sql.Int, 10)
		.output('output_parameter', sql.VarChar(50))
		.execute('procedure_name', (err, result) => {
			// ... error checks
			console.dir(result)
		})
    });
}
```

Awaiting or `.then`ing the pool creation is a safe way to ensure that the pool is always ready, without knowing where it
is needed first. In practice, once the pool is created then there will be no delay for the next operation.

**ES6 Tagged template literals**

```javascript
new sql.ConnectionPool(config).connect().then(pool => {
    return pool.query`select * from mytable where id = ${value}`
}).then(result => {
    console.dir(result)
}).catch(err => {
    // ... error checks
})
```

All values are automatically sanitized against sql injection.

## Configuration

```javascript
const config = {
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

### General (same for all drivers)

- **user** - User name to use for authentication.
- **password** - Password to use for authentication.
- **server** - Server to connect to. You can use 'localhost\\instance' to connect to named instance.
- **port** - Port to connect to (default: `1433`). Don't set when connecting to named instance.
- **domain** - Once you set domain, driver will connect to SQL Server using domain login.
- **database** - Database to connect to (default: dependent on server configuration).
- **connectionTimeout** - Connection timeout in ms (default: `15000`).
- **requestTimeout** - Request timeout in ms (default: `15000`). NOTE: msnodesqlv8 driver doesn't support timeouts < 1 second. When passed via connection string, the key must be `request timeout`
- **stream** - Stream recordsets/rows instead of returning them all at once as an argument of callback (default: `false`). You can also enable streaming for each request independently (`request.stream = true`). Always set to `true` if you plan to work with large amount of rows.
- **parseJSON** - Parse JSON recordsets to JS objects (default: `false`). For more information please see section [JSON support](#json-support).
- **pool.max** - The maximum number of connections there can be in the pool (default: `10`).
- **pool.min** - The minimum of connections there can be in the pool (default: `0`).
- **pool.idleTimeoutMillis** - The Number of milliseconds before closing an unused connection (default: `30000`).

Complete list of pool options can be found [here](https://github.com/coopernurse/node-pool).

### Formats

In addition to configuration object there is an option to pass config as a connection string. Two formats of connection string are supported.

##### Classic Connection String

```
Server=localhost,1433;Database=database;User Id=username;Password=password;Encrypt=true
Driver=msnodesqlv8;Server=(local)\INSTANCE;Database=database;UID=DOMAIN\username;PWD=password;Encrypt=true
```

##### Connection String URI

```
mssql://username:password@localhost:1433/database?encrypt=true
mssql://username:password@localhost/INSTANCE/database?encrypt=true&domain=DOMAIN&driver=msnodesqlv8
```

## Drivers

### Tedious

Default driver, actively maintained and production ready. Platform independent, runs everywhere Node.js runs. Officially supported by Microsoft.

**Extra options:**

- **beforeConnect(conn)** - Function, which is invoked before opening the connection. The parameter `conn` is the configured tedious `Connection`. It can be used for attaching event handlers like in this example:
```js
require('mssql').connect(...config, beforeConnect: conn => {
  conn.once('connect', err => { err ? console.error(err) : console.log('mssql connected')})
  conn.once('end', err => { err ? console.error(err) : console.log('mssql disconnected')})
}})
```
- **options.instanceName** - The instance name to connect to. The SQL Server Browser service must be running on the database server, and UDP port 1434 on the database server must be reachable.
- **options.useUTC** - A boolean determining whether or not use UTC time for values without time zone offset (default: `true`).
- **options.encrypt** - A boolean determining whether or not the connection will be encrypted (default: `false`).
- **options.tdsVersion** - The version of TDS to use (default: `7_4`, available: `7_1`, `7_2`, `7_3_A`, `7_3_B`, `7_4`).
- **options.appName** - Application name used for SQL server logging.
- **options.abortTransactionOnError** - A boolean determining whether to rollback a transaction automatically if any error is encountered during the given transaction's execution. This sets the value for `XACT_ABORT` during the initial SQL phase of a connection.

More information about Tedious specific options: http://tediousjs.github.io/tedious/api-connection.html

### Microsoft / Contributors Node V8 Driver for Node.js for SQL Server

**Requires Node.js 0.12.x or newer. Windows only.** This driver is not part of the default package and must be installed separately by `npm install msnodesqlv8`. To use this driver, use this require syntax: `const sql = require('mssql/msnodesqlv8')`.

**Extra options:**

- **beforeConnect(conn)** - Function, which is invoked before opening the connection. The parameter `conn` is the connection configuration, that can be modified to pass extra parameters to the driver's `open()` method.
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

## Connections

Internally, each `ConnectionPool` instance is a separate pool of TDS connections. Once you create a new `Request`/`Transaction`/`Prepared Statement`, a new TDS connection is acquired from the pool and reserved for desired action. Once the action is complete, connection is released back to the pool. Connection health check is built-in so once the dead connection is discovered, it is immediately replaced with a new one.

**IMPORTANT**: Always attach an `error` listener to created connection. Whenever something goes wrong with the connection it will emit an error and if there is no listener it will crash your application with an uncaught error.

```javascript
const pool = new sql.ConnectionPool({ /* config */ })
```

### Events

- **error(err)** - Dispatched on connection error.

---------------------------------------

### connect ([callback])

Create a new connection pool. The initial probe connection is created to find out whether the configuration is valid.

__Arguments__

- **callback(err)** - A callback which is called after initial probe connection has established, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const pool = new sql.ConnectionPool({
    user: '...',
    password: '...',
    server: 'localhost',
    database: '...'
})

pool.connect(err => {
    // ...
})
```

__Errors__
- ELOGIN (`ConnectionError`) - Login failed.
- ETIMEOUT (`ConnectionError`) - Connection timeout.
- EALREADYCONNECTED (`ConnectionError`) - Database is already connected!
- EALREADYCONNECTING (`ConnectionError`) - Already connecting to database!
- EINSTLOOKUP (`ConnectionError`) - Instance lookup failed.
- ESOCKET (`ConnectionError`) - Socket error.

---------------------------------------

### close()

Close all active connections in the pool.

__Example__

```javascript
pool.close()
```

## Request

```javascript
const request = new sql.Request(/* [pool or transaction] */)
```

If you omit pool/transaction argument, global pool is used instead.

### Events

- **recordset(columns)** - Dispatched when metadata for new recordset are parsed.
- **row(row)** - Dispatched when new row is parsed.
- **done(returnValue)** - Dispatched when request is complete.
- **error(err)** - Dispatched on error.
- **info(message)** - Dispatched on informational message.

---------------------------------------

### execute (procedure, [callback])

Call a stored procedure.

__Arguments__

- **procedure** - Name of the stored procedure to be executed.
- **callback(err, recordsets, returnValue)** - A callback which is called after execution has completed, or an error has occurred. `returnValue` is also accessible as property of recordsets. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const request = new sql.Request()
request.input('input_parameter', sql.Int, value)
request.output('output_parameter', sql.Int)
request.execute('procedure_name', (err, result) => {
    // ... error checks

    console.log(result.recordsets.length) // count of recordsets returned by the procedure
    console.log(result.recordsets[0].length) // count of rows contained in first recordset
    console.log(result.recordset) // first recordset from result.recordsets
    console.log(result.returnValue) // procedure return value
    console.log(result.output) // key/value collection of output values
    console.log(result.rowsAffected) // array of numbers, each number represents the number of rows affected by executed statemens

    // ...
})
```

__Errors__
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Cancelled.
- ETIMEOUT (`RequestError`) - Request timeout.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

---------------------------------------

### input (name, [type], value)

Add an input parameter to the request.

__Arguments__

- **name** - Name of the input parameter without @ char.
- **type** - SQL data type of input parameter. If you omit type, module automatically decide which SQL data type should be used based on JS data type.
- **value** - Input parameter value. `undefined` ans `NaN` values are automatically converted to `null` values.

__Example__

```javascript
request.input('input_parameter', value)
request.input('input_parameter', sql.Int, value)
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
sql.map.register(MyClass, sql.Text)
```

You can also overwrite the default type map.

```javascript
sql.map.register(Number, sql.BigInt)
```

__Errors__ (synchronous)
- EARGS (`RequestError`) - Invalid number of arguments.
- EINJECT (`RequestError`) - SQL injection warning.

---------------------------------------

### output (name, type, [value])

Add an output parameter to the request.

__Arguments__

- **name** - Name of the output parameter without @ char.
- **type** - SQL data type of output parameter.
- **value** - Output parameter value initial value. `undefined` and `NaN` values are automatically converted to `null` values. Optional.

__Example__

```javascript
request.output('output_parameter', sql.Int)
request.output('output_parameter', sql.VarChar(50), 'abc')
```

__Errors__ (synchronous)
- EARGS (`RequestError`) - Invalid number of arguments.
- EINJECT (`RequestError`) - SQL injection warning.

---------------------------------------

### pipe (stream)

Sets request to `stream` mode and pulls all rows from all recordsets to a given stream.

__Arguments__

- **stream** - Writable stream in object mode.

__Example__

```javascript
const request = new sql.Request()
request.pipe(stream)
request.query('select * from mytable')
stream.on('error', err => {
    // ...
})
stream.on('finish', () => {
    // ...
})
```

---------------------------------------

### query (command, [callback])

Execute the SQL command. To execute commands like `create procedure` or if you plan to work with local temporary tables, use [batch](#batch-batch-callback) instead.

__Arguments__

- **command** - T-SQL command to be executed.
- **callback(err, recordset)** - A callback which is called after execution has completed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const request = new sql.Request()
request.query('select 1 as number', (err, result) => {
    // ... error checks

    console.log(result.recordset[0].number) // return 1

    // ...
})
```

__Errors__
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Cancelled.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

```javascript
const request = new sql.Request()
request.query('select 1 as number; select 2 as number', (err, result) => {
    // ... error checks

    console.log(result.recordset[0].number) // return 1
    console.log(result.recordsets[0][0].number) // return 1
    console.log(result.recordsets[1][0].number) // return 2
})
```

**NOTE**: To get number of rows affected by the statement(s), see section [Affected Rows](#affected-rows).

---------------------------------------

### batch (batch, [callback])

Execute the SQL command. Unlike [query](#query-command-callback), it doesn't use `sp_executesql`, so is not likely that SQL Server will reuse the execution plan it generates for the SQL. Use this only in special cases, for example when you need to execute commands like `create procedure` which can't be executed with [query](#query-command-callback) or if you're executing statements longer than 4000 chars on SQL Server 2000. Also you should use this if you're plan to work with local temporary tables ([more information here](http://weblogs.sqlteam.com/mladenp/archive/2006/11/03/17197.aspx)).

NOTE: Table-Valued Parameter (TVP) is not supported in batch.

__Arguments__

- **batch** - T-SQL command to be executed.
- **callback(err, recordset)** - A callback which is called after execution has completed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const request = new sql.Request()
request.batch('create procedure #temporary as select * from table', (err, result) => {
    // ... error checks
})
```

__Errors__
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Cancelled.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

You can enable multiple recordsets in queries with the `request.multiple = true` command.

---------------------------------------

### bulk (table, [options,] [callback])

Perform a bulk insert.

__Arguments__

- **table** - `sql.Table` instance.
- **options** - Options object to be passed through to driver (currently tedious only). Optional. If argument is a function it will be treated as the callback.
- **callback(err, rowCount)** - A callback which is called after bulk insert has completed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const table = new sql.Table('table_name') // or temporary table, e.g. #temptable
table.create = true
table.columns.add('a', sql.Int, {nullable: true, primary: true})
table.columns.add('b', sql.VarChar(50), {nullable: false})
table.rows.add(777, 'test')

const request = new sql.Request()
request.bulk(table, (err, result) => {
    // ... error checks
})
```

**IMPORTANT**: Always indicate whether the column is nullable or not!

**TIP**: If you set `table.create` to `true`, module will check if the table exists before it start sending data. If it doesn't, it will automatically create it. You can specify primary key columns by setting `primary: true` to column's options. Primary key constraint on multiple columns is supported.

**TIP**: You can also create Table variable from any recordset with `recordset.toTable()`. You can optionally specify table type name in the first argument.

__Errors__
- ENAME (`RequestError`) - Table name must be specified for bulk insert.
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Cancelled.
- ENOCONN (`RequestError`) - No connection is specified for that request.
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- ECONNCLOSED (`ConnectionError`) - Connection is closed.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EABORT (`TransactionError`) - Transaction was aborted (by user or because of an error).

---------------------------------------

### cancel()

Cancel currently executing request. Return `true` if cancellation packet was send successfully.

__Example__

```javascript
const request = new sql.Request()
request.query('waitfor delay \'00:00:05\'; select 1 as number', (err, result) => {
    console.log(err instanceof sql.RequestError)  // true
    console.log(err.message)                      // Cancelled.
    console.log(err.code)                         // ECANCEL

    // ...
})

request.cancel()
```

## Transaction

**IMPORTANT:** always use `Transaction` class to create transactions - it ensures that all your requests are executed on one connection. Once you call `begin`, a single connection is acquired from the connection pool and all subsequent requests (initialized with the `Transaction` object) are executed exclusively on this connection. After you call `commit` or `rollback`, connection is then released back to the connection pool.

```javascript
const transaction = new sql.Transaction(/* [pool] */)
```

If you omit connection argument, global connection is used instead.

__Example__

```javascript
const transaction = new sql.Transaction(/* [pool] */)
transaction.begin(err => {
    // ... error checks

    const request = new sql.Request(transaction)
    request.query('insert into mytable (mycolumn) values (12345)', (err, result) => {
        // ... error checks

        transaction.commit(err => {
            // ... error checks

            console.log("Transaction committed.")
        })
    })
})
```

Transaction can also be created by `const transaction = pool.transaction()`. Requests can also be created by `const request = transaction.request()`.

__Aborted transactions__

This example shows how you should correctly handle transaction errors when `abortTransactionOnError` (`XACT_ABORT`) is enabled. Added in 2.0.

```javascript
const transaction = new sql.Transaction(/* [pool] */)
transaction.begin(err => {
    // ... error checks

    let rolledBack = false

    transaction.on('rollback', aborted => {
        // emited with aborted === true

        rolledBack = true
    })

    new sql.Request(transaction)
    .query('insert into mytable (bitcolumn) values (2)', (err, result) => {
        // insert should fail because of invalid value

        if (err) {
            if (!rolledBack) {
                transaction.rollback(err => {
                    // ... error checks
                })
            }
        } else {
            transaction.commit(err => {
                // ... error checks
            })
        }
    })
})
```

### Events

- **begin** - Dispatched when transaction begin.
- **commit** - Dispatched on successful commit.
- **rollback(aborted)** - Dispatched on successful rollback with an argument determining if the transaction was aborted (by user or because of an error).

---------------------------------------

### begin ([isolationLevel], [callback])

Begin a transaction.

__Arguments__

- **isolationLevel** - Controls the locking and row versioning behavior of TSQL statements issued by a connection. Optional. `READ_COMMITTED` by default. For possible values see `sql.ISOLATION_LEVEL`.
- **callback(err)** - A callback which is called after transaction has began, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const transaction = new sql.Transaction()
transaction.begin(err => {
    // ... error checks
})
```

__Errors__
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- EALREADYBEGUN (`TransactionError`) - Transaction has already begun.

---------------------------------------

### commit ([callback])

Commit a transaction.

__Arguments__

- **callback(err)** - A callback which is called after transaction has committed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const transaction = new sql.Transaction()
transaction.begin(err => {
    // ... error checks

    transaction.commit(err => {
        // ... error checks
    })
})
```

__Errors__
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EREQINPROG (`TransactionError`) - Can't commit transaction. There is a request in progress.

---------------------------------------

### rollback ([callback])

Rollback a transaction. If the queue isn't empty, all queued requests will be Cancelled and the transaction will be marked as aborted.

__Arguments__

- **callback(err)** - A callback which is called after transaction has rolled back, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const transaction = new sql.Transaction()
transaction.begin(err => {
    // ... error checks

    transaction.rollback(err => {
        // ... error checks
    })
})
```

__Errors__
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.
- EREQINPROG (`TransactionError`) - Can't rollback transaction. There is a request in progress.

## Prepared Statement

**IMPORTANT:** always use `PreparedStatement` class to create prepared statements - it ensures that all your executions of prepared statement are executed on one connection. Once you call `prepare`, a single connection is acquired from the connection pool and all subsequent executions are executed exclusively on this connection. After you call `unprepare`, the connection is then released back to the connection pool.

```javascript
const ps = new sql.PreparedStatement(/* [pool] */)
```

If you omit the connection argument, the global connection is used instead.

__Example__

```javascript
const ps = new sql.PreparedStatement(/* [pool] */)
ps.input('param', sql.Int)
ps.prepare('select @param as value', err => {
    // ... error checks

    ps.execute({param: 12345}, (err, result) => {
        // ... error checks

        // release the connection after queries are executed
        ps.unprepare(err => {
            // ... error checks

        })
    })
})
```

**IMPORTANT**: Remember that each prepared statement means one reserved connection from the pool. Don't forget to unprepare a prepared statement when you've finished your queries!

You can execute multiple queries against the same prepared statement but you *must* unprepare the statement when you have finished using it otherwise you will cause the connection pool to run out of available connections.

**TIP**: You can also create prepared statements in transactions (`new sql.PreparedStatement(transaction)`), but keep in mind you can't execute other requests in the transaction until you call `unprepare`.

---------------------------------------

### input (name, type)

Add an input parameter to the prepared statement.

__Arguments__

- **name** - Name of the input parameter without @ char.
- **type** - SQL data type of input parameter.

__Example__

```javascript
ps.input('input_parameter', sql.Int)
ps.input('input_parameter', sql.VarChar(50))
```

__Errors__ (synchronous)
- EARGS (`PreparedStatementError`) - Invalid number of arguments.
- EINJECT (`PreparedStatementError`) - SQL injection warning.

---------------------------------------

### output (name, type)

Add an output parameter to the prepared statement.

__Arguments__

- **name** - Name of the output parameter without @ char.
- **type** - SQL data type of output parameter.

__Example__

```javascript
ps.output('output_parameter', sql.Int)
ps.output('output_parameter', sql.VarChar(50))
```

__Errors__ (synchronous)
- EARGS (`PreparedStatementError`) - Invalid number of arguments.
- EINJECT (`PreparedStatementError`) - SQL injection warning.

---------------------------------------

### prepare (statement, [callback])

Prepare a statement.

__Arguments__

- **statement** - T-SQL statement to prepare.
- **callback(err)** - A callback which is called after preparation has completed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const ps = new sql.PreparedStatement()
ps.prepare('select @param as value', err => {
    // ... error checks
})
```

__Errors__
- ENOTOPEN (`ConnectionError`) - Connection not yet open.
- EALREADYPREPARED (`PreparedStatementError`) - Statement is already prepared.
- ENOTBEGUN (`TransactionError`) - Transaction has not begun.

---------------------------------------

### execute (values, [callback])

Execute a prepared statement.

__Arguments__

- **values** - An object whose names correspond to the names of parameters that were added to the prepared statement before it was prepared.
- **callback(err)** - A callback which is called after execution has completed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const ps = new sql.PreparedStatement()
ps.input('param', sql.Int)
ps.prepare('select @param as value', err => {
    // ... error checks

    ps.execute({param: 12345}, (err, result) => {
        // ... error checks

        console.log(result.recordset[0].value) // return 12345
        console.log(result.rowsAffected) // Returns number of affected rows in case of INSERT, UPDATE or DELETE statement.
        
        ps.unprepare(err => {
            // ... error checks
        })
    })
})
```

You can also stream executed request.

```javascript
const ps = new sql.PreparedStatement()
ps.input('param', sql.Int)
ps.prepare('select @param as value', err => {
    // ... error checks

    ps.stream = true
    const request = ps.execute({param: 12345})

    request.on('recordset', columns => {
        // Emitted once for each recordset in a query
    })

    request.on('row', row => {
        // Emitted for each row in a recordset
    })

    request.on('error', err => {
        // May be emitted multiple times
    })

    request.on('done', result => {
        // Always emitted as the last one
        
        console.log(result.rowsAffected) // Returns number of affected rows in case of INSERT, UPDATE or DELETE statement.
        
        ps.unprepare(err => {
            // ... error checks
        })
    })
})
```

**TIP**: To learn more about how number of affected rows works, see section [Affected Rows](#affected-rows).

__Errors__
- ENOTPREPARED (`PreparedStatementError`) - Statement is not prepared.
- ETIMEOUT (`RequestError`) - Request timeout.
- EREQUEST (`RequestError`) - *Message from SQL Server*
- ECANCEL (`RequestError`) - Cancelled.

---------------------------------------

### unprepare ([callback])

Unprepare a prepared statement.

__Arguments__

- **callback(err)** - A callback which is called after unpreparation has completed, or an error has occurred. Optional. If omitted, returns [Promise](#promises).

__Example__

```javascript
const ps = new sql.PreparedStatement()
ps.input('param', sql.Int)
ps.prepare('select @param as value', err => {
    // ... error checks

    ps.unprepare(err => {
        // ... error checks

    })
})
```

__Errors__
- ENOTPREPARED (`PreparedStatementError`) - Statement is not prepared.

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
const tvp = new sql.Table() // You can optionally specify table type name in the first argument.

// Columns must correspond with type we have created in database.
tvp.columns.add('a', sql.VarChar(50))
tvp.columns.add('b', sql.Int)

// Add rows
tvp.rows.add('hello tvp', 777) // Values are in same order as columns.
```

You can send table as a parameter to stored procedure.

```javascript
const request = new sql.Request()
request.input('tvp', tvp)
request.execute('MyCustomStoredProcedure', (err, result) => {
    // ... error checks

    console.dir(result.recordsets[0][0]) // {a: 'hello tvp', b: 777}
})
```

**TIP**: You can also create Table variable from any recordset with `recordset.toTable()`. You can optionally specify table type name in the first argument.

## Affected Rows

If you're performing `INSERT`, `UPDATE` or `DELETE` in a query, you can read number of affected rows. The `rowsAffected` variable is an array of numbers. Each number represents number of affected rows by a single statement.

__Example using Promises__

```javascript
const request = new sql.Request()
request.query('update myAwesomeTable set awesomness = 100').then(result => {
    console.log(result.rowsAffected)
})
```

__Example using callbacks__

```javascript
const request = new sql.Request()
request.query('update myAwesomeTable set awesomness = 100', (err, result) => {
    console.log(result.rowsAffected)
})
```

__Example using streaming__

```javascript
const request = new sql.Request()
request.stream = true
request.query('update myAwesomeTable set awesomness = 100')
request.on('done', result => {
    console.log(result.rowsAffected)
})
```

## JSON support

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

## Errors

There are 4 types of errors you can handle:

- **ConnectionError** - Errors related to connections and connection pool.
- **TransactionError** - Errors related to creating, committing and rolling back transactions.
- **RequestError** - Errors related to queries and stored procedures execution.
- **PreparedStatementError** - Errors related to prepared statements.

Those errors are initialized in node-mssql module and its original stack may be cropped. You can always access original error with `err.originalError`.

SQL Server may generate more than one error for one request so you can access preceding errors with `err.precedingErrors`.

### Error Codes

Each known error has `name`, `code` and `message` properties.

Name | Code | Message
:--- | :--- | :---
`ConnectionError` | ELOGIN | Login failed.
`ConnectionError` | ETIMEOUT | Connection timeout.
`ConnectionError` | EDRIVER | Unknown driver.
`ConnectionError` | EALREADYCONNECTED | Database is already connected!
`ConnectionError` | EALREADYCONNECTING | Already connecting to database!
`ConnectionError` | ENOTOPEN | Connection not yet open.
`ConnectionError` | EINSTLOOKUP | Instance lookup failed.
`ConnectionError` | ESOCKET | Socket error.
`ConnectionError` | ECONNCLOSED | Connection is closed.
`TransactionError` | ENOTBEGUN | Transaction has not begun.
`TransactionError` | EALREADYBEGUN | Transaction has already begun.
`TransactionError` | EREQINPROG | Can't commit/rollback transaction. There is a request in progress.
`TransactionError` | EABORT | Transaction has been aborted.
`RequestError` | EREQUEST | Message from SQL Server. Error object contains additional details.
`RequestError` | ECANCEL | Cancelled.
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
- **err.state** - The error state, used as a modifier to the number.
- **err.class** - The class (severity) of the error. A class of less than 10 indicates an informational message. Detailed explanation can be found [here](https://msdn.microsoft.com/en-us/library/dd304156.aspx).
- **err.lineNumber** - The line number in the SQL batch or stored procedure that caused the error. Line numbers begin at 1; therefore, if the line number is not applicable to the message, the value of LineNumber will be 0.
- **err.serverName** - The server name.
- **err.procName** - The stored procedure name.

## Informational messages

To receive informational messages generated by `PRINT` or `RAISERROR` commands use:

```javascript
const request = new sql.Request()
request.on('info', info => {
    console.dir(info)
})
request.query('print \'Hello world.\';', (err, result) => {
    // ...
})
```

Structure of informational message:

- **info.message** - Message.
- **info.number** - The message number.
- **info.state** - The message state, used as a modifier to the number.
- **info.class** - The class (severity) of the message. Equal or lower than 10. Detailed explanation can be found [here](https://msdn.microsoft.com/en-us/library/dd304156.aspx).
- **info.lineNumber** - The line number in the SQL batch or stored procedure that generated the message. Line numbers begin at 1; therefore, if the line number is not applicable to the message, the value of LineNumber will be 0.
- **info.serverName** - The server name.
- **info.procName** - The stored procedure name.

## Metadata

Recordset metadata are accessible through the `recordset.columns` property.

```javascript
const request = new sql.Request()
request.query('select convert(decimal(18, 4), 1) as first, \'asdf\' as second', (err, result) => {
    console.dir(result.recordset.columns)

    console.log(result.recordset.columns.first.type === sql.Decimal) // true
    console.log(result.recordset.columns.second.type === sql.VarChar) // true
})
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

## Data Types

You can define data types with length/precision/scale:

```javascript
request.input("name", sql.VarChar, "abc")               // varchar(3)
request.input("name", sql.VarChar(50), "abc")           // varchar(50)
request.input("name", sql.VarChar(sql.MAX), "abc")      // varchar(MAX)
request.output("name", sql.VarChar)                     // varchar(8000)
request.output("name", sql.VarChar, "abc")              // varchar(3)

request.input("name", sql.Decimal, 155.33)              // decimal(18, 0)
request.input("name", sql.Decimal(10), 155.33)          // decimal(10, 0)
request.input("name", sql.Decimal(10, 2), 155.33)       // decimal(10, 2)

request.input("name", sql.DateTime2, new Date())        // datetime2(7)
request.input("name", sql.DateTime2(5), new Date())     // datetime2(5)
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

sql.Variant

sql.Binary
sql.VarBinary ([length])
sql.Image

sql.UDT
sql.Geography
sql.Geometry
```

To setup MAX length for `VarChar`, `NVarChar` and `VarBinary` use `sql.MAX` length. Types `sql.XML` and `sql.Variant` are not supported as input parameters.

## SQL injection

This module has built-in SQL injection protection. Always use parameters or tagged template literals to pass sanitized values to your queries.

```javascript
const request = new sql.Request()
request.input('myval', sql.VarChar, '-- commented')
request.query('select @myval as myval', (err, result) => {
    console.dir(result)
})
```

## Known issues

### Tedious

- If you're facing problems with connecting SQL Server 2000, try setting the default TDS version to 7.1 with `config.options.tdsVersion = '7_1'` ([issue](https://github.com/tediousjs/node-mssql/issues/36))
- If you're executing a statement longer than 4000 chars on SQL Server 2000, always use [batch](#batch-batch-callback) instead of [query](#query-command-callback) ([issue](https://github.com/tediousjs/node-mssql/issues/68))

### msnodesqlv8

- msnodesqlv8 has problem with errors during transactions - [reported](https://github.com/tediousjs/node-mssql/issues/77).
- msnodesqlv8 doesn't support [detailed SQL errors](#detailed-sql-errors).

## 3.x to 4.x changes

- Library & tests are rewritten to ES6.
- `Connection` was renamed to `ConnectionPool`.
- Drivers are no longer loaded dynamically so the library is now compatible with Webpack. To use `msnodesqlv8` driver, use `const sql = require('mssql/msnodesqlv8')` syntax.
- Every callback/resolve now returns `result` object only. This object contains `recordsets` (array of recordsets), `recordset` (first recordset from array of recordsets), `rowsAffected` (array of numbers representig number of affected rows by each insert/update/delete statement) and `output` (key/value collection of output parameters' values).
- Affected rows are now returned as an array. A separate number for each SQL statement.
- Directive `multiple: true` was removed.
- `Transaction` and `PreparedStatement` internal queues was removed.
- ConnectionPool no longer emits `connect` and `close` events.
- Removed verbose and debug mode.
- Removed support for `tds` and `msnodesql` drivers.
- Removed support for Node versions lower than 4.

[npm-image]: https://img.shields.io/npm/v/mssql.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/mssql
[downloads-image]: https://img.shields.io/npm/dm/mssql.svg?style=flat-square
[downloads-url]: https://www.npmjs.com/package/mssql
[david-image]: https://img.shields.io/david/tediousjs/node-mssql.svg?style=flat-square
[david-url]: https://david-dm.org/tediousjs/node-mssql
[travis-image]: https://img.shields.io/travis/tediousjs/node-mssql/master.svg?style=flat-square&label=unit
[travis-url]: https://travis-ci.org/tediousjs/node-mssql
[appveyor-image]: https://ci.appveyor.com/api/projects/status/e5gq1a0ujwams9t7/branch/master?svg=true
[appveyor-url]: https://ci.appveyor.com/project/tediousjs/node-mssql

[tedious-url]: https://www.npmjs.com/package/tedious
[msnodesqlv8-url]: https://www.npmjs.com/package/msnodesqlv8

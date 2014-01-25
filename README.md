# node-mssql [![Dependency Status](https://david-dm.org/patriksimek/node-mssql.png)](https://david-dm.org/patriksimek/node-mssql) [![NPM version](https://badge.fury.io/js/mssql.png)](http://badge.fury.io/js/mssql)

An easy-to-use MSSQL database connector for Node.js.

There are some TDS modules which offer functionality to communicate with MSSQL databases but none of them does offer enough comfort - implementation takes a lot of lines of code. So I decided to create this module, that make work as easy as it could without loosing any important functionality. node-mssql uses other TDS modules as drivers and offer easy to use unified interface. It also add some extra features and bug fixes.

There is also [co](https://github.com/visionmedia/co) warpper available - [co-mssql](https://github.com/patriksimek/co-mssql).

**Extra features:**
- Unified interface for multiple MSSQL modules
- Connection pooling with Transactions support
- Parametrized Stored Procedures in [node-tds](https://github.com/cretz/node-tds) and [Microsoft Driver for Node.js for SQL Server](https://github.com/WindowsAzure/node-sqlserver)
- Injects original TDS modules with enhancements and bug fixes

At the moment it support three TDS modules:
- [Tedious](https://github.com/pekim/tedious) by Mike D Pilsbury (pure javascript - windows/osx/linux)
- [Microsoft Driver for Node.js for SQL Server](https://github.com/WindowsAzure/node-sqlserver) by Microsoft Corporation (native - windows only)
- [node-tds](https://github.com/cretz/node-tds) by Chad Retz (pure javascript - windows/osx/linux)

## What's new in 0.5.0

- You can now attach event listeners to `Connection` (`connect`, `close`), `Transaction` (`begin`, `commit`, `rollback`) and `Request` (`row`, `recordset`, `done`)
- You can now set length of Char, NChar and Binary output parameters
- You can now change default transaction isolation level
- Errors are now splitted to three categories for better error handling - `ConnectionError`, `TransactionError`, `ReqestError`
- New features and bug fixes for [Tedious](https://github.com/pekim/tedious)
    - Binary and VarBinary types are now available as input and output parameters
    - Image type is now available as input parameter
    - Binary, VarBinary and Image types are now returned as buffer (was array)
    - Transaction isolationLevel default is now `READ_COMMITED` (was `READ_UNCOMMITED`)
    - Fixed issue when zero value was casted as null when using BigInt as input parameter
    - Fixed issue when dates before 1900/01/01 in input parameters resulted in "Out of bounds" error
- New features and bug fixes for [node-tds](https://github.com/cretz/node-tds)
    - UniqueIdentifier type in now available as input and output parameter
    - UniqueIdentifier type is now parsed correctly as string value (was buffer)
    - Text, NText, Char, NChar, VarChar and NVarChar input parameters has correct lengths
    - Fixed `Error` messages
- New features and bug fixes for [Microsoft Driver for Node.js for SQL Server](https://github.com/WindowsAzure/node-sqlserver)
    - Char, NChar, Xml, Text, NText and VarBinary types are now correctly functional as output parameters

## Installation

    npm install mssql

## Quick Example

```javascript
var sql = require('mssql'); 

var config = {
    user: '...',
    password: '...',
    server: 'localhost',
    database: '...'
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
    request.output('output_parameter', sql.Int);
    request.execute('procedure_name', function(err, recordsets, returnValue) {
        // ... error checks
        
        console.dir(recordsets);
    });
	
});
```

## Quick Example with one global connection

```javascript
var sql = require('mssql'); 

var config = {
    user: '...',
    password: '...',
    server: 'localhost',
    database: '...'
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
    request.output('output_parameter', sql.Int);
    request.execute('procedure_name', function(err, recordsets, returnValue) {
        // ... error checks
    	
        console.dir(recordsets);
    });
	
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
* [query](#query)

### Transactions

* [Transaction](#transaction)
* [begin](#begin)
* [commit](#commit)
* [rollback](#rollback)

### Other

* [Errors](#errors)
* [Metadata](#meta)
* [Data Types](#data-types)
* [Verbose Mode](#verbose)
* [Known issues](#issues)

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

- **driver** - Driver to use (default: `tedious`). Possible values: `tedious` or `msnodesql`.
- **user** - User name to use for authentication.
- **password** - Password to use for authentication.
- **server** - Hostname to connect to.
- **port** - Port to connect to (default: `1433`).
- **database** - Database to connect to (default: dependent on server configuration).
- **timeout** - Connection timeout in ms (default: 15000).
- **pool.max** - The maximum number of connections there can be in the pool (default: `10`).
- **pool.min** - The minimun of connections there can be in the pool (default: `0`).
- **pool.idleTimeoutMillis** - The Number of milliseconds before closing an unused connection (default: `30000`).

<a name="cfg-tedious" />
### Tedious

- **options** - Object of Tedious specific options. More information: http://pekim.github.io/tedious/api-connection.html

__This module update Tedious driver with some extra features and bug fixes by overriding some of its internal functions. If you want to disable this, require module with `var sql = require('mssql/nofix')`.__

<a name="cfg-msnodesql" />
### Microsoft Driver for Node.js for SQL Server

This driver is not part of the default package and must be installed separately by 'npm install msnodesql'. If you are looking for compiled binaries, see [node-sqlserver-binary](https://github.com/jorgeazevedo/node-sqlserver-binary).

- **connectionString** - Connection string (default: see below).

```
Driver={SQL Server Native Client 11.0};Server=#{server},#{port};Database=#{database};Uid=#{user};Pwd=#{password};Connection Timeout=#{timeout};
```

<a name="cfg-node-tds" />
### node-tds

This driver is not part of the default package and must be installed separately by 'npm install tds'.

__This module update node-tds driver with some extra features and bug fixes by overriding some of its internal functions. If you want to disable this, require module with `var sql = require('mssql/nofix')`.__

<a name="connection" />
## Connections

```javascript
var connection = new sql.Connection({ /* config */ });
```

### Events

- **connect** - Dispatched after connection has established.
- **close** - Dispatched after connection has closed a pool (by calling `close`).

---------------------------------------

<a name="connect" />
### connect([callback])

Create connection to the server.

__Arguments__

- **callback(err)** - A callback which is called after connection has established, or an error has occurred. Optional.

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

---------------------------------------

<a name="close" />
### close()

Close connection to the server.

__Example__

```javascript
connection.close();
```

<a name="request" />
## Requests

```javascript
var request = new sql.Request(/* [connection] */);
```

If you ommit connection argument, global connection is used instead.

### Events

- **recordset(recordset)** - Dispatched when new recordset is parsed (and all its rows).
- **row(row)** - Dispatched when new row is parsed.
- **done(err, recordsets)** - Dispatched when request is complete.

---------------------------------------

<a name="execute" />
### execute(procedure, [callback])

Call a stored procedure.

__Arguments__

- **procedure** - Name of the stored procedure to be executed.
- **callback(err, recordsets, returnValue)** - A callback which is called after execution has completed, or an error has occurred. `returnValue` is also accessible as property of recordsets.

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

- `String` -> `sql.VarChar`
- `Number` -> `sql.Int`
- `Boolean` -> `sql.Bit`
- `Date` -> `sql.DateTime`

Default data type for unknown object is `sql.VarChar`.

You can define you own type map.

```javascript
sql.map.register(MyClass, sql.Text);
```

You can also overwrite default type map.

```javascript
sql.map.register(Number, sql.BigInt);
```

---------------------------------------

<a name="output" />
### output(name, type, [length])

Add an output parameter to the request.

__Arguments__

- **name** - Name of the output parameter without @ char.
- **type** - SQL data type of output parameter.
- **length** - Expected length (for Char, Binary). Optional.

__Example__

```javascript
request.output('output_parameter', sql.Int);
request.output('output_parameter', sql.Char, 50);
```

---------------------------------------

<a name="query" />
### query(command, [callback])

Execute the SQL command.

__Arguments__

- **command** - T-SQL command to be executed.
- **callback(err, recordset)** - A callback which is called after execution has completed, or an error has occurred.

__Example__

```javascript
var request = new sql.Request();
request.query('select 1 as number', function(err, recordset) {
    // ... error checks
    
    console.log(recordset[0].number); // return 1
	
    // ...
});
```

You can enable multiple recordsets in querries by `request.multiple = true` command.

```javascript
var request = new sql.Request();
request.multiple = true;

request.query('select 1 as number; select 2 as number', function(err, recordsets) {
    // ... error checks
    
    console.log(recordsets[0][0].number); // return 1
    console.log(recordsets[1][0].number); // return 2
});
```

<a name="transaction" />
## Transactions

**Important:** always use `Transaction` class to create transactions - it ensures that all your requests are executed on one connection. Once you call `begin`, a single connection is aquired from the connection pool and all subsequent requests (initialized with the `Transaction` object) are executed exclusively on this connection. After you call `commit` or `rollback`, connection is then released back to the connection pool.

```javascript
var transaction = new sql.Transaction(/* [connection] */);
```

If you ommit connection argument, global connection is used instead.

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

### Events

- **begin** - Dispatched when transaction begin.
- **commit** - Dispatched on successful commit.
- **rollback** - Dispatched on successful rollback.

---------------------------------------

<a name="begin" />
### begin([isolationLevel], [callback])

Begin a transaction.

__Arguments__

- **isolationLevel** - Controls the locking and row versioning behavior of TSQL statements issued by a connection. Optional. `READ_COMMITTED` by default. For possible values see `sql.ISOLATION_LEVEL`.
- **callback(err)** - A callback which is called after transaction has began, or an error has occurred. Optional.

__Example__

```javascript
var transaction = new sql.Transaction();
transaction.begin(function(err) {
    // ...
});
```

---------------------------------------

<a name="commit" />
### commit([callback])

Commit a transaction.

__Arguments__

- **callback(err)** - A callback which is called after transaction has commited, or an error has occurred. Optional.

__Example__

```javascript
var transaction = new sql.Transaction();
transaction.begin(function(err) {
    // ...
    
    transaction.commit(function(err) {
        //...
    })
});
```

---------------------------------------

<a name="rollback" />
### rollback([callback])

Rollback a transaction.

__Arguments__

- **callback(err)** - A callback which is called after transaction has rolled back, or an error has occurred. Optional.

__Example__

```javascript
var transaction = new sql.Transaction();
transaction.begin(function(err) {
    // ...
    
    transaction.rollback(function(err) {
        //...
    })
});
```

<a name="data-types" />
## Errors

There are three type of errors you can handle:

- **ConnectionError** - Errors related to connections and connection pool.
- **TransactionError** - Errors related to creating, commiting and rolling back transactions.
- **RequestError** - Errors related to queries and stored procedures execution.

Those errors are initialized in node-mssql module and it's stack can be cropped. You can always access original error with `err.originalError`.

<a name="data-types" />
## Metadata

Recordset metadata are accessible trough `recordset.columns` property.

```javascript
var request = new sql.Request();
request.query('select 1 as first, \'asdf\' as second', function(err, recordset) {
    console.dir(recordset.columns);
	
    console.log(recordset.columns.first.type === sql.Int); // true
    console.log(recordset.columns.second.type === sql.VarChar); // true
});
```

Columns structure for example above:

```
{ first: { name: 'first', size: 10, type: { name: 'int' } },
  second: { name: 'second', size: 4, type: { name: 'varchar' } } }
```

<a name="data-types" />
## Data Types

```
sql.Bit
sql.BigInt
sql.Decimal
sql.Float
sql.Int
sql.Money
sql.Numeric
sql.SmallInt
sql.SmallMoney
sql.Real
sql.TinyInt

sql.Char
sql.NChar
sql.Text
sql.NText
sql.VarChar
sql.NVarChar
sql.Xml

sql.Date
sql.DateTime
sql.DateTimeOffset
sql.SmallDateTime

sql.UniqueIdentifier

sql.Binary
sql.VarBinary
sql.Image
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

Output for example above could look similar to this.

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

- If you're facing problems with text codepage, try using NVarChar as default data type for string values - `sql.map.register(String, sql.NVarChar)`.

### node-tds

- If you're facing problems with date, try changing your tsql language `set language 'English';`.
- node-tds 0.1.0 contains bug and return same value for columns with same name.
- node-tds 0.1.0 doesn't support codepage of input parameters.
- node-tds 0.1.0 contains bug in selects that doesn't return any values *(select @param = 'value')*.
- node-tds 0.1.0 doesn't support Binary, VarBinary and Image as parameters.

<a name="license" />
## License

Copyright (c) 2013-2014 Patrik Simek

The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

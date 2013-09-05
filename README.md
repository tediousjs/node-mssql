#node-mssql [![Build Status](https://secure.travis-ci.org/patriksimek/node-mssql.png)](https://travis-ci.org/patriksimek/node-mssql) [![Dependency Status](https://david-dm.org/patriksimek/node-mssql.png)](https://david-dm.org/patriksimek/node-mssql)

An easy-to-use MSSQL database connector for NodeJS.

It's based on awsome TDS module [Tedious](https://github.com/pekim/tedious) by Mike D Pilsbury.

## Installation

    npm install mssql

## Getting started

```javascript
var sql = require('mssql'); 

sql.pool = {
	max: 1,
	min: 0,
	idleTimeoutMillis: 30000
}

sql.connection = {
	userName: '...',
	password: '...',
	server: 'localhost',
	
	options: {
		database: '...'
	}
}

sql.init();
```

## Stored procedure call

```javascript
var request = new sql.Request();
request.input('input_parameter', sql.Int, value);
request.output('output_parameter', sql.Int);

request.execute('procedure_name', function(err, recordsets, returnValue) {
	console.log(recordsets.length); // count of recordsets returned by procedure
	console.log(recordset[0].length); // count of rows contained in first recordset
	console.log(returnValue); // procedure return value
	
	console.log(request.parameters.output_parameter.value); // output value
	
	// ...
});
```

### Parameters

```javascript
// input
request.input('input_parameter', value);
request.input('input_parameter', sql.Int, value);

// output
request.output('output_parameter', sql.Int);
```

If you omit `type` argument of input parameter, module automaticaly decide which SQL data type should be used based on JS data type. You can define you own type map.

```javascript
sql.map.register(MyClass, sql.Text);
```

You can also overwrite default type map.

```javascript
sql.map.register(Number, sql.Int);
```

#### Default map

* `String` -> `sql.VarChar`
* `Number` -> `sql.BigInt`
* `Boolean` -> `sql.Bit`
* `Date` -> `sql.DateTime`

Default data type for unknown object is `sql.VarChar`.

## Simple query

```javascript
var request = new sql.Request();

request.query('select 1 as number', function(err, recordset) {
	console.log(recordset[0].number); // return 1
	
	// ...
});
```

## Data types

```
sql.VarChar
sql.NVarChar
sql.Text
sql.Int
sql.BigInt
sql.TinyInt
sql.SmallInt
sql.Bit
sql.Float
sql.Real
sql.DateTime
sql.SmallDateTime
sql.UniqueIdentifier
```

Tedious data type constants can be accessed by `sql.TYPES.<type>`. Complete list of data type constants can be found here: [Tedious Datatypes](http://pekim.github.io/tedious/api-datatypes.html)

## Verbose mode

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

## License

Copyright (c) 2013 Patrik Simek

The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

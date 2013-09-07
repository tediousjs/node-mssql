TYPES =
	VarChar:
		name: 'varchar'
		
	NVarChar:
		name: 'nvarchar'
		
	Text:
		name: 'text'
		
	Int:
		name: 'int'
		
	BigInt:
		name: 'bigint'
		
	TinyInt:
		name: 'tinyint'
		
	SmallInt:
		name: 'smallint'
		
	Bit:
		name: 'bit'
		
	Float:
		name: 'float'
	
	Numeric:
		name: 'numeric'
	
	Decimal:
		name: 'decimal'
		
	Real:
		name: 'real'
		
	Date:
		name: 'date'
		
	DateTime:
		name: 'datetime'
		
	DateTimeOffset:
		name: 'datetimeoffset'
		
	SmallDateTime:
		name: 'smalldatetime'
	
	Time:
		name: 'time'
		
	UniqueIdentifier:
		name: 'uniqueidentifier'
	
	SmallMoney:
		name: 'smallmoney'
	
	Money:
		name: 'money'
	
	Binary:
		name: 'binary'
	
	VarBinary:
		name: 'varbinary'
	
	Image:
		name: 'image'
	
	Xml:
		name: 'xml'
	
	Char:
		name: 'char'
	
	NChar:
		name: 'nchar'
	
	NText:
		name: 'ntext'

module.exports.TYPES = TYPES
module.exports.DECLARATIONS = {}

for key, value of TYPES
	module.exports.DECLARATIONS[value.name] = value
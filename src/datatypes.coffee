TYPES =
	VarChar: (length) -> type: TYPES.VarChar, length: length
	NVarChar: (length) -> type: TYPES.NVarChar, length: length
	Text: -> type: TYPES.Text
	Int: -> type: TYPES.Int
	BigInt: -> type: TYPES.BigInt
	TinyInt: -> type: TYPES.TinyInt
	SmallInt: -> type: TYPES.SmallInt
	Bit: -> type: TYPES.Bit
	Float: -> type: TYPES.Float
	Numeric: (precision, scale) -> type: TYPES.Numeric, precision: precision, scale: scale
	Decimal: (precision, scale) -> type: TYPES.Decimal, precision: precision, scale: scale
	Real: -> type: TYPES.Real
	Date: -> type: TYPES.Date
	DateTime: -> type: TYPES.DateTime
	DateTime2: (scale) -> type: TYPES.DateTime2, scale: scale
	DateTimeOffset: (scale) -> type: TYPES.DateTimeOffset, scale: scale
	SmallDateTime: -> type: TYPES.SmallDateTime
	Time: (scale) -> type: TYPES.Time, scale: scale
	UniqueIdentifier: -> type: TYPES.UniqueIdentifier
	SmallMoney: -> type: TYPES.SmallMoney
	Money: -> type: TYPES.Money
	Binary: (length) -> type: TYPES.Binary, length: length
	VarBinary: (length) -> type: TYPES.VarBinary, length: length
	Image: -> type: TYPES.Image
	Xml: -> type: TYPES.Xml
	Char: (length) -> type: TYPES.Char, length: length
	NChar: (length) -> type: TYPES.NChar, length: length
	NText: -> type: TYPES.NText
	TVP: -> type: TYPES.TVP
	UDT: -> type: TYPES.UDT
	Geography: -> type: TYPES.Geography
	Geometry: -> type: TYPES.Geometry

module.exports.TYPES = TYPES
module.exports.DECLARATIONS = {}

for key, value of TYPES
	value.declaration = key.toLowerCase()
	module.exports.DECLARATIONS[value.declaration] = value
	
	do (key, value) ->
		value.inspect = -> "[sql.#{key}]"
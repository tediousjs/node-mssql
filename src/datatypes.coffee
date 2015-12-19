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
	TVP: (tvpType) -> type: TYPES.TVP, tvpType: tvpType
	UDT: -> type: TYPES.UDT
	Geography: -> type: TYPES.Geography
	Geometry: -> type: TYPES.Geometry
	Variant: -> type: TYPES.Variant

module.exports.TYPES = TYPES
module.exports.DECLARATIONS = {}

for key, value of TYPES
	value.declaration = key.toLowerCase()
	module.exports.DECLARATIONS[value.declaration] = value
	
	do (key, value) ->
		value.inspect = -> "[sql.#{key}]"

module.exports.declare = (type, options) ->
	switch type
		when TYPES.VarChar, TYPES.NVarChar, TYPES.VarBinary
			return "#{type.declaration} (#{if options.length > 8000 then 'MAX' else (options.length ? 'MAX')})"
		when TYPES.NVarChar
			return "#{type.declaration} (#{if options.length > 4000 then 'MAX' else (options.length ? 'MAX')})"
		when TYPES.Char, TYPES.NChar, TYPES.Binary
			return "#{type.declaration} (#{options.length ? 1})"
		when TYPES.Decimal, TYPES.Numeric
			return "#{type.declaration} (#{options.precision ? 18}, #{options.scale ? 0})"
		when TYPES.Time, TYPES.DateTime2, TYPES.DateTimeOffset
			return "#{type.declaration} (#{options.scale ? 7})"
		when TYPES.TVP
			return "#{options.tvpType} readonly"
		else
			return type.declaration

module.exports.cast = (value, type, options) ->
	unless value? then return null
	
	switch typeof value
		when 'string'
			return "N'#{value.replace(/'/g, '\'\'')}'"
		
		when 'number'
			return value
			
		when 'boolean'
			return if value then 1 else 0
		
		when 'object'
			if value instanceof Date
				ns = value.getUTCMilliseconds() / 1000
				if value.nanosecondDelta? then ns += value.nanosecondDelta
				scale = options.scale ? 7
				
				if scale > 0
					ns = String(ns).substr(1, scale + 1)
				else
					ns = ""
				
				return "N'#{value.getUTCFullYear()}-#{zero(value.getUTCMonth() + 1)}-#{zero(value.getUTCDate())} #{zero(value.getUTCHours())}:#{zero(value.getUTCMinutes())}:#{zero(value.getUTCSeconds())}#{ns}'"
			
			else if Buffer.isBuffer value
				return "0x#{value.toString 'hex'}"
			
			else
				return null

		else
			return null

zero = (value, length = 2) ->
	value = String(value)
	if value.length < length
		for i in [1..length - value.length]
			value = "0#{value}"

	value

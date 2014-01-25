tds = require 'tedious'

EPOCH_DATE = new Date(1900, 0, 1)
NULL = (1 << 16) - 1
MAX = (1 << 16) - 1

try
	unless require('tedious/package.json').version is '0.1.5' then return
	
	###
	Add support for Binary
	###
	
	tds.TYPES.Binary.maximumLength = 8000
	tds.TYPES.Binary.writeParameterData = (buffer, parameter) ->
		if parameter.length
			length = parameter.length
		else if parameter.value?
			length = parameter.value.length
		else
			length = @maximumLength

		# ParamMetaData (TYPE_INFO)
		buffer.writeUInt8 @.id
		buffer.writeUInt16LE length
		
		if parameter.value?
			buffer.writeUInt16LE length
			buffer.writeBuffer parameter.value.slice 0, Math.min(length, @maximumLength)
		else
			buffer.writeUInt16LE NULL
	
	###
	Add support for VarBinary
	###
	
	tds.TYPES.VarBinary.maximumLength = 8000
	tds.TYPES.VarBinary.writeParameterData = (buffer, parameter) ->
		if parameter.length
			length = parameter.length
		else if parameter.value?
			length = parameter.value.length
		else
			length = @maximumLength

		# ParamMetaData (TYPE_INFO)
		buffer.writeUInt8 @.id
		
		if length <= @maximumLength
			buffer.writeUInt16LE @maximumLength
		else
			buffer.writeUInt16LE MAX

		if parameter.value?
			if length <= @maximumLength
				buffer.writeUInt16LE length
				buffer.writeBuffer parameter.value
			else
				# Length of all chunks.
				buffer.writeUInt64LE length
				# One chunk.
				buffer.writeUInt32LE length
				buffer.writeBuffer parameter.value
				# PLP_TERMINATOR (no more chunks).
				buffer.writeUInt32LE 0

		else
			buffer.writeUInt16LE NULL
	
	###
	Add support for Image
	###
	
	tds.TYPES.Image.writeParameterData = (buffer, parameter) ->
		if parameter.length
			length = parameter.length
		else if parameter.value?
			length = parameter.value.length
		else
			length = -1

		# ParamMetaData (TYPE_INFO)
		buffer.writeUInt8 @.id
		buffer.writeInt32LE length

		if parameter.value?
			buffer.writeInt32LE length
			buffer.writeBuffer parameter.value
		else
			buffer.writeInt32LE length
	
	###
	Fixes issue when bigint null value is converted to 0 value
	###
	
	tds.TYPES.BigInt.writeParameterData = (buffer, parameter) ->
		# ParamMetaData (TYPE_INFO)
		buffer.writeUInt8(tds.TYPES.IntN.id)
		buffer.writeUInt8(8)
		
		# ParamLenData
		if parameter.value?
			buffer.writeUInt8(8)
			if parseInt(parameter.value) > 0x100000000 # 4294967296
				buffer.writeUInt32LE(parseInt(parameter.value) % 0x100000000)
			else
				buffer.writeInt32LE(parseInt(parameter.value) % 0x100000000)
				
			buffer.writeInt32LE(Math.floor(parseInt(parameter.value) / 0x100000000))
		else
			buffer.writeUInt8(0)
	
	###
	Fixes dates before 1.1.1900
	###
	
	tds.TYPES.DateTime.writeParameterData = (buffer, parameter) ->
		# ParamMetaData (TYPE_INFO)
		buffer.writeUInt8 tds.TYPES.DateTimeN.id
		buffer.writeUInt8 8
		
		# ParamLenData
		if parameter.value?
			days = (parameter.value.getTime() - EPOCH_DATE.getTime()) / (1000 * 60 * 60 * 24)
			days = Math.floor days
			
			seconds = parameter.value.getHours() * 60 * 60
			seconds += parameter.value.getMinutes() * 60
			seconds += parameter.value.getSeconds()
			milliseconds = (seconds * 1000) + parameter.value.getMilliseconds()
			threeHundredthsOfSecond = milliseconds / (3 + (1 / 3))
			threeHundredthsOfSecond = Math.floor threeHundredthsOfSecond
			
			buffer.writeUInt8 8
			buffer.writeInt32LE days
			buffer.writeUInt32LE threeHundredthsOfSecond
		else
			buffer.writeUInt8 0

catch ex
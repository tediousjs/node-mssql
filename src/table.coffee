{TYPES, declare} = require './datatypes'
MAX = 65535 # (1 << 16) - 1
JSON_COLUMN_ID = 'JSON_F52E2B61-18A1-11d1-B105-00805F49916B'

class Table
	constructor: (name) ->
		if name
			length = name.length
			cursor = -1
			buffer = ''
			escaped = false
			path = []
			
			while ++cursor < length
				char = name.charAt cursor
				if char is '['
					if escaped
						buffer += char
					
					else
						escaped = true
				
				else if char is ']'
					if escaped
						escaped = false
					
					else
						throw new Error "Invalid table name."
				
				else if char is '.'
					if escaped
						buffer += char
					
					else
						path.push buffer
						buffer = ''
				
				else
					buffer += char
			
			if buffer
				path.push buffer
			
			switch path.length
				when 1
					@name = path[0]
					@schema = null
					@database = null
				
				when 2
					@name = path[1]
					@schema = path[0]
					@database = null
				
				when 3
					@name = path[2]
					@schema = path[1]
					@database = path[0]

			@path = "#{if @database then "[#{@database}]." else ""}#{if @schema then "[#{@schema}]." else ""}[#{@name}]"
			@temporary = @name.charAt(0) is '#'
		
		@columns = []
		@rows = []
		
		Object.defineProperty @columns, "add",
			value: (name, column, options = {}) ->
				unless column? then throw new Error "Column data type is not defined."
				if column instanceof Function then column = column()
				column.name = name
				column.nullable = options.nullable
				@push column
				
		Object.defineProperty @rows, "add",
			value: (values...) ->
				@push values
	
	###
	@private
	###
	
	_makeBulk: ->
		for col in @columns
			switch col.type
				when TYPES.Xml then col.type = TYPES.NVarChar(MAX).type
				when TYPES.UDT, TYPES.Geography, TYPES.Geometry then col.type = TYPES.VarBinary(MAX).type

		@
	
	declare: ->
		"create table #{@path} (#{("[#{col.name}] #{declare col.type, col}#{if col.nullable is true then " null" else if col.nullable is false then " not null" else ""}" for col in @columns).join ', '})"

	@fromRecordset: (recordset) ->
		t = new @
		
		for name, col of recordset.columns
			t.columns.add name,
				type: col.type
				length: col.length
				scale: col.scale
				precision: col.precision
			,
				nullable: col.nullable

		if t.columns.length is 1 and t.columns[0].name is JSON_COLUMN_ID
			for row in recordset
				t.rows.add JSON.stringify row
			
		else
			for row in recordset
				t.rows.add (row[col.name] for col in t.columns)...
		
		t

module.exports = Table

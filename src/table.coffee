class Table
	constructor: ->
		@columns = []
		@rows = []
		
		Object.defineProperty @columns, "add",
			value: (name, column) ->
				if column instanceof Function then column = column()
				column.name = name
				@push column
				
		Object.defineProperty @rows, "add",
			value: (values...) ->
				@push values
	
	@fromRecordset: (recordset) ->
		t = new @
		
		for name, col of recordset.columns
			t.columns.add name,
				type: col.type
				length: col.length
				scale: col.scale
				precision: col.precision
		
		for row in recordset
			t.rows.add (row[col.name] for col in t.columns)...
		
		t

module.exports = Table
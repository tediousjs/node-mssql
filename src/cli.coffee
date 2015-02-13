fs = require 'fs'
path = require 'path'
sql = require './main'
write = (text) -> process.stdout.write text

Buffer::toJSON = -> "0x#{@toString 'hex'}"

# Resolve config path

cfgPath = process.argv[2]
if not cfgPath then cfgPath = process.cwd()
cfgPath = path.resolve cfgPath
if fs.lstatSync(cfgPath).isDirectory() then cfgPath = path.resolve cfgPath, './.mssql.json'
if not fs.existsSync cfgPath
	console.error "Config file not found."
	process.exit 1

# Config checks & parse

try
	config = fs.readFileSync cfgPath
catch ex
	console.error "Failed to load config file. #{ex.message}"
	process.exit 1
	
try
	config = JSON.parse config
catch ex
	console.error "Failed to parse config file. #{ex.message}"
	process.exit 1

# Read stdin

buffer = []

process.stdin.setEncoding 'utf8'
process.stdin.on 'readable', ->
	buffer.push process.stdin.read()

process.stdin.on 'end', ->
	statement = buffer.join ''
	rst = 0
	index = 0
	
	if not statement.length
		console.error "Statement is empty."
		process.exit 1
	
	sql.connect config, (err) ->
		if err
			console.error err.message
			process.exit 1
		
		write '['
		
		request = new sql.Request
		request.stream = true
		request.on 'recordset', (metadata) ->
			index = 0
			if rst++ > 0
				write '],'
			
			write '['
		
		request.on 'error', (err) ->
			console.error err.message
			sql.close()
			process.exit 1
		
		request.on 'row', (row) ->
			if index++ > 0
				write ','
				
			write JSON.stringify row
		
		request.on 'done', ->
			if rst > 0 then write ']'
			write ']\n'
			sql.close()
			process.exit 0
		
		request.query statement

process.on 'uncaughtException', (err) ->
	if err.code is 'EPIPE'
		console.error "Failed to pipe output stream."
	else
		console.error err.message
		
	process.exit 1
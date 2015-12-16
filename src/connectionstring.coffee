url = require 'url'
qs = require 'querystring'

IGNORE_KEYS = ['stream']

parseConnectionURI = (uri) ->
	parsed = url.parse uri
	
	path = parsed.pathname.substr(1).split '/'
	if path.length > 1
		instance = path.shift()
	
	if parsed.auth
		parsed.auth = parsed.auth.split ':'
		user = parsed.auth.shift()
		password = parsed.auth.join ':'
	
	object =
		server: "#{parsed.hostname}#{if parsed.port then ",#{parsed.port}" else if instance then "\\#{instance}" else ""}"
		uid: user or ''
		pwd: password or ''
		database: path[0]
	
	if parsed.query
		for key, value of qs.parse parsed.query
			if key is 'domain'
				object.uid = "#{value}\\#{object.uid}"
			
			else
				object[key] = value
	
	Object.defineProperty object, 'toString',
		value: -> ("#{key}={#{value}}" for key, value of @ when key not in IGNORE_KEYS).join ';'
	
	object

parseConnectionString = (string) ->
	cursor = 0
	parsing = 'name'
	param = null
	buffer = ''
	quotes = null
	parsed = {}
	original = {}
	
	Object.defineProperty parsed, '__original__',
		value: original
	
	Object.defineProperty parsed, 'toString',
		value: -> ("#{original[key].name}=#{original[key].escape?[0] ? ''}#{value}#{original[key].escape?[1] ? ''}" for key, value of @ when key not in IGNORE_KEYS).join ';'
	
	while cursor < string.length
		char = string.charAt cursor
		switch char
			when '='
				if parsing is 'name'
					buffer = buffer.trim()
					param = buffer.toLowerCase()
					original[param] = name: buffer
					parsing = 'value'
					buffer = ''
				
				else
					buffer += char
			
			when '\'', '"'
				if parsing is 'value'
					if not buffer.trim().length
						# value is wrapped in qotes
						original[param].escape = [char, char]
						quotes = char
						buffer = ''
					
					else
						if quotes
							if char is quotes
								# found same char as used for wrapping quotes
								if char is string.charAt cursor + 1
									# escaped quote
									buffer += char
									cursor++
								
								else
									# end of value
									parsed[param] = buffer
									param = null
									parsing = null
									buffer = ''
									quotes = null
							
							else
								buffer += char
						
						else
							buffer += char
				
				else
					throw new Error "Invalid connection string."
			
			when '{'
				if parsing is 'value'
					if not buffer.trim().length
						# value is wrapped in qotes
						original[param].escape = ['{', '}']
						quotes = '{}'
						buffer = ''
					
					else
						buffer += char
				
				else
					throw new Error "Invalid connection string."
			
			when '}'
				if parsing is 'value'
					if quotes is '{}'
						# end of value
						parsed[param] = buffer
						param = null
						parsing = null
						buffer = ''
						quotes = null
					
					else
						buffer += char
				
				else
					throw new Error "Invalid connection string."
			
			when ';'
				if parsing is 'value'
					if quotes
						buffer += char
					
					else
						# end of value
						parsed[param] = buffer
						param = null
						parsing = 'name'
						buffer = ''
				
				else
					buffer = ''
					parsing = 'name'
			
			else
				buffer += char
		
		cursor++
	
	if parsing is 'value'
		# end of value
		parsed[param] = buffer
	
	parsed

resolveConnectionString = (string) ->
	if (/^(mssql|tedious|msnodesql|tds)\:\/\//i).test string
		parsed = parseConnectionURI string
	else
		parsed = parseConnectionString string
	
	if parsed.driver is 'msnodesql'
		parsed.driver = 'SQL Server Native Client 11.0'
		parsed.__original__?.driver = name: 'Driver', escape: ['{', '}']
		return driver: 'msnodesql', connectionString: parsed.toString()
	
	user = parsed.uid ? parsed['user id']
	server = parsed.server ? parsed.address ? parsed.addr ? parsed['data source'] ? parsed['network address']
	
	config =
		driver: parsed.driver
		password: parsed.pwd ? parsed.password
		database: parsed.database ? parsed['initial catalog']
		connectionTimeout: parsed.timeout ? parsed['connect timeout'] ? parsed['connection timeout']
		requestTimeout: parsed['request timeout']
		stream: parsed.stream?.toLowerCase() in ['true', 'yes', '1']
		options:
			encrypt: parsed.encrypt?.toLowerCase() in ['true', 'yes', '1']
	
	if (/^(.*)\\(.*)$/).exec user
		config.domain = RegExp.$1
		user = RegExp.$2
	
	if server
		server = server.trim()
		
		if (/^np\:/i).test server
			throw new Error "Connection via Named Pipes is not supported."
		
		if (/^tcp\:/i).test server
			server = server.substr 4
			
		if (/^(.*)\\(.*)$/).exec server
			server = RegExp.$1
			config.options.instanceName = RegExp.$2
		
		if (/^(.*),(.*)$/).exec server
			server = RegExp.$1.trim()
			config.port = parseInt RegExp.$2.trim()
		
		if server.toLowerCase() in ['.', '(.)', '(localdb)', '(local)']
			server = 'localhost'
	
	config.user = user
	config.server = server
	config

module.exports =
	parse: parseConnectionString
	resolve: resolveConnectionString

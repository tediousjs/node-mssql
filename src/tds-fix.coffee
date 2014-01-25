try
	unless require('tds/package.json').version is '0.1.0' then return
	
	###
	Fixed typing error in UniqueIdentifier
	###
	
	require('tds/lib/tds-constants.js').TdsConstants.dataTypesByName.GUIDTYPE.sqlType = 'UniqueIdentifier'

catch ex
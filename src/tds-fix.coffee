try
	unless require('tds/package.json').version is '0.1.0' then return
	
	###
	Fixed typing error in UniqueIdentifier
	###
	
	require('tds/lib/tds-constants.js').TdsConstants.dataTypesByName.GUIDTYPE.sqlType = 'UniqueIdentifier'
	
	require('tds').Connection::setAutoCommit = `function(autoCommit, autoCommitCallback) {
    if (this._autoCommit === autoCommit) {
      return autoCommitCallback(); // <- fix here
    } else {
      if (this._currentStatement != null) {
        throw new Error('Cannot change auto commit while statement is executing');
      }
      this._pendingCallback = autoCommitCallback;
      this._currentStatement = '#setAutoCommit';
      if (autoCommit) {
        return this._client.sqlBatch('SET IMPLICIT_TRANSACTIONS OFF');
      } else {
        return this._client.sqlBatch('SET IMPLICIT_TRANSACTIONS ON');
      }
    }
  };`

catch ex
	console.log ex
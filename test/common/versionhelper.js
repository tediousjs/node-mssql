'use strict'

module.exports = {
  'getSQLServerVersion' (sql, done) {
    const req = new sql.Request()
    return req.query("select SERVERPROPERTY('productversion') as version").then(result => {
      return result.recordset[0].version
    }).catch(done)
  },

  'isSQLServer2016OrNewer' (sql, done) {
    return this.getSQLServerVersion(sql, done).then(version => {
      const majorVersion = parseInt(version)
      if (majorVersion >= 13) return true
      return false
    }).catch(done)
  },

  'isSQLServer2019OrNewer' (sql, done) {
    return this.getSQLServerVersion(sql, done).then(version => {
      const majorVersion = parseInt(version)
      if (majorVersion >= 15) return true
      return false
    }).catch(done)
  }
}

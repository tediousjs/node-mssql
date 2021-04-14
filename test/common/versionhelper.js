'use strict'

module.exports = {
  'getSQLServerVersion' (sql) {
    const req = new sql.Request()
    return req.query("select SERVERPROPERTY('productversion') as version").then(result => {
      return result.recordset[0].version
    })
  },

  'isSQLServer2016OrNewer' (sql) {
    return this.getSQLServerVersion(sql).then(version => {
      const majorVersion = parseInt(version)
      if (majorVersion >= 13) return true
      return false
    })
  },

  'isSQLServer2019OrNewer' (sql) {
    return this.getSQLServerVersion(sql).then(version => {
      const majorVersion = parseInt(version)
      if (majorVersion >= 15) return true
      return false
    })
  }
}

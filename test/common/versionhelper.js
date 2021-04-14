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
      return majorVersion >= 13
    })
  },

  'isSQLServer2019OrNewer' (sql) {
    return this.getSQLServerVersion(sql).then(version => {
      const majorVersion = parseInt(version)
      return majorVersion >= 15
    })
  }
}

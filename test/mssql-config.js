let config = null

try {
  config = require(`./.mssql.json`)
} catch (e) {
  config = require(`./.mssql-docker.json`)
}

module.exports = config

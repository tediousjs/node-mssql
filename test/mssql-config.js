let configOptions = null

try {
  configOptions = require(`./.mssql.json`)
} catch (e) {
  configOptions = require(`./.mssql-docker.json`)
}

function getConfig () {
  return Object.assign({
    driver: 'tedious'
  }, configOptions)
}

module.exports = getConfig

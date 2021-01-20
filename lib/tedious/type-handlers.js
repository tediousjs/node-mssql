const valueHandlers = {}

const registerValueHandler = function (type, handler) {
  if (valueHandlers[type]) {
    throw new Error('there is already a value handler for: ' + type)
  }

  valueHandlers[type] = handler
}

const getValueHandler = function (type) {
  return valueHandlers[type]
}

module.exports = {
  registerValueHandler,
  getValueHandler
}

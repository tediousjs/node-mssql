const valueHandlers = {}

export const registerValueHandler = function (type, handler) {
  if (valueHandlers[type]) {
    throw new Error('there is already a value handler for: ' + type)
  }

  valueHandlers[type] = handler
}

export const getValueHandler = function (type) {
  return valueHandlers[type]
}

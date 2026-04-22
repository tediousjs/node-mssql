'use strict'

const IDS = new WeakMap()
const INCREMENT = {
  Connection: 1,
  ConnectionPool: 1,
  Request: 1,
  Transaction: 1,
  PreparedStatement: 1
}

const getPoolId = (obj) => {
  let parent = obj && obj.parent
  while (parent && !parent.pool) {
    parent = parent.parent
  }
  return parent ? IDS.get(parent) : undefined
}

module.exports = {
  objectHasProperty: (object, property) => Object.prototype.hasOwnProperty.call(object, property),
  INCREMENT,
  IDS: {
    get: IDS.get.bind(IDS),
    add: (object, type, id) => {
      if (id) return IDS.set(object, id)
      IDS.set(object, INCREMENT[type]++)
    }
  },
  getPoolId
}

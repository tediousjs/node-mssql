'use strict'

var assert = require('assert')

module.exports = (sql, driver) => {
  return {
    'query' (done) {
      sql.query`select getdate() as date\n\n, ${1337} as num, ${true} as bool`.then(result => {
        assert.ok(result.recordset[0].date instanceof Date)
        assert.strictEqual(result.recordset[0].num, 1337)
        assert.strictEqual(result.recordset[0].bool, true)

        done()
      }).catch(done)
    },

    'batch' (done) {
      sql.batch`select newid() as uid`.then(result => {
        assert.strictEqual(result.recordset.columns.uid.type, sql.UniqueIdentifier)

        done()
      }).catch(done)
    }
  }
}

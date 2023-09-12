'use strict'

const assert = require('node:assert')

module.exports = (sql, driver) => {
  return {
    'time' (utc, done) {
      const req = new sql.Request()
      req.query("declare @t time(1) = null;select convert(time(0), '23:59:59.999999999') as t1, convert(time(4), '23:59:59.999999999') as t2, convert(time(7), '23:59:59.999999999') as t3, @t as t4").then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].t1, new Date(Date.UTC(1970, 0, 1, 23, 59, 59)).getTime())
          assert.strictEqual(+result.recordset[0].t2, new Date(Date.UTC(1970, 0, 1, 23, 59, 59, 999)).getTime())
          assert.strictEqual(+result.recordset[0].t3, new Date(Date.UTC(1970, 0, 1, 23, 59, 59, 999)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].t1, new Date(1970, 0, 1, 23, 59, 59).getTime())
          assert.strictEqual(+result.recordset[0].t2, new Date(1970, 0, 1, 23, 59, 59, 999).getTime())
          assert.strictEqual(+result.recordset[0].t3, new Date(1970, 0, 1, 23, 59, 59, 999).getTime())
        }

        assert.strictEqual(result.recordset[0].t4, null)
        assert.strictEqual(result.recordset[0].t1.nanosecondsDelta, 0)
        assert.strictEqual(result.recordset[0].t2.nanosecondsDelta, 0.0009)
        assert.strictEqual(result.recordset[0].t3.nanosecondsDelta, 0.0009999)

        if (driver === 'tedious') {
          assert.strictEqual(result.recordset.columns.t1.scale, 0)
          assert.strictEqual(result.recordset.columns.t2.scale, 4)
          assert.strictEqual(result.recordset.columns.t3.scale, 7)
          assert.strictEqual(result.recordset.columns.t4.scale, 1)
        }

        done()
      }).catch(done)
    },

    'time as parameter' (utc, done) {
      let time
      if (utc) {
        time = new Date(Date.UTC(2014, 0, 1, 23, 59, 59, 999))
      } else {
        time = new Date(2014, 0, 1, 23, 59, 59, 999)
      }

      time.nanosecondDelta = 0.0009999

      const req = new sql.Request()
      req.input('t1', sql.Time, time)
      req.input('t2', sql.Time, null)
      req.query('select @t1 as t1, @t2 as t2, convert(varchar, @t1, 126) as t3').then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].t1, new Date(Date.UTC(1970, 0, 1, 23, 59, 59, 999)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].t1, new Date(1970, 0, 1, 23, 59, 59, 999).getTime())
        }

        assert.strictEqual(result.recordset[0].t2, null)

        if (driver === 'tedious') {
          assert.strictEqual(result.recordset[0].t3, '23:59:59.9999999')
          assert.strictEqual(result.recordset[0].t1.nanosecondsDelta, 0.0009999) // msnodesql cant pass nanoseconds
          assert.strictEqual(result.recordset.columns.t1.scale, 7)
        }

        done()
      }).catch(done)
    },

    'date' (utc, done) {
      const req = new sql.Request()
      req.query("select convert(date, '2014-01-01') as d1").then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].d1, new Date(Date.UTC(2014, 0, 1)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].d1, new Date(2014, 0, 1).getTime())
        }

        done()
      }).catch(done)
    },

    'date as parameter' (utc, done) {
      let date
      if (utc) {
        date = new Date(Date.UTC(2014, 1, 14))
      } else {
        date = new Date(2014, 1, 14)
      }

      const req = new sql.Request()
      req.input('d1', sql.Date, date)
      req.input('d2', sql.Date, null)
      req.query('select @d1 as d1, @d2 as d2, convert(varchar, @d1, 126) as d3').then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].d1, new Date(Date.UTC(2014, 1, 14)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].d1, new Date(2014, 1, 14).getTime())
        }

        assert.strictEqual(result.recordset[0].d2, null)
        assert.strictEqual(result.recordset[0].d3, '2014-02-14')

        done()
      }).catch(done)
    },

    'datetime' (utc, done) {
      const req = new sql.Request()
      req.query("select convert(datetime, '2014-02-14 22:59:59') as dt1").then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].dt1, new Date(Date.UTC(2014, 1, 14, 22, 59, 59)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].dt1, new Date(2014, 1, 14, 22, 59, 59).getTime())
        }

        done()
      }).catch(done)
    },

    'datetime as parameter' (utc, done) {
      const date = new Date(Date.UTC(2014, 1, 14, 22, 59, 59))

      const req = new sql.Request()
      req.input('dt1', sql.DateTime, date)
      req.input('dt2', sql.DateTime, null)
      req.query('select @dt1 as dt1, @dt2 as dt2').then(result => {
        assert.strictEqual(+result.recordset[0].dt1, date.getTime())
        assert.strictEqual(result.recordset[0].dt2, null)

        done()
      }).catch(done)
    },

    'datetime2' (utc, done) {
      const req = new sql.Request()
      req.query("select convert(datetime2(7), '1111-02-14 22:59:59.9999999') as dt1").then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].dt1, new Date(Date.UTC(1111, 1, 14, 22, 59, 59, 999)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].dt1, new Date(1111, 1, 14, 22, 59, 59, 999).getTime())
        }

        assert.strictEqual(result.recordset[0].dt1.nanosecondsDelta, 0.0009999)

        if (driver === 'tedious') {
          assert.strictEqual(result.recordset.columns.dt1.scale, 7)
        }

        done()
      }).catch(done)
    },

    'datetime2 as parameter' (utc, done) {
      const date = new Date(2014, 1, 14, 22, 59, 59, 999)
      date.nanosecondDelta = 0.0009999

      const req = new sql.Request()
      req.input('dt1', sql.DateTime2, date)
      req.input('dt2', sql.DateTime2, null)
      req.query('select @dt1 as dt1, @dt2 as dt2, convert(varchar, @dt1, 126) as dt3').then(result => {
        assert.strictEqual(+result.recordset[0].dt1, date.getTime())
        assert.strictEqual(result.recordset[0].dt2, null)

        if (driver === 'tedious') {
          assert.strictEqual(result.recordset[0].dt1.nanosecondsDelta, 0.0009999) // msnodesql cant pass nanoseconds
          assert.strictEqual(result.recordset.columns.dt1.scale, 7)

          if (utc) {
            assert.strictEqual(result.recordset[0].dt3, date.toISOString().replace('Z', 9999))
          } else {
            assert.strictEqual(result.recordset[0].dt3, '2014-02-14T22:59:59.9999999')
          }
        }

        done()
      }).catch(done)
    },

    'datetimeoffset' (utc, done) {
      const req = new sql.Request()
      req.query("select convert(datetimeoffset(7), '2014-02-14 22:59:59.9999999 +05:00') as dto1, convert(datetimeoffset(7), '2014-02-14 17:59:59.9999999 +00:00') as dto2").then(result => {
        // console.log result.recordset[0]
        // console.log new Date(Date.UTC(2014, 1, 14, 22, 59, 59, 999))

        assert.strictEqual(+result.recordset[0].dto1, new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999)).getTime())
        assert.strictEqual(+result.recordset[0].dto2, new Date(Date.UTC(2014, 1, 14, 17, 59, 59, 999)).getTime())
        assert.strictEqual(result.recordset[0].dto1.nanosecondsDelta, 0.0009999) // msnodesql cant pass nanoseconds

        if (driver === 'tedious') {
          assert.strictEqual(result.recordset.columns.dto1.scale, 7)
          assert.strictEqual(result.recordset.columns.dto2.scale, 7)
        }

        done()
      }).catch(done)
    },

    'datetimeoffset as parameter' (utc, done) {
      const req = new sql.Request()
      req.input('dto1', sql.DateTimeOffset, new Date(2014, 1, 14, 11, 59, 59))
      req.input('dto2', sql.DateTimeOffset, new Date(Date.UTC(2014, 1, 14, 11, 59, 59)))
      req.input('dto3', sql.DateTimeOffset, null)
      req.query('select @dto1 as dto1, @dto2 as dto2, @dto3 as dto3').then(result => {
        assert.strictEqual(+result.recordset[0].dto1, new Date(2014, 1, 14, 11, 59, 59).getTime())
        assert.strictEqual(+result.recordset[0].dto2, new Date(Date.UTC(2014, 1, 14, 11, 59, 59)).getTime())
        assert.strictEqual(result.recordset[0].dto3, null)

        if (driver === 'tedious') {
          assert.strictEqual(result.recordset.columns.dto1.scale, 7)
        }

        done()
      }).catch(done)
    },

    'smalldatetime' (utc, done) {
      const req = new sql.Request()
      req.query("select convert(datetime, '2014-02-14 22:59:59') as dt1").then(result => {
        if (utc) {
          assert.strictEqual(+result.recordset[0].dt1, new Date(Date.UTC(2014, 1, 14, 22, 59, 59)).getTime())
        } else {
          assert.strictEqual(+result.recordset[0].dt1, new Date(2014, 1, 14, 22, 59, 59).getTime())
        }

        done()
      }).catch(done)
    },

    'smalldatetime as parameter' (utc, done) {
      const date = new Date(2014, 1, 14, 22, 59)

      const req = new sql.Request()
      req.input('dt1', sql.SmallDateTime, date)
      req.input('dt2', sql.SmallDateTime, null)
      req.query('select @dt1 as dt1, @dt2 as dt2').then(result => {
        assert.strictEqual(+result.recordset[0].dt1, date.getTime())
        assert.strictEqual(result.recordset[0].dt2, null)

        done()
      }).catch(done)
    }
  }
}

'use strict'

/* globals describe, it */

const assert = require('assert')
const { join } = require('path')

describe.skip('cli', function () {
  it('should stream statement result', function (done) {
    const buffer = []
    const proc = require('child_process').spawn(join(__dirname, '../../bin/mssql'), ['.'], { cwd: join(__dirname, '..') })
    proc.stdin.end('select 1 as xxx')
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', data => buffer.push(data))

    return proc.on('close', function (code) {
      assert.strictEqual(code, 0)
      assert.strictEqual('[[{"xxx":1}]]\n', buffer.join(''))
      return done()
    })
  })

  return it('should fail', function (done) {
    const buffer = []
    const proc = require('child_process').spawn(join(__dirname, '../../bin/mssql'), ['..'], { cwd: join(__dirname, '..') })
    proc.stdin.end('select 1 as xxx')
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', data => buffer.push(data))

    return proc.on('close', function (code) {
      assert.strictEqual(code, 1)
      assert.strictEqual('Config file not found.\n', buffer.join(''))
      return done()
    })
  })
})

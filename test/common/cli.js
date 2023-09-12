'use strict'

/* globals describe, it */

const assert = require('node:assert')
const { join } = require('node:path')
const { spawn } = require('child_process')

const config = function () {
  const cfg = JSON.parse(require('node:fs').readFileSync(join(__dirname, '../.mssql.json')))
  cfg.driver = 'tedious'
  return cfg
}

function quote (string) {
  return `"${string}"`
}

function cli (args, cwd) {
  const isWin = process.platform === 'win32'
  let program = join(__dirname, '../../bin/mssql')
  if (isWin) {
    args.unshift(program)
    program = quote(process.argv0)
  }
  return spawn(program, isWin ? args.map(quote) : args, { cwd, stdio: 'pipe', shell: isWin })
}

describe('cli', function () {
  it('should stream statement result', (done) => {
    const buffer = []
    const proc = cli(['.'], join(__dirname, '..'))
    proc.stdin.end('select 1 as xxx')
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', data => buffer.push(data))

    proc.on('close', function (code) {
      assert.strictEqual(code, 0)
      assert.strictEqual('[[{"xxx":1}]]\n', buffer.join(''))
      done()
    })
  })

  it('fails with no config file', (done) => {
    const buffer = []
    const proc = cli(['..'], join(__dirname, '..'))
    proc.stdin.end('select 1 as xxx')
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', data => buffer.push(data))

    proc.on('close', function (code) {
      assert.strictEqual(code, 1)
      done()
    })
  })

  it('accepts arguments when there is no mssql config file', (done) => {
    const cfg = config()
    const args = []
    if (cfg.user) {
      args.push('--user', cfg.user)
    }
    if (cfg.password) {
      args.push('--password', cfg.password)
    }
    if (cfg.server) {
      args.push('--server', cfg.server)
    }
    if (cfg.database) {
      args.push('--database', cfg.database)
    }
    if (cfg.port) {
      args.push('--port', cfg.port)
    }
    if (cfg.options.encrypt) {
      args.push('--encrypt')
    }
    if (cfg.options.trustServerCertificate) {
      args.push('--trust-server-certificate')
    }
    args.push('..')
    const buffer = []
    const proc = cli(args, join(__dirname, '..'))
    proc.stdin.end('select 1 as xxx')
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', data => buffer.push(data))

    proc.on('close', function (code) {
      assert.strictEqual(code, 0)
      assert.strictEqual('[[{"xxx":1}]]\n', buffer.join(''))
      done()
    })
  })
})

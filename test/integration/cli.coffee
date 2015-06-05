sql = require '../../'
assert = require 'assert'

describe 'cli', ->
	it 'should stream statement result', (done) ->
		buffer = []
		proc = require('child_process').spawn "#{__dirname}/../../bin/mssql", ['.'], {cwd: "#{__dirname}/.."}
		proc.stdin.end "select 1 as xxx"
		proc.stdout.setEncoding 'utf8'
		proc.stdout.on 'data', (data) ->
			buffer.push data
			
		proc.on 'close', (code) ->
			assert.equal code, 0
			assert.equal '[[{"xxx":1}]]\n', buffer.join ''
			done()

	it 'should fail', (done) ->
		buffer = []
		proc = require('child_process').spawn "#{__dirname}/../../bin/mssql", ['..'], {cwd: "#{__dirname}/.."}
		proc.stdin.end "select 1 as xxx"
		proc.stderr.setEncoding 'utf8'
		proc.stderr.on 'data', (data) ->
			buffer.push data
			
		proc.on 'close', (code) ->
			assert.equal code, 1
			assert.equal 'Config file not found.\n', buffer.join ''
			done()
'use strict'

const sql = require('../../');
const assert = require('assert');

describe.skip('cli', function() {
	it('should stream statement result', function(done) {
		let buffer = [];
		let proc = require('child_process').spawn(`${__dirname}/../../bin/mssql`, ['.'], {cwd: `${__dirname}/..`});
		proc.stdin.end("select 1 as xxx");
		proc.stdout.setEncoding('utf8');
		proc.stdout.on('data', data => buffer.push(data));
			
		return proc.on('close', function(code) {
			assert.equal(code, 0);
			assert.equal('[[{"xxx":1}]]\n', buffer.join(''));
			return done();
		});
	});

	return it('should fail', function(done) {
		let buffer = [];
		let proc = require('child_process').spawn(`${__dirname}/../../bin/mssql`, ['..'], {cwd: `${__dirname}/..`});
		proc.stdin.end("select 1 as xxx");
		proc.stderr.setEncoding('utf8');
		proc.stderr.on('data', data => buffer.push(data));
			
		return proc.on('close', function(code) {
			assert.equal(code, 1);
			assert.equal('Config file not found.\n', buffer.join(''));
			return done();
		});
	});
});
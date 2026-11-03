'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const manager = require('../lib/supplier-manager.js');
test('supplier manager exposes read-only methods', () => { assert.equal(typeof manager.getStatuses, 'function'); assert.equal(typeof manager.getCatalog, 'function'); });

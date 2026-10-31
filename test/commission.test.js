'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const commission = require('../commission.js');

test('global default commission is 2 percent', () => {
  assert.equal(commission.resolvePercent({ countryCode: 'DZ' }), 2);
  assert.equal(commission.resolvePercent({ countryCode: 'FR' }), 2);
  assert.equal(commission.resolvePercent({ countryCode: 'JP' }), 2);
});

test('1000 base amount adds 20 and totals 1020', () => {
  assert.deepEqual(commission.calculate(1000, { countryCode: 'DZ' }), {
    basePrice: 1000,
    commissionPercent: 2,
    commissionAmount: 20,
    finalPrice: 1020
  });
});

test('country override takes precedence over global default', () => {
  const rules = {
    defaultPercent: 2,
    countryPercent: { FR: 1 },
    merchantPercent: {},
    merchantCountryPercent: {}
  };
  assert.equal(commission.resolvePercent({ countryCode: 'FR', rules }), 1);
  assert.equal(commission.calculate(1000, { countryCode: 'FR', rules }).finalPrice, 1010);
});

test('merchant-country override takes precedence over merchant and country rates', () => {
  const rules = {
    defaultPercent: 2,
    countryPercent: { DZ: 2 },
    merchantPercent: { shopA: 1.5 },
    merchantCountryPercent: { 'shopA:DZ': 1 }
  };
  assert.equal(commission.resolvePercent({ countryCode: 'DZ', merchantId: 'shopA', rules }), 1);
  assert.equal(commission.resolvePercent({ countryCode: 'FR', merchantId: 'shopA', rules }), 1.5);
});

test('invalid country code falls back to the global default', () => {
  assert.equal(commission.resolvePercent({ countryCode: 'DZA' }), 2);
});

test('invalid base prices are rejected', () => {
  assert.throws(() => commission.calculate(-1, { countryCode: 'DZ' }), TypeError);
});

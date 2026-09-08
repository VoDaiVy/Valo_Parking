const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePhone, getPhoneRegex, getPhoneVariants, getPhoneSearchConditions } = require('../utils/phoneUtils');

test('normalizePhone handles various Vietnam phone formats', () => {
  assert.equal(normalizePhone('0905414132'), '0905414132');
  assert.equal(normalizePhone('+84905414132'), '0905414132');
  assert.equal(normalizePhone('84905414132'), '0905414132');
  assert.equal(normalizePhone(' 090 541 4132 '), '0905414132');
  assert.equal(normalizePhone('+84 905 414 132'), '0905414132');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(''), '');
});

test('getPhoneVariants generates all database query match variants', () => {
  const variantsFromZero = getPhoneVariants('0905414132');
  assert.ok(variantsFromZero.includes('0905414132'));
  assert.ok(variantsFromZero.includes('+84905414132'));
  assert.ok(variantsFromZero.includes('84905414132'));
  assert.ok(variantsFromZero.includes('905414132'));

  const variantsFromPlus84 = getPhoneVariants('+84905414132');
  assert.ok(variantsFromPlus84.includes('0905414132'));
  assert.ok(variantsFromPlus84.includes('+84905414132'));
  assert.ok(variantsFromPlus84.includes('84905414132'));

  const variantsFromSpaced = getPhoneVariants('090 541 4132');
  assert.ok(variantsFromSpaced.includes('0905414132'));
  assert.ok(variantsFromSpaced.includes('+84905414132'));
});

test('getPhoneRegex matches various real-world phone formats', () => {
  const regex = getPhoneRegex('0905414132');
  assert.ok(regex.test('0905414132'));
  assert.ok(regex.test('+84905414132'));
  assert.ok(regex.test('84905414132'));
  assert.ok(regex.test('905414132'));
  assert.ok(regex.test('090 541 4132'));
  assert.ok(regex.test('090-541-4132'));
  assert.ok(regex.test('+84 905 414 132'));
});

test('getPhoneSearchConditions returns query conditions with variants and regex', () => {
  const conditions = getPhoneSearchConditions('0905414132');
  assert.ok(conditions.length >= 2);
  assert.ok(conditions.some(c => c.phone && c.phone.$in));
  assert.ok(conditions.some(c => c.phone instanceof RegExp));
});

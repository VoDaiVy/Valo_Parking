const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePhone, getPhoneVariants } = require('../utils/phoneUtils');

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

  const variantsFromPlus84 = getPhoneVariants('+84905414132');
  assert.ok(variantsFromPlus84.includes('0905414132'));
  assert.ok(variantsFromPlus84.includes('+84905414132'));
  assert.ok(variantsFromPlus84.includes('84905414132'));

  const variantsFromSpaced = getPhoneVariants('090 541 4132');
  assert.ok(variantsFromSpaced.includes('0905414132'));
  assert.ok(variantsFromSpaced.includes('+84905414132'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidLicensePlate, normalizeLicensePlate } from './licensePlate.js';

test('customer car plate validation accepts supported formats', () => {
  for (const plate of ['43A12345', '43A-123.45', '30H99911', '29LD12345', '51F1234']) {
    assert.equal(isValidLicensePlate(plate), true, plate);
  }
});

test('customer car plate validation rejects motorcycle-shaped and malformed values', () => {
  for (const plate of ['81A123456', '81A1-234.56', '43A123', '43A123456', '0A12345', 'ABC12345', '43-12345']) {
    assert.equal(isValidLicensePlate(plate), false, plate);
  }
  assert.equal(normalizeLicensePlate('43A-123.45'), '43A12345');
});

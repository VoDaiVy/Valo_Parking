const test = require('node:test');
const assert = require('node:assert/strict');
const { compareRegistrationCard } = require('../services/registrationCardVerificationService');

const vehicle = {
  licensePlate: '51H12345', brand: 'Toyota', model: 'Vios', color: 'Trang',
};
const card = {
  isRegistrationCard: true,
  licensePlate: '51H-123.45', brand: 'TOYOTA', model: 'VIOS', colorText: 'Tr\u1eafng',
};

test('approves only a complete matching registration card', () => {
  assert.deepEqual(compareRegistrationCard(card, vehicle), { matched: true, mismatches: [] });
});

test('sends mismatched or unreadable fields for manual review', () => {
  assert.deepEqual(compareRegistrationCard({ ...card, licensePlate: '51H99999', model: null }, vehicle), {
    matched: false, mismatches: ['licensePlate', 'model'],
  });
  assert.deepEqual(compareRegistrationCard(card, { ...vehicle, color: '' }), {
    matched: false, mismatches: ['colorText'],
  });
});

test('rejects an image not identified as a registration card', () => {
  assert.deepEqual(compareRegistrationCard({ ...card, isRegistrationCard: false }, vehicle), {
    matched: false, mismatches: ['document'],
  });
});

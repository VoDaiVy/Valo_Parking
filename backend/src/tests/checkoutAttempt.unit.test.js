const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../config/payos') return { paymentRequests: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { verifyProviderPayment } = require('../services/checkoutAttemptService');
Module._load = originalLoad;
test('checkout payment must match server order and exact amount paid', () => {
  const attempt = { orderCode: 1234, amountDue: 30000 };
  const paid = { orderCode: 1234, status: 'PAID', amount: 30000, amountPaid: 30000, amountRemaining: 0 };
  assert.doesNotThrow(() => verifyProviderPayment(attempt, paid));
  for (const provider of [null, { ...paid, status: 'PENDING' }, { ...paid, orderCode: 5678 }, { ...paid, amount: 1000 }, { ...paid, amountPaid: 0 }, { ...paid, amountRemaining: 1000 }, { isPaid: true }]) assert.throws(() => verifyProviderPayment(attempt, provider), { statusCode: 402 });
});

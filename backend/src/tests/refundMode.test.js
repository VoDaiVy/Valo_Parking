const test = require('node:test');
const assert = require('node:assert/strict');
const { getRefundEngineMode } = require('../services/bookingRefundService');

test('refund engine mode defaults to active policy and accepts rollout modes', () => {
  const original = process.env.REFUND_ENGINE_MODE;

  try {
    delete process.env.REFUND_ENGINE_MODE;
    assert.equal(getRefundEngineMode(), 'active');

    process.env.REFUND_ENGINE_MODE = 'LEGACY';
    assert.equal(getRefundEngineMode(), 'legacy');

    process.env.REFUND_ENGINE_MODE = 'shadow';
    assert.equal(getRefundEngineMode(), 'shadow');

    process.env.REFUND_ENGINE_MODE = 'invalid-value';
    assert.equal(getRefundEngineMode(), 'active');
  } finally {
    if (original === undefined) {
      delete process.env.REFUND_ENGINE_MODE;
    } else {
      process.env.REFUND_ENGINE_MODE = original;
    }
  }
});

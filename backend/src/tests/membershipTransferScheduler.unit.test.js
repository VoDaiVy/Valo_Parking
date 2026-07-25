const test = require('node:test');
const assert = require('node:assert/strict');

const transferService = require('../services/membershipEntitlementTransferService');
const scheduler = require('../services/parkingScheduler');

test('membership transfer hold cleanup delegates to the transfer expiry service', async () => {
  const original = transferService.releaseExpiredTransferLocks;
  let receivedNow = null;
  transferService.releaseExpiredTransferLocks = async (now) => {
    receivedNow = now;
    return 1;
  };
  try {
    await scheduler.checkExpiredMembershipTransfers();
    assert.ok(receivedNow instanceof Date);
  } finally {
    transferService.releaseExpiredTransferLocks = original;
  }
});


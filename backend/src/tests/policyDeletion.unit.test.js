const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Policy = require('../models/Policy');
const PolicyVersion = require('../models/PolicyVersion');
const PolicyAcceptance = require('../models/PolicyAcceptance');
const RefundRuleVersion = require('../models/RefundRuleVersion');
const policyService = require('../services/policyService');

test('permanently deleting a policy removes all dependent policy records in one transaction', async () => {
  const policyId = '507f1f77bcf86cd799439011';
  const calls = [];
  const session = {
    withTransaction: async (work) => {
      calls.push('transaction:start');
      await work();
      calls.push('transaction:commit');
    },
    endSession: async () => {
      calls.push('session:end');
    },
  };
  const originals = {
    startSession: mongoose.startSession,
    findOne: Policy.findOne,
    policyDeleteOne: Policy.deleteOne,
    versionDeleteMany: PolicyVersion.deleteMany,
    acceptanceDeleteMany: PolicyAcceptance.deleteMany,
    refundDeleteMany: RefundRuleVersion.deleteMany,
  };

  mongoose.startSession = async () => session;
  Policy.findOne = (filter) => ({
    session: (receivedSession) => {
      assert.equal(receivedSession, session);
      return {
        lean: async () => ({ _id: filter._id, title: 'Test policy' }),
      };
    },
  });
  PolicyAcceptance.deleteMany = async (filter, options) => {
    assert.deepEqual(filter, { policyId });
    assert.equal(options.session, session);
    calls.push('acceptances:delete');
  };
  RefundRuleVersion.deleteMany = async (filter, options) => {
    assert.deepEqual(filter, { policyId });
    assert.equal(options.session, session);
    calls.push('refund-rules:delete');
  };
  PolicyVersion.deleteMany = async (filter, options) => {
    assert.deepEqual(filter, { policyId });
    assert.equal(options.session, session);
    calls.push('versions:delete');
  };
  Policy.deleteOne = async (filter, options) => {
    assert.deepEqual(filter, { _id: policyId });
    assert.equal(options.session, session);
    calls.push('policy:delete');
    return { deletedCount: 1 };
  };

  try {
    const deleted = await policyService.deletePolicyPermanently(policyId);

    assert.equal(deleted.title, 'Test policy');
    assert.ok(calls.includes('acceptances:delete'));
    assert.ok(calls.includes('refund-rules:delete'));
    assert.ok(calls.includes('versions:delete'));
    assert.ok(calls.indexOf('policy:delete') > calls.indexOf('acceptances:delete'));
    assert.ok(calls.indexOf('transaction:commit') > calls.indexOf('policy:delete'));
    assert.equal(calls.at(-1), 'session:end');
  } finally {
    mongoose.startSession = originals.startSession;
    Policy.findOne = originals.findOne;
    Policy.deleteOne = originals.policyDeleteOne;
    PolicyVersion.deleteMany = originals.versionDeleteMany;
    PolicyAcceptance.deleteMany = originals.acceptanceDeleteMany;
    RefundRuleVersion.deleteMany = originals.refundDeleteMany;
  }
});

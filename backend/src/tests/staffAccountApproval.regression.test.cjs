const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Draft = require('../models/AIDraft');
const Audit = require('../models/AIAuditLog');
const writes = require('../services/adminCatalogWriteService');
const { approveDraft } = require('../services/aiCopilot/draftService');
const actorId = '6a1809f444b0febec5648a40', targetId = '6a17bf45f57436ad72e17852', draftId = '6af16cc9332d35fb91e70799';
const query = value => { const q = { select: () => q, session: () => q, lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) }; return q; };

async function isolated(run) {
  const originals = [User.findById, User.findOneAndUpdate, Draft.findOne, Draft.findOneAndUpdate, Draft.updateOne, Audit.create, mongoose.startSession, writes.updateUserStatusSafely, writes.updateUserProfileSafely];
  let state = { actor: { _id: actorId, role: 'staff', status: true }, target: { _id: targetId, role: 'customer', status: true }, draft: { _id: draftId, adminUserId: actorId, targetId, type: 'UPDATE_USER_STATUS', payload: { status: false }, current: { status: true }, status: 'PENDING', expiresAt: new Date(Date.now() + 60000) }, audits: [] };
  const flags = { revoked: false, unsupported: false, auditFailure: false, wrongResult: false, claimRace: false };
  let targetWrites = 0, sessions = 0;
  const session = { async withTransaction(callback) { if (flags.unsupported) throw new Error('Transaction numbers are only allowed on a replica set'); const before = structuredClone(state); try { await callback(); } catch (error) { state = before; throw error; } }, async endSession() {} };
  User.findById = id => query(String(id) === actorId ? state.actor : String(id) === targetId ? state.target : null);
  User.findOneAndUpdate = async (filter, update, options) => { assert.equal(options.session, session); if (filter._id) { assert.equal(filter.role, 'staff'); assert.equal(filter.status, true); return flags.revoked ? null : state.actor; } return { role: 'admin' }; };
  Draft.findOne = filter => query(String(filter._id) === draftId && String(filter.adminUserId) === actorId ? state.draft : null);
  Draft.findOneAndUpdate = async (filter, update, options) => {
    assert.equal(options.session, session); assert.equal(filter.adminUserId, actorId); assert.equal(filter.status, 'PENDING');
    if (flags.claimRace) { state.draft.status = 'EXECUTED'; state.draft.executionResult = { id: targetId, type: 'UPDATE_USER_STATUS', status: 'EXECUTED' }; return null; }
    if (state.draft.status !== 'PENDING') return null;
    Object.assign(state.draft, update.$set); return state.draft;
  };
  Draft.updateOne = async (filter, update, options) => { assert.equal(options.session, session); assert.equal(filter.status, 'EXECUTING'); Object.assign(state.draft, update.$set); return { modifiedCount: 1 }; };
  Audit.create = async (rows, options) => { assert.equal(options.session, session); if (flags.auditFailure) throw new Error('Audit unavailable'); state.audits.push(...rows); };
  mongoose.startSession = async () => { sessions += 1; return session; };
  writes.updateUserStatusSafely = async (id, status, options) => {
    assert.equal(id, targetId); assert.equal(options.session, session); assert.equal(options.adminId, actorId);
    if (state.target.status !== options.expectedStatus) throw Object.assign(new Error('Account changed'), { statusCode: 409 });
    targetWrites += 1; state.target.status = status;
    return flags.wrongResult ? { ...state.target, status: !status } : state.target;
  };
  writes.updateUserProfileSafely = async (id, payload, options) => {
    assert.equal(id, targetId); assert.equal(options.session, session); assert.equal(options.adminId, actorId);
    assert.deepEqual(Object.keys(payload).sort(), ['firstName', 'phone']);
    targetWrites += 1; state.target.profile = { ...state.target.profile, ...payload };
    return { userId: id };
  };
  try { await run({ get state() { return state; }, flags, get targetWrites() { return targetWrites; }, get sessions() { return sessions; } }); }
  finally { [User.findById, User.findOneAndUpdate, Draft.findOne, Draft.findOneAndUpdate, Draft.updateOne, Audit.create, mongoose.startSession, writes.updateUserStatusSafely, writes.updateUserProfileSafely] = originals; }
}

test('Staff profile approval uses the same transaction, customer fence, delta whitelist, result and audit contract', async () => isolated(async context => {
  context.state.draft.type = 'UPDATE_USER_PROFILE';
  context.state.draft.payload = { firstName: 'Linh', phone: '0901234567', role: 'admin', email: 'ignored@example.test' };
  const result = await approveDraft(draftId, actorId, 'staff');
  assert.equal(result.status, 'EXECUTED'); assert.equal(result.type, 'UPDATE_USER_PROFILE'); assert.equal(result.id, targetId);
  assert.equal(context.state.target.role, 'customer'); assert.equal(context.state.target.status, true);
  assert.deepEqual(context.state.target.profile, { firstName: 'Linh', phone: '0901234567' });
  assert.equal(context.state.audits[0].action, 'DRAFT_EXECUTED');
  await approveDraft(draftId, actorId, 'staff'); assert.equal(context.targetWrites, 1);
}));

test('Staff uses the transactional account flow; confirmed result, persisted draft and audit agree; replay never blocks twice', async () => isolated(async context => {
  const result = await approveDraft(draftId, actorId, 'staff');
  assert.deepEqual(result, { id: targetId, type: 'UPDATE_USER_STATUS', status: 'EXECUTED', accountStatus: false });
  assert.equal(context.state.target.status, false); assert.equal(context.state.draft.status, 'EXECUTED');
  assert.deepEqual(context.state.draft.executionResult, result);
  assert.equal(context.state.audits[0].action, 'DRAFT_EXECUTED'); assert.equal(context.state.audits[0].actorId, actorId);
  const replay = await approveDraft(draftId, actorId, 'staff');
  assert.equal(replay.alreadyApplied, true); assert.equal(replay.status, 'EXECUTED');
  assert.equal(context.targetWrites, 1); assert.equal(context.sessions, 1); assert.equal(context.state.audits.length, 1);
}));
test('Staff cannot approve other actors, non-customers, self changes, revoked actors, or role drafts', async () => {
  const attempts = [
    c => { c.state.actor.status = false; },
    c => { c.state.actor.role = 'customer'; },
    c => { c.state.target.role = 'staff'; },
    c => { c.state.draft.targetId = actorId; },
    c => { c.state.draft.type = 'CHANGE_USER_ROLE'; },
    c => { c.flags.revoked = true; },
  ];
  for (const setup of attempts) await isolated(async context => { setup(context); await assert.rejects(approveDraft(draftId, actorId, 'staff'), error => [400, 403].includes(error.statusCode)); assert.equal(context.targetWrites, 0); });
  await isolated(async context => { await assert.rejects(approveDraft(draftId, targetId, 'staff'), error => error.statusCode === 404); assert.equal(context.targetWrites, 0); });
});
test('expired/rejected/processing, stale accounts and unsupported transactions cannot report successful execution', async () => {
  for (const status of ['REJECTED', 'EXECUTING', 'EXPIRED', 'STALE', 'NO_TRANSACTION']) await isolated(async context => {
    if (status === 'EXPIRED') context.state.draft.expiresAt = new Date(0);
    else if (status === 'STALE') context.state.target.status = false;
    else if (status === 'NO_TRANSACTION') context.flags.unsupported = true;
    else context.state.draft.status = status;
    await assert.rejects(approveDraft(draftId, actorId, 'staff'), error => [409, 503].includes(error.statusCode));
    assert.equal(context.targetWrites, 0); assert.equal(context.state.audits.length, 0);
  });
});
test('audit failure and an unconfirmed status roll back; losing the draft claim never repeats the target write', async () => {
  for (const flag of ['auditFailure', 'wrongResult']) await isolated(async context => {
    context.flags[flag] = true; await assert.rejects(approveDraft(draftId, actorId, 'staff'));
    assert.equal(context.state.target.status, true); assert.equal(context.state.draft.status, 'PENDING'); assert.equal(context.state.audits.length, 0);
  });
  await isolated(async context => { context.flags.claimRace = true; const result = await approveDraft(draftId, actorId, 'staff'); assert.equal(result.alreadyApplied, true); assert.equal(context.targetWrites, 0); });
});

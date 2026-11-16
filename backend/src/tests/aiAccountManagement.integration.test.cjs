// Opt-in integration checks: real source records are read only, then copied into
// an ephemeral local replica set. No mocks, generated accounts, or source writes.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const express = require('express');
const { normalizePhone } = require('../utils/phoneUtils');
const { createDraft, approveDraft, cleanPayload } = require('../services/aiCopilot/draftService');
const reads = require('../services/aiCopilot/readTools');
const { execute } = require('../services/aiCopilot/toolRegistry');
const User = require('../models/User');
const Detail = require('../models/UserDetail');
const Draft = require('../models/AIDraft');
const router = require('../routes/aiCopilotRoutes');
let snapshot, repl, server, base, actor, target;
const enabled = process.env.RUN_ACCOUNT_DB_TESTS === '1';
before(async () => {
  if (!enabled) return;
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  const source = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false }).asPromise();
  try {
    snapshot = {
      users: await source.db.collection('users').find({}, { projection: { password: 0, googleId: 0, expoPushTokens: 0 } }).toArray(),
      profiles: await source.db.collection('userdetails').find({}).toArray(),
      drafts: await source.db.collection('aidrafts').find({ type: 'UPDATE_USER_PROFILE', status: 'PENDING' }).toArray(),
    };
  } finally { await source.close(); }
  console.info(`Read-only source snapshot: ${snapshot.users.length} real accounts; all mutation checks use an isolated local copy.`);
  actor = snapshot.users.find(user => user.role === 'admin' && user.status);
  target = snapshot.users.find(user => user.role !== 'admin' && snapshot.profiles.some(profile => String(profile.userId) === String(user._id)));
  assert.ok(actor && target, 'Real source accounts are required');
  repl = await MongoMemoryReplSet.create({ binary: { version: '8.0.5', systemBinary: path.resolve(__dirname, '../../../.mongodb-binaries/mongod-x64-win32-8.0.5.exe') }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(repl.getUri('valo_ai_account_regression'));
  assert.equal(mongoose.connection.host, '127.0.0.1');
  assert.equal(mongoose.connection.name, 'valo_ai_account_regression');
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  delete process.env.GEMINI_API_KEY; // These tests must never contact an AI provider.
  const app = express(); app.use(express.json()); app.use('/ai-copilot', router);
  const { protect, authorize } = require('../middlewares/authMiddleware');
  app.get('/admin/users', protect, authorize('admin'), require('../controllers/adminController').listUsers);
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}/ai-copilot`;
});
beforeEach(async () => {
  if (!enabled) return;
  assert.equal(mongoose.connection.name, 'valo_ai_account_regression');
  await Promise.all([User.deleteMany({}), Detail.deleteMany({}), Draft.deleteMany({}), mongoose.models.AIAuditLog.deleteMany({}), mongoose.models.AdminActionLog.deleteMany({})]);
  await User.collection.insertMany(snapshot.users);
  await Detail.collection.insertMany(snapshot.profiles);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (repl) await repl.stop(); });
const check = (name, fn) => test(name, { skip: !enabled }, fn);
const auth = user => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });
async function api(route, body, user = actor) { const response = await fetch(`${base}${route}`, { method: 'POST', headers: auth(user), body: JSON.stringify(body || {}) }); return { status: response.status, body: await response.json() }; }
async function proposal(type, payload, account = target) {
  const data = await reads.getUserDetail({ userId: String(account._id) });
  return createDraft({ adminUserId: actor._id, actorRole: 'admin', type, targetId: account._id, payload, evidence: [{ tool: 'get_user_detail', data }], reason: 'Requested account update' });
}
function changedName(field) {
  const profile = snapshot.profiles.find(row => String(row.userId) === String(target._id));
  return snapshot.profiles.find(row => row[field] && row[field] !== profile?.[field])?.[field];
}
check('AM-36: authenticated identity ignores previous searches and supplied user IDs', async () => {
  await reads.searchUsers({ query: target.email });
  const result = await api('/chat', { message: 'Who am I?', actorId: String(target._id) });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.accountResult.items[0]._id, String(actor._id));
  assert.equal(result.body.data.accountResult.items[0].email, actor.email);
  await assert.rejects(execute('get_current_user', { userId: String(target._id) }, 'admin', { actorId: actor._id }));
  const tool = await execute('get_current_user', {}, 'admin', { actorId: actor._id });
  assert.equal(tool.data._id, String(actor._id));
});
check('phone exact/partial and country-code lookups match actual profile records', async () => {
  const profile = snapshot.profiles.find(row => normalizePhone(row.phone) === '0839404432');
  assert.ok(profile, 'The reported source phone must exist');
  for (const query of ['0839404432', '083940', '+84839404432']) {
    const result = await reads.searchUsers({ query });
    assert.ok(result.items.some(user => user._id === String(profile.userId)));
  }
  const exact = await reads.searchUsers({ query: '0839404432', matchMode: 'exact' });
  assert.equal(exact.total, snapshot.profiles.filter(row => normalizePhone(row.phone) === '0839404432').length);
});
check('counts, role/status filters, stable sorting, VIP expiry and safe profile projection', async () => {
  const result = await reads.searchUsers({ role: 'staff', status: true, sortBy: 'email', sortOrder: 'asc', limit: 2 });
  assert.equal(result.total, snapshot.users.filter(user => user.role === 'staff' && user.status === true).length);
  assert.equal(result.returned, Math.min(2, result.total));
  assert.ok(result.items.every(user => user.role === 'staff' && user.status && !('password' in user)));
  assert.deepEqual(result.items.map(user => user.email), [...result.items.map(user => user.email)].sort());
  const vip = await reads.searchUsers({ vip: true, limit: 50 });
  const expected = snapshot.users.filter(user => user.membership?.isVip && (!user.membership.expireAt || new Date(user.membership.expireAt) > new Date()));
  assert.equal(vip.total, expected.length);
  const detail = await reads.getUserDetail({ userId: String(target._id) });
  const source = snapshot.profiles.find(row => String(row.userId) === String(target._id));
  assert.equal(detail.profile.phone, source.phone);
});
for (const field of ['firstName', 'lastName']) check(`${field}: delta profile proposal approves and persists without overwriting other fields`, async () => {
  const before = await Detail.findOne({ userId: target._id }).lean(); const value = changedName(field); assert.ok(value);
  const draft = await proposal('UPDATE_USER_PROFILE', { profile: { [field]: value } });
  assert.deepEqual(Object.keys(draft.payload), [field]);
  const response = await api(`/drafts/${draft._id}/approve`);
  assert.equal(response.status, 200, response.body.message);
  const after = await Detail.findOne({ userId: target._id }).lean();
  assert.equal(after[field], value); for (const key of ['firstName', 'lastName', 'phone'].filter(key => key !== field)) assert.equal(after[key], before[key]);
  assert.equal((await Draft.findById(draft._id)).status, 'EXECUTED');
});
check('phone: normalized update persists; duplicate phone is rejected without partial mutation', async () => {
  const donor = snapshot.profiles.find(profile => String(profile.userId) !== String(target._id) && /^0[35789]\d{8}$/.test(normalizePhone(profile.phone)));
  assert.ok(donor);
  await assert.rejects(proposal('UPDATE_USER_PROFILE', { phone: donor.phone }), error => error.code === 'PHONE_IN_USE');
  assert.equal(await Draft.countDocuments({}), 0);
  await Detail.updateOne({ _id: donor._id }, { $set: { phone: '' } });
  const draft = await proposal('UPDATE_USER_PROFILE', { phone: donor.phone });
  // A new conflict after preparation must still be caught at approval.
  await Detail.updateOne({ _id: donor._id }, { $set: { phone: donor.phone } });
  const failure = await api(`/drafts/${draft._id}/approve`);
  assert.equal(failure.status, 400); assert.equal(failure.body.code, 'PHONE_IN_USE');
  assert.ok(failure.body.message.includes('already linked'));
  assert.ok(!failure.body.message.includes('Unable to process'));
  assert.equal((await Detail.findOne({ userId: target._id })).phone, snapshot.profiles.find(profile => String(profile.userId) === String(target._id)).phone);
  assert.equal((await Draft.findById(draft._id)).status, 'PENDING');
  const diagnostic = await mongoose.models.AIAuditLog.findOne({ subjectId: draft._id, action: 'DRAFT_EXECUTION_FAILED' }).lean();
  assert.equal(diagnostic.metadata.stage, 'PROFILE_PHONE_UNIQUENESS');
  await Detail.updateOne({ _id: donor._id }, { $set: { phone: '' } });
  const success = await api(`/drafts/${draft._id}/approve`);
  assert.equal(success.status, 200, success.body.message);
  assert.equal((await Detail.findOne({ userId: target._id })).phone, normalizePhone(donor.phone));
});
check('reported valo_staff phone path: real conflict is refused; available phone persists and refresh API returns it', async () => {
  const account = snapshot.users.find(user => user.email === 'valo_staff@test.com');
  assert.ok(account, 'Reported account must exist in the real snapshot');
  const source = snapshot.profiles.find(profile => String(profile.userId) === String(account._id));
  assert.equal(source.phone, '');
  const phone = '0901234567';
  const owners = await Detail.find({ userId: { $ne: account._id } }).lean();
  const collisions = owners.filter(profile => normalizePhone(profile.phone) === phone);
  assert.ok(collisions.length > 0, 'The reported number has a real existing owner');
  await assert.rejects(proposal('UPDATE_USER_PROFILE', { phone }, account), error => error.code === 'PHONE_IN_USE');
  assert.equal(await Draft.countDocuments({}), 0);
  // Free the actual colliding phone only in the isolated copy to verify the
  // valid execution path. Live owners are never modified by these tests.
  await Detail.updateMany({ _id: { $in: collisions.map(profile => profile._id) } }, { $set: { phone: '' } });
  const draft = await proposal('UPDATE_USER_PROFILE', { firstName: source.firstName, lastName: source.lastName, phone }, account);
  assert.deepEqual(draft.payload, { phone });
  const response = await api(`/drafts/${draft._id}/approve`);
  assert.equal(response.status, 200, response.body.message);
  assert.equal(response.body.data.status, 'EXECUTED');
  assert.equal((await Detail.findOne({ userId: account._id })).phone, phone);
  assert.equal((await Draft.findById(draft._id)).status, 'EXECUTED');
  const refreshed = await fetch(`${base.replace('/ai-copilot', '')}/admin/users`, { headers: auth(actor) });
  assert.equal(refreshed.status, 200);
  const listed = (await refreshed.json()).data.find(user => user._id === String(account._id));
  assert.equal(listed.profile.phone, phone);
  const replay = await api(`/drafts/${draft._id}/approve`);
  assert.equal(replay.body.data.alreadyApplied, true);
});
check('duplicate concurrent proposals reuse one pending draft; concurrent approvals mutate once', async () => {
  const payload = { firstName: changedName('firstName') };
  const drafts = await Promise.all([proposal('UPDATE_USER_PROFILE', payload), proposal('UPDATE_USER_PROFILE', payload), proposal('UPDATE_USER_PROFILE', payload)]);
  assert.equal(new Set(drafts.map(draft => String(draft._id))).size, 1);
  assert.equal(await Draft.countDocuments({ status: 'PENDING' }), 1);
  const results = await Promise.all([api(`/drafts/${drafts[0]._id}/approve`), api(`/drafts/${drafts[0]._id}/approve`)]);
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results.map(result => result.body.message)));
  assert.equal(results.filter(result => result.body.data.alreadyApplied).length, 1);
  assert.equal(await mongoose.models.AIAuditLog.countDocuments({ subjectId: drafts[0]._id, action: 'DRAFT_EXECUTED' }), 1);
});
check('reject is idempotent, rejected approval is refused, and no-op proposals are rejected', async () => {
  const draft = await proposal('UPDATE_USER_PROFILE', { firstName: changedName('firstName') });
  assert.equal((await api(`/drafts/${draft._id}/reject`)).status, 200);
  assert.equal((await api(`/drafts/${draft._id}/reject`)).body.data.alreadyRejected, true);
  assert.equal((await api(`/drafts/${draft._id}/approve`)).body.code, 'DRAFT_REJECTED');
  await assert.rejects(proposal('CHANGE_USER_ROLE', { role: target.role }), error => error.code === 'NO_CHANGE');
  await assert.rejects(proposal('UPDATE_USER_STATUS', { status: target.status }), error => error.code === 'NO_CHANGE');
  const profile = await Detail.findOne({ userId: target._id });
  await assert.rejects(proposal('UPDATE_USER_PROFILE', { firstName: profile.firstName }), error => error.code === 'NO_CHANGE');
});
check('role/status approval and replay use actual executed state', async () => {
  const role = target.role === 'staff' ? 'customer' : 'staff';
  const draft = await proposal('CHANGE_USER_ROLE', { role });
  assert.equal((await api(`/drafts/${draft._id}/approve`)).status, 200);
  assert.equal((await User.findById(target._id)).role, role);
  assert.equal((await api(`/drafts/${draft._id}/approve`)).body.data.alreadyApplied, true);
  const status = await proposal('UPDATE_USER_STATUS', { status: !target.status });
  assert.equal((await api(`/drafts/${status._id}/approve`)).status, 200);
  assert.equal((await User.findById(target._id)).status, !target.status);
});
check('unauthorized/self-privilege/expired/stale/invalid proposals cannot mutate accounts', async () => {
  await assert.rejects(proposal('CHANGE_USER_ROLE', { role: 'staff' }, actor), error => error.code === 'SELF_PRIVILEGE_CHANGE');
  for (const payload of [{}, { phone: 839404432 }, { firstName: '1234' }]) assert.throws(() => cleanPayload('UPDATE_USER_PROFILE', payload));
  const draft = await proposal('UPDATE_USER_PROFILE', { firstName: changedName('firstName') });
  const other = snapshot.users.find(user => user.role !== 'admin' && user.status); assert.ok(other);
  assert.equal((await api(`/drafts/${draft._id}/approve`, {}, other)).status, 403);
  await Detail.updateOne({ userId: target._id }, { $set: { lastName: changedName('lastName') } });
  assert.equal((await api(`/drafts/${draft._id}/approve`)).body.code, 'ACCOUNT_CHANGED');
  await Draft.updateOne({ _id: draft._id }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await api(`/drafts/${draft._id}/approve`)).body.code, 'DRAFT_EXPIRED');
});

check('name search, expired/standard membership, invalid filters and deleted targets use actual data', async () => {
  const profile = snapshot.profiles.find(row => row.firstName && row.lastName && snapshot.users.some(user => String(user._id) === String(row.userId)));
  assert.ok(profile);
  const name = await reads.searchUsers({ query: `${profile.firstName} ${profile.lastName}` });
  assert.ok(name.items.some(user => user._id === String(profile.userId)) || name.total > name.returned);
  const now = new Date();
  const isVip = user => user.membership?.isVip && (!user.membership.expireAt || new Date(user.membership.expireAt) > now);
  assert.equal((await reads.searchUsers({ vip: false })).total, snapshot.users.filter(user => !isVip(user)).length);
  assert.equal((await reads.searchUsers({ vipStatus: 'expired' })).total, snapshot.users.filter(user => user.membership?.isVip && user.membership.expireAt && new Date(user.membership.expireAt) <= now).length);
  await assert.rejects(reads.searchUsers({ role: 'invalid' }));
  await assert.rejects(reads.searchUsers({ status: 'active' }));
  await assert.rejects(reads.searchUsers({ sortBy: 'password' }));
  await assert.rejects(reads.searchUsers({ vip: true, vipStatus: 'expired' }));
  const evidence = [{ tool: 'get_user_detail', data: await reads.getUserDetail({ userId: String(target._id) }) }];
  await User.deleteOne({ _id: target._id });
  await assert.rejects(reads.getUserDetail({ userId: String(target._id) }), error => error.statusCode === 404);
  await assert.rejects(createDraft({ adminUserId: actor._id, actorRole: 'admin', type: 'CHANGE_USER_ROLE', targetId: target._id, payload: { role: 'staff' }, evidence }), error => error.statusCode === 404);
});
check('an account read is not approval: unverified targets and unauthorized actors cannot create proposals', async () => {
  await assert.rejects(createDraft({ adminUserId: actor._id, actorRole: 'admin', type: 'UPDATE_USER_PROFILE', targetId: target._id, payload: { firstName: changedName('firstName') }, evidence: [] }), error => error.code === 'UNVERIFIED_TARGET');
  await assert.rejects(createDraft({ adminUserId: target._id, actorRole: 'admin', type: 'CHANGE_USER_ROLE', targetId: actor._id, payload: { role: 'staff' } }), error => error.statusCode === 403);
  const data = await reads.getUserDetail({ userId: String(target._id) });
  await assert.rejects(createDraft({ adminUserId: actor._id, actorRole: 'customer', type: 'CHANGE_USER_ROLE', targetId: target._id, payload: { role: 'admin' }, evidence: [{ tool: 'get_user_detail', data }] }), error => error.statusCode === 403);
  assert.equal(await Draft.countDocuments({}), 0);
});
check('an authenticated Admin can approve a profile-only change to their own account', async () => {
  const profile = await Detail.findOne({ userId: actor._id }).lean();
  const value = snapshot.profiles.find(row => row.firstName && row.firstName !== profile?.firstName)?.firstName;
  assert.ok(value);
  const draft = await proposal('UPDATE_USER_PROFILE', { firstName: value }, actor);
  const result = await api(`/drafts/${draft._id}/approve`);
  assert.equal(result.status, 200, result.body.message);
  assert.equal((await Detail.findOne({ userId: actor._id })).firstName, value);
});
check('concurrent Admins cannot assign the same phone to two accounts', async t => {
  const other = snapshot.users.find(user => user.role === 'admin' && user.status && String(user._id) !== String(actor._id));
  if (!other) return t.skip('The real source snapshot has only one active Admin');
  const accounts = snapshot.users.filter(user => user.role !== 'admin' && snapshot.profiles.some(profile => String(profile.userId) === String(user._id))).slice(0, 2);
  assert.equal(accounts.length, 2);
  const donor = snapshot.profiles.find(profile => !accounts.some(user => String(user._id) === String(profile.userId)) && /^0[35789]\d{8}$/.test(normalizePhone(profile.phone)));
  assert.ok(donor);
  await Detail.updateOne({ _id: donor._id }, { $set: { phone: '' } });
  const drafts = [];
  for (let index = 0; index < 2; index++) {
    const data = await reads.getUserDetail({ userId: String(accounts[index]._id) });
    drafts.push(await createDraft({ adminUserId: index ? other._id : actor._id, actorRole: 'admin', type: 'UPDATE_USER_PROFILE', targetId: accounts[index]._id, payload: { phone: donor.phone }, evidence: [{ tool: 'get_user_detail', data }] }));
  }
  const outcomes = await Promise.all([api(`/drafts/${drafts[0]._id}/approve`, {}, actor), api(`/drafts/${drafts[1]._id}/approve`, {}, other)]);
  assert.equal(outcomes.filter(result => result.status === 200).length, 1);
  assert.equal(outcomes.filter(result => result.body.code === 'PHONE_IN_USE').length, 1);
  assert.equal(await Detail.countDocuments({ phone: normalizePhone(donor.phone) }), 1);
});
check('stored real pending profile proposals return precise outcomes on the isolated copy', async () => {
  const outcomes = {};
  for (const sourceDraft of snapshot.drafts) {
    // Restore the copied source state so proposals do not affect one another.
    await Promise.all([User.deleteMany({}), Detail.deleteMany({}), Draft.deleteMany({}), mongoose.models.AIAuditLog.deleteMany({}), mongoose.models.AdminActionLog.deleteMany({})]);
    await User.collection.insertMany(snapshot.users); await Detail.collection.insertMany(snapshot.profiles);
    await Draft.collection.insertOne(sourceDraft);
    const owner = snapshot.users.find(user => String(user._id) === String(sourceDraft.adminUserId));
    if (!owner?.status || owner.role !== 'admin') continue;
    const result = await api(`/drafts/${sourceDraft._id}/approve`, {}, owner);
    assert.ok(result.status === 200 || result.body.code, 'A failed real proposal must have a precise, safe error code');
    const outcome = result.status === 200 ? 'EXECUTED' : result.body.code;
    outcomes[outcome] = (outcomes[outcome] || 0) + 1;
  }
  console.info('Copied real pending profile proposal outcomes:', JSON.stringify(outcomes));
});

check('real account replies render safe structured single/list views and settled drafts', async () => {
  const frontend = path.resolve(__dirname, '../../../frontend');
  const { pathToFileURL } = require('node:url');
  const fe = require('node:module').createRequire(path.join(frontend, 'package.json'));
  const React = fe('react'); const { renderToStaticMarkup } = fe('react-dom/server');
  const { Link, MemoryRouter } = fe('react-router-dom');
  const { ArrowRight, ArrowUpRight, Clock3 } = fe('lucide-react');
  const { adminDate, adminValue, readableLabel } = await import(pathToFileURL(path.join(frontend, 'src/features/valo-ai/utils/adminPresentation.js')));
  const { transformWithOxc } = await import(pathToFileURL(fe.resolve('vite')));
  async function compile(relative, names, values, result) {
    const file = path.join(frontend, relative);
    const source = require('node:fs').readFileSync(file, 'utf8').replace(/^import .*;$/gm, '').replace(/export default function/g, 'function').replace(/export function/g, 'function');
    const { code } = await transformWithOxc(source, file, { jsx: { runtime: 'classic' } });
    return new Function('React', ...names, `${code}; return ${result};`)(React, ...values);
  }
  const Markdown = await compile('src/features/valo-ai/components/AIMessageMarkdown.jsx', ['Fragment', 'Link'], [React.Fragment, Link], 'AIMessageMarkdown');
  const components = await compile('src/features/valo-ai/components/AdminChatContent.jsx', ['Link','ArrowRight','ArrowUpRight','Clock3','AIMessageMarkdown','adminDate','adminValue','readableLabel'], [Link,ArrowRight,ArrowUpRight,Clock3,Markdown,adminDate,adminValue,readableLabel], '{ AdminChatAnswer, AdminDraft }');
  const render = (Component, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Component, props)));
  const result = await reads.searchUsers({ role: 'staff', limit: 2 });
  const links = require('../services/aiCopilot/entityLinks').entityLinks('search_users', result);
  const row = { type: 'analysis', message: '', accountResult: result, links };
  const html = render(components.AdminChatAnswer, { row });
  assert.equal((html.match(/class="admin-ai-result-row"/g) || []).length, result.items.length);
  assert.equal((html.match(/>View Account</g) || []).length, result.items.length);
  assert.ok(html.includes(`${result.total} accounts found`));
  const self = await api('/chat', { message: 'Who am I?' });
  const single = render(components.AdminChatAnswer, { row: self.body.data });
  assert.ok(single.includes(actor.email)); assert.equal((single.match(/>View Account</g) || []).length, 1);
  const draft = await proposal('UPDATE_USER_PROFILE', { firstName: changedName('firstName') });
  const pending = render(components.AdminDraft, { draft: { ...draft.toObject(), status: 'PENDING' }, message: '' });
  assert.ok(pending.includes('Before')); assert.ok(pending.includes('After')); assert.equal((pending.match(/<button/g) || []).length, 2);
  const settled = render(components.AdminDraft, { draft: { ...draft.toObject(), status: 'EXECUTED' }, message: '' });
  assert.ok(settled.includes('Applied')); assert.equal((settled.match(/<button/g) || []).length, 0);
  const expanded = render(components.AdminDraft, { draft: { ...draft.toObject(), reason: `**Draft ID**: ${draft._id}\nSource and Timestamp: internal execution metadata` }, message: `Approve proposal ${draft._id}. Repeat target and all changed fields.` });
  assert.ok(!expanded.includes(String(draft._id)));
  assert.ok(!expanded.includes('Draft ID'));
  assert.ok(!expanded.includes('Source and Timestamp'));
  assert.ok(!expanded.includes('Repeat target'));
  assert.equal((expanded.match(/Before/g) || []).length, 1);

});

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const UserDetail = require('../models/UserDetail');
const Claim = require('../models/TelegramClaimToken');
const Program = require('../models/SpendRewardProgram');
const Voucher = require('../models/UserVoucher');
const EmailJob = require('../models/RewardEmailJob');
const UserNotification = require('../models/UserNotification');
const { consumeContact } = require('../services/telegramClaimService');
const { applySpend, saveProgram } = require('../services/spendRewardService');
const { validateProgram } = require('../services/spendRewardRules');

let replica;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
after(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

const createUser = (username) => User.create({ username, email: `${username}@example.com` });
const tier = { threshold: 10000, discountAmount: 3000, minimumAmount: 3000, recipientLimit: 2 };

test('quota validation allows unlimited and rejects invalid limits', () => {
  const check = (recipientLimit) => validateProgram({ enabled: true, revision: 0, tiers: [{ ...tier, recipientLimit }] });
  assert.equal(check(undefined).tiers[0].recipientLimit, null);
  assert.equal(check(2).tiers[0].recipientLimit, 2);
  for (const invalid of [0, -1, 1.5, '2', 1000001]) assert.throws(() => check(invalid), /Recipient limit/);
});

test('concurrent spending counts prior awards and respects the limit; a new month resets it', async () => {
  const july = new Date('2026-07-31T16:59:00Z');
  const august = new Date('2026-07-31T17:00:00Z');
  const users = await Promise.all(['quota-first', 'quota-next', 'quota-last'].map(createUser));
  await Program.create({ enabled: true, startsAt: july, tiers: [{ ...tier, recipientLimit: null }] });
  const award = (user, date) => applySpend({ userId: user.id, sourceKey: `${user.id}:${date.toISOString()}`, occurredAt: date, amount: 10000 }, date);
  const prior = await award(users[0], july);
  assert.ok(prior);
  await Voucher.updateOne({ _id: prior._id }, { $set: { status: 'used' } });
  await saveProgram({ enabled: true, revision: 0, tiers: [tier] });
  const results = await Promise.all(users.slice(1).map((user) => award(user, july)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await Voucher.countDocuments({ source: 'spending', rewardMonth: '2026-07' }), 2);
  const nextMonth = await Promise.all(users.map((user) => award(user, august)));
  assert.equal(nextMonth.filter(Boolean).length, 2);
  assert.equal(await Voucher.countDocuments({ source: 'spending', rewardMonth: '2026-08' }), 2);
});

test('WELCOME is issued once after matching a Telegram contact, with an email and in-app notification', async () => {
  const user = await createUser('welcome-customer');
  await UserDetail.create({ userId: user._id, phone: '0901234567' });
  const createLink = (id) => Claim.create({
    tokenHash: id, userId: user._id, purpose: 'link', recipientPhone: '0901234567',
    boundTelegramUserId: '123', boundChatId: '123', expiresAt: new Date(Date.now() + 600000),
  });
  const contact = (phone) => ({ from: { id: 123 }, chat: { id: 123, type: 'private' }, contact: { user_id: 123, phone_number: phone } });
  await createLink('welcome-first');
  assert.equal((await consumeContact(contact('0901234568'))).ok, false);
  assert.equal(await Voucher.countDocuments({ userId: user._id }), 0);
  const result = await consumeContact(contact('+84901234567'));
  assert.equal(result.ok, true);
  assert.match(result.text, /WELCOME/);
  const voucher = await Voucher.findOne({ userId: user._id, source: 'welcome' });
  assert.equal(voucher.benefitSnapshot.name, 'WELCOME');
  assert.equal(voucher.benefitSnapshot.discountAmount, 3000);
  assert.equal(voucher.expiresAt - voucher.redeemedAt, 30 * 86400000);
  assert.equal(await EmailJob.countDocuments({ voucherId: voucher._id }), 1);
  assert.equal(await UserNotification.countDocuments({ userId: user._id }), 1);
  await createLink('welcome-repeat');
  assert.equal((await consumeContact(contact('0901234567'))).ok, true);
  assert.equal(await Voucher.countDocuments({ userId: user._id, source: 'welcome' }), 1);
});

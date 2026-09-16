const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const AIDraft = require('../models/AIDraft');
const AIAuditLog = require('../models/AIAuditLog');
const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');
const User = require('../models/User');
const notificationService = require('../services/notificationService');
const notificationDispatch = require('../services/notificationDispatchService');
const readTools = require('../services/aiCopilot/readTools');
const { cleanPayload, createDraft, approveDraft } = require('../services/aiCopilot/draftService');
const { getToolsForRole, execute } = require('../services/aiCopilot/toolRegistry');
const { chat } = require('../services/aiCopilot/chatService');

const queryResult = (value) => ({ select() { return this; }, lean() { return Promise.resolve(value); } });

test('notification recipient tool is Staff-only and general Staff user tools remain separate', async () => {
  assert.equal(getToolsForRole('staff').some((tool) => tool.name === 'search_notification_recipients'), true);
  assert.equal(getToolsForRole('admin').some((tool) => tool.name === 'search_notification_recipients'), false);
  await assert.rejects(execute('search_notification_recipients', { query: 'vyvo123' }, 'admin'), /Staff Notification Management/);
});

test('purpose-specific recipient search returns only bounded identity fields and exact username grounding', async () => {
  const original = notificationService.searchEligibleRecipients;
  notificationService.searchEligibleRecipients = async (query, limit) => ({
    query, limit, total: 2, items: [
      { _id: new mongoose.Types.ObjectId(), username: 'vyvo123', email: 'vyvo@example.com', role: 'staff', status: true },
      { _id: new mongoose.Types.ObjectId(), username: 'vyvo456', email: 'other@example.com', role: 'staff', status: true },
    ],
  });
  try {
    const result = await readTools.searchNotificationRecipients({ query: 'vyvo123' }, 'staff');
    assert.equal(result.total, 2);
    assert.equal(result.items[0].role, 'staff');
    assert.equal(result.exactMatchUserId, String(result.items[0]._id));
    assert.deepEqual(Object.keys(result.items[0]).sort(), ['_id', 'email', 'role', 'status', 'username']);
    await assert.rejects(readTools.searchNotificationRecipients({ query: '' }, 'staff'), /1 đến 100/);
  } finally {
    notificationService.searchEligibleRecipients = original;
  }
});

test('SEND_NOTIFICATION validation requires an AI-proposed title and content', () => {
  assert.deepEqual(
    cleanPayload('SEND_NOTIFICATION', { title: '  Hoàn thành VALO AI  ', content: '  Đã hoàn thành.  ', expectedRecipientRole: 'STAFF' }),
    { title: 'Hoàn thành VALO AI', content: 'Đã hoàn thành.', expectedRecipientRole: 'staff' }
  );
  assert.throws(() => cleanPayload('SEND_NOTIFICATION', { title: '', content: 'hello' }), /Tiêu đề/);
  assert.throws(() => cleanPayload('SEND_NOTIFICATION', { title: 'hello', content: 'x'.repeat(2001) }), /2000/);
});

test('SEND_NOTIFICATION draft target must be uniquely grounded and DB role replaces forged role', async () => {
  const recipientId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const originals = { findOne: User.findOne, create: AIDraft.create, audit: AIAuditLog.create };
  let created;
  User.findOne = () => queryResult({ _id: recipientId, username: 'vyvo123', email: 'vyvo@example.com', role: 'staff', status: true });
  AIDraft.create = async (data) => { created = { _id: new mongoose.Types.ObjectId(), ...data }; return created; };
  AIAuditLog.create = async () => ({});
  const evidence = [{
    tool: 'search_notification_recipients',
    data: { total: 2, exactMatchUserId: String(recipientId), items: [{ _id: String(recipientId), username: 'vyvo123' }] },
  }];
  try {
    const draft = await createDraft({
      adminUserId: staffId,
      actorRole: 'staff',
      type: 'SEND_NOTIFICATION',
      targetId: String(recipientId),
      payload: { title: 'Thông báo hoàn thành', content: 'Tôi đã hoàn thành VALO AI.', expectedRecipientRole: 'admin' },
      reason: 'Staff yêu cầu gửi thông báo',
      evidence,
    });
    assert.equal(draft.payload.expectedRecipientRole, 'staff');
    assert.equal(draft.current.username, 'vyvo123');
    assert.equal(String(draft.targetId), String(recipientId));

    await assert.rejects(createDraft({
      adminUserId: staffId,
      actorRole: 'staff',
      type: 'SEND_NOTIFICATION',
      targetId: String(recipientId),
      payload: { title: 'T', content: 'C' },
      reason: 'ambiguous',
      evidence: [{ tool: 'search_notification_recipients', data: { total: 2, exactMatchUserId: null, items: [{ _id: String(recipientId) }] } }],
    }), /chưa được xác định duy nhất/);
  } finally {
    User.findOne = originals.findOne;
    AIDraft.create = originals.create;
    AIAuditLog.create = originals.audit;
  }
});

test('approval atomically claims and sends exactly once while trusting live recipient role', async () => {
  const draftId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const recipientId = new mongoose.Types.ObjectId();
  const notificationId = new mongoose.Types.ObjectId();
  const draft = {
    _id: draftId,
    adminUserId: staffId,
    type: 'SEND_NOTIFICATION',
    targetId: recipientId,
    payload: { title: 'Hoàn thành VALO AI', content: 'Tôi đã hoàn thành.', expectedRecipientRole: 'admin' },
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60000),
  };
  const originals = {
    findOne: AIDraft.findOne,
    findOneAndUpdate: AIDraft.findOneAndUpdate,
    updateOne: AIDraft.updateOne,
    userFindOne: User.findOne,
    send: notificationDispatch.sendSingleUserNotification,
    findDraft: notificationDispatch.findDraftNotification,
    audit: AIAuditLog.create,
  };
  let sends = 0;
  AIDraft.findOne = async () => draft;
  AIDraft.findOneAndUpdate = async () => { if (draft.status !== 'PENDING') return null; draft.status = 'EXECUTING'; return draft; };
  AIDraft.updateOne = async (_filter, update) => { Object.assign(draft, update.$set); return { modifiedCount: 1 }; };
  User.findOne = () => queryResult({ _id: recipientId, username: 'vyvo123', role: 'staff', status: true });
  notificationDispatch.sendSingleUserNotification = async (args) => {
    sends += 1;
    assert.equal(args.aiDraftId, draftId);
    assert.equal(args.targetUserId, recipientId);
    return { notification: { _id: notificationId }, created: true };
  };
  notificationDispatch.findDraftNotification = async () => null;
  AIAuditLog.create = async () => ({});
  try {
    const result = await approveDraft(String(draftId), staffId, 'staff');
    assert.equal(String(result.notificationId), String(notificationId));
    assert.equal(result.recipientRole, 'staff');
    assert.equal(draft.status, 'EXECUTED');
    await assert.rejects(approveDraft(String(draftId), staffId, 'staff'), { statusCode: 409 });
    assert.equal(sends, 1);
  } finally {
    AIDraft.findOne = originals.findOne;
    AIDraft.findOneAndUpdate = originals.findOneAndUpdate;
    AIDraft.updateOne = originals.updateOne;
    User.findOne = originals.userFindOne;
    notificationDispatch.sendSingleUserNotification = originals.send;
    notificationDispatch.findDraftNotification = originals.findDraft;
    AIAuditLog.create = originals.audit;
  }
});

test('inactive recipient fails approval before dispatch and leaves the Draft pending', async () => {
  const draftId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const draft = {
    _id: draftId, adminUserId: staffId, type: 'SEND_NOTIFICATION', targetId: new mongoose.Types.ObjectId(),
    payload: { title: 'T', content: 'C', expectedRecipientRole: 'staff' }, status: 'PENDING',
    expiresAt: new Date(Date.now() + 60000),
  };
  const originals = { findOne: AIDraft.findOne, claim: AIDraft.findOneAndUpdate, update: AIDraft.updateOne, user: User.findOne, send: notificationDispatch.sendSingleUserNotification, findDraft: notificationDispatch.findDraftNotification };
  let sends = 0;
  AIDraft.findOne = async () => draft;
  AIDraft.findOneAndUpdate = async () => { draft.status = 'EXECUTING'; return draft; };
  AIDraft.updateOne = async (_filter, update) => { Object.assign(draft, update.$set); return { modifiedCount: 1 }; };
  User.findOne = () => queryResult(null);
  notificationDispatch.sendSingleUserNotification = async () => { sends += 1; };
  notificationDispatch.findDraftNotification = async () => null;
  try {
    await assert.rejects(approveDraft(String(draftId), staffId, 'staff'), { statusCode: 404 });
    assert.equal(sends, 0);
    assert.equal(draft.status, 'PENDING');
  } finally {
    AIDraft.findOne = originals.findOne;
    AIDraft.findOneAndUpdate = originals.claim;
    AIDraft.updateOne = originals.update;
    User.findOne = originals.user;
    notificationDispatch.sendSingleUserNotification = originals.send;
    notificationDispatch.findDraftNotification = originals.findDraft;
  }
});

test('shared single-user dispatch reuses createForUser and aiDraftId prevents a retry duplicate', async () => {
  const originalFind = Notification.findOne;
  const originalCreate = notificationService.createForUser;
  const notification = { _id: new mongoose.Types.ObjectId(), targetUsers: [new mongoose.Types.ObjectId()] };
  let existing = null;
  let creates = 0;
  Notification.findOne = async () => existing;
  notificationService.createForUser = async (_userId, data, _createdBy, options) => {
    creates += 1;
    assert.equal(data.metadata.aiDraftId, 'draft-1');
    assert.equal(options.requireActive, true);
    existing = notification;
    return notification;
  };
  try {
    const first = await notificationDispatch.sendSingleUserNotification({ targetUserId: notification.targetUsers[0], title: 'T', content: 'C', createdBy: new mongoose.Types.ObjectId(), aiDraftId: 'draft-1' });
    const retry = await notificationDispatch.sendSingleUserNotification({ targetUserId: notification.targetUsers[0], title: 'T', content: 'C', createdBy: new mongoose.Types.ObjectId(), aiDraftId: 'draft-1' });
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(creates, 1);
  } finally {
    Notification.findOne = originalFind;
    notificationService.createForUser = originalCreate;
  }
});

test('dispatch integration creates exactly one Notification and one UserNotification record', async () => {
  const recipientId = new mongoose.Types.ObjectId();
  const notificationId = new mongoose.Types.ObjectId();
  const originals = {
    notificationFind: Notification.findOne,
    notificationCreate: Notification.create,
    userFind: User.find,
    insertMany: UserNotification.insertMany,
  };
  let storedNotification = null;
  let notificationCreates = 0;
  let recipientCreates = 0;
  Notification.findOne = async () => storedNotification;
  Notification.create = async (data) => {
    notificationCreates += 1;
    storedNotification = { _id: notificationId, createdAt: new Date(), ...data };
    return storedNotification;
  };
  User.find = () => queryResult([{ _id: recipientId }]);
  UserNotification.insertMany = async (rows) => { recipientCreates += rows.length; return rows; };
  try {
    const args = {
      targetUserId: recipientId,
      title: 'Hoàn thành VALO AI',
      content: 'Tôi đã hoàn thành VALO AI ở Staff.',
      createdBy: new mongoose.Types.ObjectId(),
      aiDraftId: 'draft-integration-1',
    };
    await notificationDispatch.sendSingleUserNotification(args);
    await notificationDispatch.sendSingleUserNotification(args);
    assert.equal(notificationCreates, 1);
    assert.equal(recipientCreates, 1);
    assert.equal(storedNotification.targetType, 'SINGLE_USER');
    assert.equal(storedNotification.metadata.aiDraftId, 'draft-integration-1');
  } finally {
    Notification.findOne = originals.notificationFind;
    Notification.create = originals.notificationCreate;
    User.find = originals.userFind;
    UserNotification.insertMany = originals.insertMany;
  }
});

test('Staff chat resolves recipient then prepares title/content Draft without sending', async () => {
  const recipientId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const draftId = new mongoose.Types.ObjectId();
  const originals = {
    key: process.env.GEMINI_API_KEY,
    model: GoogleGenerativeAI.prototype.getGenerativeModel,
    search: notificationService.searchEligibleRecipients,
    userFindOne: User.findOne,
    draftCreate: AIDraft.create,
    audit: AIAuditLog.create,
    notificationCreate: Notification.create,
  };
  let step = 0;
  let notificationCreates = 0;
  process.env.GEMINI_API_KEY = 'test-key';
  notificationService.searchEligibleRecipients = async () => ({
    total: 1,
    items: [{ _id: recipientId, username: 'vyvo123', email: 'vyvo@example.com', role: 'staff', status: true }],
  });
  User.findOne = () => queryResult({ _id: recipientId, username: 'vyvo123', email: 'vyvo@example.com', role: 'staff', status: true });
  AIDraft.create = async (data) => ({ _id: draftId, ...data });
  AIAuditLog.create = async () => ({});
  Notification.create = async () => { notificationCreates += 1; };
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({
    generateContent: async (request) => {
      step += 1;
      if (step === 1) {
        assert.equal(request.toolConfig.functionCallingConfig.allowedFunctionNames.includes('search_notification_recipients'), true);
        const modelContent = { role: 'model', parts: [{ functionCall: { name: 'search_notification_recipients', args: { query: 'vyvo123' } }, thoughtSignature: 'recipient-search-signature' }] };
        return { response: { functionCalls: () => [{ name: 'search_notification_recipients', args: { query: 'vyvo123' } }], candidates: [{ content: modelContent }] } };
      }
      if (step === 2) {
        assert.equal(request.contents.some((entry) => entry.parts?.some((part) => part.thoughtSignature === 'recipient-search-signature')), true);
        const modelContent = { role: 'model', parts: [{ functionCall: { name: 'prepare_draft', args: {} }, thoughtSignature: 'draft-signature' }] };
        return { response: {
          functionCalls: () => [{ name: 'prepare_draft', args: {
            type: 'SEND_NOTIFICATION',
            payloadJson: JSON.stringify({ title: 'Hoàn thành VALO AI ở Staff', content: 'Tôi đã hoàn thành xong VALO AI ở Staff rồi.', expectedRecipientRole: 'staff' }),
            targetId: String(recipientId),
            reason: 'Staff yêu cầu chuẩn bị thông báo',
          } }],
          candidates: [{ content: modelContent }],
        } };
      }
      assert.equal(request.contents.some((entry) => entry.parts?.some((part) => part.thoughtSignature === 'draft-signature')), true);
      return { response: { functionCalls: () => [], text: () => 'Đã chuẩn bị bản nháp thông báo để bạn duyệt.' } };
    },
  });
  try {
    const result = await chat({
      message: 'hãy đặt thông báo đến cho vyvo123 là tôi đã hoàn thành xong VALO AI ở staff rồi. hãy tạo bản nháp',
      actorId: staffId,
      actorRole: 'staff',
    });
    assert.equal(result.type, 'draft');
    assert.equal(result.draft.type, 'SEND_NOTIFICATION');
    assert.equal(result.draft.payload.title, 'Hoàn thành VALO AI ở Staff');
    assert.equal(result.draft.current.role, 'staff');
    assert.equal(notificationCreates, 0);
  } finally {
    if (originals.key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originals.key;
    GoogleGenerativeAI.prototype.getGenerativeModel = originals.model;
    notificationService.searchEligibleRecipients = originals.search;
    User.findOne = originals.userFindOne;
    AIDraft.create = originals.draftCreate;
    AIAuditLog.create = originals.audit;
    Notification.create = originals.notificationCreate;
  }
});

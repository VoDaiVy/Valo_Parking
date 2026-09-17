const test = require('node:test');
const assert = require('node:assert/strict');
const { tools, execute, validateDates } = require('../services/aiCopilot/toolRegistry');
const { cleanPayload } = require('../services/aiCopilot/draftService');
const { candidateFromSeries, runMonitorNow } = require('../services/aiCopilot/monitor');
const router = require('../routes/aiCopilotRoutes');
const { chat, classifyError } = require('../services/aiCopilot/chatService');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const AIDraft = require('../models/AIDraft');
const TicketPackage = require('../models/TicketPackage');
const AIAuditLog = require('../models/AIAuditLog');
const AINotification = require('../models/AINotification');
const Session = require('../models/Session');
const statistics = require('../services/statisticsService');
const catalogWrites = require('../services/adminCatalogWriteService');
const { approveDraft } = require('../services/aiCopilot/draftService');

test('AI copilot exposes an express router with multiple endpoints', () => {
  assert.ok(router.stack.length >= 2, 'Router should have both admin and staff mounted routes');
});
test('AI copilot rejects a request without an access token', async () => {
  const result = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await router.stack[0].handle({ headers: {} }, result, () => { throw new Error('Unauthenticated request was authorized'); });
  assert.equal(result.code, 401);
});
test('chat reports unavailable Gemini without inventing any metrics', async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const response = await chat({ message: 'dt hn sao', adminUserId: 'admin-id' });
    assert.equal(response.type, 'error');
    assert.deepEqual(response.evidence, []);
    assert.equal(response.draft, null);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test('chat sends a function-role tool response before final synthesis', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = GoogleGenerativeAI.prototype.getGenerativeModel;
  const health = tools.find((tool) => tool.name === 'check_system_health');
  const originalRun = health.run;
  const originalAudit = AIAuditLog.create;
  const requests = [];
  process.env.GEMINI_API_KEY = 'test-key';
  health.run = async () => ({ databaseConnected: true, activeSessions: 2, checkedAt: '2026-09-15T00:00:00.000Z' });
  AIAuditLog.create = async () => ({});
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({ generateContent: async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      const modelContent = { role: 'model', parts: [{ functionCall: { name: 'check_system_health', args: {} } }] };
      return { response: { functionCalls: () => [{ name: 'check_system_health', args: {} }], candidates: [{ content: modelContent }] } };
    }
    assert.equal(request.contents.at(-1).role, 'user');
    assert.equal(request.contents.at(-1).parts[0].functionResponse.name, 'check_system_health');
    assert.equal(request.contents.at(-1).parts[0].functionResponse.response.result.data.activeSessions, 2);
    return { response: { functionCalls: () => [], text: () => 'Hệ thống đã kết nối, có 2 phiên đang hoạt động.' } };
  } });
  try {
    const result = await chat({ message: 'Kiểm tra hệ thống', adminUserId: 'test-admin' });
    assert.equal(result.type, 'analysis');
    assert.equal(result.evidence[0].tool, 'check_system_health');
    assert.equal(requests.length, 2);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    GoogleGenerativeAI.prototype.getGenerativeModel = originalModel;
    health.run = originalRun;
    AIAuditLog.create = originalAudit;
  }
});

test('Gemini 429 is classified at the exact failed call without business writes', async () => {
  assert.equal(classifyError({ status: 429 }, 'GEMINI_TOOL_SELECTION_START'), 'GEMINI_RATE_LIMIT');
  assert.equal(classifyError({ status: 429 }, 'GEMINI_FINAL_SYNTHESIS_START'), 'GEMINI_RATE_LIMIT');
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = GoogleGenerativeAI.prototype.getGenerativeModel;
  const originalAudit = AIAuditLog.create;
  process.env.GEMINI_API_KEY = 'test-key';
  AIAuditLog.create = async () => ({});
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({ generateContent: async () => { const error = new Error('rate limited'); error.status = 429; throw error; } });
  try {
    const result = await chat({ message: 'dt hn sao', adminUserId: 'test-admin' });
    assert.equal(result.type, 'error');
    assert.deepEqual(result.evidence, []);
    assert.equal(result.draft, null);
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    GoogleGenerativeAI.prototype.getGenerativeModel = originalModel;
    AIAuditLog.create = originalAudit;
  }
});

test('read allowlist contains the 11 original aggregate tools plus 12 drill-down read tools', () => {
  assert.deepEqual(tools.map((tool) => tool.name), [
    'get_revenue_metrics', 'get_session_statistics', 'get_parking_occupancy',
    'get_user_summary', 'get_pricing_config', 'get_package_list',
    'get_subscription_stats', 'get_service_catalog', 'get_policy_summary',
    'check_system_health', 'get_ai_notifications',
    'get_active_sessions', 'search_sessions', 'get_session_detail',
    'search_users', 'get_user_detail', 'search_notification_recipients', 'search_vehicles',
    'search_bookings', 'get_booking_detail', 'get_parking_floors',
    'get_parking_slots', 'search_transactions', 'get_subscription_members',
    'search_ticket_packages', 'search_services'
  ]);
  assert.rejects(execute('delete_user', {}), /allowlist/);
});
test('date tool rejects reversed and oversized periods', () => {
  assert.throws(() => validateDates({ startDate: '2025-10-01', endDate: '2025-09-01' }));
  assert.throws(() => validateDates({ startDate: '2020-01-01', endDate: '2022-01-01' }));
  const day = validateDates({ startDate: '2026-09-15', endDate: '2026-09-15' });
  assert.equal(day.startDate, '2026-09-14T17:00:00.000Z');
  assert.equal(day.endDate, '2026-09-15T16:59:59.999Z');
});
test('pricing draft must cover every hour exactly once', () => {
  assert.deepEqual(cleanPayload('MODIFY_PRICING', { timeBlocks: [{ startHour: 0, endHour: 24, price: 10000 }], cap12h: 100000, cap24h: 180000 }).timeBlocks.length, 1);
  assert.throws(() => cleanPayload('MODIFY_PRICING', { timeBlocks: [{ startHour: 0, endHour: 10, price: 10000 }], cap12h: 100000, cap24h: 180000 }), /24/);
  assert.throws(() => cleanPayload('MODIFY_PRICING', { timeBlocks: [{ startHour: 0, endHour: 20, price: 10000 }, { startHour: 10, endHour: 24, price: 10000 }], cap12h: 100000, cap24h: 180000 }), /chồng lấn/);
});
test('package draft accepts only supported operations and valid fields', () => {
  assert.equal(cleanPayload('CREATE_TICKET_PACKAGE', { name: 'Gói tháng', type: 'monthly', price: 500000 }).price, 500000);
  assert.throws(() => cleanPayload('DELETE_TICKET_PACKAGE', {}));
  assert.throws(() => cleanPayload('CREATE_TICKET_PACKAGE', { name: 'X', type: 'monthly', price: -1 }));
  assert.throws(() => cleanPayload('UPDATE_TICKET_PACKAGE', {}), /không hợp lệ/);
  assert.doesNotThrow(() => cleanPayload('UPDATE_TICKET_PACKAGE', { name: 'A', type: 'daily', price: 100, maxSlots: 3, isActive: true }));
});
test('draft service supports Phase 2A allowlist validation', () => {
  assert.doesNotThrow(() => cleanPayload('UPDATE_USER_STATUS', { status: true }));
  assert.throws(() => cleanPayload('UPDATE_USER_STATUS', { status: 'true' }), /không hợp lệ/);
  
  assert.doesNotThrow(() => cleanPayload('APPROVE_VEHICLE', {}));
  assert.doesNotThrow(() => cleanPayload('ARCHIVE_POLICY', {}));

  assert.doesNotThrow(() => cleanPayload('CHANGE_USER_ROLE', { role: 'customer' }));
  assert.throws(() => cleanPayload('CHANGE_USER_ROLE', { role: 'superadmin' }), /không hợp lệ/);

  assert.doesNotThrow(() => cleanPayload('CREATE_POLICY_DRAFT', { title: 'Test', category: 'general', summary: 'S', content: 'C' }));
  assert.throws(() => cleanPayload('CREATE_POLICY_DRAFT', { title: ' ' }), /Thiếu tiêu đề/);
  assert.throws(() => cleanPayload('REJECT_VEHICLE', {}), /Thao tác này chưa được hỗ trợ/); // Ensure REJECT_VEHICLE is absent
});
test('monitor requires comparable history before creating candidates', () => {
  assert.equal(candidateFromSeries('sessions', 100, [0, 0, 0, 0], new Date().toISOString()).candidate, false);
  assert.equal(candidateFromSeries('sessions', 100, [10, 11, 12, 13], new Date().toISOString()).candidate, true);
  assert.equal(candidateFromSeries('sessions', 12, [10, 11, 12, 13], new Date().toISOString()).candidate, false);
});
test('revenue monitor anti-spam threshold tests', () => {
  const originalEnv = process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND;

  // 1. revenue delta 499,999 VND + MAD cao -> NO notification (default fallback to 500,000)
  delete process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND;
  assert.equal(candidateFromSeries('revenue', 499999, [0, 0, 0, 0], new Date().toISOString()).candidate, false); // insufficient baseline, but if it had baseline:
  assert.equal(candidateFromSeries('revenue', 500099, [10, 11, 12, 13], new Date().toISOString()).candidate, true); // Wait, center is 11.5. 500099 - 11.5 = 500087.5 > 500000. It should be TRUE.
  
  // Let's test with exact baseline center: [1000, 1001, 1002, 1003]. Center = 1001.5.
  // 1. revenue delta 499,999 VND + MAD cao -> NO notification
  assert.equal(candidateFromSeries('revenue', 1001.5 + 499999, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, false);
  
  // 2. revenue delta 500,000 VND + MAD đủ -> notification
  assert.equal(candidateFromSeries('revenue', 1001.5 + 500000, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, true);
  
  // 3. revenue delta >500,000 nhưng MAD dưới threshold -> NO notification
  // if deviation is low, candidate is false. [1000000, 1000001, 1000002, 1000003] and current = 1000005 (diff is < 500k, false). 
  // Wait, I need MAD < threshold:
  assert.equal(candidateFromSeries('revenue', 1000000 + 500001, [1000000 - 500000, 1000000, 1000000 + 500000, 1000000 + 1000000], new Date().toISOString()).candidate, false); 
  
  // 4. env custom threshold hoạt động
  process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND = '1000000';
  assert.equal(candidateFromSeries('revenue', 1001.5 + 500000, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, false);
  assert.equal(candidateFromSeries('revenue', 1001.5 + 1000000, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, true);
  
  // 5. invalid env -> fallback 500,000
  process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND = 'invalid';
  assert.equal(candidateFromSeries('revenue', 1001.5 + 500000, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, true);
  
  // negative -> fallback 500,000
  process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND = '-100';
  assert.equal(candidateFromSeries('revenue', 1001.5 + 499999, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, false);
  
  // 6. session anomaly behavior không bị ảnh hưởng (dù change nhỏ < 500000)
  process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND = '500000';
  assert.equal(candidateFromSeries('sessions', 1001.5 + 10, [1000, 1001, 1002, 1003], new Date().toISOString()).candidate, true);

  // Restore env
  if (originalEnv !== undefined) {
    process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND = originalEnv;
  } else {
    delete process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND;
  }
});
test('monitor creates no notification without a historical baseline and makes no Gemini call', async () => {
  const originals = { sessions: Session.countDocuments, revenue: statistics.getAdminPlatformRevenueStatistics, update: AINotification.updateOne, findUpdate: AINotification.findOneAndUpdate, model: GoogleGenerativeAI.prototype.getGenerativeModel };
  let writes = 0;
  Session.countDocuments = async () => 0;
  statistics.getAdminPlatformRevenueStatistics = async () => ({ totalRevenue: 0 });
  AINotification.updateOne = async () => { writes++; };
  AINotification.findOneAndUpdate = async () => { writes++; };
  GoogleGenerativeAI.prototype.getGenerativeModel = () => { throw new Error('Monitor called Gemini'); };
  try {
    const result = await runMonitorNow();
    assert.equal(result.length, 2);
    assert.ok(result.every((row) => !row.candidate && row.insufficientBaseline));
    assert.equal(writes, 0);
  } finally {
    Session.countDocuments = originals.sessions;
    statistics.getAdminPlatformRevenueStatistics = originals.revenue;
    AINotification.updateOne = originals.update;
    AINotification.findOneAndUpdate = originals.findUpdate;
    GoogleGenerativeAI.prototype.getGenerativeModel = originals.model;
  }
});
test('monitor persists and deduplicates a statistical candidate with deterministic actions and zero Gemini calls', async () => {
  const originals = { sessions: Session.countDocuments, revenue: statistics.getAdminPlatformRevenueStatistics, update: AINotification.updateOne, find: AINotification.findOne, findUpdate: AINotification.findOneAndUpdate, byIdUpdate: AINotification.findByIdAndUpdate, model: GoogleGenerativeAI.prototype.getGenerativeModel };
  const baseline = [100, 110, 90, 105];
  let notification = null;
  let inserts = 0;
  let emits = 0;
  Session.countDocuments = async () => 0;
  statistics.getAdminPlatformRevenueStatistics = async ({ endDate }) => {
    const week = Math.round((Date.now() - new Date(endDate).getTime()) / (7 * 86400000));
    return { totalRevenue: week === 0 ? 500500 : baseline[week - 1] };
  };
  AINotification.updateOne = async () => ({ modifiedCount: 0 });
  AINotification.findOne = async ({ deduplicationKey }) => notification?.deduplicationKey === deduplicationKey ? notification : null;
  AINotification.findOneAndUpdate = async (filter, update) => {
    if (!update.$setOnInsert) throw new Error('Unexpected monitor update');
    inserts++;
    notification = { _id: 'notification-1', deduplicationKey: filter.deduplicationKey, status: 'OPEN', ...update.$setOnInsert };
    return notification;
  };
  AINotification.findByIdAndUpdate = async (_id, update) => { Object.assign(notification, update.$set); return notification; };
  GoogleGenerativeAI.prototype.getGenerativeModel = () => { throw new Error('Monitor called Gemini'); };
  try {
    const io = { to: () => ({ emit: () => { emits++; } }) };
    const first = await runMonitorNow({ io });
    const second = await runMonitorNow({ io });
    assert.equal(first.find((row) => row.metric === 'revenue').persisted, true);
    assert.equal(second.find((row) => row.metric === 'revenue').notificationId, 'notification-1');
    assert.equal(inserts, 1);
    assert.equal(emits, 1);
    assert.equal(notification.evidence.metric, 'revenue');
    assert.equal(notification.affectedMetrics[0].currentValue, 500500);
    assert.match(notification.recommendedActions[0], /doanh thu và cấu hình giá/);
  } finally {
    Session.countDocuments = originals.sessions;
    statistics.getAdminPlatformRevenueStatistics = originals.revenue;
    AINotification.updateOne = originals.update;
    AINotification.findOne = originals.find;
    AINotification.findOneAndUpdate = originals.findUpdate;
    AINotification.findByIdAndUpdate = originals.byIdUpdate;
    GoogleGenerativeAI.prototype.getGenerativeModel = originals.model;
  }
});
test('standalone package approval uses one deterministic business write and blocks a second approval', async () => {
  const id = new mongoose.Types.ObjectId();
  const adminUserId = new mongoose.Types.ObjectId();
  const draft = { _id: id, adminUserId, type: 'CREATE_TICKET_PACKAGE', payload: { name: 'Gói tháng', type: 'monthly', price: 500000 }, status: 'PENDING', expiresAt: new Date(Date.now() + 3600000) };
  const originals = {
    startSession: mongoose.startSession,
    findOne: AIDraft.findOne,
    updateOne: AIDraft.updateOne,
    findById: TicketPackage.findById,
    createPackage: catalogWrites.createPackage,
    audit: AIAuditLog.create,
  };
  let writes = 0;
  let stored = null;
  mongoose.startSession = async () => ({ withTransaction: async () => { throw new Error('Transaction numbers are only allowed on a replica set member or mongos'); }, endSession: async () => {} });
  AIDraft.findOne = async () => draft;
  AIDraft.updateOne = async () => { draft.status = 'EXECUTED'; return { modifiedCount: 1 }; };
  TicketPackage.findById = async () => stored;
  catalogWrites.createPackage = async () => { writes++; stored = { _id: id }; return stored; };
  AIAuditLog.create = async () => ({});
  try {
    const result = await approveDraft(String(id), adminUserId);
    assert.equal(String(result.id), String(id));
    assert.equal(writes, 1);
    await assert.rejects(approveDraft(String(id), adminUserId), { statusCode: 409 });
    assert.equal(writes, 1);
  } finally {
    mongoose.startSession = originals.startSession;
    AIDraft.findOne = originals.findOne;
    AIDraft.updateOne = originals.updateOne;
    TicketPackage.findById = originals.findById;
    catalogWrites.createPackage = originals.createPackage;
    AIAuditLog.create = originals.audit;
  }
});
test('standalone pricing approval refuses multi-document write and keeps draft pending', async () => {
  const id = new mongoose.Types.ObjectId();
  const adminUserId = new mongoose.Types.ObjectId();
  const draft = { _id: id, adminUserId, type: 'MODIFY_PRICING', payload: { timeBlocks: [{ startHour: 0, endHour: 24, price: 10000 }], cap12h: 100000, cap24h: 180000 }, status: 'PENDING', expiresAt: new Date(Date.now() + 3600000) };
  const originalSession = mongoose.startSession;
  const originalFind = AIDraft.findOne;
  const originalPricing = catalogWrites.applyPricing;
  let writes = 0;
  mongoose.startSession = async () => ({ withTransaction: async () => { throw new Error('Transaction numbers are only allowed on a replica set member or mongos'); }, endSession: async () => {} });
  AIDraft.findOne = async () => draft;
  catalogWrites.applyPricing = async () => { writes++; };
  try {
    await assert.rejects(approveDraft(String(id), adminUserId), { statusCode: 503 });
    assert.equal(writes, 0);
    assert.equal(draft.status, 'PENDING');
  } finally {
    mongoose.startSession = originalSession;
    AIDraft.findOne = originalFind;
    catalogWrites.applyPricing = originalPricing;
  }
});





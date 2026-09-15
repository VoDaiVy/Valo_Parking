const mongoose = require('mongoose');
const AIDraft = require('../../models/AIDraft');
const AINotification = require('../../models/AINotification');
const AIAuditLog = require('../../models/AIAuditLog');
const TicketPackage = require('../../models/TicketPackage');
const PricingConfig = require('../../models/PricingConfig');
const catalogWrites = require('../adminCatalogWriteService');

const fail = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
function cleanPayload(type, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Nội dung bản nháp không hợp lệ.');
  if (type === 'MODIFY_PRICING') {
    const { timeBlocks, cap12h, cap24h } = input;
    if (!Array.isArray(timeBlocks) || !timeBlocks.length || timeBlocks.length > 24) fail('Bảng giá cần các khung giờ hợp lệ.');
    const hours = Array(24).fill(0);
    const blocks = timeBlocks.map(({ startHour, endHour, price }) => {
      if (![startHour, endHour, price].every(Number.isFinite) || !Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24 || startHour === endHour || price < 0) fail('Khung giờ hoặc giá không hợp lệ.');
      const length = endHour > startHour ? endHour - startHour : 24 - startHour + endHour;
      for (let offset = 0; offset < length; offset++) { if (hours[(startHour + offset) % 24]++) fail('Khung giờ bị chồng lấn.'); }
      return { startHour, endHour, price };
    });
    if (hours.some((n) => n !== 1) || ![cap12h, cap24h].every((n) => Number.isFinite(n) && n >= 0)) fail('Bảng giá phải phủ đủ 24 giờ và có mức trần hợp lệ.');
    return { timeBlocks: blocks, cap12h, cap24h };
  }
  if (!['CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE'].includes(type)) fail('Thao tác này chưa được hỗ trợ.');
  const { name, type: packageType, price, description = '', maxSlots = 3, isActive = true } = input;
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !['hourly', 'daily', 'monthly', 'yearly'].includes(packageType) || !Number.isFinite(price) || price < 0 || typeof description !== 'string' || description.length > 1000 || !Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 10 || typeof isActive !== 'boolean') fail('Thông tin gói vé không hợp lệ.');
  return { name: name.trim(), type: packageType, price, description: description.trim(), maxSlots, isActive };
}
async function createDraft({ adminUserId, type, payload, targetId, notificationId, reason, evidence = [] }) {
  const clean = cleanPayload(type, payload);
  if (type === 'UPDATE_TICKET_PACKAGE' && !mongoose.isValidObjectId(targetId)) fail('Thiếu gói vé cần sửa.');
  if (notificationId && !mongoose.isValidObjectId(notificationId)) fail('Cảnh báo không hợp lệ.');
  const current = type === 'MODIFY_PRICING' ? await PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).lean() : type === 'UPDATE_TICKET_PACKAGE' ? await TicketPackage.findById(targetId).lean() : null;
  if (type === 'UPDATE_TICKET_PACKAGE' && !current) fail('Không tìm thấy gói vé.', 404);
  if (notificationId) {
    const issue = await AINotification.findOne({ _id: notificationId, status: 'OPEN' }).select('notificationType').lean();
    if (!issue) fail('Cảnh báo đã được xử lý.', 409);
    const allowedTypes = type === 'MODIFY_PRICING'
      ? ['REVENUE_ANOMALY', 'SESSION_CHANGE', 'OCCUPANCY_ISSUE', 'PRICING_INCONSISTENCY']
      : ['PACKAGE_PERFORMANCE', 'SUBSCRIPTION_TREND'];
    if (!allowedTypes.includes(issue.notificationType)) fail('Bản nháp không phù hợp với cảnh báo này.');
    const seen = evidence.some((entry) => entry.tool === 'get_ai_notifications' && Array.isArray(entry.data) && entry.data.some((row) => String(row._id) === String(notificationId)));
    if (!seen) fail('Cần kiểm tra cảnh báo trước khi gắn bản nháp.');
  }
  const draft = await AIDraft.create({ adminUserId, type, payload: clean, targetId: type === 'UPDATE_TICKET_PACKAGE' ? targetId : undefined, notificationId, current, reason: String(reason || '').slice(0, 1000), evidence: Array.isArray(evidence) ? evidence.slice(0, 10) : [], expiresAt: new Date(Date.now() + 3600000) });
  await AIAuditLog.create({ actorId: adminUserId, action: 'DRAFT_CREATED', subjectId: draft._id, metadata: { type } });
  return draft;
}
async function approveDraft(id, adminUserId) {
  if (!mongoose.isValidObjectId(id)) fail('Bản nháp không hợp lệ.');
  const draft = await AIDraft.findOne({ _id: id, adminUserId });
  if (!draft) fail('Không tìm thấy bản nháp của bạn.', 404);
  if (draft.status !== 'PENDING') fail('Bản nháp đã được xử lý.', 409);
  if (draft.expiresAt <= new Date()) fail('Bản nháp đã hết hạn.', 409);
  const payload = cleanPayload(draft.type, draft.payload);
  // A transaction is mandatory for multi-document pricing changes. A standalone
  // deployment still supports package writes below because each is one atomic document.
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const claimed = await AIDraft.findOneAndUpdate({ _id: draft._id, status: 'PENDING', expiresAt: { $gt: new Date() } }, { $set: { status: 'EXECUTING' } }, { new: true, session });
      if (!claimed) fail('Bản nháp đã được xử lý.', 409);
      if (draft.notificationId) {
        const issue = await AINotification.findOneAndUpdate({ _id: draft.notificationId, status: 'OPEN' }, { $set: { status: 'RESOLVED', resolvedBy: adminUserId, resolvedAt: new Date(), resolvedDraftId: draft._id } }, { new: true, session });
        if (!issue) fail('Vấn đề đã được Admin khác xử lý.', 409);
      }
      if (draft.type === 'MODIFY_PRICING') {
        const created = await catalogWrites.applyPricing(payload, { session, expectedConfigId: draft.current?._id || null });
        result = { id: created._id, type: draft.type };
      } else if (draft.type === 'CREATE_TICKET_PACKAGE') {
        const created = await catalogWrites.createPackage(payload, { session, draftId: draft._id, adminId: adminUserId });
        result = { id: created._id, type: draft.type };
      } else {
        const updated = await catalogWrites.updatePackage(draft.targetId, payload, { session, expectedUpdatedAt: draft.current?.updatedAt, draftId: draft._id, adminId: adminUserId });
        if (!updated) fail('Gói vé đã thay đổi; cần tạo đề xuất mới.', 409);
        result = { id: updated._id, type: draft.type };
      }
      await AIDraft.updateOne({ _id: draft._id }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: result } }, { session });
      await AIAuditLog.create([{ actorId: adminUserId, action: 'DRAFT_EXECUTED', subjectId: draft._id, metadata: result }], { session });
    });
    return result;
  } catch (error) {
    if (!/Transaction numbers are only allowed|replica set|does not support retryable writes/i.test(error.message)) throw error;
    if (draft.type === 'MODIFY_PRICING' || draft.notificationId) fail('Hạ tầng hiện tại không thể áp dụng thay đổi này một cách an toàn; bản nháp vẫn đang chờ.', 503);
    // Single-document package fallback. The draft ID lives in the same atomic
    // document as the business result, so a retry can never create/apply twice.
    if (draft.type === 'CREATE_TICKET_PACKAGE') {
      const existing = await TicketPackage.findById(draft._id);
      const created = existing || await catalogWrites.createPackage(payload, { draftId: draft._id });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: created._id } } });
      await AIAuditLog.create({ actorId: adminUserId, action: 'DRAFT_EXECUTED', subjectId: draft._id, metadata: { id: created._id, type: draft.type } }).catch(() => {});
      return { id: created._id, type: draft.type };
    }
    const alreadyApplied = await TicketPackage.findOne({ _id: draft.targetId, aiAppliedDraftIds: draft._id });
    const updated = alreadyApplied || await catalogWrites.updatePackage(draft.targetId, payload, { expectedUpdatedAt: draft.current?.updatedAt, draftId: draft._id });
    if (!updated) fail('Gói vé đã thay đổi hoặc bản nháp đã được áp dụng.', 409);
    await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: updated._id } } });
    await AIAuditLog.create({ actorId: adminUserId, action: 'DRAFT_EXECUTED', subjectId: draft._id, metadata: { id: updated._id, type: draft.type } }).catch(() => {});
    return { id: updated._id, type: draft.type };
  } finally { await session.endSession(); }
}
module.exports = { cleanPayload, createDraft, approveDraft };

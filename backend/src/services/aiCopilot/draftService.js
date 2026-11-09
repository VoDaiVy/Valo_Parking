const { createHash } = require('crypto');
const UserDetail = require('../../models/UserDetail');
const { profilePayload, assertPhoneAvailable, accountError } = require('./adminAccounts');
const mongoose = require('mongoose');
const AIDraft = require('../../models/AIDraft');
const AINotification = require('../../models/AINotification');
const AIAuditLog = require('../../models/AIAuditLog');
const TicketPackage = require('../../models/TicketPackage');
const PricingConfig = require('../../models/PricingConfig');
const User = require('../../models/User');
const Vehicle = require('../../models/Vehicle');
const Policy = require('../../models/Policy');
const catalogWrites = require('../adminCatalogWriteService');
const policyService = require('../policyService');
const notificationDispatch = require('../notificationDispatchService');

const fail = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
function cleanPayload(type, input) {
  if (['APPROVE_VEHICLE', 'ARCHIVE_POLICY', 'ARCHIVE_SERVICE', 'ARCHIVE_TICKET_PACKAGE'].includes(type)) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Nội dung bản nháp không hợp lệ.');
  if (type === 'MODIFY_PRICING') {
    const { timeBlocks, cap12h, cap24h, pricePolicies = [], dayNightPricing = {} } = input;
    if (!Array.isArray(timeBlocks) || !timeBlocks.length || timeBlocks.length > 24) fail('Bảng giá cần các khung giờ hợp lệ.');
    const hours = Array(24).fill(0);
    const blocks = timeBlocks.map(({ startHour, endHour, price }) => {
      if (![startHour, endHour, price].every(Number.isFinite) || !Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24 || startHour === endHour || price < 0) fail('Khung giờ hoặc giá không hợp lệ.');
      const length = endHour > startHour ? endHour - startHour : 24 - startHour + endHour;
      for (let offset = 0; offset < length; offset++) { if (hours[(startHour + offset) % 24]++) fail('Khung giờ bị chồng lấn.'); }
      return { startHour, endHour, price };
    });
    if (hours.some((n) => n !== 1) || ![cap12h, cap24h].every((n) => Number.isFinite(n) && n >= 0)) fail('Bảng giá phải phủ đủ 24 giờ và có mức trần hợp lệ.');
    if (!Array.isArray(pricePolicies) || pricePolicies.length > 100) fail('Danh sÃ¡ch chÃ­nh sÃ¡ch giÃ¡ khÃ´ng há»£p lá»‡.');
    const normalizeTwelveHourBlock = (value, fallbackStart, fallbackPrice) => {
      const block = value && typeof value === 'object' ? value : {};
      const startHour = block.startHour === undefined ? fallbackStart : Number(block.startHour);
      const price = block.price === undefined ? fallbackPrice : Number(block.price);
      if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23
        || !Number.isFinite(price) || price < 0 || typeof (block.isActive ?? false) !== 'boolean') {
        fail('Day/night pricing block is invalid.');
      }
      return { isActive: block.isActive === true, startHour, price };
    };
    const normalizedDayNight = {
      day: normalizeTwelveHourBlock(dayNightPricing.day, 6, 50000),
      night: normalizeTwelveHourBlock(dayNightPricing.night, 18, 70000),
    };
    if (normalizedDayNight.day.isActive && normalizedDayNight.night.isActive
      && (normalizedDayNight.day.startHour + 12) % 24 !== normalizedDayNight.night.startHour) {
      fail('Day and night pricing blocks must be consecutive and exactly 12 hours each.');
    }
    const policies = pricePolicies.map((policy) => {
      const name = typeof policy.name === 'string' ? policy.name.trim() : '';
      const scope = policy.scope;
      const adjustmentPercent = Number(policy.adjustmentPercent);
      const priority = Number(policy.priority || 0);
      if (!name || !['weekday', 'month', 'date_range'].includes(scope)
        || !Number.isFinite(adjustmentPercent) || adjustmentPercent < -100 || adjustmentPercent > 500
        || !Number.isInteger(priority) || priority < 0 || priority > 10000) {
        fail('ChÃ­nh sÃ¡ch giÃ¡ khÃ´ng há»£p lá»‡.');
      }
      const daysOfWeek = [...new Set((policy.daysOfWeek || []).map(Number))];
      const months = [...new Set((policy.months || []).map(Number))];
      const startDate = policy.startDate || null;
      const endDate = policy.endDate || null;
      if (scope === 'weekday' && (!daysOfWeek.length || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) fail('Vui lÃ²ng chá»n thá»© Ã¡p dá»¥ng.');
      if (scope === 'month' && (!months.length || months.some((month) => !Number.isInteger(month) || month < 1 || month > 12))) fail('Vui lÃ²ng chá»n thÃ¡ng Ã¡p dá»¥ng.');
      if (scope === 'date_range' && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || startDate > endDate)) fail('Khoáº£ng ngÃ y Ã¡p dá»¥ng khÃ´ng há»£p lá»‡.');
      return { name, scope, daysOfWeek, months, startDate, endDate, adjustmentPercent, priority, isActive: policy.isActive !== false };
    });
    return { timeBlocks: blocks, cap12h, cap24h, dayNightPricing: normalizedDayNight, pricePolicies: policies };
  }
  if (type === 'UPDATE_USER_STATUS') {
    if (typeof input.status !== 'boolean') fail('Trạng thái không hợp lệ.');
    return { status: input.status };
  }
  if (type === 'SEND_NOTIFICATION') {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!title || title.length > 200) fail('Tiêu đề thông báo phải dài từ 1 đến 200 ký tự.');
    if (!content || content.length > 2000) fail('Nội dung thông báo phải dài từ 1 đến 2000 ký tự.');
    return {
      title,
      content,
      expectedRecipientRole: typeof input.expectedRecipientRole === 'string'
        ? input.expectedRecipientRole.toLowerCase()
        : '',
    };
  }
  if (type === 'CHANGE_USER_ROLE') {
    if (!['guest', 'customer', 'staff', 'admin'].includes(input.role)) fail('Vai trò không hợp lệ.');
    return { role: input.role };
  }
  if (type === 'CREATE_POLICY_DRAFT') {
    const { title, category, summary, content, effectiveDate } = input;
    if (typeof title !== 'string' || !title.trim()) fail('Thiếu tiêu đề chính sách.');
    if (typeof category !== 'string' || !category.trim()) fail('Thiếu phân loại chính sách.');
    if (typeof content !== 'string' || !content.trim()) fail('Thiếu nội dung chính sách.');
    return { title: title.trim(), category: category.trim(), summary: summary?.trim() || '', content: content.trim(), effectiveDate };
  }
  if (type === 'UPDATE_USER_PROFILE') return profilePayload(input);
  if (type === 'CREATE_SERVICE' || type === 'UPDATE_SERVICE') {
    const { name, price, timeCost, description } = input;
    const allowed = {};
    if (name !== undefined) allowed.name = typeof name === 'string' ? name.trim() : name;
    if (price !== undefined) allowed.price = Number(price);
    if (timeCost !== undefined) allowed.timeCost = Number(timeCost);
    if (description !== undefined) allowed.description = typeof description === 'string' ? description.trim() : description;
    if (allowed.price !== undefined && (!Number.isFinite(allowed.price) || allowed.price < 0 || price === null || price === '')) fail('Service price must be a non-negative number.');
    if (allowed.timeCost !== undefined && (!Number.isInteger(allowed.timeCost) || allowed.timeCost < 1)) fail('Service duration must be a positive whole number of minutes.');
    if (allowed.name !== undefined && (typeof allowed.name !== 'string' || !allowed.name)) fail('Service name is required.');
    if (allowed.description !== undefined && (typeof allowed.description !== 'string' || !allowed.description)) fail('Service description is required.');
    if (type === 'UPDATE_SERVICE' && !Object.keys(allowed).length) fail('Specify a service field to change.');
    
    if (type === 'CREATE_SERVICE') {
      if (!allowed.name || allowed.price === undefined || !allowed.description) fail('Vui lòng cung cấp đầy đủ thông tin (name, description, price).');
    }
    return allowed;
  }
  if (!['CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE'].includes(type)) fail('Thao tác này chưa được hỗ trợ.');
  const {
    name,
    type: packageType,
    price,
    description = '',
    maxSlots = 3,
    isActive = true,
    renewalWindowDays = 7,
    isRenewable = true,
  } = input;
  if (
    typeof name !== 'string' || !name.trim() || name.length > 120 ||
    !['hourly', 'daily', 'monthly', 'yearly'].includes(packageType) ||
    !Number.isFinite(price) || price < 0 ||
    typeof description !== 'string' || description.length > 1000 ||
    !Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 10 ||
    typeof isActive !== 'boolean'
  ) fail('Thông tin gói vé không hợp lệ.');
  if (!Number.isInteger(renewalWindowDays) || renewalWindowDays < 1 || renewalWindowDays > 60)
    fail('renewalWindowDays phải là số nguyên từ 1 đến 60.');
  if (typeof isRenewable !== 'boolean')
    fail('isRenewable phải là boolean.');
  return {
    name: name.trim(),
    type: packageType,
    price,
    description: description.trim(),
    maxSlots,
    isActive,
    renewalWindowDays,
    isRenewable,
  };
}
const ACCOUNT_TYPES = new Set(['CHANGE_USER_ROLE', 'UPDATE_USER_STATUS', 'UPDATE_USER_PROFILE']);
async function authorizeAccountActor(adminUserId, actorRole, type, targetId) {
  const actor = await User.findById(adminUserId).select('role status').lean();
  if (!actor || !actor.status || actor.role !== actorRole || !['admin', 'staff'].includes(actorRole) || (actorRole === 'staff' && type !== 'UPDATE_USER_STATUS')) throw accountError('ACCOUNT_FORBIDDEN', 'You do not have permission to perform this action.', 403);
  if (String(adminUserId) === String(targetId) && type !== 'UPDATE_USER_PROFILE') throw accountError('SELF_PRIVILEGE_CHANGE', 'You cannot change your own role or account status because this could remove your administrative access. No changes were made.', 403);
}
function draftFailure(code, message, draft, statusCode = 409) {
  const error = accountError(code, message, statusCode); error.draftStatus = draft?.status; throw error;
}
async function approveAccountDraft(draft, adminUserId, actorRole) {
  await authorizeAccountActor(adminUserId, actorRole, draft.type, draft.targetId);
  if (draft.status === 'EXECUTED') return { ...draft.executionResult, status: 'EXECUTED', alreadyApplied: true };
  if (draft.status === 'REJECTED') draftFailure('DRAFT_REJECTED', 'This proposal was rejected. Request a new proposal.', draft);
  if (draft.status === 'EXECUTING') draftFailure('DRAFT_PROCESSING', 'This proposal is already being processed.', draft);
  if (draft.expiresAt <= new Date()) draftFailure('DRAFT_EXPIRED', 'This proposal has expired. Request a new proposal.', draft);
  let payload;
  try { payload = cleanPayload(draft.type, draft.payload); } catch (error) { error.approvalStage = 'VALIDATE_PAYLOAD'; throw error; }
  const session = await mongoose.startSession();
  let stage = 'START_TRANSACTION';
  try {
    let result;
    await session.withTransaction(async () => {
      // Fence the live actor as part of the same transaction. Role/status revocation
      // racing an approval must invalidate that approval, not reuse stale auth.
      stage = 'VERIFY_ACTOR';
      const actor = await User.findOneAndUpdate({ _id: adminUserId, role: actorRole, status: true }, { $inc: { __v: 1 } }, { session, new: true, timestamps: false });
      if (!actor) throw accountError('ACCOUNT_FORBIDDEN', 'Your account no longer has permission to apply this proposal.', 403);
      // Serialize account writes across Admin actors as well: phone uniqueness
      // and last-admin checks must not suffer snapshot-isolation write skew.
      // Reuse an existing document/version field; this does not alter profiles
      // or modification timestamps and requires no new schema or lock records.
      await User.findOneAndUpdate({ role: 'admin', status: true }, { $inc: { __v: 1 } }, { sort: { _id: 1 }, session, timestamps: false });
      stage = 'CLAIM_DRAFT';
      const claimed = await AIDraft.findOneAndUpdate({ _id: draft._id, adminUserId, status: 'PENDING', expiresAt: { $gt: new Date() } }, { $set: { status: 'EXECUTING' } }, { new: true, session });
      if (!claimed) {
        const latest = await AIDraft.findOne({ _id: draft._id, adminUserId }).session(session);
        if (latest?.status === 'EXECUTED') { result = { ...latest.executionResult, status: 'EXECUTED', alreadyApplied: true }; return; }
        draftFailure('DRAFT_NOT_PENDING', 'This proposal is no longer awaiting approval.', latest);
      }
      const live = await User.findById(draft.targetId).select('role status').session(session).lean();
      if (!live) throw accountError('ACCOUNT_NOT_FOUND', 'Account not found. No changes were made.', 404);
      if (actorRole === 'staff' && live.role !== 'customer') throw accountError('ACCOUNT_FORBIDDEN', 'Staff can only update customer status.', 403);
      stage = draft.type === 'UPDATE_USER_PROFILE' ? 'UPDATE_PROFILE' : 'UPDATE_ACCOUNT';
      let updated;
      if (draft.type === 'CHANGE_USER_ROLE') updated = await catalogWrites.changeUserRoleSafely(draft.targetId, payload.role, { session, expectedRole: draft.current?.role, adminId: adminUserId });
      else if (draft.type === 'UPDATE_USER_STATUS') updated = await catalogWrites.updateUserStatusSafely(draft.targetId, payload.status, { session, expectedStatus: draft.current?.status, adminId: adminUserId });
      else updated = await catalogWrites.updateUserProfileSafely(draft.targetId, payload, { session, expectedUpdatedAt: draft.current?.updatedAt, expectedProfileUpdatedAt: draft.current?.profileUpdatedAt, adminId: adminUserId });
      stage = 'FINALIZE_DRAFT';
      result = { id: updated.userId || updated._id, type: draft.type, status: 'EXECUTED' };
      await AIDraft.updateOne({ _id: draft._id, status: 'EXECUTING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: result } }, { session });
      await AIAuditLog.create([{ actorId: adminUserId, action: 'DRAFT_EXECUTED', subjectId: draft._id, metadata: result }], { session });
    });
    return result;
  } catch (error) {
    error.approvalStage ||= stage;
    if (/Transaction numbers are only allowed|replica set|does not support retryable writes/i.test(error.message)) throw Object.assign(accountError('TRANSACTIONS_REQUIRED', 'Account changes require transaction support. The proposal remains pending.', 503), { approvalStage: error.approvalStage });
    if (!error.publicMessage && error.statusCode === 409) throw Object.assign(accountError('ACCOUNT_CHANGED', 'This account changed since the proposal was prepared. Request a new proposal.', 409), { approvalStage: error.approvalStage });
    throw error;
  } finally { await session.endSession(); }
}
async function createDraft({ adminUserId, type, payload, targetId, notificationId, reason, evidence = [], actorRole = 'admin' }) {
  if (!['admin', 'staff'].includes(actorRole)) throw accountError('ACCOUNT_FORBIDDEN', 'You do not have permission to prepare a proposal.', 403);
  if (actorRole === 'staff' && !['UPDATE_USER_STATUS', 'SEND_NOTIFICATION'].includes(type)) {
    fail('Hành động không được phép đối với Staff.', 403);
  }
  if (actorRole === 'admin' && ACCOUNT_TYPES.has(type)) await authorizeAccountActor(adminUserId, actorRole, type, targetId);
  let clean = cleanPayload(type, payload);
  if (['UPDATE_TICKET_PACKAGE', 'UPDATE_USER_STATUS', 'SEND_NOTIFICATION', 'APPROVE_VEHICLE', 'ARCHIVE_POLICY', 'CHANGE_USER_ROLE', 'UPDATE_USER_PROFILE', 'ARCHIVE_TICKET_PACKAGE', 'UPDATE_SERVICE', 'ARCHIVE_SERVICE'].includes(type) && !mongoose.isValidObjectId(targetId)) fail('Thiếu mục tiêu cần xử lý.');
  if (notificationId && !mongoose.isValidObjectId(notificationId)) fail('Cảnh báo không hợp lệ.');
  
  let current = null;
  if (type === 'MODIFY_PRICING') {
    current = await PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  } else if (type === 'UPDATE_TICKET_PACKAGE') {
    current = await TicketPackage.findById(targetId).lean();
    if (!current) fail('Không tìm thấy gói vé.', 404);
  } else if (type === 'UPDATE_USER_STATUS' || type === 'CHANGE_USER_ROLE') {
    current = await User.findById(targetId).select('status username email role updatedAt').lean();
    if (type === 'CHANGE_USER_ROLE' && current?.role === clean.role) throw accountError('NO_CHANGE', 'The account already has this role. No changes are needed.', 409);
    if (type === 'UPDATE_USER_STATUS' && current?.status === clean.status) throw accountError('NO_CHANGE', 'The account already has this status. No changes are needed.', 409);
    if (!current) throw accountError('ACCOUNT_NOT_FOUND', 'Account not found. No changes were made.', 404);
    if (actorRole === 'staff' && current.role !== 'customer') fail('Không có quyền thao tác trên người dùng này.', 403);
  } else if (type === 'SEND_NOTIFICATION') {
    if (actorRole !== 'staff') fail('Hành động này chỉ dành cho Staff Notification Management.', 403);
    const recipientEvidence = [...evidence].reverse().find((entry) => entry.tool === 'search_notification_recipients');
    const items = Array.isArray(recipientEvidence?.data?.items) ? recipientEvidence.data.items : [];
    const exactMatchUserId = recipientEvidence?.data?.exactMatchUserId;
    const resolvedTargetId = exactMatchUserId || (recipientEvidence?.data?.total === 1 ? items[0]?._id : null);
    if (!resolvedTargetId || String(resolvedTargetId) !== String(targetId)) {
      fail('Người nhận chưa được xác định duy nhất từ công cụ tìm người nhận. Vui lòng chọn lại.', 400);
    }
    current = await User.findOne({ _id: targetId, status: true }).select('status username email role updatedAt').lean();
    if (!current) fail('Người nhận không tồn tại hoặc không còn hoạt động.', 404);
    clean = { ...clean, expectedRecipientRole: current.role };
  } else if (type === 'APPROVE_VEHICLE') {
    current = await Vehicle.findById(targetId).select('status licensePlate').lean();
    if (!current) fail('Không tìm thấy phương tiện.', 404);
    if (current.status !== 'pending') fail('Phương tiện không ở trạng thái chờ duyệt.', 400);
  } else if (type === 'ARCHIVE_POLICY') {
    current = await Policy.findById(targetId).select('status title').lean();
    if (!current) fail('Không tìm thấy chính sách.', 404);
    if (current.status === 'archived') fail('Chính sách đã được lưu trữ.', 400);
  } else if (type === 'UPDATE_USER_PROFILE') {
    current = await User.findById(targetId).select('updatedAt status username email role').lean();
    if (current) {
      const profile = await UserDetail.findOne({ userId: targetId }).select('firstName lastName phone updatedAt').lean();
      current.profile = profile ? { firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone } : { firstName: '', lastName: '', phone: '' };
      current.profileUpdatedAt = profile?.updatedAt || null;
      // Only requested values that actually differ belong in the executable delta.
      clean = Object.fromEntries(Object.entries(clean).filter(([field, value]) => current.profile[field] !== value));
      if (clean.phone !== undefined) await assertPhoneAvailable(clean.phone, targetId);
      if (!Object.keys(clean).length) throw accountError('NO_CHANGE', 'These profile values are already up to date.', 409);
    }
    if (!current) throw accountError('ACCOUNT_NOT_FOUND', 'Account not found. No changes were made.', 404);
  } else if (type === 'ARCHIVE_TICKET_PACKAGE') {
    current = await TicketPackage.findById(targetId).select('updatedAt isActive').lean();
    if (!current) fail('Không tìm thấy gói vé.', 404);
    if (!current.isActive) fail('Gói vé đã được lưu trữ.', 400);
  } else if (type === 'UPDATE_SERVICE' || type === 'ARCHIVE_SERVICE') {
    const records = evidence.filter(entry => ['get_service_catalog', 'search_services', 'get_service_detail'].includes(entry.tool)).flatMap(entry => Array.isArray(entry.data) ? entry.data : entry.data?.items || [entry.data]);
    if (!records.some(record => String(record?._id) === String(targetId))) fail('Read the exact service before preparing a proposal.');
    const Service = require('../../models/Service');
    current = await Service.findById(targetId).select('_id name price timeCost description updatedAt isActive').lean();
    if (!current) fail('Không tìm thấy dịch vụ.', 404);
    if (type === 'ARCHIVE_SERVICE' && !current.isActive) fail('Dịch vụ đã được lưu trữ.', 400);
  }

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
  const hasTargetId = ['UPDATE_TICKET_PACKAGE', 'UPDATE_USER_STATUS', 'SEND_NOTIFICATION', 'APPROVE_VEHICLE', 'ARCHIVE_POLICY', 'CHANGE_USER_ROLE', 'UPDATE_USER_PROFILE', 'ARCHIVE_TICKET_PACKAGE', 'UPDATE_SERVICE', 'ARCHIVE_SERVICE'].includes(type);
  let accountDraftId;
  if (actorRole === 'admin' && ACCOUNT_TYPES.has(type)) {
    const seen = evidence.filter(entry => ['search_users', 'get_user_detail', 'get_current_user'].includes(entry.tool)).flatMap(entry => entry.data?.items || (entry.data ? [entry.data] : []));
    if (!seen.some(row => String(row._id) === String(targetId))) throw accountError('UNVERIFIED_TARGET', 'Look up the exact account before preparing a proposal.');
    const previous = await AIDraft.findOne({ adminUserId, type, targetId, payload: clean }).sort({ createdAt: -1 });
    if (previous?.status === 'PENDING' && previous.expiresAt > new Date()) {
      const unchanged = type === 'CHANGE_USER_ROLE' ? previous.current?.role === current.role : type === 'UPDATE_USER_STATUS' ? previous.current?.status === current.status : new Date(previous.current?.updatedAt).getTime() === new Date(current.updatedAt).getTime() && (previous.current?.profileUpdatedAt ? new Date(previous.current.profileUpdatedAt).getTime() : null) === (current.profileUpdatedAt ? new Date(current.profileUpdatedAt).getTime() : null);
      if (unchanged) return previous;
      await AIDraft.updateOne({ _id: previous._id, status: 'PENDING' }, { $set: { expiresAt: new Date() } });
    }
    if (previous?.status === 'EXECUTING') draftFailure('DRAFT_PROCESSING', 'An identical proposal is already being processed.', previous);
    accountDraftId = new mongoose.Types.ObjectId(createHash('sha256').update(JSON.stringify({ actor: String(adminUserId), type, target: String(targetId), clean, snapshot: current, previous: previous?._id })).digest('hex').slice(0, 24));
  }
  let draft;
  try {
    draft = await AIDraft.create({ ...(accountDraftId ? { _id: accountDraftId } : {}), adminUserId, type, payload: clean, targetId: hasTargetId ? targetId : undefined, notificationId, current, reason: String(reason || '').slice(0, 1000), evidence: Array.isArray(evidence) ? evidence.slice(0, 10) : [], expiresAt: new Date(Date.now() + 3600000) });
  } catch (error) {
    if (accountDraftId && error.code === 11000) {
      const existing = await AIDraft.findOne({ _id: accountDraftId, adminUserId });
      if (existing?.status === 'PENDING' && existing.expiresAt > new Date()) return existing;
      draftFailure('DRAFT_PROCESSING', 'This proposal is already being processed. Refresh its status.', existing);
    }
    throw error;
  }
  await AIAuditLog.create({ actorId: adminUserId, action: 'DRAFT_CREATED', subjectId: draft._id, metadata: { type } }).catch(() => console.warn('[VALO_AI] Draft audit write failed'));
  return draft;
}

async function approveSendNotification(draft, staffUserId, app) {
  const payload = cleanPayload('SEND_NOTIFICATION', draft.payload);
  if (draft.status === 'PENDING') {
    const claimed = await AIDraft.findOneAndUpdate(
      { _id: draft._id, adminUserId: staffUserId, status: 'PENDING', expiresAt: { $gt: new Date() } },
      { $set: { status: 'EXECUTING' } },
      { new: true }
    );
    if (!claimed) fail('Bản nháp đã được xử lý.', 409);
  } else if (draft.status !== 'EXECUTING') {
    fail('Bản nháp đã được xử lý.', 409);
  }

  try {
    const liveRecipient = await User.findOne({ _id: draft.targetId, status: true })
      .select('_id username email role status')
      .lean();
    if (!liveRecipient) fail('Người nhận không tồn tại hoặc không còn hoạt động.', 404);

    const { notification } = await notificationDispatch.sendSingleUserNotification({
      io: app?.get?.('io'),
      targetUserId: liveRecipient._id,
      title: payload.title,
      content: payload.content,
      type: 'SYSTEM',
      priority: 'INFO',
      createdBy: staffUserId,
      aiDraftId: draft._id,
    });
    const result = {
      id: notification._id,
      notificationId: notification._id,
      type: draft.type,
      recipientId: liveRecipient._id,
      recipientRole: liveRecipient.role,
    };
    await AIDraft.updateOne(
      { _id: draft._id, adminUserId: staffUserId, status: 'EXECUTING' },
      { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: result } }
    );
    await AIAuditLog.create({ actorId: staffUserId, action: 'DRAFT_EXECUTED', subjectId: draft._id, metadata: result }).catch(() => {});
    return result;
  } catch (error) {
    const existing = await notificationDispatch.findDraftNotification(draft._id).catch(() => null);
    if (existing) {
      const result = {
        id: existing._id,
        notificationId: existing._id,
        type: draft.type,
        recipientId: draft.targetId,
      };
      await AIDraft.updateOne(
        { _id: draft._id, adminUserId: staffUserId, status: 'EXECUTING' },
        { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: result } }
      );
      return result;
    }
    await AIDraft.updateOne(
      { _id: draft._id, adminUserId: staffUserId, status: 'EXECUTING' },
      { $set: { status: 'PENDING' } }
    ).catch(() => {});
    throw error;
  }
}

async function approveDraft(id, adminUserId, actorRole = 'admin', app = null) {
  if (!mongoose.isValidObjectId(id)) fail('Bản nháp không hợp lệ.');
  const draft = await AIDraft.findOne({ _id: id, adminUserId });
  if (!draft) fail('Không tìm thấy bản nháp của bạn.', 404);
  if (actorRole === 'admin' && ACCOUNT_TYPES.has(draft.type)) return approveAccountDraft(draft, adminUserId, actorRole);
  if (draft.type === 'SEND_NOTIFICATION') {
    if (actorRole !== 'staff') fail('Hành động không được phép.', 403);
    if (draft.status === 'PENDING' && draft.expiresAt <= new Date()) fail('Bản nháp đã hết hạn.', 409);
    return approveSendNotification(draft, adminUserId, app);
  }
  if (draft.status !== 'PENDING') fail('Bản nháp đã được xử lý.', 409);
  if (draft.expiresAt <= new Date()) fail('Bản nháp đã hết hạn.', 409);

  if (actorRole === 'staff') {
    if (draft.type !== 'UPDATE_USER_STATUS') fail('Hành động không được phép đối với Staff.', 403);
    const liveTarget = await User.findById(draft.targetId).select('role status').lean();
    if (!liveTarget) fail('Mục tiêu không tồn tại.', 404);
    if (liveTarget.role !== 'customer') fail('Không có quyền thao tác trên người dùng này.', 403);
    if (liveTarget.status !== draft.current?.status) fail('Trạng thái của người dùng đã thay đổi, vui lòng tạo đề xuất mới.', 409);
  }

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
      } else if (draft.type === 'UPDATE_USER_STATUS') {
        const updated = await catalogWrites.updateUserStatusSafely(draft.targetId, payload.status, { session, expectedStatus: draft.current?.status, adminId: adminUserId });
        result = { id: updated._id, type: draft.type };
      } else if (draft.type === 'CHANGE_USER_ROLE') {
        const updated = await catalogWrites.changeUserRoleSafely(draft.targetId, payload.role, { session, expectedRole: draft.current?.role, adminId: adminUserId });
        result = { id: updated._id, type: draft.type };
      } else if (draft.type === 'APPROVE_VEHICLE') {
        const updated = await catalogWrites.approveVehicleSafely(draft.targetId, { session, expectedStatus: draft.current?.status, adminId: adminUserId });
        result = { id: updated._id, type: draft.type };
      } else if (draft.type === 'CREATE_POLICY_DRAFT') {
        const policyDraft = await policyService.createPolicyWithDraft(payload, adminUserId);
        result = { id: policyDraft.policy._id, type: draft.type };
      } else if (draft.type === 'ARCHIVE_POLICY') {
        if (draft.current?.status === 'archived') fail('Chính sách đã được lưu trữ.', 400);
        const archived = await policyService.archivePolicy(draft.targetId, adminUserId);
        result = { id: archived._id, type: draft.type };
      } else if (draft.type === 'UPDATE_USER_PROFILE') {
        const updated = await catalogWrites.updateUserProfileSafely(draft.targetId, payload, { session, expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
        result = { id: updated.userId, type: draft.type };
      } else if (draft.type === 'ARCHIVE_TICKET_PACKAGE') {
        const archived = await catalogWrites.archivePackageSafely(draft.targetId, { session, expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
        result = { id: archived._id, type: draft.type };
      } else if (draft.type === 'CREATE_SERVICE') {
        const created = await catalogWrites.createServiceSafely(payload, { session, adminId: adminUserId });
        result = { id: created._id, type: draft.type };
      } else if (draft.type === 'UPDATE_SERVICE') {
        const updated = await catalogWrites.updateServiceSafely(draft.targetId, payload, { session, expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
        result = { id: updated._id, type: draft.type };
      } else if (draft.type === 'ARCHIVE_SERVICE') {
        const archived = await catalogWrites.archiveServiceSafely(draft.targetId, { session, expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
        result = { id: archived._id, type: draft.type };
      } else if (draft.type === 'UPDATE_TICKET_PACKAGE') {
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
    } else if (draft.type === 'UPDATE_USER_PROFILE') {
      const updated = await catalogWrites.updateUserProfileSafely(draft.targetId, payload, { expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: updated.userId } } });
      return { id: updated.userId, type: draft.type };
    } else if (draft.type === 'ARCHIVE_TICKET_PACKAGE') {
      const archived = await catalogWrites.archivePackageSafely(draft.targetId, { expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: archived._id } } });
      return { id: archived._id, type: draft.type };
    } else if (draft.type === 'CREATE_SERVICE') {
      const created = await catalogWrites.createServiceSafely(payload, { adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: created._id } } });
      return { id: created._id, type: draft.type };
    } else if (draft.type === 'UPDATE_SERVICE') {
      const updated = await catalogWrites.updateServiceSafely(draft.targetId, payload, { expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: updated._id } } });
      return { id: updated._id, type: draft.type };
    } else if (draft.type === 'ARCHIVE_SERVICE') {
      const archived = await catalogWrites.archiveServiceSafely(draft.targetId, { expectedUpdatedAt: draft.current?.updatedAt, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: archived._id } } });
      return { id: archived._id, type: draft.type };
    } else if (draft.type === 'UPDATE_USER_STATUS') {
      const updated = await catalogWrites.updateUserStatusSafely(draft.targetId, payload.status, { expectedStatus: draft.current?.status, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: updated._id } } });
      return { id: updated._id, type: draft.type };
    } else if (draft.type === 'CHANGE_USER_ROLE') {
      const updated = await catalogWrites.changeUserRoleSafely(draft.targetId, payload.role, { expectedRole: draft.current?.role, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: updated._id } } });
      return { id: updated._id, type: draft.type };
    } else if (draft.type === 'APPROVE_VEHICLE') {
      const updated = await catalogWrites.approveVehicleSafely(draft.targetId, { expectedStatus: draft.current?.status, adminId: adminUserId });
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: updated._id } } });
      return { id: updated._id, type: draft.type };
    } else if (draft.type === 'CREATE_POLICY_DRAFT') {
      const policyDraft = await policyService.createPolicyWithDraft(payload, adminUserId);
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: policyDraft.policy._id } } });
      return { id: policyDraft.policy._id, type: draft.type };
    } else if (draft.type === 'ARCHIVE_POLICY') {
      if (draft.current?.status === 'archived') fail('Chính sách đã được lưu trữ.', 400);
      const archived = await policyService.archivePolicy(draft.targetId, adminUserId);
      await AIDraft.updateOne({ _id: draft._id, status: 'PENDING' }, { $set: { status: 'EXECUTED', executedAt: new Date(), executionResult: { id: archived._id } } });
      return { id: archived._id, type: draft.type };
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

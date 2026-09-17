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
  if (type === 'UPDATE_USER_PROFILE') {
    const { firstName, lastName, phone } = input;
    const allowed = {};
    if (typeof firstName === 'string') allowed.firstName = firstName.trim();
    if (typeof lastName === 'string') allowed.lastName = lastName.trim();
    if (typeof phone === 'string') allowed.phone = phone.trim();
    return allowed;
  }
  if (type === 'CREATE_SERVICE' || type === 'UPDATE_SERVICE') {
    const { name, price, timeCost, description } = input;
    const allowed = {};
    if (name !== undefined) allowed.name = typeof name === 'string' ? name.trim() : name;
    if (price !== undefined) allowed.price = Number(price);
    if (timeCost !== undefined) allowed.timeCost = Number(timeCost);
    if (description !== undefined) allowed.description = typeof description === 'string' ? description.trim() : description;
    
    if (type === 'CREATE_SERVICE') {
      if (!allowed.name || allowed.price === undefined || !allowed.description) fail('Vui lòng cung cấp đầy đủ thông tin (name, description, price).');
    }
    return allowed;
  }
  if (!['CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE'].includes(type)) fail('Thao tác này chưa được hỗ trợ.');
  const { name, type: packageType, price, description = '', maxSlots = 3, isActive = true } = input;
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !['hourly', 'daily', 'monthly', 'yearly'].includes(packageType) || !Number.isFinite(price) || price < 0 || typeof description !== 'string' || description.length > 1000 || !Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 10 || typeof isActive !== 'boolean') fail('Thông tin gói vé không hợp lệ.');
  return { name: name.trim(), type: packageType, price, description: description.trim(), maxSlots, isActive };
}
async function createDraft({ adminUserId, type, payload, targetId, notificationId, reason, evidence = [], actorRole = 'admin' }) {
  if (actorRole === 'staff' && !['UPDATE_USER_STATUS', 'SEND_NOTIFICATION'].includes(type)) {
    fail('Hành động không được phép đối với Staff.', 403);
  }
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
    current = await User.findById(targetId).select('status username email role').lean();
    if (!current) fail('Không tìm thấy người dùng.', 404);
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
    current = await User.findOne({ _id: targetId, status: true }).select('status username email role').lean();
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
    current = await User.findById(targetId).select('updatedAt status').lean();
    if (!current) fail('Không tìm thấy người dùng.', 404);
  } else if (type === 'ARCHIVE_TICKET_PACKAGE') {
    current = await TicketPackage.findById(targetId).select('updatedAt isActive').lean();
    if (!current) fail('Không tìm thấy gói vé.', 404);
    if (!current.isActive) fail('Gói vé đã được lưu trữ.', 400);
  } else if (type === 'UPDATE_SERVICE' || type === 'ARCHIVE_SERVICE') {
    const Service = require('../../models/Service');
    current = await Service.findById(targetId).select('updatedAt isActive').lean();
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
  const draft = await AIDraft.create({ adminUserId, type, payload: clean, targetId: hasTargetId ? targetId : undefined, notificationId, current, reason: String(reason || '').slice(0, 1000), evidence: Array.isArray(evidence) ? evidence.slice(0, 10) : [], expiresAt: new Date(Date.now() + 3600000) });
  await AIAuditLog.create({ actorId: adminUserId, action: 'DRAFT_CREATED', subjectId: draft._id, metadata: { type } });
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

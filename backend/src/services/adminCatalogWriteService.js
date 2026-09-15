const PricingConfig = require('../models/PricingConfig');
const TicketPackage = require('../models/TicketPackage');
const AdminActionLog = require('../models/AdminActionLog');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');

async function applyPricing(payload, { session, expectedConfigId } = {}) {
  const query = PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 });
  const active = await (session ? query.session(session) : query);
  if (expectedConfigId !== undefined && String(active?._id || '') !== String(expectedConfigId || '')) {
    const error = new Error('Bảng giá đã thay đổi; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  await PricingConfig.updateMany({ isActive: true }, { $set: { isActive: false } }, session ? { session } : {});
  const [created] = await PricingConfig.create([{ ...payload, isActive: true }], session ? { session } : {});
  return created;
}
async function createPackage(payload, { session, draftId, adminId } = {}) {
  const doc = { ...payload, ...(draftId ? { _id: draftId, aiDraftId: draftId } : {}) };
  const [created] = await TicketPackage.create([doc], session ? { session } : {});
  if (adminId) await AdminActionLog.create([{ action: 'Created Ticket Package', target: `${created.name} • ${created.type}`, type: 'create', adminId }], session ? { session } : {});
  return created;
}
async function updatePackage(id, payload, { session, expectedUpdatedAt, draftId, adminId } = {}) {
  const filter = { _id: id };
  if (expectedUpdatedAt) filter.updatedAt = expectedUpdatedAt;
  if (draftId) filter.aiAppliedDraftIds = { $ne: draftId };
  const change = draftId ? { $set: payload, $addToSet: { aiAppliedDraftIds: draftId } } : { $set: payload };
  const updated = await TicketPackage.findOneAndUpdate(filter, change, { new: true, runValidators: true, ...(session ? { session } : {}) });
  if (updated && adminId) await AdminActionLog.create([{ action: 'Updated Ticket Package', target: `${updated.name} • ${updated.type}`, type: 'update', adminId }], session ? { session } : {});
  return updated;
}
async function updateUserStatusSafely(id, status, { session, expectedStatus, adminId } = {}) {
  const user = await (session ? User.findById(id).session(session) : User.findById(id));
  if (!user) {
    const error = new Error('Không tìm thấy người dùng.'); error.statusCode = 404; throw error;
  }
  if (String(id) === String(adminId)) {
    const error = new Error('Không thể tự khóa tài khoản của chính mình.'); error.statusCode = 400; throw error;
  }
  if (expectedStatus !== undefined && user.status !== expectedStatus) {
    const error = new Error('Trạng thái người dùng đã thay đổi; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  if (user.status === status) return user; // No change needed

  user.status = status;
  await (session ? user.save({ session }) : user.save());
  
  if (adminId) {
    await AdminActionLog.create([{ 
      action: status ? "Unblocked User Account" : "Blocked User Account", 
      target: `ID #${user._id.toString().slice(-4)} • ${user.email}`, 
      type: status ? "update" : "block", 
      adminId 
    }], session ? { session } : {});
  }
  return user;
}

async function approveVehicleSafely(id, { session, expectedStatus, adminId } = {}) {
  const vehicle = await (session ? Vehicle.findById(id).session(session) : Vehicle.findById(id));
  if (!vehicle) {
    const error = new Error('Không tìm thấy phương tiện.'); error.statusCode = 404; throw error;
  }
  if (expectedStatus !== undefined && vehicle.status !== expectedStatus) {
    const error = new Error('Trạng thái phương tiện đã thay đổi; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  if (vehicle.status === 'approved') return vehicle; // Already approved
  
  vehicle.status = 'approved';
  await (session ? vehicle.save({ session }) : vehicle.save());
  
  // Missing log in original controller, but good to have
  if (adminId) {
    await AdminActionLog.create([{ 
      action: 'Approved Vehicle', 
      target: `${vehicle.licensePlate}`, 
      type: 'update', 
      adminId 
    }], session ? { session } : {});
  }
  return vehicle;
}

async function changeUserRoleSafely(id, role, { session, expectedRole, adminId } = {}) {
  if (!['guest', 'customer', 'staff', 'admin'].includes(role)) {
    const error = new Error('Vai trò không hợp lệ.'); error.statusCode = 400; throw error;
  }
  const user = await (session ? User.findById(id).session(session) : User.findById(id));
  if (!user) {
    const error = new Error('Không tìm thấy người dùng.'); error.statusCode = 404; throw error;
  }
  if (String(id) === String(adminId)) {
    const error = new Error('Không thể tự thay đổi vai trò của chính mình.'); error.statusCode = 400; throw error;
  }
  if (expectedRole !== undefined && user.role !== expectedRole) {
    const error = new Error('Vai trò của người dùng đã thay đổi; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  if (user.role === role) return user;

  if (user.role === 'admin' && role !== 'admin') {
    const adminCount = await (session ? User.countDocuments({ role: 'admin' }).session(session) : User.countDocuments({ role: 'admin' }));
    if (adminCount <= 1) {
      const error = new Error('Không thể hạ quyền quản trị viên duy nhất còn lại.'); error.statusCode = 400; throw error;
    }
  }

  const oldRole = user.role;
  user.role = role;
  await (session ? user.save({ session }) : user.save());
  
  if (adminId) {
    await AdminActionLog.create([{ 
      action: `Changed User Role from ${oldRole} to ${role}`, 
      target: `ID #${user._id.toString().slice(-4)} • ${user.email}`, 
      type: 'update', 
      adminId 
    }], session ? { session } : {});
  }
  return user;
}

module.exports = { applyPricing, createPackage, updatePackage, updateUserStatusSafely, approveVehicleSafely, changeUserRoleSafely };

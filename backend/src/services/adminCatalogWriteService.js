const PricingConfig = require('../models/PricingConfig');
const TicketPackage = require('../models/TicketPackage');
const AdminActionLog = require('../models/AdminActionLog');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Service = require('../models/Service');
const BookingService = require('../models/BookingService');
const Subscription = require('../models/Subscription');
const UserDetail = require('../models/UserDetail');

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

// 1. createServiceSafely
async function createServiceSafely(payload, { session, adminId } = {}) {
  const { name, price, timeCost, description } = payload;
  
  if (!name || !description || price === undefined) {
    const error = new Error('Vui lòng cung cấp đầy đủ thông tin (name, description, price).'); error.statusCode = 400; throw error;
  }
  const parsedPrice = Number(price);
  if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
    const error = new Error('Giá phải là số không âm.'); error.statusCode = 400; throw error;
  }
  const parsedTimeCost = timeCost === undefined ? 30 : Number(timeCost);
  if (!Number.isInteger(parsedTimeCost) || parsedTimeCost < 1) {
    const error = new Error('Thời gian thực hiện (phút) phải là số nguyên >= 1.'); error.statusCode = 400; throw error;
  }
  
  const doc = {
    name, description, price: parsedPrice, timeCost: parsedTimeCost, isActive: true
  };
  
  const [created] = await Service.create([doc], session ? { session } : {});
  if (adminId) {
    await AdminActionLog.create([{ action: 'Created Service (AI)', target: created.name, type: 'create', adminId }], session ? { session } : {});
  }
  return created;
}

// 2. updateServiceSafely
async function updateServiceSafely(id, payload, { session, expectedUpdatedAt, adminId } = {}) {
  const filter = { _id: id };
  if (expectedUpdatedAt) filter.updatedAt = expectedUpdatedAt;
  
  const allowedKeys = ['name', 'price', 'timeCost', 'description'];
  const change = {};
  for (const key of allowedKeys) {
    if (payload[key] !== undefined) change[key] = payload[key];
  }
  if (Object.keys(change).length === 0) {
    const error = new Error('Không có trường nào hợp lệ để cập nhật.'); error.statusCode = 400; throw error;
  }
  if (change.price !== undefined) {
    change.price = Number(change.price);
    if (!Number.isFinite(change.price) || change.price < 0) {
      const error = new Error('Giá không hợp lệ.'); error.statusCode = 400; throw error;
    }
  }
  if (change.timeCost !== undefined) {
    change.timeCost = Number(change.timeCost);
    if (!Number.isInteger(change.timeCost) || change.timeCost < 1) {
      const error = new Error('Thời gian (phút) không hợp lệ.'); error.statusCode = 400; throw error;
    }
  }

  const updated = await Service.findOneAndUpdate(filter, { $set: change }, { new: true, runValidators: true, ...(session ? { session } : {}) });
  if (!updated) {
    const error = new Error('Dịch vụ đã thay đổi trạng thái hoặc không tồn tại, cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  if (adminId) {
    await AdminActionLog.create([{ action: 'Updated Service (AI)', target: updated.name, type: 'update', adminId }], session ? { session } : {});
  }
  return updated;
}

// 3. archiveServiceSafely
async function archiveServiceSafely(id, { session, expectedUpdatedAt, adminId } = {}) {
  const service = await (session ? Service.findById(id).session(session) : Service.findById(id));
  if (!service) {
    const error = new Error('Không tìm thấy dịch vụ.'); error.statusCode = 404; throw error;
  }
  if (expectedUpdatedAt !== undefined && new Date(service.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
    const error = new Error('Dịch vụ đã thay đổi trạng thái; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  if (!service.isActive) return service; // Already archived

  // Check dependencies: active or pending bookings
  const activeBookings = await (session ? BookingService.findOne({ serviceId: id, status: { $in: ['pending', 'in_progress'] } }).session(session) : BookingService.findOne({ serviceId: id, status: { $in: ['pending', 'in_progress'] } }));
  if (activeBookings) {
    const error = new Error('Không thể lưu trữ dịch vụ vì có đơn đặt đang chờ hoặc đang thực hiện.'); error.statusCode = 409; throw error;
  }

  service.isActive = false;
  await (session ? service.save({ session }) : service.save());

  if (adminId) {
    await AdminActionLog.create([{ action: 'Archived Service (AI)', target: service.name, type: 'update', adminId }], session ? { session } : {});
  }
  return service;
}

// 4. updateUserProfileSafely
async function updateUserProfileSafely(id, payload, { session, expectedUpdatedAt, adminId } = {}) {
  const user = await (session ? User.findById(id).session(session) : User.findById(id));
  if (!user) {
    const error = new Error('Không tìm thấy người dùng.'); error.statusCode = 404; throw error;
  }
  if (expectedUpdatedAt !== undefined && new Date(user.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
    const error = new Error('Trạng thái người dùng đã thay đổi; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }

  const allowedKeys = ['firstName', 'lastName', 'phone'];
  const change = {};
  for (const key of allowedKeys) {
    if (payload[key] !== undefined) change[key] = payload[key];
  }
  if (Object.keys(change).length === 0) {
    const error = new Error('Không có trường nào hợp lệ để cập nhật.'); error.statusCode = 400; throw error;
  }

  let userDetail = await (session ? UserDetail.findOne({ userId: user._id }).session(session) : UserDetail.findOne({ userId: user._id }));
  if (!userDetail) {
    userDetail = new UserDetail({ userId: user._id });
  }

  if (change.phone !== undefined) {
    let cleanPhone = change.phone.replace(/[^\d+]/g, '');
    if (cleanPhone) {
      if (cleanPhone.startsWith('84') && cleanPhone.length === 11) {
        cleanPhone = '0' + cleanPhone.slice(2);
      } else if (cleanPhone.startsWith('+84')) {
        cleanPhone = '0' + cleanPhone.slice(3);
      }
      
      const phoneVariants = [cleanPhone, cleanPhone.replace(/^0/, '84'), cleanPhone.replace(/^0/, '+84')];
      const existingUserWithPhone = await (session ? UserDetail.findOne({ phone: { $in: phoneVariants }, userId: { $ne: user._id } }).session(session) : UserDetail.findOne({ phone: { $in: phoneVariants }, userId: { $ne: user._id } }));
      
      if (existingUserWithPhone) {
        const error = new Error('Số điện thoại này đã được liên kết với tài khoản khác.'); error.statusCode = 400; throw error;
      }
      change.phone = cleanPhone;
    }
  }

  if (change.firstName !== undefined) userDetail.firstName = change.firstName;
  if (change.lastName !== undefined) userDetail.lastName = change.lastName;
  if (change.phone !== undefined) userDetail.phone = change.phone;
  
  await (session ? userDetail.save({ session }) : userDetail.save());
  
  user.updatedAt = new Date();
  await (session ? user.save({ session }) : user.save());

  if (adminId) {
    await AdminActionLog.create([{ action: 'Updated User Profile (AI)', target: `ID #${user._id.toString().slice(-4)} • ${user.email}`, type: 'update', adminId }], session ? { session } : {});
  }
  return userDetail;
}

// 5. archivePackageSafely
async function archivePackageSafely(id, { session, expectedUpdatedAt, adminId } = {}) {
  const pkg = await (session ? TicketPackage.findById(id).session(session) : TicketPackage.findById(id));
  if (!pkg) {
    const error = new Error('Không tìm thấy gói vé.'); error.statusCode = 404; throw error;
  }
  if (expectedUpdatedAt !== undefined && new Date(pkg.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
    const error = new Error('Gói vé đã thay đổi trạng thái; cần tạo đề xuất mới.'); error.statusCode = 409; throw error;
  }
  if (!pkg.isActive) return pkg;

  const activeSubs = await (session ? Subscription.findOne({ ticketPackage: id, status: { $in: ['pending', 'active'] } }).session(session) : Subscription.findOne({ ticketPackage: id, status: { $in: ['pending', 'active'] } }));
  if (activeSubs) {
    const error = new Error('Không thể lưu trữ gói vé vì đang có người đăng ký sử dụng (active/pending).'); error.statusCode = 409; throw error;
  }

  pkg.isActive = false;
  await (session ? pkg.save({ session }) : pkg.save());

  if (adminId) {
    await AdminActionLog.create([{ action: 'Archived Ticket Package (AI)', target: `${pkg.name} • ${pkg.type}`, type: 'update', adminId }], session ? { session } : {});
  }
  return pkg;
}

module.exports = { applyPricing, createPackage, updatePackage, updateUserStatusSafely, approveVehicleSafely, changeUserRoleSafely, createServiceSafely, updateServiceSafely, archiveServiceSafely, updateUserProfileSafely, archivePackageSafely };

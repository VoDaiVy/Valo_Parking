const { describe, it, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const Service = require('../models/Service');
const BookingService = require('../models/BookingService');
const TicketPackage = require('../models/TicketPackage');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const UserDetail = require('../models/UserDetail');
const AdminActionLog = require('../models/AdminActionLog');

const {
  createServiceSafely,
  updateServiceSafely,
  archiveServiceSafely,
  updateUserProfileSafely,
  archivePackageSafely
} = require('../services/adminCatalogWriteService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/valo_parking_test_admin_catalog';

describe('Admin Catalog Write Service (Safe Actions)', () => {
  let adminId = new mongoose.Types.ObjectId();
  
  after(async () => {
    await mongoose.disconnect();
  });
  
  beforeEach(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI);
    }
    await Promise.all([
      Service.deleteMany({}),
      BookingService.deleteMany({}),
      TicketPackage.deleteMany({}),
      Subscription.deleteMany({}),
      User.deleteMany({}),
      UserDetail.deleteMany({}),
      AdminActionLog.deleteMany({})
    ]);
  });
  
  afterEach(async () => {
    // cleanup after each
  });

  describe('createServiceSafely', () => {
    it('valid service succeeds', async () => {
      const payload = { name: 'Wash', description: 'Car wash', price: 50000, timeCost: 20 };
      const srv = await createServiceSafely(payload, { adminId });
      assert.strictEqual(srv.name, 'Wash');
      assert.strictEqual(srv.price, 50000);
      assert.strictEqual(srv.timeCost, 20);
      assert.strictEqual(srv.isActive, true);
    });
    
    it('unsupported fields cannot be injected', async () => {
      const payload = { name: 'Wash', description: 'Car wash', price: 50000, timeCost: 20, isActive: false, _id: new mongoose.Types.ObjectId() };
      const srv = await createServiceSafely(payload, { adminId });
      // doc forces isActive: true regardless of payload
      assert.strictEqual(srv.isActive, true);
      assert.notStrictEqual(String(srv._id), String(payload._id));
    });
  });

  describe('updateServiceSafely', () => {
    it('allowed delta succeeds', async () => {
      const srv = await Service.create({ name: 'W1', description: 'desc', price: 100, timeCost: 10, imageUrl: 'url', cloudinary_id: 'cid' });
      const updated = await updateServiceSafely(srv._id, { price: 200 }, { adminId });
      assert.strictEqual(updated.price, 200);
      assert.strictEqual(updated.name, 'W1');
    });

    it('unsupported field rejected', async () => {
      const srv = await Service.create({ name: 'W1', description: 'desc', price: 100, timeCost: 10, imageUrl: 'url', cloudinary_id: 'cid' });
      await assert.rejects(updateServiceSafely(srv._id, { imageUrl: 'hacked' }, { adminId }), /Không có trường nào hợp lệ/);
    });

    it('stale state rejected', async () => {
      const srv = await Service.create({ name: 'W1', description: 'desc', price: 100, timeCost: 10, imageUrl: 'url', cloudinary_id: 'cid' });
      const fakeDate = new Date(Date.now() - 10000);
      await assert.rejects(updateServiceSafely(srv._id, { price: 200 }, { expectedUpdatedAt: fakeDate, adminId }), /Dịch vụ đã thay đổi/);
    });
  });

  describe('archiveServiceSafely', () => {
    it('active dependency blocks archive', async () => {
      const srv = await Service.create({ name: 'W1', description: 'desc', price: 100, timeCost: 10, imageUrl: 'url', cloudinary_id: 'cid' });
      const bookingId = new mongoose.Types.ObjectId();
      await BookingService.create({ bookingId, serviceId: srv._id, serviceName: 'W1', price: 100, timeCost: 10, status: 'pending' });
      await assert.rejects(archiveServiceSafely(srv._id, { adminId }), /Không thể lưu trữ dịch vụ/);
    });

    it('safe service archives/deactivates and no hard delete occurs', async () => {
      const srv = await Service.create({ name: 'W1', description: 'desc', price: 100, timeCost: 10, imageUrl: 'url', cloudinary_id: 'cid', isActive: true });
      const bookingId = new mongoose.Types.ObjectId();
      await BookingService.create({ bookingId, serviceId: srv._id, serviceName: 'W1', price: 100, timeCost: 10, status: 'done' });
      
      const archived = await archiveServiceSafely(srv._id, { adminId });
      assert.strictEqual(archived.isActive, false);
      const inDb = await Service.findById(srv._id);
      assert.strictEqual(inDb.isActive, false);
    });
  });

  describe('updateUserProfileSafely', () => {
    it('allowed delta succeeds', async () => {
      const u = await User.create({ username: 'user1', email: 'u@v.c', password: 'password123', role: 'customer' });
      const updated = await updateUserProfileSafely(u._id, { firstName: 'Hoa' }, { adminId });
      assert.strictEqual(updated.firstName, 'Hoa');
    });

    it('role/status/security fields cannot be changed', async () => {
      const u = await User.create({ username: 'user1', email: 'u@v.c', password: 'password123', role: 'customer' });
      await assert.rejects(updateUserProfileSafely(u._id, { role: 'admin', status: false }, { adminId }), /Không có trường nào hợp lệ/);
    });

    it('uniqueness/validation preserved', async () => {
      const u1 = await User.create({ username: 'user1', email: 'u1@v.c', password: 'password123' });
      const u2 = await User.create({ username: 'user2', email: 'u2@v.c', password: 'password123' });
      await UserDetail.create({ userId: u1._id, phone: '0901234567' });
      
      // Update u2 to have u1's phone
      await assert.rejects(updateUserProfileSafely(u2._id, { phone: '0901234567' }, { adminId }), /được liên kết với tài khoản khác/);
    });
    
    it('stale state rejected', async () => {
      const u = await User.create({ username: 'user1', email: 'u@v.c', password: 'password123', role: 'customer' });
      const fakeDate = new Date(Date.now() - 10000);
      await assert.rejects(updateUserProfileSafely(u._id, { firstName: 'H' }, { expectedUpdatedAt: fakeDate, adminId }), /Trạng thái người dùng đã thay đổi/);
    });
  });

  describe('archivePackageSafely', () => {
    it('unsafe active subscription dependency blocks', async () => {
      const u = await User.create({ username: 'user123', email: 'u@u.c', password: 'password123' });
      const pkg = await TicketPackage.create({ name: 'P', type: 'monthly', price: 100 });
      const floor = new mongoose.Types.ObjectId();
      await Subscription.create({ user: u._id, ticketPackage: pkg._id, slots: [{floorId: floor, slotCode: 'A1'}], amount: 100, orderCode: 1, expireAt: new Date(), status: 'active' });
      
      await assert.rejects(archivePackageSafely(pkg._id, { adminId }), /Không thể lưu trữ gói vé/);
    });

    it('historical non-blocking dependency behaves correctly', async () => {
      const u = await User.create({ username: 'user124', email: 'u2@u.c', password: 'password123' });
      const pkg = await TicketPackage.create({ name: 'P2', type: 'monthly', price: 100 });
      const floor = new mongoose.Types.ObjectId();
      await Subscription.create({ user: u._id, ticketPackage: pkg._id, slots: [{floorId: floor, slotCode: 'A1'}], amount: 100, orderCode: 2, expireAt: new Date(Date.now()-1000), status: 'expired' });
      
      const archived = await archivePackageSafely(pkg._id, { adminId });
      assert.strictEqual(archived.isActive, false);
      const inDb = await TicketPackage.findById(pkg._id);
      assert.strictEqual(inDb.isActive, false);
    });
  });
});

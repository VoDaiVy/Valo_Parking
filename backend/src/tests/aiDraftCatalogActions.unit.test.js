const { describe, it, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const AIDraft = require('../models/AIDraft');
const User = require('../models/User');
const UserDetail = require('../models/UserDetail');
const Service = require('../models/Service');
const BookingService = require('../models/BookingService');
const TicketPackage = require('../models/TicketPackage');
const Subscription = require('../models/Subscription');
const draftService = require('../services/aiCopilot/draftService');
const { chat } = require('../services/aiCopilot/chatService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/valo_parking_test_ai_draft';

describe('AI Draft Catalog Actions Execution & Wiring', () => {
  let adminUserId = new mongoose.Types.ObjectId();

  after(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI);
    }
    await Promise.all([
      AIDraft.deleteMany({}),
      User.deleteMany({}),
      UserDetail.deleteMany({}),
      Service.deleteMany({}),
      BookingService.deleteMany({}),
      TicketPackage.deleteMany({}),
      Subscription.deleteMany({})
    ]);
  });

  it('1. UPDATE_USER_PROFILE tạo Draft nhưng chưa thay DB', async () => {
    const u = await User.create({ username: 'testu', email: 't@t.c', password: 'password123' });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_USER_PROFILE',
      targetId: u._id,
      payload: { firstName: 'Hoa' }
    });
    assert.strictEqual(draft.status, 'PENDING');
    assert.strictEqual(draft.type, 'UPDATE_USER_PROFILE');
    const uAfter = await UserDetail.findOne({ userId: u._id });
    assert.ok(!uAfter || !uAfter.firstName); // Not updated yet
  });

  it('2. Approve mới thay phone/name', async () => {
    const u = await User.create({ username: 'testu', email: 't@t.c', password: 'password123' });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_USER_PROFILE',
      targetId: u._id,
      payload: { firstName: 'Hoa', phone: '0901234567' }
    });
    await draftService.approveDraft(draft._id, adminUserId);
    const detail = await UserDetail.findOne({ userId: u._id });
    assert.strictEqual(detail.firstName, 'Hoa');
    assert.strictEqual(detail.phone, '0901234567');
  });

  it('3. Payload cố đổi role/email bị strip/reject', async () => {
    const u = await User.create({ username: 'testu', email: 't@t.c', password: 'password123', role: 'customer' });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_USER_PROFILE',
      targetId: u._id,
      payload: { firstName: 'Hoa', role: 'admin', email: 'hack@v.c' }
    });
    // Should be stripped at creation by cleanPayload
    assert.strictEqual(draft.payload.role, undefined);
    assert.strictEqual(draft.payload.email, undefined);
    assert.strictEqual(draft.payload.firstName, 'Hoa');
    
    await draftService.approveDraft(draft._id, adminUserId);
    const uDb = await User.findById(u._id);
    assert.strictEqual(uDb.role, 'customer');
    assert.strictEqual(uDb.email, 't@t.c');
  });

  it('4. Stale profile -> 409', async () => {
    const u = await User.create({ username: 'testu', email: 't@t.c', password: 'password123' });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_USER_PROFILE',
      targetId: u._id,
      payload: { firstName: 'Hoa' }
    });
    // Simulate other admin update
    await User.updateOne({ _id: u._id }, { $set: { updatedAt: new Date(Date.now() + 10000) } });
    await assert.rejects(draftService.approveDraft(draft._id, adminUserId), /Trạng thái người dùng đã thay đổi/);
  });

  it('5. CREATE_SERVICE Draft chưa tạo Service trước approval', async () => {
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'CREATE_SERVICE',
      payload: { name: 'Wash', price: 100, timeCost: 30, description: 'Desc' }
    });
    assert.strictEqual(draft.status, 'PENDING');
    const count = await Service.countDocuments();
    assert.strictEqual(count, 0);
  });

  it('6. Approve tạo đúng 1 Service, 8. Không fake cloudinary_id', async () => {
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'CREATE_SERVICE',
      payload: { name: 'Wash', price: 100, timeCost: 30, description: 'Desc' }
    });
    const result = await draftService.approveDraft(draft._id, adminUserId);
    const srv = await Service.findById(result.id);
    assert.ok(srv);
    assert.strictEqual(srv.name, 'Wash');
    assert.strictEqual(srv.imageUrl, '');
    assert.strictEqual(srv.cloudinary_id, '');
  });

  it('7. Double approve không tạo Service thứ hai', async () => {
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'CREATE_SERVICE',
      payload: { name: 'Wash', price: 100, timeCost: 30, description: 'Desc' }
    });
    await draftService.approveDraft(draft._id, adminUserId);
    await assert.rejects(draftService.approveDraft(draft._id, adminUserId), /Bản nháp đã được xử lý/);
    const count = await Service.countDocuments();
    assert.strictEqual(count, 1);
  });

  it('9. UPDATE_SERVICE delta update đúng field', async () => {
    const srv = await Service.create({ name: 'W1', description: 'Desc', price: 100, timeCost: 10 });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_SERVICE',
      targetId: srv._id,
      payload: { price: 200 }
    });
    await draftService.approveDraft(draft._id, adminUserId);
    const updated = await Service.findById(srv._id);
    assert.strictEqual(updated.price, 200);
    assert.strictEqual(updated.name, 'W1');
  });

  it('10. ARCHIVE_SERVICE dependency -> 409', async () => {
    const srv = await Service.create({ name: 'W1', description: 'Desc', price: 100, timeCost: 10 });
    await BookingService.create({ bookingId: new mongoose.Types.ObjectId(), serviceId: srv._id, serviceName: 'W1', price: 100, timeCost: 10, status: 'pending' });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'ARCHIVE_SERVICE',
      targetId: srv._id,
      payload: {}
    });
    await assert.rejects(draftService.approveDraft(draft._id, adminUserId), /Không thể lưu trữ dịch vụ/);
  });

  it('11. ARCHIVE_TICKET_PACKAGE active subscription -> 409', async () => {
    const pkg = await TicketPackage.create({ name: 'P', type: 'monthly', price: 100 });
    const u = await User.create({ username: 'user1', email: 'u@v.c', password: 'password123' });
    await Subscription.create({ user: u._id, ticketPackage: pkg._id, slots: [{floorId: new mongoose.Types.ObjectId(), slotCode: 'A1'}], amount: 100, orderCode: 1, expireAt: new Date(), status: 'active' });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'ARCHIVE_TICKET_PACKAGE',
      targetId: pkg._id,
      payload: {}
    });
    await assert.rejects(draftService.approveDraft(draft._id, adminUserId), /Không thể lưu trữ gói vé/);
  });

  it('12. Reject Draft -> DB unchanged', async () => {
    const srv = await Service.create({ name: 'W1', description: 'Desc', price: 100, timeCost: 10 });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_SERVICE',
      targetId: srv._id,
      payload: { price: 200 }
    });
    await AIDraft.updateOne({ _id: draft._id }, { $set: { status: 'REJECTED' } });
    await assert.rejects(draftService.approveDraft(draft._id, adminUserId), /Bản nháp đã được xử lý/);
    const updated = await Service.findById(srv._id);
    assert.strictEqual(updated.price, 100);
  });

  it('13. Existing Draft actions vẫn hoạt động', async () => {
    const u = await User.create({ username: 'user1', email: 'u@v.c', password: 'password123', status: true });
    const draft = await draftService.createDraft({
      adminUserId,
      type: 'UPDATE_USER_STATUS',
      targetId: u._id,
      payload: { status: false }
    });
    await draftService.approveDraft(draft._id, adminUserId);
    const updated = await User.findById(u._id);
    assert.strictEqual(updated.status, false);
  });

  it('14. Gemini function-call regression', async () => {
    // Basic test to see if chat initializes without breaking
    const res = await chat({ message: 'Hello', adminUserId, actorId: adminUserId, actorRole: 'admin' });
    assert.ok(res);
  });
});

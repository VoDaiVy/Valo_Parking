const mongoose = require('mongoose');
const { test, describe, before, after, beforeEach, it } = require('node:test');
const assert = require('node:assert');
const { createDraft, approveDraft } = require('../services/aiCopilot/draftService');
const PricingConfig = require('../models/PricingConfig');
const TicketPackage = require('../models/TicketPackage');
const Subscription = require('../models/Subscription');
const User = require('../models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/valo_parking_test_ai_pricing';

describe('AI Copilot - Pricing & Ticket Package Actions', () => {
  let adminUserId;
  let staffUserId;
  let customerUserId;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI);
    }
    await User.deleteMany({});
    
    const admin = await User.create({ username: 'admin1', email: 'admin1@valo.com', password: 'password123', role: 'admin' });
    const staff = await User.create({ username: 'staff1', email: 'staff1@valo.com', password: 'password123', role: 'staff' });
    const customer = await User.create({ username: 'cust1', email: 'cust1@valo.com', password: 'password123', role: 'customer' });
    adminUserId = admin._id;
    staffUserId = staff._id;
    customerUserId = customer._id;
  });

  after(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await PricingConfig.deleteMany({});
    await TicketPackage.deleteMany({});
    await Subscription.deleteMany({});
  });

  describe('Pricing Actions', () => {
    it('1. Create pricing delta draft and apply (preserves others)', async () => {
      const activeConfig = await PricingConfig.create({
        timeBlocks: [
          { startHour: 7, endHour: 12, price: 10000 },
          { startHour: 12, endHour: 17, price: 10000 },
          { startHour: 17, endHour: 22, price: 20000 },
          { startHour: 22, endHour: 7, price: 25000 }
        ],
        cap12h: 100000,
        cap24h: 180000,
        isActive: true
      });

      // User wants to change 12-17 to 15000. AI creates draft.
      const draft = await createDraft({
        adminUserId,
        actorRole: 'admin',
        type: 'MODIFY_PRICING',
        payload: {
          timeBlocks: [
            { startHour: 7, endHour: 12, price: 10000 },
            { startHour: 12, endHour: 17, price: 15000 }, // Changed
            { startHour: 17, endHour: 22, price: 20000 },
            { startHour: 22, endHour: 7, price: 25000 }
          ],
          cap12h: 100000,
          cap24h: 180000
        },
        evidence: [{ tool: 'get_pricing_config', data: {} }, { tool: 'get_revenue_metrics', data: {} }]
      });

      assert.strictEqual(draft.status, 'PENDING');
      
      // Since local test DB is standalone, approveDraft would throw 503.
      // We will test the business logic directly.
      const catalogWrites = require('../services/adminCatalogWriteService');
      const newConfig = await catalogWrites.applyPricing(draft.payload);

      assert.ok(newConfig);
      assert.strictEqual(newConfig.timeBlocks[1].price, 15000);
      assert.strictEqual(newConfig.timeBlocks[2].price, 20000); // Preserved

      const oldConfig = await PricingConfig.findById(activeConfig._id);
      assert.strictEqual(oldConfig.isActive, false);
    });

    it('2. Rejects invalid pricing (overlap/gaps)', async () => {
      await assert.rejects(
        createDraft({
          adminUserId,
          actorRole: 'admin',
          type: 'MODIFY_PRICING',
          payload: {
            timeBlocks: [
              { startHour: 7, endHour: 14, price: 10000 },
              { startHour: 12, endHour: 17, price: 15000 }, // Overlaps
              { startHour: 17, endHour: 22, price: 20000 },
              { startHour: 22, endHour: 7, price: 25000 }
            ],
            cap12h: 100000,
            cap24h: 180000
          },
          evidence: [{ tool: 'get_pricing_config', data: {} }, { tool: 'get_revenue_metrics', data: {} }]
        }),
        /Khung giờ bị chồng lấn/
      );
    });
  });

  describe('Ticket Package Actions', () => {
    it('3. Rejects CREATE_TICKET_PACKAGE with missing fields', async () => {
      await assert.rejects(
        createDraft({
          adminUserId,
          actorRole: 'admin',
          type: 'CREATE_TICKET_PACKAGE',
          payload: { name: 'Package', type: 'hourly' }, // missing price
          evidence: [{ tool: 'get_package_list', data: {} }]
        }),
        /Thông tin gói vé không hợp lệ/
      );
    });

    it('4. Rejects invalid package type', async () => {
      await assert.rejects(
        createDraft({
          adminUserId,
          actorRole: 'admin',
          type: 'CREATE_TICKET_PACKAGE',
          payload: { name: 'Package', type: 'invalid_enum', price: 100, description: 'Desc' },
          evidence: [{ tool: 'get_package_list', data: {} }]
        }),
        /Thông tin gói vé không hợp lệ/
      );
    });

    it('5. Approves CREATE_TICKET_PACKAGE with full fields', async () => {
      const draft = await createDraft({
        adminUserId,
        actorRole: 'admin',
        type: 'CREATE_TICKET_PACKAGE',
        payload: { name: 'Standard Hourly', type: 'hourly', price: 20000, description: 'Standard hourly package', maxSlots: 3, isActive: true },
        evidence: [{ tool: 'get_package_list', data: {} }]
      });

      assert.strictEqual(draft.status, 'PENDING');
      const res = await approveDraft(draft._id, adminUserId, 'admin');
      
      const pkg = await TicketPackage.findById(res.id);
      assert.strictEqual(pkg.name, 'Standard Hourly');
      assert.strictEqual(pkg.type, 'hourly');
      assert.strictEqual(pkg.price, 20000);
    });

    it('6. UPDATE_TICKET_PACKAGE preserves other fields (delta update)', async () => {
      const pkg = await TicketPackage.create({ name: 'Standard Daily', type: 'daily', price: 150000, description: 'Daily pkg', isActive: true });

      const draft = await createDraft({
        adminUserId,
        actorRole: 'admin',
        type: 'UPDATE_TICKET_PACKAGE',
        targetId: pkg._id,
        payload: { name: 'Standard Daily', type: 'daily', price: 120000, description: 'Daily pkg', maxSlots: 3, isActive: true }, // Emulating a delta update payload where AI keeps other fields
        evidence: [{ tool: 'search_ticket_packages', data: {} }]
      });

      await approveDraft(draft._id, adminUserId, 'admin');
      
      const updated = await TicketPackage.findById(pkg._id);
      assert.strictEqual(updated.price, 120000);
      assert.strictEqual(updated.description, 'Daily pkg'); // preserved
    });

    it('7. ARCHIVE_TICKET_PACKAGE rejects if there is active dependency', async () => {
      const pkg = await TicketPackage.create({ name: 'Standard Monthly', type: 'monthly', price: 1000000, isActive: true });
      await Subscription.create({ user: customerUserId, ticketPackage: pkg._id, status: 'active', orderCode: 123456, amount: 1000000, validFrom: new Date(), expireAt: new Date(Date.now() + 86400000) });

      const draft = await createDraft({
        adminUserId,
        actorRole: 'admin',
        type: 'ARCHIVE_TICKET_PACKAGE',
        targetId: pkg._id,
        payload: {},
        evidence: [{ tool: 'search_ticket_packages', data: {} }]
      });

      await assert.rejects(
        approveDraft(draft._id, adminUserId, 'admin'),
        /Không thể lưu trữ gói vé vì đang có người đăng ký sử dụng/
      );

      const unchanged = await TicketPackage.findById(pkg._id);
      assert.strictEqual(unchanged.isActive, true);
    });

    it('8. ARCHIVE_TICKET_PACKAGE succeeds if no active dependency', async () => {
      const pkg = await TicketPackage.create({ name: 'Standard Monthly', type: 'monthly', price: 1000000, isActive: true });

      const draft = await createDraft({
        adminUserId,
        actorRole: 'admin',
        type: 'ARCHIVE_TICKET_PACKAGE',
        targetId: pkg._id,
        payload: {},
        evidence: [{ tool: 'search_ticket_packages', data: {} }]
      });

      await approveDraft(draft._id, adminUserId, 'admin');

      const updated = await TicketPackage.findById(pkg._id);
      assert.strictEqual(updated.isActive, false); // Semantics of archive
    });
    
    it('9. Double approve executes only once (idempotent)', async () => {
      const pkg = await TicketPackage.create({ name: 'Special Monthly', type: 'monthly', price: 1000000, isActive: true });

      const draft = await createDraft({
        adminUserId,
        actorRole: 'admin',
        type: 'ARCHIVE_TICKET_PACKAGE',
        targetId: pkg._id,
        payload: {},
        evidence: [{ tool: 'search_ticket_packages', data: {} }]
      });

      await approveDraft(draft._id, adminUserId, 'admin');
      
      await assert.rejects(
        approveDraft(draft._id, adminUserId, 'admin'),
        /Bản nháp đã được xử lý/
      );
    });

    it('10. Staff cannot use Admin write capabilities', async () => {
      await assert.rejects(
        createDraft({
          adminUserId: staffUserId,
          actorRole: 'staff',
          type: 'CREATE_TICKET_PACKAGE',
          payload: { name: 'Staff Package', type: 'hourly', price: 1000, description: 'test', maxSlots: 3, isActive: true },
          evidence: []
        }),
        /Hành động không được phép đối với Staff/
      );
    });
  });
});

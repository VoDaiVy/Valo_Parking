const PricingConfig = require('../models/PricingConfig');
const TicketPackage = require('../models/TicketPackage');
const AdminActionLog = require('../models/AdminActionLog');

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
module.exports = { applyPricing, createPackage, updatePackage };

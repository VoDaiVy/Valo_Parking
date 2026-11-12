const mongoose = require('mongoose');
const TicketPackage = require('../models/TicketPackage');
const { packageDuration, salesAvailability } = require('../services/ticketPackageTerms');

// Get active ticket packages (For Customer/Kiosk)
exports.getActivePackages = async (req, res) => {
  try {
    const packages = await TicketPackage.find({
      isActive: true,
      service: { $in: ['RESERVED_FREE', 'RESERVED_PAID'] },
      type: { $in: req.query.includeHourly === 'true' ? ['hourly', 'monthly', 'yearly'] : ['monthly', 'yearly'] },
    }).sort({ type: -1, price: 1 });
    const pricedPackages = packages.map((pkg) => {
      const base = pkg.toObject();
      const common = {
        duration: packageDuration(pkg),
        salesAvailability: salesAvailability(pkg),
        // Compatibility only: these packages still use the reserved-space workflow.
        service: pkg.service,
        serviceConfiguration: pkg.serviceConfiguration,
        benefits: ['Reserved parking space for the selected vehicle', pkg.service === 'RESERVED_FREE' ? 'Base parking included at the registered space while effective' : 'Parking fees charged at standard rates', 'Additional services charged separately', ...(pkg.optionalServices || []).map((item) => `${item.name} (optional, paid separately)`)],
      };
      const price = {
        basePrice: pkg.price,
        adjustedPrice: pkg.price,
        changePercent: 0,
        busynessScore: null,
        level: null,
      };
        return {
          ...base,
          ...common,
          adjustedPrice: price.adjustedPrice,
          changePercent: price.changePercent,
          busynessScore: price.busynessScore,
          level: price.level,
          ...(price.adjustedPrice < price.basePrice ? { priceLabel: 'Giá ưu đãi' } : {}),
          ...(price.adjustedPrice > price.basePrice ? { priceLabel: 'Giá cao điểm' } : {}),
        };
    });
    res.status(200).json({ success: true, data: req.query.includeUnavailable === 'true' ? pricedPackages : pricedPackages.filter((pkg) => pkg.salesAvailability.available) });
  } catch (error) {
    console.error('Error fetching active ticket packages:', error);
    res.status(500).json({ message: 'Server error while fetching ticket packages' });
  }
};

// Get all ticket packages (For Admin)
exports.getAllPackages = async (req, res) => {
  try {
    const packages = await TicketPackage.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: packages });
  } catch (error) {
    console.error('Error fetching all ticket packages:', error);
    res.status(500).json({ message: 'Server error while fetching ticket packages' });
  }
};

// Get one ticket package detail
exports.getPackageById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid package ID is required.' });
    const ticketPackage = await TicketPackage.findById(req.params.id);
    if (!ticketPackage) return res.status(404).json({ success: false, message: 'Ticket package not found' });
    res.status(200).json({ success: true, data: ticketPackage });
  } catch (error) {
    console.error('Error fetching ticket package:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Create new ticket package (For Admin)
exports.createPackage = async (req, res) => {
  try {
    const { cleanPayload } = require('../services/aiCopilot/draftService');
    const { createPackage } = require('../services/adminCatalogWriteService');
    const payload = cleanPayload('CREATE_TICKET_PACKAGE', req.body);
    const created = await createPackage(payload, { adminId: req.user._id });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({ success: false, message: error.code === 11000 ? 'An active package already uses this name or configuration.' : error.statusCode ? error.message : 'Unable to create package.' });
  }
};

exports.updatePackage = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid package ID is required.' });
    const { cleanPayload } = require('../services/aiCopilot/draftService');
    const { updatePackage } = require('../services/adminCatalogWriteService');
    const existing = await TicketPackage.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Ticket package not found.' });
    const payload = cleanPayload('UPDATE_TICKET_PACKAGE', { ...existing, ...req.body });
    const updated = await updatePackage(req.params.id, payload, { adminId: req.user._id });
    if (!updated) return res.status(404).json({ success: false, message: 'Ticket package not found.' });
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.statusCode || 500).json({ success: false, message: error.code === 11000 ? 'An active package already uses this name or configuration.' : error.statusCode ? error.message : 'Unable to update package.' });
  }
};

// Delete only an unused catalog entry. Never substitute deactivation for deletion.
exports.deletePackage = async (req, res) => {
  let transaction;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'A valid package ID is required.' });
    transaction = await mongoose.startSession();
    await transaction.withTransaction(async () => {
      // Acquire the same document write lock as purchase creation. A concurrent
      // purchase either wins and is detected below, or cannot use this package.
      const pkg = await TicketPackage.findOneAndDelete({ _id: req.params.id }, { session: transaction });
      if (!pkg) throw Object.assign(new Error('Ticket package not found.'), { statusCode: 404 });
      const ids = [pkg._id, String(pkg._id)];
      const snapshot = { 'packageSnapshot.id': { $in: ids } };
      const references = [
        ['Subscription', { $or: [{ ticketPackage: pkg._id }, snapshot] }],
        ['MembershipSlotEntitlement', { $or: [{ packageId: pkg._id }, snapshot] }],
        ['User', { 'membership.packageId': pkg._id }],
        ['SubscriptionRenewal', snapshot],
        ['MembershipEntitlementRenewal', snapshot],
        ['Session', { 'packageContext.terms.id': { $in: ids } }],
        ['AIDraft', { $or: [
          { targetId: pkg._id, type: { $in: ['UPDATE_TICKET_PACKAGE', 'ARCHIVE_TICKET_PACKAGE'] } },
          { type: 'CREATE_TICKET_PACKAGE', 'executionResult.id': { $in: ids } },
          ...(pkg.aiDraftId ? [{ _id: pkg.aiDraftId }] : []),
        ] }],
      ];
      // No status filter: pending/failed payments and expired/transferred
      // benefits are history too. Payments refer to their subscription/renewal.
      for (const [model, filter] of references) {
        if (await require(`../models/${model}`).exists(filter).session(transaction)) {
          throw Object.assign(new Error('Cannot delete this package because it has subscriptions, entitlements, payment records or historical references. Set it to Inactive to stop new purchases; existing benefits will be preserved.'), { statusCode: 409 });
        }
      }
      await require('../models/AdminActionLog').create([{
        action: 'Deleted Ticket Package', target: `${pkg.name} / ${pkg.type}`,
        type: 'delete', adminId: req.user._id,
      }], { session: transaction });
    });
    res.status(200).json({ success: true, message: 'Unused ticket package permanently deleted.' });
  } catch (error) {
    console.error('Error deleting ticket package:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Unable to delete ticket package.' });
  } finally {
    if (transaction) await transaction.endSession();
  }
};

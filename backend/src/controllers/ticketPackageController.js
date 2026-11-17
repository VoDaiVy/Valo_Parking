const TicketPackage = require('../models/TicketPackage');
const { getExplorePackages, getExplorePackage } = require('../services/ticketPackageExploreService');
const {
  SELLABLE_PACKAGE_TYPES,
  getPackageDurationDays,
  getPackageBenefits,
} = require('../utils/ticketPackageRules');

exports.getExplorePackages = async (req, res, next) => {
  try {
    const data = await getExplorePackages(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.getExplorePackage = async (req, res, next) => {
  try {
    const data = await getExplorePackage(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// Get active ticket packages (For Customer/Kiosk)
exports.getActivePackages = async (req, res) => {
  try {
    await require('../services/ticketPackageStockService').refreshAll();
    const packages = await TicketPackage.find({
      isActive: true,
      type: { $in: SELLABLE_PACKAGE_TYPES },
    }).sort({ type: -1, price: 1 });
    const pricedPackages = packages.map((pkg) => {
      const base = pkg.toObject();
      const common = {
        durationDays: getPackageDurationDays(pkg),
        ...(['monthly', 'yearly'].includes(pkg.type) ? { durationMonths: pkg.type === 'yearly' ? 12 : 1 } : {}),
        benefits: getPackageBenefits(pkg),
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
    res.status(200).json({ success: true, data: pricedPackages });
  } catch (error) {
    console.error('Error fetching active ticket packages:', error);
    res.status(500).json({ message: 'Server error while fetching ticket packages' });
  }
};

// Get all ticket packages (For Admin)
exports.getAllPackages = async (req, res) => {
  try {
    const stockService = require('../services/ticketPackageStockService');
    await stockService.refreshAll();
    const packages = await TicketPackage.find({ type: { $in: SELLABLE_PACKAGE_TYPES } }).sort({ createdAt: -1 });
    const data = await Promise.all(packages.map(async (pkg) => ({ ...pkg.toObject(), stock: await stockService.snapshot(pkg) })));
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching all ticket packages:', error);
    res.status(500).json({ message: 'Server error while fetching ticket packages' });
  }
};

exports.getPackageBuyers = async (req, res, next) => {
  try {
    res.json({ success: true, data: await require('../services/ticketPackageStockService').getBuyers(req.params.id, req.query) });
  } catch (error) { next(error); }
};

// Get one ticket package detail
exports.getPackageById = async (req, res) => {
  try {
    const ticketPackage = await TicketPackage.findById(req.params.id);
    if (!ticketPackage || !SELLABLE_PACKAGE_TYPES.includes(ticketPackage.type)) return res.status(404).json({ success: false, message: 'Ticket package not found' });
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
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Kh?ng th? t?o g?i v?.' });
  }
};

exports.updatePackage = async (req, res) => {
  try {
    const { cleanPayload } = require('../services/aiCopilot/draftService');
    const { updatePackage } = require('../services/adminCatalogWriteService');
    const existing = await TicketPackage.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Không tìm thấy gói vé.' });
    const payload = cleanPayload('UPDATE_TICKET_PACKAGE', { ...existing, ...req.body });
    const updated = await updatePackage(req.params.id, payload, { adminId: req.user._id });
    if (!updated) return res.status(404).json({ success: false, message: 'Kh?ng t?m th?y g?i v?.' });
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Kh?ng th? c?p nh?t g?i v?.' });
  }
};

// Delete ticket package (For Admin)
exports.deletePackage = async (req, res) => {
  try {
    const Subscription = require('../models/Subscription');
    const AdminActionLog = require('../models/AdminActionLog');

    // Prevent deletion if any active or pending subscriptions reference this package.
    // Deleting would leave dangling references and break getMembership / renewal flows.
    const activeSub = await Subscription.findOne({
      ticketPackage: req.params.id,
      status: { $in: ['pending', 'active'] },
    }).select('_id').lean();
    if (activeSub) {
      return res.status(409).json({
        success: false,
        message: 'Không thể xóa gói vé đang được khách hàng sử dụng (active/pending). Hãy vô hiệu hóa gói thay vì xóa.',
      });
    }

    const deletedPackage = await TicketPackage.findByIdAndDelete(req.params.id);
    if (!deletedPackage) return res.status(404).json({ success: false, message: 'Ticket package not found' });

    await AdminActionLog.create({
      action: 'Deleted Ticket Package',
      target: `${deletedPackage.name} • ${deletedPackage.type}`,
      type: 'delete',
      adminId: req.user._id,
    });

    res.status(200).json({ success: true, message: 'Ticket package deleted successfully' });
  } catch (error) {
    console.error('Error deleting ticket package:', error);
    res.status(500).json({ message: 'Server error while deleting ticket package' });
  }
};

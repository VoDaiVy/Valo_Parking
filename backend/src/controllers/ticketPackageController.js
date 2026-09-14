const TicketPackage = require('../models/TicketPackage');
const dynamicPricingEngine = require('../services/dynamicPricingEngine');

// Get active ticket packages (For Customer/Kiosk)
exports.getActivePackages = async (req, res) => {
  try {
    const packages = await TicketPackage.find({
      isActive: true,
      type: { $in: ['monthly', 'yearly'] },
    }).sort({ type: -1, price: 1 });
    const pricedPackages = await Promise.all(packages.map(async (pkg) => {
      const base = pkg.toObject();
      const common = {
        durationMonths: pkg.type === 'yearly' ? 12 : 1,
        benefits: pkg.type === 'yearly'
          ? ['Reserved VIP slots', '12 free services', 'Priority parking access']
          : ['Reserved VIP slots', 'Priority parking access'],
      };
      try {
        const price = await dynamicPricingEngine.getEffectivePrice({
          priceType: 'package',
          packageId: pkg._id,
          basePrice: pkg.price,
        });
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
      } catch (error) {
        console.error(`[DynamicPricing] Package ${pkg._id} fallback:`, error.message);
        return {
          ...base,
          ...common,
          adjustedPrice: pkg.price,
          changePercent: 0,
          busynessScore: null,
          level: null,
        };
      }
    }));
    res.status(200).json({ success: true, data: pricedPackages });
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
    const { name, type, price, description, isActive } = req.body;
    const newPackage = new TicketPackage({ name, type, price, description, isActive });
    await newPackage.save();

    const AdminActionLog = require('../models/AdminActionLog');
    await AdminActionLog.create({
      action: "Created Ticket Package",
      target: `${name} • ${type}`,
      type: "create",
      adminId: req.user._id
    });

    res.status(201).json({ success: true, data: newPackage });
  } catch (error) {
    console.error('Error creating ticket package:', error);
    res.status(500).json({ message: 'Server error while creating ticket package', error: error.message, stack: error.stack });
  }
};

// Update ticket package (For Admin)
exports.updatePackage = async (req, res) => {
  try {
    const { name, type, price, description, isActive } = req.body;
    const updatedPackage = await TicketPackage.findByIdAndUpdate(
      req.params.id,
      { name, type, price, description, isActive },
      { new: true, runValidators: true }
    );
    if (!updatedPackage) return res.status(404).json({ success: false, message: 'Ticket package not found' });
    res.status(200).json({ success: true, data: updatedPackage });
  } catch (error) {
    console.error('Error updating ticket package:', error);
    res.status(500).json({ message: 'Server error while updating ticket package' });
  }
};

// Delete ticket package (For Admin)
exports.deletePackage = async (req, res) => {
  try {
    const deletedPackage = await TicketPackage.findByIdAndDelete(req.params.id);
    if (!deletedPackage) return res.status(404).json({ success: false, message: 'Ticket package not found' });

    const AdminActionLog = require('../models/AdminActionLog');
    await AdminActionLog.create({
      action: "Deleted Ticket Package",
      target: `${deletedPackage.name} • ${deletedPackage.type}`,
      type: "delete",
      adminId: req.user._id
    });

    res.status(200).json({ success: true, message: 'Ticket package deleted successfully' });
  } catch (error) {
    console.error('Error deleting ticket package:', error);
    res.status(500).json({ message: 'Server error while deleting ticket package' });
  }
};

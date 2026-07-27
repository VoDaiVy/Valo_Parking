const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");
const Vehicle = require("../models/Vehicle");
// ─── Draco compression ────────────────────────────────────────────────────────
// npm install gltf-pipeline
const { processGlb } = require("gltf-pipeline");

const User = require("../models/User");
const UserDetail = require("../models/UserDetail");

// Same normalizer as vehicleController – must stay in sync
const normalizeSlug = (str = "") =>
  str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

// Update modelUrl for all vehicles whose normalised brand+model matches the publicId
const syncVehiclesForModel = async (brand, model, secureUrl) => {
  const nb = normalizeSlug(brand);
  const nm = normalizeSlug(model || "default");

  // Build a regex that matches the original brand/model case-insensitively
  // e.g. brand='Peugeot', model='3008 P4'  → find vehicles where
  //   normalizeSlug(brand)==nb AND normalizeSlug(model)==nm
  // We do this by fetching candidates and filtering in JS (collections are small)
  const candidates = await Vehicle.find({
    brand: {
      $regex: new RegExp(
        `^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    },
  });

  const toUpdate = candidates.filter(
    (v) => normalizeSlug(v.model || "default") === nm,
  );

  if (toUpdate.length > 0) {
    await Vehicle.updateMany(
      { _id: { $in: toUpdate.map((v) => v._id) } },
      { $set: { modelUrl: secureUrl } },
    );
  }
  return toUpdate.length;
};

/**
 * @desc  Search users by username or email (Admin/Staff)
 * @route GET /api/admin/users/search
 * @access Admin only
 */
exports.searchUsers = async (req, res, next) => {
  try {
    const q = req.query.q || "";
    const User = require("../models/User"); // Import here to avoid circular dependencies if any
    const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const filter = {
      status: true,
      ...(q
        ? {
          $or: [
            { username: { $regex: escapedQuery, $options: "i" } },
            { email: { $regex: escapedQuery, $options: "i" } },
          ],
        }
        : {}),
    };

    const users = await User.find(filter)
      .select("username email role status")
      .limit(20)
      .lean();

    res.status(200).json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Upload a .glb 3D model for a vehicle brand/model
 * @route POST /api/admin/vehicles/upload-model
 * @access Admin only
 * Body (multipart/form-data):
 *   - brand   : string  (e.g. "Toyota")
 *   - model   : string  (e.g. "Camry") — use "default" to set a brand-level fallback
 *   - file    : .glb binary
 */
exports.uploadVehicleModel = async (req, res, next) => {
  try {
    const { brand, model } = req.body;

    if (!brand) {
      return res
        .status(400)
        .json({ success: false, message: "brand is required" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const ext = req.file.originalname.split(".").pop().toLowerCase();
    if (ext !== "glb") {
      return res
        .status(400)
        .json({ success: false, message: "Only .glb files are accepted" });
    }

    const nb = normalizeSlug(brand);
    const nm = normalizeSlug(model || "default");
    const publicId = `vehicles/${nb}/${nm}`;

    // ── Step 1: Compress GLB in-memory with Draco ─────────────────────────────
    // Processes the raw buffer — no temp files written to disk.
    // If gltf-pipeline fails (e.g. model already compressed), fall back to original.
    let uploadBuffer = req.file.buffer;
    try {
      const compressResult = await processGlb(req.file.buffer, {
        dracoOptions: { compressionLevel: 7 },
      });
      uploadBuffer = compressResult.glb;
      console.log(
        `[uploadVehicleModel] Draco compressed: ${req.file.buffer.length} → ${uploadBuffer.length} bytes`,
      );
    } catch (compressErr) {
      // Non-fatal: upload uncompressed if Draco step fails
      console.warn(
        "[uploadVehicleModel] Draco compression skipped:",
        compressErr.message,
      );
      // uploadBuffer stays as req.file.buffer (original)
    }
    // NOTE: We use multer memoryStorage so there are NO temp files on disk.
    // If you ever switch to diskStorage, add fs.unlinkSync(req.file.path) in
    // a try/finally block here to clean up the temp file.

    // ── Step 2: Upload compressed buffer → Cloudinary as raw resource ─────────
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "raw",
          public_id: publicId,
          overwrite: true,
          invalidate: true,
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );
      streamifier.createReadStream(uploadBuffer).pipe(uploadStream);
    });

    const synced = await syncVehiclesForModel(
      brand,
      model || "default",
      uploadResult.secure_url,
    );

    res.status(200).json({
      success: true,
      message: `Model uploaded at vehicles/${nb}/${nm}`,
      data: {
        publicId: uploadResult.public_id,
        url: uploadResult.secure_url,
        bytes: uploadResult.bytes,
        brand,
        model: model || "default",
        vehiclesSynced: synced,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Delete a .glb model from Cloudinary
 * @route DELETE /api/admin/vehicles/upload-model
 * @access Admin only
 * Body: { brand, model }
 */
exports.deleteVehicleModel = async (req, res, next) => {
  try {
    const { brand, model } = req.body;
    if (!brand) {
      return res
        .status(400)
        .json({ success: false, message: "brand is required" });
    }
    const nb = normalizeSlug(brand);
    const nm = normalizeSlug(model || "default");

    // Step 1: Remove the file from Cloudinary
    await cloudinary.uploader.destroy(`vehicles/${nb}/${nm}`, {
      resource_type: "raw",
    });

    // Step 2: Clear modelUrl on all Vehicle documents that pointed to this model.
    // Without this, existing vehicles still hold the old URL and keep rendering
    // the 3D model even after deletion.
    const vehiclesSynced = await syncVehiclesForModel(
      brand,
      model || "default",
      "",
    );

    res.status(200).json({
      success: true,
      message: `Deleted vehicles/${nb}/${nm}`,
      data: { vehiclesSynced },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  List all uploaded vehicle models
 * @route GET /api/admin/vehicles/models
 * @access Admin only
 */
exports.listVehicleModels = async (req, res, next) => {
  try {
    const result = await cloudinary.api.resources({
      resource_type: "raw",
      type: "upload",
      prefix: "vehicles/",
      max_results: 200,
    });

    const models = (result.resources || []).map((r) => ({
      publicId: r.public_id,
      url: r.secure_url,
      bytes: r.bytes,
      createdAt: r.created_at,
    }));

    res.status(200).json({ success: true, data: models });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Re-scan all vehicles against Cloudinary models and fix missing modelUrls
 * @route POST /api/admin/vehicles/sync-models
 * @access Admin only
 */
exports.syncAllVehicleModels = async (req, res, next) => {
  try {
    // 1. Get all Cloudinary raw files under vehicles/
    const result = await cloudinary.api.resources({
      resource_type: "raw",
      type: "upload",
      prefix: "vehicles/",
      max_results: 200,
    });

    // Build a lookup map: "brand/model" → secure_url
    const cloudMap = {};
    for (const r of result.resources || []) {
      // public_id format: vehicles/{brand}/{model}
      const key = r.public_id.replace(/^vehicles\//, "");
      cloudMap[key] = r.secure_url;
    }

    // 2. Get all vehicles
    const vehicles = await Vehicle.find({});
    let updated = 0;

    for (const v of vehicles) {
      const nb = normalizeSlug(v.brand);
      const nm = normalizeSlug(v.model || "default");
      const key = `${nb}/${nm}`;
      const url = cloudMap[key] || "";

      if (v.modelUrl !== url) {
        v.modelUrl = url;
        await v.save();
        updated++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Synced ${updated} vehicle(s)`,
      data: { total: vehicles.length, updated },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  List all users with their profiles
 * @route GET /api/admin/users
 * @access Admin only
 */
exports.listUsers = async (req, res, next) => {
  try {
    const users = await User.aggregate([
      {
        $lookup: {
          from: "userdetails",
          localField: "_id",
          foreignField: "userId",
          as: "profile",
        },
      },
      {
        $unwind: {
          path: "$profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
    ]);
    res.status(200).json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

// ─── Vehicle Approval ─────────────────────────────────────────────────────────

/**
 * @desc  List all pending vehicles (with owner info)
 * @route GET /api/admin/vehicles/pending
 * @access Admin only
 */
exports.getPendingVehicles = async (req, res, next) => {
  try {
    const vehicles = await Vehicle.find({ status: "pending" })
      .populate("owner", "name email")
      .sort({ createdAt: 1 });
    res
      .status(200)
      .json({ success: true, count: vehicles.length, data: vehicles });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  List all approved vehicles (with owner info)
 * @route GET /api/admin/vehicles/approved
 * @access Admin only
 */
exports.getApprovedVehicles = async (req, res, next) => {
  try {
    const vehicles = await Vehicle.find({ status: "approved" })
      .populate("owner", "name email")
      .sort({ updatedAt: -1, createdAt: -1 });
    res
      .status(200)
      .json({ success: true, count: vehicles.length, data: vehicles });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Update user status (block/unblock)
 * @route PUT /api/admin/users/:id/status
 * @access Admin only
 */
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const AdminActionLog = require("../models/AdminActionLog");
    await AdminActionLog.create({
      action: status ? "Unblocked User Account" : "Blocked User Account",
      target: `ID #${user._id.toString().slice(-4)} • ${user.email}`,
      type: status ? "update" : "block",
      adminId: req.user._id
    });

    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Approve a vehicle (optionally assign modelUrl)
 * @route PATCH /api/admin/vehicles/:id/approve
 * @access Admin only
 */
exports.approveVehicle = async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle)
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found" });

    vehicle.status = "approved";
    if (req.body.modelUrl !== undefined) vehicle.modelUrl = req.body.modelUrl;
    await vehicle.save();

    res
      .status(200)
      .json({ success: true, message: "Vehicle approved", data: vehicle });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Update user details (role, status, profile)
 * @route PUT /api/admin/users/:id
 * @access Admin only
 */
exports.updateUser = async (req, res, next) => {
  try {
    const { role, status, firstName, lastName, phone } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (role !== undefined) user.role = role;
    if (status !== undefined) user.status = status;
    await user.save();

    let userDetail = await UserDetail.findOne({ userId: user._id });
    if (!userDetail) {
      userDetail = new UserDetail({ userId: user._id });
    }

    if (firstName !== undefined) userDetail.firstName = firstName;
    if (lastName !== undefined) userDetail.lastName = lastName;
    if (phone !== undefined) userDetail.phone = phone;
    await userDetail.save();

    // Fetch the updated user with profile to return
    const updatedUser = await User.aggregate([
      { $match: { _id: user._id } },
      {
        $lookup: {
          from: "userdetails",
          localField: "_id",
          foreignField: "userId",
          as: "profile",
        },
      },
      {
        $unwind: {
          path: "$profile",
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    const AdminActionLog = require("../models/AdminActionLog");
    await AdminActionLog.create({
      action: "Updated User Privileges/Details",
      target: `${firstName || ''} ${lastName || ''} • ${user.role}`,
      type: "update",
      adminId: req.user._id
    });

    res.status(200).json({ success: true, data: updatedUser[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Hard delete a user and all their associated data (Cascading delete)
 * @route DELETE /api/admin/users/:id
 * @access Admin only
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    // Validate we are not deleting ourselves
    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You cannot delete your own admin account." });
    }

    // Require all models needed for cascading delete
    const UserDetail = require('../models/UserDetail');
    const UserToken = require('../models/UserToken');
    const QrToken = require('../models/QrToken');
    const Wallet = require('../models/Wallet');
    const WalletTransaction = require('../models/WalletTransaction');
    
    const Vehicle = require('../models/Vehicle');
    const Booking = require('../models/Booking');
    const BookingHold = require('../models/BookingHold');
    const BookingOrder = require('../models/BookingOrder');
    const BookingTransfer = require('../models/BookingTransfer');
    const Session = require('../models/Session');
    
    const Subscription = require('../models/Subscription');
    const SubscriptionRenewal = require('../models/SubscriptionRenewal');
    const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
    const MembershipEntitlementTransfer = require('../models/MembershipEntitlementTransfer');
    const MembershipEntitlementRenewal = require('../models/MembershipEntitlementRenewal');
    const Slot = require('../models/Slot');
    
    const Notification = require('../models/Notification');
    const UserNotification = require('../models/UserNotification');
    const Contract = require('../models/Contract');
    const PolicyAcceptance = require('../models/PolicyAcceptance');
    const Revenue = require('../models/Revenue');

    // 1. Wallets & Transactions
    await Wallet.deleteOne({ user: userId });
    await WalletTransaction.deleteMany({ user: userId });

    // 2. Vehicles & Bookings & Sessions
    await Vehicle.deleteMany({ owner: userId });
    await Booking.deleteMany({ userId: userId });
    await BookingHold.deleteMany({ userId: userId });
    await BookingOrder.deleteMany({ userId: userId });
    await BookingTransfer.deleteMany({ $or: [{ fromUserId: userId }, { toUserId: userId }] });
    await Session.updateMany({ userId: userId }, { $set: { userId: null } });

    // 3. Subscriptions & VIP Packages
    await Subscription.deleteMany({ user: userId });
    await SubscriptionRenewal.deleteMany({ userId: userId });
    await MembershipSlotEntitlement.deleteMany({ ownerId: userId });
    await MembershipEntitlementTransfer.deleteMany({ $or: [{ fromUserId: userId }, { toUserId: userId }] });
    await MembershipEntitlementRenewal.deleteMany({ userId: userId });
    
    // 4. Free up VIP Slots
    await Slot.updateMany(
      { reservedFor: userId },
      { $set: { reservedFor: null, reservedBySubscriptionId: null, reservedByEntitlementId: null } }
    );

    // 5. Logs, Contracts, Policies
    await Notification.deleteMany({ userId: userId });
    await UserNotification.deleteMany({ userId: userId });
    await Contract.deleteMany({ userId: userId });
    await PolicyAcceptance.deleteMany({ userId: userId });
    await Revenue.deleteMany({ userId: userId });
    
    // 6. Auth & Tokens
    await UserDetail.deleteOne({ userId: userId });
    await UserToken.deleteMany({ userId: userId });
    await QrToken.deleteMany({ userId: userId });

    // 7. Delete the User
    await User.findByIdAndDelete(userId);

    const AdminActionLog = require("../models/AdminActionLog");
    await AdminActionLog.create({
      action: "Deleted User & Cascaded Data",
      target: user.username || user.email || String(user._id),
      type: "delete",
      adminId: req.user._id
    });

    res.status(200).json({ success: true, message: "User and all associated data deleted successfully." });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Reject (delete) a pending vehicle
 * @route DELETE /api/admin/vehicles/:id/reject
 * @access Admin only
 */
exports.rejectVehicle = async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle)
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found" });
    res
      .status(200)
      .json({ success: true, message: "Vehicle rejected and removed" });
  } catch (err) {
    next(err);
  }
};

// ─── Pricing Config Management ────────────────────────────────────────────────

const PricingConfig = require("../models/PricingConfig");

/**
 * @desc  Lấy cấu hình giá đỗ xe hiện tại của Admin
 * @route GET /api/admin/pricing-config
 * @access Admin only
 */
exports.getPricingConfig = async (req, res, next) => {
  try {
    const config = await PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 });
    const DEFAULT_CONFIG = {
      timeBlocks: [
        { startHour: 7, endHour: 12, price: 10000 },
        { startHour: 12, endHour: 17, price: 10000 },
        { startHour: 17, endHour: 22, price: 20000 },
        { startHour: 22, endHour: 7, price: 25000 }
      ],
      cap12h: 100000,
      cap24h: 180000,
    };
    res.status(200).json({ success: true, data: config || DEFAULT_CONFIG });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Cập nhật cấu hình giá đỗ xe (Admin tự tạo/set số tiền)
 * @route POST /api/admin/pricing-config
 * @access Admin only
 */
exports.updatePricingConfig = async (req, res, next) => {
  try {
    const { timeBlocks, cap12h, cap24h } = req.body;

    if (!Array.isArray(timeBlocks)) {
      return res.status(400).json({ success: false, message: 'Invalid time blocks format' });
    }

    // Validate coverage of 24 hours (no gaps, no overlaps)
    const hours = new Array(24).fill(false);
    for (let i = 0; i < timeBlocks.length; i++) {
      const b = timeBlocks[i];
      const start = Number(b.startHour);
      const end = Number(b.endHour);

      if (start === end) {
        return res.status(400).json({ success: false, message: 'A time block cannot have the same start and end time.' });
      }

      const markHour = (h) => {
        if (hours[h]) {
          throw new Error(`Overlap detected at hour ${h}:00`);
        }
        hours[h] = true;
      };

      try {
        if (start < end) {
          for (let h = start; h < end; h++) markHour(h);
        } else {
          for (let h = start; h < 24; h++) markHour(h);
          for (let h = 0; h < end; h++) markHour(h);
        }
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    }

    const missingHour = hours.findIndex(h => !h);
    if (missingHour !== -1) {
      return res.status(400).json({ success: false, message: `Gap detected in schedule. Time block missing for hour ${missingHour}:00` });
    }

    // Vô hiệu hóa cấu hình cũ
    await PricingConfig.updateMany({ isActive: true }, { isActive: false });

    // Tạo cấu hình mới
    const newConfig = await PricingConfig.create({
      timeBlocks,
      cap12h: Number(cap12h),
      cap24h: Number(cap24h),
      isActive: true
    });

    res.status(200).json({ success: true, data: newConfig });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc  Get Admin Dashboard Overview Stats
 * @route GET /api/admin/overview
 * @access Admin only
 */
exports.getAdminOverview = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const ParkingFloor = require('../models/ParkingFloor');
    const Revenue = require('../models/Revenue');

    // Stats
    const totalStaff = await User.countDocuments({ role: 'staff' });
    const activeUsers = await User.countDocuments({ role: 'customer', status: true });
    const blockedUsers = await User.countDocuments({ role: 'customer', status: false });
    const parkingLots = await ParkingFloor.countDocuments();
    const pendingLots = 0; // Or calculate if there is a status field

    // Revenue Calculation
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const revenueThisMonthAggr = await Revenue.aggregate([
      { $match: { createdAt: { $gte: startOfThisMonth } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalRevenueMonth = revenueThisMonthAggr.length > 0 ? revenueThisMonthAggr[0].total : 0;

    const revenueLastMonthAggr = await Revenue.aggregate([
      { $match: { createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalRevenueLastMonth = revenueLastMonthAggr.length > 0 ? revenueLastMonthAggr[0].total : 0;

    let revenueIncreasePercent = 0;
    if (totalRevenueLastMonth > 0) {
      revenueIncreasePercent = ((totalRevenueMonth - totalRevenueLastMonth) / totalRevenueLastMonth) * 100;
    } else if (totalRevenueMonth > 0) {
      revenueIncreasePercent = 100; // 100% increase if last month was 0 and this month has revenue
    }

    const AdminActionLog = require("../models/AdminActionLog");
    const recentActions = await AdminActionLog.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        totalStaff,
        activeUsers,
        blockedUsers,
        parkingLots,
        pendingLots,
        totalRevenueMonth,
        totalRevenueLastMonth,
        revenueIncreasePercent: Math.round(revenueIncreasePercent),
        recentActions
      }
    });
  } catch (err) {
    next(err);
  }
};


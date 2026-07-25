const { validationResult } = require("express-validator");
const User = require("../models/User");
const UserDetail = require("../models/UserDetail");
const Session = require("../models/Session");
const TicketPackage = require("../models/TicketPackage");
const { uploadToCloudinary } = require("../middlewares/uploadMiddleware");

const Slot = require("../models/Slot");

const buildMembershipPayload = async (membership = {}, userId = null) => {
  const raw =
    typeof membership.toObject === "function" ? membership.toObject() : membership;
  let packageType = null;

  if (raw?.packageId) {
    const ticketPackage = await TicketPackage.findById(raw.packageId).select("type").lean();
    packageType = ticketPackage?.type || null;
  }

  let reservedSlots = [];
  let subscriptionId = null;
  if (userId && raw?.isVip) {
    const MembershipSlotEntitlement = require("../models/MembershipSlotEntitlement");
    const entitlements = await MembershipSlotEntitlement.find({
      ownerId: userId,
      status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $gt: new Date() },
    })
      .populate('floorId', 'name floorNumber')
      .sort({ expireAt: -1 })
      .lean();
    if (entitlements.length) {
      reservedSlots = entitlements.map((entitlement) => ({
        entitlementId: entitlement._id,
        floorName: entitlement.floorId?.name || 'Unknown Floor',
        floorNumber: entitlement.floorId?.floorNumber || null,
        slotNumber: entitlement.slotCode,
        expireAt: entitlement.expireAt,
        status: entitlement.status,
        canTransfer:
          entitlement.status === 'active' &&
          Number(entitlement.transferCount || 0) < 1,
      }));
      subscriptionId = String(entitlements[0].sourceSubscriptionId);
    } else {
      const slots = await Slot.find({ reservedFor: userId }).populate('floorID', 'name').lean();
      reservedSlots = slots.map(s => ({
        floorName: s.floorID?.name || 'Unknown Floor',
        slotNumber: s.slotNumber
      }));
    }

    if (!subscriptionId) {
      const Subscription = require("../models/Subscription");
      const sub = await Subscription.findOne({
        user: userId,
        status: 'active',
        paymentStatus: 'paid',
        expireAt: { $gt: new Date() },
      }).sort({ expireAt: -1 }).lean();
      if (sub) {
        subscriptionId = sub._id.toString();
      }
    }
  }

  return {
    isVip: raw?.isVip || false,
    expireAt: raw?.expireAt || null,
    packageId: raw?.packageId || null,
    freeServiceCount: raw?.freeServiceCount || 0,
    packageType,
    reservedSlots,
    subscriptionId,
  };
};

/**
 * @desc    Get user profile (User + UserDetail)
 * @route   GET /api/profile
 * @access  Private
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    const userDetail = await UserDetail.findOne({ userId: req.user._id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const membership = await buildMembershipPayload(user.membership, req.user._id);

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        isGoogleUser: !!user.googleId && !user.password,
        createdAt: user.createdAt,
        profile: {
          firstName: userDetail?.firstName || "",
          lastName: userDetail?.lastName || "",
          phone: userDetail?.phone || "",
          dob: userDetail?.dob || null,
          gender: userDetail?.gender || "",
          avatar: userDetail?.avatar || "",
        },
        membership,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user profile
 * @route   PUT /api/profile
 * @access  Private
 */
const updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone, dob, gender, avatar } = req.body;

    if (phone) {
      const existingUserWithPhone = await UserDetail.findOne({ 
        phone: phone, 
        userId: { $ne: req.user._id } 
      });
      
      if (existingUserWithPhone) {
        return res.status(400).json({
          success: false,
          message: 'This phone number is already linked to another account.'
        });
      }
    }

    // Update or create UserDetail
    const userDetail = await UserDetail.findOneAndUpdate(
      { userId: req.user._id },
      {
        firstName,
        lastName,
        phone,
        dob,
        gender,
        avatar,
      },
      {
        new: true, // Return updated document
        upsert: true, // Create if not exists
        runValidators: true, // Run schema validators
      },
    );

    const user = await User.findById(req.user._id);


    let claimedSessions = 0;
    // Claim History Logic: If phone is provided, link all orphan sessions
    if (phone) {
      const result = await Session.updateMany(
        { phone: phone, userId: { $in: [null, undefined] } },
        { $set: { userId: req.user._id } }
      );
      claimedSessions = result.modifiedCount || 0;
    }

    const membership = await buildMembershipPayload(user.membership, req.user._id);

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        claimedSessions,
        profile: {
          firstName: userDetail.firstName,
          lastName: userDetail.lastName,
          phone: userDetail.phone,
          dob: userDetail.dob,
          gender: userDetail.gender,
          avatar: userDetail.avatar,
        },
        membership,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change password
 * @route   PUT /api/profile/change-password
 * @access  Private
 */
const changePassword = async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array().map((err) => ({
          field: err.path,
          message: err.msg,
        })),
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const isGoogleUser = !!user.googleId && !user.password;

    if (!isGoogleUser) {
      // Regular user: current password is required
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password is required.",
        });
      }

      // Check current password
      const isMatch = await user.comparePassword(currentPassword);

      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect.",
        });
      }

      // Check new password is different from current
      if (currentPassword === newPassword) {
        return res.status(400).json({
          success: false,
          message: "New password must be different from current password.",
        });
      }
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload / update avatar via Cloudinary
 * @route   POST /api/profile/avatar
 * @access  Private
 */
const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided.",
      });
    }

    // Upload buffer to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: "valo_parking/avatars",
      public_id: `user_${req.user._id}`,
      overwrite: true,
      transformation: [
        { width: 400, height: 400, crop: "fill", gravity: "face" },
        { quality: "auto", fetch_format: "auto" },
      ],
    });

    // Save Cloudinary secure_url to UserDetail
    const userDetail = await UserDetail.findOneAndUpdate(
      { userId: req.user._id },
      { avatar: result.secure_url },
      { new: true, upsert: true },
    );

    res.status(200).json({
      success: true,
      message: "Avatar uploaded successfully",
      data: {
        avatarUrl: userDetail.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
};

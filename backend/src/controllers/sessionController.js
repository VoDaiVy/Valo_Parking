const axios = require('axios');
const Session = require('../models/Session');
const UserDetail = require('../models/UserDetail');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const ParkingFloor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const mongoose = require('mongoose');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const payos = require('../config/payos');
const cloudinary = require('../config/cloudinary');
const { sendKioskCheckInEmail, sendCheckoutEmail } = require('../utils/emailUtils');
const notifTriggers = require('../services/notificationTriggers');
const aiNotificationEvents = require('../services/aiCopilot/notificationEvents');
const walletService = require('../services/walletService');
const pricingEngine = require('../services/pricingEngine');
const bookingRefundService = require('../services/bookingRefundService');
const { recordParkingRevenue } = require('../services/parkingRevenueService');
const { parseAndVerifyAnyMembershipQr } = require('../services/membershipQrService');
const { parseAndVerifyBookingQr } = require('../services/bookingQrService');
const { buildSessionExitQrPayload, parseAndVerifySessionExitQr } = require('../services/sessionQrService');
const { buildCheckoutChallenge, parseAndVerifyCheckoutChallenge } = require('../services/checkoutChallengeService');
const { normalizeLicensePlate, arePlatesMatching } = require('../utils/licensePlateUtils');
const { normalizePhone, getPhoneRegex, getPhoneVariants, getPhoneSearchConditions, claimUserSessionsByPhone } = require('../utils/phoneUtils');
const { triggerBarrierOpen } = require('../routes/iotRoutes');
const { toPublicActiveSession, toKioskSession } = require('../utils/publicParkingDto');
const {
  createKioskPaymentIntent,
  attachProviderPayment,
  markPaymentIntentPaid,
  markPaymentIntentPaidById,
  markPaymentIntentSettled,
} = require('../services/paymentIntentService');


const normalizeSlotCode = (slotCode = '') => String(slotCode || '').trim().toUpperCase();
const sameObjectId = (a, b) => String(a || '') === String(b || '');

const { getParkingCapacitySnapshot } = require('../services/parkingCapacityService');

const getCanonicalUserPhone = async (userId) => {
  if (!userId) return '';
  const detail = await UserDetail.findOne({ userId }).select('phone').lean();
  return detail?.phone || '';
};

const findApprovedVehicleForOwner = async (ownerId) => {
  if (!ownerId) return null;
  return Vehicle.findOne({ owner: ownerId, status: 'approved' })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
};

const findActiveMembershipAccess = async (userId, now = new Date()) => {
  const entitlements = await MembershipSlotEntitlement.find({
    ownerId: userId,
    status: { $in: ['active', 'transfer_locked'] },
    expireAt: { $gt: now },
  }).populate('floorId', 'name floorNumber');
  if (entitlements.length) {
    return {
      _id: entitlements[0].sourceSubscriptionId,
      user: userId,
      expireAt: entitlements.reduce(
        (latest, item) => (item.expireAt > latest ? item.expireAt : latest),
        entitlements[0].expireAt
      ),
      slots: entitlements.map((item) => ({
        floorId: item.floorId,
        slotCode: item.slotCode,
        entitlementId: item._id,
        sourceSubscriptionId: item.sourceSubscriptionId,
      })),
      entitlementBacked: true,
    };
  }
  return mongoose.model('Subscription').findOne({
    user: userId,
    status: 'active',
    paymentStatus: 'paid',
    expireAt: { $gt: now },
  }).populate('slots.floorId');
};

/**
 * Xác thực biển số xe khi đến Kiosk
 * POST /api/sessions/verify-plate
 */
exports.verifyPlate = async (req, res, next) => {
  try {
    const { licensePlate } = req.body;
    if (!licensePlate) {
      return res.status(400).json({ success: false, message: 'License plate is required' });
    }

    const cleanPlate = normalizeLicensePlate(licensePlate);

    // 1. Kiểm tra xe đang có session ACTIVE trong bãi không
    const activeSession = await Session.findOne({ licensePlate: cleanPlate, status: 'active' });
    if (activeSession) {
      return res.status(200).json({
        success: true,
        data: {
          isActive: true,
          parkingSlot: activeSession.parkingSlot || null,
          floorId: activeSession.floorId || null,
        }
      });
    }

    // 2. Kiểm tra xe đăng ký chính chủ
    const plateRegex = new RegExp(`^${cleanPlate}$`, 'i');
    const plateVariants = [cleanPlate, licensePlate.trim()].filter(Boolean);

    const registeredVehicle = await Vehicle.findOne({
      $or: [
        { licensePlate: cleanPlate },
        { licensePlate: plateRegex },
        { licensePlate: { $in: plateVariants } },
      ],
      status: 'approved'
    });

    let isVIP = false;
    let isRegisteredVehicle = false;
    let phone = null;
    let userId = null;
    let isMonthly = false;
    let subscription = null;
    let quotaExhausted = false;

    if (registeredVehicle) {
      isRegisteredVehicle = true;
      userId = registeredVehicle.owner;
      const userDetail = await UserDetail.findOne({ userId });
      if (userDetail?.phone) {
        phone = userDetail.phone;
      }

      const registeredUser = await User.findById(userId);
      if (registeredUser && registeredUser.membership && registeredUser.membership.isVip && new Date(registeredUser.membership.expireAt) > new Date()) {
        isVIP = true;
      }

      // Check Subscription (gói tháng/năm)
      const activeSubscription = await findActiveMembershipAccess(userId);

      if (activeSubscription && activeSubscription.slots && activeSubscription.slots.length > 0) {
        let availableSlot = null;
        let occupiedBySelfCount = 0;

        for (const slot of activeSubscription.slots) {
          const slotCode = slot.slotCode;
          const floorId = slot.floorId?._id || slot.floorId;
          if (slotCode && floorId) {
            const occupyingSession = await Session.findOne({
              floorId,
              parkingSlot: normalizeSlotCode(slotCode),
              status: 'active'
            });

            // Handle race condition: check if slot is held by another process (like Vehicle 1 at Step 3)
            const holding = await BookingHold.findOne({
              floorId,
              slotCode: normalizeSlotCode(slotCode),
              status: 'active',
              expiresAt: { $gt: new Date() }
            });

            if (!occupyingSession && !holding) {
              availableSlot = slot;
              break;
            } else if (occupyingSession && occupyingSession.userId && occupyingSession.userId.toString() === userId.toString()) {
              occupiedBySelfCount++;
            } else if (holding && holding.userId && holding.userId.toString() === userId.toString()) {
              occupiedBySelfCount++;
            }
          }
        }

        if (availableSlot) {
          isMonthly = true;
          subscription = activeSubscription;
          subscription.assignedSlot = availableSlot;
        } else if (occupiedBySelfCount < activeSubscription.slots.length) {
          // If all slots are occupied, but AT LEAST ONE is occupied by a stranger, we still consider them VIP for TC4
          isMonthly = true;
          subscription = activeSubscription;
        } else if (occupiedBySelfCount === activeSubscription.slots.length) {
          quotaExhausted = true;
        }
      }
    }

    // Tìm SĐT trong các session cũ để tự điền (TC2/TC3)
    const pastSession = await Session.findOne({
      $or: [
        { licensePlate: cleanPlate },
        { licensePlate: plateRegex },
        { licensePlate: { $in: plateVariants } },
      ],
      phone: { $exists: true, $nin: [null, ''] }
    }).sort({ checkInTime: -1 });

    if (!phone && pastSession?.phone) {
      phone = pastSession.phone;
    }

    // Nếu session cũ có userId nhưng phone trong session trống, tra cứu UserDetail
    if (!phone && pastSession?.userId) {
      const userDetail = await UserDetail.findOne({ userId: pastSession.userId });
      if (userDetail?.phone) {
        phone = userDetail.phone;
      }
    }

    // 3. Kiểm tra xe có Booking đang hợp lệ (PAID / PAUSED)
    const now = new Date();

    // Tìm Booking của hôm nay (được đến sớm tối đa 15 phút, đến muộn tối đa 15 phút nếu chưa check-in)
    const earlyCheckinLimit = new Date(now.getTime() + 30 * 60 * 1000);
    const lateCheckinLimit = new Date(now.getTime() - 30 * 60 * 1000);
    const cancelCheckinLimit = new Date(now.getTime() - 30 * 60 * 1000); // Tối đa 30 phút trễ để vớt vát

    let booking = await Booking.findOne({
      licensePlate: cleanPlate,
      $or: [
        {
          status: 'PAID',
          scheduledStart: { $lte: earlyCheckinLimit, $gte: lateCheckinLimit }
        },
        {
          status: 'PAUSED',
          scheduledStart: { $lte: earlyCheckinLimit }
        },
        {
          status: 'EXPIRED',
          scheduledStart: { $gte: cancelCheckinLimit }
        }
      ],
      scheduledEnd: { $gte: now }
    }).sort({ scheduledStart: 1 }).populate('floorId');

    const hasPreBooking = !!booking;
    let requiresSlotReallocation = false;

    // Ngoại lệ 2: Nếu Booking đang là EXPIRED, kiểm tra ô đỗ cũ đã bị xe khác chiếm chưa
    if (booking && booking.status === 'EXPIRED') {
      const isSlotOccupied = await Session.findOne({
        floorId: booking.floorId._id,
        parkingSlot: booking.parkingSlot,
        status: 'active'
      });
      if (isSlotOccupied) {
        requiresSlotReallocation = true;
      }
    }

    // 4. Kiểm tra bãi đầy (Dành cho Walk-in - TC7) và Auto-assign slot cho VIP
    let isFull = false;
    let vipAssignedSlot = null;
    let vipAssignedFloorId = null;
    let vipAssignedFloorName = null;

    if (!hasPreBooking && !isMonthly) {
      const floors = await ParkingFloor.find({ status: { $nin: ['draft', 'archived'] } });
      let totalSlots = 0;
      const validSlotCodesByFloor = {};
      const allSlots = [];

      for (const f of floors) {
        let parsedLayout = null;
        if (typeof f.layoutData === 'string') {
          try {
            parsedLayout = JSON.parse(f.layoutData);
          } catch (e) {
            console.error('Failed to parse layoutData', e);
          }
        } else {
          parsedLayout = f.layoutData;
        }

        if (parsedLayout && parsedLayout.elements) {
          const slots = parsedLayout.elements.filter(el =>
            ['slot', 'slot-ev', 'slot-handicap', 'slot-moto'].includes(el.type) &&
            el.name && el.name.trim() !== ''
          );
          totalSlots += slots.length;
          validSlotCodesByFloor[f._id.toString()] = slots.map(s => s.name);
          slots.forEach(s => {
            allSlots.push({ floorId: f._id, floorName: f.name, slotCode: s.name });
          });
        }
      }

      const unavailableKeys = new Set();

      // Add maintenance, physically occupied, AI-detected vehicles, and reserved slots
      const overrideSlots = await Slot.find({
        $or: [
          { status: 'maintenance' },
          { status: 'occupied' },
          { 'aiObservation.occupied': true },
          { reservedFor: { $ne: null } }
        ]
      });
      for (const mSlot of overrideSlots) {
        const floorIdStr = mSlot.floorID?.toString();
        if (floorIdStr && validSlotCodesByFloor[floorIdStr]?.includes(mSlot.slotNumber)) {
          unavailableKeys.add(`${floorIdStr}_${mSlot.slotNumber}`);
        }
      }

      // Add active sessions
      const activeSessions = await Session.find({ status: 'active' }).select('floorId parkingSlot').lean();
      for (const session of activeSessions) {
        if (session.floorId && session.parkingSlot) {
          unavailableKeys.add(`${session.floorId.toString()}_${session.parkingSlot}`);
        }
      }

      // Add upcoming bookings
      const upcomingBookings = await Booking.find({
        status: { $in: ['PAID', 'PAUSED'] },
        scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
        scheduledEnd: { $gte: now }
      }).select('floorId parkingSlot').lean();
      for (const booking of upcomingBookings) {
        if (booking.floorId && booking.parkingSlot) {
          unavailableKeys.add(`${booking.floorId.toString()}_${booking.parkingSlot}`);
        }
      }

      // If the number of unique unavailable slots is >= total slots, the lot is full
      if (unavailableKeys.size >= totalSlots) {
        isFull = true;
      } else if (isVIP || isRegisteredVehicle) {
        const availableSlots = allSlots.filter(s => !unavailableKeys.has(`${s.floorId.toString()}_${s.slotCode}`));
        // ONLY auto-assign if there is exactly 1 slot left.
        // Otherwise, let them pick on the map.
        if (availableSlots.length === 1) {
          vipAssignedSlot = availableSlots[0].slotCode;
          vipAssignedFloorId = availableSlots[0].floorId;
          vipAssignedFloorName = availableSlots[0].floorName;
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        isActive: false,
        isFull,
        isMonthly,
        hasPreBooking,
        bookingId: booking?._id || null,
        bookingDurationHours: booking?.durationHours || null,
        bookingMode: booking ? 'booking' : null,
        isVIP,
        isRegisteredVehicle,
        isKnownGuest: !!phone || isVIP || isRegisteredVehicle,
        phone: phone || null,
        assignedSlot: booking?.parkingSlot || subscription?.assignedSlot?.slotCode || vipAssignedSlot || null,
        assignedFloorId: booking?.floorId?._id || subscription?.assignedSlot?.floorId?._id || subscription?.assignedSlot?.floorId || vipAssignedFloorId || null,
        assignedFloorName: booking?.floorId?.name || subscription?.assignedSlot?.floorId?.name || vipAssignedFloorName || null,
        requiresSlotReallocation,
        quotaExhausted,
      }
    });

  } catch (error) {
    console.error('verifyPlate error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Check if the parking lot is full for walk-in guests
 * GET /api/sessions/check-full
 */
exports.checkParkingFull = async (req, res, next) => {
  try {
    const snapshot = await getParkingCapacitySnapshot(new Date());
    const isFull = snapshot.totalSlots === 0 || snapshot.occupiedSlots >= snapshot.totalSlots;

    res.status(200).json({
      success: true,
      data: { isFull }
    });

  } catch (error) {
    console.error('checkParkingFull error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Verify QR Code from Kiosk (Step 1)
 * POST /api/sessions/kiosk-verify-qr
 */
exports.kioskVerifyQr = async (req, res) => {
  try {
    const { qrPayload, entryImageBase64 } = req.body;
    let detectedPlate = req.body.detectedPlate ? normalizeLicensePlate(req.body.detectedPlate) : null;

    if (!qrPayload) {
      return res.status(400).json({ success: false, message: 'QR Payload is required' });
    }

    const trimmedPayload = String(qrPayload).trim();
    let resolved = null;

    // 1. Mã QR Đặt trước có chữ ký (VALO_BOOKING:...)
    if (trimmedPayload.startsWith('VALO_BOOKING')) {
      const parsed = parseAndVerifyBookingQr(trimmedPayload);
      const booking = await Booking.findById(parsed.bookingId).populate('vehicleId userId');
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

      resolved = {
        type: 'BOOKING',
        licensePlate: booking.vehicleId?.licensePlate || booking.licensePlate || '',
        phone: await getCanonicalUserPhone(booking.userId?._id || booking.userId),
        bookingId: booking._id,
        booking,
        assignedSlot: booking.parkingSlot,
        assignedFloorId: booking.floorId,
      };
    }

    // 2. Mã QR Thành viên VIP / Thuê bao có chữ ký (VALO_MEMBERSHIP:...)
    if (!resolved && trimmedPayload.startsWith('VALO_MEMBERSHIP')) {
      const parsed = parseAndVerifyAnyMembershipQr(trimmedPayload);
      let userId = parsed.userId;

      if (parsed.credentialType === 'LEGACY_SUBSCRIPTION') {
        const sub = await Subscription.findById(parsed.subscriptionId);
        if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
        userId = sub.user;
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'VIP account not found' });

      const vehicle = await findApprovedVehicleForOwner(userId);
      const entitlement = await MembershipSlotEntitlement.findOne({
        ownerId: userId,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: new Date() },
      });

      resolved = {
        type: 'MEMBERSHIP',
        licensePlate: vehicle?.licensePlate || '',
        phone: await getCanonicalUserPhone(userId),
        userId: user._id,
        assignedSlot: entitlement?.slotCode || null,
        assignedFloorId: entitlement?.floorId || null,
      };
    }

    if (!resolved) {
      return res.status(400).json({ success: false, message: 'Mã QR không thuộc hệ thống Valo Parking' });
    }

    // -------------------------------------------------------------
    // AI ALPR Image Plate Scan & Cross-Check Verification
    // -------------------------------------------------------------
    if (entryImageBase64 && !detectedPlate) {
      try {
        const base64Data = entryImageBase64.replace(/^data:image\/\w+;base64,/, '');
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const pythonRes = await axios.post(`${aiServiceUrl}/scan`, {
          image: base64Data
        }, {
          timeout: 4000
        });
        const found = pythonRes.data?.plate || pythonRes.data?.licensePlate;
        if (pythonRes.data && pythonRes.data.success && found) {
          detectedPlate = normalizeLicensePlate(found);
        }
      } catch (aiErr) {
        console.warn('[kioskVerifyQr] AI camera plate scan failed/timeout:', aiErr.message);
      }
    }

    const qrCleanPlate = normalizeLicensePlate(resolved.licensePlate);
    let isPlateMatched = null;
    let mismatchReason = null;
    let hasDetectedPlate = !!detectedPlate;

    if (detectedPlate) {
      const isMatched = arePlatesMatching(qrCleanPlate, detectedPlate);
      if (isMatched) {
        isPlateMatched = true;
      } else {
        isPlateMatched = false;
        mismatchReason = `Biển số xe thực tế (${detectedPlate}) không khớp với thông tin trên Mã QR (${qrCleanPlate})!`;
      }
    } else if (entryImageBase64) {
      // Có chụp ảnh nhưng AI chưa thấy biển số rõ
      isPlateMatched = false;
      mismatchReason = 'Không phát hiện thấy biển số xe trước camera! Vui lòng dừng xe ngay ngắn trước camera rồi quét lại.';
    }

    return res.status(200).json({
      success: true,
      type: resolved.type,
      licensePlate: qrCleanPlate,
      detectedPlate: detectedPlate || null,
      hasDetectedPlate,
      isPlateMatched,
      mismatchReason,
      bookingId: resolved.bookingId || null,
      assignedSlot: resolved.assignedSlot || null,
      assignedFloorId: resolved.assignedFloorId || null,
    });

  } catch (error) {
    console.error('kioskVerifyQr error:', error);
    res.status(400).json({ success: false, message: error.message || 'Lỗi xác thực mã QR' });
  }
};



/**
 * Check-in xe từ Kiosk
 * POST /api/sessions/kiosk-entry
 */
exports.createKioskSession = async (req, res, next) => {
  try {
    const {
      licensePlate,
      phone,
      vehicleType,
      parkingSlot,
      floorId,
      durationHours,
      entryImageBase64,
      entryCamera,
      entryGate,
      bookingHoldId,
      bookingId: requestedBookingId,
    } = req.body;

    if (!licensePlate) {
      return res.status(400).json({ success: false, message: 'License plate is required' });
    }
    const cleanPlate = normalizeLicensePlate(licensePlate);
    const entryIdempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (entryIdempotencyKey.length > 128) {
      return res.status(400).json({ success: false, message: 'Idempotency-Key quá dài' });
    }

    if (entryIdempotencyKey) {
      const replayedSession = await Session.findOne({ entryIdempotencyKey });
      if (replayedSession) {
        if (replayedSession.licensePlate !== cleanPlate) {
          return res.status(409).json({ success: false, message: 'Idempotency-Key đã được dùng cho phương tiện khác' });
        }
        return res.status(200).json({
          success: true,
          replayed: true,
          message: 'Check-in đã được xử lý trước đó',
          data: {
            ...toKioskSession(replayedSession),
            exitQrPayload: buildSessionExitQrPayload(replayedSession),
          },
        });
      }
    }

    // Đề phòng xe check-in trùng
    const existingSession = await Session.findOne({ licensePlate: cleanPlate, status: 'active' });
    if (existingSession) {
      return res.status(400).json({
        success: false,
        message: 'Phương tiện này đang có lịch sử đỗ xe hoạt động trong bãi.'
      });
    }

    const now = new Date();
    const earlyCheckinLimit = new Date(now.getTime() + 30 * 60 * 1000);

    // 1. Kiểm tra Booking hợp lệ của biển số (đến sớm tối đa 30 phút, đến muộn tối đa 30 phút)
    const lateCheckinLimit = new Date(now.getTime() - 30 * 60 * 1000);
    const cancelCheckinLimit = new Date(now.getTime() - 30 * 60 * 1000);

    const bookingWindow = {
      licensePlate: cleanPlate,
      $or: [
        { status: 'PAID', scheduledStart: { $lte: earlyCheckinLimit, $gte: lateCheckinLimit } },
        { status: 'PAUSED', scheduledStart: { $lte: earlyCheckinLimit } },
        { status: 'EXPIRED', scheduledStart: { $gte: cancelCheckinLimit } },
      ],
      scheduledEnd: { $gte: now },
    };
    let activeBooking;
    if (requestedBookingId) {
      if (!mongoose.Types.ObjectId.isValid(requestedBookingId)) {
        return res.status(400).json({ success: false, code: 'BOOKING_ID_INVALID', message: 'Booking không hợp lệ' });
      }
      activeBooking = await Booking.findOne({ _id: requestedBookingId, ...bookingWindow });
      if (!activeBooking) {
        return res.status(409).json({ success: false, code: 'BOOKING_NOT_AVAILABLE', message: 'Booking không thuộc biển số này hoặc không còn hiệu lực' });
      }
    } else {
      activeBooking = await Booking.findOne(bookingWindow).sort({ scheduledStart: 1 });
    }

    // 2. Kiểm tra bãi đầy (TC7)
    const capacitySnapshot = await getParkingCapacitySnapshot(now);
    if (capacitySnapshot.totalSlots === 0 || (capacitySnapshot.occupiedSlots >= capacitySnapshot.totalSlots && !activeBooking)) {
      return res.status(400).json({ success: false, message: 'Bãi xe hiện đã đầy. Vui lòng quay lại sau.' });
    }

    // Tải ảnh biển số lên Cloudinary nếu có
    let entryImage_url = null;
    if (entryImageBase64) {
      try {
        const result = await cloudinary.uploader.upload(entryImageBase64, {
          folder: 'valo_parking/sessions/entry',
        });
        entryImage_url = result.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
      }
    }

    let userId = null;
    let userEmail = null;
    let finalPhone = phone ? normalizePhone(phone) : phone;
    const regVehicle = await Vehicle.findOne({ licensePlate: { $regex: new RegExp(`^${cleanPlate}$`, 'i') }, status: 'approved' });
    const canonicalOwnerId = regVehicle?.owner || activeBooking?.userId || null;
    if (canonicalOwnerId) {
      userId = canonicalOwnerId;
      const user = await User.findById(userId);
      if (user) userEmail = user.email;
      const detail = await UserDetail.findOne({ userId });
      if (detail) finalPhone = detail.phone;
    }

    // Kiểm tra Subscription (Gói tháng/năm)
    let activeSubscription = null;
    let vipRedirected = false;
    let originalVipSlot = null;

    let isVehicleApprovedForVIP = false;
    if (userId) {
      const checkApproved = await Vehicle.findOne({ licensePlate: { $regex: new RegExp(`^${cleanPlate}$`, 'i') }, owner: userId, status: 'approved' });
      if (checkApproved) {
        isVehicleApprovedForVIP = true;
      }
    }

    if (isVehicleApprovedForVIP) {
      const sub = await findActiveMembershipAccess(userId, now);
      if (sub && sub.slots && sub.slots.length > 0) {
        let availableSlot = null;
        let occupiedBySelfCount = 0;

        for (const slot of sub.slots) {
          const slotCode = slot.slotCode;
          const floorId = slot.floorId?._id || slot.floorId;
          const occupyingSession = await Session.findOne({
            floorId,
            parkingSlot: normalizeSlotCode(slotCode),
            status: 'active'
          });

          // Check physical occupancy via camera ground truth or slot status
          const isPhysicallyBlocked = await Slot.findOne({
            floorID: floorId,
            slotNumber: normalizeSlotCode(slotCode),
            $or: [{ status: 'occupied' }, { 'aiObservation.occupied': true }]
          });

          if (!occupyingSession && !isPhysicallyBlocked) {
            availableSlot = slot;
            break;
          } else if (occupyingSession && occupyingSession.userId && occupyingSession.userId.toString() === userId.toString()) {
            occupiedBySelfCount++;
          }
        }

        if (availableSlot) {
          activeSubscription = sub;
          sub.assignedSlot = availableSlot;
        } else {
          // All slots are occupied
          if (occupiedBySelfCount === sub.slots.length) {
            // The user has exhausted their quota with their own vehicles!
            // Do NOT apply TC4. They must pay hourly as walk-in.
            activeSubscription = null;
          } else {
            // At least one slot is occupied by an UNAUTHORIZED vehicle (someone else)
            // Apply TC4: find an alternative slot for free!
            let alternativeSlot = null;
            let altFloorId = null;

            // FIRST: Check if the user already selected a slot on the kiosk map (Step 2)
            if (parkingSlot && floorId) {
              // Validate if the selected slot is indeed free
              const isOccupiedSession = await Session.findOne({ floorId, parkingSlot: normalizeSlotCode(parkingSlot), status: 'active' });
              const isPhysicallyBlocked = await Slot.findOne({
                floorID: floorId,
                slotNumber: normalizeSlotCode(parkingSlot),
                $or: [{ status: 'occupied' }, { 'aiObservation.occupied': true }, { status: 'maintenance' }],
              });
              const isBooked = await Booking.findOne({
                floorId,
                parkingSlot: normalizeSlotCode(parkingSlot),
                status: { $in: ['PAID', 'PAUSED'] },
                scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
                scheduledEnd: { $gte: now }
              });

              if (!isOccupiedSession && !isPhysicallyBlocked && !isBooked) {
                alternativeSlot = parkingSlot;
                altFloorId = floorId;
              }
            }

            // Fallback: If no valid slot was provided, scan all floors automatically
            if (!alternativeSlot) {
              const floorsData = await ParkingFloor.find({ status: { $nin: ['draft', 'archived'] } }).lean();
              for (const floor of floorsData) {
                if (!floor.layoutData || !floor.layoutData.elements) continue;

                const standardSlots = floor.layoutData.elements.filter(el => el.type === 'slot' || el.type === 'slot-ev');

                for (const slot of standardSlots) {
                  const slotCode = slot.name;
                  if (!slotCode || slotCode.trim() === '') continue;

                  // check if occupied in session
                  const occupied = await Session.findOne({ floorId: floor._id, parkingSlot: normalizeSlotCode(slotCode), status: 'active' });
                  if (occupied) continue;

                  // check if physically occupied or in maintenance
                  const physicallyBlocked = await Slot.findOne({
                    floorID: floor._id,
                    slotNumber: normalizeSlotCode(slotCode),
                    $or: [{ status: 'occupied' }, { 'aiObservation.occupied': true }, { status: 'maintenance' }],
                  });
                  if (physicallyBlocked) continue;

                  // check if it's someone else's VIP slot
                  const isVIP =
                    (await MembershipSlotEntitlement.findOne({
                      floorId: floor._id,
                      slotCode: normalizeSlotCode(slotCode),
                      status: { $in: ['active', 'transfer_locked'] },
                      expireAt: { $gt: now },
                    })) ||
                    (await mongoose.model('Subscription').findOne({
                      status: 'active',
                      expireAt: { $gt: now },
                      slots: {
                        $elemMatch: {
                          floorId: floor._id,
                          slotCode: normalizeSlotCode(slotCode),
                        },
                      },
                    }));
                  if (isVIP) continue;

                  // check if booked
                  const isBooked = await Booking.findOne({
                    floorId: floor._id,
                    parkingSlot: normalizeSlotCode(slotCode),
                    status: { $in: ['PAID', 'PAUSED'] },
                    scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
                    scheduledEnd: { $gte: now }
                  });
                  if (isBooked) continue;

                  alternativeSlot = slotCode;
                  altFloorId = floor._id;
                  break;
                }
                if (alternativeSlot) break;
              }
            }

            if (alternativeSlot) {
              activeSubscription = sub;
              vipRedirected = true;
              originalVipSlot = sub.slots[0].slotCode;
              sub.assignedSlot = {
                slotCode: alternativeSlot,
                floorId: altFloorId,
                entitlementId: sub.slots[0]?.entitlementId || null,
                sourceSubscriptionId:
                  sub.slots[0]?.sourceSubscriptionId || sub._id || null,
              };
            }
          }
        }
      }
    }

    // Bắt buộc nhập số điện thoại với Khách Vãng Lai (Không User, không Booking, không Sub)
    if (!userId && !activeBooking && !activeSubscription && !finalPhone) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập số điện thoại để Check-in' });
    }

    // Xử lý các luồng Check-in
    let sessionType = 'WALK_IN';
    let bookingId = null;
    let finalSlot = parkingSlot;
    let finalFloorId = floorId;
    let finalExpectedDuration = durationHours ? Number(durationHours) : 1;
    let finalSubscriptionId = null;
    let finalEntitlementId = null;
    let holdToConsume = null;
    let requiresExpiredBookingHold = false;
    let bookingOriginalStatus = null;
    let bookingSlotChange = null;

    if (activeBooking) {
      const wasExpiredBooking = activeBooking.status === 'EXPIRED';
      bookingOriginalStatus = activeBooking.status;

      // TC8: Khách đến sớm
      if (activeBooking.scheduledStart > now) {
        // Kiểm tra xem ô đỗ có đang bị xe khác chiếm không
        const slotOccupied = await Session.findOne({
          floorId: activeBooking.floorId,
          parkingSlot: activeBooking.parkingSlot,
          status: 'active'
        });
        if (slotOccupied) {
          return res.status(400).json({
            success: false,
            code: 'EARLY_OCCUPIED',
            message: 'Ô đỗ đặt trước của bạn hiện chưa trống. Vui lòng đợi hoặc liên hệ nhân viên để đổi ô tương đương.'
          });
        }
      }

      bookingId = activeBooking._id;
      sessionType = 'BOOKING';

      // Xử lý đổi ô đỗ nếu Booking bị EXPIRED và khách phải chọn ô mới
      if (wasExpiredBooking && parkingSlot && parkingSlot !== activeBooking.parkingSlot) {
        requiresExpiredBookingHold = true;
        bookingSlotChange = {
          oldSlot: activeBooking.parkingSlot,
          newSlot: parkingSlot,
          reason: 'Khách đến trễ, ô đỗ cũ đã bị xe khác sử dụng. Chọn lại ô mới tại Kiosk.',
          changedBy: userId || null
        };
        activeBooking.parkingSlot = parkingSlot;
        activeBooking.floorId = floorId;
      }

      finalSlot = activeBooking.parkingSlot;
      finalFloorId = activeBooking.floorId;
      finalExpectedDuration = activeBooking.durationHours;

    } else if (activeSubscription) {
      sessionType = 'SUBSCRIPTION';
      if (activeSubscription.assignedSlot) {
        finalSlot = activeSubscription.assignedSlot.slotCode;
        finalFloorId = activeSubscription.assignedSlot.floorId;
        finalEntitlementId = activeSubscription.assignedSlot.entitlementId || null;
        finalSubscriptionId =
          activeSubscription.assignedSlot.sourceSubscriptionId ||
          activeSubscription._id ||
          null;
      } else if (activeSubscription.slots && activeSubscription.slots.length > 0) {
        finalSlot = activeSubscription.slots[0].slotCode;
        finalFloorId = activeSubscription.slots[0].floorId;
        finalEntitlementId = activeSubscription.slots[0].entitlementId || null;
        finalSubscriptionId =
          activeSubscription.slots[0].sourceSubscriptionId ||
          activeSubscription._id ||
          null;
      }
      finalExpectedDuration = 24; // Mặc định cho thuê bao
    }

    const normalizedFinalSlot = normalizeSlotCode(finalSlot);
    const needsSlotHold =
      Boolean(normalizedFinalSlot && finalFloorId) &&
      (
        (!activeBooking && !activeSubscription) ||
        requiresExpiredBookingHold
      );

    if (needsSlotHold) {
      if (!bookingHoldId) {
        return res.status(400).json({
          success: false,
          code: 'HOLD_REQUIRED',
          message: 'Ô đỗ cần được khóa tạm thời trước khi check-in. Vui lòng chọn lại ô đỗ.',
        });
      }

      holdToConsume = await BookingHold.findOne({
        _id: bookingHoldId,
        status: 'active',
        expiresAt: { $gt: now },
      });

      if (!holdToConsume) {
        return res.status(400).json({
          success: false,
          code: 'HOLD_EXPIRED',
          message: 'Thời gian giữ ô đã hết hạn. Vui lòng chọn lại ô đỗ.',
        });
      }

      if (
        !sameObjectId(holdToConsume.floorId, finalFloorId) ||
        normalizeSlotCode(holdToConsume.slotCode) !== normalizedFinalSlot
      ) {
        return res.status(400).json({
          success: false,
          code: 'HOLD_SLOT_MISMATCH',
          message: 'Thông tin giữ ô không khớp với ô đỗ đã chọn. Vui lòng chọn lại ô đỗ.',
        });
      }

      if (holdToConsume.licensePlate && normalizeLicensePlate(holdToConsume.licensePlate) !== cleanPlate) {
        return res.status(400).json({
          success: false,
          code: 'HOLD_PLATE_MISMATCH',
          message: 'Giữ ô tạm thời không thuộc biển số xe này. Vui lòng chọn lại ô đỗ.',
        });
      }
    } else if (bookingHoldId) {
      holdToConsume = await BookingHold.findOne({
        _id: bookingHoldId,
        status: 'active',
        expiresAt: { $gt: now },
      });
      if (!holdToConsume) {
        return res.status(400).json({
          success: false,
          code: 'HOLD_EXPIRED',
          message: 'Thời gian giữ ô đã hết hạn. Vui lòng chọn lại ô đỗ.',
        });
      }
    }

    if (holdToConsume) {
      const holdBelongsToUser = !holdToConsume.userId
        || (userId && sameObjectId(holdToConsume.userId, userId));
      if (!holdBelongsToUser) {
        return res.status(403).json({
          success: false,
          code: 'HOLD_OWNER_MISMATCH',
          message: 'Giữ ô tạm thời không thuộc về phương tiện/người dùng này.',
        });
      }
      if (
        !sameObjectId(holdToConsume.floorId, finalFloorId)
        || normalizeSlotCode(holdToConsume.slotCode) !== normalizedFinalSlot
        || (holdToConsume.licensePlate && normalizeLicensePlate(holdToConsume.licensePlate) !== cleanPlate)
      ) {
        return res.status(400).json({
          success: false,
          code: 'HOLD_CONTEXT_MISMATCH',
          message: 'Thông tin giữ ô không khớp với lần check-in này.',
        });
      }
    }

    if (normalizedFinalSlot && finalFloorId) {
      const occupiedSlot = await Session.findOne({
        floorId: finalFloorId,
        parkingSlot: normalizedFinalSlot,
        status: 'active',
      });

      if (occupiedSlot) {
        return res.status(400).json({
          success: false,
          code: 'SLOT_OCCUPIED',
          message: 'Ô đỗ này hiện đã có xe đỗ. Vui lòng chọn ô khác.',
        });
      }

      // Check if slot is reserved for someone else's VIP package
      const isVIPReserved = await MembershipSlotEntitlement.findOne({
        floorId: finalFloorId,
        slotCode: normalizedFinalSlot,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: now },
      });

      const isSubReserved = await mongoose.model('Subscription').findOne({
        status: 'active',
        expireAt: { $gt: now },
        slots: {
          $elemMatch: {
            floorId: finalFloorId,
            slotCode: normalizedFinalSlot,
          },
        },
      });

      if (isVIPReserved || isSubReserved) {
        let isOwnVipSlot = false;

        if (userId) {
          if (isVIPReserved && String(isVIPReserved.ownerId) === String(userId)) {
            isOwnVipSlot = true;
          } else if (isSubReserved && String(isSubReserved.user) === String(userId)) {
            isOwnVipSlot = true;
          }
        }

        if (!isOwnVipSlot) {
          return res.status(400).json({
            success: false,
            code: 'SLOT_VIP_RESERVED',
            message: 'Ô đỗ này đã được đăng ký cố định cho khách hàng VIP. Vui lòng chọn ô khác.',
          });
        }
      }
    }

    let newSession;
    const entryDbSession = await mongoose.startSession();
    try {
      await entryDbSession.withTransaction(async () => {
        const duplicateSession = await Session.findOne({
          licensePlate: cleanPlate,
          status: 'active',
        }).session(entryDbSession);
        if (duplicateSession) {
          throw Object.assign(new Error('Phương tiện này vừa được check-in ở một request khác'), {
            statusCode: 409,
            replaySession: duplicateSession,
          });
        }

        let slotDoc = null;
        if (normalizedFinalSlot && finalFloorId) {
          slotDoc = await Slot.findOne({
            floorID: finalFloorId,
            slotNumber: normalizedFinalSlot,
          }).session(entryDbSession);

          if (!slotDoc) {
            throw Object.assign(new Error('Ô đỗ không tồn tại hoặc không còn được cấu hình'), {
              statusCode: 409,
              code: 'SLOT_NOT_FOUND',
            });
          }

          const isBlocked = ['maintenance', 'occupied'].includes(slotDoc.status)
            || Boolean(slotDoc.aiObservation?.occupied)
            || (slotDoc.status === 'booked' && !activeBooking);
          if (isBlocked) {
            throw Object.assign(new Error('Ô đỗ vừa được hệ thống đánh dấu không khả dụng'), {
              statusCode: 409,
              code: 'SLOT_NO_LONGER_AVAILABLE',
            });
          }

          const slotBooking = await Booking.findOne({
            _id: activeBooking ? { $ne: activeBooking._id } : { $exists: true },
            floorId: finalFloorId,
            parkingSlot: normalizedFinalSlot,
            status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
            scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
            scheduledEnd: { $gte: now },
          }).session(entryDbSession);
          if (slotBooking) {
            throw Object.assign(new Error('Ô đỗ vừa được đặt cho một booking khác'), {
              statusCode: 409,
              code: 'SLOT_BOOKED',
            });
          }
        }

        if (activeBooking) {
          const bookingUpdate = { $set: { status: 'ACTIVE' } };
          if (bookingSlotChange) {
            bookingUpdate.$set.parkingSlot = activeBooking.parkingSlot;
            bookingUpdate.$set.floorId = activeBooking.floorId;
            bookingUpdate.$push = { slotChangesHistory: bookingSlotChange };
          }
          const activatedBooking = await Booking.findOneAndUpdate(
            { _id: activeBooking._id, status: bookingOriginalStatus },
            bookingUpdate,
            { new: true, session: entryDbSession }
          );
          if (!activatedBooking) {
            throw Object.assign(new Error('Booking đã được xử lý bởi một request khác'), {
              statusCode: 409,
              code: 'BOOKING_STATE_CHANGED',
            });
          }
        }

        const createdSessions = await Session.create([{
          licensePlate: cleanPlate,
          userId,
          bookingId,
          subscriptionId: finalSubscriptionId,
          entitlementId: finalEntitlementId,
          type: sessionType,
          phone: finalPhone || null,
          vehicleType: vehicleType || 'car',
          parkingSlot: normalizedFinalSlot || null,
          floorId: finalFloorId || null,
          expectedDurationHours: finalExpectedDuration,
          entryImage_url,
          checkInTime: now,
          status: 'active',
          entryCamera: entryCamera || null,
          entryGate: entryGate || null,
          paymentStatus: 'unpaid',
          entryIdempotencyKey: entryIdempotencyKey || undefined,
        }], { session: entryDbSession });
        newSession = createdSessions[0];

        if (slotDoc) {
          const slotResult = await Slot.updateOne(
            {
              _id: slotDoc._id,
              status: { $nin: ['maintenance', 'occupied'] },
              'aiObservation.occupied': { $ne: true },
            },
            { $set: { status: 'occupied', 'aiObservation.sessionId': newSession._id } },
            { session: entryDbSession }
          );
          if (slotResult.modifiedCount !== 1) {
            throw Object.assign(new Error('Không thể khóa ô đỗ cho session mới'), {
              statusCode: 409,
              code: 'SLOT_LOCK_FAILED',
            });
          }
        }

        if (holdToConsume) {
          const consumedHold = await BookingHold.updateOne(
            {
              _id: holdToConsume._id,
              status: 'active',
              expiresAt: { $gt: now },
            },
            { $set: { status: 'consumed' } },
            { session: entryDbSession }
          );
          if (consumedHold.modifiedCount !== 1) {
            throw Object.assign(new Error('Giữ ô đã được xử lý bởi request khác'), {
              statusCode: 409,
              code: 'HOLD_ALREADY_USED',
            });
          }
        }
      });
    } finally {
      await entryDbSession.endSession();
    }

    aiNotificationEvents.notifySessionCreatedSafely(newSession, req.app);

    // Gửi email check-in thành công
    if (userEmail) {
      const formattedTime = new Date(newSession.checkInTime).toLocaleString('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      const expectedCheckoutDate = new Date(newSession.checkInTime);
      expectedCheckoutDate.setHours(expectedCheckoutDate.getHours() + newSession.expectedDurationHours);
      const formattedCheckoutTime = expectedCheckoutDate.toLocaleString('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      sendKioskCheckInEmail(userEmail, {
        sessionId: newSession._id.toString().slice(-6).toUpperCase(),
        checkInTime: formattedTime,
        expectedCheckoutTime: formattedCheckoutTime,
        duration: newSession.expectedDurationHours,
        parkingSlot: newSession.parkingSlot || 'Assigned by Kiosk',
        licensePlate: newSession.licensePlate,
        vehicleType: newSession.vehicleType
      }).catch(err => console.error('Failed to send check-in email:', err));
    }

    if (userId) {
      notifTriggers.notifyVehicleEntry(
        req.app, userId, cleanPlate, normalizedFinalSlot || 'N/A'
      ).catch(err => console.error('Failed to send entry notification:', err));
    }

    // Trigger IoT ESP32 Barrier Open
    triggerBarrierOpen(cleanPlate, normalizedFinalSlot || 'N/A', entryGate || 'ENTRY_1', req.app);

    res.status(201).json({
      success: true,
      message: vipRedirected ? `Ô đỗ VIP bị chiếm, đã đổi tạm sang ô ${normalizedFinalSlot}` : 'Check-in thành công',
      data: {
        ...toKioskSession(newSession),
        exitQrPayload: buildSessionExitQrPayload(newSession),
      },
      vipRedirected,
      originalVipSlot,
      newSlot: normalizedFinalSlot,
    });
  } catch (error) {
    console.error('Error creating kiosk session:', error);
    if (error.replaySession) {
      return res.status(200).json({
        success: true,
        replayed: true,
        message: 'Check-in đã được xử lý trước đó',
        data: {
          ...toKioskSession(error.replaySession),
          exitQrPayload: buildSessionExitQrPayload(error.replaySession),
        },
      });
    }
    if (error.code === 11000) {
      const requestKey = String(req.get('Idempotency-Key') || '').trim();
      const concurrentSession = requestKey
        ? await Session.findOne({ entryIdempotencyKey: requestKey })
        : null;
      if (concurrentSession) {
        return res.status(200).json({
          success: true,
          replayed: true,
          message: 'Check-in đã được xử lý trước đó',
          data: {
            ...toKioskSession(concurrentSession),
            exitQrPayload: buildSessionExitQrPayload(concurrentSession),
          },
        });
      }
      return res.status(409).json({
        success: false,
        code: 'ENTRY_CONFLICT',
        message: 'Phương tiện hoặc ô đỗ vừa được xử lý bởi request khác',
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code || 'ENTRY_FAILED',
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Kiosk quét quét biển số Check-out (Tính toán phí dự kiến trước khi trả tiền)
 * POST /api/sessions/kiosk-exit-scan
 */
exports.kioskExitScan = async (req, res, next) => {
  try {
    const { licensePlate, sessionId, qrPayload, exitImageBase64, detectedPlate } = req.body;

    let session = null;
    const trimmedPayload = typeof qrPayload === 'string' ? qrPayload.trim() : '';
    const isStaff = ['staff', 'admin'].includes(req.user?.role);
    let resolvedBySessionQr = false;

    if (sessionId && !isStaff) {
      return res.status(403).json({ success: false, code: 'STAFF_SESSION_LOOKUP_REQUIRED', message: 'Session ID chỉ được dùng bởi nhân viên' });
    }
    if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
      session = await Session.findOne({ _id: sessionId, status: 'active' });
    }

    if (!session && trimmedPayload) {
      if (trimmedPayload.startsWith('VALO_SESSION_EXIT:')) {
        try {
          const parsed = parseAndVerifySessionExitQr(trimmedPayload);
          session = await Session.findOne({ _id: parsed.sessionId, status: 'active' });
          resolvedBySessionQr = Boolean(session);
        } catch (error) {
          return res.status(error.statusCode || 400).json({ success: false, message: error.message });
        }
      }

      // 1. Khớp chính xác định dạng VALO_BOOKING
      if (!session && trimmedPayload.startsWith('VALO_BOOKING:')) {
        try {
          const parsed = parseAndVerifyBookingQr(trimmedPayload);
          if (parsed?.bookingId) {
            session = await Session.findOne({ bookingId: parsed.bookingId, status: 'active' });
            if (!session) {
              const b = await Booking.findById(parsed.bookingId);
              if (b?.licensePlate) {
                session = await Session.findOne({ licensePlate: normalizeLicensePlate(b.licensePlate), status: 'active' });
              }
            }
          }
        } catch (e) { }
      }

      // 2. Khớp chính xác định dạng VALO_MEMBERSHIP
      if (!session && trimmedPayload.startsWith('VALO_MEMBERSHIP')) {
        try {
          const parsed = parseAndVerifyAnyMembershipQr(trimmedPayload);
          if (parsed?.userId) {
            session = await Session.findOne({ userId: parsed.userId, status: 'active' });
            if (!session) {
              const vehicles = await Vehicle.find({ owner: parsed.userId, status: 'approved' });
              const plates = vehicles.map(v => normalizeLicensePlate(v.licensePlate)).filter(Boolean);
              if (plates.length > 0) {
                session = await Session.findOne({ licensePlate: { $in: plates }, status: 'active' });
              }
            }
          }
        } catch (e) { }
      }

      // 3. Biển số trực tiếp chỉ dùng cho camera/nhân viên, không coi là credential QR.
      if (!session) {
        const cleanPlate = normalizeLicensePlate(trimmedPayload);
        if (cleanPlate && cleanPlate.length >= 6 && cleanPlate.length <= 12) {
          session = await Session.findOne({ licensePlate: cleanPlate, status: 'active' });
        }
      }
    }

    if (!session && licensePlate) {
      const cleanPlate = normalizeLicensePlate(licensePlate);
      session = await Session.findOne({ licensePlate: cleanPlate, status: 'active' });
    }

    if (!session) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiên đỗ xe hoạt động tương ứng với thông tin quét' });
    }

    if (!isStaff && !resolvedBySessionQr && !exitImageBase64) {
      return res.status(422).json({
        success: false,
        code: 'EXIT_CAMERA_REQUIRED',
        message: 'Kiosk cần ảnh biển số tại cổng ra để xác thực phương tiện.',
      });
    }

    let actualExitPlate = detectedPlate ? normalizeLicensePlate(detectedPlate) : null;
    if (exitImageBase64 && !actualExitPlate) {
      try {
        const base64Data = exitImageBase64.replace(/^data:image\/\w+;base64,/, '');
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const aiResponse = await axios.post(`${aiServiceUrl}/scan`, { image: base64Data }, { timeout: 3000 });
        const found = aiResponse.data?.plate || aiResponse.data?.licensePlate;
        if (aiResponse.data?.success && found) actualExitPlate = normalizeLicensePlate(found);
      } catch (aiError) {
        console.warn('[kioskExitScan] AI camera plate scan failed/timeout:', aiError.message);
      }
    }

    if (actualExitPlate && !arePlatesMatching(session.licensePlate, actualExitPlate)) {
      return res.status(409).json({
        success: false,
        code: 'EXIT_PLATE_MISMATCH',
        message: `Biển số tại cổng ra (${actualExitPlate}) không khớp với session (${session.licensePlate})`,
      });
    }

    // Nếu có ảnh chụp nhưng AI timeout/inconclusive, nếu session khớp biển số thì vẫn cho phép tiếp tục lưu vết ảnh
    if (exitImageBase64 && !actualExitPlate && !licensePlate && !resolvedBySessionQr && !req.user) {
      return res.status(422).json({
        success: false,
        code: 'EXIT_PLATE_UNREADABLE',
        message: 'Không thể xác định biển số tại cổng ra. Vui lòng chụp lại ảnh rõ hơn.',
      });
    }

    const now = new Date();
    let pricing = await pricingEngine.calculatePrice(session.checkInTime, now);

    let walletBalance = 0;
    let isEarlyExit = false;
    let remainingHours = 0;
    let bookingEnd = null;
    let amountToPay = pricing.finalTotal;
    let refundAmount = 0;
    let refundBreakdown = null;

    if (session.userId) {
      const wallet = await walletService.getOrCreateWallet(session.userId);
      walletBalance = wallet.balance;
    }

    // Kiểm tra Booking trả sớm / trễ / Subscription
    if (session.type === 'BOOKING' && session.bookingId) {
      const booking = await Booking.findById(session.bookingId);
      if (booking) {
        refundBreakdown = await bookingRefundService.quoteEarlyCheckout(
          booking,
          session,
          now
        );
        amountToPay = Math.max(
          refundBreakdown.extraAmount - refundBreakdown.refundAmount,
          0
        );
        refundAmount = Math.max(
          refundBreakdown.refundAmount - refundBreakdown.extraAmount,
          0
        );
        pricing = refundBreakdown.pricingBreakdown;

        if (booking.scheduledEnd > now) {
          isEarlyExit = true;
          bookingEnd = booking.scheduledEnd;
          remainingHours = Math.ceil((booking.scheduledEnd - now) / (1000 * 60 * 60));
        }
      }
    } else if (session.type === 'SUBSCRIPTION') {
      let isSubActive = false;
      if (session.entitlementId) {
        isSubActive = Boolean(
          await MembershipSlotEntitlement.exists({
            _id: session.entitlementId,
            ownerId: session.userId,
            status: { $in: ['active', 'transfer_locked'] },
            expireAt: { $gt: now },
          })
        );
      } else if (session.userId) {
        isSubActive = Boolean(await findActiveMembershipAccess(session.userId, now));
      }

      if (isSubActive) {
        amountToPay = 0;
        refundAmount = 0;
      } else {
        // Gói đã hết hạn => Tính phí theo lượt (tính toàn bộ thời gian đỗ)
        amountToPay = pricing.finalTotal;
        refundAmount = 0;
      }
    }

    const canAutoPay = walletBalance >= amountToPay;
    const canUseWallet = Boolean(
      req.user
      && session.userId
      && sameObjectId(req.user._id, session.userId)
    );

    const SlotAuditLog = require('../models/SlotAuditLog');
    const violations = await SlotAuditLog.find({
      $or: [
        { sessionId: session._id },
        { detectedPlate: session.licensePlate, changeType: { $in: ['VIOLATION_DETECTED', 'WARNING_ISSUED'] } }
      ]
    }).sort({ createdAt: -1 }).lean();

    let violationDetails = null;
    if (violations && violations.length > 0) {
      const latest = violations[0];
      const start = new Date(latest.createdAt);
      const end = latest.resolvedAt ? new Date(latest.resolvedAt) : now;
      const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      violationDetails = {
        violationType: latest.violationType || 'WRONG_SLOT_VIOLATION',
        violationMessage: latest.violationMessage || `Phương tiện đỗ sai quy định tại ô ${latest.slotCode}`,
        slotCode: latest.slotCode,
        detectedAt: latest.createdAt,
        resolvedAt: latest.resolvedAt || now,
        durationMinutes: durationMin,
        evidenceSnapshot: latest.evidenceSnapshot || null,
        status: latest.status,
      };
    }

    res.status(200).json({
      success: true,
      data: {
        session: toKioskSession(session),
        checkOutTime: now,
        durationHours: pricing.durationHours,
        expectedHours: session.expectedDurationHours,
        totalPrice: pricing.finalTotal,
        amountToPay,
        walletBalance: canUseWallet ? walletBalance : 0,
        refundAmount,
        pricingBreakdown: pricing,
        canAutoPay: canUseWallet && canAutoPay,
        checkoutToken: buildCheckoutChallenge(session),
        isEarlyExit,
        remainingHours,
        bookingEnd,
        refundBreakdown,
        isSubscriptionExpired: session.type === 'SUBSCRIPTION' && amountToPay > 0,
        violationDetails,
      }
    });

  } catch (error) {
    console.error('Error in kioskExitScan:', error);
    next(error);
  }
};

/**
 * @desc    Verify if a phone number has past sessions and return the most recent license plate
 * @route   POST /api/sessions/verify-phone
 * @access  Public (Kiosk)
 */
exports.verifyPhone = async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone is required' });
    }

    const phoneConditions = getPhoneSearchConditions(phone);
    const phoneQuery = phoneConditions.length === 1 ? phoneConditions[0] : { $or: phoneConditions };

    const pastSession = await Session.findOne(phoneQuery).sort({ checkInTime: -1 }).lean();

    if (pastSession) {
      return res.status(200).json({
        success: true,
        data: {
          hasPastSession: true
        }
      });
    } else {
      return res.status(200).json({
        success: false,
        message: 'No past sessions found for this phone number'
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Xử lý Checkout và thanh toán thực tế tại Kiosk
 * POST /api/sessions/kiosk-checkout
 */
exports.kioskCheckout = async (req, res, next) => {
  try {
    let {
      sessionId,
      exitImageBase64,
      paymentMethod,
      paymentIntentId,
      keepPaused,
      exitCamera,
      exitGate,
      cashReceivedAmount,
      cashReceiptId,
      checkoutToken,
    } = req.body;
    paymentMethod = String(paymentMethod || '').trim().toLowerCase();
    if (paymentMethod === 'payos') paymentMethod = 'vietqr';

    const isStaff = ['staff', 'admin'].includes(req.user?.role);
    const isInternalSettlement = req.internalPaymentSettlement === true;
    if (!isStaff && !isInternalSettlement) {
      if (!checkoutToken) {
        return res.status(403).json({
          success: false,
          code: 'CHECKOUT_CHALLENGE_REQUIRED',
          message: 'Thiếu xác thực phiên checkout',
        });
      }
      try {
        const challenge = parseAndVerifyCheckoutChallenge(checkoutToken);
        if (String(challenge.sessionId) !== String(sessionId)) {
          return res.status(403).json({
            success: false,
            code: 'CHECKOUT_CHALLENGE_MISMATCH',
            message: 'Xác thực checkout không khớp với session',
          });
        }
      } catch (error) {
        return res.status(error.statusCode || 403).json({
          success: false,
          code: 'CHECKOUT_CHALLENGE_INVALID',
          message: error.message,
        });
      }
    }

    let session = await Session.findById(sessionId);
    if (!session || session.status !== 'active') {
      if (session?.status === 'completed') {
        return res.status(200).json({
          success: true,
          replayed: true,
          message: 'Checkout đã được hoàn tất trước đó',
          data: { session: toKioskSession(session), status: 'completed' },
        });
      }
      if (paymentIntentId) {
        const PaymentIntent = require('../models/PaymentIntent');
        const settledIntent = await PaymentIntent.findOne({
          _id: paymentIntentId,
          purpose: 'KIOSK_CHECKOUT',
          status: 'SETTLED',
        }).lean();
        if (settledIntent) {
          return res.status(200).json({
            success: true,
            replayed: true,
            message: 'Checkout đã được hoàn tất trước đó',
            data: { paymentIntentId: settledIntent._id, status: 'SETTLED' },
          });
        }
      }
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiên đỗ xe hoạt động' });
    }

    const now = new Date();
    let pricing = await pricingEngine.calculatePrice(session.checkInTime, now);

    // Xử lý upload ảnh exit
    let exitImage_url = null;
    if (exitImageBase64) {
      try {
        const result = await cloudinary.uploader.upload(exitImageBase64, {
          folder: 'valo_parking/sessions/exit',
        });
        exitImage_url = result.secure_url;
      } catch (err) {
        console.error('Cloudinary upload error on exit:', err);
      }
    }

    let amountToPay = pricing.finalTotal;
    let refundAmount = 0;
    let booking = null;
    let refundBreakdown = null;
    let payoutStatus = null;
    let suppressionReason = null;

    if (session.type === 'BOOKING' && session.bookingId) {
      booking = await Booking.findById(session.bookingId);
      if (booking) {
        refundBreakdown = await bookingRefundService.quoteEarlyCheckout(
          booking,
          session,
          now
        );
        amountToPay = Math.max(
          refundBreakdown.extraAmount - refundBreakdown.refundAmount,
          0
        );
        refundAmount = Math.max(
          refundBreakdown.refundAmount - refundBreakdown.extraAmount,
          0
        );
        pricing = refundBreakdown.pricingBreakdown;
      }
    } else if (session.type === 'SUBSCRIPTION') {
      let isSubActive = false;
      if (session.entitlementId) {
        isSubActive = Boolean(
          await MembershipSlotEntitlement.exists({
            _id: session.entitlementId,
            ownerId: session.userId,
            status: { $in: ['active', 'transfer_locked'] },
            expireAt: { $gt: now },
          })
        );
      } else if (session.userId) {
        isSubActive = Boolean(await findActiveMembershipAccess(session.userId, now));
      }

      if (isSubActive) {
        amountToPay = 0;
      } else {
        // Gói đã hết hạn => Tính phí theo lượt
        amountToPay = pricing.finalTotal;
      }
    }

    if (amountToPay > 0 && !['wallet', 'vietqr', 'qr', 'cash'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ' });
    }

    // 1. Kiểm tra tài khoản & trừ tiền
    if (amountToPay > 0) {
      if (paymentMethod === 'wallet') {
        if (!req.user || !sameObjectId(req.user._id, session.userId)) {
          return res.status(403).json({
            success: false,
            code: 'WALLET_OWNER_REQUIRED',
            message: 'Chỉ chủ tài khoản mới được thanh toán bằng Wallet',
          });
        }
        if (!session.userId) {
          return res.status(400).json({ success: false, message: 'Khách vãng lai không có ví Wallet' });
        }

        const wallet = await walletService.getOrCreateWallet(session.userId);
        if (wallet.balance < amountToPay) {
          return res.status(400).json({ success: false, message: 'Số dư ví không đủ để thanh toán phí phát sinh' });
        }

        if (!booking) {
          await walletService.debitWallet(
            session.userId,
            amountToPay,
            `Thanh toán Check-out phát sinh - Biển số ${session.licensePlate}`,
            {
              refSource: 'parking',
              refSourceId: session._id,
              idempotencyKey: booking
                ? `booking:${booking._id}:session:${session._id}:kiosk-extra`
                : `session:${session._id}:kiosk-extra`,
            }
          );
        }
        session.paymentStatus = 'paid';
      } else if (paymentMethod === 'vietqr') {
        const paymentIntent = await createKioskPaymentIntent({
          session,
          amount: amountToPay,
          idempotencyKey: `kiosk-checkout:${session._id}:vietqr`,
          metadata: {
            keepPaused: keepPaused === true || keepPaused === 'true',
            exitCamera: exitCamera || null,
            exitGate: exitGate || null,
            refundAmount,
            refundBreakdown,
            pricing,
            quotedAmount: amountToPay,
          },
        });

        if (paymentIntent.checkoutUrl && paymentIntent.qrCode) {
          return res.status(200).json({
            success: true,
            message: 'Vui lòng thanh toán qua VietQR để mở cổng',
            requiresPayment: true,
            data: {
              paymentIntentId: paymentIntent._id,
              orderCode: paymentIntent.providerOrderCode,
              checkoutUrl: paymentIntent.checkoutUrl,
              qrCode: paymentIntent.qrCode,
              paymentStatus: paymentIntent.status,
            }
          });
        }

        const paymentData = {
          orderCode: paymentIntent.providerOrderCode,
          amount: amountToPay,
          description: `VALO Checkout`,
          returnUrl: process.env.CLIENT_URL || 'http://localhost:5173/kiosk/checkout-success',
          cancelUrl: process.env.CLIENT_URL || 'http://localhost:5173/kiosk/checkout-cancel',
          items: [
            {
              name: `Thanh toán gửi xe biển số ${session.licensePlate}`,
              quantity: 1,
              price: amountToPay,
            },
          ],
        };

        const paymentLink = await payos.paymentRequests.create(paymentData);
        await attachProviderPayment(paymentIntent, paymentLink);

        return res.status(200).json({
          success: true,
          message: 'Vui lòng thanh toán qua VietQR để mở cổng',
          requiresPayment: true,
          data: {
            paymentIntentId: paymentIntent._id,
            orderCode: paymentIntent.providerOrderCode,
            checkoutUrl: paymentLink.checkoutUrl,
            qrCode: paymentLink.qrCode,
            paymentStatus: paymentIntent.status,
          }
        });
      } else if (paymentMethod === 'qr') {
        if (!paymentIntentId) {
          return res.status(400).json({ success: false, message: 'Thiếu payment intent cho giao dịch QR' });
        }
        const PaymentIntent = require('../models/PaymentIntent');
        const paymentIntent = await PaymentIntent.findOne({
          _id: paymentIntentId,
          purpose: 'KIOSK_CHECKOUT',
          sessionId: session._id,
          provider: 'PAYOS',
        });
        if (!paymentIntent || !['PAID', 'SETTLED'].includes(paymentIntent.status)) {
          return res.status(402).json({ success: false, message: 'Thanh toán QR chưa được xác nhận' });
        }
        if (paymentIntent.expiresAt && paymentIntent.expiresAt <= now && paymentIntent.status === 'PENDING') {
          return res.status(402).json({ success: false, message: 'Payment intent đã hết hạn, vui lòng tạo lại giao dịch' });
        }
        const quotedAmount = Number(paymentIntent.metadata?.quotedAmount);
        if (
          (Number.isFinite(quotedAmount) && Number(paymentIntent.amount) !== quotedAmount)
          || (!Number.isFinite(quotedAmount) && Number(paymentIntent.amount) !== Number(amountToPay))
        ) {
          return res.status(409).json({
            success: false,
            code: 'PAYMENT_AMOUNT_MISMATCH',
            message: 'Payment intent có số tiền không hợp lệ, vui lòng tạo lại giao dịch',
          });
        }
        amountToPay = Number(paymentIntent.amount);
        if (paymentIntent.metadata) {
          keepPaused = paymentIntent.metadata.keepPaused;
          exitCamera = paymentIntent.metadata.exitCamera || exitCamera;
          exitGate = paymentIntent.metadata.exitGate || exitGate;
          refundAmount = Number(paymentIntent.metadata.refundAmount || 0);
          refundBreakdown = paymentIntent.metadata.refundBreakdown || refundBreakdown;
          pricing = paymentIntent.metadata.pricing || pricing;
        }
        session.paymentStatus = 'paid';
      } else if (paymentMethod === 'cash') {
        if (!req.user || !['staff', 'admin'].includes(req.user.role)) {
          return res.status(403).json({ success: false, message: 'Chỉ nhân viên mới được xác nhận thanh toán tiền mặt' });
        }
        const receivedAmount = Number(cashReceivedAmount);
        if (!Number.isInteger(receivedAmount) || receivedAmount < amountToPay) {
          return res.status(400).json({
            success: false,
            code: 'CASH_AMOUNT_INVALID',
            message: `Số tiền khách đưa phải là số nguyên và tối thiểu ${amountToPay.toLocaleString('vi-VN')} VND`,
          });
        }
        const changeAmount = receivedAmount - amountToPay;
        const cashIntent = await createKioskPaymentIntent({
          session,
          amount: amountToPay,
          provider: 'CASH',
          idempotencyKey: `kiosk-checkout:${session._id}:cash`,
          cashReceivedAmount: receivedAmount,
          changeAmount,
          confirmedBy: req.user._id,
          metadata: {
            staffId: req.user._id,
            cashReceiptId: cashReceiptId || null,
          },
        });
        await markPaymentIntentPaidById({
          intentId: cashIntent._id,
          amount: amountToPay,
          reference: cashReceiptId || `CASH:${cashIntent._id}`,
          confirmedBy: req.user._id,
        });
        paymentIntentId = cashIntent._id;
        session.paymentStatus = 'paid';
      }
    } else {
      session.paymentStatus = 'paid';
    }

    // 2. Xử lý trả sớm Booking
    let sessionFinalizedAtomically = false;
    if (booking) {
      if (keepPaused === true || keepPaused === 'true') {
        // Tạm dừng: Giữ ô đỗ, đổi trạng thái Booking sang PAUSED
        const pauseSession = await mongoose.startSession();
        try {
          pauseSession.startTransaction();

          if (amountToPay >= 1000 && paymentMethod === 'wallet') {
            await walletService.debitWallet(
              session.userId,
              amountToPay,
              `Settle paused kiosk checkout for booking ${booking._id}`,
              {
                refSource: 'parking',
                refSourceId: session._id,
                idempotencyKey: `booking:${booking._id}:session:${session._id}:kiosk-extra`,
                session: pauseSession,
              }
            );
          }

          const pausedBooking = await Booking.findOneAndUpdate(
            { _id: booking._id, status: 'ACTIVE' },
            {
              $set: { status: 'PAUSED' },
              ...(amountToPay > 0 &&
                (paymentMethod !== 'wallet' || amountToPay >= 1000)
                ? {
                  $push: {
                    paidOverageAdjustments: {
                      eventKey: `booking:${booking._id}:session:${session._id}:kiosk-extra`,
                      amount: amountToPay,
                      paymentMethod,
                      sessionId: session._id,
                      paidAt: now,
                    },
                  },
                }
                : {}),
            },
            { new: true, session: pauseSession }
          );
          if (!pausedBooking) {
            throw Object.assign(new Error('Booking is no longer active'), {
              statusCode: 409,
            });
          }

          const completedSession = await Session.findOneAndUpdate(
            { _id: session._id, status: 'active' },
            {
              status: 'completed',
              checkOutTime: now,
              totalPrice: refundBreakdown.actualParkingCharge,
              pricingBreakdown: pricing,
              paymentStatus: session.paymentStatus,
              ...(exitImage_url ? { exitImage_url } : {}),
              ...(exitCamera ? { exitCamera } : {}),
              ...(exitGate ? { exitGate } : {}),
            },
            { new: true, session: pauseSession }
          );
          if (!completedSession) {
            throw Object.assign(new Error('Parking session is no longer active'), {
              statusCode: 409,
            });
          }

          await pauseSession.commitTransaction();
          booking = pausedBooking;
          payoutStatus = amountToPay > 0
            ? amountToPay >= 1000
              ? 'debited'
              : 'suppressed'
            : 'not_required';
          suppressionReason =
            amountToPay > 0 && amountToPay < 1000
              ? 'below_wallet_transaction_minimum'
              : null;
          sessionFinalizedAtomically = true;
        } catch (error) {
          await pauseSession.abortTransaction();
          throw error;
        } finally {
          await pauseSession.endSession();
        }
        console.log(`Booking ${booking._id} set to PAUSED. Slot ${booking.parkingSlot} is retained.`);
      } else {
        const settled = await bookingRefundService.settleBookingEvent({
          bookingId: booking._id,
          eventKey: `booking:${booking._id}:early-checkout`,
          eventType: 'early_checkout',
          calculation: refundBreakdown,
          description: `Settle kiosk checkout for booking ${booking._id}`,
          walletNetAmount:
            paymentMethod === 'wallet'
              ? refundAmount - amountToPay
              : refundAmount,
          applyState: async ({ booking: currentBooking, session: mongoSession }) => {
            if (currentBooking.status !== 'ACTIVE') {
              throw Object.assign(new Error('Booking is no longer active'), {
                statusCode: 409,
              });
            }
            currentBooking.status = 'COMPLETED';
            if (paymentMethod !== 'wallet' && amountToPay > 0) {
              currentBooking.paidOverageAdjustments.push({
                eventKey: `booking:${currentBooking._id}:session:${session._id}:checkout-extra`,
                amount: amountToPay, paymentMethod, sessionId: session._id, paidAt: now,
              });
            }
            const updatedSession = await Session.findOneAndUpdate(
              { _id: session._id, status: 'active' },
              {
                status: 'completed',
                checkOutTime: now,
                totalPrice: refundBreakdown.actualParkingCharge,
                pricingBreakdown: pricing,
                paymentStatus: session.paymentStatus,
                ...(exitImage_url ? { exitImage_url } : {}),
                ...(exitCamera ? { exitCamera } : {}),
                ...(exitGate ? { exitGate } : {}),
              },
              { new: true, session: mongoSession }
            );
            if (!updatedSession) {
              throw Object.assign(new Error('Parking session is no longer active'), {
                statusCode: 409,
              });
            }
          },
        });
        booking = settled.booking;
        payoutStatus = settled.settlement.payoutStatus;
        suppressionReason = settled.settlement.suppressionReason;
        sessionFinalizedAtomically = true;
      }
    }

    // 3. Hoàn tất Session đỗ xe
    if (!sessionFinalizedAtomically) {
      const completedSession = await Session.findOneAndUpdate(
        { _id: session._id, status: 'active' },
        {
          $set: {
            status: 'completed',
            checkOutTime: now,
            totalPrice: refundBreakdown?.actualParkingCharge ?? pricing.finalTotal,
            settledPaidAmount: amountToPay,
            paymentStatus: session.paymentStatus,
            pricingBreakdown: pricing,
            ...(exitImage_url ? { exitImage_url } : {}),
            ...(exitCamera ? { exitCamera } : {}),
            ...(exitGate ? { exitGate } : {}),
          },
        },
        { new: true }
      );
      if (!completedSession) {
        return res.status(200).json({
          success: true,
          replayed: true,
          message: 'Checkout đã được hoàn tất bởi request khác',
          data: { sessionId: session._id, status: 'completed' },
        });
      }
      session = completedSession;
    } else {
      session.status = 'completed';
      session.checkOutTime = now;
      session.totalPrice = refundBreakdown?.actualParkingCharge ?? pricing.finalTotal;
      session.settledPaidAmount = amountToPay;
      session.pricingBreakdown = pricing;
      if (exitImage_url) session.exitImage_url = exitImage_url;
      if (exitCamera) session.exitCamera = exitCamera;
      if (exitGate) session.exitGate = exitGate;
    }

    if (session.type !== 'BOOKING' && amountToPay > 0) {
      await recordParkingRevenue({
        session,
        amount: amountToPay,
        paymentMethod,
        paymentIntentId,
        createdBy: req.user?._id || null,
      });
    }

    // Gửi email checkout thành công
    if (session.userId) {
      try {
        const user = await User.findById(session.userId);
        if (user && user.email) {
          const formattedCheckIn = new Date(session.checkInTime).toLocaleString('en-US', {
            timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short'
          });
          const formattedCheckOut = new Date(session.checkOutTime).toLocaleString('en-US', {
            timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short'
          });

          sendCheckoutEmail(user.email, {
            sessionId: session._id.toString().slice(-6).toUpperCase(),
            checkInTime: formattedCheckIn,
            checkOutTime: formattedCheckOut,
            duration: `${pricing.durationHours} giờ`,
            parkingSlot: session.parkingSlot || 'Assigned by Kiosk',
            licensePlate: session.licensePlate,
            vehicleType: session.vehicleType,
            totalPrice: session.totalPrice.toLocaleString('vi-VN') + ' VND'
          }).catch(err => console.error('Failed to send Checkout email:', err));
        }
      } catch (err) {
        console.error('Error fetching user for checkout email:', err);
      }

      // Gửi thông báo đẩy về App
      const uid = session.userId._id || session.userId;
      notifTriggers.notifyVehicleExit(
        req.app, uid, session.licensePlate, pricing.finalTotal
      ).catch(err => console.error('Failed to send exit notification:', err));

      if (paymentMethod === 'wallet') {
        notifTriggers.notifyPaymentSuccess(
          req.app, uid, pricing.finalTotal, session._id.toString()
        ).catch(err => console.error('Failed to send payment notification:', err));
      }
    }

    // Release slot to available if vehicle is no longer physically occupying it
    if (session.parkingSlot && session.floorId) {
      const slotCode = normalizeSlotCode(session.parkingSlot);
      const floorId = session.floorId;
      try {
        const slotDoc = await Slot.findOne({ floorID: floorId, slotNumber: slotCode });
        const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');
        const activeMaintenance = slotDoc ? await SlotMaintenanceLog.findOne({
          slotID: slotDoc._id,
          $or: [{ endTime: { $gte: new Date() } }, { endTime: null }]
        }) : null;
        const isUnderMaintenance = Boolean(activeMaintenance || slotDoc?.status === 'maintenance');

        if (slotDoc && !isUnderMaintenance) {
          slotDoc.status = 'available';
          if (slotDoc.aiObservation) {
            slotDoc.aiObservation.occupied = false;
            slotDoc.aiObservation.detectedPlate = null;
            slotDoc.aiObservation.sessionId = null;
            slotDoc.aiObservation.isViolation = false;
          }
          await slotDoc.save();

          // Ghi nhận lịch sử ô đỗ: Xe checkout tại cổng và giải phóng ô thành ô trống
          const SlotAuditLog = require('../models/SlotAuditLog');
          await SlotAuditLog.create({
            slotId: slotDoc._id,
            slotCode: slotDoc.slotNumber,
            floorId: floorId,
            changeType: 'OCCUPANCY_CHANGED',
            detectedPlate: session.licensePlate,
            status: 'RESOLVED',
            resolutionAction: 'CHECKOUT_RELEASED',
            resolutionNote: `Xe ${session.licensePlate} đã checkout thành công tại cổng ra, ô đỗ chuyển sang trạng thái trống`,
            resolvedAt: new Date(),
            sessionId: session._id,
          });
        }
      } catch (err) {
        console.warn('Failed to release slot on checkout:', err.message);
      }
    }

    if (paymentIntentId) {
      await markPaymentIntentSettled(paymentIntentId);
    }

    // Trigger IoT ESP32 Barrier Open on Exit
    triggerBarrierOpen(session.licensePlate, session.parkingSlot || 'N/A', exitGate || 'EXIT_1', req.app);

    res.status(200).json({
      success: true,
      message: 'Checkout hoàn tất thành công, Barrier đã mở',
      data: {
        ...session.toObject(),
        amountToPay,
        refundAmount,
        refundBreakdown: refundBreakdown
          ? { ...refundBreakdown, payoutStatus, suppressionReason }
          : null,
        ...(paymentMethod === 'cash' && amountToPay > 0
          ? {
            cashReceivedAmount: Number(cashReceivedAmount),
            changeAmount: Number(cashReceivedAmount) - Number(amountToPay),
            paymentMethod: 'cash',
          }
          : {}),
      }
    });

  } catch (error) {
    console.error('Error in kioskCheckout:', error);
    next(error);
  }
};

/**
 * Lấy lịch sử tất cả các Session (Staff/Admin)
 * GET /api/sessions
 */
exports.getAllSessions = async (req, res, next) => {
  try {
    const sessions = await Session.find().sort({ checkInTime: -1 });
    res.status(200).json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    console.error('Error getting sessions:', error);
    next(error);
  }
};

/**
 * Lấy lịch sử đỗ xe của cá nhân User
 * GET /api/sessions/my-history
 */
exports.getMyHistory = async (req, res, next) => {
  try {
    const Vehicle = require('../models/Vehicle');
    const Booking = require('../models/Booking');
    const myVehicles = await Vehicle.find({ owner: req.user._id, status: 'approved' }).distinct('licensePlate');
    const myBookings = await Booking.find({ userId: req.user._id }).distinct('_id');

    const userDetail = await UserDetail.findOne({ userId: req.user._id });
    const orConditions = [
      { userId: req.user._id },
      { licensePlate: { $in: myVehicles } },
      { bookingId: { $in: myBookings } }
    ];

    const userPhone = userDetail?.phone || '';
    if (userPhone && String(userPhone).trim() !== '') {
      // Auto-claim any orphan/unclaimed session for this user phone
      await claimUserSessionsByPhone(req.user._id, userPhone);
      const phoneConditions = getPhoneSearchConditions(userPhone);
      if (phoneConditions.length) {
        orConditions.push(...phoneConditions);
      }
    }

    const sessions = await Session.find({
      $or: orConditions
    }).sort({ checkInTime: -1 });

    res.status(200).json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    console.error('Error getting my history:', error);
    next(error);
  }
};

/**
 * Trạng thái bãi đỗ xe trực tiếp (Active)
 * GET /api/sessions/active-status
 */
exports.getActiveParkingStatus = async (req, res, next) => {
  try {
    const activeSessions = await Session.find({ status: 'active', parkingSlot: { $ne: null } })
      .select('licensePlate parkingSlot floorId vehicleType checkInTime expectedDurationHours status phone userId entryImage_url')
      .populate('userId', 'fullName username email phone')
      .lean();

    res.status(200).json({
      success: true,
      data: activeSessions.map(toPublicActiveSession),
    });
  } catch (error) {
    console.error('Error getting active parking status:', error);
    next(error);
  }
};

/**
 * Kiểm tra trạng thái thanh toán PayOS
 * GET /api/sessions/check-payos/:orderCode
 */
exports.checkPayosStatus = async (req, res, next) => {
  try {
    const { orderCode } = req.params;
    if (!orderCode) {
      return res.status(400).json({ success: false, message: 'Thiếu mã đơn hàng' });
    }

    const PaymentIntent = require('../models/PaymentIntent');
    const intent = await PaymentIntent.findOne({
      purpose: 'KIOSK_CHECKOUT',
      provider: 'PAYOS',
      providerOrderCode: Number(orderCode),
    });
    if (!intent) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy payment intent' });
    }

    const payosInfo = await payos.paymentRequests.get(Number(orderCode));

    if (payosInfo && payosInfo.status === 'PAID') {
      const paidIntent = await markPaymentIntentPaid({
        orderCode,
        amount: payosInfo.amount ?? intent.amount,
        reference: payosInfo.reference || null,
      });
      return res.status(200).json({
        success: true,
        isPaid: true,
        expired: false,
        expiresAt: intent.expiresAt,
        paymentIntentId: paidIntent?._id || intent._id,
        paymentStatus: paidIntent?.status || intent.status,
      });
    } else {
      if (payosInfo && ['CANCELLED', 'EXPIRED'].includes(payosInfo.status)) {
        await PaymentIntent.findOneAndUpdate(
          { _id: intent._id, status: { $in: ['CREATED', 'PENDING'] } },
          { $set: { status: payosInfo.status } }
        );
      }
      const expired = Boolean(
        intent.status === 'EXPIRED'
        || (intent.expiresAt && intent.expiresAt <= new Date())
      );
      if (expired) {
        await PaymentIntent.findOneAndUpdate(
          { _id: intent._id, status: { $in: ['CREATED', 'PENDING'] } },
          { $set: { status: 'EXPIRED' } }
        );
      }
      return res.status(200).json({
        success: true,
        isPaid: false,
        expired,
        expiresAt: intent.expiresAt,
      });
    }
  } catch (error) {
    console.error('Error checking PayOS status:', error);
    // Return false on error to avoid breaking the polling loop
    return res.status(200).json({ success: false, isPaid: false });
  }
};

exports.handleKioskPaymentWebhook = async (req, res) => {
  try {
    const webhookData = await payos.webhooks.verify(req.body);
    let settlementPending = false;
    if (webhookData.code === '00') {
      const paidIntent = await markPaymentIntentPaid({
        orderCode: webhookData.orderCode,
        amount: webhookData.amount,
        reference: webhookData.reference || null,
      });

      if (paidIntent?.sessionId) {
        const settlementResponse = {
          statusCode: 200,
          body: null,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(body) {
            this.body = body;
            return this;
          },
        };
        try {
          await new Promise((resolve, reject) => {
            Promise.resolve(exports.kioskCheckout(
              {
                body: {
                  sessionId: paidIntent.sessionId,
                  paymentMethod: 'qr',
                  paymentIntentId: paidIntent._id,
                  keepPaused: paidIntent.metadata?.keepPaused || false,
                  exitCamera: paidIntent.metadata?.exitCamera || null,
                  exitGate: paidIntent.metadata?.exitGate || null,
                },
                app: req.app,
                user: null,
                internalPaymentSettlement: true,
                get: req.get.bind(req),
              },
              settlementResponse,
              reject
            )).then(resolve).catch(reject);
          });
          if (settlementResponse.statusCode >= 400 || settlementResponse.body?.success === false) {
            settlementPending = true;
          }
        } catch (settlementError) {
          settlementPending = true;
          console.error('Kiosk payment auto-settlement pending:', settlementError.message);
        }
      }
    }
    return res.status(200).json({ success: true, message: 'OK', settlementPending });
  } catch (error) {
    console.error('Kiosk payment webhook error:', error.message);
    return res.status(400).json({ success: false, message: 'Invalid payment webhook' });
  }
};

/**
 * Staff/Admin reassigns a parking slot for an active session (e.g. resolve wrong-slot violation)
 * POST /api/sessions/:id/reassign-slot
 */
exports.reassignSlot = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newSlotCode, floorId, reason } = req.body;

    if (!newSlotCode) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mã ô đỗ mới (newSlotCode)' });
    }

    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiên đỗ xe' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể đổi ô cho phiên đỗ đang hoạt động (active)' });
    }

    const oldSlot = session.parkingSlot;
    session.parkingSlot = String(newSlotCode).trim().toUpperCase();
    if (floorId) {
      session.floorId = floorId;
    }
    await session.save();

    console.log(`[reassignSlot] Session ${session.licensePlate} reassigned from ${oldSlot} to ${session.parkingSlot} by ${req.user?.username || 'Staff'}. Reason: ${reason || 'N/A'}`);

    return res.status(200).json({
      success: true,
      message: `Đã chuyển ô đỗ xe ${session.licensePlate} từ ${oldSlot || 'N/A'} sang ${session.parkingSlot} thành công`,
      data: session
    });
  } catch (error) {
    console.error('Error reassigning slot:', error);
    next(error);
  }
};

exports.getParkingCapacitySnapshot = getParkingCapacitySnapshot;

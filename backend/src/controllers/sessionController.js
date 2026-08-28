const Session = require('../models/Session');
const UserDetail = require('../models/UserDetail');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const ParkingFloor = require('../models/ParkingFloor');
const mongoose = require('mongoose');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const payos = require('../config/payos');
const cloudinary = require('../config/cloudinary');
const { sendKioskCheckInEmail, sendCheckoutEmail } = require('../utils/emailUtils');
const notifTriggers = require('../services/notificationTriggers');
const walletService = require('../services/walletService');
const pricingEngine = require('../services/pricingEngine');
const bookingRefundService = require('../services/bookingRefundService');
const { parseAndVerifyAnyMembershipQr } = require('../services/membershipQrService');
const { parseAndVerifyBookingQr } = require('../services/bookingQrService');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');
const { normalizePhone, getPhoneVariants, claimUserSessionsByPhone } = require('../utils/phoneUtils');

const normalizeSlotCode = (slotCode = '') => String(slotCode || '').trim().toUpperCase();
const sameObjectId = (a, b) => String(a || '') === String(b || '');

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
        data: { isActive: true, phone: activeSession.phone, session: activeSession }
      });
    }

    // 2. Kiểm tra xe đăng ký chính chủ
    const registeredVehicle = await Vehicle.findOne({
      licensePlate: cleanPlate,
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
      if (userDetail) {
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
          
          // CRITICAL: We MUST create a short hold for the fast-pass to prevent race condition with Vehicle 2
          const holdStart = new Date();
          const holdEnd = new Date(holdStart.getTime() + 5 * 60 * 1000); // 5 minutes hold
          const fastPassHold = new BookingHold({
            floorId: availableSlot.floorId?._id || availableSlot.floorId,
            slotCode: normalizeSlotCode(availableSlot.slotCode),
            userId,
            licensePlate: cleanPlate,
            status: 'active',
            startTime: holdStart,
            endTime: holdEnd,
            expiresAt: holdEnd
          });
          await fastPassHold.save();
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
    const pastSession = await Session.findOne({ licensePlate: cleanPlate, phone: { $ne: null } }).sort({ checkInTime: -1 });
    if (!phone && pastSession) {
      phone = pastSession.phone;
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
      const floors = await ParkingFloor.find();
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
      
      const Slot = require('../models/Slot');
      const unavailableKeys = new Set();

      // Add maintenance and reserved slots
      const overrideSlots = await Slot.find({
        $or: [
          { status: 'maintenance' },
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
        booking: booking || null,
        subscription: subscription || null,
        isVIP,
        isRegisteredVehicle,
        phone,
        isKnownGuest: !!phone || isVIP || isRegisteredVehicle,
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
    const floors = await ParkingFloor.find();
    let totalSlots = 0;
    const validSlotCodesByFloor = {};
    
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
      }
    }
    
    const Slot = require('../models/Slot');
    const maintenanceSlots = await Slot.find({ status: 'maintenance' });
    let validMaintenanceCount = 0;
    for (const mSlot of maintenanceSlots) {
      const floorIdStr = mSlot.floorID?.toString();
      if (floorIdStr && validSlotCodesByFloor[floorIdStr]?.includes(mSlot.slotNumber)) {
        validMaintenanceCount++;
      }
    }
    const effectiveTotalSlots = totalSlots - validMaintenanceCount;

    const now = new Date();
    const activeSessionsCount = await Session.countDocuments({ status: 'active' });
    const upcomingBookingsCount = await Booking.countDocuments({
      status: { $in: ['PAID', 'PAUSED'] },
      scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
      scheduledEnd: { $gte: now }
    });

    const isFull = (activeSessionsCount + upcomingBookingsCount) >= effectiveTotalSlots;

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
    const { qrPayload } = req.body;
    if (!qrPayload) {
      return res.status(400).json({ success: false, message: 'QR Payload is required' });
    }

    if (qrPayload.startsWith('VALO_BOOKING')) {
      const parsed = parseAndVerifyBookingQr(qrPayload);
      const booking = await Booking.findById(parsed.bookingId).populate('vehicleId userId');
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
      
      return res.status(200).json({
        success: true,
        type: 'BOOKING',
        licensePlate: booking.vehicleId?.licensePlate || booking.licensePlate || '',
        phone: booking.userId?.phone || booking.phone || '',
      });
    } 
    
    if (qrPayload.startsWith('VALO_MEMBERSHIP')) {
      const parsed = parseAndVerifyAnyMembershipQr(qrPayload);
      let userId = parsed.userId;

      if (parsed.credentialType === 'LEGACY_SUBSCRIPTION') {
        const Subscription = require('../models/Subscription'); // Load model dynamically or at top
        const sub = await Subscription.findById(parsed.subscriptionId);
        if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
        userId = sub.user;
      }
      
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'VIP account not found' });

      // Find user's active vehicle (or just the first one if there are multiple)
      const vehicle = await Vehicle.findOne({ ownerId: userId, status: 'active' });

      return res.status(200).json({
        success: true,
        type: 'MEMBERSHIP',
        licensePlate: vehicle?.licensePlate || '',
        phone: user.phone || '',
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid QR format' });

  } catch (error) {
    console.error('kioskVerifyQr error:', error);
    res.status(400).json({ success: false, message: error.message || 'Invalid QR code' });
  }
};


/**
 * Check-in xe từ Kiosk
 * POST /api/sessions/kiosk-entry
 */
exports.createKioskSession = async (req, res, next) => {
  try {
    const { licensePlate, phone, vehicleType, parkingSlot, floorId, durationHours, entryImageBase64, entryCamera, entryGate, bookingHoldId } = req.body;

    if (!licensePlate) {
      return res.status(400).json({ success: false, message: 'License plate is required' });
    }
    const cleanPlate = normalizeLicensePlate(licensePlate);

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

    const activeBooking = await Booking.findOne({
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
    }).sort({ scheduledStart: 1 });

    // 2. Kiểm tra bãi đầy (TC7)
    const floors = await ParkingFloor.find();
    let totalSlots = 0;
    for (const f of floors) {
      if (f.layoutData && f.layoutData.elements) {
        const slots = f.layoutData.elements.filter(el => ['slot', 'slot-ev', 'slot-handicap', 'slot-moto'].includes(el.type));
        totalSlots += slots.length;
      }
    }
    const activeSessionsCount = await Session.countDocuments({ status: 'active' });
    const upcomingBookingsCount = await Booking.countDocuments({
      status: { $in: ['PAID', 'PAUSED'] },
      scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
      scheduledEnd: { $gte: now }
    });
    if (activeSessionsCount + upcomingBookingsCount >= totalSlots && !activeBooking) {
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

    // Xác định User
    let userId = null;
    let userEmail = null;
    let finalPhone = phone ? normalizePhone(phone) : phone;

    if (finalPhone) {
      const phoneVariants = getPhoneVariants(finalPhone);
      const detail = await UserDetail.findOne({ phone: { $in: phoneVariants } }).sort({ createdAt: -1 });
      if (detail) {
        const user = await User.findById(detail.userId);
        if (user) {
          userId = user._id;
          userEmail = user.email;
        }
      }
    }

    const regVehicle = await Vehicle.findOne({ licensePlate: { $regex: new RegExp(`^${cleanPlate}$`, 'i') }, status: 'approved' });
    if (regVehicle && !userId) {
      userId = regVehicle.owner;
      const user = await User.findById(userId);
      if (user) userEmail = user.email;
      const detail = await UserDetail.findOne({ userId });
      if (detail) finalPhone = detail.phone;
    }

    if (activeBooking && !userId && activeBooking.userId) {
      userId = activeBooking.userId;
      const user = await User.findById(userId);
      if (user) userEmail = user.email;
      const detail = await UserDetail.findOne({ userId });
      if (detail && !finalPhone) finalPhone = detail.phone;
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

          if (!occupyingSession) {
            availableSlot = slot;
            break;
          } else if (occupyingSession.userId && occupyingSession.userId.toString() === userId.toString()) {
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
              const isOccupied = await Session.findOne({ floorId, parkingSlot: normalizeSlotCode(parkingSlot), status: 'active' });
              const isBooked = await Booking.findOne({
                floorId,
                parkingSlot: normalizeSlotCode(parkingSlot),
                status: { $in: ['PAID', 'PAUSED'] },
                scheduledStart: { $lte: new Date(now.getTime() + 30 * 60 * 1000) },
                scheduledEnd: { $gte: now }
              });
              
              if (!isOccupied && !isBooked) {
                alternativeSlot = parkingSlot;
                altFloorId = floorId;
              }
            }

            // Fallback: If no valid slot was provided, scan all floors automatically
            if (!alternativeSlot) {
              const floorsData = await ParkingFloor.find().lean();
              for (const floor of floorsData) {
              if (!floor.layoutData || !floor.layoutData.elements) continue;
              
              const standardSlots = floor.layoutData.elements.filter(el => el.type === 'slot' || el.type === 'slot-ev');
              
              for (const slot of standardSlots) {
                const slotCode = slot.name;
                if (!slotCode || slotCode.trim() === '') continue;
                
                // check if occupied
                const occupied = await Session.findOne({ floorId: floor._id, parkingSlot: normalizeSlotCode(slotCode), status: 'active' });
                if (occupied) continue;
                
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

    if (activeBooking) {
      const wasExpiredBooking = activeBooking.status === 'EXPIRED';

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
        activeBooking.slotChangesHistory.push({
          oldSlot: activeBooking.parkingSlot,
          newSlot: parkingSlot,
          reason: 'Khách đến trễ, ô đỗ cũ đã bị xe khác sử dụng. Chọn lại ô mới tại Kiosk.',
          changedBy: userId || null
        });
        activeBooking.parkingSlot = parkingSlot;
        activeBooking.floorId = floorId;
      }

      finalSlot = activeBooking.parkingSlot;
      finalFloorId = activeBooking.floorId;
      finalExpectedDuration = activeBooking.durationHours;

      activeBooking.status = 'ACTIVE';
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
        status: 'active'
      });
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

    if (activeBooking) {
      await activeBooking.save();
    }

    // Tạo phiên đỗ xe Session
    const newSession = await Session.create({
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
      paymentStatus: 'unpaid'
    });

    if (holdToConsume) {
      holdToConsume.status = 'consumed';
      await holdToConsume.save();
    }

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

    res.status(201).json({
      success: true,
      message: vipRedirected ? `Ô đỗ VIP bị chiếm, đã đổi tạm sang ô ${normalizedFinalSlot}` : 'Check-in thành công',
      data: newSession,
      vipRedirected,
      originalVipSlot,
      newSlot: normalizedFinalSlot,
    });
  } catch (error) {
    console.error('Error creating kiosk session:', error);
    next(error);
  }
};

/**
 * Kiosk quét quét biển số Check-out (Tính toán phí dự kiến trước khi trả tiền)
 * POST /api/sessions/kiosk-exit-scan
 */
exports.kioskExitScan = async (req, res, next) => {
  try {
    const { licensePlate } = req.body;

    if (!licensePlate) {
      return res.status(400).json({ success: false, message: 'License plate is required' });
    }

    const cleanPlate = normalizeLicensePlate(licensePlate);
    
    const session = await Session.findOne({ licensePlate: cleanPlate, status: 'active' });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiên đỗ xe hoạt động của biển số này' });
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

    res.status(200).json({
      success: true,
      data: {
        session,
        checkOutTime: now,
        durationHours: pricing.durationHours,
        totalPrice: pricing.finalTotal,
        amountToPay,
        refundAmount,
        pricingBreakdown: pricing,
        walletBalance,
        canAutoPay,
        isEarlyExit,
        remainingHours,
        bookingEnd,
        refundBreakdown,
        isSubscriptionExpired: session.type === 'SUBSCRIPTION' && amountToPay > 0
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

    const pastSession = await Session.findOne({ phone: phone }).sort({ checkInTime: -1 }).lean();

    if (pastSession) {
      return res.status(200).json({
        success: true,
        data: {
          licensePlate: pastSession.licensePlate
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
    const { sessionId, exitImageBase64, paymentMethod, keepPaused, exitCamera, exitGate } = req.body;

    const session = await Session.findById(sessionId);
    if (!session || session.status !== 'active') {
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

    // 1. Kiểm tra tài khoản & trừ tiền
    if (amountToPay > 0) {
      if (paymentMethod === 'wallet') {
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
              : undefined,
          }
          );
        }
        session.paymentStatus = 'paid';
      } else if (paymentMethod === 'vietqr') {
        // Thanh toán qua VietQR tại Kiosk
        // Tạo PayOS Payment Link cho Kiosk checkout
        const orderCode = Number(
          `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`
        );

        const paymentData = {
          orderCode,
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

        // Kiosk sẽ hiển thị QR này để khách quét và thanh toán ngay
        return res.status(200).json({
          success: true,
          message: 'Vui lòng thanh toán qua VietQR để mở cổng',
          requiresPayment: true,
          data: {
            orderCode,
            checkoutUrl: paymentLink.checkoutUrl,
            qrCode: paymentLink.qrCode,
          }
        });
      } else if (paymentMethod === 'qr' || paymentMethod === 'cash') {
        // Mock payment từ Frontend Kiosk hoặc thanh toán tiền mặt qua nhân viên
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
    session.status = 'completed';
    session.checkOutTime = now;
    session.totalPrice = refundBreakdown?.actualParkingCharge ?? pricing.finalTotal;
    session.pricingBreakdown = pricing;
    if (exitImage_url) session.exitImage_url = exitImage_url;
    if (exitCamera) session.exitCamera = exitCamera;
    if (exitGate) session.exitGate = exitGate;
    if (!sessionFinalizedAtomically) {
      await session.save();
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

    if (userDetail?.phone) {
      const phoneVariants = getPhoneVariants(userDetail.phone);
      // Auto-claim any orphan session for this user phone
      await claimUserSessionsByPhone(req.user._id, userDetail.phone);
      orConditions.push({ phone: { $in: phoneVariants } });
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
      .select('licensePlate parkingSlot floorId vehicleType checkInTime expectedDurationHours phone userId status')
      .populate('userId', 'email username');

    res.status(200).json({
      success: true,
      data: activeSessions,
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

    const payosInfo = await payos.paymentRequests.get(Number(orderCode));
    
    if (payosInfo && payosInfo.status === 'PAID') {
      return res.status(200).json({ success: true, isPaid: true });
    } else {
      return res.status(200).json({ success: true, isPaid: false });
    }
  } catch (error) {
    console.error('Error checking PayOS status:', error);
    // Return false on error to avoid breaking the polling loop
    return res.status(200).json({ success: false, isPaid: false });
  }
};

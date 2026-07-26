const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Booking = require('../models/Booking');
const BookingService = require('../models/BookingService');
const StaffBookingAction = require('../models/StaffBookingAction');
const TicketPackage = require('../models/TicketPackage');
const User = require('../models/User');
const UserDetail = require('../models/UserDetail');
const Vehicle = require('../models/Vehicle');
const ParkingFloor = require('../models/ParkingFloor');
const Session = require('../models/Session');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Slot = require('../models/Slot');
const payos = require('../config/payos');
const walletService = require('../services/walletService');
const pricingEngine = require('../services/pricingEngine');
const notifTriggers = require('../services/notificationTriggers');
const contractService = require('../services/contractService');
const bookingRefundService = require('../services/bookingRefundService');
const {
  getBookingFinancialSummaryMap,
} = require('../services/bookingFinancialService');
const {
  attachBookingUserDetails,
} = require('../services/bookingUserProjectionService');
const {
  attachPaidBookingSnapshots,
  getEffectiveRefundPolicySnapshot,
  transitionPendingBookingToPaid,
} = require('../services/paidBookingPolicyService');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');
const { emitToUser } = require('../sockets/notificationSocket');
const {
  buildBookingQrPayload,
  isBookingQrAvailable,
} = require('../services/bookingQrService');
const {
  findActiveSlotOwnership,
} = require('../services/membershipSlotOwnershipService');

const BOOKING_STATUSES_THAT_BLOCK_SLOT = ['PAID', 'ACTIVE', 'PAUSED'];

const normalizeSlotCode = (slotCode = '') => String(slotCode).trim().toUpperCase();

const buildSlotKey = (floorId, slotCode) => `${String(floorId)}:${normalizeSlotCode(slotCode)}`;

const sameObjectId = (a, b) => String(a || '') === String(b || '');

const uploadStaffEvidence = async (staffAction, bookingId, action) => {
  if (!staffAction) return null;

  const result = await cloudinary.uploader.upload(staffAction.evidenceImageBase64, {
    folder: `valo-parking/staff-booking-evidence/${bookingId}`,
    public_id: `${action.toLowerCase()}-${Date.now()}`,
    resource_type: 'image',
  });
  return result.secure_url;
};

const recordStaffBookingAction = async ({
  req,
  booking,
  session,
  previousStatus,
  newStatus,
  evidenceImageUrl,
}) => {
  if (!req.staffBookingAction) return;

  await StaffBookingAction.create({
    bookingId: booking._id,
    sessionId: session?._id || null,
    staffId: req.user._id,
    action: req.staffBookingAction.action,
    previousStatus,
    newStatus,
    reason: req.staffBookingAction.reason,
    evidenceImageUrl,
    idempotencyKey: req.staffBookingAction.idempotencyKey,
  });
};

exports.getPricingConfig = async (req, res, next) => {
  try {
    const config = await pricingEngine.getActivePricingConfig();
    res.status(200).json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
};

const parseBookingTimeRange = (startTime, endTime) => {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error('Invalid booking time'), { statusCode: 400 });
  }

  if (start >= end) {
    throw Object.assign(new Error('endTime must be after startTime'), { statusCode: 400 });
  }

  return { start, end };
};

const isCarSlotElement = (element) => {
  if (!element?.type || !String(element.type).startsWith('slot')) return false;

  // The current parking map builder still supports moto slots, but Valo Parking is car-only.
  return element.type !== 'slot-moto';
};

const isHourlySlot = (slotElement, zoneElement) => {
  const slotMode = String(slotElement.zoneMode || slotElement.zone || '').toLowerCase();
  const zoneMode = String(zoneElement?.zoneMode || zoneElement?.zone || '').toLowerCase();
  const zoneName = String(zoneElement?.name || '').toLowerCase();

  if ([slotMode, zoneMode].includes('yearly')) return false;
  if (zoneName.includes('yearly') || zoneName.includes('fixed')) return false;

  return true;
};

const getAllBookableSlots = async () => {
  const floors = await ParkingFloor.find().sort({ floorNumber: 1 }).lean();

  return floors.flatMap((floor) => {
    const elements = floor.layoutData?.elements || [];
    const elementById = new Map(elements.map((element) => [element.id, element]));

    return elements
      .filter(isCarSlotElement)
      .filter(slot => slot.name && slot.name.trim() !== '') // Skip empty parking slots (ghost slots)
      .map((slot) => {
        const zone = slot.parentId ? elementById.get(slot.parentId) : null;
        return {
          floorId: floor._id,
          floorName: floor.name,
          floorNumber: floor.floorNumber,
          slotCode: normalizeSlotCode(slot.name), // Name is guaranteed because it was filtered above
          slotType: slot.type,
          zoneName: zone?.name || null,
          elementId: slot.id,
          x: slot.x,
          y: slot.y,
          isHourly: isHourlySlot(slot, zone),
        };
      })
      .filter((slot) => slot.slotCode && slot.isHourly);
  });
};

const getUnavailableSlotKeys = async (start, end, userId = null) => {
  const now = new Date();
  const overlappingBookingsPromise = Booking.find({
    status: { $in: BOOKING_STATUSES_THAT_BLOCK_SLOT },
    scheduledStart: { $lt: end },
    scheduledEnd: { $gt: start },
    $or: [
      { status: { $in: ['ACTIVE', 'PAUSED'] } },
      {
        status: 'PAID',
        scheduledStart: { $gt: new Date(now.getTime() - 15 * 60 * 1000) }
      }
    ]
  })
    .select('floorId parkingSlot')
    .lean();

  const activeSessionsPromise = Session.find({
    status: 'active',
    floorId: { $ne: null },
    parkingSlot: { $ne: null },
  })
    .select('floorId parkingSlot')
    .lean();

  const maintenanceSlotsPromise = Slot.find({ status: 'maintenance' })
    .select('floorID slotNumber')
    .lean();

  const BookingHold = require('../models/BookingHold');
  const activeHoldsPromise = BookingHold.find({
    status: 'active',
    expiresAt: { $gt: new Date() },
    endTime: { $gt: start },
    startTime: { $lt: end },
  })
    .select('floorId slotCode')
    .lean();

  const activeMembershipSlotsPromise = MembershipSlotEntitlement.find({
    status: { $in: ['active', 'transfer_locked'] },
    expireAt: { $gt: new Date() },
  })
    .select('floorId slotCode sourceSubscriptionId')
    .lean()
    .then(async (entitlements) => {
      const Subscription = require('../models/Subscription');
      const coveredSubscriptionIds = entitlements.map(
        (item) => item.sourceSubscriptionId
      );
      const legacySubscriptions = await Subscription.find({
        _id: { $nin: coveredSubscriptionIds },
        status: 'active',
        paymentStatus: 'paid',
        expireAt: { $gt: new Date() },
      })
        .select('slots')
        .lean();
      return [
        ...entitlements.map((item) => ({
          floorId: item.floorId,
          slotCode: item.slotCode,
        })),
        ...legacySubscriptions.flatMap((subscription) => subscription.slots || []),
      ];
    });

  // Find slots reserved for other users
  const reservedSlotsQuery = { reservedFor: { $ne: null } };
  if (userId) {
    reservedSlotsQuery.reservedFor = { $nin: [null, userId] };
  }
  const reservedSlotsPromise = Slot.find(reservedSlotsQuery)
    .select('floorID slotNumber')
    .lean();

  const [
    overlappingBookings,
    activeSessions,
    maintenanceSlots,
    activeHolds,
    reservedSlots,
    activeMembershipSlots
  ] = await Promise.all([
    overlappingBookingsPromise,
    activeSessionsPromise,
    maintenanceSlotsPromise,
    activeHoldsPromise,
    reservedSlotsPromise,
    activeMembershipSlotsPromise
  ]);

  const unavailable = new Set();

  overlappingBookings.forEach((booking) => {
    unavailable.add(buildSlotKey(booking.floorId, booking.parkingSlot));
  });

  activeSessions.forEach((session) => {
    unavailable.add(buildSlotKey(session.floorId, session.parkingSlot));
  });

  maintenanceSlots.forEach((slot) => {
    unavailable.add(buildSlotKey(slot.floorID, slot.slotNumber));
  });

  activeHolds.forEach((hold) => {
    unavailable.add(buildSlotKey(hold.floorId, hold.slotCode));
  });

  reservedSlots.forEach((slot) => {
    unavailable.add(buildSlotKey(slot.floorID, slot.slotNumber));
  });

  activeMembershipSlots.forEach((slot) => {
    const key = buildSlotKey(slot.floorId, slot.slotCode);
    unavailable.add(key);
  });

  return unavailable;
};

const getAvailableSlotsForRange = async (start, end, userId = null) => {
  const [slots, unavailableSlotKeys] = await Promise.all([
    getAllBookableSlots(),
    getUnavailableSlotKeys(start, end, userId),
  ]);

  return slots.filter((slot) => !unavailableSlotKeys.has(buildSlotKey(slot.floorId, slot.slotCode)));
};

const resolveLicensePlate = async (userId, { vehicleId, licensePlate }) => {
  if (vehicleId) {
    const vehicle = await Vehicle.findOne({ _id: vehicleId, owner: userId }).lean();
    if (!vehicle) {
      throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
    }
    return normalizeLicensePlate(vehicle.licensePlate);
  }

  const plate = normalizeLicensePlate(licensePlate);
  if (!plate) {
    throw Object.assign(new Error('licensePlate or vehicleId is required'), { statusCode: 400 });
  }
  return plate;
};

const getActiveMembershipType = async (user) => {
  if (!user?.membership?.isVip || !user?.membership?.expireAt || !user?.membership?.packageId) {
    return null;
  }

  const expireAt = new Date(user.membership.expireAt);
  if (Number.isNaN(expireAt.getTime()) || expireAt <= new Date()) {
    return null;
  }

  if (user.membership.packageId?.type) {
    return user.membership.packageId.type;
  }

  const ticketPackage = await TicketPackage.findById(user.membership.packageId).select('type').lean();
  return ticketPackage?.type || null;
};

const findVipRegisteredVehicleBookingRestriction = async ({ userId, licensePlate, floorId, slotCode, start, end }) => {
  const [user, registeredVehicle] = await Promise.all([
    User.findById(userId).select('membership').lean(),
    Vehicle.findOne({ owner: userId, licensePlate, status: 'approved' }).select('_id licensePlate').lean(),
  ]);

  if (!registeredVehicle) return null;

  const membershipType = await getActiveMembershipType(user);
  if (!['monthly', 'yearly'].includes(membershipType)) return null;

  const reservedSlots = await Slot.find({ reservedFor: userId })
    .select('floorID slotNumber')
    .lean();

  const isSelectedReservedSlot = reservedSlots.some((slot) => (
    sameObjectId(slot.floorID, floorId) &&
    normalizeSlotCode(slot.slotNumber) === normalizeSlotCode(slotCode)
  ));

  if (isSelectedReservedSlot) return null;

  // Check if ALL their reserved slots are currently occupied/booked in the requested time frame.
  if (start && end) {
    let allOccupied = true;
    for (const slot of reservedSlots) {
      // 1. check active session
      const activeSession = await mongoose.model('Session').findOne({
        floorId: slot.floorID,
        parkingSlot: normalizeSlotCode(slot.slotNumber),
        status: 'active'
      });
      if (activeSession) continue;
      
      // 2. check overlapping booking
      const overlapping = await mongoose.model('Booking').findOne({
        floorId: slot.floorID,
        parkingSlot: normalizeSlotCode(slot.slotNumber),
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
        scheduledStart: { $lt: end },
        scheduledEnd: { $gt: start }
      });
      if (overlapping) continue;
      
      // 3. check maintenance
      const isMaintenance = await mongoose.model('Slot').findOne({
        floorID: slot.floorID,
        slotNumber: slot.slotNumber,
        status: 'maintenance'
      });
      if (isMaintenance) continue;
      
      allOccupied = false;
      break;
    }
    
    if (allOccupied) {
      return null;
    }
  }


  return {
    membershipType,
    registeredVehicle,
    reservedSlots: reservedSlots.map((slot) => ({
      floorId: slot.floorID,
      slotCode: normalizeSlotCode(slot.slotNumber),
    })),
  };
};

const getSessionExpectedEndTime = (session) => {
  const start = new Date(session.checkInTime);
  if (Number.isNaN(start.getTime())) return null;

  const expectedHours = Math.max(Number(session.expectedDurationHours || 1), 1);
  return new Date(start.getTime() + expectedHours * 60 * 60 * 1000);
};

const findVehicleUsageConflict = async ({ licensePlate, start, end }) => {
  const [overlappingBooking, activeSessions] = await Promise.all([
    Booking.findOne({
      licensePlate,
      status: { $in: BOOKING_STATUSES_THAT_BLOCK_SLOT },
      scheduledStart: { $lt: end },
      scheduledEnd: { $gt: start },
    })
      .select('parkingSlot scheduledStart scheduledEnd status')
      .lean(),
    Session.find({
      licensePlate,
      status: 'active',
    })
      .select('parkingSlot checkInTime expectedDurationHours')
      .lean(),
  ]);

  if (overlappingBooking) {
    return {
      type: 'booking',
      message: 'This vehicle already has another booking during the selected time range. One license plate can only park once at a time.',
      conflict: overlappingBooking,
    };
  }

  const overlappingSession = activeSessions.find((session) => {
    const sessionStart = new Date(session.checkInTime);
    const sessionEnd = getSessionExpectedEndTime(session);
    if (Number.isNaN(sessionStart.getTime()) || !sessionEnd) return false;
    return sessionStart < end && sessionEnd > start;
  });

  if (overlappingSession) {
    return {
      type: 'session',
      message: 'This vehicle is already scheduled to be parked during the selected time range. Please choose a later time.',
      conflict: overlappingSession,
    };
  }

  return null;
};

const getBookingServices = async (bookingIds) => {
  const services = await BookingService.find({ bookingId: { $in: bookingIds } })
    .sort({ createdAt: 1 })
    .lean();

  return services.reduce((acc, service) => {
    const key = String(service.bookingId);
    acc[key] = acc[key] || [];
    acc[key].push(service);
    return acc;
  }, {});
};

const emitBookingChanged = (app, booking, extra = {}) => {
  if (!app || !booking?.userId) return;

  const io = app.get('io');
  if (!io) return;

  emitToUser(io, booking.userId, 'booking:changed', {
    bookingId: String(booking._id),
    status: booking.status,
    slotCode: booking.parkingSlot,
    floorId: booking.floorId ? String(booking.floorId) : null,
    ...extra,
  });
};

const findOwnedBooking = (bookingId, user) => {
  const query = { _id: bookingId };
  if (!['admin', 'staff'].includes(user?.role)) {
    query.userId = user?._id;
  }
  return Booking.findOne(query);
};

exports.getAvailableSlots = async (req, res, next) => {
  try {
    const { startTime, endTime } = req.query;
    const { start, end } = parseBookingTimeRange(startTime, endTime);
    const slots = await getAvailableSlotsForRange(start, end, req.user?._id);

    res.status(200).json({
      success: true,
      data: {
        startTime: start,
        endTime: end,
        count: slots.length,
        slots,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Tạo mới đặt chỗ (Booking)
 * @route   POST /api/bookings
 * @access  Private (Customer)
 */
exports.createBooking = async (req, res, next) => {
  try {
    const { vehicleId, floorId, parkingSlot, scheduledStart, scheduledEnd, paymentMethod } = req.body;
    const userId = req.user._id;

    if (!vehicleId || !floorId || !parkingSlot || !scheduledStart || !scheduledEnd || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
    }

    // 1. Kiểm tra xe đăng ký
    const vehicle = await Vehicle.findOne({ _id: vehicleId, owner: userId });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Your valid vehicle not found' });
    }

    // 2. Validate thời gian
    const start = new Date(scheduledStart);
    const end = new Date(scheduledEnd);
    const now = new Date();

    if (start <= now) {
      return res.status(400).json({ success: false, message: 'Start time must be in the future' });
    }

    const durationMs = end - start;
    if (durationMs <= 0) {
      return res.status(400).json({ success: false, message: 'End time must be after start time' });
    }

    const durationHours = durationMs / (1000 * 60 * 60);
    if (durationHours <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid duration' });
    }
    if (durationHours > 24) {
      return res.status(400).json({ success: false, message: 'Thời lượng tối đa cho mỗi đặt chỗ là 24 giờ' });
    }

    // 3. Kiểm tra chồng lấn Booking của chính chiếc xe này
    const overlappingBooking = await Booking.findOne({
      vehicleId,
      status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
      scheduledStart: { $lt: end },
      scheduledEnd: { $gt: start },
    });

    if (overlappingBooking) {
      return res.status(400).json({ success: false, message: 'This vehicle already has an overlapping booking' });
    }

    // 3.1. Kiểm tra VIP
    const restriction = await findVipRegisteredVehicleBookingRestriction({
      userId,
      licensePlate: vehicle.licensePlate,
      floorId,
      slotCode: parkingSlot,
      start,
      end
    });
    if (restriction) {
      return res.status(400).json({ success: false, message: `Vehicle ${vehicle.licensePlate} is already in a VIP subscription. Please use your VIP parking slot instead of making a new booking.` });
    }

    // 3.5. Kiểm tra ô đỗ có thuộc Subscription (Gói tháng/năm) không
    const subscriptionInfo = await findActiveSlotOwnership({
      floorId,
      slotCode: parkingSlot,
      at: start,
    });
    
    if (subscriptionInfo) {
      if (subscriptionInfo.ownerId.toString() !== userId.toString()) {
        return res.status(400).json({ success: false, message: 'This parking slot is registered under a fixed subscription and cannot be booked.' });
      } else if (vehicle.status !== 'approved') {
        return res.status(400).json({ success: false, message: 'Only approved vehicles can book your VIP slot.' });
      }
    }

    // 3.6. Kiểm tra ô đỗ có bị người khác Booking trùng giờ không
    const slotOverlapBooking = await Booking.findOne({
      floorId,
      parkingSlot,
      status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
      scheduledStart: { $lt: end },
      scheduledEnd: { $gt: start }
    });
    if (slotOverlapBooking) {
      return res.status(400).json({ success: false, message: 'This slot is already booked for your selected time.' });
    }

    // 4. Tính toán phí trước dựa trên pricingEngine
    const pricing = await pricingEngine.calculatePrice(start, end);
    let prepaidAmount = pricing.finalTotal;

    if (subscriptionInfo && subscriptionInfo.user.toString() === userId.toString()) {
      prepaidAmount = 0;
    }


    const { services = [] } = req.body;

    // 5. Khởi tạo đặt chỗ
    const newBooking = new Booking({
      userId,
      vehicleId,
      licensePlate: vehicle.licensePlate,
      floorId,
      parkingSlot,
      scheduledStart: start,
      scheduledEnd: end,
      durationHours: pricing.durationHours,
      prepaidAmount,
      paymentMethod,
      status: 'PENDING',
    });

    if (paymentMethod === 'wallet') {
      // Thanh toán qua Ví
      const wallet = await walletService.getOrCreateWallet(userId);
      if (wallet.balance < prepaidAmount) {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance, please top up or select VietQR payment' });
      }

      // Trừ tiền
      const paymentSession = await mongoose.startSession();
      try {
        paymentSession.startTransaction();
        await walletService.debitWallet(
            userId,
            prepaidAmount,
        `Payment for Parking Slot ${parkingSlot} - Vehicle ${vehicle.licensePlate}`,
            {
              refSource: 'booking',
              refSourceId: newBooking._id,
              idempotencyKey: `booking:${newBooking._id}:initial-payment`,
              session: paymentSession,
            }
        );

        newBooking.status = 'PAID';
        await attachPaidBookingSnapshots(newBooking, {
          parkingAmount: prepaidAmount,
          serviceAmount: 0,
          source: 'calculated',
          session: paymentSession,
        });
        await paymentSession.commitTransaction();
      } catch (error) {
        await paymentSession.abortTransaction();
        throw error;
      } finally {
        await paymentSession.endSession();
      }

      // Gửi thông báo
      notifTriggers.notifyBookingSuccess(req.app, userId, {
        bookingId: newBooking._id.toString(),
        slotInfo: `${parkingSlot}`
      }).catch(err => console.error('Error sending notifyBookingSuccess:', err));

    } else if (paymentMethod === 'vietqr') {
      // Thanh toán qua VietQR (payOS)
      const orderCode = Number(
        `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`
      );

      const paymentData = {
        orderCode,
        amount: prepaidAmount,
        description: `VALO Booking`,
        returnUrl: process.env.CLIENT_URL || 'http://localhost:5173/customer/bookings',
        cancelUrl: process.env.CLIENT_URL || 'http://localhost:5173/customer/bookings?cancel=true',
        items: [
          {
            name: `Booking Slot ${parkingSlot} Vehicle ${vehicle.licensePlate}`,
            quantity: 1,
            price: prepaidAmount,
          },
        ],
      };

      const paymentLink = await payos.paymentRequests.create(paymentData);

      newBooking.vietqrOrderCode = orderCode;
      newBooking.vietqrPaymentLinkId = paymentLink.paymentLinkId;
      newBooking.vietqrCheckoutUrl = paymentLink.checkoutUrl; // Store temporary for response
      newBooking.vietqrQrCode = paymentLink.qrCode; // Store temporary for response
      await newBooking.save();
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }

    try {
      const contract = await contractService.generateContract(newBooking._id);
      if (contract) {
        newBooking.contractId = contract._id;
        await newBooking.save(); // Save again with contractId
        if (contract.status === 'DRAFT') {
          await contractService.activateContract(contract._id, req.app);
        }
      }
    } catch (contractError) {
      console.error(`[Contract] Auto-generation failed for booking ${newBooking._id}:`, contractError.message);
    }

    let bookingServices = [];
    if (services.length > 0) {
      await BookingService.insertMany(
        services.map((service) => ({
          bookingId: newBooking._id,
          serviceId: service._id,
          serviceName: service.name,
          price: service.price,
          timeCost: service.timeCost || 30,
        }))
      );
      bookingServices = await BookingService.find({ bookingId: newBooking._id }).lean();
    }

    if (newBooking.status === 'PAID') {
      await attachPaidBookingSnapshots(newBooking, {
        parkingAmount: prepaidAmount,
        serviceAmount: 0,
        source: 'calculated',
      });
    }
    
    emitBookingChanged(req.app, newBooking, { action: 'created' });

    if (paymentMethod === 'wallet') {
      return res.status(201).json({
        success: true,
        message: 'Đặt chỗ thành công',
        data: {
           booking: newBooking,
           services: bookingServices
        },
      });
    } else {
      return res.status(201).json({
        success: true,
        message: 'VietQR payment request created',
        data: {
          bookingId: newBooking._id,
          orderCode: newBooking.vietqrOrderCode,
          amount: prepaidAmount,
          checkoutUrl: newBooking.vietqrCheckoutUrl,
          qrCode: newBooking.vietqrQrCode,
          services: bookingServices
        },
      });
    }
  } catch (error) {
    console.error('Error in createBooking:', error);
    next(error);
  }
};

/**
 * @desc    Xác thực trạng thái thanh toán VietQR
 * @route   GET /api/bookings/status/:orderCode
 * @access  Private
 */
exports.checkVietQRStatus = async (req, res, next) => {
  try {
    const { orderCode } = req.params;
    const booking = await Booking.findOne({ vietqrOrderCode: Number(orderCode), userId: req.user._id });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Corresponding booking not found' });
    }

    if (booking.status === 'PAID') {
      return res.status(200).json({ success: true, status: 'PAID', data: booking });
    }

    if (booking.status === 'PENDING') {
      try {
        const payosInfo = await payos.paymentRequests.get(Number(orderCode));
        if (payosInfo.status === 'PAID') {
          const paidTransition = await transitionPendingBookingToPaid(booking, {
            parkingAmount: booking.prepaidAmount,
            serviceAmount: 0,
            source: 'calculated',
          });
          const paidBooking = paidTransition.booking;

          if (paidTransition.transitioned) {
            // Gửi thông báo
            notifTriggers.notifyBookingSuccess(req.app, paidBooking.userId, {
              bookingId: paidBooking._id.toString(),
              slotInfo: `${paidBooking.parkingSlot}`
            }).catch(err => console.error('Error sending notifyBookingSuccess:', err));
          }

          return res.status(200).json({
            success: true,
            status: paidBooking.status,
            data: paidBooking,
          });
        } else if (['CANCELLED', 'EXPIRED'].includes(payosInfo.status)) {
          booking.status = 'CANCELLED';
          await booking.save();
          return res.status(200).json({ success: true, status: 'CANCELLED', data: booking });
        }
      } catch (payosError) {
        console.error('Error checking PayOS status:', payosError.message);
      }
    }

    res.status(200).json({ success: true, status: booking.status, data: booking });
  } catch (error) {
    console.error('Error checkVietQRStatus:', error);
    next(error);
  }
};

/**
 * @desc    Webhook nhận callback từ payOS
 * @route   POST /api/bookings/webhook
 * @access  Public
 */
exports.handleBookingWebhook = async (req, res, next) => {
  try {
    let webhookData;
    try {
      webhookData = await payos.webhooks.verify(req.body);
    } catch (verifyError) {
      console.error('❌ Webhook signature verification failed:', verifyError.message);
      return res.status(400).json({ message: 'Invalid signature' });
    }

    if (['Ma giao dich thu nghiem', 'VQRIO123'].includes(webhookData.description)) {
      return res.status(200).json({ message: 'OK - Test webhook' });
    }

    const { orderCode, code } = webhookData;

    if (code === '00') {
      const booking = await Booking.findOne({ vietqrOrderCode: orderCode, status: 'PENDING' });
      if (booking) {
        const paidTransition = await transitionPendingBookingToPaid(booking, {
          parkingAmount: booking.prepaidAmount,
          serviceAmount: 0,
          source: 'calculated',
        });
        const paidBooking = paidTransition.booking;

        if (paidTransition.transitioned) {
          // Gửi thông báo đặt chỗ thành công
          notifTriggers.notifyBookingSuccess(req.app, paidBooking.userId, {
            bookingId: paidBooking._id.toString(),
            slotInfo: `${paidBooking.parkingSlot}`
          }).catch(err => console.error('Failed to notify success:', err));
        }

        console.log(`✅ Webhook: Booking ${paidBooking._id} paid successfully.`);
      }
    }

    res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(200).json({ message: 'OK' }); // Always acknowledge to prevent retries
  }
};

/**
 * @desc    Hủy Đặt chỗ trước giờ Check-in
 * @route   POST /api/bookings/:id/cancel
 * @access  Private (Customer)
 */
exports.cancelBooking = async (req, res, next) => {
  try {
    let booking = await Booking.findOne({ _id: req.params.id, userId: req.user._id });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking information not found' });
    }

    if (booking.status !== 'PAID') {
      return res.status(400).json({ success: false, message: 'Bookings can only be canceled when status is PAID' });
    }

    const now = new Date();
    if (booking.scheduledStart <= now) {
      return res.status(400).json({ success: false, message: 'Cannot cancel after the booking start time' });
    }

    // Hoàn tiền đặt chỗ vào Wallet (kể cả thanh toán trước đó bằng VietQR)
    const refundBreakdown = await bookingRefundService.quoteCancellation(booking, now);
    const settled = await bookingRefundService.settleBookingEvent({
      bookingId: booking._id,
      eventKey: `booking:${booking._id}:cancellation`,
      eventType: 'cancellation',
      calculation: refundBreakdown,
      description: `Refund cancelled booking ${booking._id}`,
      applyState: async ({ booking: currentBooking }) => {
        if (currentBooking.status !== 'PAID') {
          throw Object.assign(new Error('Booking is no longer cancellable'), {
            statusCode: 400,
          });
        }
        currentBooking.status = 'CANCELLED';
      },
    });

    booking.status = 'CANCELLED';

    // Gửi thông báo hủy thành công
    notifTriggers.notifyBookingCancelled(req.app, req.user._id, {
      bookingId: booking._id.toString(),
      slotInfo: booking.parkingSlot,
      reason: 'Khách yêu cầu hủy đặt chỗ'
    }).catch(err => console.error('Failed to notify cancel:', err));

    const payoutSuppressed = settled.settlement.payoutStatus === 'suppressed';
    res.status(200).json({
      success: true,
      message: payoutSuppressed
        ? 'Hủy đặt chỗ thành công; khoản hoàn dưới mức giao dịch tối thiểu nên chưa được cộng vào ví'
        : 'Booking canceled successfully, the prepaid amount has been refunded to your wallet',
      data: {
        ...settled.booking.toObject(),
        refundAmount: refundBreakdown.refundAmount,
        refundBreakdown: {
          ...refundBreakdown,
          payoutStatus: settled.settlement.payoutStatus,
          suppressionReason: settled.settlement.suppressionReason,
        },
      },
    });
  } catch (error) {
    console.error('Error cancelBooking:', error);
    next(error);
  }
};

/**
 * @desc    Chỉnh sửa thời gian đặt chỗ trước khi Check-in
 * @route   PUT /api/bookings/:id/time
 * @access  Private (Customer)
 */
exports.modifyBookingTime = async (req, res, next) => {
  try {
    const { newStart, newEnd } = req.body;
    let booking = await Booking.findOne({ _id: req.params.id, userId: req.user._id });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (!['PAID', 'ACTIVE', 'PAUSED'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Booking can only be modified in PAID, ACTIVE, or PAUSED status' });
    }

    if (booking.modificationCount >= 3) {
      return res.status(400).json({ success: false, message: 'You have reached the limit of 3 modifications for this booking' });
    }

    const now = new Date();
    
    // Nếu chưa Check-in (PAID), cho phép sửa cả Start (nhưng phải sửa trước giờ bắt đầu 30 phút)
    if (booking.status === 'PAID') {
      const timeBeforeStartOld = booking.scheduledStart.getTime() - now.getTime();
      if (timeBeforeStartOld < 30 * 60 * 1000) {
        return res.status(400).json({ success: false, message: 'Booking can only be modified at least 30 minutes before the original start time' });
      }
    }

    // Nếu đang trong bãi (ACTIVE / PAUSED), không được đổi Start
    const start = booking.status === 'PAID' ? new Date(newStart) : booking.scheduledStart;
    const end = new Date(newEnd);

    if (booking.status === 'PAID' && start <= now) {
      return res.status(400).json({ success: false, message: 'New time must be in the future' });
    }

    const durationMs = end.getTime() - start.getTime();
    if (durationMs <= 0 || end <= now) {
      return res.status(400).json({ success: false, message: 'Invalid new end time' });
    }

    const durationHours = durationMs / (1000 * 60 * 60);
    if (durationHours < 1 || durationHours > 24) {
      return res.status(400).json({ success: false, message: 'Thời lượng tổng cộng phải từ 1 đến 24 giờ' });
    }

    // Kiểm tra ô đỗ có thuộc Subscription (Gói tháng/năm) không
    const subscriptionInfo = await findActiveSlotOwnership({
      floorId: booking.floorId,
      slotCode: booking.parkingSlot,
      at: start,
    });
    if (subscriptionInfo && subscriptionInfo.ownerId.toString() !== booking.userId.toString()) {
      return res.status(400).json({ success: false, message: 'This slot is registered under a fixed subscription, cannot change to this time.' });
    }

    // Kiểm tra chồng lấn Slot ô đỗ mới/cũ trong khoảng thời gian mới (trừ chính booking hiện tại)
    const slotOverlap = await Booking.findOne({
      _id: { $ne: booking._id },
      floorId: booking.floorId,
      parkingSlot: booking.parkingSlot,
      status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
      scheduledStart: { $lt: end },
      scheduledEnd: { $gt: start }
    });

    if (slotOverlap) {
      return res.status(400).json({ success: false, message: 'This slot already has another booking during the new time frame' });
    }

    // Tính phí lại
    const pricing = await pricingEngine.calculatePrice(start, end);
    const newPrice = pricing.finalTotal;
    const diff = newPrice - booking.prepaidAmount;
    const expectedModificationCount = booking.modificationCount;

    let modificationSession = null;
    try {
    if (diff > 0) {
      // Cần đóng thêm tiền -> chỉ hỗ trợ trừ tiền Wallet (phải nạp trước)
      const wallet = await walletService.getOrCreateWallet(req.user._id);
      if (wallet.balance < diff) {
        return res.status(400).json({ success: false, message: `The new time incurs an additional fee of ${diff.toLocaleString()} VND, insufficient wallet balance. Please top up your wallet first.` });
      }

      modificationSession = await mongoose.startSession();
      modificationSession.startTransaction();
      await walletService.debitWallet(
        req.user._id,
        diff,
        `Additional fee for modifying booking slot ${booking.parkingSlot} - Vehicle ${booking.licensePlate}`,
        {
          refSource: 'booking',
          refSourceId: booking._id,
          idempotencyKey: `booking:${booking._id}:modification:${booking.modificationCount + 1}`,
          session: modificationSession,
        }
      );
    } else if (diff < 0) {
      // Hoàn lại tiền thừa
      const refundAmount = Math.abs(diff);
      modificationSession = await mongoose.startSession();
      modificationSession.startTransaction();
      await walletService.creditWallet(
        req.user._id,
        refundAmount,
        'REFUND',
        `Refund for modifying booking slot ${booking.parkingSlot} - Vehicle ${booking.licensePlate}`,
        {
          refSource: 'booking',
          refSourceId: booking._id,
          idempotencyKey: `booking:${booking._id}:modification:${booking.modificationCount + 1}`,
          session: modificationSession,
        }
      );
    }

    booking.scheduledStart = start;
    booking.scheduledEnd = end;
    booking.durationHours = pricing.durationHours;
    booking.prepaidAmount = newPrice;
    if (booking.paymentBreakdownSnapshot?.source) {
      const serviceAmount = Math.min(
        Math.max(0, Number(booking.paymentBreakdownSnapshot.serviceAmount) || 0),
        newPrice
      );
      booking.paymentBreakdownSnapshot = {
        parkingAmount: Math.max(0, newPrice - serviceAmount),
        serviceAmount,
        totalAmount: newPrice,
        source: booking.paymentBreakdownSnapshot.source,
      };
    }
    const updatedBooking = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        userId: req.user._id,
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
        modificationCount: expectedModificationCount,
      },
      {
        $set: {
          scheduledStart: booking.scheduledStart,
          scheduledEnd: booking.scheduledEnd,
          durationHours: booking.durationHours,
          prepaidAmount: booking.prepaidAmount,
          ...(booking.paymentBreakdownSnapshot?.source
            ? { paymentBreakdownSnapshot: booking.paymentBreakdownSnapshot }
            : {}),
        },
        $inc: { modificationCount: 1 },
      },
      {
        new: true,
        runValidators: true,
        ...(modificationSession ? { session: modificationSession } : {}),
      }
    );
    if (!updatedBooking) {
      throw Object.assign(new Error('Booking was modified concurrently; please retry'), {
        statusCode: 409,
      });
    }
    booking = updatedBooking;
    if (modificationSession) {
      await modificationSession.commitTransaction();
    }
    } catch (error) {
      if (modificationSession) {
        await modificationSession.abortTransaction();
      }
      throw error;
    } finally {
      if (modificationSession) {
        await modificationSession.endSession();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Booking time updated successfully',
      data: booking,
    });
  } catch (error) {
    console.error('Error modifyBookingTime:', error);
    next(error);
  }
};

/**
 * @desc    Lấy danh sách đặt chỗ của User
 * @route   GET /api/bookings/my-history
 * @access  Private (Customer)
 */
exports.getMyBookings = async (req, res, next) => {
  try {
    const myVehicles = await Vehicle.find({ owner: req.user._id, status: 'approved' }).distinct('licensePlate');
    const bookings = await Booking.find({
      $or: [
        { userId: req.user._id },
        { licensePlate: { $in: myVehicles } }
      ]
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    console.error('Error getMyBookings:', error);
    next(error);
  }
};

/**
 * @desc    Get the signed, lifecycle-bound QR payload for one owned booking
 * @route   GET /api/bookings/:id/qr
 * @access  Private (Customer/Admin)
 */
exports.getBookingQr = async (req, res, next) => {
  try {
    const booking = await findOwnedBooking(req.params.id, req.user);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const available = isBookingQrAvailable(booking);
    return res.status(200).json({
      success: true,
      data: {
        available,
        bookingStatus: booking.status,
        payload: available ? buildBookingQrPayload(booking) : null,
        reason: available ? null : 'BOOKING_QR_INACTIVE',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.quoteBookingCancellation = async (req, res, next) => {
  try {
    const booking = await findOwnedBooking(req.params.id, req.user);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Only paid bookings can be cancelled before check-in',
      });
    }

    const now = new Date();
    if (booking.scheduledStart <= now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel after the booking start time',
      });
    }

    const refundBreakdown = await bookingRefundService.quoteCancellation(booking, now);
    return res.status(200).json({
      success: true,
      data: {
        bookingId: booking._id,
        paidAmount: booking.prepaidAmount,
        refundAmount: refundBreakdown.refundAmount || 0,
        refundBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Thay đổi phương tiện (Biển số xe) cho Đặt chỗ trước giờ Check-in
 * @route   PUT /api/bookings/:id/vehicle
 * @access  Private (Customer)
 */
exports.updateBookingVehicle = async (req, res, next) => {
  try {
    const { vehicleId, licensePlate } = req.body;
    const booking = await Booking.findOne({ _id: req.params.id, userId: req.user._id });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== 'PAID') {
      return res.status(400).json({ success: false, message: 'Vehicle can only be changed in PAID status (before check-in)' });
    }

    const now = new Date();
    if (booking.scheduledStart <= now) {
      return res.status(400).json({ success: false, message: 'Cannot change vehicle after the booking has started' });
    }

    if (booking.modificationCount >= 3) {
      return res.status(400).json({ success: false, message: 'You have reached the limit of 3 modifications for this booking' });
    }

    let resolvedVehicleId = null;
    let resolvedLicensePlate = '';

    if (vehicleId) {
      const vehicle = await Vehicle.findOne({ _id: vehicleId, owner: req.user._id, status: 'approved' });
      if (!vehicle) {
        return res.status(404).json({ success: false, message: 'Your valid vehicle not found' });
      }
      resolvedVehicleId = vehicle._id;
      resolvedLicensePlate = vehicle.licensePlate;
    } else if (licensePlate) {
      const { normalizeLicensePlate } = require('../utils/licensePlateUtils');
      resolvedLicensePlate = normalizeLicensePlate(licensePlate);
      if (!resolvedLicensePlate) {
        return res.status(400).json({ success: false, message: 'Invalid license plate' });
      }
      // Check if this plate actually matches one of their approved vehicles
      const vehicle = await Vehicle.findOne({ licensePlate: resolvedLicensePlate, owner: req.user._id, status: 'approved' });
      if (vehicle) {
        resolvedVehicleId = vehicle._id;
      }
    } else {
      return res.status(400).json({ success: false, message: 'Please select a vehicle or enter a license plate' });
    }

    // Kiểm tra xe mới đã có booking trùng lặp không (chỉ check theo licensePlate)
    const overlappingBooking = await Booking.findOne({
      _id: { $ne: booking._id },
      licensePlate: resolvedLicensePlate,
      status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
      scheduledStart: { $lt: booking.scheduledEnd },
      scheduledEnd: { $gt: booking.scheduledStart },
    });

    if (overlappingBooking) {
      return res.status(400).json({ success: false, message: 'The new vehicle already has an overlapping booking' });
    }

    booking.vehicleId = resolvedVehicleId;
    booking.licensePlate = resolvedLicensePlate;
    booking.modificationCount += 1;
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Đổi phương tiện cho đặt chỗ thành công',
      data: booking,
    });
  } catch (error) {
    console.error('Error updateBookingVehicle:', error);
    next(error);
  }
};

/**
 * @desc    Check-in đặt chỗ từ ứng dụng khách hàng
 * @route   POST /api/bookings/:id/check-in
 * @access  Private (Customer/Admin)
 */
exports.checkInBooking = async (req, res, next) => {
  try {
    const booking = await findOwnedBooking(req.params.id, req.user);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== 'PAID') {
      return res.status(400).json({ success: false, message: 'Can only check-in for paid bookings' });
    }

    const now = new Date();
    const earliestCheckIn = new Date(booking.scheduledStart.getTime() - 30 * 60 * 1000);
    const latestCheckIn = new Date(booking.scheduledStart.getTime() + 15 * 60 * 1000);

    if (now < earliestCheckIn) {
      return res.status(400).json({ success: false, message: 'You can only check-in up to 30 minutes early' });
    }

    if (now > latestCheckIn || now > booking.scheduledEnd) {
      return res.status(400).json({ success: false, message: 'Đặt chỗ đã quá thời gian check-in hợp lệ' });
    }

    const cleanPlate = normalizeLicensePlate(booking.licensePlate);
    const activeSession = await Session.findOne({ licensePlate: cleanPlate, status: 'active' });
    if (activeSession) {
      return res.status(400).json({ success: false, message: 'This vehicle currently has an active parking session' });
    }

    const occupiedSlot = await Session.findOne({
      floorId: booking.floorId,
      parkingSlot: normalizeSlotCode(booking.parkingSlot),
      status: 'active',
    });

    if (occupiedSlot) {
      return res.status(400).json({ success: false, message: 'This slot is currently occupied by another vehicle. Vui lòng liên hệ nhân viên để đổi ô.' });
    }

    const vehicle = booking.vehicleId
      ? await Vehicle.findById(booking.vehicleId).select('vehicleType').lean()
      : null;

    const previousStatus = booking.status;
    const evidenceImageUrl = await uploadStaffEvidence(
      req.staffBookingAction,
      booking._id,
      'CHECK_IN'
    );

    booking.status = 'ACTIVE';
    await booking.save();

    const session = await Session.create({
      licensePlate: cleanPlate,
      userId: booking.userId,
      bookingId: booking._id,
      type: 'BOOKING',
      source: req.staffBookingAction ? 'staff_manual' : 'app_booking',
      vehicleType: vehicle?.vehicleType || 'car',
      parkingSlot: normalizeSlotCode(booking.parkingSlot),
      floorId: booking.floorId,
      checkInTime: now,
      expectedDurationHours: booking.durationHours || 1,
      paymentStatus: 'unpaid',
      status: 'active',
      ...(evidenceImageUrl
        ? {
            entryImage_url: evidenceImageUrl,
            entryCamera: 'staff_mobile',
            entryGate: 'manual_override',
          }
        : {}),
    });

    await recordStaffBookingAction({
      req,
      booking,
      session,
      previousStatus,
      newStatus: booking.status,
      evidenceImageUrl,
    });

    emitBookingChanged(req.app, booking, { action: 'checked-in' });
    notifTriggers.notifyVehicleEntry(
      req.app,
      booking.userId,
      cleanPlate,
      session.parkingSlot || 'N/A'
    ).catch(err => console.error('Failed to send entry notification:', err));

    res.status(200).json({
      success: true,
      message: 'Check-in đặt chỗ thành công',
      data: {
        booking,
        session,
      },
    });
  } catch (error) {
    console.error('Error checkInBooking:', error);
    next(error);
  }
};

/**
 * @desc    Check-out đặt chỗ từ ứng dụng khách hàng
 * @route   POST /api/bookings/:id/check-out
 * @access  Private (Customer/Admin)
 */
exports.checkOutBooking = async (req, res, next) => {
  try {
    const booking = await findOwnedBooking(req.params.id, req.user);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'Can only complete ACTIVE bookings' });
    }

    const session = await Session.findOne({
      bookingId: booking._id,
      status: 'active',
    }).sort({ checkInTime: -1 });

    if (!session) {
      return res.status(404).json({ success: false, message: 'No active parking session found for this booking' });
    }

    const now = new Date();
    const previousStatus = booking.status;
    const evidenceImageUrl = await uploadStaffEvidence(
      req.staffBookingAction,
      booking._id,
      'CHECK_OUT'
    );
    const refundBreakdown = await bookingRefundService.quoteEarlyCheckout(
      booking,
      session,
      now
    );
    const settled = await bookingRefundService.settleBookingEvent({
      bookingId: booking._id,
      eventKey: `booking:${booking._id}:early-checkout`,
      eventType: 'early_checkout',
      calculation: refundBreakdown,
      description: `Settle checkout for booking ${booking._id}`,
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
            pricingBreakdown: refundBreakdown.pricingBreakdown,
            paymentStatus: 'paid',
            ...(evidenceImageUrl
              ? {
                  exitImage_url: evidenceImageUrl,
                  exitCamera: 'staff_mobile',
                  exitGate: 'manual_override',
                }
              : {}),
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
    const refundAmount = refundBreakdown.refundAmount;
    const extraAmount = refundBreakdown.extraAmount;
    const pricing = refundBreakdown.pricingBreakdown;
    booking.status = 'COMPLETED';
    session.status = 'completed';
    session.checkOutTime = now;
    session.totalPrice = refundBreakdown.actualParkingCharge;
    session.pricingBreakdown = pricing;
    session.paymentStatus = 'paid';
    if (evidenceImageUrl) {
      session.exitImage_url = evidenceImageUrl;
      session.exitCamera = 'staff_mobile';
      session.exitGate = 'manual_override';
    }

    await recordStaffBookingAction({
      req,
      booking: settled.booking,
      session,
      previousStatus,
      newStatus: 'COMPLETED',
      evidenceImageUrl,
    });

    emitBookingChanged(req.app, booking, { action: 'checked-out' });
    notifTriggers.notifyVehicleExit(
      req.app,
      booking.userId,
      booking.licensePlate,
      pricing.finalTotal
    ).catch(err => console.error('Failed to send exit notification:', err));

    if (extraAmount > 0) {
      notifTriggers.notifyPaymentSuccess(
        req.app,
        booking.userId,
        extraAmount,
        session._id.toString()
      ).catch(err => console.error('Failed to send payment notification:', err));
    }

    res.status(200).json({
      success: true,
      message: 'Hoàn tất đặt chỗ thành công',
      data: {
        booking: settled.booking,
        session,
        refundAmount,
        extraAmount,
        pricingBreakdown: pricing,
        refundBreakdown: {
          ...refundBreakdown,
          payoutStatus: settled.settlement.payoutStatus,
          suppressionReason: settled.settlement.suppressionReason,
        },
      },
    });
  } catch (error) {
    console.error('Error checkOutBooking:', error);
    next(error);
  }
};

/**
 * @desc    Gợi ý ô đỗ thông minh cho Kiosk / App
 * @route   GET /api/bookings/suggest-slot
 * @access  Public
 */
exports.suggestSmartSlot = async (req, res, next) => {
  try {
    const { vehicleType } = req.query; // 'car', 'electric_car', 'motorcycle'
    
    // Thuật toán: Lấy tất cả Slot, loại bỏ những slot đang Occupied, Reserved, Maintenance hoặc có Booking trong 2h tới.
    const Session = require('../models/Session');
    const ParkingFloor = require('../models/ParkingFloor');
    
    const activeSessions = await Session.find({ status: 'active', parkingSlot: { $ne: null } });
    const activeSlots = activeSessions.map(s => s.parkingSlot);
    
    const now = new Date();
    const next2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const bookings = await Booking.find({
      status: { $in: ['PAID', 'PAUSED'] },
      scheduledStart: { $lt: next2Hours },
      scheduledEnd: { $gt: now }
    });
    const bookedSlots = bookings.map(b => b.parkingSlot);
    
    const unavailableSlots = new Set([...activeSlots, ...bookedSlots]);
    
    const floors = await ParkingFloor.find();
    let suggestedSlot = null;
    let fallbackSlot = null;
    
    for (const f of floors) {
      if (f.layoutData && f.layoutData.elements) {
        const slots = f.layoutData.elements.filter(el => {
           if (unavailableSlots.has(el.id)) return false;
           if (vehicleType === 'electric_car' && el.type !== 'slot-ev' && el.type !== 'slot') return false;
           if (vehicleType === 'motorcycle' && el.type !== 'slot-moto') return false;
           if (vehicleType === 'car' && el.type !== 'slot' && el.type !== 'slot-vip') return false;
           return ['slot', 'slot-ev', 'slot-vip', 'slot-moto'].includes(el.type);
        });
        
        if (slots.length > 0) {
          // Ưu tiên slot-vip nếu là VIP, hoặc ưu tiên gần cổng (có thể mô phỏng bằng cách lấy slot đầu tiên)
          const evSlot = slots.find(s => s.type === 'slot-ev');
          if (vehicleType === 'electric_car' && evSlot) {
            suggestedSlot = evSlot;
          } else {
            suggestedSlot = slots[0];
          }
          
          if (suggestedSlot) {
            suggestedSlot.floorId = f._id;
            suggestedSlot.floorName = f.name;
            break;
          }
        }
      }
    }
    
    if (!suggestedSlot) {
       return res.status(404).json({ success: false, message: 'The parking lot is currently full or no suitable slot is available' });
    }
    
    res.status(200).json({
      success: true,
      message: 'Gợi ý ô đỗ thành công',
      data: suggestedSlot,
    });
  } catch (error) {
    console.error('Error suggestSmartSlot:', error);
    next(error);
  }
};

/**
 * @desc    Lấy danh sách các BookingHold đang active
 * @route   GET /api/bookings/active-holds
 * @access  Public (Guest/User/Admin)
 */
exports.getActiveHolds = async (req, res, next) => {
  try {
    const BookingHold = require('../models/BookingHold');
    const activeHolds = await BookingHold.find({
      status: 'active',
      expiresAt: { $gt: new Date() },
    }).lean();

    res.status(200).json({
      success: true,
      data: activeHolds.map(hold => ({
        holdId: hold._id,
        floorId: hold.floorId,
        slotCode: hold.slotCode,
        licensePlate: hold.licensePlate,
        expiresAt: hold.expiresAt,
      })),
    });
  } catch (error) {
    console.error('Error getActiveHolds:', error);
    next(error);
  }
};

/**
 * @desc    Tạo BookingHold (Khóa ô đỗ tạm thời trong 5 phút)
 * @route   POST /api/bookings/hold
 * @access  Private (Customer)
 */
exports.createBookingHold = async (req, res, next) => {
  try {
    const { floorId, slotCode, licensePlate, startTime, endTime } = req.body;
    
    if (!floorId || !slotCode || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'Please provide floorId, slotCode, startTime, endTime' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ success: false, message: 'Invalid booking time' });
    }

    const BookingHold = require('../models/BookingHold');
    const Session = require('../models/Session');
    const now = new Date();

    // Kiểm tra xem ô có đang bị ai đó hold trong thời gian này không
    const existingHold = await BookingHold.findOne({
      floorId,
      slotCode,
      status: 'active',
      expiresAt: { $gt: now },
      endTime: { $gt: start },
      startTime: { $lt: end },
    });

    if (existingHold) {
      const isOwner = req.user && existingHold.userId && existingHold.userId.toString() === req.user._id.toString();
      if (!isOwner) {
        return res.status(400).json({ success: false, message: 'This slot is temporarily held by someone else. Please select another slot.' });
      }
    }

    // Kiểm tra xem ô đỗ có đang có xe đỗ không (active session), 
    // và dự kiến đỗ qua cả thời gian bắt đầu của chúng ta không
    const slotOccupied = await Session.findOne({
      floorId,
      parkingSlot: slotCode,
      status: 'active'
    });

    if (slotOccupied) {
      return res.status(400).json({ success: false, message: 'This slot is currently occupied by another vehicle' });
    }

    const overlappingBooking = await Booking.findOne({
      floorId,
      parkingSlot: slotCode,
      status: { $in: ['PAID', 'PAUSED'] },
      scheduledStart: { $lt: end },
      scheduledEnd: { $gt: start }
    });

    if (overlappingBooking) {
      return res.status(400).json({ success: false, message: 'This slot is already booked. Please select another slot.' });
    }

    const normalizedPlate = licensePlate ? licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';

    if (normalizedPlate) {
      const vehicleOverlap = await Booking.findOne({
        licensePlate: normalizedPlate,
        status: { $in: ['PAID', 'PAUSED'] },
        scheduledStart: { $lt: end },
        scheduledEnd: { $gt: start }
      });
      if (vehicleOverlap) {
        return res.status(400).json({ success: false, message: `Vehicle ${licensePlate} already has another booking overlapping with this time period` });
      }
    }

    // Cho phép người dùng giữ nhiều ô đỗ cùng lúc (tối đa 5 ô) để hỗ trợ Bulk Booking
    if (req.user) {
      const activeHoldsCount = await BookingHold.countDocuments({
        userId: req.user._id,
        status: 'active',
        expiresAt: { $gt: now }
      });
      if (activeHoldsCount >= 5) {
        return res.status(400).json({ success: false, message: 'You can only hold a maximum of 5 slots at a time. Please pay or cancel some of your selected slots.' });
      }
    } else if (normalizedPlate) {
      const activeHoldsCount = await BookingHold.countDocuments({
        licensePlate: normalizedPlate,
        status: 'active',
        expiresAt: { $gt: now }
      });
      if (activeHoldsCount >= 5) {
        return res.status(400).json({ success: false, message: 'This license plate is holding too many slots. Please try again later.' });
      }
    }

    // Tạo hold mới
    const holdDurationMs = 5 * 60 * 1000; // 5 phút
    const newHold = await BookingHold.create({
      userId: req.user ? req.user._id : undefined,
      floorId,
      slotCode,
      licensePlate: normalizedPlate,
      startTime: start,
      endTime: end,
      expiresAt: new Date(now.getTime() + holdDurationMs),
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Khóa ô đỗ tạm thời thành công (5 phút)',
      data: newHold
    });

  } catch (error) {
    console.error('Error createBookingHold:', error);
    next(error);
  }
};

/**
 * @desc    Giải phóng BookingHold trước khi hết hạn
 * @route   DELETE /api/bookings/holds/:holdId
 * @access  Optional auth (Kiosk/Guest/Customer)
 */
exports.releaseBookingHold = async (req, res, next) => {
  try {
    const BookingHold = require('../models/BookingHold');
    const { holdId } = req.params;
    const { licensePlate, floorId, slotCode } = req.body || {};

    const hold = await BookingHold.findById(holdId);
    if (!hold) {
      return res.status(404).json({ success: false, message: 'Temporary hold not found' });
    }

    if (hold.status !== 'active') {
      return res.status(200).json({
        success: true,
        message: 'Giữ chỗ tạm thời đã được xử lý trước đó',
        data: hold,
      });
    }

    if (hold.userId) {
      const isOwner = req.user && sameObjectId(hold.userId, req.user._id);
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to release this hold',
        });
      }
    } else if (hold.licensePlate) {
      if (!licensePlate || normalizeLicensePlate(licensePlate) !== normalizeLicensePlate(hold.licensePlate)) {
        return res.status(403).json({
          success: false,
          message: 'Thông tin biển số không khớp với giữ chỗ tạm thời',
        });
      }
    } else if (
      !floorId ||
      !slotCode ||
      !sameObjectId(hold.floorId, floorId) ||
      normalizeSlotCode(hold.slotCode) !== normalizeSlotCode(slotCode)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Thông tin ô đỗ không khớp với giữ chỗ tạm thời',
      });
    }

    hold.status = 'released';
    await hold.save();

    res.status(200).json({
      success: true,
      message: 'Temporary slot hold released',
      data: hold,
    });
  } catch (error) {
    console.error('Error releaseBookingHold:', error);
    next(error);
  }
};

exports.quoteBulkBooking = async (req, res, next) => {
  try {
    const { items } = req.body;
    const userId = req.user._id;

    if (!items || items.length === 0) {
      throw new Error('Giỏ hàng trống');
    }

    const Vehicle = require('../models/Vehicle');
    const Service = require('../models/Service');
    const Booking = require('../models/Booking');
    const pricingEngine = require('../services/pricingEngine');
    
    let grandTotal = 0;
    const quotedItems = [];
    const itemErrors = [];

    // Check items sequentially
    for (const item of items) {
      const vehicleId = item.vehicleId;
      const floorId = item.floorId;
      const parkingSlot = item.parkingSlot || item.slotCode;
      const scheduledStart = item.scheduledStart || item.startTime;
      const scheduledEnd = item.scheduledEnd || item.endTime;
      const services = item.services || item.serviceIds || [];
      const clientItemId = item.clientItemId;
      const licensePlate = item.licensePlate;

      const start = new Date(scheduledStart);
      const end = new Date(scheduledEnd);
      
      try {
      let vehicle;
      if (vehicleId) {
        vehicle = await Vehicle.findOne({ _id: vehicleId, owner: userId });
      } else if (licensePlate) {
        const plateRegex = /^[A-Za-z0-9]{4,12}$/;
        if (!plateRegex.test(licensePlate)) {
          throw new Error(`Invalid license plate ${licensePlate}. Must be 4-12 alphanumeric characters.`);
        }
        const normalized = normalizeLicensePlate(licensePlate);
        // Try to find if this plate is actually a registered vehicle
        const foundVehicle = await Vehicle.findOne({ licensePlate: normalized, owner: userId });
        vehicle = foundVehicle || { _id: null, licensePlate: normalized };
      }
      if (!vehicle) throw new Error(`No valid vehicle found for parking slot ${parkingSlot}`);

      const durationHours = (end - start) / (1000 * 60 * 60);
      if (durationHours <= 0) throw new Error('Invalid duration');
      // Check VIP Restriction
      if (vehicle.licensePlate) {
        const restriction = await findVipRegisteredVehicleBookingRestriction({
          userId,
          licensePlate: vehicle.licensePlate,
          floorId,
          slotCode: parkingSlot,
          start,
          end
        });
        if (restriction) {
          throw new Error(`Vehicle ${vehicle.licensePlate} is already in a VIP subscription. Please use your VIP parking slot instead of making a new booking.`);
        }
      }

      // Check overlapping for vehicle
      const vehicleQuery = vehicle._id 
        ? { vehicleId: vehicle._id } 
        : { licensePlate: vehicle.licensePlate };
        
      const overlappingBooking = await Booking.findOne({
        ...vehicleQuery,
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
        scheduledStart: { $lt: end },
        scheduledEnd: { $gt: start }
      });
      if (overlappingBooking) throw new Error(`Vehicle ${vehicle.licensePlate} already has another booking overlapping with this time`);

      // Check slot occupation
      const slotOverlapBooking = await Booking.findOne({
        floorId,
        parkingSlot,
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
        scheduledStart: { $lt: end },
        scheduledEnd: { $gt: start }
      });
      if (slotOverlapBooking) throw new Error(`Parking slot ${parkingSlot} is already booked during your selected time.`);

      // Check subscription to waive fees if it's the user's own VIP slot
      const subscriptionInfo = await findActiveSlotOwnership({
        floorId,
        slotCode: parkingSlot,
        at: start,
      });
      if (subscriptionInfo && subscriptionInfo.ownerId.toString() !== userId.toString()) {
        throw new Error(`Parking slot ${parkingSlot} is registered under a fixed subscription.`);
      }

      // Pricing
      const pricing = await pricingEngine.calculatePrice(start, end);
      if (subscriptionInfo && subscriptionInfo.ownerId.toString() === userId.toString()) {
        pricing.finalTotal = 0;
      }
      
      // Services pricing
      let servicesTotal = 0;
      if (services.length > 0) {
        const servicesData = await Service.find({ _id: { $in: services } });
        for (const s of servicesData) {
          servicesTotal += s.price;
        }
      }

      const itemTotal = pricing.finalTotal + servicesTotal;
      grandTotal += itemTotal;

      quotedItems.push({
        clientItemId,
        parkingSlot,
        vehicleId,
        totalAmount: itemTotal,
        pricingPreview: pricing,
        servicesTotal
      });
      } catch (err) {
        itemErrors.push({
          clientItemId,
          message: err.message
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        grandTotal,
        items: quotedItems,
        itemErrors
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createBulkBooking = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { idempotencyKey, items } = req.body;
    const userId = req.user._id;

    if (!items || items.length === 0) {
      throw new Error('Giỏ hàng trống');
    }

    const BookingOrder = require('../models/BookingOrder');
    const Booking = require('../models/Booking');
    const BookingService = require('../models/BookingService');
    const BookingHold = require('../models/BookingHold');
    const Vehicle = require('../models/Vehicle');
    const Service = require('../models/Service');
    const pricingEngine = require('../services/pricingEngine');
    const walletService = require('../services/walletService');
    const contractService = require('../services/contractService');
    const notifTriggers = require('../services/notificationTriggers');
    
    // Check idempotency
    if (idempotencyKey) {
      const existingOrder = await BookingOrder.findOne({ userId, idempotencyKey });
      if (existingOrder) {
        throw new Error('Đơn hàng này đã được thanh toán');
      }
    }

    let grandTotal = 0;
    const bookingsToCreate = [];
    
    // Cache for checking overlaps within the same bulk request
    const internalVehicleReservations = [];
    const internalSlotReservations = [];

    // Check items sequentially
    for (const item of items) {
      const vehicleId = item.vehicleId;
      const floorId = item.floorId;
      const parkingSlot = item.parkingSlot || item.slotCode;
      const scheduledStart = item.scheduledStart || item.startTime;
      const scheduledEnd = item.scheduledEnd || item.endTime;
      const services = item.services || item.serviceIds || [];
      const holdId = item.holdId;
      const licensePlate = item.licensePlate;

      const start = new Date(scheduledStart);
      const end = new Date(scheduledEnd);
      
      let vehicle;
      if (vehicleId) {
        vehicle = await Vehicle.findOne({ _id: vehicleId, owner: userId }).session(session);
      } else if (licensePlate) {
        const plateRegex = /^[A-Za-z0-9]{4,12}$/;
        if (!plateRegex.test(licensePlate)) {
          throw new Error(`Invalid license plate ${licensePlate}. Must be 4-12 alphanumeric characters.`);
        }
        const normalized = normalizeLicensePlate(licensePlate);
        const globallyRegistered = await Vehicle.findOne({ licensePlate: normalized, status: 'approved' }).session(session);
        if (globallyRegistered && globallyRegistered.owner.toString() !== userId.toString()) {
          const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
          const Subscription = require('../models/Subscription');
          const now = new Date();
          
          let hasVip = false;
          const entitlements = await MembershipSlotEntitlement.find({
            ownerId: globallyRegistered.owner,
            status: { $in: ['active', 'transfer_locked'] },
            expireAt: { $gt: now },
          }).session(session);
          
          if (entitlements.length > 0) {
            hasVip = true;
          } else {
            const sub = await Subscription.findOne({
              user: globallyRegistered.owner,
              status: 'active',
              paymentStatus: 'paid',
              expireAt: { $gt: now },
            }).session(session);
            if (sub && sub.slots && sub.slots.length > 0) hasVip = true;
          }
          
          if (hasVip) {
            throw new Error('This license plate belongs to another VIP account and cannot be booked on their behalf.');
          }
        }
        
        const foundVehicle = await Vehicle.findOne({ licensePlate: normalized, owner: userId }).session(session);
        vehicle = foundVehicle || { _id: null, licensePlate: normalized };
      }
      if (!vehicle) throw new Error(`No valid vehicle found for parking slot ${parkingSlot}`);

      const durationHours = (end - start) / (1000 * 60 * 60);
      if (durationHours <= 0) throw new Error('Invalid duration');
      // Check VIP Restriction
      if (vehicle.licensePlate) {
        const restriction = await findVipRegisteredVehicleBookingRestriction({
          userId,
          licensePlate: vehicle.licensePlate,
          floorId,
          slotCode: parkingSlot,
          start,
          end
        });
        if (restriction) {
          throw new Error(`Vehicle ${vehicle.licensePlate} is already in a VIP subscription. Please use your VIP parking slot instead of making a new booking.`);
        }
      }

      // Check internal overlap for vehicle within the same request
      const internalVehicleOverlap = internalVehicleReservations.find(res => {
        const isSameVehicle = vehicle._id ? res.vehicleId === vehicle._id.toString() : res.licensePlate === vehicle.licensePlate;
        return isSameVehicle && res.start < end && res.end > start;
      });
      if (internalVehicleOverlap) throw new Error(`Vehicle ${vehicle.licensePlate} has overlapping bookings within the same cart`);

      // Check internal overlap for slot within the same request
      const internalSlotOverlap = internalSlotReservations.find(res => {
        return res.parkingSlot === parkingSlot && res.start < end && res.end > start;
      });
      if (internalSlotOverlap) throw new Error(`Parking slot ${parkingSlot} has overlapping bookings within the same cart`);

      // Record internal reservations
      internalVehicleReservations.push({ 
        vehicleId: vehicle._id ? vehicle._id.toString() : null, 
        licensePlate: vehicle.licensePlate ? vehicle.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : normalizedItemPlate, 
        start, end 
      });
      internalSlotReservations.push({ parkingSlot, start, end });

      // Check overlapping for vehicle in Database
      const vehicleQuery = vehicle._id 
        ? { vehicleId: vehicle._id } 
        : { licensePlate: vehicle.licensePlate ? vehicle.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : normalizedItemPlate };

      const overlappingBooking = await Booking.findOne({
        ...vehicleQuery,
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
        scheduledStart: { $lt: end },
        scheduledEnd: { $gt: start }
      }).session(session);
      if (overlappingBooking) throw new Error(`Vehicle ${vehicle.licensePlate} already has another booking overlapping with this time`);

      // Check slot occupation
      const slotOverlapBooking = await Booking.findOne({
        floorId,
        parkingSlot,
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
        scheduledStart: { $lt: end },
        scheduledEnd: { $gt: start }
      }).session(session);
      if (slotOverlapBooking) throw new Error(`Parking slot ${parkingSlot} is already booked during your selected time.`);

      // Check if vehicle is currently inside the parking lot (active Session)
      const Session = require('../models/Session');
      const activeSession = await Session.findOne({
        licensePlate: vehicle.licensePlate ? vehicle.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : normalizedItemPlate,
        status: 'active'
      }).session(session);
      
      if (activeSession) {
        let expectedCheckoutTime = new Date(activeSession.checkInTime);
        expectedCheckoutTime.setHours(expectedCheckoutTime.getHours() + (activeSession.expectedDurationHours || 1));
        
        // Cập nhật: Nếu xe đã overstay (expectedCheckoutTime nằm trong quá khứ), nhưng vẫn chưa checkout,
        // thì vẫn tính là đang chiếm dụng đến thời điểm hiện tại.
        const effectiveCheckoutTime = new Date(Math.max(expectedCheckoutTime.getTime(), Date.now()));
        
        // Block nếu thời gian bắt đầu booking nằm trước lúc xe rời đi (bao gồm cả hiện tại)
        if (start < effectiveCheckoutTime) {
          throw new Error(`Vehicle ${vehicle.licensePlate} is currently parked and has not checked out. Cannot create a new booking for this time slot.`);
        }
      }

      // Check subscription
      const subscriptionInfo = await findActiveSlotOwnership({
        floorId,
        slotCode: parkingSlot,
        at: start,
        session,
      });
      if (subscriptionInfo && subscriptionInfo.ownerId.toString() !== userId.toString()) {
        throw new Error(`Parking slot ${parkingSlot} is registered under a fixed subscription.`);
      }

      // Verify BookingHold to prevent stealing slots
      if (!holdId) {
        throw new Error(`Parking slot ${parkingSlot} does not have a valid hold session.`);
      }
      const bookingHold = await BookingHold.findOne({
        _id: holdId,
        userId: userId,
        slotCode: parkingSlot,
        expiresAt: { $gt: new Date() }
      }).session(session);
      if (!bookingHold) {
        throw new Error(`Phiên giữ chỗ cho ô đỗ ${parkingSlot} không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.`);
      }

      // Pricing
      const pricing = await pricingEngine.calculatePrice(start, end);
      if (subscriptionInfo && subscriptionInfo.ownerId.toString() === userId.toString()) {
        pricing.finalTotal = 0;
      }
      
      // Services pricing
      let itemServices = [];
      let servicesTotal = 0;
      if (services.length > 0) {
        const servicesData = await Service.find({ _id: { $in: services } }).session(session);
        for (const s of servicesData) {
          servicesTotal += s.price;
          itemServices.push({
            serviceId: s._id,
            serviceName: s.name,
            price: s.price,
            timeCost: s.timeCost || 30
          });
        }
      }

      grandTotal += (pricing.finalTotal + servicesTotal);

      bookingsToCreate.push({
        userId,
        vehicleId: vehicle._id,
        licensePlate: vehicle.licensePlate ? vehicle.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : normalizedItemPlate,
        floorId,
        parkingSlot,
        scheduledStart: start,
        scheduledEnd: end,
        durationHours: pricing.durationHours,
        prepaidAmount: pricing.finalTotal + servicesTotal,
        parkingAmount: pricing.finalTotal,
        serviceAmount: servicesTotal,
        paymentMethod: 'wallet',
        status: 'PAID',
        servicesData: itemServices,
        holdId
      });
    }

    // Check wallet balance
    const wallet = await walletService.getOrCreateWallet(userId, { session });
    if (wallet.balance < grandTotal) {
      throw new Error('Số dư ví không đủ, vui lòng nạp thêm tiền');
    }

    // Create Order
    const newOrder = await BookingOrder.create([{
      userId,
      status: 'paid',
      itemCount: bookingsToCreate.length,
      grandTotal,
      idempotencyKey: idempotencyKey || new mongoose.Types.ObjectId().toString()
    }], { session });

    // Debit wallet
    const wt = await walletService.debitWallet(
      userId,
      grandTotal,
      `Payment for ${bookingsToCreate.length} ${bookingsToCreate.length === 1 ? 'booking' : 'bookings'}`,
      { refSource: 'booking_order', refSourceId: newOrder[0]._id, session }
    );
    newOrder[0].walletTransactionId = wt.transaction._id;
    await newOrder[0].save({ session });

    const createdBookingsResponse = [];
    const bulkRefundPolicySnapshot = await getEffectiveRefundPolicySnapshot({ session });

    // Create Bookings
    for (const bData of bookingsToCreate) {
      const newBooking = new Booking({
        userId: bData.userId,
        vehicleId: bData.vehicleId,
        licensePlate: bData.licensePlate,
        floorId: bData.floorId,
        parkingSlot: bData.parkingSlot,
        scheduledStart: bData.scheduledStart,
        scheduledEnd: bData.scheduledEnd,
        durationHours: bData.durationHours,
        prepaidAmount: bData.prepaidAmount,
        paymentMethod: bData.paymentMethod,
        status: bData.status
      });
      await newBooking.save({ session });

      if (bData.servicesData.length > 0) {
        await BookingService.insertMany(
          bData.servicesData.map(s => ({
            bookingId: newBooking._id,
            ...s
          })),
          { session }
        );
      }

      await attachPaidBookingSnapshots(newBooking, {
        parkingAmount: bData.parkingAmount,
        serviceAmount: bData.serviceAmount,
        source: 'calculated',
        refundPolicySnapshot: bulkRefundPolicySnapshot,
        session,
      });
      
      // Auto-contract
      try {
        const contract = await contractService.generateContract(newBooking._id);
        if (contract) {
          newBooking.contractId = contract._id;
          await newBooking.save({ session });
          if (contract.status === 'DRAFT') {
            await contractService.activateContract(contract._id, req.app);
          }
        }
      } catch (err) { }

      // Release hold if any
      if (bData.holdId) {
        await BookingHold.updateOne({ _id: bData.holdId }, { status: 'consumed' }, { session });
      }

      notifTriggers.notifyBookingSuccess(req.app, userId, {
        bookingId: newBooking._id.toString(),
        slotInfo: `${bData.parkingSlot}`
      }).catch(() => {});

      emitBookingChanged(req.app, newBooking, { action: 'created' });
      createdBookingsResponse.push({
        bookingId: newBooking._id,
        qrCode: buildBookingQrPayload(newBooking),
        slotCode: newBooking.parkingSlot,
        licensePlate: newBooking.licensePlate,
        startTime: newBooking.scheduledStart,
        endTime: newBooking.scheduledEnd,
        totalAmount: newBooking.prepaidAmount,
        status: newBooking.status,
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: 'Đặt chỗ hàng loạt thành công',
      data: {
        transaction: newOrder[0],
        bookings: createdBookingsResponse
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error createBulkBooking:', error);
    res.status(400).json({ success: false, message: error.message || 'Lỗi xử lý đặt chỗ' });
  }
};

exports.getAllBookings = async (req, res, next) => {
  try {
    const { date, floorId } = req.query;
    const Booking = require('../models/Booking');
    const {
      resolveVietnamCalendarDay,
      buildBookingDayOverlapMatch,
    } = require('../utils/bookingDateRange');

    let filter = {};

    if (date) {
      filter = buildBookingDayOverlapMatch(resolveVietnamCalendarDay(date));
    }

    if (floorId) {
      filter.floorId = floorId;
    }

    const bookings = await Booking.find(filter)
      .populate('userId', 'username email')
      .populate('vehicleId', 'licensePlate brand color')
      .populate('floorId', 'name floorNumber')
      .sort({ scheduledStart: 1 })
      .lean();

    const userIds = bookings
      .map((booking) => booking.userId?._id)
      .filter(Boolean);
    const userDetails = userIds.length > 0
      ? await UserDetail.find({ userId: { $in: userIds } })
        .select('userId firstName lastName phone')
        .lean()
      : [];
    const enrichedBookings = attachBookingUserDetails(bookings, userDetails);
    const financialSummaries = await getBookingFinancialSummaryMap(enrichedBookings);
    const bookingRows = enrichedBookings.map((booking) => ({
      ...booking,
      financialSummary: financialSummaries.get(String(booking._id)),
    }));

    res.status(200).json({
      success: true,
      data: bookingRows
    });
  } catch (error) {
    console.error('Error getAllBookings:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Lỗi tải danh sách Booking',
    });
  }
};

exports.getActiveMapBookings = async (req, res, next) => {
  try {
    const now = new Date();
    const start = now;
    const end = new Date(now.getTime() + 60 * 1000); // 1 minute range for live map

    const overlappingBookings = await Booking.find({
      status: { $in: BOOKING_STATUSES_THAT_BLOCK_SLOT },
      scheduledStart: { $lt: end },
      scheduledEnd: { $gt: start },
      $or: [
        { status: { $in: ['ACTIVE', 'PAUSED'] } },
        {
          status: 'PAID',
          scheduledStart: { $gt: new Date(now.getTime() - 15 * 60 * 1000) }
        }
      ]
    })
      .populate('userId', 'username email phone')
      .lean();

    res.status(200).json({
      success: true,
      data: overlappingBookings,
    });
  } catch (error) {
    next(error);
  }
};

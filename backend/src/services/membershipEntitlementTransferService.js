const crypto = require('crypto');
const mongoose = require('mongoose');
const MembershipEntitlementTransfer = require('../models/MembershipEntitlementTransfer');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const User = require('../models/User');
const ParkingFloor = require('../models/ParkingFloor');
const TicketPackage = require('../models/TicketPackage');
const Vehicle = require('../models/Vehicle');
const walletService = require('./walletService');
const {
  buildTransferAgreementPdf,
  formatCurrency,
  formatDate,
} = require('./pdfService');
const { recomputeUserMembership } = require('./membershipProjectionService');

const OPEN_STATUSES = [
  'PENDING_RECIPIENT',
  'PENDING_ADMIN',
  'LISTED',
  'AWAITING_PAYMENT',
];
const DIRECT_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PUBLIC_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_CLAIM_WINDOW_MS = 15 * 60 * 1000;
const MARKETPLACE_INDEX_NAME = 'one_open_transfer_per_entitlement_v2';
let marketplaceReadinessCache = {
  checkedAt: 0,
  ready: false,
};
const error = (message, statusCode = 400, code) =>
  Object.assign(new Error(message), { statusCode, code });
const floor1000 = (value) => Math.floor(Math.max(0, Number(value || 0)) / 1000) * 1000;
const normalizeMode = (mode) => String(mode || 'DIRECT').trim().toUpperCase();
const escapeRegex = (value) =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getExpiredTransferResolution = (transfer, now = new Date()) =>
  transfer.mode === 'PUBLIC' &&
  transfer.listingExpiresAt &&
  new Date(transfer.listingExpiresAt) > now
    ? 'RELIST'
    : 'EXPIRE';

const assertPublicMarketplaceReady = async () => {
  if (String(process.env.MEMBERSHIP_TRANSFER_PUBLIC_ENABLED || 'true') === 'false') {
    throw error(
      'Public membership transfers are currently disabled.',
      503,
      'MARKETPLACE_DISABLED'
    );
  }
  const now = Date.now();
  if (marketplaceReadinessCache.ready && now - marketplaceReadinessCache.checkedAt < 60000) {
    return;
  }
  const indexes = await MembershipEntitlementTransfer.collection.indexes();
  const index = indexes.find((item) => item.name === MARKETPLACE_INDEX_NAME);
  const statuses = index?.partialFilterExpression?.status?.$in || [];
  const ready =
    index?.unique === true &&
    OPEN_STATUSES.every((status) => statuses.includes(status));
  marketplaceReadinessCache = { checkedAt: now, ready };
  if (!ready) {
    throw error(
      'Public membership transfers are waiting for database migration.',
      503,
      'MARKETPLACE_NOT_READY'
    );
  }
};

const calculateTransferPricing = (entitlement, askingPrice, now = new Date()) => {
  const validFrom = new Date(entitlement.validFrom);
  const expireAt = new Date(entitlement.expireAt);
  const totalTerm = Math.max(1, expireAt.getTime() - validFrom.getTime());
  const remainingTerm = Math.max(0, expireAt.getTime() - now.getTime());
  const remainingValue = floor1000(
    Number(entitlement.unitAmount || 0) * (remainingTerm / totalTerm)
  );
  const normalizedAskingPrice = floor1000(askingPrice);
  if (normalizedAskingPrice > remainingValue) {
    throw error(
      `Asking price cannot exceed remaining value ${remainingValue}.`,
      400,
      'ASKING_PRICE_TOO_HIGH'
    );
  }
  const transferFee = remainingValue * 0.05;
  return {
    askingPrice: normalizedAskingPrice,
    remainingValue,
    transferFee,
    totalDue: normalizedAskingPrice + transferFee,
    calculatedAt: now,
    validFrom,
    expireAt,
    unitAmount: Number(entitlement.unitAmount || 0),
  };
};

const populateTransfer = (query) =>
  query
    .populate('fromUserId', 'username email')
    .populate('toUserId', 'username email')
    .populate({
      path: 'entitlementId',
      populate: [
        {
          path: 'floorId',
          select: 'name floorNumber parkingLotID',
          populate: { path: 'parkingLotID', select: 'name address' },
        },
        { path: 'packageId', select: 'name type price' },
      ],
    })
    .populate('approvedBy', 'username email');

const assertNoActiveSession = async (entitlementId, session = null) => {
  let query = Session.findOne({
    entitlementId,
    status: 'active',
  }).select('_id');
  if (session) query = query.session(session);
  if (await query) {
    throw error(
      'The vehicle must be checked out before this space can be transferred.',
      409,
      'ACTIVE_SESSION_EXISTS'
    );
  }
};

const assertRecipientCapacity = async (userId, session = null) => {
  let vehicleQuery = Vehicle.countDocuments({ owner: userId, status: 'approved' });
  let entitlementQuery = MembershipSlotEntitlement.countDocuments({
    ownerId: userId,
    status: { $in: ['active', 'transfer_locked'] },
    expireAt: { $gt: new Date() },
  });
  if (session) {
    vehicleQuery = vehicleQuery.session(session);
    entitlementQuery = entitlementQuery.session(session);
  }
  const [vehicleCount, entitlementCount] = await Promise.all([
    vehicleQuery,
    entitlementQuery,
  ]);
  if (!vehicleCount || entitlementCount >= Math.min(3, vehicleCount)) {
    throw error(
      'Recipient needs an approved vehicle and available membership capacity.',
      409,
      'RECIPIENT_CAPACITY_EXCEEDED'
    );
  }
};

const createTransfer = async ({
  entitlementId,
  fromUserId,
  mode,
  toUserId,
  toUserEmail,
  askingPrice,
  reason,
}) => {
  const normalizedMode = normalizeMode(mode);
  if (!['DIRECT', 'PUBLIC'].includes(normalizedMode)) {
    throw error('Invalid transfer mode.', 400, 'INVALID_TRANSFER_MODE');
  }
  if (normalizedMode === 'PUBLIC' && (toUserId || toUserEmail)) {
    throw error(
      'A public listing cannot target a recipient.',
      400,
      'PUBLIC_RECIPIENT_NOT_ALLOWED'
    );
  }
  if (normalizedMode === 'DIRECT' && !toUserId && !toUserEmail) {
    throw error(
      'Recipient user ID or email is required.',
      400,
      'RECIPIENT_REQUIRED'
    );
  }
  if (normalizedMode === 'PUBLIC') {
    await assertPublicMarketplaceReady();
  }
  const entitlement = await MembershipSlotEntitlement.findOne({
    _id: entitlementId,
    ownerId: fromUserId,
    status: 'active',
    expireAt: { $gt: new Date() },
    transferCount: { $lt: 1 },
  });
  if (!entitlement) {
    throw error('This membership space cannot be transferred.', 404, 'NOT_TRANSFERABLE');
  }
  await assertNoActiveSession(entitlement._id);
  if (
    await MembershipEntitlementTransfer.exists({
      entitlementId: entitlement._id,
      status: { $in: OPEN_STATUSES },
    })
  ) {
    throw error('This space already has an open transfer.', 409, 'TRANSFER_EXISTS');
  }
  let recipient = null;
  if (normalizedMode === 'DIRECT') {
    recipient = await User.findOne(
      toUserId
        ? { _id: toUserId }
        : { email: String(toUserEmail || '').trim().toLowerCase() }
    ).select('role status username email');
    if (!recipient || recipient.role !== 'customer' || !recipient.status) {
      throw error('Active recipient account not found.', 404, 'RECIPIENT_NOT_FOUND');
    }
    if (String(recipient._id) === String(fromUserId)) {
      throw error('You cannot transfer a space to yourself.', 400, 'SELF_TRANSFER');
    }
  }
  const pricing = calculateTransferPricing(entitlement, askingPrice);
  const transfer = await MembershipEntitlementTransfer.create({
    entitlementId: entitlement._id,
    fromUserId,
    mode: normalizedMode,
    toUserId: recipient?._id || null,
    status: normalizedMode === 'DIRECT' ? 'PENDING_RECIPIENT' : 'PENDING_ADMIN',
    reason,
    askingPrice: pricing.askingPrice,
    remainingValue: pricing.remainingValue,
    transferFee: pricing.transferFee,
    priceSnapshot: pricing,
  }).catch((cause) => {
    if (cause?.code === 11000) {
      throw error('This space already has an open transfer.', 409, 'TRANSFER_EXISTS');
    }
    throw cause;
  });
  return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
};

const searchTransferRecipients = async (
  requesterId,
  search = '',
  requestedLimit = 12
) => {
  const limit = Math.min(20, Math.max(1, Number.parseInt(requestedLimit, 10) || 12));
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const query = {
    _id: { $ne: requesterId },
    role: 'customer',
    status: true,
  };
  if (normalizedSearch) {
    query.email = { $regex: escapeRegex(normalizedSearch), $options: 'i' };
  }
  return User.find(query)
    .select('_id username email')
    .sort({ email: 1 })
    .limit(limit)
    .lean();
};

const acceptTransfer = async (transferId, userId) => {
  const transfer = await MembershipEntitlementTransfer.findOneAndUpdate(
    {
      _id: transferId,
      mode: 'DIRECT',
      toUserId: userId,
      status: 'PENDING_RECIPIENT',
    },
    { $set: { status: 'PENDING_ADMIN', acceptedAt: new Date() } },
    { new: true }
  );
  if (!transfer) throw error('Transfer invitation is not available.', 409);
  return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
};

const rejectTransfer = async (transferId, userId, reason = '') => {
  const existing = await MembershipEntitlementTransfer.findOne({
    _id: transferId,
    status: { $in: ['PENDING_RECIPIENT', 'PENDING_ADMIN'] },
    $or: [{ toUserId: userId }, { fromUserId: userId }],
  }).select('fromUserId');
  if (!existing) throw error('Transfer cannot be cancelled or rejected.', 409);
  const nextStatus =
    String(userId) === String(existing.fromUserId) ? 'CANCELLED' : 'REJECTED';
  const transfer = await MembershipEntitlementTransfer.findOneAndUpdate(
    {
      _id: transferId,
      status: { $in: ['PENDING_RECIPIENT', 'PENDING_ADMIN'] },
      $or: [{ toUserId: userId }, { fromUserId: userId }],
    },
    {
      $set: {
        status: nextStatus,
        rejectedBy: userId,
        rejectedAt: new Date(),
        rejectionReason: String(reason || '').trim(),
      },
    },
    { new: true }
  );
  if (!transfer) throw error('Transfer cannot be cancelled or rejected.', 409);
  return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
};

const cancelTransfer = async (transferId, userId, reason = '') => {
  const transfer = await MembershipEntitlementTransfer.findOneAndUpdate(
    {
      _id: transferId,
      fromUserId: userId,
      status: { $in: ['PENDING_RECIPIENT', 'PENDING_ADMIN', 'LISTED'] },
    },
    {
      $set: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        rejectedBy: userId,
        rejectedAt: new Date(),
        rejectionReason: String(reason || '').trim(),
      },
    },
    { new: true }
  );
  if (!transfer) {
    throw error(
      'Transfer cannot be cancelled in its current state.',
      409,
      'TRANSFER_CANNOT_CANCEL'
    );
  }
  return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
};

const approveTransfer = async (transferId, adminId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const transfer = await MembershipEntitlementTransfer.findOne({
      _id: transferId,
      status: 'PENDING_ADMIN',
    }).session(session);
    if (!transfer) throw error('Transfer is not awaiting admin approval.', 409);
    await assertNoActiveSession(transfer.entitlementId, session);
    if (transfer.mode === 'PUBLIC') {
      await assertPublicMarketplaceReady();
      const entitlement = await MembershipSlotEntitlement.findOne({
        _id: transfer.entitlementId,
        ownerId: transfer.fromUserId,
        status: 'active',
        transferCount: { $lt: 1 },
        expireAt: { $gt: new Date() },
      }).session(session);
      if (!entitlement) throw error('Entitlement changed before approval.', 409);
      const now = new Date();
      transfer.status = 'LISTED';
      transfer.approvedBy = adminId;
      transfer.approvedAt = now;
      transfer.listingApprovedAt = now;
      transfer.listingExpiresAt = new Date(now.getTime() + PUBLIC_LISTING_WINDOW_MS);
      transfer.lockExpiresAt = null;
      await transfer.save({ session });
      await session.commitTransaction();
      return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
    }

    await assertRecipientCapacity(transfer.toUserId, session);
    const lockExpiresAt = new Date(Date.now() + DIRECT_PAYMENT_WINDOW_MS);
    const entitlement = await MembershipSlotEntitlement.findOneAndUpdate(
      {
        _id: transfer.entitlementId,
        ownerId: transfer.fromUserId,
        status: 'active',
        transferCount: { $lt: 1 },
        expireAt: { $gt: new Date() },
      },
      { $set: { status: 'transfer_locked' } },
      { new: true, session }
    );
    if (!entitlement) throw error('Entitlement changed before approval.', 409);
    transfer.status = 'AWAITING_PAYMENT';
    transfer.approvedBy = adminId;
    transfer.approvedAt = new Date();
    transfer.lockExpiresAt = lockExpiresAt;
    await transfer.save({ session });
    await session.commitTransaction();
    return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
  } catch (cause) {
    await session.abortTransaction();
    throw cause;
  } finally {
    session.endSession();
  }
};

const toMarketplaceItem = (transfer, viewerId = null) => {
  const entitlement = transfer.entitlementId || {};
  const floor = entitlement.floorId || {};
  const parkingLot = floor.parkingLotID || {};
  const ticketPackage = entitlement.packageId || {};
  return {
    transferId: transfer._id,
    mode: transfer.mode,
    status: transfer.status,
    available:
      transfer.status === 'LISTED' &&
      Boolean(transfer.listingExpiresAt) &&
      new Date(transfer.listingExpiresAt) > new Date(),
    canSettle:
      transfer.status === 'AWAITING_PAYMENT' &&
      Boolean(viewerId) &&
      String(transfer.toUserId?._id || transfer.toUserId) === String(viewerId),
    slotCode: entitlement.slotCode,
    parkingLot: parkingLot?._id
      ? {
          id: parkingLot._id,
          name: parkingLot.name,
          address: parkingLot.address,
        }
      : null,
    floor: floor?._id
      ? {
          id: floor._id,
          name: floor.name,
          floorNumber: floor.floorNumber,
        }
      : null,
    package: ticketPackage?._id
      ? {
          id: ticketPackage._id,
          name: ticketPackage.name,
          type: ticketPackage.type,
        }
      : null,
    askingPrice: transfer.askingPrice,
    remainingValue: transfer.remainingValue,
    transferFee: transfer.transferFee,
    totalDue: Number(transfer.askingPrice || 0) + Number(transfer.transferFee || 0),
    validFrom: entitlement.validFrom,
    expireAt: entitlement.expireAt,
    listingExpiresAt: transfer.listingExpiresAt,
    lockExpiresAt: transfer.lockExpiresAt,
    createdAt: transfer.createdAt,
  };
};

const marketplacePopulate = (query) =>
  query.populate({
    path: 'entitlementId',
    select: 'slotCode validFrom expireAt floorId packageId',
    populate: [
      {
        path: 'floorId',
        select: 'name floorNumber parkingLotID',
        populate: { path: 'parkingLotID', select: 'name address' },
      },
      { path: 'packageId', select: 'name type' },
    ],
  });

const buildMarketplaceQuery = async (filters = {}) => {
  const now = new Date();
  const query = {
    mode: 'PUBLIC',
    status: 'LISTED',
    listingExpiresAt: { $gt: now },
  };
  const minimumExpiry = Number.isFinite(Number(filters.minRemainingDays))
    ? new Date(
        now.getTime() +
          Math.max(0, Number(filters.minRemainingDays)) * 86400000
      )
    : now;
  query['priceSnapshot.expireAt'] = { $gt: minimumExpiry };
  const minPrice = Number(filters.minPrice);
  const maxPrice = Number(filters.maxPrice);
  if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
    query.askingPrice = {};
    if (Number.isFinite(minPrice)) query.askingPrice.$gte = Math.max(0, minPrice);
    if (Number.isFinite(maxPrice)) query.askingPrice.$lte = Math.max(0, maxPrice);
  }

  const entitlementQuery = { status: 'active', expireAt: { $gt: minimumExpiry } };
  if (filters.floorId) entitlementQuery.floorId = filters.floorId;
  if (filters.parkingLotId) {
    const floorIds = await ParkingFloor.find({
      parkingLotID: filters.parkingLotId,
    }).distinct('_id');
    entitlementQuery.floorId = entitlementQuery.floorId
      ? { $in: floorIds.filter((id) => String(id) === String(filters.floorId)) }
      : { $in: floorIds };
  }
  if (filters.floorId || filters.parkingLotId) {
    query.entitlementId = {
      $in: await MembershipSlotEntitlement.find(entitlementQuery).distinct('_id'),
    };
  }
  return query;
};

const listMarketplace = async (filters = {}) => {
  await assertPublicMarketplaceReady();
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(filters.limit, 10) || 20));
  const query = await buildMarketplaceQuery(filters);
  const sort = {
    price_asc: { askingPrice: 1, createdAt: -1 },
    expiry_asc: { listingExpiresAt: 1, createdAt: -1 },
  }[filters.sort] || { createdAt: -1 };
  const [records, total] = await Promise.all([
    marketplacePopulate(
      MembershipEntitlementTransfer.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
    ).lean(),
    MembershipEntitlementTransfer.countDocuments(query),
  ]);
  return {
    items: records.map(toMarketplaceItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getMarketplaceListing = async (transferId, viewerId) => {
  await assertPublicMarketplaceReady();
  const transfer = await marketplacePopulate(
    MembershipEntitlementTransfer.findOne({
      _id: transferId,
      mode: 'PUBLIC',
      $or: [
        { status: 'LISTED' },
        { status: 'AWAITING_PAYMENT', toUserId: viewerId },
      ],
    })
  ).lean();
  if (!transfer) {
    throw error(
      'This marketplace listing is not available.',
      404,
      'LISTING_NOT_AVAILABLE'
    );
  }
  const item = toMarketplaceItem(transfer, viewerId);
  if (item.canSettle) {
    const wallet = await walletService.getBalance(viewerId);
    item.walletBalance = Number(wallet.balance || 0);
    item.shortfall = Math.max(0, item.totalDue - item.walletBalance);
  }
  return item;
};

const claimMarketplaceListing = async (transferId, buyerId) => {
  await assertPublicMarketplaceReady();
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const now = new Date();
    const transfer = await MembershipEntitlementTransfer.findOne({
      _id: transferId,
      mode: 'PUBLIC',
      status: 'LISTED',
      toUserId: null,
      listingExpiresAt: { $gt: now },
    }).session(session);
    if (!transfer) {
      throw error(
        'This listing is no longer available.',
        409,
        'LISTING_ALREADY_CLAIMED'
      );
    }
    if (String(transfer.fromUserId) === String(buyerId)) {
      throw error('You cannot buy your own listing.', 400, 'SELF_TRANSFER');
    }
    const buyer = await User.findOne({
      _id: buyerId,
      role: 'customer',
      status: true,
    }).session(session);
    if (!buyer) throw error('Active buyer account not found.', 404, 'RECIPIENT_NOT_FOUND');

    await assertRecipientCapacity(buyerId, session);
    await assertNoActiveSession(transfer.entitlementId, session);
    const entitlement = await MembershipSlotEntitlement.findOneAndUpdate(
      {
        _id: transfer.entitlementId,
        ownerId: transfer.fromUserId,
        status: 'active',
        transferCount: { $lt: 1 },
        expireAt: { $gt: now },
      },
      { $set: { status: 'transfer_locked' } },
      { new: true, session }
    );
    if (!entitlement) {
      throw error('This listing is no longer available.', 409, 'LISTING_NOT_AVAILABLE');
    }

    transfer.toUserId = buyerId;
    transfer.status = 'AWAITING_PAYMENT';
    transfer.claimedAt = now;
    transfer.lockExpiresAt = new Date(now.getTime() + PUBLIC_CLAIM_WINDOW_MS);
    transfer.claimAttemptCount = Number(transfer.claimAttemptCount || 0) + 1;
    await transfer.save({ session });
    await session.commitTransaction();

    const [safeTransfer, wallet] = await Promise.all([
      marketplacePopulate(
        MembershipEntitlementTransfer.findById(transfer._id)
      ).lean(),
      walletService.getBalance(buyerId),
    ]);
    const populated = toMarketplaceItem(safeTransfer, buyerId);
    const totalDue =
      Number(populated.askingPrice || 0) + Number(populated.transferFee || 0);
    return {
      ...populated,
      walletBalance: Number(wallet.balance || 0),
      totalDue,
      shortfall: Math.max(0, totalDue - Number(wallet.balance || 0)),
    };
  } catch (cause) {
    await session.abortTransaction().catch(() => {});
    if (
      cause?.code === 112 ||
      cause?.codeName === 'WriteConflict' ||
      cause?.errorLabels?.includes?.('TransientTransactionError')
    ) {
      throw error(
        'This listing was claimed by another customer.',
        409,
        'LISTING_ALREADY_CLAIMED'
      );
    }
    throw cause;
  } finally {
    session.endSession();
  }
};

const rejectByAdmin = async (transferId, adminId, reason) => {
  const transfer = await MembershipEntitlementTransfer.findOneAndUpdate(
    { _id: transferId, status: 'PENDING_ADMIN' },
    {
      $set: {
        status: 'REJECTED',
        rejectedBy: adminId,
        rejectedAt: new Date(),
        rejectionReason: String(reason || '').trim(),
      },
    },
    { new: true }
  );
  if (!transfer) throw error('Transfer is not awaiting admin review.', 409);
  return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
};

const settleTransfer = async (transferId, recipientId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const transfer = await MembershipEntitlementTransfer.findOne({
      _id: transferId,
      toUserId: recipientId,
      status: 'AWAITING_PAYMENT',
      lockExpiresAt: { $gt: new Date() },
    }).session(session);
    if (!transfer) {
      throw error('Transfer payment window is closed.', 409, 'TRANSFER_LOCK_EXPIRED');
    }
    await assertRecipientCapacity(recipientId, session);
    await assertNoActiveSession(transfer.entitlementId, session);

    let recipientPayment = null;
    let senderCredit = null;
    if (transfer.askingPrice > 0) {
      recipientPayment = await walletService.debitWallet(
        recipientId,
        transfer.askingPrice,
        'Membership space transfer payment',
        {
          refSource: 'membership_transfer',
          refSourceId: transfer._id,
          idempotencyKey: `membership-transfer:${transfer._id}:price-out`,
          transactionType: 'TRANSFER_OUT',
          session,
        }
      );
      senderCredit = await walletService.creditWallet(
        transfer.fromUserId,
        transfer.askingPrice,
        'TRANSFER_IN',
        'Membership space transfer proceeds',
        {
          refSource: 'membership_transfer',
          refSourceId: transfer._id,
          idempotencyKey: `membership-transfer:${transfer._id}:price-in`,
          session,
        }
      );
    }
    let feePayment = null;
    if (transfer.transferFee > 0) {
      feePayment = await walletService.debitWallet(
        recipientId,
        transfer.transferFee,
        'Membership transfer processing fee',
        {
          refSource: 'membership_transfer',
          refSourceId: transfer._id,
          idempotencyKey: `membership-transfer:${transfer._id}:fee`,
          transactionType: 'TRANSFER_FEE',
          session,
        }
      );
    }
    const entitlement = await MembershipSlotEntitlement.findOneAndUpdate(
      {
        _id: transfer.entitlementId,
        ownerId: transfer.fromUserId,
        status: 'transfer_locked',
        transferCount: { $lt: 1 },
      },
      {
        $set: { ownerId: recipientId, status: 'active' },
        $inc: { transferCount: 1 },
      },
      { new: true, session }
    );
    if (!entitlement) throw error('Entitlement ownership changed.', 409);
    const slot = await Slot.findOneAndUpdate(
      {
        _id: entitlement.slotId,
        reservedByEntitlementId: entitlement._id,
        reservedFor: transfer.fromUserId,
      },
      { $set: { reservedFor: recipientId } },
      { new: true, session }
    );
    if (!slot) throw error('Reserved slot ownership changed.', 409);

    transfer.status = 'COMPLETED';
    transfer.completedAt = new Date();
    transfer.recipientWalletTransactionId = recipientPayment?.transaction?._id || null;
    transfer.senderWalletTransactionId = senderCredit?.transaction?._id || null;
    transfer.feeWalletTransactionId = feePayment?.transaction?._id || null;
    transfer.contractNumber = `MTR-${Date.now()}-${crypto.randomInt(1000, 10000)}`;
    const [fromUser, toUser, floor, ticketPackage] = await Promise.all([
      User.findById(transfer.fromUserId).select('username email').session(session).lean(),
      User.findById(recipientId).select('username email').session(session).lean(),
      ParkingFloor.findById(entitlement.floorId)
        .select('name floorNumber parkingLotID')
        .populate('parkingLotID', 'name address')
        .session(session)
        .lean(),
      TicketPackage.findById(entitlement.packageId).select('name type').session(session).lean(),
    ]);
    transfer.contractSnapshot = {
      contractNumber: transfer.contractNumber,
      entitlementId: entitlement._id,
      slotCode: entitlement.slotCode,
      floorId: entitlement.floorId,
      floor: floor
        ? { name: floor.name, floorNumber: floor.floorNumber }
        : null,
      parkingLot: floor?.parkingLotID
        ? { name: floor.parkingLotID.name, address: floor.parkingLotID.address }
        : null,
      package: ticketPackage
        ? { name: ticketPackage.name, type: ticketPackage.type }
        : null,
      fromUserId: transfer.fromUserId,
      toUserId: recipientId,
      fromUser: fromUser
        ? { username: fromUser.username, email: fromUser.email }
        : null,
      toUser: toUser
        ? { username: toUser.username, email: toUser.email }
        : null,
      reason: transfer.reason,
      askingPrice: transfer.askingPrice,
      transferFee: transfer.transferFee,
      totalDue: transfer.askingPrice + transfer.transferFee,
      paymentMethod: 'VALO Wallet',
      validFrom: entitlement.validFrom,
      expireAt: entitlement.expireAt,
      completedAt: transfer.completedAt,
    };
    await transfer.save({ session });
    await recomputeUserMembership(transfer.fromUserId, {
      session,
      rotateQr: true,
    });
    await recomputeUserMembership(recipientId, { session, rotateQr: true });
    await session.commitTransaction();
    if (transfer.mode === 'PUBLIC') {
      const completed = await marketplacePopulate(
        MembershipEntitlementTransfer.findById(transfer._id)
      ).lean();
      return {
        ...toMarketplaceItem(completed, recipientId),
        _id: completed._id,
      };
    }
    return populateTransfer(MembershipEntitlementTransfer.findById(transfer._id));
  } catch (cause) {
    await session.abortTransaction();
    throw cause;
  } finally {
    session.endSession();
  }
};

const listTransfers = async (userId, role, filters = {}) => {
  const query = role === 'admin'
    ? {}
    : { $or: [{ fromUserId: userId }, { toUserId: userId }] };
  if (filters.status) query.status = filters.status;
  if (filters.mode && ['DIRECT', 'PUBLIC'].includes(normalizeMode(filters.mode))) {
    query.mode = normalizeMode(filters.mode);
  }
  return populateTransfer(MembershipEntitlementTransfer.find(query))
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
};

const valueOrFallback = (snapshotValue, liveValue) =>
  snapshotValue === undefined || snapshotValue === null || snapshotValue === ''
    ? liveValue
    : snapshotValue;

const buildTransferContractData = (transfer) => {
  const snapshot = transfer.contractSnapshot || {};
  const entitlement = transfer.entitlementId || {};
  const floor = snapshot.floor || entitlement.floorId || {};
  const parkingLot = snapshot.parkingLot || floor.parkingLotID || {};
  const ticketPackage = snapshot.package || entitlement.packageId || {};
  const fromUser = snapshot.fromUser || transfer.fromUserId || {};
  const toUser = snapshot.toUser || transfer.toUserId || {};
  const completedAt = valueOrFallback(snapshot.completedAt, transfer.completedAt);
  const askingPrice = valueOrFallback(snapshot.askingPrice, transfer.askingPrice);
  const transferFee = valueOrFallback(snapshot.transferFee, transfer.transferFee);
  const totalDue = valueOrFallback(
    snapshot.totalDue,
    Number(askingPrice || 0) + Number(transferFee || 0)
  );
  return {
    contractNumber: valueOrFallback(snapshot.contractNumber, transfer.contractNumber),
    completedAt,
    packageName: ticketPackage.name || ticketPackage.type,
    fromUser,
    toUser,
    parkingLot,
    floorName: floor.name || (
      floor.floorNumber !== undefined ? `Tầng ${floor.floorNumber}` : null
    ),
    slotCode: valueOrFallback(snapshot.slotCode, entitlement.slotCode),
    validFrom: valueOrFallback(snapshot.validFrom, entitlement.validFrom),
    expireAt: valueOrFallback(snapshot.expireAt, entitlement.expireAt),
    askingPrice,
    transferFee,
    totalDue,
    paymentMethod: snapshot.paymentMethod || (
      transfer.feeWalletTransactionId ? 'VALO Wallet' : null
    ),
  };
};

const buildTransferContractLines = (transfer) => {
  const data = buildTransferContractData(transfer);
  const lines = [
    'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
    'Độc lập – Tự do – Hạnh phúc',
    '',
    data.completedAt ? `Ngày ${formatDate(data.completedAt)}` : '',
    'HỢP ĐỒNG CHUYỂN NHƯỢNG QUYỀN SỬ DỤNG CHỖ ĐỖ XE',
    data.contractNumber
      ? `Số hợp đồng: ${data.contractNumber}`
      : '',
    data.packageName
      ? `Loại quyền: ${data.packageName}`
      : '',
    '',
    'BÊN CHUYỂN NHƯỢNG (BÊN A)',
    data.fromUser.username ? `Họ và tên/Tên tài khoản: ${data.fromUser.username}` : '',
    data.fromUser.email ? `Email: ${data.fromUser.email}` : '',
    '',
    'BÊN NHẬN CHUYỂN NHƯỢNG (BÊN B)',
    data.toUser.username ? `Họ và tên/Tên tài khoản: ${data.toUser.username}` : '',
    data.toUser.email ? `Email: ${data.toUser.email}` : '',
    '',
    'Hai bên tự nguyện thỏa thuận và đồng ý ký kết hợp đồng với các điều khoản sau:',
    '',
    'ĐIỀU 1: ĐỐI TƯỢNG CỦA HỢP ĐỒNG',
    data.parkingLot.name ? `Bãi đỗ xe: ${data.parkingLot.name}` : '',
    data.parkingLot.address ? `Vị trí bãi: ${data.parkingLot.address}` : '',
    data.floorName ? `Tầng: ${data.floorName}` : '',
    data.slotCode ? `Chỗ đỗ xe: ${data.slotCode}` : '',
    data.validFrom ? `Hiệu lực từ: ${formatDate(data.validFrom)}` : '',
    data.expireAt ? `Hiệu lực đến: ${formatDate(data.expireAt)}` : '',
    '',
    'ĐIỀU 2: GIÁ CHUYỂN NHƯỢNG VÀ THANH TOÁN',
    data.askingPrice !== undefined && data.askingPrice !== null
      ? `Giá chuyển nhượng: ${formatCurrency(data.askingPrice)}`
      : '',
    data.transferFee !== undefined && data.transferFee !== null
      ? `Phí xử lý: ${formatCurrency(data.transferFee)}`
      : '',
    data.totalDue !== undefined && data.totalDue !== null
      ? `Tổng thanh toán của Bên B: ${formatCurrency(data.totalDue)}`
      : '',
    data.paymentMethod
      ? `Phương thức thanh toán: ${data.paymentMethod}`
      : '',
    data.completedAt ? `Thanh toán hoàn tất: ${formatDate(data.completedAt)}` : '',
  ];

  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '');
};

const generateTransferPdf = async (transferId, userId, role) => {
  const transfer = await populateTransfer(
    MembershipEntitlementTransfer.findById(transferId)
  ).lean();
  if (!transfer || transfer.status !== 'COMPLETED') {
    throw error('Completed transfer contract not found.', 404);
  }
  if (
    role !== 'admin' &&
    ![transfer.fromUserId?._id, transfer.toUserId?._id]
      .map(String)
      .includes(String(userId))
  ) {
    throw error('You cannot access this contract.', 403);
  }
  return buildTransferAgreementPdf(buildTransferContractData(transfer));
};

const releaseExpiredTransferLocks = async (now = new Date()) => {
  const transfers = await MembershipEntitlementTransfer.find({
    status: 'AWAITING_PAYMENT',
    lockExpiresAt: { $lte: now },
  }).select('_id entitlementId fromUserId mode listingExpiresAt');
  let released = 0;
  for (const transfer of transfers) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const shouldRelist = getExpiredTransferResolution(transfer, now) === 'RELIST';
      const closed = await MembershipEntitlementTransfer.findOneAndUpdate(
        {
          _id: transfer._id,
          status: 'AWAITING_PAYMENT',
          lockExpiresAt: { $lte: now },
        },
        shouldRelist
          ? {
              $set: {
                status: 'LISTED',
                toUserId: null,
                claimedAt: null,
                lockExpiresAt: null,
              },
            }
          : { $set: { status: 'EXPIRED', lockExpiresAt: null } },
        { new: true, session }
      );
      if (!closed) {
        await session.abortTransaction();
        continue;
      }
      await MembershipSlotEntitlement.updateOne(
        {
          _id: transfer.entitlementId,
          ownerId: transfer.fromUserId,
          status: 'transfer_locked',
        },
        { $set: { status: 'active' } },
        { session }
      );
      await session.commitTransaction();
      released += 1;
    } catch (cause) {
      await session.abortTransaction();
      throw cause;
    } finally {
      session.endSession();
    }
  }
  await MembershipEntitlementTransfer.updateMany(
    {
      mode: 'PUBLIC',
      status: 'LISTED',
      listingExpiresAt: { $lte: now },
    },
    { $set: { status: 'EXPIRED' } }
  );
  return released;
};

module.exports = {
  OPEN_STATUSES,
  calculateTransferPricing,
  toMarketplaceItem,
  getExpiredTransferResolution,
  buildTransferContractData,
  buildTransferContractLines,
  createTransfer,
  searchTransferRecipients,
  acceptTransfer,
  rejectTransfer,
  cancelTransfer,
  approveTransfer,
  rejectByAdmin,
  listMarketplace,
  getMarketplaceListing,
  claimMarketplaceListing,
  settleTransfer,
  listTransfers,
  generateTransferPdf,
  releaseExpiredTransferLocks,
};

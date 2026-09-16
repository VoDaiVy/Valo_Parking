const Booking = require('../models/Booking');
const Policy = require('../models/Policy');
const RefundRuleVersion = require('../models/RefundRuleVersion');
const { cloneLegacyRefundRule } = require('./refundLegacyDefaults');
const { normalizeRule } = require('./refundEngine');
const voucherService = require('./voucherService');

const withSession = (query, session) => (session ? query.session(session) : query);

const getEffectiveRefundPolicySnapshot = async ({ session } = {}) => {
  const policy = await withSession(
    Policy.findOne({
      controlsBookingRefunds: true,
      category: 'refund',
      status: 'published',
      deletedAt: null,
      currentVersionId: { $ne: null },
    }).lean(),
    session
  );

  if (!policy) {
    return {
      source: 'legacy-v1',
      policyId: null,
      policyVersionId: null,
      policyVersionNumber: null,
      refundRuleVersionId: null,
      capturedAt: new Date(),
      rule: normalizeRule(cloneLegacyRefundRule()),
    };
  }

  const refundRule = await withSession(
    RefundRuleVersion.findOne({
      policyId: policy._id,
      policyVersionId: policy.currentVersionId,
      status: 'published',
    }).lean(),
    session
  );

  if (!refundRule) {
    return {
      source: 'legacy-v1',
      policyId: policy._id,
      policyVersionId: policy.currentVersionId,
      policyVersionNumber: policy.currentVersionNumber,
      refundRuleVersionId: null,
      capturedAt: new Date(),
      rule: normalizeRule(cloneLegacyRefundRule()),
    };
  }

  return {
    source: 'published-rule',
    policyId: policy._id,
    policyVersionId: policy.currentVersionId,
    policyVersionNumber: policy.currentVersionNumber,
    refundRuleVersionId: refundRule._id,
    capturedAt: new Date(),
    rule: normalizeRule(refundRule),
  };
};

const buildPaymentBreakdown = (booking, input = {}) => {
  const totalAmount = Math.max(0, Math.floor(Number(booking.prepaidAmount) || 0));
  const explicitServiceAmount = Math.max(0, Math.floor(Number(input.serviceAmount) || 0));
  const serviceAmount = Math.min(explicitServiceAmount, totalAmount);
  const explicitParkingAmount =
    input.parkingAmount === undefined
      ? totalAmount - serviceAmount
      : Math.max(0, Math.floor(Number(input.parkingAmount) || 0));
  const parkingAmount = Math.min(explicitParkingAmount, totalAmount - serviceAmount);

  return {
    parkingAmount,
    serviceAmount,
    totalAmount,
    source: input.source || 'calculated',
    dynamicMultiplier: Number(input.dynamicMultiplier
      ?? booking.paymentBreakdownSnapshot?.dynamicMultiplier
      ?? 1),
    busynessScore: input.busynessScore
      ?? booking.paymentBreakdownSnapshot?.busynessScore
      ?? null,
    adjustedTotal: Number(input.adjustedTotal
      ?? booking.paymentBreakdownSnapshot?.adjustedTotal
      ?? totalAmount),
    voucherId: input.voucherId
      ?? booking.paymentBreakdownSnapshot?.voucherId
      ?? null,
    voucherDiscount: input.voucherDiscount
      ?? booking.paymentBreakdownSnapshot?.voucherDiscount
      ?? null,
    discountedTotal: input.discountedTotal
      ?? booking.paymentBreakdownSnapshot?.discountedTotal
      ?? null,
  };
};

const attachPaidBookingSnapshots = async (booking, input = {}) => {
  if (booking.refundPolicySnapshot?.source && booking.paymentBreakdownSnapshot?.source) {
    return booking;
  }

  const snapshot =
    input.refundPolicySnapshot ||
    (await getEffectiveRefundPolicySnapshot({ session: input.session }));

  booking.paymentBreakdownSnapshot = buildPaymentBreakdown(booking, input);
  booking.refundPolicySnapshot = snapshot;
  await booking.save(input.session ? { session: input.session } : undefined);
  return booking;
};

const transitionPendingBookingToPaid = async (booking, input = {}) => {
  if (booking.status === 'PAID') {
    return { booking, transitioned: false };
  }

  const refundPolicySnapshot =
    input.refundPolicySnapshot ||
    (await getEffectiveRefundPolicySnapshot({ session: input.session }));
  const paymentBreakdownSnapshot = buildPaymentBreakdown(booking, input);
  const query = Booking.findOneAndUpdate(
    { _id: booking._id, status: 'PENDING' },
    {
      $set: {
        status: 'PAID',
        paymentBreakdownSnapshot,
        refundPolicySnapshot,
      },
    },
    { new: true, runValidators: true }
  );
  if (input.session) query.session(input.session);

  const updated = await query;
  if (updated) {
    await voucherService.markVoucherUsed({ bookingId: updated._id, session: input.session });
    return { booking: updated, transitioned: true };
  }

  const currentQuery = Booking.findById(booking._id);
  if (input.session) currentQuery.session(input.session);
  const current = await currentQuery;
  if (!current) {
    throw Object.assign(new Error('Booking not found'), { statusCode: 404 });
  }
  return { booking: current, transitioned: false };
};

module.exports = {
  attachPaidBookingSnapshots,
  buildPaymentBreakdown,
  getEffectiveRefundPolicySnapshot,
  transitionPendingBookingToPaid,
};

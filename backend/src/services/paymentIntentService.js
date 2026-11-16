const PaymentIntent = require('../models/PaymentIntent');

const normalizeIdempotencyKey = (value, fallback) => {
  const key = String(value || fallback || '').trim();
  if (!key) {
    throw Object.assign(new Error('Idempotency-Key is required'), {
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }
  if (key.length > 128) {
    throw Object.assign(new Error('Idempotency-Key is too long'), {
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_TOO_LONG',
    });
  }
  return key;
};

const generateProviderOrderCode = () => {
  const timestampPart = Date.now().toString().slice(-8);
  const randomPart = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return Number(`${timestampPart}${randomPart}`);
};

const createKioskPaymentIntent = async ({
  session,
  amount,
  idempotencyKey,
  provider = 'PAYOS',
  metadata = null,
  cashReceivedAmount = null,
  changeAmount = null,
  confirmedBy = null,
}) => {
  const key = normalizeIdempotencyKey(
    idempotencyKey,
    `kiosk-checkout:${session._id}:${amount}`
  );

  const existing = await PaymentIntent.findOne({
    purpose: 'KIOSK_CHECKOUT',
    idempotencyKey: key,
  });

  if (existing) {
    const isExpired = Boolean(
      ['EXPIRED', 'CANCELLED'].includes(existing.status)
      || (provider === 'PAYOS'
          && ['CREATED', 'PENDING'].includes(existing.status)
          && existing.expiresAt
          && existing.expiresAt <= new Date())
    );

    if (isExpired) {
      existing.status = 'CREATED';
      existing.provider = provider;
      existing.amount = amount;
      existing.providerOrderCode = provider === 'PAYOS' ? generateProviderOrderCode() : null;
      existing.providerPaymentLinkId = null;
      existing.checkoutUrl = null;
      existing.qrCode = null;
      existing.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      existing.metadata = metadata || existing.metadata;
      existing.cashReceivedAmount = cashReceivedAmount;
      existing.changeAmount = changeAmount;
      existing.confirmedBy = confirmedBy;
      await existing.save();
      return existing;
    }

    if (
      existing.sessionId?.toString() !== session._id.toString()
      || existing.amount !== amount
      || existing.provider !== provider
      || (provider === 'CASH' && cashReceivedAmount !== null && existing.cashReceivedAmount !== cashReceivedAmount)
    ) {
      throw Object.assign(new Error('Idempotency key is already used for another payment'), {
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
    return existing;
  }

  try {
    return await PaymentIntent.create({
      purpose: 'KIOSK_CHECKOUT',
      sessionId: session._id,
      userId: session.userId || null,
      provider,
      amount,
      status: 'CREATED',
      idempotencyKey: key,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      providerOrderCode: provider === 'PAYOS' ? generateProviderOrderCode() : null,
      metadata,
      cashReceivedAmount,
      changeAmount,
      confirmedBy,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concurrentIntent = await PaymentIntent.findOne({
      purpose: 'KIOSK_CHECKOUT',
      idempotencyKey: key,
    });
    if (!concurrentIntent) throw error;
    return concurrentIntent;
  }
};

const attachProviderPayment = async (intent, paymentLink) => {
  intent.status = 'PENDING';
  intent.providerPaymentLinkId = paymentLink.paymentLinkId || null;
  intent.checkoutUrl = paymentLink.checkoutUrl || null;
  intent.qrCode = paymentLink.qrCode || null;
  await intent.save();
  return intent;
};

const markPaymentIntentPaid = async ({ orderCode, amount, reference = null }) => {
  const intent = await PaymentIntent.findOne({
    purpose: 'KIOSK_CHECKOUT',
    provider: 'PAYOS',
    providerOrderCode: Number(orderCode),
  });

  if (!intent) return null;
  if (Number(intent.amount) !== Number(amount)) {
    throw Object.assign(new Error('Payment amount does not match the payment intent'), {
      statusCode: 400,
      code: 'PAYMENT_AMOUNT_MISMATCH',
    });
  }

  if (['PAID', 'SETTLED'].includes(intent.status)) return intent;

  intent.status = 'PAID';
  intent.paidAt = intent.paidAt || new Date();
  intent.providerReference = reference || intent.providerReference;
  await intent.save();
  return intent;
};

const markPaymentIntentPaidById = async ({ intentId, amount, reference = null, confirmedBy = null }) => {
  const intent = await PaymentIntent.findOne({
    _id: intentId,
    purpose: 'KIOSK_CHECKOUT',
  });

  if (!intent) return null;
  if (Number(intent.amount) !== Number(amount)) {
    throw Object.assign(new Error('Payment amount does not match the payment intent'), {
      statusCode: 400,
      code: 'PAYMENT_AMOUNT_MISMATCH',
    });
  }
  if (['PAID', 'SETTLED'].includes(intent.status)) return intent;

  intent.status = 'PAID';
  intent.paidAt = intent.paidAt || new Date();
  intent.providerReference = reference || intent.providerReference;
  if (confirmedBy) intent.confirmedBy = confirmedBy;
  if (intent.provider === 'CASH') intent.confirmedAt = intent.confirmedAt || new Date();
  await intent.save();
  return intent;
};

const markPaymentIntentSettled = async (intentId) => {
  return PaymentIntent.findOneAndUpdate(
    { _id: intentId, status: 'PAID' },
    { $set: { status: 'SETTLED', settledAt: new Date() } },
    { new: true }
  );
};

module.exports = {
  normalizeIdempotencyKey,
  createKioskPaymentIntent,
  attachProviderPayment,
  markPaymentIntentPaid,
  markPaymentIntentPaidById,
  markPaymentIntentSettled,
};

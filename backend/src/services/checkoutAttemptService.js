const crypto = require('crypto');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const payos = require('../config/payos');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const verifyProviderPayment = (attempt, provider) => {
  if (!provider || provider.status !== 'PAID' || Number(provider.orderCode) !== attempt.orderCode || Number(provider.amount) !== attempt.amountDue || Number(provider.amountPaid) !== attempt.amountDue || Number(provider.amountRemaining || 0) !== 0) throw fail('Payment has not been verified for this checkout', 402);
};
const attemptResponse = (attempt) => ({ checkoutAttemptId: attempt._id, orderCode: attempt.orderCode, qrCode: attempt.qrCode, checkoutUrl: attempt.checkoutUrl });
const provisionAttempt = async (attempt) => {
  const payment = await payos.paymentRequests.create({ orderCode: attempt.orderCode, amount: attempt.amountDue, description: 'VALO Checkout', returnUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/kiosk/checkout-success`, cancelUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/kiosk/checkout-cancel`, expiredAt: Math.floor(attempt.expiresAt.getTime() / 1000) });
  attempt.qrCode = payment.qrCode;
  attempt.checkoutUrl = payment.checkoutUrl;
  await CheckoutAttempt.updateOne({ _id: attempt._id }, { $set: { qrCode: attempt.qrCode, checkoutUrl: attempt.checkoutUrl } });
  return attemptResponse(attempt);
};
const createAttempt = async ({ sessionId, amountDue, quoteTime }) => {
  const existing = await CheckoutAttempt.findOne({ sessionId, status: { $in: ['pending', 'paid'] } });
  if (existing) {
    let provider;
    try { provider = await payos.paymentRequests.get(existing.orderCode); }
    catch (err) {
      // Only a definitive provider not-found response permits recreating this SAME order.
      if (![err.status, err.statusCode].includes(404)) throw err;
      existing.expiresAt = new Date(Date.now() + 15 * 60000);
      await CheckoutAttempt.updateOne({ _id: existing._id }, { $set: { expiresAt: existing.expiresAt } });
      return provisionAttempt(existing);
    }
    if (!provider) throw fail('Payment provider returned an uncertain response', 503);
    if (!existing.checkoutUrl && /^[a-f0-9]{32}$/i.test(provider.id || '')) {
      // The provider order exists but the create response was lost. Recover a checkout-page QR.
      existing.checkoutUrl = `https://pay.payos.vn/web/${provider.id}`;
      existing.qrCode = existing.checkoutUrl;
      await CheckoutAttempt.updateOne({ _id: existing._id }, { $set: { checkoutUrl: existing.checkoutUrl, qrCode: existing.qrCode } });
    }
    if (provider.status === 'PAID') {
      verifyProviderPayment(existing, provider);
      await CheckoutAttempt.updateOne({ _id: existing._id, status: 'pending' }, { $set: { status: 'paid' } });
      return attemptResponse(existing);
    }
    if (existing.expiresAt > new Date() && existing.amountDue === amountDue) {
      if (!existing.checkoutUrl) throw fail('Payment exists but link recovery is unavailable; retry verification', 503);
      return attemptResponse(existing);
    }
    const cancelled = await payos.paymentRequests.cancel(existing.orderCode);
    if (cancelled.status === 'PAID') throw fail('Payment completed during cancellation; verify the existing checkout');
    if (cancelled.status !== 'CANCELLED') throw fail('Old payment cancellation is not confirmed', 503);
    await CheckoutAttempt.updateOne({ _id: existing._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  }
  const orderCode = Date.now() * 100 + crypto.randomInt(100);
  let attempt;
  try { attempt = await CheckoutAttempt.create({ sessionId, amountDue, orderCode, quoteTime, expiresAt: new Date(Date.now() + 15 * 60000) }); }
  catch (err) {
    if (err.code === 11000) throw fail('A checkout payment is already being prepared; retry the same ticket');
    throw err;
  }
  return provisionAttempt(attempt);
};
const verifyAttempt = async ({ attemptId, sessionId }) => {
  const attempt = await CheckoutAttempt.findById(attemptId);
  if (!attempt || String(attempt.sessionId) !== String(sessionId) || attempt.status === 'settled') throw fail('Checkout attempt is unavailable');
  const provider = await payos.paymentRequests.get(attempt.orderCode);
  verifyProviderPayment(attempt, provider);
  await CheckoutAttempt.updateOne({ _id: attempt._id, status: 'pending' }, { $set: { status: 'paid' } });
  return attempt;
};
module.exports = { createAttempt, verifyAttempt, verifyProviderPayment };

const { generateOrderCode, ensurePaymentLink } = require('./payosOrderService');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const crypto = require('crypto');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const payos = require('../config/payos');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const verifyProviderPayment = (attempt, provider) => {
  if (!['pending', 'paid'].includes(attempt.status) || !provider || provider.status !== 'PAID' || Number(provider.orderCode) !== attempt.orderCode || Number(provider.amount) !== attempt.amountDue || Number(provider.amountPaid) !== attempt.amountDue || Number(provider.amountRemaining || 0) !== 0) throw fail('Payment has not been verified for this checkout', 402);
};
const attemptResponse = (attempt) => ({ keepPaused: attempt.settlementQuote?.keepPaused, checkoutAttemptId: attempt._id, orderCode: attempt.orderCode, qrCode: attempt.qrCode, checkoutUrl: attempt.checkoutUrl, amountDue: attempt.amountDue, pricingBreakdown: attempt.pricingBreakdown });
const provisionAttempt = async (attempt) => {
  const payment = await ensurePaymentLink({ orderCode: attempt.orderCode, amount: attempt.amountDue, description: 'VALO Checkout', returnUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/kiosk/checkout-success`, cancelUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/kiosk/checkout-cancel`, expiredAt: Math.floor(attempt.expiresAt.getTime() / 1000) });
  attempt.qrCode = payment.qrCode;
  attempt.checkoutUrl = payment.checkoutUrl;
  await CheckoutAttempt.updateOne({ _id: attempt._id }, { $set: { qrCode: attempt.qrCode, checkoutUrl: attempt.checkoutUrl } });
  return attemptResponse(attempt);
};
const createAttempt = async ({ sessionId, amountDue, quoteTime, pricingBreakdown, settlementQuote }) => {
  const existing = await CheckoutAttempt.findOne({ sessionId, status: { $in: ['pending', 'paid'] } });
  if (existing) {
    let provider;
    try { provider = await payos.paymentRequests.get(existing.orderCode); }
    catch (err) {
      // Only a definitive provider not-found response permits recreating this SAME order.
      if (![err.status, err.statusCode].includes(404) || existing.status !== 'pending') throw err;
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
    if (['PENDING', 'PROCESSING', 'UNDERPAID'].includes(provider.status) && (existing.expiresAt > new Date() || Number(provider.amountPaid) > 0 || ['PROCESSING', 'UNDERPAID'].includes(provider.status))) {
      if (!existing.checkoutUrl) throw fail('Payment exists but link recovery is unavailable; retry verification', 503);
      return attemptResponse(existing);
    }
    if (existing.status === 'paid') throw fail('A confirmed payment needs reconciliation before another payment can be created');
    // A terminal unpaid order is already closed at the provider.
    const terminalUnpaid = ['CANCELLED', 'EXPIRED', 'FAILED'].includes(provider.status) && Number(provider.amountPaid) === 0;
    if (Number(provider.amountPaid) > 0) throw fail('A partially paid checkout requires payment reconciliation before a new QR can be created');
    const cancelled = terminalUnpaid ? { status: 'CANCELLED' } : await payos.paymentRequests.cancel(existing.orderCode);
    if (cancelled.status === 'PAID') throw fail('Payment completed during cancellation; verify the existing checkout');
    if (cancelled.status !== 'CANCELLED') throw fail('Old payment cancellation is not confirmed', 503);
    await CheckoutAttempt.updateOne({ _id: existing._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  }
  const orderCode = generateOrderCode('checkout');
  let attempt;
  const transaction = await mongoose.startSession();
  try {
    await transaction.withTransaction(async () => {
      const active = await Session.findOneAndUpdate({ _id: sessionId, status: 'active' }, { $inc: { checkoutQuoteVersion: 1 } }, { new: true, session: transaction });
      if (!active) throw fail('This parking session is already checked out.');
      if (await CheckoutAttempt.exists({ sessionId, status: { $in: ['pending', 'paid'] } }).session(transaction)) throw fail('A bank payment is already being prepared. Retry the same checkout.');
      [attempt] = await CheckoutAttempt.create([{ sessionId, amountDue, orderCode, quoteTime, pricingBreakdown, settlementQuote, quoteVersion: active.checkoutQuoteVersion, expiresAt: new Date(Date.now() + 15 * 60000) }], { session: transaction });
    });
  }
  catch (err) {
    if (err.code === 11000) throw fail('A checkout payment is already being prepared; retry the same ticket');
    throw err;
  } finally { await transaction.endSession(); }
  return provisionAttempt(attempt);
};
const verifyAttempt = async ({ attemptId, sessionId }) => {
  if (!mongoose.isValidObjectId(attemptId)) throw fail('A valid checkout payment reference is required', 400);
  const attempt = await CheckoutAttempt.findById(attemptId);
  if (!attempt || String(attempt.sessionId) !== String(sessionId) || !['pending', 'paid'].includes(attempt.status)) throw fail('Checkout attempt is unavailable');
  const provider = await payos.paymentRequests.get(attempt.orderCode);
  verifyProviderPayment(attempt, provider);
  const pricing = attempt.pricingBreakdown;
  if (pricing?.pricingVersion && (!pricing.pricingConfigSnapshot || crypto.createHash('sha256').update(JSON.stringify(pricing.pricingConfigSnapshot)).digest('hex') !== pricing.pricingVersion)) throw fail('The stored pricing version does not match the payment quote');
  const paid = await CheckoutAttempt.findOneAndUpdate({ _id: attempt._id, status: { $in: ['pending', 'paid'] } }, { $set: { status: 'paid' } }, { new: true });
  if (!paid) throw fail('Checkout attempt is no longer available');
  const active = await Session.exists({ _id: sessionId, status: 'active', ...(paid.quoteVersion != null ? { checkoutQuoteVersion: paid.quoteVersion } : {}) });
  if (!active) throw fail('The payment quote is no longer current for this session');
  return paid;
};
module.exports = { createAttempt, verifyAttempt, verifyProviderPayment };

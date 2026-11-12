const crypto = require('crypto');
const lastOrders = new Map();
function generateOrderCode(kind) {
  const namespace = { purchase: 100, subscriptionRenewal: 200, entitlementRenewal: 300, checkout: 400 }[kind];
  if (!namespace) throw new Error('Unknown payment order namespace');
  const base = Date.now() * 1000 + namespace;
  const previous = lastOrders.get(kind) || 0;
  const code = Math.max(base + crypto.randomInt(100), previous + 1);
  if (code >= base + 100) throw Object.assign(new Error('Payment creation is busy. Retry the same request.'), { statusCode: 503 });
  lastOrders.set(kind, code);
  return code;
}

const payos = require('../config/payos');

// Reuse the durable order code after an uncertain create response. The GET
// contract has an id but no checkoutUrl/qrCode (PayOS SDK v2).
async function ensurePaymentLink(request) {
  let payment;
  try {
    payment = await payos.paymentRequests.create(request);
  } catch (createError) {
    try { payment = await payos.paymentRequests.get(request.orderCode); }
    catch { throw createError; }
  }
  if (!payment || Number(payment.orderCode) !== request.orderCode || Number(payment.amount) !== request.amount) {
    throw Object.assign(new Error('Payment provider returned a different order or amount.'), { statusCode: 409, code: 'PAYMENT_MISMATCH' });
  }
  if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(payment.status)) {
    throw Object.assign(new Error('This payment order is closed. Verify its final status before starting another payment.'), { statusCode: 409, code: 'PAYMENT_ORDER_CLOSED' });
  }
  const paymentLinkId = payment.paymentLinkId || payment.id;
  const checkoutUrl = payment.checkoutUrl || (/^[a-f0-9]{32}$/i.test(paymentLinkId || '') ? `https://pay.payos.vn/web/${paymentLinkId}` : null);
  if (!checkoutUrl) throw Object.assign(new Error('Payment link recovery is unavailable. Retry the same order.'), { statusCode: 503 });
  return { ...payment, paymentLinkId, checkoutUrl, qrCode: payment.qrCode || checkoutUrl };
}

module.exports = { ensurePaymentLink, generateOrderCode };

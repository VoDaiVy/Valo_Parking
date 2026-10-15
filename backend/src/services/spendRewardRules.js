const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MONEY = 1000000000;
const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const monthOf = (date) => {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) fail('Invalid reward transaction date');
  return new Date(time + 7 * 3600000).toISOString().slice(0, 7);
};
const validateProgram = (input) => {
  if (!input || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.revision) || input.revision < 0) fail('Invalid program settings or revision');
  const validityDays = input.validityDays === undefined ? 7 : input.validityDays;
  if (!Number.isSafeInteger(validityDays) || validityDays < 1 || validityDays > 365) fail('Voucher validity must be between 1 and 365 days');
  if (!Array.isArray(input.tiers) || input.tiers.length < 1 || input.tiers.length > 10) fail('Configure between 1 and 10 spending milestones');
  const tiers = input.tiers.map((tier) => {
    if (!tier || typeof tier !== 'object') fail('Invalid milestone');
    const result = {};
    for (const key of ['threshold', 'discountAmount', 'minimumAmount']) {
      const value = tier[key];
      if (!Number.isSafeInteger(value) || value < 1000 || value > MAX_MONEY) fail('Amounts must be whole VND from 1,000 to 1,000,000,000');
      result[key] = value;
    }
    if (result.discountAmount > result.minimumAmount) fail('Discount cannot exceed the minimum order amount');
    return result;
  }).sort((a, b) => a.threshold - b.threshold);
  if (new Set(tiers.map((tier) => tier.threshold)).size !== tiers.length) fail('Spending milestones must be unique');
  return { enabled: input.enabled, validityDays, tiers };
};
const selectTier = (tiers, total, highest) => [...tiers].sort((a, b) => b.threshold - a.threshold)
  .find((tier) => tier.threshold <= total && tier.threshold > highest) || null;
const money = (value) => {
  const amount = Number(value || 0);
  if (!Number.isSafeInteger(amount) || amount < 0) fail('Invalid settled payment amount');
  return amount;
};
const bookingSpend = (booking) => {
  const paidStatuses = ['PAID', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED'];
  if (!paidStatuses.includes(booking.status) && !(booking.status === 'CANCELLED' && booking.paidAt)) return 0;
  const overage = (booking.paidOverageAdjustments || []).reduce((sum, item) => sum + money(item.amount), 0);
  const walletNet = (booking.refundSettlements || []).reduce((sum, item) => {
    if (!['credited', 'debited'].includes(item.payoutStatus)) return sum;
    return sum + Number(item.netWalletAmount || 0);
  }, 0);
  return Math.max(0, money(booking.prepaidAmount) + overage - walletNet);
};
module.exports = { WEEK_MS, monthOf, validateProgram, selectTier, bookingSpend, money };

const Session = require('../models/Session');

/**
 * Clean and normalize phone number string
 * @param {string} rawPhone
 * @returns {string} Normalized 10-digit phone (starting with 0) or cleaned string
 */
function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  const clean = rawPhone.trim().replace(/[\s.-]/g, '');
  if (!clean) return '';

  // Convert +84xxxxxxxxx or 84xxxxxxxxx to 0xxxxxxxxx
  if (/^\+84\d{9}$/.test(clean)) {
    return '0' + clean.slice(3);
  }
  if (/^84\d{9}$/.test(clean)) {
    return '0' + clean.slice(2);
  }
  return clean;
}

/**
 * Generate all common formats of a phone number for flexible database querying
 * @param {string} rawPhone
 * @returns {string[]} Array of phone number variants
 */
function getPhoneVariants(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return [];
  const clean = rawPhone.trim().replace(/[\s.-]/g, '');
  if (!clean) return [];

  const variants = new Set([clean, rawPhone.trim()]);
  const standard = normalizePhone(rawPhone);
  if (standard) {
    variants.add(standard);
    if (/^0\d{9}$/.test(standard)) {
      const suffix = standard.slice(1);
      variants.add(`+84${suffix}`);
      variants.add(`84${suffix}`);
    }
  }

  return Array.from(variants);
}

/**
 * Claim all unlinked/orphan sessions matching a phone number to a specific user
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} rawPhone
 * @returns {Promise<number>} Number of claimed sessions
 */
async function claimUserSessionsByPhone(userId, rawPhone) {
  if (!userId || !rawPhone) return 0;
  const variants = getPhoneVariants(rawPhone);
  if (!variants.length) return 0;

  const result = await Session.updateMany(
    {
      phone: { $in: variants },
      $or: [{ userId: null }, { userId: { $exists: false } }],
    },
    { $set: { userId } }
  );

  return result.modifiedCount || 0;
}

module.exports = {
  normalizePhone,
  getPhoneVariants,
  claimUserSessionsByPhone,
};

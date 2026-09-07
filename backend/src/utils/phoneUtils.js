const Session = require('../models/Session');

/**
 * Clean and normalize phone number string to standard 10-digit Vietnamese format (e.g. 0905414132)
 * @param {string} rawPhone
 * @returns {string}
 */
function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';

  // 84905414132 -> 0905414132
  if (digits.startsWith('84') && digits.length === 11) {
    return '0' + digits.slice(2);
  }
  // 905414132 (9 digits) -> 0905414132
  if (digits.length === 9) {
    return '0' + digits;
  }
  // 0905414132 (10 digits starting with 0)
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }
  return digits;
}

/**
 * Generate regex for flexible matching across spaces, dashes, dots, and prefixes
 * @param {string} rawPhone
 * @returns {RegExp|null}
 */
function getPhoneRegex(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const significantDigits = digits.length >= 9 ? digits.slice(-9) : digits;
  const regexPattern = '(?:\\+?84|0)?[\\s.-]*' + significantDigits.split('').join('[\\s.-]*') + '$';
  return new RegExp(regexPattern, 'i');
}

/**
 * Generate all common string formats of a phone number for database querying
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
      variants.add(suffix);
    }
  }

  return Array.from(variants);
}

/**
 * Build MongoDB query conditions for flexible phone search (combines exact variants + regex)
 * @param {string} rawPhone
 * @returns {object[]} Array of MongoDB query condition objects
 */
function getPhoneSearchConditions(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return [];
  const conditions = [];
  const variants = getPhoneVariants(rawPhone);
  if (variants.length) {
    conditions.push({ phone: { $in: variants } });
  }

  const regex = getPhoneRegex(rawPhone);
  if (regex) {
    conditions.push({ phone: regex });
  }

  return conditions;
}

/**
 * Claim all unlinked/orphan sessions matching a phone number to a specific user
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} rawPhone
 * @returns {Promise<number>} Number of claimed sessions
 */
async function claimUserSessionsByPhone(userId, rawPhone) {
  if (!userId || !rawPhone) return 0;
  const conditions = getPhoneSearchConditions(rawPhone);
  if (!conditions.length) return 0;

  const phoneQuery = conditions.length === 1 ? conditions[0] : { $or: conditions };

  const result = await Session.updateMany(
    {
      $and: [
        phoneQuery,
        {
          $or: [
            { userId: null },
            { userId: { $exists: false } },
            { userId: { $ne: userId } },
          ],
        },
      ],
    },
    { $set: { userId } }
  );

  return result.modifiedCount || 0;
}

module.exports = {
  normalizePhone,
  getPhoneRegex,
  getPhoneVariants,
  getPhoneSearchConditions,
  claimUserSessionsByPhone,
};

const UserDetail = require('../models/UserDetail');
const Link = require('../models/TelegramLink');
const Claim = require('../models/TelegramClaimToken');
const Delivery = require('../models/TelegramDelivery');
const EventDelivery = require('../models/TelegramEventDelivery');
const { normalizePhone } = require('../utils/phoneUtils');

const validPhone = phone => /^0\d{9}$/.test(normalizePhone(phone));
async function profilePhone(userId, session) {
  const profile = await UserDetail.findOne({ userId }).select('phone').session(session || null);
  return normalizePhone(profile?.phone);
}
// A real write makes token/contact transactions conflict with a concurrent profile edit.
// A snapshot read alone would allow an old contact to be linked after the phone changed.
async function lockProfile(userId, session) {
  return UserDetail.findOneAndUpdate({ userId }, { $inc: { telegramLinkRevision: 1 } }, { new: true, session });
}
async function matchesProfile(link, session) {
  if (!link || !validPhone(link.phone)) return false;
  return normalizePhone(link.phone) === await profilePhone(link.userId, session);
}
async function revokeAccount(userId, session, errorCode = 'LINK_REVOKED') {
  const now = new Date();
  const link = await Link.findOneAndUpdate({ userId }, { $set: { revokedAt: now, notificationsEnabled: false } }, { session });
  await Claim.updateMany({ userId, purpose: 'link', consumedAt: null }, { $set: { revokedAt: now } }, { session });
  if (link) {
    for (const Model of [Delivery, EventDelivery]) {
      await Model.updateMany({ linkId: link._id, status: { $in: ['pending', 'processing', 'uncertain'] } },
        { $set: { status: 'cancelled', errorCode }, $unset: { leaseId: 1, leaseUntil: 1 } }, { session });
    }
  }
}
module.exports = { validPhone, profilePhone, lockProfile, matchesProfile, revokeAccount };

const mongoose = require('mongoose');
const User = require('../../models/User');
const UserDetail = require('../../models/UserDetail');
const { normalizePhone } = require('../../utils/phoneUtils');
function accountError(code, message, statusCode = 400) {
  const error = new Error(message); Object.assign(error, { code, statusCode, publicMessage: message }); return error;
}
function profilePayload(input) {
  const source = input?.profile && typeof input.profile === 'object' && !Array.isArray(input.profile) ? input.profile : input;
  const result = {};
  for (const key of ['firstName', 'lastName', 'phone']) {
    if (source?.[key] === undefined) continue;
    if (typeof source[key] !== 'string') throw accountError('INVALID_PROFILE', `${key === 'phone' ? 'Phone' : 'Name'} must be text.`);
    const value = source[key].trim();
    if (key === 'phone') {
      const phone = normalizePhone(value);
      if (value && (!/^[+\d\s().-]+$/.test(value) || !/^0[35789]\d{8}$/.test(phone))) throw accountError('INVALID_PHONE', 'Enter a valid Vietnamese phone number.');
      result.phone = phone;
    } else {
      if ((key === 'firstName' && !value) || value.length > 50 || (value && !/^[\p{L}\p{M}\s]+$/u.test(value))) throw accountError('INVALID_NAME', 'Names must contain letters and spaces, with at most 50 characters.');
      result[key] = value;
    }
  }
  if (!Object.keys(result).length) throw accountError('EMPTY_PROFILE', 'Specify a first name, last name, or phone to update.');
  return result;
}
async function assertPhoneAvailable(phone, userId, session) {
  if (!phone) return;
  const normalized = normalizePhone(phone);
  const pattern = new RegExp(`^(?:0|\\+?84)[\\s().-]*${normalized.slice(1).split('').join('[\\s().-]*')}$`);
  try {
    let query = UserDetail.exists({ phone: pattern, userId: { $ne: userId } });
    if (session) query = query.session(session);
    if (await query) throw accountError('PHONE_IN_USE', 'This phone number is already linked to another account. Choose a different phone number.');
  } catch (error) { error.approvalStage = 'PROFILE_PHONE_UNIQUENESS'; throw error; }
}
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const profileStages = [
  { $lookup: { from: UserDetail.collection.name, localField: '_id', foreignField: 'userId', as: 'profile', pipeline: [{ $project: { _id: 0, firstName: 1, lastName: 1, phone: 1 } }] } },
  { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
];
const select = { vipActive: { $and: [{ $eq: ['$membership.isVip', true] }, { $or: [{ $eq: [{ $ifNull: ['$membership.expireAt', null] }, null] }, { $gt: ['$membership.expireAt', '$$NOW'] }] }] }, _id: 1, username: 1, email: 1, role: 1, status: 1, membership: 1, createdAt: 1, updatedAt: 1, profile: 1 };
async function getAccount(id) {
  if (!mongoose.isValidObjectId(id)) throw accountError('INVALID_ACCOUNT', 'Invalid account identifier.');
  const rows = await User.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(String(id)) } }, ...profileStages, { $project: select }]);
  if (!rows[0]) throw accountError('ACCOUNT_NOT_FOUND', 'Account not found. No changes were made.', 404);
  return rows[0];
}
async function searchAccounts(args = {}) {
  const { query, role, status, vip, vipStatus, sortBy = 'createdAt', sortOrder = 'desc', matchMode = 'contains' } = args;
  if (role && !['guest', 'customer', 'staff', 'admin'].includes(role)) throw accountError('INVALID_ROLE', 'Choose a valid account role.');
  if (status !== undefined && typeof status !== 'boolean') throw accountError('INVALID_STATUS', 'Account status must be Active or Inactive.');
  if (vip !== undefined && typeof vip !== 'boolean') throw accountError('INVALID_VIP', 'VIP filter must be a boolean.');
  if (vip !== undefined && vipStatus && vip !== (vipStatus === 'active')) throw accountError('INVALID_VIP', 'Membership filters conflict.');
  if (vipStatus && !['active', 'expired', 'standard'].includes(vipStatus)) throw accountError('INVALID_VIP', 'Choose a valid membership filter.');
  if (!['createdAt', 'username', 'email', 'role', 'status', 'membership.expireAt'].includes(sortBy) || !['asc', 'desc'].includes(sortOrder) || !['contains', 'exact'].includes(matchMode)) throw accountError('INVALID_SORT', 'Invalid account sort or search mode.');
  if (query !== undefined && (typeof query !== 'string' || query.length > 100)) throw accountError('INVALID_QUERY', 'Search text must contain at most 100 characters.');
  const filter = {};
  if (role) filter.role = role;
  if (status !== undefined) filter.status = status;
  if (query?.trim()) {
    const text = query.trim(); const escaped = escape(text);
    const expression = new RegExp(matchMode === 'exact' ? `^${escaped}$` : escaped, 'i');
    filter.$or = [{ username: expression }, { email: expression }, { 'profile.firstName': expression }, { 'profile.lastName': expression }, { $expr: { $regexMatch: { input: { $concat: [{ $ifNull: ['$profile.firstName', ''] }, ' ', { $ifNull: ['$profile.lastName', ''] }] }, regex: expression } } }];
    if (/^[+\d\s().-]+$/.test(text)) {
      let digits = text.replace(/\D/g, '');
      if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
      const pattern = digits.split('').join('[\\s().-]*');
      const national = digits.startsWith('0') ? `(?:0|\\+?84)[\\s().-]*${digits.slice(1).split('').join('[\\s().-]*')}` : pattern;
      filter.$or.push({ 'profile.phone': new RegExp(matchMode === 'exact' ? `^${national}$` : national) });
    }
  }
  const activeVip = { 'membership.isVip': true, $or: [{ 'membership.expireAt': { $gt: new Date() } }, { 'membership.expireAt': null }] };
  if (vipStatus === 'active' || vip === true) filter.$and = [activeVip];
  else if (vipStatus === 'expired') Object.assign(filter, { 'membership.isVip': true, 'membership.expireAt': { $lte: new Date() } });
  else if (vipStatus === 'standard' || vip === false) filter.$nor = [activeVip];
  const limit = Math.min(Math.max(Math.trunc(Number(args.limit) || 10), 1), 50);
  const [result] = await User.aggregate([...profileStages, { $match: filter }, { $facet: { items: [{ $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 } }, { $limit: limit }, { $project: select }], count: [{ $count: 'total' }] } }]);
  return { items: result.items, total: result.count[0]?.total || 0, returned: result.items.length, limit, filters: { query: query || '', role, status, vip, vipStatus, matchMode }, sortBy, sortOrder };
}
module.exports = { accountError, profilePayload, assertPhoneAvailable, getAccount, searchAccounts };

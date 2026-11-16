const mongoose = require('mongoose');
const Feedback = require('../models/BookingFeedback');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { CATEGORIES, fail, validateFeedback } = require('../validators/feedbackValidator');

function assertId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) fail('Feedback or booking not found.', 404);
}
function userDTO(record) {
  if (!record) return null;
  const value = record.toObject ? record.toObject() : record;
  return {
    _id: value._id, bookingId: value.bookingId, rating: value.rating,
    comment: value.comment, categories: value.categories,
    reply: value.reply ? { content: value.reply.content, repliedAt: value.reply.repliedAt, updatedAt: value.reply.updatedAt } : null,
    replyRevision: value.replyRevision, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}
async function createFeedback(bookingId, userId, body) {
  assertId(bookingId);
  const input = validateFeedback(body);
  const booking = await Booking.findOne({ _id: bookingId, userId });
  if (!booking) fail('Booking not found.', 404);
  if (booking.status !== 'COMPLETED') fail('Only completed bookings can be rated.');
  try {
    return userDTO(await Feedback.create({ bookingId, userId, ...input }));
  } catch (error) {
    if (error.code === 11000) fail('This booking has already been rated.', 409);
    throw error;
  }
}
async function getFeedback(bookingId, userId) {
  assertId(bookingId);
  const booking = await Booking.findById(bookingId).select('userId').lean();
  if (!booking) fail('Booking not found.', 404);
  const feedback = await Feedback.findOne({ bookingId }).lean();
  if (String(booking.userId) !== String(userId) && (!feedback || String(feedback.userId) !== String(userId))) fail('Booking not found.', 404);
  return userDTO(feedback);
}
async function attachFeedbackSummaries(bookings, userId) {
  const values = bookings.map(booking => booking.toObject ? booking.toObject() : booking);
  const owned = values.filter(booking => String(booking.userId) === String(userId));
  const feedbacks = owned.length ? await Feedback.find({ bookingId: { $in: owned.map(booking => booking._id) } }).select('bookingId rating reply').lean() : [];
  const byBooking = new Map(feedbacks.map(item => [String(item.bookingId), item]));
  return values.map(booking => {
    const isOwner = String(booking.userId) === String(userId);
    const feedback = isOwner ? byBooking.get(String(booking._id)) : null;
    return { ...booking,
      feedbackSummary: feedback ? { id: feedback._id, rating: feedback.rating, hasReply: Boolean(feedback.reply) } : null,
      canSubmitFeedback: isOwner && booking.status === 'COMPLETED' && !feedback,
    };
  });
}
function integerParam(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail('Invalid pagination.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) fail('Invalid pagination.');
  return parsed;
}
function vietnamDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Dates must use YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== value) fail('Invalid date.');
  return date;
}
async function buildFilter(query = {}) {
  const filter = {};
  if (query.rating !== undefined && query.rating !== '') {
    if (typeof query.rating !== 'string' || !/^[1-5]$/.test(query.rating)) fail('Invalid rating filter.');
    filter.rating = Number(query.rating);
  }
  if (query.category) {
    if (!CATEGORIES.includes(query.category)) fail('Invalid category filter.');
    filter.categories = query.category;
  }
  if (query.status) {
    if (!['REPLIED', 'UNREPLIED'].includes(query.status)) fail('Invalid reply status.');
    filter.reply = query.status === 'REPLIED' ? { $ne: null } : null;
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = vietnamDate(query.from);
    if (query.to) filter.createdAt.$lt = vietnamDate(query.to);
    if (filter.createdAt.$gte && filter.createdAt.$lt && filter.createdAt.$gte >= filter.createdAt.$lt) fail('End date must be after start date (exclusive).');
  }
  if (query.search) {
    if (typeof query.search !== 'string' || query.search.length > 100) fail('Invalid search.');
    const search = query.search.trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const users = await User.find({ username: { $regex: escaped, $options: 'i' } }).distinct('_id');
      filter.$or = [{ userId: { $in: users } }];
      if (/^[a-f\d]{24}$/i.test(search)) filter.$or.push({ bookingId: new mongoose.Types.ObjectId(search) });
    }
  }
  return filter;
}
async function listFeedbacks(query) {
  const filter = await buildFilter(query);
  const page = integerParam(query.page, 1, 100000);
  const limit = integerParam(query.limit, 20, 100);
  const [items, total] = await Promise.all([
    Feedback.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .select('-replyHistory').populate('userId', 'username').populate('bookingId', 'licensePlate parkingSlot scheduledStart scheduledEnd status').lean(),
    Feedback.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}
async function getStats(query) {
  const filter = await buildFilter(query);
  const [stats] = await Feedback.aggregate([{ $match: filter }, { $group: {
    _id: null, total: { $sum: 1 }, averageRating: { $avg: '$rating' },
    lowRatingCount: { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } },
    unrepliedCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$reply', null] }, null] }, 1, 0] } },
  } }]);
  return stats ? { total: stats.total, averageRating: stats.averageRating, lowRatingCount: stats.lowRatingCount, unrepliedCount: stats.unrepliedCount }
    : { total: 0, averageRating: null, lowRatingCount: 0, unrepliedCount: 0 };
}
async function getAdminFeedback(id) {
  assertId(id);
  const record = await Feedback.findById(id).populate('userId', 'username').populate('bookingId', 'licensePlate parkingSlot scheduledStart scheduledEnd status').lean();
  if (!record) fail('Feedback not found.', 404);
  return record;
}
module.exports = { assertId, userDTO, createFeedback, getFeedback, attachFeedbackSummaries, buildFilter, listFeedbacks, getStats, getAdminFeedback };

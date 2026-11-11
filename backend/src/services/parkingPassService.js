const ParkingPass = require('../models/ParkingPass');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const { buildParkingPassQrPayload, parseAndVerifyParkingPassQr } = require('./parkingPassQrService');
const { parseAndVerifyBookingQr, buildBookingQrPayload } = require('./bookingQrService');
const error = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const withSession = (query, session) => session ? query.session(session) : query;
const isPassIssuanceEnabled = () => Boolean(process.env.PARKING_PASS_QR_SECRET) && process.env.PARKING_PASS_ISSUE_ENABLED !== 'false';
const assertIssuance = () => { if (!isPassIssuanceEnabled()) throw error('New parking pass issuance is disabled', 503); };
const ensureBookingPass = async (booking, { session } = {}) => {
  const bookingId = booking._id || booking;
  if (!isPassIssuanceEnabled()) {
    const existing = await withSession(ParkingPass.findOne({ bookingId }), session);
    if (existing) return existing;
    assertIssuance();
  }
  return ParkingPass.findOneAndUpdate({ bookingId }, { $setOnInsert: { bookingId } }, { upsert: true, new: true, session });
};
const ensureSessionPass = async (parkingSession, { session } = {}) => {
  const query = parkingSession.bookingId ? { bookingId: parkingSession.bookingId } : { originSessionId: parkingSession._id };
  if (!isPassIssuanceEnabled()) {
    const existing = await withSession(ParkingPass.findOne(query), session);
    if (!existing) { assertIssuance(); }
  }
  return ParkingPass.findOneAndUpdate(query, { $setOnInsert: query, $set: { activeSessionId: parkingSession._id } }, { upsert: true, new: true, session });
};
const getAllowedActions = (booking, session, now = new Date()) => {
  if (booking) {
    if (booking.status === 'ACTIVE' && session?.status === 'active') return ['CHECK_OUT'];
    if (['PAID', 'PAUSED', 'EXPIRED'].includes(booking.status)) {
      const start = new Date(booking.scheduledStart).getTime();
      const end = new Date(booking.scheduledEnd).getTime();
      if (now.getTime() >= start - 30 * 60000 && now.getTime() <= end && (booking.status === 'PAUSED' || now.getTime() <= start + 30 * 60000)) return ['CHECK_IN'];
    }
    return [];
  }
  return session?.status === 'active' ? ['CHECK_OUT'] : [];
};
const getPassTicket = async (passId, { session: mongoSession } = {}) => {
  const pass = await withSession(ParkingPass.findById(passId), mongoSession);
  if (!pass || pass.revokedAt) throw error('Parking pass is unavailable', 410);
  const booking = pass.bookingId ? await withSession(Booking.findById(pass.bookingId).populate('floorId', 'name floorNumber'), mongoSession) : null;
  const parkingSession = pass.bookingId
    ? await withSession(Session.findOne({ bookingId: pass.bookingId, status: 'active' }).sort({ checkInTime: -1 }), mongoSession)
    : await withSession(Session.findById(pass.originSessionId).populate('floorId', 'name floorNumber'), mongoSession);
  if ((pass.bookingId && !booking) || (!booking && !parkingSession)) throw error('Parking pass target not found', 404);
  return { pass, booking, session: parkingSession, payload: process.env.PARKING_PASS_QR_SECRET ? buildParkingPassQrPayload(pass) : booking ? buildBookingQrPayload(booking) : null, licensePlate: booking?.licensePlate || parkingSession?.licensePlate, allowedActions: getAllowedActions(booking, parkingSession), credentialType: 'PARKING_PASS' };
};
const resolveParkingCredential = async (payload) => {
  if (typeof payload !== 'string') throw error('QR payload is required', 400);
  if (payload.startsWith('VALO_PASS:')) {
    if (process.env.PARKING_PASS_READ_ENABLED === 'false') throw error('Parking pass scanning is disabled', 503);
    const parsed = parseAndVerifyParkingPassQr(payload);
    const ticket = await getPassTicket(parsed.passId);
    if (ticket.pass.qrVersion !== parsed.version) throw error('Parking pass QR has been replaced', 410);
    return ticket;
  }
  const parsed = parseAndVerifyBookingQr(payload);
  const booking = await Booking.findById(parsed.bookingId);
  if (!booking || Number(booking.qrVersion || 1) !== parsed.version || !['PAID', 'ACTIVE', 'PAUSED', 'EXPIRED'].includes(booking.status)) throw error('Booking QR is unavailable', 410);
  if (!process.env.PARKING_PASS_QR_SECRET || !isPassIssuanceEnabled()) {
    const existing = await ParkingPass.findOne({ bookingId: booking._id });
    if (existing) return getPassTicket(existing._id);
    const session = await Session.findOne({ bookingId: booking._id, status: 'active' });
    return { pass: { _id: booking._id, bookingId: booking._id, legacy: true }, booking, session, payload, licensePlate: booking.licensePlate, allowedActions: getAllowedActions(booking, session), credentialType: 'LEGACY_BOOKING' };
  }
  const pass = await ensureBookingPass(booking);
  return getPassTicket(pass._id);
};
module.exports = { isPassIssuanceEnabled, ensureBookingPass, ensureSessionPass, getPassTicket, resolveParkingCredential, getAllowedActions };

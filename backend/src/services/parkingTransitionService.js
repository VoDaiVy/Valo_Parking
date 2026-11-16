const ParkingPass = require('../models/ParkingPass');
const Booking = require('../models/Booking');
const ParkingPassAction = require('../models/ParkingPassAction');

// Every QR entry/exit calls this inside the transaction which changes parking state.
// Writing the credential forces a conflict with a concurrent reissue/revocation.
async function assertCredentialCurrent(req, mongoSession) {
  const credential = req.parkingPassAction || req.parkingQrCredential;
  if (!credential) return;
  if (credential.expectedVersion) {
    const touched = await ParkingPass.updateOne({
      _id: credential.passId, qrVersion: credential.expectedVersion, revokedAt: null,
    }, { $inc: { usageCounter: 1 } }, { session: mongoSession });
    if (!touched.matchedCount) throw Object.assign(new Error('Parking QR has been replaced or revoked'), { statusCode: 410 });
  }
  if (credential.expectedBookingQrVersion) {
    const versions = [{ qrVersion: credential.expectedBookingQrVersion }];
    if (credential.expectedBookingQrVersion === 1) versions.push({ qrVersion: { $exists: false } });
    const touched = await Booking.updateOne({ _id: credential.bookingId, $or: versions },
      { $set: { updatedAt: new Date() } }, { session: mongoSession });
    if (!touched.matchedCount) throw Object.assign(new Error('Booking QR has been replaced'), { statusCode: 410 });
  }
}

async function recordPassCommit(req, parkingSession, mongoSession) {
  if (!req.parkingPassAction?.auditId || !parkingSession) return;
  const committed = await ParkingPassAction.updateOne({ _id: req.parkingPassAction.auditId, status: 'pending' }, {
    $set: {
      status: 'completed', sessionId: parkingSession._id,
      result: { statusCode: 200, body: { success: true, data: { session: parkingSession } } },
    },
  }, { session: mongoSession });
  if (!committed.modifiedCount) throw Object.assign(new Error('Parking action is no longer pending'), { statusCode: 409 });
}

module.exports = { assertCredentialCurrent, recordPassCommit };

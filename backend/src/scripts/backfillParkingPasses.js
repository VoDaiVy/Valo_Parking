require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const Pass = require('../models/ParkingPass');
const { auditParkingPasses } = require('./auditParkingPasses');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const audit = await auditParkingPasses();
    const apply = process.argv.includes('--apply');
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...audit }, null, 2));
    if (!apply) return;
    if (audit.activeDuplicatePlateGroups || audit.activeDuplicateSlotGroups || audit.activeUnnormalizedPlates) {
      throw new Error('Resolve active session conflicts/normalization before applying migration.');
    }
    await Pass.createIndexes();
    await Session.collection.createIndex({ licensePlate: 1 }, {
      name: 'parking_active_unique_plate', unique: true,
      partialFilterExpression: { status: 'active', licensePlate: { $type: 'string' } },
    });
    await Session.collection.createIndex({ floorId: 1, parkingSlot: 1 }, {
      name: 'parking_active_unique_slot', unique: true,
      partialFilterExpression: { status: 'active', floorId: { $type: 'objectId' }, parkingSlot: { $type: 'string' } },
    });
    let bookingCount = 0;
    let sessionCount = 0;
    for await (const booking of Booking.find({ status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] } }).select('_id').cursor({ batchSize: 100 })) {
      await Pass.findOneAndUpdate({ bookingId: booking._id }, { $setOnInsert: { bookingId: booking._id } }, { upsert: true, new: true });
      bookingCount += 1;
    }
    for await (const parkingSession of Session.find({ status: 'active' }).cursor({ batchSize: 100 })) {
      const target = parkingSession.bookingId ? { bookingId: parkingSession.bookingId } : { originSessionId: parkingSession._id };
      await Pass.findOneAndUpdate(target, { $setOnInsert: target, $set: { activeSessionId: parkingSession._id } }, { upsert: true, new: true });
      sessionCount += 1;
    }
    console.log(JSON.stringify({ processedBookings: bookingCount, processedSessions: sessionCount, telegramMessagesSent: 0 }));
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch((error) => {
  console.error(error.message === 'Resolve active session conflicts/normalization before applying migration.' ? error.message : 'Parking pass migration failed; it can be rerun after resolving connectivity or index conflicts.');
  process.exitCode = 1;
});
module.exports = { main };

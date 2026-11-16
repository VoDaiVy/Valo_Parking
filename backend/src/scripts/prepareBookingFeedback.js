// Dry-run by default. Run with --apply before exposing feedback routes in production.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Feedback = require('../models/BookingFeedback');
const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  if (!transactionsSupported) throw new Error('Booking feedback replies require a Mongo replica set or sharded cluster.');
  const collectionExists = await mongoose.connection.db.listCollections({ name: Feedback.collection.name }).hasNext();
  const duplicates = collectionExists ? await Feedback.aggregate([
    { $group: { _id: '$bookingId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }, { $limit: 10 },
  ]) : [];
  if (duplicates.length) throw new Error('Duplicate feedback bookingIds exist. Resolve duplicates before applying indexes.');
  const apply = process.argv.includes('--apply');
  if (apply) {
    // createIndexes only adds declared indexes; it does not drop unrelated ones.
    for (const Model of [Feedback, Notification, UserNotification]) {
      await Model.createCollection();
      await Model.createIndexes();
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', transactionsSupported, duplicateBookings: duplicates.length, feedbackCollectionExists: collectionExists }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());

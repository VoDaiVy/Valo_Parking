const Notification = require('../models/Notification');
const StaffIncident = require('../models/StaffIncident');
const User = require('../models/User');

async function importLegacyStaffIncidents() {
  // The previous Report Issue route stored reports as Admin notifications.
  const reports = await Notification.find({
    type: 'SYSTEM',
    targetType: 'ROLE_BASED',
    targetRoles: ['admin'],
    title: /^Issue Report from /,
    isRevoked: false,
    createdBy: { $ne: null },
  }).select('createdBy content priority createdAt').lean();
  if (!reports.length) return 0;

  const authors = await User.find({
    _id: { $in: reports.map(report => report.createdBy) },
    role: 'staff',
  }).select('username').lean();
  const authorsById = new Map(authors.map(author => [String(author._id), author]));
  const writes = reports.flatMap(report => {
    const author = authorsById.get(String(report.createdBy));
    if (!author) return [];
    return [{
      updateOne: {
        filter: { _id: report._id },
        update: { $setOnInsert: {
          reporterId: author._id,
          reporterName: author.username || 'Staff',
          content: report.content,
          priority: ['ERROR', 'WARNING'].includes(report.priority) ? report.priority : 'INFO',
          status: 'OPEN',
          revision: 0,
          messages: [],
          createdAt: report.createdAt,
          updatedAt: report.createdAt,
        } },
        upsert: true,
        timestamps: false,
      },
    }];
  });
  if (!writes.length) return 0;
  const result = await StaffIncident.bulkWrite(writes, { ordered: false });
  return result.upsertedCount;
}

module.exports = { importLegacyStaffIncidents };

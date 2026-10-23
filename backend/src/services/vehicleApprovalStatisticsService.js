const Vehicle = require('../models/Vehicle');
const { DAY_MS, startOfVietnamDay } = require('../utils/bookingDateRange');

async function getVehicleApprovalStatistics(params = {}, now = new Date()) {
  const start = params.startDate ? new Date(params.startDate) : startOfVietnamDay(now);
  const endExclusive = params.endDate
    ? new Date(new Date(params.endDate).getTime() + 1)
    : new Date(start.getTime() + DAY_MS);
  const rows = await Vehicle.aggregate([
    { $match: { status: 'approved', approvedAt: { $gte: start, $lt: endExclusive } } },
    { $group: { _id: '$approvalSource', count: { $sum: 1 } } },
  ]);
  const bySource = Object.fromEntries(rows.map((row) => [row._id || 'unknown', row.count]));
  const totalApproved = rows.reduce((total, row) => total + row.count, 0);
  return {
    period: {
      startDate: start.toISOString(),
      endExclusive: endExclusive.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    totalApproved,
    aiApproved: bySource.ai || 0,
    adminApproved: bySource.admin || 0,
    otherApproved: totalApproved - (bySource.ai || 0) - (bySource.admin || 0),
    note: 'Counts currently approved vehicles with a recorded approval time. Approvals before tracking was added have no approvedAt and are not included.',
  };
}

module.exports = { getVehicleApprovalStatistics };

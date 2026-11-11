const mongoose = require('mongoose');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function bookingManagementFilter({ floorId, search } = {}) {
  const filter = {};
  if (floorId) {
    if (!/^[a-f\d]{24}$/i.test(floorId)) throw Object.assign(new Error('Invalid floor identifier.'), { statusCode: 400 });
    filter.floorId = new mongoose.Types.ObjectId(floorId);
  }
  if (search !== undefined && (typeof search !== 'string' || search.length > 150)) throw Object.assign(new Error('Search must contain at most 150 characters.'), { statusCode: 400 });
  if (search?.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    const [users, details] = await Promise.all([
      require('../models/User').find({ username: pattern }).select('_id').lean(),
      require('../models/UserDetail').find({ $expr: { $regexMatch: { input: { $concat: [{ $ifNull: ['$firstName', ''] }, ' ', { $ifNull: ['$lastName', ''] }] }, regex: pattern } } }).select('userId').lean(),
    ]);
    filter.$or = [{ licensePlate: pattern }, { parkingSlot: pattern }, { userId: { $in: [...users.map(row => row._id), ...details.map(row => row.userId)].filter(Boolean) } }];
  }
  return filter;
}
const combineBookingFilters = (scope, filters) => scope.$or && filters.$or ? { $and: [scope, filters] } : { ...scope, ...filters };
module.exports = { bookingManagementFilter, combineBookingFilters };

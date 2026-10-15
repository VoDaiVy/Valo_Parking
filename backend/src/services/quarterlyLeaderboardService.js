const Month = require('../models/SpendRewardMonth');
const { monthOf } = require('./spendRewardRules');
const { getProgram } = require('./spendRewardService');

const quarterOf = (month) => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
const quarterMonths = (quarter) => {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter || '');
  if (!match) throw Object.assign(new Error('Invalid quarter. Use YYYY-Q1 to YYYY-Q4.'), { statusCode: 400 });
  const first = (Number(match[2]) - 1) * 3 + 1;
  return Array.from({ length: 3 }, (_, offset) => `${match[1]}-${String(first + offset).padStart(2, '0')}`);
};

async function getLeaderboard({ quarter, now = new Date() }) {
  const program = await getProgram();
  const currentQuarter = quarterOf(monthOf(now));
  const firstQuarter = program.startsAt ? quarterOf(monthOf(program.startsAt)) : currentQuarter;
  const selected = quarter || currentQuarter;
  const months = quarterMonths(selected);
  if (selected < firstQuarter || selected > currentQuarter) {
    throw Object.assign(new Error('Quarter is outside the available reward history.'), { statusCode: 400 });
  }
  const availableQuarters = [];
  for (let year = Number(currentQuarter.slice(0, 4)); year >= Number(firstQuarter.slice(0, 4)); year--) {
    for (let q = year === Number(currentQuarter.slice(0, 4)) ? Number(currentQuarter.slice(-1)) : 4; q >= 1; q--) {
      const value = `${year}-Q${q}`;
      if (value >= firstQuarter) availableQuarters.push(value);
    }
  }
  if (!program.startsAt) return { quarter: selected, currentQuarter, availableQuarters, leaders: [] };
  const rows = await Month.aggregate([
    { $match: { month: { $in: months }, total: { $gt: 0 } } },
    { $group: { _id: '$userId', total: { $sum: '$total' } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.role': 'customer', 'user.status': true } },
    { $set: { username: '$user.username' } },
    { $setWindowFields: { sortBy: { total: -1 }, output: { rank: { $rank: {} } } } },
    { $sort: { rank: 1, username: 1, _id: 1 } },
    { $limit: 20 },
    { $project: { _id: 0, userId: '$_id', username: 1, total: 1, rank: 1 } },
  ]);
  return { quarter: selected, currentQuarter, availableQuarters, leaders: rows };
}

module.exports = { quarterOf, quarterMonths, getLeaderboard };

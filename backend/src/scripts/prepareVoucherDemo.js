const mongoose = require('mongoose');
const Program = require('../models/SpendRewardProgram');
const Template = require('../models/VoucherTemplate');
const { validateProgram } = require('../services/spendRewardRules');

const junk = /^(?:a|tests?(?:[\s_-]*\d+)?|dummy|asdf|xxx)$/i;
const tiers = [
  { threshold: 50000, discountAmount: 5000, minimumAmount: 25000, recipientLimit: 100 },
  { threshold: 100000, discountAmount: 10000, minimumAmount: 50000, recipientLimit: 50 },
  { threshold: 200000, discountAmount: 20000, minimumAmount: 80000, recipientLimit: 20 },
];

async function prepareVoucherDemo({ apply = false, session } = {}) {
  const program = await Program.findById('monthly').session(session || null);
  if (!program) throw new Error('Monthly reward program not found; check the target database.');
  const templates = await Template.find({ archivedAt: null }).session(session || null);
  const archive = templates.filter((item) => junk.test(item.name.trim()));
  const changes = templates.flatMap((item) => {
    if (!item.isActive) return [];
    if (item.name.trim().toUpperCase() === '10% OFF' && item.type === 'PERCENT_DISCOUNT') {
      return [{ item, patch: { discountPercent: 10, minimumAmount: 30000 } }];
    }
    if (item.name.trim().toUpperCase() === 'WASHING' && item.type === 'FREE_SERVICE') {
      return [{ item, patch: { minimumAmount: 120000 } }];
    }
    return [];
  });
  const settings = validateProgram({
    enabled: program.enabled, revision: program.revision, validityDays: program.validityDays, tiers,
  });
  const plan = {
    previousTiers: program.tiers,
    newTiers: settings.tiers,
    archive: archive.map(({ id, name, redeemedCount }) => ({ id, name, redeemedCount })),
    updateTemplates: changes.map(({ item, patch }) => ({ id: item.id, name: item.name, fromMinimum: item.minimumAmount, ...patch })),
    otherTemplates: templates.filter((item) => !archive.includes(item) && !changes.some((change) => change.item === item)).map(({ name }) => name),
  };
  if (!apply) return plan;
  const update = await Program.updateOne({ _id: 'monthly', revision: program.revision }, {
    $set: { tiers: settings.tiers }, $inc: { revision: 1 },
  }, { session, runValidators: true });
  if (!update.modifiedCount) throw new Error('Program settings changed during setup; retry.');
  if (archive.length) await Template.updateMany({ _id: { $in: archive.map((item) => item._id) } }, {
    $set: { isActive: false, archivedAt: new Date() },
  }, { session });
  for (const { item, patch } of changes) {
    Object.assign(item, patch);
    await item.save({ session });
  }
  return plan;
}

async function main() {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env'), quiet: true });
  const apply = process.argv.includes('--apply');
  const expected = process.argv.find((arg) => arg.startsWith('--database='))?.slice('--database='.length);
  if (apply && !expected) throw new Error('Pass --database=<database name> together with --apply.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  if (expected && expected !== mongoose.connection.name) throw new Error('Database name does not match --database.');
  let plan;
  if (apply) {
    await mongoose.connection.transaction(async (session) => { plan = await prepareVoucherDemo({ apply, session }); });
  } else {
    plan = await prepareVoucherDemo();
  }
  console.log(JSON.stringify({ database: mongoose.connection.name, applied: apply, ...plan }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { prepareVoucherDemo };

const TicketPackage = require('../models/TicketPackage');
const Subscription = require('../models/Subscription');
const { packageDuration, salesAvailability, catalogSalesAvailability } = require('./ticketPackageTerms');
const { isObjectIdOrHexString } = require('mongoose');
const {
  PACKAGE_TYPES,
  isMembershipPackageType,
  getPackageDurationDays,
  getPackageBenefits,
} = require('../utils/ticketPackageRules');

const FEATURED_TYPES = ['hourly', 'monthly', 'yearly'];
const WINDOW_DAYS = 30;

const invalidQuery = (message) => Object.assign(new Error(message), { statusCode: 400 });

function parseExploreQuery(query = {}) {
  const type = query.type === undefined ? 'all' : query.type;
  if (typeof type !== 'string' || !['all', ...PACKAGE_TYPES].includes(type)) {
    throw invalidQuery('Invalid ticket package type.');
  }
  const parseInteger = (value, fallback, maximum, name) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      throw invalidQuery(`${name} must be a positive integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) {
      throw invalidQuery(`${name} must not exceed ${maximum}.`);
    }
    return parsed;
  };
  return {
    type,
    page: parseInteger(query.page, 1, 1000000, 'page'),
    limit: parseInteger(query.limit, 12, 50, 'limit'),
  };
}

function toPublicPackage(pkg, now) {
  const membership = isMembershipPackageType(pkg.type);
  return {
    _id: String(pkg._id),
    name: pkg.name,
    type: pkg.type,
    price: pkg.price,
    priceUnit: pkg.type,
    description: pkg.description || '',
    isActive: true,
    maxSlots: pkg.maxSlots,
    saleLimit: pkg.saleLimit ?? null,
    revision: pkg.revision ?? 0,
    durationMinutes: pkg.durationMinutes ?? null,
    duration: packageDuration(pkg),
    service: pkg.service,
    salesAvailability: membership ? catalogSalesAvailability(pkg, now) : salesAvailability(pkg, now),
    benefitsVersion: pkg.benefitsVersion || 0,
    serviceBenefits: pkg.serviceBenefits || [],
    ...(membership ? {
      durationDays: getPackageDurationDays(pkg),
      ...(['monthly', 'yearly'].includes(pkg.type) ? { durationMonths: pkg.type === 'yearly' ? 12 : 1 } : {}),
      benefits: getPackageBenefits(pkg),
    } : { benefits: [] }),
  };
}

const compareOldest = (left, right) =>
  new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  || String(left._id).localeCompare(String(right._id));

function buildExploreCatalog(packages, purchaseCounts, options, now) {
  const activePackages = packages.filter((pkg) => pkg.isActive && PACKAGE_TYPES.includes(pkg.type));
  const featured = FEATURED_TYPES.flatMap((type) => {
    const candidates = activePackages.filter((pkg) => pkg.type === type).sort((left, right) =>
      (purchaseCounts.get(String(right._id)) || 0) - (purchaseCounts.get(String(left._id)) || 0)
      || compareOldest(left, right)
    );
    if (!candidates.length) return [];
    const winner = candidates[0];
    return [{
      ...toPublicPackage(winner, now),
      selectionReason: (purchaseCounts.get(String(winner._id)) || 0) > 0 ? 'bestseller' : 'recommended',
    }];
  });
  const featuredIds = new Set(featured.map((pkg) => pkg._id));
  const remaining = activePackages.filter((pkg) =>
    !featuredIds.has(String(pkg._id)) && (options.type === 'all' || pkg.type === options.type)
  ).sort((left, right) => compareOldest(right, left));
  const offset = (options.page - 1) * options.limit;
  return {
    featured,
    items: remaining.slice(offset, offset + options.limit).map(pkg => toPublicPackage(pkg, now)),
    pagination: {
      page: options.page,
      limit: options.limit,
      total: remaining.length,
      totalPages: Math.ceil(remaining.length / options.limit),
    },
    rankingWindow: {
      from: new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString(),
      to: now.toISOString(),
      days: WINDOW_DAYS,
    },
    generatedAt: now.toISOString(),
  };
}

async function getExplorePackages(query = {}, now = new Date()) {
  const options = parseExploreQuery(query);
  await require('./ticketPackageStockService').refreshAll();
  const packages = await TicketPackage.find({ isActive: true })
    .select('_id name type price description duration durationDays durationMinutes service salesStartAt salesEndAt revision benefitsVersion displayBenefits serviceBenefits isActive maxSlots saleLimit createdAt').lean();
  const from = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const range = { $gte: from, $lte: now };
  const membershipIds = packages.filter((pkg) => isMembershipPackageType(pkg.type)).map((pkg) => pkg._id);
  const subscriptionCounts = await Subscription.aggregate([
      { $match: {
        ticketPackage: { $in: membershipIds },
        paymentStatus: 'paid',
        status: { $in: ['active', 'expired'] },
        $or: [
          { firstPaidAt: range },
          { firstPaidAt: null, 'rewardPayments.paidAt': range },
        ],
      } },
      // The original orderCode is retained across renewals. Match that payment
      // only so a renewal cannot move an older initial purchase into this window.
      { $set: { initialPurchaseAt: { $ifNull: [
        '$firstPaidAt',
        { $min: { $map: {
          input: { $filter: {
            input: { $ifNull: ['$rewardPayments', []] },
            as: 'payment',
            cond: { $eq: ['$$payment.orderCode', '$orderCode'] },
          } },
          as: 'payment',
          in: '$$payment.paidAt',
        } } },
      ] } } },
      { $match: { initialPurchaseAt: range } },
      { $group: { _id: '$ticketPackage', purchases: { $sum: 1 } } },
  ]);
  const purchaseCounts = new Map(subscriptionCounts.map((row) => [String(row._id), row.purchases]));
  return buildExploreCatalog(packages, purchaseCounts, options, now);
}

async function getExplorePackage(packageId) {
  if (typeof packageId !== 'string' || !isObjectIdOrHexString(packageId)) {
    throw invalidQuery('Invalid ticket package ID.');
  }
  await require('./ticketPackageStockService').refreshAll();
  const pkg = await TicketPackage.findOne({ _id: packageId, isActive: true })
    .select('_id name type price description duration durationDays durationMinutes service salesStartAt salesEndAt revision benefitsVersion displayBenefits serviceBenefits isActive maxSlots saleLimit').lean();
  if (!pkg) throw Object.assign(new Error('Ticket package is unavailable.'), { statusCode: 404 });
  return toPublicPackage(pkg);
}

module.exports = { getExplorePackages, getExplorePackage, parseExploreQuery, buildExploreCatalog };

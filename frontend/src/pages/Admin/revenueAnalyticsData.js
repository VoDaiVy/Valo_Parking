// Reporting validation only: preserve backend values; never fill missing money with zero.
export const revenueSources = ['bookingRevenue', 'serviceRevenue', 'packageRevenue', 'membershipTransferFees'];
export const readRevenueNumber = (value) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const equal = (a, b) => Math.abs(a - b) < 0.01;
export function inspectRevenueResponse(data) {
  const issues = [];
  const summary = {...data?.summary};
  const fields = ['totalRevenue', ...revenueSources, 'refunds', 'sourceCompositionTotal'];
  for (const field of fields) summary[field] = readRevenueNumber(summary[field]);
  const sourcesPresent = revenueSources.every((key) => summary[key] !== null);
  if (fields.some((key) => summary[key] === null)) issues.push('Some revenue amounts are unavailable in the reporting response.');
  const sum = sourcesPresent ? revenueSources.reduce((total, key) => total + summary[key], 0) : null;
  if (sum !== null && (!equal(summary.totalRevenue ?? NaN, sum) || !equal(summary.sourceCompositionTotal ?? NaN, sum))) {
    issues.push('Revenue totals do not reconcile with the reported sources. Total and composition are unavailable.');
    summary.totalRevenue = null; summary.sourceCompositionTotal = null;
  }
  let trend = Array.isArray(data?.trend) ? data.trend : null;
  if (trend && trend.some((point) => !point.period || ['totalRevenue', ...revenueSources, 'refunds'].some((key) => readRevenueNumber(point[key]) === null) || !equal(Number(point.totalRevenue), revenueSources.reduce((total, key) => total + Number(point[key]), 0)))) {
    issues.push('Revenue trend contains incomplete or inconsistent amounts.'); trend = null;
  }
  if (trend && fields.filter((key) => key !== 'sourceCompositionTotal').some((key) => summary[key] !== null && !equal(trend.reduce((total, point) => total + Number(point[key]), 0), summary[key]))) {
    issues.push('Revenue trend does not reconcile with the selected-period totals.'); trend = null;
  }
  let packages = Array.isArray(data?.packageBreakdown) ? data.packageBreakdown : null;
  if (packages && packages.some((row) => ['totalAmount', 'purchaseAmount', 'renewalAmount', 'purchaseCount', 'renewalCount'].some((key) => readRevenueNumber(row[key]) === null) || !Number.isInteger(Number(row.purchaseCount)) || !Number.isInteger(Number(row.renewalCount)) || !equal(Number(row.totalAmount), Number(row.purchaseAmount) + Number(row.renewalAmount)))) {
    issues.push('Package attribution is incomplete.'); packages = null;
  }
  if (packages && summary.packageRevenue !== null && !equal(packages.reduce((total, row) => total + Number(row.totalAmount), 0), summary.packageRevenue)) {
    issues.push('Package rows do not reconcile with Package Revenue.'); packages = null;
  }
  return {summary, trend, packages, issues};
}

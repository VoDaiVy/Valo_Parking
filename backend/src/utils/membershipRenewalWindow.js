const DAY_MS = 86400000;
const renewalWindowDays = (pkg) => {
  const value = Number(pkg?.renewalWindowDays ?? 7);
  return Number.isFinite(value) && value > 0 ? value : 7;
};
const isInRenewalWindow = (expireAt, pkg, now = new Date()) => {
  const remaining = new Date(expireAt) - now;
  return remaining > 0 && remaining <= renewalWindowDays(pkg) * DAY_MS;
};
module.exports = { renewalWindowDays, isInRenewalWindow };

const MEMBERSHIP_KPIS = ['total', 'active', 'expiringSoon', 'pendingTransfers', 'sold', 'pending', 'expired', 'cancelled', 'failed', 'expiringWithin7Days', 'grossAmount', 'renewalCount', 'renewalAmount', 'renewalRate', 'activeReservedSlots', 'averageSlotsPerActiveSubscription'];

function membershipResponseOptions(message) {
  const text = message.replace(/[^\s<>]+@[^\s<>]+/g, '');
  const kpis = [];
  const patterns = {
    total: /\btotal(?: number of| count of)? (?:memberships?|subscriptions?|records?)\b|\btotal vip(?: memberships?| subscriptions?)?(?=\s*[,;/&]|\s+and\b|[.!?]?\s*$)|\b(?:memberships?|subscriptions?) total\b|\btotal(?=\s*[,;/&]|\s+and\b|[.!?]?\s*$)/i,
    expiringSoon: /\bexpiring soon\b|\b(?:within|next|in)\s+30\s+days\b|\b30[ -]day\s+expir/i,
    pendingTransfers: /\bpending transfers?\b|\btransfers? (?:pending|awaiting (?:admin )?approval)\b/i,
    sold: /\bsold\b|\bsubscriptions? created\b/i,
    pending: /\bpending (?:subscriptions?|memberships?|records?)\b/i,
    expired: /\bexpired\b/i,
    cancelled: /\bcancell?ed\b/i,
    failed: /\bfailed\b/i,
    expiringWithin7Days: /\b(?:within|next|in)\s+7\s+days\b|\b7[ -]day\s+expir/i,
    grossAmount: /\bgross amount\b|\bpaid subscription amount\b|\bsubscription revenue\b/i,
    renewalCount: /\brenewal count\b|\b(?:number of|how many) renewals?\b/i,
    renewalAmount: /\brenewal (?:amount|revenue)\b/i,
    renewalRate: /\brenewal rate\b/i,
    activeReservedSlots: /\breserved slots\b/i,
    averageSlotsPerActiveSubscription: /\baverage slots\b/i,
  };
  for (const [key, pattern] of Object.entries(patterns)) if (pattern.test(text)) kpis.push(key);
  if (/\bactive\b/i.test(text.replace(/average slots per active (?:paid )?subscription|active (?:paid )?reserved slots/gi, ''))) kpis.push('active');
  const byPackage = /\bby package\b|\bpackage breakdown\b/i.test(text);
  const timeline = /\btimeline\b|\btrend\b/i.test(text);
  const specific = kpis.length > 0 || byPackage || timeline;
  return {
    ...(specific ? { kpis, byPackage, timeline } : {}),
    includeExpiry: /\bexpir(?:y|es?|ation|ing)\b|\bvalid until\b|\bend date\b/i.test(text),
    includeVehicles: /\bvehicles?\b|\b(?:license )?plates?\b|\bcars?\b/i.test(text),
  };
}

function isMembershipDashboardSummary(message, options) {
  const dashboard = ['total', 'active', 'expiringSoon', 'pendingTransfers'];
  return options.kpis?.length === dashboard.length && dashboard.every(key => options.kpis.includes(key))
    && /\b(?:vip|memberships?|subscriptions?)\b/i.test(message)
    && /\b(?:kpis?|statistics|stats|dashboard|summary)\b/i.test(message)
    && !options.byPackage && !options.timeline
    && !/[^\s<>]+@[^\s<>]+|\b[a-f\d]{24}\b|\b(?:my|mine|me|users?|accounts?|owners?|customers?|packages?|change|update|modify|delete)\b/i.test(message);
}

module.exports = { MEMBERSHIP_KPIS, membershipResponseOptions, isMembershipDashboardSummary };

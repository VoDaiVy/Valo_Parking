// Local-only diagnostics: never include request bodies, credentials or provider payloads.
module.exports = function membershipErrorDiagnostics(req, error) {
  if (process.env.NODE_ENV === 'production') return;
  if (!['215', 'MEMBERSHIP_UNAVAILABLE'].includes(String(error.code))) return;
  console.warn('[membership-diagnostic]', JSON.stringify({
    method: req.method,
    route: `${req.baseUrl || ''}${req.route?.path || ''}`,
    code: String(error.code),
    upstreamStatus: error.status || null,
    entitlementId: req.params?.entitlementId || null,
    subscriptionId: req.params?.subscriptionId || null,
    stack: String(error.stack || '').split('\n').filter((line) => /^\s+at /.test(line)).slice(0, 6),
  }));
};

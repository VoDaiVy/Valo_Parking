# Recovered Customer Membership History

Recovered selectively from tracked snapshot `782fe5934504d4e21348c36ab660ee8097f400df`
and its untracked parent `43770d3cad44e1da870526475293137de86d3793`.

- `GET /api/subscriptions/membership/history`: authenticated, customer-only activity timeline.
- `GET /api/subscriptions/entitlements/:entitlementId/renewals`: owned entitlement renewal history.
- `GET /api/subscriptions/:subscriptionId/renewals`: owned subscription renewal history.

Pagination and filter validation run before service calls. Ownership comes from
`req.user._id`. Activities combine persisted renewal attempts, purchase records,
and delivered expiry reminders. Successful renewal notifications and wallet
transactions do not create duplicate payment activities. Failed/pending attempts
do not display proposed expiry dates as activated renewals. Raw provider errors
and other users' records are not returned.

Existing renewal/payment services, scheduler and shared typography are preserved.
The drawer uses its recovered styling; visual redesign is deferred. Its rows are
not expandable. Tests use mocked data and API calls; they do not establish browser
E2E or real-database transaction verification.

# Telegram customer notifications

The Telegram worker sends three customer notifications in addition to existing parking tickets and reminders:

| Event | When it is recorded | Content and delivery |
|---|---|---|
| `membership_activated` | A subscription is first saved with paid payment status | Membership name, source subscription ID, currently owned spaces, validity, amount, and a PNG of the current membership QR |
| `violation_created` | A new staff/admin violation record is saved | Plate when available, title, recorded time, description, fine, and violation ID |
| `voucher_received` | A new user voucher is saved | Voucher name, benefit, description, minimum purchase, expiry, and source |

Templates are Vietnamese HTML messages maintained in [telegramEventTemplates.js](src/services/telegramEventTemplates.js). There is no admin template editor. Violation notifications come from confirmed business records, not raw AI surveillance alerts. The source model has no structured actual/expected-location fields, so the template uses the recorded description instead of guessing those locations.

The three event kinds use [TelegramEventDelivery](src/models/TelegramEventDelivery.js), stored in the `telegrameventdeliveries` collection. Existing parking tickets and reminders stay in `TelegramDelivery` / `telegramdeliveries`. The separate collection prevents older ticket-only workers from claiming new event jobs and interpreting them as parking tickets.

## Configuration

Existing Telegram bot setup, delivery transport, and account linking must already work. Relevant values are listed in [.env.example](.env.example).

| Variable | Behavior |
|---|---|
| `TELEGRAM_ENABLED` | Master gate. Only the exact string `true` enables Telegram and starts its worker. |
| `TELEGRAM_BOT_TOKEN` | Existing bot credential; required for actual Telegram API requests. Keep it outside version control. |
| `TELEGRAM_EVENTS_FROM` | Required ISO rollout timestamp. A missing, invalid, or future value prevents reconciliation of these events. Only persisted event markers at or after this time are eligible. |
| `TELEGRAM_MEMBERSHIP_ACTIVATED_ENABLED` | Set to `false` to disable this notification type. Enabled when absent, subject to the master gate. |
| `TELEGRAM_VIOLATION_CREATED_ENABLED` | Same per-type gate for violation notifications. |
| `TELEGRAM_VOUCHER_RECEIVED_ENABLED` | Same per-type gate for voucher notifications. |
| `TELEGRAM_WEB_APP_URL` | Public application base URL for message buttons; falls back to `CLIENT_URL`. Invalid/local URLs omit buttons without suppressing the message. |
| `MEMBERSHIP_QR_SECRET` | Existing membership signing secret, with the existing fallback to `BOOKING_QR_SECRET`, then `JWT_SECRET`. Telegram uses the same QR builders as the application. |

Use the intended launch time for `TELEGRAM_EVENTS_FROM`; do not copy an old example date without checking it. Restart the backend after changing environment configuration. A disabled type is not reconciled; its new source markers remain pending. Re-enabling it may process those events if they remain after the cutoff and are still valid. Advance the cutoff deliberately if notifications recorded during a pause should be excluded.

Buttons use existing frontend routes:

- Voucher: **Mở ví voucher** → `/customer/rewards`.
- Violation: **Mở thông báo** → `/customer/notification-inbox`.

There is currently no customer violation-detail page. The violation button opens the inbox, not a dedicated biên bản page. The Telegram message itself contains the recorded violation details. Public URL validation rejects credentials, non-HTTP protocols, localhost, and common loopback addresses.

## Durable event flow

The source models contain an optional embedded outbox marker:

```text
telegramNotification.occurredAt
telegramNotification.processedAt
```

Subscription paid-save middleware and new-save middleware for `Violation`/`UserVoucher` create the event marker in the same database write as the business record. When the caller uses a transaction, that transaction commits or rolls back the marker with the record. No Telegram network request runs in that transaction.

Existing records receive no default marker. Linking Telegram does not initiate a historical backfill. A bounded compatibility recovery for recent markerless manual vouchers is described below. The initial paid-activation repair branch commits the active subscription state, entitlement activation, and fallback purchase marker in one transaction. The fallback is restricted to markerless source subscriptions created at or after rollout. An aborted repair exposes neither partial repaired ownership nor its event marker. The failure-state update checks the previously observed status and update timestamp so it cannot overwrite another verifier's completed repair. Ordinary renewal activation does not request this fallback and does not create a purchase notification.

While enabled, the worker checks these event sources approximately every five seconds. Its one-second tick handles up to one delivery from each collection, with new event kinds restricted to the event collection and excluded from the legacy collection. Reconciliation reads up to 25 source records per type per scan. Actual delivery time depends on backlog, database latency, Telegram requests, and retries; there is no fixed delivery-time guarantee.

For each eligible marker, [telegramEventNotificationService.js](src/services/telegramEventNotificationService.js):

1. Finds the customer's active, notification-enabled account link whose `linkedAt` is no later than the event time and whose phone matches the customer profile.
2. Checks whether the legacy collection already has the same business-event key in `pending`, `processing`, `sent`, or `uncertain` status. If so, it marks the source processed without creating another job.
3. Otherwise upserts an event-collection delivery using a unique business-event key: `membership_activated:{subscriptionId}`, `violation_created:{violationId}`, or `voucher_received:{voucherId}`.
4. Marks the source event processed after the enqueue is durable. If there is no qualifying recipient, it marks the event processed without creating a delivery.

A restart between enqueue and marking processed safely retries the upsert. The source's processed marker remains after the delivery record's 30-day TTL, preventing normal reconciliation from recreating old deliveries. Linking later or linking again does not replay historical events. Account notifications do not use guest phone-receipt recipients.

### Recent manual-voucher recovery

When voucher notifications are enabled, reconciliation can restore a missing marker for a `manual` voucher only when it is still `available`, unexpired, and was created no earlier than the later of the rollout cutoff and 24 hours before the scan. A matching original in-app notification must name the voucher in `metadata.voucherId`, include the voucher recipient in `targetUsers`, and not be revoked.

The notification lookup and eligibility filter run before the 25-record recovery limit, so invalid early candidates do not starve later eligible vouchers. The notification schema declares a sparse index on `metadata.voucherId` for voucher references. Marker creation is conditional on the marker still being absent and uses the original voucher `createdAt`, not recovery time. The ordinary link-before-event, profile, ownership, validity, and dedupe checks then apply.

This compatibility path does not recover spending/loyalty vouchers, vouchers outside the time window, or events that already have processed markers. It does not clear failed, cancelled, sent, or uncertain delivery history and does not automatically migrate uncertain jobs.

Before sending, the handler checks the customer is active, reads the current business record, and verifies the link again. It also confirms the delivery still has its processing lease:

- Membership must still be paid, active, unexpired, and owned by the recipient. Migrated subscriptions must have current owned entitlement spaces. It uses the account QR when the user has a current account entitlement, matching the application credential selection; otherwise it uses the legacy subscription QR. A QR payload change during rendering cancels that stale delivery.
- A violation must still belong to the customer and have `PENDING` status. Paid or cancelled violations are not sent as new unpaid violations.
- A voucher must still belong to the customer, be `available`, and be unexpired. Used, expired, or revoked vouchers are not sent.
- Revoked, blocked, relinked, notification-disabled, or profile-mismatched recipients cancel pending sends.

## Delivery operations

Inspect `TelegramEventDelivery` for the three event kinds and `TelegramDelivery` for tickets/reminders. Both expose `kind`, `status`, `attempts`, `nextAttemptAt`, `errorCode`, `sentAt`, and `messageId`. During migration, also check the legacy collection for earlier event jobs. Logs intentionally report scan failures without printing bot credentials or QR payloads.

| Status | Meaning |
|---|---|
| `pending` | Awaiting its next allowed attempt. |
| `processing` | Worker owns a lease and is handling the job. |
| `sent` | Telegram returned a message ID and the result was saved. |
| `cancelled` | Event, recipient, or feature gate no longer permits delivery. |
| `failed` | Definite API failure or retries exhausted. |
| `uncertain` | The request may have reached Telegram, or a processing lease expired before a result was persisted. |

Rate limits respect Telegram's `retry_after`. Other retryable definite failures use the existing client backoff. Timeouts classified as uncertain and expired leases for the three new kinds are **not automatically resent**. Confirm the actual recipient history before any manual recovery: external Telegram delivery cannot guarantee exactly-once sending.

Source `processedAt` means the event was reconciled or skipped, not that a message was delivered. Check its corresponding `TelegramEventDelivery` and any legacy job with the same dedupe key for the final outcome. Do not clear processed markers or delete/recreate jobs as a routine retry procedure.

If no notification arrives, check the master gate and worker startup, rollout timestamp, persisted source marker, per-type flag, link age, profile phone match, active account state, and delivery status. Missing buttons commonly mean the configured application URL is local or invalid.

## Verification

From `backend`, run the focused local tests:

```powershell
npm run test:telegram
```

The integration suite uses a local MongoDB memory replica set and stubs Telegram sends. It needs the MongoDB test binary available or downloadable and installed backend dependencies, including `qrcode`. It does not send messages to a real user. Real-bot delivery and QR scanning at a gate require a configured staging environment.

The admin voucher suite exercises the actual distribution service and transaction, live notification publication handoff, Telegram delivery, replay deduplication, rollback, and compatibility recovery from a producer without the marker middleware. Reload producer and consumer processes after deploying model changes. Recent manual vouchers from older producers can use the bounded recovery above; other missing-marker incidents require investigation rather than a broad backfill.

## Rollout and rollback

Deploy schema/worker support before enabling producers in a split deployment. This implementation records new markers through model middleware, so keep the three type flags disabled during a staged rollout, set the intended cutoff, verify a test customer, then enable each type. Existing ticket/reminder kinds remain unchanged. Ensure the event collection's unique dedupe and TTL indexes are ready.

An older ticket-only worker cannot see the event collection. An intermediate event-capable deployment that still queues these kinds in the legacy collection is different: stop or drain those event producers/consumers before migration. The legacy-existence check and event upsert are separate operations across collections; they are not a cross-collection exactly-once protocol and cannot fully prevent concurrent intermediate-version producers from creating duplicate jobs.

Legacy `pending`, `processing`, `sent`, or `uncertain` jobs suppress replacement enqueue. The source remains processed even if such a legacy job later fails or is cancelled, so it will not automatically heal into the new queue. For a specific confirmed failure, inspect both queues, recipient history, original issuance notification, rollout/link timing, and current voucher state before planning recovery. Never reset an uncertain job automatically or bulk-clear processed markers. Preserve the original failure record and audit every narrowly scoped recovery.

To stop a notification type, set its flag to `false` and restart. Its queued pending event deliveries are cancelled when processed under the disabled flag. A rollback to a ticket-only worker leaves the separate event collection unconsumed; retain it for later inspection instead of moving jobs back to the ticket queue. Any transitional event jobs already in the legacy collection must be explicitly quarantined/cancelled before such a rollback so the old worker cannot interpret them as parking tickets. Preserve source markers and audit data. Telegram delivery failure does not require refunding purchases, removing vouchers, or undoing violation records.

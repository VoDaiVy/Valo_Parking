"""Additional report paths observed in the Ho Sy Hung implementation.

Each entry is a separate workflow not covered by the compact unit matrix.
Fields: state | action | expected result | precondition | draft Round 2 status.
"""

EXTRA_GROUPS = {
    40: [
        ("Request validation and returned identity", """
Missing email field|Submit password login without email|HTTP 400 lists the email validation error; no token is stored|Auth validator is enabled; token store starts empty|Passed
UserDetail record is absent|Sign in with valid credentials|Login succeeds and fullName falls back to username|Active User exists without UserDetail|Passed
"""),
        ("Refresh-token validation and reuse", """
Refresh token is absent|Request a new access token|HTTP 400 reports that refresh token is required|No refresh token in request body|Passed
Refresh JWT is valid but absent from UserToken|Request a new access token|HTTP 401 rejects the revoked token|JWT secret is configured; matching UserToken is absent|Passed
"""),
    ],
    41: [
        ("Account status and profile synchronization", """
Existing Google-linked account is deactivated|Submit a valid Google ID token|HTTP 403 blocks login; no JWT is issued|Google verifier returns matching email and sub|Passed
Existing profile has a custom avatar|Submit a Google token with another picture|Custom avatar remains unchanged|UserDetail avatar is not a googleusercontent URL|Passed
"""),
        ("New-account username and token rotation", """
Derived Google username already exists|Sign in with a new Google email|A unique suffixed username is created|User lookup by email and Google ID misses; username lookup hits|Passed
Existing Google user has an old refresh token|Sign in through Google again|Old refresh record is deleted and a new seven-day record is saved|UserToken contains a prior refresh token|Passed
"""),
    ],
    42: [
        ("OTP replacement and expiry boundary", """
Account already has a reset OTP|Request another password-reset OTP|Old reset OTP is removed and one new 15-minute OTP is saved|Registered email and old reset_password token exist|Passed
Matching OTP expiry is earlier than current time|Verify reset OTP|HTTP 400 rejects it and deletes the expired record|Clock is fixed just after token expiry|Passed
"""),
        ("Password reset side effects", """
Matching unexpired OTP and old refresh token exist|Reset password successfully|New password hash is saved; OTP and all refresh tokens are removed|User save hook and notification trigger are mocked|Passed
Reset input fails validator|Submit malformed new password|HTTP 400 returns field errors; password, OTP and refresh tokens are unchanged|Registered account and valid OTP exist|Passed
"""),
    ],
    43: [
        ("Wallet credit and refund ledger", """
Active wallet has balance 20000|Credit a 10000 VND refund|Balance is 30000 and one completed REFUND ledger entry is created|Wallet and transaction models support a session|Passed
Frozen wallet has balance 20000|Credit a top-up|Operation returns 403; balance and ledger remain unchanged|Wallet status is frozen|Passed
"""),
        ("Balance summary and overdraft boundary", """
Completed TOP_UP, PAYMENT and REFUND transactions exist|Read wallet balance summary|Lifetime and monthly totals use completed ledger entries only|Transaction aggregates and countDocuments are seeded|Passed
Active wallet has balance zero|Debit 100000 VND with allowNegative true|Balance becomes -100000 and a PAYMENT entry is stored|Overdraft flag is allowed for this service call|Passed
"""),
    ],
    44: [
        ("Missing upload and profile persistence", """
Authenticated request has no avatar file|Call POST /api/profile/avatar|HTTP 400 returns an upload error; Cloudinary is not called|Upload middleware has completed without req.file|Passed
Cloudinary returns a secure URL|Upload an accepted PNG file|UserDetail avatar is updated to the secure URL and response returns it|Valid user ID and image buffer exist|Passed
"""),
    ],
    45: [
        ("Violation list, filters and detail", """
Customer has own and foreign violations|Request the violation list|Only authorized customer records are returned|Violation query includes records for two users|Passed
Customer requests another person's violation ID|Get violation detail|Access is denied and no foreign violation data is returned|Both users and violation IDs are seeded|Passed
"""),
        ("User history and statistics permissions", """
Admin requests one user's violation history|Get user violation history|History is returned for the requested user|Admin token and target user exist|Passed
Staff requests violation statistics|Get violation statistics|Role middleware denies the admin-only route|Staff token is valid|Passed
"""),
    ],
    46: [
        ("Audit actor and target fidelity", """
Admin changes a customer status|Inspect the newly written action log|Actor, target, action and timestamp match the mutation|Admin and customer IDs are distinct|Passed
Admin updates customer profile fields|Inspect the action log entry|The action identifies the edited account without substituting the admin ID|The profile mutation succeeds|Passed
"""),
        ("Recent-action ordering and empty state", """
Audit rows have different createdAt values|Load recent admin actions|Most recent actions are returned first|AdminActionLog.find returns multiple records|Passed
Audit collection has no records|Load recent admin actions|An empty list is returned without a server error|AdminActionLog.find resolves to []|Passed
"""),
    ],
    47: [
        ("Delete event and error acknowledgement", """
Owned notification exists|Emit notification:delete with its ID|Notification is deleted, unread count is refreshed and callback succeeds|Connected socket has valid JWT|Passed
Notification service rejects deletion|Emit notification:delete with its ID|Callback reports failure and does not acknowledge success|deleteNotification is mocked to throw|Passed
"""),
        ("Admin audience and role-aware counts", """
Active admin socket and customer socket are online|Emit a new user notification|Recipient gets notification:new and admin gets notification:admin:new|Admin account still exists and is active|Pending
One user has Staff and Customer sockets|Refresh unread counts|Each socket receives a count calculated for its authenticated role|Two sockets are registered under the same user ID|Pending
"""),
    ],
    48: [
        ("Entitlement warning persistence", """
Active entitlement expires within the warning window|Run VIP scheduler twice|Warning timestamp is persisted and only one notice is dispatched|Expiry clock and notification dispatcher are controlled|Pending
Active entitlement expires outside the window|Run VIP scheduler|No warning timestamp or notification is created|Entitlement expiry is later than warning cutoff|Passed
"""),
        ("Legacy subscription expiry branch", """
Legacy active subscription approaches expiration|Run VIP scheduler|Legacy expireWarningSent flag is set after one warning|Subscription has no entitlement migration record|Pending
Expired VIP reservation belongs to the subscription|Run expiration cleanup|Slot reservedFor and reservedUntil fields are cleared|Slot ownership still points to expired subscription|Pending
"""),
    ],
    49: [
        ("Popup lifecycle and same-origin message", """
Popup opener exists and callback URL contains id_token|Mount OAuthCallback|postMessage targets window.location.origin and popup closes|window.opener and window.close are mocked|Passed
Popup opener is absent|Mount OAuthCallback with an OAuth error|No message is posted and popup remains on processing view|window.opener is null|Passed
"""),
    ],
    50: [
        ("Booking time and vehicle conflicts", """
Start time is in the past|Submit a wallet booking|HTTP 400 rejects the time before any wallet debit|Customer, vehicle and slot otherwise qualify|Passed
Vehicle already has an overlapping booking|Submit another booking for the same interval|HTTP 400 rejects the overlap; no new booking or payment is created|Overlapping booking fixture exists|Passed
"""),
        ("Voucher and payment-method branches", """
Valid voucher reduces a wallet booking price|Submit booking with voucherId|Discount is applied and voucher is marked used after payment|Voucher and wallet have sufficient state|Pending
Unknown payment method is supplied|Submit booking|HTTP 400 rejects the payment method without a paid booking|Valid time, owned vehicle and free slot exist|Passed
"""),
    ],
    51: [
        ("Missing order and unresolved PayOS state", """
No booking matches orderCode|Check VietQR status|HTTP 404 reports missing booking|PayOS mock is not called|Passed
PayOS still reports PENDING|Check VietQR status|Booking remains PENDING and no paid transition occurs|Owned booking is pending|Passed
"""),
        ("Repeat polling and expired payment", """
Booking is already PAID|Poll its orderCode again|PAID is returned without a second PayOS lookup or debit|Stored booking status is PAID|Passed
PayOS reports EXPIRED|Poll a pending booking|Booking becomes CANCELLED and voucher reservation is released|Owned pending booking has a reserved voucher|Pending
"""),
    ],
    52: [
        ("Cancellation quote and timing", """
Paid booking has refund-policy snapshot|Request cancel quote|Quote uses the stored snapshot rather than current policy settings|Booking starts in future and prepaid amount is known|Passed
Paid booking starts at or before current time|Confirm cancellation|HTTP 400 rejects cancellation; booking remains PAID|Clock is fixed at scheduledStart|Passed
"""),
        ("Wallet refund accounting and retry", """
Eligible booking has refundable prepaid amount|Confirm cancellation|Booking becomes CANCELLED and exactly one REFUND ledger record is credited|Wallet session and refund calculation are mocked|Pending
Cancelled booking is submitted again|Confirm cancellation a second time|No second wallet credit or duplicate refund is created|First cancellation already committed|Passed
"""),
    ],
    53: [
        ("Idempotent renewal requests", """
Paid renewal exists for the same idempotency key|Retry wallet renewal|Existing paid renewal is returned with alreadyProcessed true|SubscriptionRenewal record is seeded|Passed
Pending renewal exists for the same idempotency key|Retry wallet renewal|409 RENEWAL_REQUEST_EXISTS is returned without another debit|Pending SubscriptionRenewal record is seeded|Passed
"""),
        ("Atomic subscription and slot transition", """
Subscription expiry changes after quote|Activate renewal in transaction|409 RENEWAL_STATE_CHANGED aborts wallet and expiry changes|Concurrent update changes expireAt|Pending
Reserved slot ownership changes after quote|Activate renewal in transaction|409 SLOT_OWNERSHIP_CHANGED rolls back renewal and debit|Slot.updateMany matches fewer selected slots|Pending
"""),
    ],
    54: [
        ("Existing slot update and geometry", """
Existing named slot remains inside edited zone|Save floor layout|Slot coordinates update without creating a duplicate record|Floor, zone and slot IDs are seeded|Passed
Layout element has no named slot type|Save floor layout|Decoration is stored in layout but no Slot model record is created|Element is a non-slot decoration|Passed
"""),
        ("Layout rejection and rollback", """
Two slot elements use the same floor code|Save floor layout|HTTP 400 rejects duplicate slot names before Slot.bulkWrite and floor layout update|Layout request has repeated slot numbers|Passed
Slot being removed has an active session|Save a layout without that slot|Save is blocked; occupied slot remains available to the session|Active parking session references slot|Pending
"""),
    ],
    55: [
        ("Service card fields and selection", """
Active service includes image, duration and price|Open guest service catalog|Card renders those API fields without requiring login|Public service API resolves with one service|Passed
User changes selection between two services|Tap the second service|Detail panel reflects second service ID and fields|Two distinct services are loaded|Passed
"""),
        ("Booking link and request recovery", """
Service is selected|Tap Book service|Navigation carries its serviceId in the booking URL|Router is mocked and service ID is known|Passed
First catalog request fails, next page mount succeeds|Reopen service catalog|Fresh mount loads the new service list|Mock API changes response before remount|Pending
"""),
    ],
    56: [
        ("Registration field guards", """
Registration email is malformed|Submit sign-up form|Email validation appears and register API is not called|AuthScreen is in sign-up mode|Passed
Registration password confirmation differs|Submit sign-up form|Mismatch feedback appears; no registration request is sent|Other registration fields are valid|Passed
"""),
        ("Authentication response and navigation", """
Login API returns an error|Submit valid sign-in fields|Error is shown and no authenticated route opens|AuthContext login mock rejects|Pending
Registration succeeds|Submit valid sign-up fields|Verification step is opened with the registered email|AuthContext register mock resolves|Pending
"""),
    ],
    57: [
        ("Input validation and account feedback", """
Email input is blank|Tap email Sign in|Alert appears and login API is not called|Standalone LoginScreen is mounted|Passed
Password input is blank|Tap email Sign in|Alert appears and login API is not called|Email is otherwise valid|Passed
"""),
        ("Google provider response", """
Development build has valid Google ID token|Tap Google sign-in|googleLogin receives ID token and auth flow continues|Google client ID and provider response are mocked|Pending
Google provider returns cancellation or no token|Complete Google sign-in attempt|Error is shown and googleLogin is not called|Provider result lacks idToken|Pending
"""),
    ],
    58: [
        ("Registration request payload", """
All registration fields are valid|Submit registration|Register API receives expected name, email and password|RegisterScreen is mounted with mocked API|Pending
Registration API succeeds|Submit registration|OTP is requested and the registration OTP modal opens|sendOTP mock resolves for normalized email|Pending
"""),
        ("Client boundary and server rejection", """
Email has invalid format|Submit registration|Inline email error appears before any API call|Other fields are valid|Passed
Server reports duplicate email|Submit registration|Server error remains visible and success navigation does not occur|Register API rejects with duplicate-email response|Pending
"""),
    ],
    59: [
        ("Recovery request navigation", """
Registered email format is valid|Request reset OTP|forgotPassword API receives email and VerifyOTP opens|ForgotPassword screen and API are mocked|Pending
Email format is invalid|Request reset OTP|Client validation blocks the API call|ForgotPassword screen is mounted|Passed
"""),
        ("OTP mismatch and resend", """
OTP entered differs from issued token|Verify reset OTP|Error is displayed and screen remains on verification|Valid recovery email is in route params|Pending
Expired OTP is replaced by resend|Request a new OTP|New request is sent and user remains in recovery flow|Old OTP has expired|Pending
"""),
    ],
    60: [
        ("Reset route parameters and request", """
Verified email and OTP are present|Submit matching strong passwords|resetPassword API receives email, OTP and new password|ResetPasswordScreen route params are populated|Pending
Reset API succeeds|Submit reset request with route email and OTP|Success toast appears and navigation.popToTop runs after the API resolves|ResetPasswordScreen route params and API mock are valid|Pending
"""),
        ("Failure recovery", """
Reset API rejects expired OTP|Submit otherwise valid new password|Error is displayed and success screen is not opened|Server mock returns expired-OTP error|Pending
Reset API succeeds after retry|Submit corrected password|Success feedback appears only after resolved request|First reset call failed, second resolves|Pending
"""),
    ],
    61: [
        ("Vehicle empty state and default flag", """
Vehicle API returns no vehicles|Open vehicle list|Empty view and add-vehicle action are visible|Authenticated customer has zero vehicles|Passed
Vehicle list contains a default vehicle|Open vehicle list|Correct row displays the default indicator|Two owned vehicles are returned|Passed
"""),
        ("Scan prefill and mutation recovery", """
OCR returns plate and registration fields|Scan a registration-card image|AddVehicle fields are prefilled from scan response|Camera permission and OCR API are mocked|Pending
Delete vehicle API rejects an in-use vehicle|Confirm deletion|Error remains visible and row is not removed|Vehicle has active booking or subscription|Pending
"""),
    ],
    62: [
        ("Published versions and scroll gate", """
Policy list contains accepted and unaccepted versions|Open policy list|Each row shows the acceptance state of its current version|Policy API returns published versions|Passed
Long policy content has not been scrolled to end|Open policy detail|Acceptance action stays disabled until required reading position|PolicyDetail scroll event is mocked|Passed
"""),
        ("Acceptance result and stale version", """
Current policy version is unaccepted|Accept after reading|Acceptance API receives current version and UI updates|User session and published policy exist|Pending
New version replaces previously accepted version|Reopen policy detail|Current version requires a fresh acceptance|Acceptance record points to older version|Pending
"""),
    ],
    63: [
        ("Catalog image and list states", """
Service API returns image and price|Open ServiceListScreen|Card renders service image, name and price|Mobile catalog service returns one active service|Passed
Service API returns no records|Open ServiceListScreen|Empty state appears without stale card data|Catalog response is an empty array|Passed
"""),
        ("Selection and retry", """
Service card is selected|Tap Book service|CreateBooking receives selectedServiceId|Navigation mock records route params|Pending
Initial catalog request fails then recovers|Tap Retry|Error clears and service cards render|API mock succeeds on second call|Pending
"""),
    ],
    64: [
        ("Unread badge and filter composition", """
Inbox includes mixed read states|Filter to unread|Only unread items show and badge matches unread count|Notification API returns read and unread records|Passed
Inbox includes multiple types|Apply a type filter|Only matching type items remain visible|Filter control is mounted|Passed
"""),
        ("Socket lifecycle and rollback", """
Socket emits notification:new while inbox is open|Observe inbox update|New item and unread badge update without a reload|Authenticated socket is connected|Pending
Mark-read API fails after optimistic update|Mark a notification read|Optimistic change rolls back and error appears|Notification mutation service rejects|Pending
"""),
    ],
    65: [
        ("History fee arithmetic", """
History API returns sessions with different fees|Open parking history|Displayed total equals the sum of returned session fees|Customer has at least two completed sessions|Passed
History API returns no sessions|Open parking history|Empty state and zero total appear|Authenticated history response is []|Passed
"""),
        ("Refresh and error protection", """
New session is returned on the next request|Pull to refresh|List and total are replaced with the latest response|First and second API fixtures differ|Pending
History API rejects|Open parking history|Error is shown without displaying another user's data|Customer session remains authenticated|Pending
"""),
    ],
    66: [
        ("Dashboard metrics and state", """
Dashboard APIs return occupied and free slots|Open Staff dashboard|Usage values correspond to the API response|Staff token and floor data exist|Passed
Dashboard returns no active sessions|Open Staff dashboard|Zero and empty states display without a crash|Session response is empty|Passed
"""),
        ("Staff shortcuts and partial failure", """
Staff taps Live Grid shortcut|Open dashboard shortcut|Navigation opens LiveGrid route|StaffNavigator is mocked|Passed
One dashboard data request fails|Load dashboard|Screen remains usable and shows its error or fallback state|Other dashboard requests still resolve|Pending
"""),
    ],
    67: [
        ("Search normalization and customer detail", """
Customer name has mixed case|Search with lowercase text|Matching customer remains in filtered list|Staff API returns the customer|Passed
Customer has vehicles and status|Open customer detail|Correct email, phone, vehicles and status render|Selected record is in list|Passed
"""),
        ("Edit guard and update recovery", """
Edited phone has invalid format|Save customer detail|Validation blocks update API and shows an error|Staff is editing a Customer record|Passed
Update API rejects|Save valid customer detail|Old visible values remain and error is shown|Customer update request is mocked to fail|Pending
"""),
    ],
    68: [
        ("Filter and search intersection", """
Active and expired subscriptions share a customer name|Search name with Active filter|Only active matching subscription remains|Subscription API returns both statuses|Passed
Search text matches a vehicle plate|Search subscriptions|Matching subscription is shown|Customer vehicle list includes the plate|Passed
"""),
        ("Statistics isolation and refresh", """
List API succeeds but statistics API fails|Open subscription management|List remains visible without a fabricated metric strip|Promise.allSettled returns one rejection|Passed
Backend adds a subscription after first load|Pull to refresh|List and counts refresh from new response|Second API result contains one more subscription|Pending
"""),
    ],
    69: [
        ("Loading and retry states", """
Package request is still pending|Open ticket packages|Skeleton rows are visible until request settles|Staff package API promise is unresolved|Passed
Initial package request fails then succeeds|Tap Retry|Error clears and returned packages render|staffService.getTicketPackages changes response|Pending
"""),
        ("Refresh and package metadata", """
Catalog changes after first load|Pull to refresh|Updated package count and rows are shown|First and second package API fixtures differ|Pending
Inactive yearly package is returned|Inspect package row|Inactive state, YEARLY type and formatted VND price appear|Package has isActive false and yearly type|Passed
"""),
    ],
}

# Corrections to earlier unit-matrix wording where the current UI takes a
# different path.  Only the HSH report is changed; the unit workbook is not.
BASE_OVERRIDES = {
    49: {
        3: ("Popup has opener", "Mount callback with a hash that has no id_token",
            "A GOOGLE_OAUTH message with null idToken is posted to the same-origin opener; popup closes", "B"),
    },
    58: {
        4: ("Phone input fails the seven-to-twenty-character pattern",
            "Submit registration with an invalid phone",
            "Phone validation appears and registration API is not called", "A"),
    },
    68: {
        2: ("Mixed active, pending, expired and cancelled records exist",
            "Select a status filter",
            "Only subscriptions with the selected status remain visible", "N"),
    },
}

CODE_REF = {
    40: "backend/src/controllers/authController.js",
    41: "backend/src/controllers/authController.js",
    42: "backend/src/controllers/authController.js",
    43: "backend/src/services/walletService.js",
    44: "backend/src/controllers/profileController.js",
    45: "backend/src/services/violationService.js",
    46: "backend/src/controllers/adminController.js",
    47: "backend/src/sockets/notificationSocket.js",
    48: "backend/src/services/parkingScheduler.js",
    49: "frontend/src/pages/OAuthCallback.jsx",
    50: "backend/src/controllers/bookingController.js",
    51: "backend/src/controllers/bookingController.js",
    52: "backend/src/controllers/bookingController.js",
    53: "backend/src/services/subscriptionRenewalService.js",
    54: "backend/src/controllers/parkingFloorController.js",
    55: "frontend/src/pages/Guest/ServiceList.jsx",
    56: "mobile/src/screens/auth/AuthScreen.tsx",
    57: "mobile/src/screens/auth/LoginScreen.tsx",
    58: "mobile/src/screens/auth/RegisterScreen.tsx",
    59: "mobile/src/screens/auth/ForgotPasswordScreen.tsx",
    60: "mobile/src/screens/auth/ResetPasswordScreen.tsx",
    61: "mobile/src/screens/profile/VehicleListScreen.tsx",
    62: "mobile/src/screens/profile/PolicyDetailScreen.tsx",
    63: "mobile/src/screens/profile/ServiceListScreen.tsx",
    64: "mobile/src/screens/notifications/NotificationsScreen.tsx",
    65: "mobile/src/screens/customer/ParkingHistoryScreen.tsx",
    66: "mobile/src/screens/staff/StaffDashboardScreen.tsx",
    67: "mobile/src/screens/staff/CustomerManagementScreen.tsx",
    68: "mobile/src/screens/staff/StaffSubscriptionManagementScreen.tsx",
    69: "mobile/src/screens/staff/StaffTicketPackagesScreen.tsx",
}

def extra_cases(num):
    groups = []
    for title, raw in EXTRA_GROUPS[num]:
        cases = [tuple(part.strip() for part in line.split("|"))
                 for line in raw.strip().splitlines() if line.strip()]
        assert all(len(case) == 5 and case[-1] in {"Passed", "Pending"} for case in cases), num
        groups.append((title, cases))
    return groups

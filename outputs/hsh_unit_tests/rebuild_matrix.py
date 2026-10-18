"""Rebuild only Ho Sy Hung's appended unit-test matrices in the supplied workbook."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re
from lxml import etree as ET

SOURCE = Path(r"D:\ki7\WDP\Valo_Parking\outputs\hsh_unit_tests\Report5_Unit_Test_Ho_Sy_Hung_Completed.xlsx")
DEST = SOURCE.with_name("Report5_Unit_Test_Ho_Sy_Hung_Revised.xlsx")
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
Q = lambda local: f"{{{NS}}}{local}"

# Each line is a real test path: domain state | request/user action | expected confirmation | type.
# Repeated states/actions become shared matrix rows rather than copied case-by-case prose.
SPECS = {
40: ("Email/password sign-in, account guards and token rotation", "User lookup, password comparison and token issuer are mocked", "Login request contains an email and password", "accountState", "credentialInput", """
Active customer with stored password|Correct email and password|User and access/refresh tokens returned|N
No user for email|Known-format email and any password|Login rejected; no tokens issued|A
Active customer with stored password|Wrong password|Login rejected; no tokens issued|A
Locked or inactive account|Correct email and password|Account status blocks login|A
Active customer with prior refresh token|Correct email and password|New refresh token stored; old one revoked|B"""),
41: ("Google ID token verification and account linking", "Google token verifier, User model and JWT issuer are mocked", "Google sign-in request reaches the auth controller", "googleAccountState", "idTokenInput", """
No matching email or Google ID|Valid token for new email|Customer/profile created and JWTs returned|N
Email match without Google ID|Valid token for same email|Google ID linked and JWTs returned|N
Existing Google-linked account|Valid token for linked Google ID|Existing account reused; no duplicate user|N
No account lookup|Missing idToken|Request rejected; no JWT issued|A
No account lookup|Expired or wrong-audience token|Request rejected; no user created|A"""),
42: ("Forgot-password OTP issue, verification and password reset", "User, OTP/email and password-hash dependencies are mocked", "Reset requests use the same email and OTP flow", "accountOtpState", "resetAction", """
Registered email without active OTP|Request password reset|15-minute OTP stored and email sent|N
Unregistered email|Request password reset|No OTP created for unknown account|A
Matching unexpired OTP|Verify OTP|OTP accepted for reset|N
Expired OTP|Verify OTP|Expired OTP rejected|B
Nonmatching OTP|Submit new password|Password and tokens remain unchanged|A
Matching unexpired OTP|Submit valid new password|New hash stored; OTP and refresh tokens cleared|N"""),
43: ("Wallet balance, debit/credit and idempotent transactions", "Wallet and WalletTransaction models are mocked", "All money values use VND minor-unit amounts", "walletState", "walletOperation", """
User has no wallet|Get wallet|Zero-balance wallet created|N
Active wallet balance is 100000|Debit 30000|Balance is 70000; PAYMENT transaction saved|N
Active wallet balance equals debit|Debit entire balance|Balance reaches zero without going negative|B
Active wallet balance below debit|Debit requested amount|Insufficient balance; no wallet mutation|A
Frozen wallet|Debit requested amount|Wallet state blocks transaction|A
Completed transaction has same idempotency key|Retry same debit|No duplicate transaction or balance change|N"""),
44: ("Avatar upload validation and Cloudinary persistence", "Authenticated user, upload middleware and Cloudinary are mocked", "Avatar update request carries one image file", "uploadServiceState", "avatarFile", """
Cloudinary succeeds|JPEG image below 5 MB|Avatar URL is stored on user|N
Cloudinary succeeds|Image exactly 5 MB|Boundary-size image accepted|B
Upload middleware active|Image above 5 MB|File rejected before Cloudinary call|A
Upload middleware active|Unsupported MIME type|File type rejected|A
Cloudinary fails|Valid JPEG image|Upload error returned; avatar URL unchanged|A"""),
45: ("Violation creation, payment, ownership and cancellation", "Violation, vehicle, wallet and notification services are mocked", "Requests use authenticated Staff/Admin or Customer roles", "violationState", "violationAction", """
Staff and vehicle owned by target user|Create valid violation|Pending violation saved and user notified|N
Staff and vehicle belongs to another user|Create violation|Ownership check rejects; no record saved|A
Customer owns pending violation; wallet funded|Pay violation|Wallet debited once; violation marked PAID|N
Customer does not own violation|Read or pay violation|Access denied; no wallet debit|A
Pending violation receives concurrent payments|Submit payment twice|Only one payment and PAID transition occur|B
Admin and pending violation|Cancel violation|Violation marked CANCELLED|N"""),
46: ("Administrative action logging and recent-log retrieval", "AdminActionLog model and account mutations are mocked", "Log entries include actor, action, target and timestamp", "adminMutationState", "auditAction", """
Status update succeeds|Update user status|Status-change audit record saved|N
Profile update succeeds|Update user fields|Update audit record saved|N
Account deletion succeeds|Delete user|Delete audit record saved|N
Admin mutation fails validation|Submit invalid update|No false success audit record created|A
Multiple audit records exist|List recent actions|Newest-first audit list returned|N"""),
47: ("Notification socket authentication, fan-out and read state", "Socket.IO server, JWT verifier and notification model are mocked", "Connected sockets are tracked by authenticated user ID", "socketUserState", "socketEvent", """
Valid JWT; one client|Connect with auth token|Handshake succeeds; unread count returned|N
Missing or invalid JWT|Connect without valid token|Handshake rejected|A
Valid JWT; two clients for same user|Emit notification:new|Both client sockets receive event|N
User has unread notification|Emit notification:read|Item marked read; unread count updated|N
User has multiple unread items|Emit notification:readAll|All marked read; unread count is zero|N
Two connected sockets; one disconnects|Disconnect first client|Remaining client still receives events|B"""),
48: ("VIP entitlement expiry warning scheduler", "Clock, entitlement records and notification dispatch are mocked", "Scheduler checks active entitlements and warning timestamps", "entitlementState", "schedulerRun", """
Active; expires in under 3 days; not warned|Run VIP check|One warning sent; timestamp persisted|N
Active; expires in exactly 3 days; not warned|Run VIP check|Boundary entitlement selected for warning|B
Active; expires after 3 days; not warned|Run VIP check|No early warning sent|B
Active; warning timestamp already present|Run VIP check again|No duplicate warning sent|N
Entitlement just expired|Run VIP check|Expired state and slot release processed|N"""),
49: ("OAuth popup callback token/error messaging", "window.opener, location hash and close are mocked", "Allowed application origin is available to the callback", "popupState", "oauthResponse", """
Popup has opener|Hash contains id_token|Token posted to opener; popup closed|N
Popup has opener|Hash contains OAuth error|Error posted; no token leaked|A
Popup has opener|Hash has no id_token|No success message posted|A
Popup has no opener|Hash contains id_token|No JavaScript crash or external token post|B"""),
50: ("Booking creation with slot, vehicle and payment guards", "Booking, slot, vehicle, wallet and PayOS services are mocked", "Authenticated customer submits a booking interval", "bookingState", "bookingRequest", """
Owned vehicle; free slot; funded wallet|Book 60 minutes with wallet|PAID booking and price snapshot stored|N
Owned vehicle; free slot; funded wallet|Book 30 minutes|Minimum duration accepted|B
Owned vehicle; free slot; funded wallet|Book over 24 hours|Duration limit rejects booking|B
Vehicle belongs to another user|Submit booking|No slot hold or wallet debit|A
Slot conflicts or reserved for VIP|Submit booking|Conflict rejected; no wallet debit|A
Owned vehicle; free slot; PayOS paid|Book with VietQR|Booking becomes PAID after verification|N"""),
51: ("VietQR booking payment-status verification", "Booking and PayOS payment-status dependencies are mocked", "Status request uses an authenticated customer and orderCode", "paymentBookingState", "paymentCheck", """
Owned pending booking; PayOS says PAID|Check payment status|Booking marked PAID with payment snapshot|N
Owned pending booking; PayOS says PENDING|Check payment status|Booking remains pending; no parking right|N
Booking belongs to another user|Check payment status|Ownership guard denies access|A
Already-paid booking queried again|Check payment status|PAID returned without another PayOS request|N
Owned pending booking; PayOS says CANCELLED|Check payment status|Booking cancelled; voucher reservation released|N"""),
52: ("Booking cancellation and snapshot-policy wallet refund", "Booking, refund policy snapshot and wallet are mocked", "Cancellation uses authenticated customer context", "cancellationState", "cancelRequest", """
Paid booking with partial-refund policy snapshot|Cancel booking|Response includes snapshot-tier refund breakdown|N
Paid booking before start|Confirm cancellation|CANCELLED; one wallet REFUND recorded|N
Booking started or not PAID|Confirm cancellation|State/time guard rejects cancellation|A
Booking belongs to another user|Confirm cancellation|Access denied; no refund|A
Paid booking receives concurrent requests|Confirm cancellation twice|Event key prevents duplicate wallet credit|B
Paid booking; computed refund below 1000|Confirm cancellation|Below-threshold refund is not created|B"""),
53: ("Subscription renewal quote and wallet/PayOS settlement", "Subscription, eligibility, wallet and PayOS are mocked", "Existing subscription and slot entitlements are prepared", "renewalState", "renewalOperation", """
Active subscription inside renewal window|Request renewal quote|Price and new expiry computed per slot|N
Active subscription outside renewal window|Request renewal quote|RENEWAL_WINDOW_NOT_OPEN returned|A
Eligible subscription; wallet funded|Renew with WALLET|Wallet debited; subscription/slot expiry extended|N
Eligible subscription; wallet insufficient|Renew with WALLET|No debit or expiry extension|A
Eligible pending renewal; PayOS says PAID|Verify renewal payment|Renewal activated exactly once|N
Entitlement-based subscription|Call legacy renewal API|USE_ENTITLEMENT_RENEWAL returned|B"""),
54: ("Parking floor layout save and slot safety checks", "Floor, Zone, Slot and reservation models are mocked", "Admin/Staff submits a layout with zone coordinates", "layoutSlotState", "layoutMutation", """
Named slot lies within zone|Save layout|Zone and slot created or updated|N
Duplicate slot code on floor|Save layout|Duplicate code rejected|A
Slot lies outside its zone|Save layout|Invalid coordinates rejected|A
Slot is VIP-reserved|Remove slot from layout|Reserved slot cannot be deleted|A
Slot has active parking session|Remove slot from layout|Occupied slot cannot be deleted|A
Valid named slot and decoration element|Save layout|Only named slot becomes Slot record|N"""),
55: ("Public service list, details and booking link", "Guest ServiceList renders with mocked service API and router", "Catalog request is made without authentication", "serviceCatalogState", "guestInteraction", """
API returns active services|Open service page|Names, prices, durations and images shown|N
API returns several services|Select another service|Selected service detail is shown|N
Service is selected|Click book service|/booking URL includes serviceId query parameter|N
API returns empty list|Open service page|Empty state shown without crash|B
API returns error|Open service page|Error shown without stale catalog|A"""),
56: ("Mobile combined sign-in and registration screen", "AuthScreen renders with mocked AuthContext and navigation", "Email/password form state can be changed by the test", "authFormState", "authScreenAction", """
Sign-in and sign-up tabs available|Switch auth tab|Correct form is displayed|N
Valid sign-in fields|Submit sign-in|Login called; session navigation follows|N
Email or password missing|Submit sign-in|Validation shown; login API not called|A
Valid registration fields|Submit registration|Register called; verification step opened|N
Auth API returns error|Submit current form|Error shown; no authenticated navigation|A"""),
57: ("Standalone mobile login screen and Google sign-in", "LoginScreen, AuthContext and Google provider are mocked", "Screen is rendered directly for this isolated unit test", "loginClientState", "loginScreenAction", """
Valid email and password|Submit email sign-in|Login called; AuthContext navigates|N
Email or password missing|Submit email sign-in|Alert shown; login not called|A
Google client ID in development build|Tap Google sign-in|ID token sent to googleLogin|N
App runs in Expo Go|Tap Google sign-in|Development-build warning shown|A
Google response has no ID token|Handle Google response|Error shown; googleLogin not called|A"""),
58: ("Standalone mobile registration validation", "RegisterScreen and registration API are mocked", "Screen is rendered directly for this isolated unit test", "registrationInput", "registrationAction", """
Valid account fields|Submit registration|Register called; OTP step opened|N
Malformed email|Submit registration|Email validation shown; no API request|A
Weak password|Submit registration|Password validation shown; no API request|A
Password confirmation mismatch|Submit registration|Mismatch shown; no API request|A
API reports duplicate email|Submit registration|Server error shown; no success state|A"""),
59: ("Mobile forgot-password request and OTP verification", "ForgotPassword and VerifyOTP screens use mocked auth API", "Navigation between request and OTP steps is mocked", "recoveryInputState", "recoveryAction", """
Registered valid email|Request OTP|Forgot-password API called; OTP screen opened|N
Malformed email|Request OTP|Email error shown; API not called|A
Matching unexpired OTP|Verify OTP|Reset-password step opened|N
Nonmatching OTP|Verify OTP|Error shown; OTP screen retained|A
OTP expired at 15 minutes|Verify OTP|Expired code rejected; resend available|B"""),
60: ("Mobile password reset submission", "ResetPasswordScreen and reset API are mocked", "Verified recovery email and OTP are in navigation params", "newPasswordState", "resetAction", """
Matching valid password fields|Submit reset|resetPassword called; success shown|N
New password blank|Submit reset|Validation shown; API not called|A
Confirmation differs|Submit reset|Mismatch shown; API not called|A
OTP expires before save|Submit reset|API error shown; no false success|A"""),
61: ("Mobile vehicle list, create, edit and registration scan", "Vehicle screens, camera OCR and vehicle API are mocked", "Authenticated customer has a known vehicle list", "vehicleDataState", "vehicleUiAction", """
User has vehicles|Open vehicle list|Own vehicles and default marker shown|N
Valid new vehicle; below limit|Add vehicle|Create API called; list refreshed|N
User already has three vehicles|Add fourth vehicle|Limit rejection shown|B
Valid registration-card image|Scan registration card|Base64 sent; extracted fields prefilled|N
Vehicle belongs to current user|Edit or set default|Relevant API called; UI updated|N
Vehicle belongs to another user|Edit or delete vehicle|API rejects; no data change|A"""),
62: ("Mobile policy list, version detail and acceptance", "Policy list/detail screens and acceptance API are mocked", "Authenticated customer has policy acceptance state", "policyVersionState", "policyUiAction", """
Published policies exist|Open policy list|Titles, versions and acceptance shown|N
Published policy selected|Open policy detail|Current version content displayed|N
Current version unaccepted|Tap accept|Mobile acceptance sent; status updated|N
Older version accepted; new version published|Open policy detail|Current version requires acceptance|B
Policy API returns error|Load list or detail|Error shown; acceptance not faked|A"""),
63: ("Mobile service catalog and booking navigation", "ServiceListScreen, catalog API and navigation are mocked", "Authenticated customer opens the service catalog", "mobileCatalogState", "serviceUiAction", """
API returns active services|Open service list|Name, description, price and duration shown|N
Service selected|Tap book service|CreateBooking receives selectedServiceId|N
API returns empty list|Open service list|Empty state shown|B
Catalog API fails|Open service list|Error and retry affordance shown|A"""),
64: ("Mobile notification inbox, filters and socket updates", "Notification API, socket and local badge state are mocked", "Inbox is rendered for one authenticated customer", "inboxState", "notificationUiAction", """
Read and unread items exist|Open inbox|List and unread count displayed|N
Unread item exists|Mark item read|API updates item; badge decreases|N
Mixed notification types exist|Apply unread or type filter|Only matching items displayed|N
Notification item exists|Delete item|Item hidden after successful API response|N
Mutation API fails|Mark read or delete|Optimistic state rolled back; error shown|A
Socket sends notification:new|Keep inbox open|List and badge update without reload|N"""),
65: ("Mobile parking-session history and fee total", "ParkingHistoryScreen and history API are mocked", "Customer identity is fixed for the history request", "historyResponseState", "historyUiAction", """
Customer has past sessions|Open history|Sessions, duration and fee shown|N
Customer has multiple sessions|Load history|Total equals sum of returned fees|N
Customer has no sessions|Open history|Empty state and zero total shown|B
New session exists after first load|Pull to refresh|List and fee total reloaded|N
History API fails|Load history|Error shown; no foreign records merged|A"""),
66: ("Staff dashboard metrics, sessions and quick links", "StaffDashboardScreen and dashboard APIs are mocked", "Authenticated Staff navigation stack is available", "dashboardDataState", "staffDashboardAction", """
Floor, session and booking APIs return data|Open dashboard|Slot usage and today's bookings shown|N
Active sessions exist|Open dashboard|Recent sessions and average duration shown|N
No active sessions exist|Open dashboard|Zero metrics and empty list shown|B
Staff navigation available|Tap scanner/grid/session shortcut|Correct destination opened|N
One dashboard API fails|Load dashboard|Safe error/fallback shown; no crash|A"""),
67: ("Staff customer lookup, edit and account status", "CustomerManagementScreen and staff user API are mocked", "Authenticated Staff may mutate Customer accounts only", "customerRecordState", "customerUiAction", """
Customer records exist|Search name, email or phone|Matching customers listed|N
Customer selected|Open customer detail|Correct customer profile displayed|N
Valid name and phone changes|Save customer edit|Update API called; new data shown|N
Invalid phone input|Save customer edit|Client validation blocks API request|A
Active customer selected|Lock account|Customer status becomes locked|N
Locked customer selected|Unlock account|Customer status becomes active|N
Staff or Admin target ID selected|Edit via staff user API|Backend rejects non-Customer target|A"""),
68: ("Staff subscription list, filters and statistics", "StaffSubscriptionManagementScreen APIs are mocked", "Authenticated Staff opens subscription management", "subscriptionDataState", "subscriptionUiAction", """
API returns subscriptions and stats|Open subscriptions|List and statistics displayed|N
Mixed status records exist|Filter active, expiring or renewal|List and counts match selected filter|N
Name, email or plate is searchable|Search subscriptions|Matching subscriptions returned|N
List API returns empty|Open subscriptions|Empty state shown|B
Stats API fails; list succeeds|Open subscriptions|List shown with safe statistic fallback|A"""),
69: ("Staff read-only ticket-package catalog", "StaffTicketPackagesScreen and package API are mocked", "Authenticated Staff has read-only package access", "packageCatalogState", "staffPackageAction", """
API returns ticket packages|Open package catalog|Name, price, term and status shown|N
API returns empty list|Open package catalog|Empty state shown|B
Package API fails|Open package catalog|Error and retry shown|A
Staff read-only role|Interact with package list|No create, edit or delete control exposed|N"""),
}

def cell(row, address, create=True):
    c = row.find(f"{Q('c')}[@r='{address}']")
    if c is None and create:
        c = ET.SubElement(row, Q("c"), r=address)
    return c

def write_text(row, address, value, style=None):
    c = cell(row, address)
    if style is not None:
        c.set("s", style)
    for child in list(c):
        c.remove(child)
    if value is None or value == "":
        c.attrib.pop("t", None)
        return
    c.set("t", "inlineStr")
    inline = ET.SubElement(c, Q("is"))
    t = ET.SubElement(inline, Q("t"))
    t.text = str(value)

def write_cache(row, address, value):
    c = cell(row, address)
    v = c.find(Q("v"))
    if v is None:
        v = ET.SubElement(c, Q("v"))
    v.text = str(value)

def parse_cases(raw):
    cases = []
    for line in raw.strip().splitlines():
        parts = [x.strip() for x in line.split("|")]
        assert len(parts) == 4, line
        cases.append(parts)
    assert 1 <= len(cases) <= 15
    return cases

def unique(items):
    return list(dict.fromkeys(items))

def render_sheet(data, number, template):
    root = ET.fromstring(data)
    requirement, prep1, prep2, state_group, action_group, raw = SPECS[number]
    cases = parse_cases(raw)
    states = unique([x[0] for x in cases])
    actions = unique([x[1] for x in cases])
    outcomes = unique([x[2] for x in cases])
    assert len(states) + len(actions) + 4 <= 22, number
    assert len(outcomes) <= 8, number
    sheet_data = root.find(Q("sheetData"))
    rows = {int(row.get("r")): row for row in sheet_data.findall(Q("row"))}
    template_rows = {int(row.get("r")): row for row in template.find(Q("sheetData")).findall(Q("row"))}

    # The previous draft merged every case description across B:D and enlarged
    # its rows. Undo only those new merges and restore the original row rhythm.
    merges = root.find(Q("mergeCells"))
    if merges is not None:
        for m in list(merges):
            ref = m.get("ref", "")
            match = re.fullmatch(r"B(\d+):D\1", ref)
            if match and 14 <= int(match.group(1)) <= 40:
                merges.remove(m)
        merges.set("count", str(len(merges)))
    for r in range(10, 41):
        row, tr = rows[r], template_rows[r]
        for key in ("ht", "customHeight"):
            if key in tr.attrib:
                row.set(key, tr.get(key))
            else:
                row.attrib.pop(key, None)
        for col in ("B", "C", "D"):
            write_text(row, f"{col}{r}", None, cell(tr, f"{col}{r}", False).get("s") if cell(tr, f"{col}{r}", False) is not None else None)
        for n in range(15):
            write_text(row, f"{chr(70+n)}{r}", None)

    write_text(rows[5], "C5", requirement)
    write_text(rows[3], "C3", "Ho Sy Hung")
    write_text(rows[10], "B10", "Precondition", cell(template_rows[10], "B10").get("s"))
    write_text(rows[11], "D11", prep1, cell(template_rows[11], "D11").get("s"))
    write_text(rows[12], "D12", prep2, cell(template_rows[12], "D12").get("s"))
    state_start = 13
    action_start = state_start + 1 + len(states)
    write_text(rows[state_start], f"B{state_start}", state_group, cell(template_rows[13], "B13").get("s"))
    for i, state in enumerate(states):
        r = state_start + 1 + i
        write_text(rows[r], f"D{r}", state, cell(template_rows[14], "D14").get("s"))
    write_text(rows[action_start], f"B{action_start}", action_group, cell(template_rows[13], "B13").get("s"))
    action_rows = {}
    for i, action in enumerate(actions):
        r = action_start + 1 + i
        action_rows[action] = r
        write_text(rows[r], f"D{r}", action, cell(template_rows[14], "D14").get("s"))
    write_text(rows[32], "B32", "Return", cell(template_rows[32], "B32").get("s"))
    outcome_rows = {}
    for i, outcome in enumerate(outcomes):
        r = 33 + i
        outcome_rows[outcome] = r
        kinds = {case[3] for case in cases if case[2] == outcome}
        label = "Exception" if kinds == {"A"} else ("Guard" if kinds == {"B"} else "Return")
        write_text(rows[r], f"B{r}", label, cell(template_rows[33], "B33").get("s"))
        write_text(rows[r], f"D{r}", outcome, cell(template_rows[33], "D33").get("s"))

    for i, (state, action, outcome, case_type) in enumerate(cases):
        col = chr(70+i)
        write_text(rows[9], f"{col}9", f"UTCID{i+1:02d}")
        for r in (11, 12, state_start + 1 + states.index(state), action_rows[action], outcome_rows[outcome]):
            write_text(rows[r], f"{col}{r}", "O")
        write_text(rows[41], f"{col}41", case_type)
        write_text(rows[42], f"{col}42", None)
    for i in range(len(cases), 15):
        col = chr(70+i)
        write_text(rows[9], f"{col}9", None)
        write_text(rows[41], f"{col}41", None)
        write_text(rows[42], f"{col}42", None)
    counts = Counter(c[3] for c in cases)
    # Cached values for Excel/Sheets previews. Existing formula text remains.
    for address, val in (("A7",0),("C7",0),("F7",len(cases)),("L7",counts["N"]),("M7",counts["A"]),("N7",counts["B"]),("O7",len(cases))):
        write_cache(rows[7],address,val)
    return ET.tostring(root,xml_declaration=True,encoding="UTF-8",standalone=True), cases, requirement

def main():
    with ZipFile(SOURCE) as zin:
        names = zin.namelist()
        # In this workbook the four front sheets precede the 39 supplied tests.
        template = ET.fromstring(zin.read("xl/worksheets/sheet42.xml")) # 38. valoAIChat
        replacements = {}
        all_counts = Counter()
        for num in SPECS:
            part = f"xl/worksheets/sheet{num+4}.xml"
            assert part in names, part
            updated, cases, req = render_sheet(zin.read(part), num, template)
            replacements[part] = updated
            all_counts.update(c[3] for c in cases)
            print(f"{num}: {len(cases)} cases; {req}")
        functions = ET.fromstring(zin.read("xl/worksheets/sheet3.xml"))
        function_rows = {int(row.get("r")): row for row in functions.find(Q("sheetData")).findall(Q("row"))}
        for num, (requirement, prep1, *_rest) in SPECS.items():
            row = function_rows[num + 10]
            write_text(row, f"G{num+10}", requirement)
            write_text(row, f"H{num+10}", prep1)
        replacements["xl/worksheets/sheet3.xml"] = ET.tostring(functions,xml_declaration=True,encoding="UTF-8",standalone=True)
        statistics = ET.fromstring(zin.read("xl/worksheets/sheet4.xml"))
        stat_rows = {int(row.get("r")): row for row in statistics.find(Q("sheetData")).findall(Q("row"))}
        for num, spec in SPECS.items():
            cases = parse_cases(spec[-1])
            count = Counter(case[3] for case in cases)
            r = num + 11
            for col, value in (("C", 0), ("D", 0), ("E", len(cases)), ("F", count["N"]), ("G", count["A"]), ("H", count["B"]), ("I", len(cases))):
                write_cache(stat_rows[r], f"{col}{r}", value)
        totals = {}
        for col in "CDEFGHI":
            total = 0
            for r in range(12, 81):
                v = cell(stat_rows[r], f"{col}{r}", False).find(Q("v"))
                total += int(float(v.text)) if v is not None and v.text else 0
            totals[col] = total
            write_cache(stat_rows[187], f"{col}187", total)
        for r, value in ((189, (totals["C"]+totals["D"])*100/totals["I"]), (190, totals["C"]*100/totals["I"]), (191, totals["F"]*100/totals["I"]), (192, totals["G"]*100/totals["I"]), (193, totals["H"]*100/totals["I"])):
            write_cache(stat_rows[r], f"D{r}", value)
        replacements["xl/worksheets/sheet4.xml"] = ET.tostring(statistics,xml_declaration=True,encoding="UTF-8",standalone=True)
        with ZipFile(DEST, "w") as zout:
            for info in zin.infolist():
                zout.writestr(info, replacements.get(info.filename, zin.read(info.filename)))
    print("OUTPUT", DEST, "CASES", sum(all_counts.values()), dict(all_counts))

if __name__ == "__main__":
    main()

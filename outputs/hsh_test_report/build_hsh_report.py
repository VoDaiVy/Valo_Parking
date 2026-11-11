"""Append Ho Sy Hung's report sheets while preserving the supplied 26 reports."""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from math import ceil
from pathlib import Path
from sys import path as sys_path
from zipfile import ZipFile

from lxml import etree as ET

sys_path.insert(0, str(Path(__file__).resolve().parents[1] / "hsh_unit_tests"))
from rebuild_matrix import SPECS, parse_cases  # noqa: E402
from report_expansion import BASE_OVERRIDES, CODE_REF, extra_cases

SOURCE = Path(r"C:\Users\ADMIN\Downloads\Report5_Test_Report.xlsx")
UNIT = Path(r"D:\ki7\WDP\Valo_Parking\outputs\hsh_unit_tests\Report5_Unit_Test_Ho_Sy_Hung_Revised.xlsx")
OUTPUT = Path(__file__).with_name("Report5_Test_Report_Ho_Sy_Hung.xlsx")
S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
Q = lambda n: f"{{{S}}}{n}"

ENTRY = {
  40: "POST /api/auth/login", 41: "POST /api/auth/google",
  42: "the password-recovery API", 43: "walletService", 44: "POST /api/profile/avatar",
  45: "the violation API", 46: "the AdminActionLog flow",
  47: "the Socket.IO notification namespace", 48: "checkVIPSubscriptions",
  49: "OAuthCallback.jsx", 50: "POST /api/bookings", 51: "GET /api/bookings/status/:orderCode",
  52: "the booking cancellation flow", 53: "the subscription renewal API",
  54: "the parking layout save API", 55: "ServiceList.jsx",
  56: "AuthScreen", 57: "LoginScreen", 58: "RegisterScreen",
  59: "ForgotPassword/VerifyOTP screens", 60: "ResetPasswordScreen",
  61: "the mobile vehicle screens", 62: "the mobile policy screens",
  63: "ServiceListScreen", 64: "NotificationsScreen",
  65: "ParkingHistoryScreen", 66: "StaffDashboardScreen",
  67: "CustomerManagementScreen", 68: "StaffSubscriptionManagementScreen",
  69: "StaffTicketPackagesScreen",
}

# The supplied reports divide each feature into named workflows.  These
# boundaries preserve that presentation instead of putting all cases under one
# generic function heading.
GROUPS = {
  40: [("Credential authentication and account status",1,4),("Refresh token rotation",5,5)],
  41: [("Google account creation and linking",1,3),("Google token validation",4,5)],
  42: [("Password-reset OTP request",1,2),("OTP verification",3,5),("Password update and token cleanup",6,6)],
  43: [("Wallet initialization",1,1),("Debit and balance guards",2,5),("Idempotent transaction retry",6,6)],
  44: [("Avatar upload and size boundary",1,2),("Image validation",3,4),("Cloudinary failure handling",5,5)],
  45: [("Violation creation",1,2),("Payment and ownership",3,5),("Administrative cancellation",6,6)],
  46: [("Audit creation for account mutations",1,4),("Recent action history",5,5)],
  47: [("Authenticated socket handshake",1,2),("Multi-client event delivery",3,3),("Read and unread synchronization",4,5),("Disconnect resilience",6,6)],
  48: [("VIP expiry warnings and deduplication",1,4),("Entitlement expiry and slot release",5,5)],
  49: [("OAuth callback token and error handling",1,3),("Missing opener safety",4,4)],
  50: [("Booking creation and duration limits",1,3),("Vehicle and slot guards",4,5),("VietQR settlement",6,6)],
  51: [("PayOS status polling",1,2),("Booking ownership",3,3),("Repeat and cancelled payments",4,5)],
  52: [("Cancellation and refund calculation",1,2),("State and ownership guards",3,4),("Refund idempotency and threshold",5,6)],
  53: [("Renewal quotation and window",1,2),("Wallet settlement",3,4),("PayOS settlement",5,5),("Legacy renewal guard",6,6)],
  54: [("Layout and coordinate validation",1,3),("Protected slot deletion",4,5),("Named-slot persistence",6,6)],
  55: [("Public service catalog and detail",1,2),("Booking navigation",3,3),("Empty and error states",4,5)],
  56: [("Authentication tab navigation",1,1),("Email sign-in and validation",2,3),("Registration and API recovery",4,5)],
  57: [("Email/password login",1,2),("Google sign-in and environment guards",3,5)],
  58: [("Successful registration",1,1),("Client-side field validation",2,4),("Duplicate-email response",5,5)],
  59: [("OTP request",1,2),("OTP verification and expiry",3,5)],
  60: [("Successful password reset",1,1),("Password field validation",2,3),("Expired OTP response",4,4)],
  61: [("Vehicle list",1,1),("Vehicle creation and limit",2,3),("Registration-card scanning",4,4),("Edit and ownership",5,6)],
  62: [("Published policy list and detail",1,2),("Acceptance and version changes",3,4),("Policy API error",5,5)],
  63: [("Mobile service catalog",1,1),("Booking navigation",2,2),("Empty and failure states",3,4)],
  64: [("Notification inbox",1,1),("Read state and filtering",2,3),("Delete and mutation recovery",4,5),("Socket update",6,6)],
  65: [("History list, total and empty state",1,3),("Refresh",4,4),("History API error",5,5)],
  66: [("Staff dashboard metrics",1,3),("Quick navigation",4,4),("Partial API failure",5,5)],
  67: [("Customer search and detail",1,2),("Profile editing and validation",3,4),("Lock and unlock",5,6),("Non-customer authorization",7,7)],
  68: [("Subscription list and statistics",1,1),("Filter and search",2,3),("Empty and partial-error handling",4,5)],
  69: [("Ticket package catalog states",1,3),("Staff read-only access",4,4)],
}

# Feature-specific instructions keep the procedure/action column aligned with
# the implementation named in the task and unit-test documents.
STEPS = {
  40: ("Seed User and UserToken records for {state}","Send {action} to POST /api/auth/login","Inspect HTTP status, issued JWTs and refresh-token records"),
  41: ("Mock Google ID verification and User lookup for {state}","Send {action} to POST /api/auth/google","Inspect User/UserDetail persistence and JWT response"),
  42: ("Seed User and reset-token state: {state}","Perform {action} through the password-recovery API","Inspect OTP expiry, email dispatch, password hash and token cleanup"),
  43: ("Seed wallet and transaction state: {state}","Perform {action} through walletService","Inspect balance, transaction count and idempotency result"),
  44: ("Mock upload middleware and Cloudinary for {state}","Submit {action} to POST /api/profile/avatar","Inspect upload response and saved UserDetail.avatar URL"),
  45: ("Seed violation, vehicle and wallet fixtures: {state}","Perform {action} through the violation API","Inspect authorization, violation status and wallet mutation"),
  46: ("Seed administrative mutation: {state}","Perform {action} through the account action flow","Inspect AdminActionLog actor, action, target and ordering"),
  47: ("Initialize socket clients and notifications: {state}","Perform {action} through Socket.IO","Inspect handshake, per-user delivery and unread count"),
  48: ("Fix clock and entitlement fixtures: {state}","Perform {action} with checkVIPSubscriptions","Inspect warning timestamps, status and reserved-slot fields"),
  49: ("Mock popup opener and URL hash: {state}","Perform {action} in OAuthCallback.jsx","Inspect postMessage target, token payload and popup close"),
  50: ("Seed owned vehicle, slot and payment state: {state}","Perform {action} through POST /api/bookings","Inspect booking status, slot hold and payment snapshot"),
  51: ("Seed booking and PayOS status: {state}","Perform {action} through GET /api/bookings/status/:orderCode","Inspect returned status, booking transition and voucher hold"),
  52: ("Seed paid booking and refund-policy snapshot: {state}","Perform {action} through the cancellation flow","Inspect refund breakdown, wallet ledger and booking state"),
  53: ("Seed subscription, slot and payment state: {state}","Perform {action} through the renewal API","Inspect quote, debit, expiry and renewal idempotency"),
  54: ("Seed floor, zone and protected slot state: {state}","Perform {action} through the layout-save API","Inspect geometry validation and Zone/Slot records"),
  55: ("Mock guest catalog response: {state}","Perform {action} in ServiceList.jsx","Inspect rendered service detail or /booking?serviceId URL"),
  56: ("Render AuthScreen with form state: {state}","Perform {action} on the auth screen","Inspect visible form, auth API call and navigation"),
  57: ("Render LoginScreen with client state: {state}","Perform {action} on the login screen","Inspect alert, login/googleLogin call and auth navigation"),
  58: ("Render RegisterScreen with input: {state}","Perform {action} on the registration form","Inspect validation message and register API call"),
  59: ("Render recovery screens with state: {state}","Perform {action} on ForgotPassword/VerifyOTP","Inspect auth API call and next-screen navigation"),
  60: ("Render ResetPasswordScreen with state: {state}","Perform {action} on the reset form","Inspect validation, reset API call and success navigation"),
  61: ("Seed vehicle API and camera fixtures: {state}","Perform {action} in the mobile vehicle screens","Inspect own-vehicle list, API mutation and scan prefill"),
  62: ("Seed published policy and acceptance state: {state}","Perform {action} in the mobile policy screens","Inspect version content and acceptance API request"),
  63: ("Seed mobile service catalog response: {state}","Perform {action} in ServiceListScreen","Inspect catalog cards, retry state or CreateBooking params"),
  64: ("Seed notification API/socket state: {state}","Perform {action} in NotificationsScreen","Inspect item list, unread badge and optimistic rollback"),
  65: ("Seed customer history response: {state}","Perform {action} in ParkingHistoryScreen","Inspect rendered sessions, total fee and refresh request"),
  66: ("Seed Staff dashboard API state: {state}","Perform {action} in StaffDashboardScreen","Inspect metrics, quick-link destination and fallback state"),
  67: ("Seed Staff customer records: {state}","Perform {action} in CustomerManagementScreen","Inspect filtered result, mutation API and role guard"),
  68: ("Seed Staff subscription response: {state}","Perform {action} in StaffSubscriptionManagementScreen","Inspect list, statistics, filter and fallback values"),
  69: ("Seed package API response and Staff role: {state}","Perform {action} in StaffTicketPackagesScreen","Inspect package cards, error state and read-only controls"),
}

# The user requested an illustrative retrospective report with both Passed and
# Pending.  The remaining Pending cases are integrations or environment paths
# that cannot be established by the available local checks.
ROUND2_PENDING = {
  44:{5}, 45:{5}, 46:{4}, 47:{3,6}, 48:{5},
  50:{5,6}, 51:{1,5}, 52:{5}, 53:{3,5}, 54:{4,5},
  56:{4,5}, 57:{3,4,5}, 58:{5}, 59:{3,5}, 60:{4},
  61:{4,6}, 62:{3,5}, 63:{2,4}, 64:{5,6}, 65:{4,5},
  66:{5}, 67:{5,6,7}, 68:{5}, 69:{3},
}

def round2_status(num, case_index):
    return "Pending" if case_index in ROUND2_PENDING.get(num,set()) else "Passed"

def report_counts(num):
    base = parse_cases(SPECS[num][-1])
    additions = [case for _, group in extra_cases(num) for case in group]
    passed = sum(round2_status(num, i) == "Passed" for i in range(1, len(base) + 1))
    passed += sum(case[4] == "Passed" for case in additions)
    return len(base) + len(additions), passed

def c(row, ref):
    node = row.find(f"{Q('c')}[@r='{ref}']")
    if node is None:
        node = ET.SubElement(row, Q("c"), r=ref)
    return node

def clear(cell):
    for child in list(cell):
        cell.remove(child)
    cell.attrib.pop("t", None)

def string(row, ref, value, style=None):
    cell = c(row, ref)
    clear(cell)
    if style is not None:
        cell.set("s", str(style))
    if value is None or value == "":
        return
    cell.set("t", "inlineStr")
    inline = ET.SubElement(cell, Q("is"))
    text = ET.SubElement(inline, Q("t"))
    text.text = str(value)

def number(row, ref, value, style=None):
    cell = c(row, ref)
    clear(cell)
    if style is not None:
        cell.set("s", str(style))
    ET.SubElement(cell, Q("v")).text = str(value)

def formula(row, ref, expression, cached, style=None):
    cell = c(row, ref)
    clear(cell)
    if style is not None:
        cell.set("s", str(style))
    ET.SubElement(cell, Q("f")).text = expression.lstrip("=")
    ET.SubElement(cell, Q("v")).text = str(cached)

def serial(d):
    return (d - date(1899, 12, 30)).days

def sheet_rows(root, through=0):
    data = root.find(Q("sheetData"))
    rows = {int(row.get("r")): row for row in data.findall(Q("row"))}
    for r in range(1, through + 1):
        if r in rows:
            continue
        row = ET.Element(Q("row"), r=str(r))
        after = next((i for i, other in enumerate(data) if int(other.get("r")) > r), len(data))
        data.insert(after, row)
        rows[r] = row
    return rows

def set_style_from(dst_row, dst_ref, src_row, src_ref):
    style = c(src_row, src_ref).get("s")
    if style is not None:
        c(dst_row, dst_ref).set("s", style)

def sheet_title(num, unit_names):
    unit_name = unit_names[num]
    suffix = unit_name.split(". ", 1)[1]
    title = f"{num-13}. {suffix}"
    assert len(title) <= 31, title
    return title, suffix

def make_report(template_xml, num, unit_names):
    root = ET.fromstring(template_xml)
    rows = sheet_rows(root,52)
    requirement, prep1, prep2, _state_group, _action_group, raw = SPECS[num]
    cases = parse_cases(raw)
    for case_index, replacement in BASE_OVERRIDES.get(num, {}).items():
        cases[case_index-1] = replacement
    additions = extra_cases(num)
    total, passed2 = report_counts(num)
    title, suffix = sheet_title(num, unit_names)
    # Keep the supplied report's header, legend, date styles and formula layout.
    string(rows[2], "B2", requirement)
    string(rows[3], "B3", f"Verify {requirement.lower()}. Sprint dates and Round 2 statuses are retrospective draft entries based on current-code review; direct historical execution is unverified.")
    rows[3].set("ht", "42")
    rows[3].set("customHeight", "1")
    formula(rows[4], "B4", "COUNTIF(A12:A52,\"TC-*\")", total)
    for r, status_col in ((6, "F"), (7, "I"), (8, "L")):
        values = (("B", passed2 if r==7 else 0), ("C", 0), ("D", total if r==6 else total-passed2 if r==7 else 0), ("E", 0))
        for col, result in values:
            formula(rows[r], f"{col}{r}", f"COUNTIF({status_col}11:{status_col}52,{col}5)", result)
    # Other copied group headers would merge case rows and hide their content.
    merges = root.find(Q("mergeCells"))
    if merges is not None:
        for item in list(merges):
            ref = item.get("ref", "")
            if ref.startswith("A") and ref.endswith(":O" + ref.split(":")[-1][1:]):
                start = int(ref.split(":")[0][1:])
                if 11 <= start <= 52 and start != 11:
                    merges.remove(item)
        merges.set("count", str(len(merges)))
    for r in range(12, 53):
        row = rows[r]
        for col in "ABCDEFGHIJKLMNO":
            set_style_from(row, f"{col}{r}", rows[12], f"{col}12")
            clear(c(row, f"{col}{r}"))
        row.set("ht", "18")
        row.set("customHeight", "1")
    def write_case(row_number, index, state, action, expected, precondition, status2, extra=False):
        row = rows[row_number]
        setup, operation, check = STEPS[num]
        if extra:
            procedure=(f"1. Prepare {precondition.rstrip('.')}.\n"
                       f"2. Configure the branch: {state}.\n"
                       f"3. {action.rstrip('.')}.\n"
                       f"4. {check}. Confirm: {expected}.")
        else:
            procedure=(f"1. {setup.format(state=state)}.\n"
                       f"2. {operation.format(action=action)}.\n"
                       f"3. {check}.\n"
                       f"4. Confirm: {expected}.")
        string(row,f"A{row_number}",f"TC-HSH-{num-13:02d}-{index:02d}")
        string(row,f"B{row_number}",f"{action} — {state}")
        string(row,f"C{row_number}",procedure)
        string(row,f"D{row_number}",expected+("" if expected.endswith(".") else "."))
        string(row,f"E{row_number}",precondition)
        string(row,f"F{row_number}","Pending")
        number(row,f"G{row_number}",serial(date.fromordinal(date(2026,8,20).toordinal()+((num-40)%14))),c(rows[12],"G12").get("s"))
        string(row,f"H{row_number}","HungHS")
        string(row,f"I{row_number}",status2)
        number(row,f"J{row_number}",serial(date.fromordinal(date(2026,9,3).toordinal()+((num-40)%14))),c(rows[12],"J12").get("s"))
        string(row,f"K{row_number}","HungHS")
        note=f"Code: {CODE_REF[num]}"
        if status2=="Pending":
            note+=f". Direct verification needed: {action}."
        string(row,f"O{row_number}",note)
        line_count=sum(max(1,ceil(len(part)/48)) for part in procedure.splitlines())
        row.set("ht",str(min(180,max(112,line_count*15+10))))
        row.set("customHeight","1")

    def write_group(row_number, number, heading):
        row = rows[row_number]
        for col in "ABCDEFGHIJKLMNO":
            set_style_from(row,f"{col}{row_number}",rows[11],f"{col}11")
            clear(c(row,f"{col}{row_number}"))
        string(row,f"A{row_number}",f"FUNCTION {number} — {heading.upper()}")
        row.set("ht","19")
        row.set("customHeight","1")
        if row_number!=11 and merges is not None:
            ET.SubElement(merges,Q("mergeCell"),ref=f"A{row_number}:O{row_number}")

    next_index = 1
    r = 11
    for group_number,(heading,start,end) in enumerate(GROUPS[num],1):
        assert start==next_index and end<=len(cases), (num,heading,start,end)
        write_group(r,group_number,heading)
        r+=1
        for i in range(start,end+1):
            state,action,expected,_case_type=cases[i-1]
            write_case(r,i,state,action,expected,f"{prep1}; {state}.",round2_status(num,i))
            r+=1
        next_index=end+1
    assert next_index==len(cases)+1, (num,next_index,r)
    group_number=len(GROUPS[num])
    for heading,group_cases in additions:
        group_number+=1
        write_group(r,group_number,heading)
        r+=1
        for state,action,expected,precondition,status2 in group_cases:
            write_case(r,next_index,state,action,expected,precondition,status2,True)
            next_index+=1
            r+=1
    assert next_index==total+1 and r<=53, (num,next_index,r)
    if merges is not None:
        merges.set("count",str(len(merges)))
    for view in root.findall(f".//{Q('sheetView')}"):
        view.attrib.pop("tabSelected", None)
    for node in list(root):
        if ET.QName(node).localname in ("drawing", "legacyDrawing", "tableParts"):
            root.remove(node)
    return ET.tostring(root,xml_declaration=True,encoding="UTF-8",standalone=True),title,total

def update_registry(xml, unit_names):
    root = ET.fromstring(xml)
    rows = sheet_rows(root,64)
    style_row = rows[20]
    for num in SPECS:
        r = num - 5  # 40 -> row 35, leaving rows 21-34 for earlier modules.
        row = rows[r]
        for col in "BCDEF":
            set_style_from(row,f"{col}{r}",style_row,f"{col}20")
        title,suffix = sheet_title(num,unit_names)
        requirement,prep1,prep2,*_ = SPECS[num]
        number(row,f"B{r}",num-13)
        string(row,f"C{r}",suffix)
        string(row,f"D{r}",title)
        string(row,f"E{r}",requirement)
        string(row,f"F{r}",prep1+"; "+prep2)
    return ET.tostring(root,xml_declaration=True,encoding="UTF-8",standalone=True)

def update_statistics(xml, unit_names):
    root = ET.fromstring(xml)
    rows = sheet_rows(root,83)
    module_style = rows[22]
    summary_style = rows[38]
    coverage_style = rows[40]
    success_style = rows[41]
    string(rows[43],"C43","HO SY HUNG (HUNGHS) — SPRINT 1 & SPRINT 2",c(summary_style,"C38").get("s"))
    string(rows[44],"C44","HSH summary uses Round 2 draft statuses; dates/results are retrospective and not historical execution evidence.",c(coverage_style,"C40").get("s"))
    for num in SPECS:
        r = num + 5  # 40 -> row 45
        row = rows[r]
        for col in "BCDEFGH":
            set_style_from(row,f"{col}{r}",module_style,f"{col}22")
        title,suffix = sheet_title(num,unit_names)
        n, passed = report_counts(num)
        number(row,f"B{r}",num-13)
        string(row,f"C{r}",suffix)
        safe = title.replace("'","''")
        for col,target,cached in (("D","B7",passed),("E","C7",0),("F","D7",n-passed),("G","E7",0),("H","B4",n)):
            formula(row,f"{col}{r}",f"'{safe}'!{target}",cached)
    row = rows[75]
    for col in "BCDEFGH":
        set_style_from(row,f"{col}75",summary_style,f"{col}38")
    string(row,"C75","HSH subtotal")
    total_cases=sum(report_counts(num)[0] for num in SPECS)
    total_passed=sum(report_counts(num)[1] for num in SPECS)
    for col,val in (("D",total_passed),("E",0),("F",total_cases-total_passed),("G",0),("H",total_cases)):
        formula(row,f"{col}75",f"SUM({col}45:{col}74)",val)
    for dst,src,label,expression in ((77,coverage_style,"HSH test coverage","(D75+E75)*100/(H75-G75)"),(78,success_style,"HSH successful coverage","D75*100/(H75-G75)")):
        row=rows[dst]
        for col in "BCDEF":
            set_style_from(row,f"{col}{dst}",src,f"{col}{40 if dst==77 else 41}")
        string(row,f"C{dst}",label)
        formula(row,f"E{dst}",expression,total_passed*100/total_cases)
        string(row,f"F{dst}","%")
    string(rows[80],"C80","Current-code automated checks — 07 Oct 2026",c(summary_style,"C38").get("s"))
    string(rows[81],"C81","Backend selected suites: 30 passed, 0 failed; full suite: 283 passed, 1 failed")
    string(rows[82],"C82","Frontend Node tests: 96 passed, 0 failed")
    string(rows[83],"C83","Backend failure: AI Copilot revenue metrics, outside these HSH cases; no historical case-level inference.")
    return ET.tostring(root,xml_declaration=True,encoding="UTF-8",standalone=True)

def main():
    import openpyxl
    workbook = openpyxl.load_workbook(UNIT,read_only=True,data_only=False)
    unit_names = {num:workbook.worksheets[num+3].title for num in SPECS}
    assert all(unit_names[num].startswith(str(num)+". ") for num in SPECS)
    with ZipFile(SOURCE) as zin:
        originals = {item.filename:zin.read(item.filename) for item in zin.infolist()}
        workbook_root=ET.fromstring(originals["xl/workbook.xml"])
        rels_root=ET.fromstring(originals["xl/_rels/workbook.xml.rels"])
        types_root=ET.fromstring(originals["[Content_Types].xml"])
        sheets_parent=workbook_root.find(Q("sheets"))
        max_rid=max(int(rel.get("Id")[3:]) for rel in rels_root if rel.get("Id","").startswith("rId"))
        template=originals["xl/worksheets/sheet29.xml"]
        added={}
        for idx,num in enumerate(SPECS,1):
            sheet_id=29+idx
            rid=f"rId{max_rid+idx}"
            xml,title,count=make_report(template,num,unit_names)
            added[f"xl/worksheets/sheet{sheet_id}.xml"]=xml
            ET.SubElement(sheets_parent,Q("sheet"),name=title,sheetId=str(sheet_id),attrib={f"{{{R}}}id":rid})
            ET.SubElement(rels_root,f"{{{P}}}Relationship",Id=rid,Type=R+"/worksheet",Target=f"worksheets/sheet{sheet_id}.xml")
            ET.SubElement(types_root,f"{{{CT}}}Override",PartName=f"/xl/worksheets/sheet{sheet_id}.xml",ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
            print(title,count)
        calc=workbook_root.find(Q("calcPr"))
        if calc is not None:
            calc.set("fullCalcOnLoad","1")
        added["xl/workbook.xml"]=ET.tostring(workbook_root,xml_declaration=True,encoding="UTF-8",standalone=True)
        added["xl/_rels/workbook.xml.rels"]=ET.tostring(rels_root,xml_declaration=True,encoding="UTF-8",standalone=True)
        added["[Content_Types].xml"]=ET.tostring(types_root,xml_declaration=True,encoding="UTF-8",standalone=True)
        added["xl/worksheets/sheet3.xml"]=update_registry(originals["xl/worksheets/sheet3.xml"],unit_names)
        added["xl/worksheets/sheet2.xml"]=update_statistics(originals["xl/worksheets/sheet2.xml"],unit_names)
        with ZipFile(OUTPUT,"w") as zout:
            for info in zin.infolist():
                zout.writestr(info,added.pop(info.filename,originals[info.filename]))
            for name,data in added.items():
                zout.writestr(name,data)
    print("OUTPUT",OUTPUT)

if __name__=="__main__":
    main()

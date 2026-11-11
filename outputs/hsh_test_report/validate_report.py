"""Structural checks for the revised Ho Sy Hung report."""
from collections import Counter
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile

import openpyxl

here = Path(__file__).resolve().parent
source = Path(r"C:\Users\ADMIN\Downloads\Report5_Test_Report.xlsx")
output = here / "Report5_Test_Report_Ho_Sy_Hung.xlsx"
book = openpyxl.load_workbook(output, data_only=False)
assert len(book.worksheets) == 59
round1 = Counter()
round2 = Counter()
case_ids = set()
group_counts = []
case_counts = []
for sheet in book.worksheets[29:]:
    groups = 0
    cases = 0
    for row in sheet.iter_rows(min_row=11, max_col=15):
        first = row[0].value
        if isinstance(first, str) and first.startswith("FUNCTION"):
            groups += 1
        if not (isinstance(first, str) and first.startswith("TC-HSH")):
            continue
        assert first not in case_ids, first
        case_ids.add(first)
        cases += 1
        round1[row[5].value] += 1
        round2[row[8].value] += 1
        assert row[7].value == row[10].value == "HungHS"
        assert datetime(2026, 8, 20) <= row[6].value <= datetime(2026, 9, 2)
        assert datetime(2026, 9, 3) <= row[9].value <= datetime(2026, 9, 16)
        assert all(row[i].value for i in (1, 2, 3, 4))
    group_counts.append(groups)
    case_counts.append(cases)
    assert 3 <= groups <= 6, (sheet.title, groups)
    assert cases >= 6, (sheet.title, cases)
assert len(case_ids) == 274
assert round1 == {"Pending": 274}
assert round2["Passed"] > 0 and round2["Pending"] > 0
assert round2.total() == 274
with ZipFile(source) as original, ZipFile(output) as revised:
    assert revised.testzip() is None
    assert all(
        original.read(f"xl/worksheets/sheet{i}.xml")
        == revised.read(f"xl/worksheets/sheet{i}.xml")
        for i in range(4, 30)
    )
print("Sheets:", len(book.worksheets), "new:", 30)
print("Function groups:", Counter(group_counts))
print("Cases per sheet:", min(case_counts), max(case_counts))
print("Total cases:", len(case_ids), "Round 1:", round1, "Round 2:", round2)
print("Original 26 report sheet XML parts: unchanged")

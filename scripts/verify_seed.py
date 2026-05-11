"""Cross-check the seed math against the raw xlsx and Sheet2's pre-computed avgs."""
from __future__ import annotations
import warnings
from collections import defaultdict
warnings.filterwarnings('ignore')
import openpyxl

XLSX_PATH = r'C:\Users\PatricioParraRamon\OneDrive - netruckcenter.com\Desktop\Average Call Per Hour Distribution.xlsx'

wb = openpyxl.load_workbook(XLSX_PATH, data_only=True, read_only=True)

# 1. Independently re-count from raw Data sheet.
data = wb['Data']
total_by_dh = defaultdict(int)        # (dow, hour) -> all calls
copart_by_dh = defaultdict(int)
days_by_dow = defaultdict(set)

for i, row in enumerate(data.iter_rows(values_only=True)):
    if i == 0: continue
    if not row or row[0] is None: continue
    customer = (row[0] or '').strip()
    date = row[4]; hour = row[8]
    if date is None or hour is None: continue
    try:
        dow = date.weekday(); hour = int(hour)
    except: continue
    total_by_dh[(dow, hour)] += 1
    if customer.upper() == 'COPART, INC':
        copart_by_dh[(dow, hour)] += 1
    days_by_dow[dow].add(date.date() if hasattr(date, 'date') else date)

# 2. Spot-check a few hours for Monday.
print(f"\n== Monday raw counts (56 unique Mondays) ==")
print(f"{'hr':>3} {'all':>5} {'copart':>7} {'non_cp':>7} {'sheet2_avg':>11} {'computed':>9} {'diff':>6}")

# Sheet2 Monday averages copied from xlsx_dump2.json
sheet2_mon = {
    0: 1.4464, 1: 1.1964, 2: 0.625, 3: 0.5179, 4: 0.6429, 5: 0.7679,
    6: 3.25, 7: 3.6786, 8: 4.2143, 9: 4.6786, 10: 3.9286, 11: 4.1607,
    12: 3.75, 13: 3.9464, 14: 3.6071, 15: 3.8393, 16: 3.75, 17: 3.8929,
    18: 2.9286, 19: 2.3571, 20: 2.0893, 21: 2.1071, 22: 1.4821, 23: 0.9821,
}

n = len(days_by_dow[0])
copart_window = list(range(8, 17))
copart_total_mon = sum(copart_by_dh[(0, h)] for h in range(24))
copart_per_hr = (copart_total_mon / len(copart_window)) / n

for h in range(24):
    all_c = total_by_dh[(0, h)]
    cop_c = copart_by_dh[(0, h)]
    non_cp = all_c - cop_c
    sheet_avg = sheet2_mon[h]
    sheet_implied = sheet_avg * n  # what total Sheet2 was averaging
    computed = non_cp / n + (copart_per_hr if h in copart_window else 0)
    print(f"{h:>3} {all_c:>5} {cop_c:>7} {non_cp:>7} {sheet_avg:>11.3f} {computed:>9.3f} {(computed - sheet_avg):>+6.2f}")

print(f"\nMonday Copart total: {copart_total_mon}, per-Monday avg: {copart_total_mon/n:.2f}, per business hr: {copart_per_hr:.3f}")
print(f"Sheet2 'all/56' for hr 8: Sheet2 avg {sheet2_mon[8]} * 56 = {sheet2_mon[8]*n:.0f} (raw count was {total_by_dh[(0,8)]})")

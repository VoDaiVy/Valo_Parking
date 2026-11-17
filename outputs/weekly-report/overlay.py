import json
from copy import deepcopy
from pathlib import Path
import re
from zipfile import ZipFile
from lxml import etree as ET
import openpyxl

root = Path(__file__).parent
template = root / 'template.xlsx'
target = root / 'VALOParking_Weekly_Report_Weeks_1-14.xlsx'
work = openpyxl.load_workbook(template)
data = json.loads((root / 'weekly-values.json').read_text(encoding='utf-8'))
staging = openpyxl.load_workbook(root / 'weekly-values.xlsx', read_only=True)
ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'

def set_cell(cell, value):
    for child in list(cell):
        if child.tag in [ns+'v', ns+'is', ns+'f']:
            cell.remove(child)
    cell.attrib.pop('t', None)
    if isinstance(value, int):
        ET.SubElement(cell, ns+'v').text = str(value)
    elif value:
        cell.set('t', 'inlineStr')
        text = ET.SubElement(ET.SubElement(cell, ns+'is'), ns+'t')
        text.set(XML_SPACE, 'preserve')
        text.text = str(value)

assert work.sheetnames == staging.sheetnames == [week['title'] for week in data]
with ZipFile(template) as before, ZipFile(target,'w') as after:
    styles = ET.fromstring(before.read('xl/styles.xml'))
    formats = styles.find(ns+'cellXfs')
    wrapped={}
    def wrap(cell):
        key=cell.get('s','0')
        if key not in wrapped:
            fmt=deepcopy(formats[int(key)])
            align=fmt.find(ns+'alignment')
            if align is None:
                align=ET.SubElement(fmt,ns+'alignment')
            if align.get('wrapText')=='1':
                wrapped[key]=key
            else:
                align.set('wrapText','1')
                fmt.set('applyAlignment','1')
                wrapped[key]=str(len(formats))
                formats.append(fmt)
        cell.set('s',wrapped[key])
    for member in before.infolist():
        if member.filename=='xl/styles.xml':
            continue
        content = before.read(member)
        match = re.fullmatch(r'xl/worksheets/sheet(\d+)\.xml',member.filename)
        if match:
            index = int(match[1])-1
            week = data[index]
            sheet = work[week['title']]
            values = staging[week['title']]
            xml = ET.fromstring(content)
            cells = {c.get('r'): c for c in xml.iter(ns+'c')}
            headings = [r for r in range(4,75) if sheet.cell(r,1).value == '#' and sheet.cell(r,2).value]
            assert len(headings)==4, (sheet.title,headings)
            for validation in xml.iter(ns+'dataValidation'):
                refs=validation.get('sqref','').split()
                if validation.findtext(ns+'formula1','').strip('"')=='Pending,In Progress,Completed':
                    retained=[ref for ref in refs if not headings[2]<int(re.search(r'\d+',ref)[0])<headings[3]-1]
                    if retained:
                        validation.set('sqref',' '.join(retained))
                    else:
                        parent=validation.getparent()
                        parent.remove(validation)
                        parent.set('count',str(len(parent)))
            rows=[[values.cell(r,c).value for c in range(2,6)] for r in range(2,2+sum(map(len,week['sections'])))]
            assert values['B1'].value == week['date']
            set_cell(cells['B3'],values['B1'].value)
            for k, header in enumerate(headings):
                count=len(week['sections'][k])
                records,rows=rows[:count],rows[count:]
                end=headings[k+1]-2 if k<3 else min(sheet.max_row,header+35)
                slots=[r for r in range(header+1,end+1) if isinstance(sheet.cell(r,1).value,(float,int)) or (f'A{r}' in cells and f'E{r}' in cells and sheet.cell(r,2)._style and sheet.cell(r,2).border.bottom.style)]
                assert slots, (sheet.title,k)
                if len(records)>len(slots):
                    overflow=records[len(slots)-1:]
                    records=records[:len(slots)-1]+[[ '\n'.join(str(row[c]) for row in overflow if row[c]) for c in range(4)]]
                    if k in (0,1):
                        records[-1][2]=overflow[0][2]
                for r in range(header+1,end+1):
                    if r not in slots and k<3:
                        continue
                    line=records[slots.index(r)] if r in slots and slots.index(r)<len(records) else ['','','','']
                    if k in (0,1) and line[2] in ('Assigned','Planned','To review'):
                        line[2]='Pending'
                    if r in slots:
                        set_cell(cells[f'A{r}'],slots.index(r)+1)
                    for col,value in zip('BCDE',line):
                        if f'{col}{r}' in cells:
                            set_cell(cells[f'{col}{r}'],value)
                            if value and (len(str(value))>{'B':37,'C':10,'D':14,'E':64}[col] or '\n' in str(value)):
                                wrap(cells[f'{col}{r}'])
                        elif value:
                            ref=f'{col}{r}'
                            row=cells[f'A{r}'].getparent()
                            cell=ET.Element(ns+'c',r=ref)
                            for other in row:
                                if other.tag==ns+'c' and other.get('r')[0]>col:
                                    other.addprevious(cell)
                                    break
                            else:
                                row.append(cell)
                            set_cell(cell,value)
                            wrap(cell)
                    if any(line):
                        estimated=max(sum(max(1,(len(part)+width-1)//width) for part in str(value or '').split('\n')) for value,width in zip(line,[40,11,14,68]))
                        row=cells[f'A{r}'].getparent()
                        if estimated>1:
                            row.set('ht',str(max(float(row.get('ht','15')),15*estimated+3)))
                            row.set('customHeight','1')
            content = ET.tostring(xml)
        after.writestr(member,content)
    formats.set('count',str(len(formats)))
    after.writestr(before.getinfo('xl/styles.xml'),ET.tostring(styles))

with ZipFile(template) as a, ZipFile(target) as b:
    orig_styles, final_styles=(ET.fromstring(z.read('xl/styles.xml')) for z in [a,b])
    for tag in ['borders','fonts','fills']:
        assert ET.tostring(orig_styles.find(ns+tag))==ET.tostring(final_styles.find(ns+tag))
    for i in range(1,15):
        part=f'xl/worksheets/sheet{i}.xml'
        old,new=(ET.fromstring(z.read(part)) for z in [a,b])
        old_styles={c.get('r'):c.get('s') for c in old.iter(ns+'c')}
        for c in new.iter(ns+'c'):
            ref=c.get('r')
            if ref in old_styles:
                old_style=old_styles[ref]
                assert c.get('s') in (old_style, wrapped.get(old_style or '0',old_style))
        for tag in ['cols','mergeCells','sheetViews','conditionalFormatting']:
            assert [ET.tostring(x) for x in old.findall(ns+tag)] == [ET.tostring(x) for x in new.findall(ns+tag)]
verified=openpyxl.load_workbook(target)
assert all(s['B3'].value==w['date'] for s,w in zip(verified,data))
print('Verified 14 tabs, original borders, fonts, fills, column widths, merges and views. Long populated cells wrap.')
for sheet in verified:
    print(sheet.title,sheet['B3'].value)

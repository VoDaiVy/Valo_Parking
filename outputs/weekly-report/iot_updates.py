import json
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

workbook = openpyxl.load_workbook(sys.argv[1])
suggestions = [
    ['Vỹ', 'Thanh', 'Vỹ, Khôi', 'Thanh', 'Vỹ'],
    ['Thanh', 'Vỹ', 'Thanh', 'Vỹ'],
    ['Thanh', 'Hưng', 'Vỹ'],
    ['Vỹ', 'Vỹ', 'Trân', 'Vỹ', 'Thanh', 'Vỹ, Khôi', 'Trân'],
    ['Khôi', 'Thanh', 'Thanh', 'Thanh', 'Hưng'],
    ['Thanh', 'Khôi', 'Thanh', 'Vỹ', 'Thanh', 'Vỹ'],
    ['Khôi', 'Thanh', 'Vỹ', 'Khôi', 'Thanh'],
    ['Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Vỹ'],
    ['Vỹ', 'Hưng', 'Vỹ', 'Vỹ', 'Khôi'],
    ['Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Vỹ'],
    ['Vỹ', 'Thanh', 'Khôi'],
    ['Vỹ', 'Vỹ', 'Vỹ', 'Vỹ', 'Trân', 'Vỹ', 'Trân'],
    ['Vỹ', 'Trân', 'Trân', 'Vỹ', 'Trân', 'Trân', 'Thanh'],
    ['Trân', 'Trân', 'Vỹ', 'Trân', 'Hưng', 'Vỹ', 'Hưng'],
]
# Mappings are keyed by row to make the proposed ownership match each actual task.
overrides = {
  1:{6:'Vỹ',7:'Thanh',14:'Khôi',15:'Vỹ',20:'Thanh',21:'Khôi',22:'Vỹ'},
  2:{20:'Thanh',25:'Thanh',26:'Vỹ',27:'Thanh',28:'Thanh'},
  3:{19:'Thanh',20:'Hưng',25:'Vỹ',28:'Thanh'},
  4:{6:'Vỹ',14:'Vỹ',15:'Trân',20:'Vỹ',21:'Thanh',22:'Vỹ, Khôi',23:'Trân'},
  5:{14:'Khôi',15:'Thanh',22:'Thanh',23:'Thanh',24:'Hưng'},
  6:{6:'Thanh',14:'Khôi',20:'Thanh',21:'Vỹ',22:'Khôi',23:'Vỹ'},
  7:{14:'Khôi',15:'Thanh',19:'Vỹ',20:'Khôi',21:'Thanh'},
  8:{6:'Vỹ',14:'Vỹ',15:'Vỹ',19:'Vỹ',20:'Vỹ',21:'Vỹ',22:'Vỹ'},
  9:{14:'Vỹ',15:'Hưng',19:'Vỹ',20:'Vỹ',21:'Khôi'},
  10:{6:'Vỹ',14:'Vỹ',15:'Vỹ',19:'Vỹ',20:'Vỹ',21:'Vỹ',22:'Vỹ'},
  11:{19:'Vỹ',22:'Thanh',23:'Khôi'},
  12:{6:'Vỹ',14:'Vỹ',15:'Vỹ',19:'Vỹ',20:'Trân',21:'Vỹ',22:'Trân'},
  13:{6:'Vỹ',7:'Trân',14:'Trân',15:'Vỹ',19:'Trân',20:'Trân',21:'Thanh'},
  14:{6:'Trân',14:'Trân',15:'Vỹ',19:'Trân',20:'Hưng',21:'Vỹ',22:'Hưng'},
}
iot = {
  2:('Document kiosk camera and barrier dependencies','Vỹ, Khôi','List hardware and signals required for entry and exit checks.'),
  4:('Test the camera-to-kiosk entry flow','Vỹ','Check recognition, manual fallback and session creation.'),
  7:('Set up an ESP32 slot sensor bench test','Vỹ','Compare occupied and free readings before wiring the full model.'),
  8:('Map MQTT sensor events to physical parking slots','Vỹ','Verify slot mapping and state recovery after reconnect.'),
  10:('Integrate ESP32 servo and relay feedback with the barrier bridge','Vỹ','Compare commands and device state during entry and exit.'),
  12:('Measure sensor-to-dashboard latency on the physical model','Vỹ','Record timings and verify state recovery after network interruption.'),
  13:('Run end-to-end IoT recovery tests','Vỹ','Cover camera, slot sensors, barrier and map synchronization.'),
  14:('Rehearse IoT hardware recovery before the final demo','Vỹ','Verify barrier and sensor behavior after power and network interruptions.'),
}

def value(input_value):
    if isinstance(input_value, datetime):
        return input_value.strftime('%d/%m/%Y')
    return '' if input_value is None else str(input_value)

result = []
for n, sheet in enumerate(workbook, 1):
    headers = [r for r in range(4,40) if sheet.cell(r,1).value == '#']
    assert len(headers) == 4
    deadline_start, deadline_end = headers[2]+1, headers[3]-3
    bad = any(
        f'D{r}' in rule.sqref
        for rule in sheet.data_validations.dataValidation
        if 'Pending,In Progress,Completed' in str(rule.formula1)
        for r in range(deadline_start,deadline_end+1)
    )
    updates = []
    for section, (header,end) in enumerate(zip(headers, headers[1:])):
        rows = []
        edits = False
        for row in range(header+1,end-2):
            values = [value(sheet.cell(row,c).value) for c in range(1,6)]
            if values[1] and not values[2]:
                owner=overrides[n].get(row)
                assert owner, (n,row,values)
                values[2]=owner
                values[4]+=(' ' if values[4] else '')+'Proposed assignee.'
                edits=True
            rows.append(values)
        if section == 0 and n in iot:
            index=next(i for i,entry in enumerate(rows) if not entry[1])
            task,owner,note=iot[n]
            rows[index]=[str(index+1),task,owner,'Pending','Proposed IoT task and assignee. '+note]
            edits=True
        if edits:
            last=max(i for i,row in enumerate(rows) if row[1])
            # Keep existing rows in their current positions and leave the rest of the table intact.
            updates.append([f'A{header+1}',rows[:last+1]])
    result.append({'week':n,'date':sheet['B3'].value,'updates':updates,
                   'deadlineStart':deadline_start,'deadlineEnd':deadline_end,'invalidRule':bad})

Path(__file__).with_name('iot_updates.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')

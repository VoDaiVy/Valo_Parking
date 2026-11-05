import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, addYears, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import './staffBookingDatePicker.css';

function BookingCalendar({ value, onChange, close, anchorOffset }) {
  const [month, setMonth] = useState(() => startOfMonth(value));
  const [focusedDate, setFocusedDate] = useState(value);
  const days = useRef(new Map());
  const today = startOfDay(new Date());
  const focusedKey = format(focusedDate, 'yyyy-MM-dd');
  useEffect(() => { days.current.get(focusedKey)?.focus(); }, [focusedKey]);
  const moveFocus = (date) => { setFocusedDate(date); setMonth(startOfMonth(date)); };
  const select = (date) => { onChange(startOfDay(date)); close(); };
  const onDayKey = (event, date) => {
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = addDays(date, -1); break;
      case 'ArrowRight': next = addDays(date, 1); break;
      case 'ArrowUp': next = addDays(date, -7); break;
      case 'ArrowDown': next = addDays(date, 7); break;
      case 'Home': next = startOfWeek(date); break;
      case 'End': next = endOfWeek(date); break;
      case 'PageUp': next = event.shiftKey ? addYears(date, -1) : addMonths(date, -1); break;
      case 'PageDown': next = event.shiftKey ? addYears(date, 1) : addMonths(date, 1); break;
      default: return;
    }
    event.preventDefault(); moveFocus(startOfDay(next));
  };
  const firstDay = startOfWeek(startOfMonth(month));
  // Popover owns the trigger+portal boundary. Panel-only blur dismissal can
  // close on trigger focus before its click toggles, reopening the calendar.
  // Initial day focus remains handled above; outside focus/click and Escape
  // remain managed by Popover across both elements.
  return <PopoverPanel portal focus={false} anchor={{ to: 'bottom end', gap: 8, offset: anchorOffset, padding: 8 }} className="sbm-booking-calendar" role="dialog" aria-label="Choose booking date">
    <header className="sbm-calendar-heading">
      <button type="button" aria-label="Previous month" onClick={() => moveFocus(addMonths(focusedDate, -1))}><ChevronLeft size={17} aria-hidden="true" /></button>
      <h2 aria-live="polite">{format(month, 'MMMM yyyy')}</h2>
      <button type="button" aria-label="Next month" onClick={() => moveFocus(addMonths(focusedDate, 1))}><ChevronRight size={17} aria-hidden="true" /></button>
    </header>
    <div role="grid" aria-label={format(month, 'MMMM yyyy')}>
      <div role="row" className="sbm-calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div role="row" className="sbm-calendar-week" key={week}>
        {Array.from({ length: 7 }, (_, day) => {
          const date = addDays(firstDay, week * 7 + day);
          const key = format(date, 'yyyy-MM-dd');
          const selected = isSameDay(date, value);
          return <div role="gridcell" aria-selected={selected} key={key}>
            <button type="button" ref={element => { if (element) days.current.set(key, element); else days.current.delete(key); }}
              tabIndex={key === focusedKey ? 0 : -1} data-selected={selected} data-outside={!isSameMonth(date, month)}
              aria-current={isSameDay(date, today) ? 'date' : undefined} aria-label={format(date, 'EEEE, MMMM d, yyyy')}
              onKeyDown={event => onDayKey(event, date)} onClick={() => select(date)}>{format(date, 'd')}</button>
          </div>;
        })}
      </div>)}
    </div>
    <footer className="sbm-calendar-footer">
      <button type="button" onClick={() => select(startOfDay(new Date()))}>Today</button>
      <button type="button" onClick={() => close()}>Cancel</button>
    </footer>
  </PopoverPanel>;
}

export default function BookingDatePicker({ value, onChange }) {
  const [anchorOffset, setAnchorOffset] = useState(0);
  return <Popover className="sbm-date-popover">
    {({ open, close }) => <>
      <PopoverButton className="sbm-date-trigger" aria-label="Choose booking date" title="Choose booking date" onClick={event => {
        const button = event.currentTarget;
        const selector = button.closest('.sbm-date');
        if (selector) setAnchorOffset(selector.getBoundingClientRect().right - button.getBoundingClientRect().right);
      }}>
        <span>{format(value, 'EEEE')}</span><span>{format(value, 'MMM dd, yyyy')}</span>
      </PopoverButton>
      {open && <BookingCalendar value={value} onChange={onChange} close={close} anchorOffset={anchorOffset} />}
    </>}
  </Popover>;
}

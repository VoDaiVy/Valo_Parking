import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import './adminDateTimePicker.css';

function TimeColumn({ label, options, value, onChange }) {
  const active = useRef(null);
  useEffect(() => { active.current?.scrollIntoView?.({ block: 'nearest' }); }, [value]);
  return <div className="admin-datetime-column">
    <span className="admin-datetime-column-label">{label}</span>
    <div role="listbox" aria-label={label}>
      {options.map((option, index) => <button type="button" role="option" aria-selected={option === value}
        ref={option === value ? active : undefined} tabIndex={option === value ? 0 : -1} key={option}
        onClick={() => onChange(option)} onKeyDown={event => {
          const offset = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
          if (offset) {
            event.preventDefault();
            onChange(options[(index + offset + options.length) % options.length]);
            requestAnimationFrame(() => active.current?.focus({ preventScroll: true }));
          }
        }}>{option}</button>)}
    </div>
  </div>;
}

function Calendar({ value, onChange, label, close }) {
  const selected = value ? new Date(value) : new Date();
  const [month, setMonth] = useState(() => startOfMonth(selected));
  const [focused, setFocused] = useState(selected);
  const cells = useRef(new Map());
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const update = (date) => onChange(format(date, "yyyy-MM-dd'T'HH:mm"));
  const move = (date) => {
    setFocused(date);
    setMonth(startOfMonth(date));
    requestAnimationFrame(() => cells.current.get(format(date, 'yyyy-MM-dd'))?.focus());
  };
  const onKeyDown = (event, date) => {
    const next = {
      ArrowLeft: () => addDays(date, -1), ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7), ArrowDown: () => addDays(date, 7),
      Home: () => startOfWeek(date, { weekStartsOn: 1 }), End: () => endOfWeek(date, { weekStartsOn: 1 }),
      PageUp: () => addMonths(date, -1), PageDown: () => addMonths(date, 1),
    }[event.key];
    if (next) { event.preventDefault(); move(next()); }
  };
  return <PopoverPanel portal focus anchor={{ to: 'bottom start', gap: 8, padding: 12 }} className="admin-datetime-panel" role="dialog" aria-label={label}>
    <div className="admin-datetime-content">
    <section className="admin-datetime-calendar" aria-label="Date">
    <header>
      <button type="button" aria-label="Previous month" onClick={() => move(addMonths(focused, -1))}><ChevronLeft size={18} /></button>
      <h3 aria-live="polite">{format(month, 'MMMM yyyy')}</h3>
      <button type="button" aria-label="Next month" onClick={() => move(addMonths(focused, 1))}><ChevronRight size={18} /></button>
    </header>
    <div className="admin-datetime-days" role="grid" aria-label={format(month, 'MMMM yyyy')}>
      <div role="row" className="admin-datetime-weekdays">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div role="row" className="admin-datetime-week" key={week}>
        {Array.from({ length: 7 }, (_, day) => {
          const date = addDays(first, week * 7 + day);
          const key = format(date, 'yyyy-MM-dd');
          return <div role="gridcell" aria-selected={isSameDay(date, selected)} key={key}>
            <button type="button" ref={el => { if (el) cells.current.set(key, el); else cells.current.delete(key); }}
              tabIndex={isSameDay(date, focused) ? 0 : -1} data-selected={isSameDay(date, selected)} data-outside={!isSameMonth(date, month)}
              aria-current={isSameDay(date, new Date()) ? 'date' : undefined} aria-label={format(date, 'EEEE, MMMM d, yyyy')}
              onKeyDown={event => onKeyDown(event, date)} onClick={() => {
                date.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                update(date); setFocused(date); setMonth(startOfMonth(date));
              }}>{format(date, 'd')}</button>
          </div>;
        })}
      </div>)}
    </div>
    </section>
    <section className="admin-datetime-time" aria-label="Time">
      <TimeColumn label="Hour" options={Array.from({ length: 12 }, (_, n) => String(n + 1).padStart(2, '0'))}
        value={String(selected.getHours() % 12 || 12).padStart(2, '0')} onChange={hour => {
          const date = new Date(selected); date.setHours(Number(hour) % 12 + (selected.getHours() >= 12 ? 12 : 0)); update(date);
        }} />
      <TimeColumn label="Min" options={Array.from({ length: 60 }, (_, n) => String(n).padStart(2, '0'))}
        value={String(selected.getMinutes()).padStart(2, '0')} onChange={minute => {
          const date = new Date(selected); date.setMinutes(Number(minute)); update(date);
        }} />
      <TimeColumn label="Period" options={['AM', 'PM']} value={selected.getHours() >= 12 ? 'PM' : 'AM'} onChange={period => {
        const date = new Date(selected); date.setHours(selected.getHours() % 12 + (period === 'PM' ? 12 : 0)); update(date);
      }} />
    </section>
    </div>
    <footer><button type="button" onClick={() => { const now = new Date(); update(now); move(now); }}>Now</button><button type="button" onClick={() => close()}>Done</button></footer>
  </PopoverPanel>;
}

export default function AdminDateTimePicker({ value, onChange, label }) {
  return <Popover className="admin-datetime">
    {({ open, close }) => <>
      <PopoverButton className="admin-datetime-trigger" aria-label={label}>
        <CalendarDays size={18} aria-hidden="true" />
        <span>{value ? format(new Date(value), 'dd MMM yyyy') : 'Choose date'}<small>{value ? format(new Date(value), 'HH:mm') : 'Choose time'}</small></span>
      </PopoverButton>
      {open && <Calendar value={value} onChange={onChange} label={label} close={close} />}
    </>}
  </Popover>;
}

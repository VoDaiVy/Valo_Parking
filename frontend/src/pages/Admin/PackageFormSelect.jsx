import { useRef, useState } from 'react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';

// Portalled, anchored menus remain inside the Dialog focus scope without
// increasing the form height or being clipped by its internal scroll area.
export default function PackageFormSelect({ id, label, value, onChange, options, multiple = false, required = false, disabled = false, placeholder = 'Select an option' }) {
  const button = useRef(null);
  const [invalid, setInvalid] = useState(false);
  const selected = options.filter((option) => multiple ? value.includes(option.value) : option.value === value);
  const text = multiple ? (selected.length ? `${selected.length} selected - ${selected.map((option) => option.label).join(', ')}` : 'No optional services') : selected[0]?.label || placeholder;
  return <div className="package-flat-select">
    <Listbox value={value} onChange={(next) => { setInvalid(false); onChange(next); }} multiple={multiple} disabled={disabled}>
      <ListboxButton id={id} ref={button} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} className="package-flat-select-button" title={text}>
        <span>{text}</span><ChevronDown size={15} aria-hidden="true" />
      </ListboxButton>
      <ListboxOptions portal anchor={{ to: 'bottom start', gap: 6, padding: 12 }} modal={false} className="package-flat-select-menu">
        {options.length ? options.map((option) => <ListboxOption key={option.value} value={option.value} disabled={option.disabled} className="package-flat-select-option">
          {({ selected }) => <><span className={multiple ? 'package-flat-option-check' : 'package-flat-option-tick'} aria-hidden="true">{selected && <Check size={13} />}</span><span>{option.label}{option.detail && <small>{option.detail}</small>}</span></>}
        </ListboxOption>) : <p className="package-flat-select-empty">No catalog services available.</p>}
      </ListboxOptions>
    </Listbox>
    {required && !multiple && <input className="package-flat-validation" tabIndex={-1} aria-hidden="true" required disabled={disabled} value={value || ''} onChange={() => {}} onInvalid={(event) => { event.preventDefault(); setInvalid(true); button.current?.focus(); }} />}
    {invalid && <span id={`${id}-error`} className="package-flat-select-error" role="alert">Please select {label.toLowerCase()}.</span>}
  </div>;
}

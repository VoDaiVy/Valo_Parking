import { Fragment, useMemo } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import { getSelectedDropdownOption, normalizeDropdownOptions } from './staffDropdownOptions.js';

export default function StaffDropdown({
  value,
  onChange,
  options,
  ariaLabel,
  icon: Icon,
  disabled = false,
  align = 'left',
  placement = 'bottom',
  className = '',
  buttonClassName = '',
  menuClassName = '',
}) {
  const normalizedOptions = useMemo(() => normalizeDropdownOptions(options), [options]);
  const selectedOption = getSelectedDropdownOption(normalizedOptions, value);
  const horizontalPosition = align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left';
  const verticalPosition = placement === 'top' ? 'bottom-full mb-2' : 'mt-2';

  return (
    <Menu as="div" className={`relative z-40 inline-block min-w-0 text-left ${className}`}>
      {({ open }) => (
        <>
          <Menu.Button
            type="button"
            disabled={disabled || normalizedOptions.length === 0}
            aria-label={ariaLabel}
            className={`flex h-11 w-full items-center gap-2 rounded-xl border bg-[#111] px-3 text-sm font-semibold text-white/75 shadow-sm outline-none transition-all hover:bg-white/[0.04] hover:text-white focus:ring-2 focus:ring-[#ffd555]/20 disabled:cursor-not-allowed disabled:opacity-50 ${
              open ? 'border-[#ffd555]/55 text-white ring-1 ring-[#ffd555]/20' : 'border-white/[0.10] hover:border-[#ffd555]/30'
            } ${buttonClassName}`}
          >
            {Icon && <Icon size={16} className="shrink-0 text-[#d7b94a]/75" />}
            <span className="min-w-0 flex-1 truncate text-left">{selectedOption?.label || 'Select option'}</span>
            <ChevronDown
              size={15}
              className={`shrink-0 text-white/40 transition-transform duration-200 ${open ? 'rotate-180 text-[#d7b94a]' : ''}`}
            />
          </Menu.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-150"
            enterFrom="scale-95 opacity-0 -translate-y-1"
            enterTo="scale-100 opacity-100 translate-y-0"
            leave="transition ease-in duration-100"
            leaveFrom="scale-100 opacity-100 translate-y-0"
            leaveTo="scale-95 opacity-0 -translate-y-1"
          >
            <Menu.Items
              className={`absolute z-[90] max-h-64 min-w-full overflow-y-auto rounded-xl border border-[#ffd555]/20 bg-[#111]/[0.98] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl outline-none [scrollbar-color:rgba(255,213,85,.25)_transparent] [scrollbar-width:thin] ${horizontalPosition} ${verticalPosition} ${menuClassName}`}
            >
              {normalizedOptions.map((option) => (
                <Menu.Item key={String(option.value)} disabled={option.disabled}>
                  {({ focus, disabled: itemDisabled }) => (
                    <button
                      type="button"
                      onClick={() => onChange(option.value)}
                      className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                        focus ? 'bg-[#ffd555]/10 text-[#ffe58a]' : 'text-white/70'
                      } ${itemDisabled ? 'cursor-not-allowed opacity-35' : ''}`}
                    >
                      {value === option.value
                        ? <Check size={14} className="shrink-0 text-[#ffd555]" />
                        : <span className="h-3.5 w-3.5 shrink-0" />}
                      <span className="font-medium">{option.label}</span>
                    </button>
                  )}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );
}

import { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { Check, ChevronDown, Layers3 } from 'lucide-react';

export default function AdminSelect({
  value,
  onChange,
  options = [],
  ariaLabel,
  icon: Icon = Layers3,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  visibleItems,
  align = 'left',
  disabled = false,
}) {
  const selected = options.find((option) => option.value === value) || options[0];
  const menuAlign = align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left';
  const itemHeight = 44;
  const maxMenuHeight = visibleItems ? itemHeight * visibleItems + 8 : undefined;

  return (
    <Menu as="div" className={`relative inline-block text-left ${className}`}>
      <Menu.Button
        aria-label={ariaLabel}
        disabled={disabled}
        className={`inline-flex h-12 w-full items-center justify-between gap-3 rounded-[14px] border border-white/[0.08] bg-[#111111] px-4 text-sm font-bold text-slate-200 shadow-sm transition hover:border-white/15 hover:bg-[#151515] focus:outline-none focus:ring-2 focus:ring-yellow-400/25 disabled:cursor-not-allowed disabled:opacity-60 ${buttonClassName}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {Icon && <Icon size={16} className="shrink-0 text-slate-500" />}
          <span className="truncate">{selected?.label || 'Select'}</span>
        </span>
        <ChevronDown size={15} className="shrink-0 text-slate-500 transition group-data-[headlessui-state=open]:rotate-180" />
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-120"
        enterFrom="opacity-0 scale-95 -translate-y-1"
        enterTo="opacity-100 scale-100 translate-y-0"
        leave="transition ease-in duration-90"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items
          className={`absolute z-50 mt-2 min-w-full overflow-hidden rounded-[14px] border border-white/10 bg-[#111111] py-1 shadow-2xl shadow-black/70 backdrop-blur-xl [scrollbar-color:rgba(255,255,255,.18)_transparent] [scrollbar-width:thin] focus:outline-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-button]:w-0 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 hover:[&::-webkit-scrollbar-thumb]:bg-yellow-400/40 ${menuAlign} ${menuClassName}`}
          style={maxMenuHeight ? { maxHeight: maxMenuHeight, overflowY: 'auto' } : undefined}
        >
          {options.map((option) => (
            <Menu.Item key={option.value} disabled={option.disabled}>
              {({ active, disabled: itemDisabled }) => (
                <button
                  type="button"
                  onClick={() => onChange(option.value)}
                  disabled={itemDisabled}
                  className={`flex h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold transition ${
                    active ? 'bg-white/[0.04] text-white' : 'text-slate-400'
                  } ${itemDisabled ? 'cursor-not-allowed opacity-45' : ''}`}
                >
                  {value === option.value ? (
                    <Check size={15} className="shrink-0 text-yellow-300" />
                  ) : (
                    <span className="h-[15px] w-[15px] shrink-0" />
                  )}
                  <span className="truncate">{option.label}</span>
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

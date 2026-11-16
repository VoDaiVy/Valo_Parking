import { useEffect, useId, useState } from 'react';
import {
  Listbox, ListboxButton, ListboxOption, ListboxOptions,
} from '@headlessui/react';
import { Check, ChevronDown, Info, Loader2, Search, X } from 'lucide-react';
import { searchUsers } from '../../../services/userService';
import { getResponseAvailability } from '../../../utils/staffOperationalAvailability';

const anchor = { to: 'bottom start', gap: 6, padding: 12 };

export default function StaffNotificationAudience({ kind, options, onKindChange, users, onUsersChange, roles, onRolesChange }) {
  return <>
    <div className="snm-audience-controls">
      <Listbox value={kind} onChange={onKindChange}>
        <ListboxButton className="snm-audience-trigger" aria-label="Audience mode">
          <span>{options.find(option => option.id === kind)?.label}</span><ChevronDown size={15} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions anchor={anchor} className="snm-composer-options">
          {options.map(option => <ListboxOption key={option.id} value={option.id} className="snm-composer-option">
            {({ selected }) => <><option.icon size={16} aria-hidden="true" /><span>{option.label}</span>{selected && <Check size={15} aria-hidden="true" />}</>}
          </ListboxOption>)}
        </ListboxOptions>
      </Listbox>
      {kind === 'role' && <Listbox multiple value={roles} onChange={onRolesChange}>
        <ListboxButton className="snm-audience-trigger snm-recipient-trigger" aria-label="Recipient roles">
          <span>{roles.length ? roles.join(', ') : 'Select roles'}</span><ChevronDown size={15} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions anchor={anchor} className="snm-composer-options">
          {['staff', 'customer'].map(role => <ListboxOption key={role} value={role} className="snm-composer-option">
            {({ selected }) => <><span className="capitalize">{role}</span>{selected && <Check size={15} aria-hidden="true" />}</>}
          </ListboxOption>)}
        </ListboxOptions>
      </Listbox>}

      {(kind === 'single' || kind === 'multi') && <RecipientSearch multi={kind === 'multi'} value={users} onChange={onUsersChange} />}
    </div>
    {(kind === 'single' || kind === 'multi') && <div className="snm-recipient-selection">
      {users.length ? <>
        <div className="snm-recipient-chips">
          {users.slice(0, 2).map(user => <span className="snm-compact-chip" key={user._id}>
            <span title={`${user.username || ''} (${user.email || ''})`}>{user.username || user.email}</span>
            <button type="button" aria-label={`Remove ${user.username || user.email}`} onClick={() => onUsersChange(users.filter(item => item._id !== user._id))}><X size={12} /></button>
          </span>)}
          {users.length > 2 && <span className="snm-more-recipients" title={users.slice(2).map(user => user.username || user.email).join(', ')}>+{users.length - 2} more</span>}
        </div>
        <button type="button" className="snm-clear-recipients" onClick={() => onUsersChange([])}>Clear</button>
      </> : <p>{kind === 'multi' ? 'Select at least two active accounts.' : 'Select one active account.'}</p>}
    </div>}
    {kind === 'role' && <p className="snm-audience-help"><Info size={13} aria-hidden="true" />Only active accounts in the selected roles will receive it.</p>}
    {kind === 'all' && <p className="snm-audience-help"><Info size={13} aria-hidden="true" />All eligible active Admin, Staff, and Customer accounts will receive this notification.</p>}
  </>;
}

function RecipientSearch({ multi, value, onChange }) {
  const groupId = useId();
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null);
  const key = JSON.stringify([query, retry]);
  const current = result?.key === key ? result : null;
  const loading = !current;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await searchUsers(query);
        const availability = getResponseAvailability(response, 'User search is unavailable.');
        if (!availability.isAvailable) throw new Error(availability.error);
        if (!Array.isArray(availability.data)) throw new Error('User search is unavailable.');
        if (active) setResult({ key, users: availability.data, error: '' });
      } catch (error) {
        if (active) setResult({ key, users: [], error: error.message || 'User search is unavailable.' });
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, retry, key]);
  function toggle(user) {
    if (!multi) return onChange([user]);
    onChange(value.some(item => item._id === user._id)
      ? value.filter(item => item._id !== user._id) : [...value, user]);
  }
  return <div className="snm-visible-recipients">
    <div className="snm-recipient-search">
      <Search size={15} aria-hidden="true" />
      <input aria-label="Search recipients by username or email" placeholder="Search username or email..." value={query} onChange={event => setQuery(event.target.value)} />
      {query && <button type="button" aria-label="Clear recipient search" onClick={() => setQuery('')}><X size={14} /></button>}
    </div>
    <p className="snm-picker-hint">{multi ? 'Select at least 2 users' : 'Select exactly 1 user'}<span>{value.length} selected</span></p>
    <ul className="snm-recipient-results" aria-label="Eligible active accounts" aria-busy={loading}>
      {loading && <li className="snm-picker-state" role="status"><Loader2 size={16} className="animate-spin" />Searching users...</li>}
      {current?.error && <li className="snm-picker-state" role="alert"><p>{current.error}</p><button type="button" onClick={() => setRetry(count => count + 1)}>Retry</button></li>}
      {current && !current.error && !current.users.length && <li className="snm-picker-state">No active users found.</li>}
      {current?.users.map(user => {
        const selected = value.some(item => item._id === user._id);
        return <li key={user._id}>
          <label className="snm-user-result" data-selected={selected || undefined}>
            <span className="snm-user-initials" aria-hidden="true">{(user.username || user.email || 'U').slice(0, 2).toUpperCase()}</span>
            <span className="snm-user-identity"><strong title={user.username || user.email}>{user.username || user.email}</strong><small title={user.email}>{user.email}</small></span>
            <span className="snm-user-role" data-role={user.role} title={user.role}>{user.role}</span>
            <input className="snm-user-check" type={multi ? 'checkbox' : 'radio'} name={groupId} checked={selected} onChange={() => toggle(user)} aria-label={`Select ${user.username || user.email}`} />
          </label>
        </li>;
      })}
    </ul>
  </div>;
}

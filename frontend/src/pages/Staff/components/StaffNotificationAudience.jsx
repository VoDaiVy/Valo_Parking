import { useEffect, useId, useState } from 'react';
import {
  Listbox, ListboxButton, ListboxOption, ListboxOptions,
} from '@headlessui/react';
import { Check, ChevronDown, Info, Loader2, Search, X } from 'lucide-react';
import { searchUsers } from '../../../services/userService';
import { getResponseAvailability } from '../../../utils/staffOperationalAvailability';

const anchor = { to: 'bottom start', gap: 6, padding: 12 };

export default function StaffNotificationAudience({ kind, options, onKindChange, users, onUsersChange, roles, onRolesChange, t }) {
  return <>
    <div className="snm-audience-controls">
      <Listbox value={kind} onChange={onKindChange}>
        <ListboxButton className="snm-audience-trigger" aria-label={t ? t("staffNotifications.compose.audienceLabel") : "Audience mode"}>
          <span>{options.find(option => option.id === kind)?.label}</span><ChevronDown size={15} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions anchor={anchor} className="snm-composer-options">
          {options.map(option => <ListboxOption key={option.id} value={option.id} className="snm-composer-option">
            {({ selected }) => <><option.icon size={16} aria-hidden="true" /><span>{option.label}</span>{selected && <Check size={15} aria-hidden="true" />}</>}
          </ListboxOption>)}
        </ListboxOptions>
      </Listbox>
      {kind === 'role' && <Listbox multiple value={roles} onChange={onRolesChange}>
        <ListboxButton className="snm-audience-trigger snm-recipient-trigger" aria-label={t ? t("staffNotifications.compose.recipientRoles") : "Recipient roles"}>
          <span>{roles.length ? roles.join(', ') : (t ? t('staffNotifications.compose.selectRoles') : 'Select roles')}</span><ChevronDown size={15} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions anchor={anchor} className="snm-composer-options">
          {['staff', 'customer'].map(role => <ListboxOption key={role} value={role} className="snm-composer-option">
            {({ selected }) => <><span className="capitalize">{role}</span>{selected && <Check size={15} aria-hidden="true" />}</>}
          </ListboxOption>)}
        </ListboxOptions>
      </Listbox>}

      {(kind === 'single' || kind === 'multi') && <RecipientSearch multi={kind === 'multi'} value={users} onChange={onUsersChange} t={t} />}
    </div>
    {(kind === 'single' || kind === 'multi') && <div className="snm-recipient-selection">
      {users.length ? <>
        <div className="snm-recipient-chips">
          {users.slice(0, 2).map(user => <span className="snm-compact-chip" key={user._id}>
            <span title={`${user.username || ''} (${user.email || ''})`}>{user.username || user.email}</span>
            <button type="button" aria-label={t ? t("staffNotifications.compose.userPicker.remove", { username: user.username || user.email }) : `Remove ${user.username || user.email}`} onClick={() => onUsersChange(users.filter(item => item._id !== user._id))}><X size={12} /></button>
          </span>)}
          {users.length > 2 && <span className="snm-more-recipients" title={users.slice(2).map(user => user.username || user.email).join(', ')}>{t ? `+${users.length - 2}` : `+${users.length - 2} more`}</span>}
        </div>
        <button type="button" className="snm-clear-recipients" onClick={() => onUsersChange([])}>{t ? t("staffNotifications.compose.userPicker.clear") : "Clear"}</button>
      </> : <p>{t ? t(`staffNotifications.compose.userPicker.${kind === 'multi' ? 'minUsers' : 'oneUser'}`) : kind === 'multi' ? 'Select at least two active accounts.' : 'Select one active account.'}</p>}
    </div>}
    {kind === 'role' && <p className="snm-audience-help"><Info size={13} aria-hidden="true" />{t ? t("staffNotifications.compose.rolesHint") : "Only active accounts in the selected roles will receive it."}</p>}
    {kind === 'all' && <p className="snm-audience-help"><Info size={13} aria-hidden="true" />{t ? t("staffNotifications.compose.systemWideHint") : "All eligible active Admin, Staff, and Customer accounts will receive this notification."}</p>}
  </>;
}

function RecipientSearch({ multi, value, onChange, t }) {
  const groupId = useId();
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null);
  const unavailable = t ? t("staffNotifications.errors.userSearchUnavailable") : "User search is unavailable.";
  const key = JSON.stringify([query, retry, unavailable]);
  const current = result?.key === key ? result : null;
  const loading = !current;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await searchUsers(query);
        const availability = getResponseAvailability(response, unavailable);
        if (!availability.isAvailable) throw new Error(availability.error);
        if (!Array.isArray(availability.data)) throw new Error(unavailable);
        if (active) setResult({ key, users: availability.data, error: '' });
      } catch (error) {
        if (active) setResult({ key, users: [], error: error.message || unavailable });
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, retry, key, unavailable]);
  function toggle(user) {
    if (!multi) return onChange([user]);
    onChange(value.some(item => item._id === user._id)
      ? value.filter(item => item._id !== user._id) : [...value, user]);
  }
  return <div className="snm-visible-recipients">
    <div className="snm-recipient-search">
      <Search size={15} aria-hidden="true" />
      <input aria-label={t ? t("staffNotifications.compose.userPicker.searchPlaceholder") : "Search recipients by username or email"} placeholder={t ? t("staffNotifications.compose.userPicker.searchPlaceholder") : "Search username or email..."} value={query} onChange={event => setQuery(event.target.value)} />
      {query && <button type="button" aria-label={t ? t("staffNotifications.compose.userPicker.clear") : "Clear recipient search"} onClick={() => setQuery('')}><X size={14} /></button>}
    </div>
    <p className="snm-picker-hint">{t ? t(`staffNotifications.compose.userPicker.${multi ? 'minUsers' : 'oneUser'}`) : multi ? 'Select at least 2 users' : 'Select exactly 1 user'}<span>{t ? t("staffNotifications.compose.userPicker.selected", { count: value.length }) : `${value.length} selected`}</span></p>
    <ul className="snm-recipient-results" aria-label={t ? t("staffNotifications.compose.audienceLabel") : "Eligible active accounts"} aria-busy={loading}>
      {loading && <li className="snm-picker-state" role="status"><Loader2 size={16} className="animate-spin" />{t ? t("staffNotifications.compose.userPicker.searching") : "Searching users..."}</li>}
      {current?.error && <li className="snm-picker-state" role="alert"><p>{current.error}</p><button type="button" onClick={() => setRetry(count => count + 1)}>{t ? t("common.retry") : "Retry"}</button></li>}
      {current && !current.error && !current.users.length && <li className="snm-picker-state">{t ? t("staffNotifications.compose.userPicker.none") : "No active users found."}</li>}
      {current?.users.map(user => {
        const selected = value.some(item => item._id === user._id);
        return <li key={user._id}>
          <label className="snm-user-result" data-selected={selected || undefined}>
            <span className="snm-user-initials" aria-hidden="true">{(user.username || user.email || 'U').slice(0, 2).toUpperCase()}</span>
            <span className="snm-user-identity"><strong title={user.username || user.email}>{user.username || user.email}</strong><small title={user.email}>{user.email}</small></span>
            <span className="snm-user-role" data-role={user.role} title={user.role}>{user.role}</span>
            <input className="snm-user-check" type={multi ? 'checkbox' : 'radio'} name={groupId} checked={selected} onChange={() => toggle(user)} aria-label={t ? `${t("staffNotifications.compose.audience.single")}: ${user.username || user.email}` : `Select ${user.username || user.email}`} />
          </label>
        </li>;
      })}
    </ul>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Car, Check, ChevronDown, CheckCheck, ChevronLeft, ChevronRight, Clock3, ListChecks, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import './StaffMembershipServicesView.css';

const SIZE = 6;
const dateLabel = (value, language) => value ? new Date(value).toLocaleString(language?.startsWith('vi') ? 'vi-VN' : 'en-US') : '—';

function ServiceDropdown({ label, value, onChange, disabled, options, icon: Icon, className = '' }) {
  const selectedOption = options.find((option) => option.value === value) || options[0];
  return <Listbox value={value} onChange={onChange} disabled={disabled}>
    <ListboxButton aria-label={label} className={`ms-dropdown-trigger ${className}`}>
      <Icon size={17} aria-hidden="true" />
      <span>{selectedOption?.label}</span>
      <ChevronDown size={16} className="ms-dropdown-chevron" aria-hidden="true" />
    </ListboxButton>
    <ListboxOptions anchor="bottom start" className="ms-dropdown-options">
      {options.map((option) => <ListboxOption key={option.value} value={option.value} className="ms-dropdown-option">
        <span>{option.label}</span><Check size={16} className="ms-dropdown-check" aria-hidden="true" />
      </ListboxOption>)}
    </ListboxOptions>
  </Listbox>;
}

export default function StaffMembershipServicesView({ t, language, loading, busy, error, reload, search, setSearch, sessions, sessionId, setSessionId, context, grants, requests, selected, toggle, start, cancel, mutate, status, setStatus, pages, sessionPage, setSessionPage, requestPage, setRequestPage, params, activeService, metrics = {}, metricsLoading = false }) {
  const [tab, setTab] = useState('work');
  const [grantPage, setGrantPage] = useState(1);
  const revealedRequest = useRef('');
  const copy = (key, defaultValue, options = {}) => t(`membershipServicesUi.staffWorkspace.${key}`, { defaultValue, ...options });
  const filtered = requests.items.filter((request) => !status || request.status === status);
  const workTotal = Math.max(1, Math.ceil(filtered.length / SIZE));
  const workPage = sessionId ? Math.min(requestPage, workTotal) : requestPage;
  const visible = sessionId ? filtered.slice((workPage - 1) * SIZE, workPage * SIZE) : filtered;
  const grantTotal = Math.max(1, Math.ceil(grants.items.length / SIZE));
  const currentGrantPage = Math.min(grantPage, grantTotal);
  const visibleGrants = grants.items.slice((currentGrantPage - 1) * SIZE, currentGrantPage * SIZE);
  const showGrants = sessionId && tab === 'benefits';
  const vehicle = context || sessions.items.find((session) => session._id === sessionId);
  const requestId = params.get('requestId');
  useEffect(() => {
    if (!sessionId || loading || !requestId || revealedRequest.current === requestId) return;
    const index = filtered.findIndex((request) => request._id === requestId);
    if (index < 0) return;
    revealedRequest.current = requestId;
    setRequestPage(Math.floor(index / SIZE) + 1);
  }, [sessionId, loading, requestId, filtered, setRequestPage]);
  const localPages = (page, total, change) => total > 1 && <div className="ms-page-controls"><button type="button" disabled={loading || busy || page <= 1} onClick={() => change(page - 1)}><ChevronLeft size={15} />{t('membershipServicesUi.previous')}</button><span>{page} / {total}</span><button type="button" disabled={loading || busy || page >= total} onClick={() => change(page + 1)}>{t('membershipServicesUi.next')}<ChevronRight size={15} /></button></div>;

  return <section className="ms-workspace" aria-busy={loading || busy}>
    <header className="ms-header"><div><h1>Membership Services</h1><p>{copy('subtitle', 'Review included services, approve requests and manage work at the parking lot.')}</p></div><button type="button" className="ms-button ms-button-soft" disabled={loading || busy} onClick={reload}><RefreshCw size={16} className={loading ? 'ms-spin' : ''} />{t('membershipServicesUi.refresh')}</button></header>
    <div className="ms-metrics" role="group" aria-label={copy('metricsLabel', 'All service requests')}>
      {[[ListChecks, 'total', 'totalServices', 'Total Services'], [ShieldCheck, 'pending', 'pendingServices', 'Pending Approval'], [Clock3, 'in_progress', 'activeServices', 'In Progress'], [CheckCheck, 'done', 'completedServices', 'Completed']].map(([Icon, key, label, fallback]) => <div className={`ms-metric ms-metric-${key}`} key={key}><Icon size={21} /><div><span>{copy(label, fallback)}</span><strong>{metricsLoading ? '…' : (metrics?.[key] ?? '—')}</strong></div></div>)}
    </div>
    {error && <div role="alert" className="ms-error">{error}</div>}
    <div className="ms-toolbar"><label className="ms-search"><Search size={18} /><input aria-label={t('membershipServicesUi.findVehicle')} value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} placeholder={t('membershipServicesUi.licensePlate')} /></label>
      <ServiceDropdown label={t('membershipServicesUi.activeSession')} value={sessionId} disabled={busy || loading} icon={Car}
        onChange={(value) => { setSessionId(value); setTab('work'); setGrantPage(1); }}
        options={[
          { value: '', label: t('membershipServicesUi.selectVehicle') },
          ...(sessionId && !sessions.items.some((session) => session._id === sessionId)
            ? [{ value: sessionId, label: `${context?.licensePlate || sessionId} · ${context?.parkingSlot || '—'}` }] : []),
          ...sessions.items.map((session) => ({ value: session._id, label: `${session.licensePlate} · ${session.parkingSlot || session._id.slice(-6)}` })),
        ]} />
      <ServiceDropdown className="ms-status-select" label={t('membershipServicesUi.filterRequests')} value={status} disabled={busy || loading || showGrants} icon={ListChecks} onChange={setStatus}
        options={[{ value: '', label: t('membershipServicesUi.all') }, ...['pending', 'in_progress', 'done', 'cancelled'].map((value) => ({ value, label: t(`membershipServicesUi.status.${value}`) }))]} />
    </div>
    {sessions.pagination.totalPages > 1 && <div className="ms-session-pages"><span>{copy('vehicleResults', 'Vehicle results')}</span>{pages(sessions.pagination, sessionPage, setSessionPage)}</div>}
    {!loading && !sessions.items.length && <p className="ms-inline-note">{t('membershipServicesUi.noParkedVehicles')}</p>}
    {sessionId && <div className="ms-view-bar"><div className="ms-tabs" role="tablist" aria-label={copy('viewsLabel', 'Service views')}><button id="ms-work-tab" aria-controls="ms-content" disabled={busy || loading} type="button" role="tab" aria-selected={!showGrants} onClick={() => setTab('work')}>{copy('workTab', 'Work')}</button><button id="ms-benefits-tab" aria-controls="ms-content" disabled={busy || loading} type="button" role="tab" aria-selected={!!showGrants} onClick={() => setTab('benefits')}>{copy('benefitsHeading', 'Included services')}</button></div><span className="ms-vehicle-context"><Car size={14} />{vehicle?.licensePlate || '—'}<span>{vehicle?.parkingSlot || '—'}</span></span></div>}
    <div id="ms-content" className="ms-content" role={sessionId ? 'tabpanel' : undefined} aria-labelledby={sessionId ? (showGrants ? 'ms-benefits-tab' : 'ms-work-tab') : undefined}>
      {loading ? <div className="ms-loading" role="status"><RefreshCw size={22} className="ms-spin" />{t('membershipServicesUi.loading')}</div> : <><div className="ms-table-scroll">
        {showGrants ? <table className="ms-table ms-benefits-table"><thead><tr><th scope="col">{copy('selectColumn', 'SELECT')}</th><th scope="col">{copy('serviceColumn', 'SERVICE')}</th><th scope="col">{copy('sourceColumn', 'SOURCE SPACE')}</th><th scope="col">{copy('allowanceColumn', 'ALLOWANCE')}</th><th scope="col">{copy('validityColumn', 'VALIDITY')}</th></tr></thead><tbody>{visibleGrants.map((grant) => {
          const running = activeService(grant);
          return <tr key={grant._id} className={selected.includes(grant._id) ? 'ms-grant-selected' : ''}><td><input type="checkbox" aria-label={`${t('membershipServicesUi.selectService')}: ${grant.serviceName} · ${grant.slotCode}`} checked={selected.includes(grant._id)} disabled={busy || !grant.canUse || running} onChange={() => toggle(grant)} /></td><td><strong>{grant.serviceName}</strong>{running && <span className="ms-cell-note">{t('membershipServicesUi.inProgress')}</span>}{!grant.canUse && <span className="ms-cell-note">{t('membershipServicesUi.unavailable')}</span>}</td><td><span className="ms-space">{grant.slotCode || '—'}</span></td><td><span className="ms-allowance">{t('membershipServicesUi.allowanceSummary', { total: grant.total, used: grant.used, reserved: grant.reserved, available: grant.available })}</span></td><td className="ms-timeline">{dateLabel(grant.validFrom, language)}<span className="ms-cell-note">{dateLabel(grant.expireAt, language)}</span></td></tr>;
        })}</tbody></table> : <table className="ms-table"><thead><tr><th scope="col">{copy('serviceColumn', 'SERVICE')}</th><th scope="col">{copy('vehicleColumn', 'VEHICLE / SPACE')}</th><th scope="col">{copy('statusColumn', 'STATUS')}</th><th scope="col">{copy('timelineColumn', 'TIMELINE')}</th><th scope="col">{copy('actionsColumn', 'ACTIONS')}</th></tr></thead><tbody>{visible.map((request) => <tr key={request._id} id={`request-${request._id}`} className={requestId === request._id ? 'ms-request-highlight' : ''}>
          <td><div className="ms-service-cell"><Sparkles size={17} /><div><strong>{request.serviceName}</strong><span className="ms-reference">#{request._id.slice(-6).toUpperCase()}</span></div></div>{request.history?.at(-1)?.reason && <p className="ms-reason">{request.history.at(-1).reason}</p>}</td><td><strong className="ms-license">{request.licensePlate || '—'}</strong><span className="ms-space">{request.slotCode || '—'}</span></td><td><span className={`ms-badge ms-badge-${request.status}`}><span />{t(`membershipServicesUi.status.${request.status}`, { defaultValue: request.status })}</span></td>
          <td className="ms-timeline">{request.startedAt && <p>{t('membershipServicesUi.started', { date: dateLabel(request.startedAt, language) })}</p>}{request.completedAt && <p>{t('membershipServicesUi.completed', { date: dateLabel(request.completedAt, language) })}</p>}{!request.startedAt && !request.completedAt && <span>{dateLabel(request.createdAt, language)}</span>}</td>
          <td><div className="ms-row-actions">{request.status === 'pending' && (request.accountingMode === 'customer_reserved' ? <button type="button" className="ms-button ms-button-primary" disabled={busy} onClick={() => mutate(`requests/${request._id}/start`, {})}><ShieldCheck size={15} />{copy('approveStart', 'Approve & start')}</button> : <p className="ms-legacy-hint">{t('membershipServicesUi.cancelEarlier')}</p>)}{request.status === 'in_progress' && <button type="button" className="ms-button ms-button-soft" disabled={busy} onClick={() => mutate(`requests/${request._id}/complete`, {})}><CheckCheck size={15} />{t('membershipServicesUi.complete')}</button>}{['pending', 'in_progress'].includes(request.status) && <button type="button" className="ms-button ms-button-cancel" disabled={busy} onClick={() => cancel(request)}>{t('membershipServicesUi.cancel')}</button>}{['done', 'cancelled'].includes(request.status) && <span className="ms-closed">{copy('closed', 'Closed')}</span>}</div></td>
        </tr>)}</tbody></table>}
        {!(showGrants ? visibleGrants : visible).length && <div className="ms-empty"><ListChecks size={26} /><h3>{showGrants ? t('membershipServicesUi.noAllowances') : t('membershipServicesUi.noWork')}</h3><p>{copy('emptyHint', 'Choose a vehicle to start an included service, or change the status filter.')}</p></div>}
      </div><footer className="ms-table-footer"><span>{showGrants ? copy('selectionCount', '{{count}} services selected', { count: selected.length }) : copy('shown', '{{count}} services shown', { count: visible.length })}</span><div className="ms-pagination">{showGrants ? localPages(currentGrantPage, grantTotal, setGrantPage) : sessionId ? localPages(workPage, workTotal, setRequestPage) : pages(requests.pagination, requestPage, setRequestPage)}</div></footer>{showGrants && <div className="ms-start-bar"><p>{t('membershipServicesUi.staffInstruction')}</p><button type="button" className="ms-button ms-button-primary" disabled={busy || !selected.length} onClick={start}><ShieldCheck size={16} />{t('membershipServicesUi.startSelected', { count: selected.length })}</button></div>}</>}
    </div>
  </section>;
}

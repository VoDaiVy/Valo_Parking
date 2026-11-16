import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Clock3 } from 'lucide-react';
import AIMessageMarkdown from './AIMessageMarkdown';
import { adminDate, adminValue, readableLabel } from '../utils/adminPresentation';

const toolEntities = {
  search_users: 'account', get_user_detail: 'account', get_current_user: 'account',
  search_sessions: 'session', get_active_sessions: 'session', get_session_detail: 'session',
  search_bookings: 'booking', get_booking_detail: 'booking',
  get_subscription_members: 'subscription', get_subscription_detail: 'subscription', get_parking_floors: 'floor', get_parking_slots: 'slot',
  search_ticket_packages: 'package', get_ticket_package_detail: 'package', get_package_list: 'package',
  search_services: 'service', get_service_detail: 'service', get_service_catalog: 'service',
};
function linkKey(url) {
  const [path, query = ''] = String(url).split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of params) if (/Id$/.test(key)) params.set(key, value.toLowerCase());
  params.sort();
  return `${path}?${params}`;
}
function linkIdentity(link) {
  const [path, query] = link.url.split('?');
  const params = new URLSearchParams(query);
  const mapping = { '/admin/accounts': ['account', 'userId'], '/admin/sessions': ['session', 'sessionId'], '/admin/subscriptions': ['subscription', 'subscriptionId'], '/admin/tickets': ['package', 'packageId'], '/admin/services': ['service', 'serviceId'], '/admin/pricing': ['pricing', null] };
  const [type, parameter] = mapping[path] || (params.has('bookingId') ? ['booking', 'bookingId'] : params.has('slotId') ? ['slot', 'slotId'] : ['floor', 'floorId']);
  return { type, id: params.get(parameter)?.toLowerCase(), action: type === 'subscription' ? 'View Membership' : `View ${readableLabel(type)}` };
}
function evidenceRecords(evidence = []) {
  const records = new Map();
  for (const entry of evidence) {
    const type = toolEntities[entry.tool];
    if (!type) continue;
    const data = entry.data;
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : data ? [data] : [];
    for (const item of items) if (item?._id) {
      const key = `${type}:${String(item._id).toLowerCase()}`;
      records.set(key, { ...records.get(key), ...item });
    }
  }
  return records;
}
function accountReadTime(evidence = [], id) {
  return [...evidence].reverse().find(entry => {
    if (toolEntities[entry.tool] !== 'account') return false;
    const items = Array.isArray(entry.data?.items) ? entry.data.items : [entry.data];
    return items.some(item => String(item?._id).toLowerCase() === String(id).toLowerCase());
  })?.timestamp;
}
function displayValue(value, key) {
  if (value === undefined || value === null) return 'Not available';
  if (['status', 'isActive'].includes(key) && (typeof value === 'boolean' || ['true', 'false'].includes(value))) return value === true || value === 'true' ? 'Active' : 'Inactive';
  if (['status', 'role', 'paymentStatus'].includes(key) && typeof value === 'string') return readableLabel(value.toLowerCase());
  if (typeof value === 'string' && /(?:Time|At|Date)$/.test(key)) {
    const iso = value.match(/^\d{4}-\d{2}-\d{2}T[^ ]+/)?.[0] || value;
    if (Number.isFinite(Date.parse(iso))) return adminDate(iso);
  }
  return adminValue(value);
}
function cleanMessage(row, links) {
  const verified = new Set(links.map(link => linkKey(link.url)));
  const action = /^(?:account link|(?:view|open)(?:\s+(?:the|this))?\s+(?:account|user|session|booking|subscription|membership|pricing|floor|slot|record|details)(?:\s+details)?)[.!]?$/i;
  return String(row.message || '').replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (match, label, url) => verified.has(linkKey(url)) ? (action.test(label.trim()) ? '' : label) : match)
    .replace(/\(\s*(?:source|verified(?: at| on)?|verification time)\s*:[^\n)]*\)/gi, '')
    .replace(/\s*(?:[|;\u00b7]\s*)?(?:\*\*)?\b(?:source|verified(?: at| on)?|verification time|timestamp)(?:\*\*)?\s*:[^\n]*/gi, '')
    .replace(/\bView (?:Account|Session|Membership|Subscription)\s*\)+/gi, '')
    .replace(/(?:\*\*|__)?\bstatus(?:\*\*|__)?\s*:\s*(?:`)?(true|false)\b(?:`)?(?:\*\*|__)?/gi, (_, value) => `Status: ${value.toLowerCase() === 'true' ? 'Active' : 'Inactive'}`)
    .split('\n').filter(line => {
      const plain = line.replace(/[*_`]/g, '').replace(/^[\s>#-]+/, '').trim();
      if (/^(?:Sources?(?: and Timestamps?)?|Timestamp|Draft ID|User ID|Account ID|Session ID|Account Link|Session Link|View Account|View Session|Verification time|Verified(?: at| on)?)\s*:/i.test(plain) || /^(?:View (?:Account|Session))?[\s()[\].!]*$/i.test(plain) || /^\s*(?:[-*+] |\d+\. )\s*$/.test(line)) return false;
      if (!row.accountResult) return true;
      // Cards already contain account facts and authoritative result counts.
      return !/^(?:(?:found\s+)?\d+\s+accounts?(?:\s+(?:found|returned))?(?:\s*\(showing[^)]*\))?[.!]?|(?:i\s+)?found\s+\d+\s+accounts?\b.*|no (?:matching\s+)?accounts?(?:\s+were)?\s+found\b.*|you are signed in as\b.*|(?:username|email|role|status|phone|full name|membership|vip)\s*:.*)$/i.test(plain);
    }).join('\n').replace(/\b[a-f\d]{24}\b/gi, '(record)').replace(/\n{3,}/g, '\n\n').trim();
}
function accountExplanation(text) {
  // Verified cards own the account facts; retain only action outcomes and clarification.
  return text.split('\n').filter(line => /\b(?:cannot|can't|forbidden|not allowed|already|no changes|choose|select|which account|please specify)\b|\?/i.test(line)).join('\n');
}
function membershipStatus(record, verifiedAt) {
  const isVip = record?.membership?.isVip;
  const active = record?.vipActive;
  const expiry = record?.membership?.expireAt;
  const expiryTime = expiry ? new Date(expiry).getTime() : NaN;
  if (isVip === false) return active === true ? 'Unavailable' : 'Standard';
  if (active === true) return 'VIP';
  if (isVip !== true) return 'Unavailable';
  if (active === false) return Number.isFinite(expiryTime) ? 'Expired' : 'Unavailable';
  if (!expiry) return 'VIP';
  const readTime = verifiedAt ? new Date(verifiedAt).getTime() : NaN;
  if (!Number.isFinite(expiryTime) || !Number.isFinite(readTime)) return 'Unavailable';
  return expiryTime <= readTime ? 'Expired' : 'VIP';
}
function EntityAction({ link, onNavigate }) {
  return <Link to={link.url} className="admin-ai-entity-link" title={link.label} aria-label={`${linkIdentity(link).action}: ${link.label}`} onClick={onNavigate}>{linkIdentity(link).action}<ArrowUpRight size={12} aria-hidden="true"/></Link>;
}
function EntityRow({ link, record, onNavigate, kind, verifiedAt, showExpiry, showVehicles }) {
  const type = kind || linkIdentity(link).type;
  const title = type === 'account' ? record?.username || record?.email : type === 'subscription' ? record?.ticketPackage?.name || 'Membership' : record?.licensePlate || record?.ticketPackage?.name || record?.name || record?.slotNumber;
  const subline = type === 'account' ? record?.email : type === 'subscription' ? '' : [record?.userId?.email || record?.user?.email, record?.floorId?.name || record?.floorID?.name, record?.parkingSlot].filter(Boolean).join(' / ');
  const fields = type === 'account' ? [] : type === 'subscription' ? ['validFrom', 'expireAt', 'amount', 'paymentStatus', 'renewalCount', 'lastRenewedAt'] : ['checkInTime', 'checkOutTime', 'scheduledStart', 'scheduledEnd', 'validFrom', 'expireAt', 'totalPrice', 'amount', 'prepaidAmount', 'paymentStatus'];
  const details = fields.filter(key => record?.[key] !== undefined && !(type === 'subscription' && showExpiry && key === 'expireAt'));
  const fullName = type === 'account' ? [record?.profile?.firstName, record?.profile?.lastName].filter(Boolean).join(' ') : '';
  const expiry = record?.membership?.expireAt;
  const membership = type === 'account' ? membershipStatus(record, verifiedAt) : null;
  const owners = type === 'subscription' ? record?.currentOwners : null;
  return <div className="admin-ai-result-row">
    <div className="admin-ai-result-heading"><strong>{title || link?.label || 'Account'}</strong>{link && <EntityAction link={link} onNavigate={onNavigate}/>}</div>
    {subline && subline !== title && <p className="admin-ai-result-subtitle">{subline}</p>}
    {fullName && <p className="admin-ai-result-subtitle">{fullName}</p>}
    {record?.profile?.phone && <p className="admin-ai-result-subtitle">{record.profile.phone}</p>}
    {type === 'session' && record?.phone && <p className="admin-ai-result-subtitle">Phone: {record.phone}</p>}
    {type === 'subscription' && <>
      <p className="admin-ai-result-subtitle">Original purchaser: {[record?.user?.username, record?.user?.email].filter(Boolean).join(' / ') || 'Unavailable'}</p>
      <p className="admin-ai-result-subtitle">Current slot owners: {owners?.length ? owners.map(owner => owner.email || owner.username).filter(Boolean).join(', ') : 'Unavailable'}</p>
      {!!record?.slots?.length && <p className="admin-ai-result-subtitle">Slots: {record.slots.map(slot => [slot.floorId?.name, slot.slotCode].filter(Boolean).join(' / ')).join(', ')}</p>}
      {showExpiry && <p className="admin-ai-result-subtitle">Expiry: {displayValue(record?.expireAt, 'expireAt')}</p>}
      {showVehicles && <p className="admin-ai-result-subtitle">Vehicles on file (purchaser/current owners): {Array.isArray(record?.linkedVehicles) ? [...new Set(record.linkedVehicles.map(vehicle => vehicle.licensePlate).filter(Boolean))].join(', ') || 'None' : 'Unverified'}</p>}
    </>}
    <div className="admin-ai-result-badges">
      {record?.role && <span>{displayValue(record.role, 'role')}</span>}
      {type === 'account' ? <>
        <span className={record?.status === true ? 'is-active' : ''}>Account Status: {typeof record?.status === 'boolean' ? displayValue(record.status, 'status') : 'Unavailable'}</span>
        <span className={membership === 'VIP' ? 'is-vip' : ''}>Membership Status: {membership}</span>
      </> : type === 'subscription' ? <span>Membership Status: {displayValue(record?.effectiveStatus || record?.status, 'status')}</span> : record?.status !== undefined && <span className={record.status === true ? 'is-active' : ''}>{displayValue(record.status, 'status')}</span>}
    </div>
    {type === 'session' && <p className="admin-ai-result-subtitle">{['entry', 'exit'].map((side, index) => {
      const available = record?.imageAvailability?.[side];
      return <span key={side}>{index > 0 && ' / '}{readableLabel(side)} image: {available === true ? 'Recorded' : available === false ? 'Not recorded' : 'Unverified'}</span>;
    })}</p>}
    {type === 'account' && ['VIP', 'Expired'].includes(membership) && expiry && Number.isFinite(new Date(expiry).getTime()) && <p className="admin-ai-result-subtitle">{membership === 'VIP' ? 'VIP expires' : 'Membership expiry'} {displayValue(expiry, 'expireAt')}</p>}
    {type === 'subscription' && record?.effectiveStatus && record.effectiveStatus !== record.status && <p className="admin-ai-result-subtitle">Stored status: {displayValue(record.status, 'status')}</p>}
    {!!details.length && <details className="admin-ai-result-details"><summary>More information</summary><dl>{details.map(key => <div key={key}><dt>{readableLabel(key)}</dt><dd>{displayValue(record[key], key)}{((type === 'session' && key === 'totalPrice') || (type === 'subscription' && key === 'amount')) && typeof record[key] === 'number' ? ' VND' : ''}</dd></div>)}</dl></details>}
  </div>;
}
function PackageCard({ record, link, onNavigate }) {
  return <div className="admin-ai-result-row">
    <div className="admin-ai-result-heading"><strong>{record.name || 'Ticket package'}</strong>{link && <EntityAction link={link} onNavigate={onNavigate}/>}</div>
    <p className="admin-ai-result-subtitle">{record.description || 'No description recorded.'}</p>
    <div className="admin-ai-result-badges admin-ai-package-badges"><span>Type: {record.type ? readableLabel(record.type) : 'Unavailable'}</span>{' '}<span className={record.isActive === true ? 'is-active' : ''}>Status: {typeof record.isActive === 'boolean' ? (record.isActive ? 'Active' : 'Inactive') : 'Unavailable'}</span></div>
    <p className="admin-ai-result-subtitle">Price: {Number.isFinite(record.price) ? `${adminValue(record.price)} VND` : 'Unavailable'}</p>
    <p className="admin-ai-result-subtitle">Updated: {displayValue(record.updatedAt, 'updatedAt')}</p>
  </div>;
}
export function AdminChatAnswer({ row, onNavigate }) {
  if (row.draft) return null; // The proposal itself is the primary presentation for this turn.
  const links = [...new Map((row.links || []).map(link => [linkKey(link.url), link])).values()];
  const text = cleanMessage(row, links);
  if (['error', 'no_op'].includes(row.type)) return <AIMessageMarkdown text={text}/>;
  if (row.accountStale) return <><p>Account information has changed. Open the account for current details.</p>{links.filter(link => linkIdentity(link).type === 'account').map(link => <EntityAction key={linkKey(link.url)} link={link} onNavigate={onNavigate}/>)}</>;
  const packageEvidence = (row.evidence || []).filter(entry => toolEntities[entry.tool] === 'package');
  const serviceEvidence = (row.evidence || []).filter(entry => toolEntities[entry.tool] === 'service');
  const serviceStats = [...(row.evidence || [])].reverse().find(entry => entry.tool === 'get_service_stats')?.data;
  if (serviceEvidence.length || serviceStats) {
    const latest = serviceEvidence.at(-1);
    const records = [...evidenceRecords(latest ? [latest] : []).values()];
    return <div className="admin-ai-results" aria-label="Service results">
      {serviceStats && <section className="admin-ai-result-row"><strong>Service statistics</strong><div className="admin-ai-result-details"><dl>
        {['total', 'active', 'inactive'].map(key => <div key={key}><dt>{readableLabel(key)}</dt><dd>{displayValue(serviceStats.summary?.[key], key)}</dd></div>)}
        <div><dt>Average price</dt><dd>{Number.isFinite(serviceStats.summary?.averagePrice) ? `${adminValue(Math.round(serviceStats.summary.averagePrice))} VND` : 'Unavailable'}</dd></div>
      </dl></div></section>}
      {latest && !records.length && <p className="admin-ai-account-count">No services found.</p>}
      {latest?.data?.total > records.length && <p className="admin-ai-account-count">Showing {records.length} of {latest.data.total} services</p>}
      {records.map(record => <div key={record._id} className="admin-ai-result-row">
        <div className="admin-ai-result-heading"><strong>{record.name || 'Service'}</strong>{links.filter(link => { const identity = linkIdentity(link); return identity.type === 'service' && identity.id === String(record._id).toLowerCase(); }).map(link => <EntityAction key={linkKey(link.url)} link={link} onNavigate={onNavigate}/>)}</div>
        <p className="admin-ai-result-subtitle">{record.description || 'No description recorded.'}</p>
        <p className="admin-ai-result-subtitle">Price: {Number.isFinite(record.price) ? `${adminValue(record.price)} VND` : 'Unavailable'} · Duration: {Number.isFinite(record.timeCost) ? `${record.timeCost} min` : 'Unavailable'}</p>
        <p className="admin-ai-result-subtitle">Status: {typeof record.isActive === 'boolean' ? record.isActive ? 'Active' : 'Inactive' : 'Unavailable'}</p>
        <p className="admin-ai-result-subtitle">Updated: {displayValue(record.updatedAt, 'updatedAt')}</p>
      </div>)}
    </div>;
  }
  const packageStats = [...(row.evidence || [])].reverse().find(entry => entry.tool === 'get_ticket_package_stats')?.data;
  const packageTypeGroups = (packageStats?.byType || []).filter(group => typeof group?._id === 'string' && group._id.trim() && Number.isFinite(group.total) && group.total > 0);
  if (packageEvidence.length || packageStats) {
    const latest = packageEvidence.at(-1);
    // A refined search replaces the previous result set, including an empty match.
    const records = latest?.tool === 'get_ticket_package_detail' ? [latest.data] : [...evidenceRecords(latest ? [latest] : []).values()];
    const total = latest?.data?.total;
    return <div className="admin-ai-results" aria-label="Ticket package results">
      {packageStats && <section className="admin-ai-result-row"><strong>Ticket package statistics</strong><div className="admin-ai-result-details"><dl>
        {['total', 'active', 'inactive'].filter(key => packageStats.summary?.[key] !== undefined).map(key => <div key={key}><dt>{readableLabel(key)}</dt><dd>{adminValue(packageStats.summary[key])}</dd></div>)}
        <div><dt>Last updated</dt><dd>{displayValue(packageStats.summary?.latestUpdated, 'updatedAt')}</dd></div>
      </dl></div>{packageTypeGroups.length > 0 && <details className="admin-ai-result-details"><summary>By type</summary><dl>{packageTypeGroups.map(group => <div key={group._id}><dt>{readableLabel(group._id)}</dt><dd>{adminValue(group.total)} total / {adminValue(group.active)} active / {adminValue(group.inactive)} inactive</dd></div>)}</dl></details>}</section>}
      {!records.length && !packageStats && <p className="admin-ai-account-count">No ticket packages found.</p>}
      {total > records.length && <p className="admin-ai-account-count">Showing {records.length} of {total} packages</p>}
      {records.map(record => <PackageCard key={record._id} record={record} link={links.find(link => { const identity = linkIdentity(link); return identity.type === 'package' && identity.id === String(record._id).toLowerCase(); })} onNavigate={onNavigate}/>)}
    </div>;
  }
  const membershipEvidence = (row.evidence || []).filter(entry => toolEntities[entry.tool] === 'subscription');
  const membershipStats = [...(row.evidence || [])].reverse().find(entry => entry.tool === 'get_subscription_stats')?.data;
  if (membershipEvidence.length || membershipStats) {
    const records = [...evidenceRecords(membershipEvidence).values()];
    const total = membershipEvidence.length === 1 ? membershipEvidence[0].data?.total : undefined;
    const presentation = row.membershipPresentation || {};
    const requestedKpis = presentation.kpis || membershipStats?.requestedKpis;
    const labels = { total: 'Total Memberships', active: 'Stored active records', expiringSoon: 'Expiring Soon (30 days)', pendingTransfers: 'Pending Transfers', sold: 'Subscriptions created in period', pending: 'Pending subscriptions', expired: 'Stored expired records', cancelled: 'Cancelled records', failed: 'Failed records', expiringWithin7Days: 'Expiring within 7 days', grossAmount: 'Paid subscription amount in period (VND)', renewalCount: 'Renewals in period', renewalAmount: 'Renewal amount in period (VND)', renewalRate: 'Renewal rate (%)', activeReservedSlots: 'Active paid reserved slots', averageSlotsPerActiveSubscription: 'Average slots per active paid subscription' };
    const statisticKeys = Object.keys(labels).filter(key => requestedKpis ? requestedKpis.includes(key) : membershipStats?.summary?.[key] !== undefined);
    const showPackages = presentation.byPackage ?? !requestedKpis;
    const showTimeline = presentation.timeline ?? !requestedKpis;
    const financial = statisticKeys.some(key => ['grossAmount', 'renewalAmount', 'renewalCount', 'renewalRate'].includes(key)) || showPackages || showTimeline;
    const periodRelevant = statisticKeys.some(key => ['sold', 'grossAmount', 'renewalCount', 'renewalAmount', 'renewalRate'].includes(key)) || showPackages || showTimeline;
    return <div className="admin-ai-results" aria-label="Membership results">
      {membershipStats && <section className="admin-ai-result-row"><strong>Membership statistics</strong>
        {periodRelevant && membershipStats.period && <p className="admin-ai-result-subtitle">Period: {membershipStats.period.startDate ? `${displayValue(membershipStats.period.startDate, 'startDate')} to ` : 'All records through '}{displayValue(membershipStats.period.endDate, 'endDate')} (Vietnam)</p>}
        <div className="admin-ai-result-details"><dl>{statisticKeys.map(key => <div key={key}><dt>{labels[key]}</dt><dd>{membershipStats.summary?.[key] === undefined ? 'Unavailable' : adminValue(membershipStats.summary[key])}</dd></div>)}</dl></div>
        {showPackages && membershipStats.byPackage?.length > 0 && <details className="admin-ai-result-details"><summary>Paid subscriptions by package</summary><dl>{membershipStats.byPackage.map((pkg, index) => <div key={index}><dt>{pkg.packageName || 'Package unavailable'}</dt><dd>{adminValue(pkg.sold)} subscriptions / {adminValue(pkg.amount)} VND / {adminValue(pkg.slots)} slots</dd></div>)}</dl></details>}
        {showTimeline && membershipStats.timeline?.points?.length > 0 && <details className="admin-ai-result-details"><summary>Sales timeline (Vietnam)</summary><dl>{membershipStats.timeline.points.map(point => <div key={point.period}><dt>{point.period}</dt><dd>Subscriptions: {adminValue(point.packageSales)} VND / Renewals: {adminValue(point.renewalSales)} VND</dd></div>)}</dl></details>}
        {financial && membershipStats.financialCoverage === 'partial' && <p className="admin-ai-result-subtitle">Financial coverage is partial.</p>}
      </section>}
      {!records.length && membershipEvidence.length > 0 && <p className="admin-ai-account-count">No memberships found.</p>}
      {total > records.length && <p className="admin-ai-account-count">Showing {records.length} of {total} memberships</p>}
      {records.map(record => <EntityRow key={record._id} kind="subscription" record={record} showExpiry={presentation.includeExpiry} showVehicles={presentation.includeVehicles} link={links.find(link => { const identity = linkIdentity(link); return identity.type === 'subscription' && identity.id === String(record._id).toLowerCase(); })} onNavigate={onNavigate}/>)}
    </div>;
  }
  if (row.accountResult) {
    const result = row.accountResult;
    const queries = result.queries?.length > 1 ? [...new Map(result.queries.map(query => [JSON.stringify({ filters: query.filters, sortBy: query.sortBy, sortOrder: query.sortOrder }), query])).values()] : [result];
    const explanation = accountExplanation(text);
    return <div className="admin-ai-results" aria-label="Account results">{explanation && <AIMessageMarkdown text={explanation}/>}{queries.map((query, index) => <section key={index}>
      {!(queries.length === 1 && query.total === 1 && query.items.length === 1) && <p className="admin-ai-account-count">{`${query.filters?.role ? `${readableLabel(query.filters.role)}: ` : ''}${query.total} ${query.total === 1 ? 'account' : 'accounts'} found${query.total > query.items.length ? ` (showing ${query.items.length})` : ''}`}</p>}
      {query.items.map(account => <EntityRow key={account._id} kind="account" verifiedAt={accountReadTime(row.evidence, account._id)} record={account} link={links.find(link => { const identity = linkIdentity(link); return identity.type === 'account' && identity.id === String(account._id).toLowerCase(); })} onNavigate={onNavigate}/>)}
    </section>)}</div>;
  }
  const sessionEvidence = (row.evidence || []).filter(entry => toolEntities[entry.tool] === 'session');
  if (sessionEvidence.length) {
    const records = [...evidenceRecords(sessionEvidence).values()];
    const total = sessionEvidence.length === 1 ? sessionEvidence[0].data?.total : undefined;
    const explanation = accountExplanation(text);
    return <div className="admin-ai-results" aria-label="Session results">
      {explanation && <AIMessageMarkdown text={explanation}/>}
      {!records.length && <p className="admin-ai-account-count">No sessions found.</p>}
      {total > records.length && <p className="admin-ai-account-count">Showing {records.length} of {total} sessions</p>}
      {records.map(record => <EntityRow key={record._id} kind="session" record={record} link={links.find(link => { const identity = linkIdentity(link); return identity.type === 'session' && identity.id === String(record._id).toLowerCase(); })} onNavigate={onNavigate}/>)}
    </div>;
  }
  const summary = [...(row.evidence || [])].reverse().find(entry => entry.tool === 'get_user_summary')?.data;
  if (Array.isArray(summary)) return <div className="admin-ai-results"><p className="admin-ai-account-count">{summary.reduce((total, group) => total + group.count, 0)} accounts</p>{summary.map((group, index) => <div className="admin-ai-result-row" key={index}><strong>{readableLabel(group._id.role)} / {group._id.active ? 'Active' : 'Inactive'}</strong><span> {group.count}</span></div>)}</div>;

  if (links.length === 1 && linkIdentity(links[0]).type === 'account') {
    const record = evidenceRecords(row.evidence).get(`account:${linkIdentity(links[0]).id}`);
    if (record) return <div className="admin-ai-results">{accountExplanation(text) && <AIMessageMarkdown text={accountExplanation(text)}/>}<EntityRow verifiedAt={accountReadTime(row.evidence, record._id)} link={links[0]} record={record} onNavigate={onNavigate}/></div>;
  }
  if (links.length > 1) {
    const records = evidenceRecords(row.evidence);
    return <div className="admin-ai-results" aria-label="Related records">
      {links.map(link => { const { type, id } = linkIdentity(link); return <EntityRow verifiedAt={type === 'account' ? accountReadTime(row.evidence, id) : row.at || row.evidence?.at(-1)?.timestamp} key={linkKey(link.url)} link={link} record={records.get(`${type}:${id}`)} onNavigate={onNavigate}/>; })}
      {text && <details className="admin-ai-answer-notes"><summary>Additional information</summary><AIMessageMarkdown text={text}/></details>}
    </div>;
  }
  return <><AIMessageMarkdown text={text}/>{!!links.length && <div className="admin-ai-entity-actions">{links.map(link => <EntityAction key={linkKey(link.url)} link={link} onNavigate={onNavigate}/>)}</div>}</>;
}
function currentField(current, key) {
  if (Object.hasOwn(current, key)) return current[key];
  return current.profile?.[key];
}
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparable(value[key])]));
  return value;
}
function Change({ field, before, after }) {
  const content = <div className="admin-ai-change-values"><span>{displayValue(before, field)}</span><ArrowRight size={13} aria-label="to"/><strong>{displayValue(after, field)}</strong></div>;
  const long = [before, after].some(value => value && (typeof value === 'object' || String(value).length > 140));
  return long ? <details className="admin-ai-change"><summary>{readableLabel(field)}</summary>{content}</details> : <div className="admin-ai-change"><span className="admin-ai-change-label">{readableLabel(field)}</span>{content}</div>;
}
export function AdminDraft({ draft, busy, decide }) {
  const current = draft.current || {};
  const records = [...evidenceRecords(draft.evidence).values()];
  const record = current._id ? records.find(item => String(item._id).toLowerCase() === String(current._id).toLowerCase()) : null;
  const snapshot = { ...record, ...current };
  const payload = draft.payload || {};
  const changed = Object.entries(payload).filter(([key, value]) => JSON.stringify(comparable(currentField(snapshot, key))) !== JSON.stringify(comparable(value)));
  const target = snapshot.email || snapshot.username || snapshot.licensePlate || snapshot.name || snapshot.title || payload.name || payload.title || (draft.type === 'MODIFY_PRICING' ? 'Current pricing configuration' : draft.type.startsWith('CREATE_') ? 'New record' : 'Target details unavailable');
  return <section className="valo-ai-draft admin-ai-compact-draft" aria-label="Proposed change">
    <header className="admin-ai-draft-heading"><strong>{readableLabel(draft.type.toLowerCase())}</strong><span className="admin-ai-pending"><Clock3 size={11}/>{draft.status === 'EXECUTED' ? 'Applied' : draft.status === 'REJECTED' ? 'Rejected' : 'Pending Approval'}</span></header>
    <p className="admin-ai-draft-target" title={target}>{target}</p>
    {!!changed.length && <div className="admin-ai-change-list"><div className="admin-ai-change-columns"><span>Before</span><span>After</span></div>{changed.map(([key, value]) => <Change key={key} field={key} before={currentField(snapshot, key)} after={value}/>)}</div>}
    {draft.type === 'CREATE_SERVICE' && <p className="admin-ai-service-note">Add service images on the Services page after approval.</p>}
    {(!draft.status || draft.status === 'PENDING') && <div className="valo-ai-draft-actions"><button type="button" disabled={busy} onClick={() => decide(draft, false)}>Reject</button><button type="button" disabled={busy} onClick={() => decide(draft, true)}>{busy ? 'Processing...' : 'Approve and apply'}</button></div>}
  </section>;
}

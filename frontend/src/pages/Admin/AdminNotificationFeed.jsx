import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Eye, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import AdminSelect from '../../components/Admin/AdminSelect';
import { getAdminHistory } from '../../services/notificationService';
import { getResponseAvailability } from '../../utils/staffOperationalAvailability';
import { notificationLabel, notificationPresentation } from '../../utils/notificationPresentation';
import { getPaginationPages } from '../Staff/sessionPagination';
import './adminNotificationFeed.css';

const priorities = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM'];
const tones = { INFO: '#67d7e5', SUCCESS: '#54e3b0', WARNING: '#e7c278', ERROR: '#f2a5af', SYSTEM: '#c4a7f5' };
const date = (value, language, t) => {
  const parsed = value && new Date(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : t('staffNotifications.drawer.timeUnavailable');
};

export default function AdminNotificationFeed({ source, onRefresh, t, language }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const key = JSON.stringify([query.trim(), filter, page, retry]);
  const current = result?.key === key && result.source === source ? result : null;
  const loading = !current;
  const d = key => t(`staffNotifications.drawer.${key}`);
  const labels = language === 'vi' ? ['Tiêu đề thông báo', 'Loại', 'Danh mục', 'Trạng thái', 'Thời gian gửi', 'Thao tác'] : ['Notification title', 'Type', 'Category', 'Status', 'Sent time', 'Action'];
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await getAdminHistory({ page, limit: 4, priority: filter === 'ALL' ? undefined : filter, search: query.trim() || undefined });
        const availability = getResponseAvailability(response, t('staffNotifications.errors.historyUnavailable'));
        if (!availability.isAvailable) throw new Error(availability.error);
        const pagination = response.data.pagination;
        if (!Array.isArray(availability.data) || !Number.isInteger(pagination?.total) || pagination.total < 0 || !Number.isInteger(pagination?.totalPages) || pagination.totalPages < 0) throw new Error(t('staffNotifications.errors.paginationUnavailable'));
        if (cancelled) return;
        const pages = Math.max(1, pagination.totalPages);
        if (page > pages) { setPage(pages); return; }
        setResult({ key, source, items: availability.data, total: pagination.total, pages });
      } catch (error) {
        if (!cancelled) setResult({ key, source, items: [], error: error.message });
      }
    }, query.trim() ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, filter, page, retry, key, source, t]);
  const status = m => m.isRevoked ? d('revoked') : m.status ? notificationLabel('status', m.status, t) : d('sent');
  const recipient = m => m.targetType === 'ALL_USERS' ? d('allUsers') : m.targetType === 'ROLE_BASED' ? m.targetRoles?.map(role => notificationLabel('roles', role, t)).join(', ') || d('selectedRoles') : m.targetUsers?.length ? m.targetUsers.map(user => typeof user === 'object' && user ? [user.username || user.fullName || user.name, user.email].filter(Boolean).join(', ') || d('userUnavailable') : d('userUnavailable')).join('; ') : d('inbox');
  const badge = m => <span className="anf-badge" style={{ color: tones[m.priority] || tones.INFO }}>{notificationLabel('priority', m.priority || 'INFO', t)}</span>;
  const stateBadge = m => <span className="anf-badge" data-status={m.isRevoked ? 'REVOKED' : m.status || 'SENT'}>{status(m)}</span>;
  return <div className="admin-notification-feed">
    <div className="anf-toolbar">
      <label className="anf-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} aria-label={t('staffNotifications.filters.searchHistory')} placeholder={t('staffNotifications.filters.searchPlaceholder')} /></label>
      <AdminSelect value={filter} onChange={value => { setFilter(value); setPage(1); }} options={['ALL', ...priorities].map(value => ({ value, label: value === 'ALL' ? t('staffNotifications.filters.allSeverities') : notificationLabel('priority', value, t) }))} icon={null} ariaLabel={labels[1]} buttonClassName="anf-select" menuAnchor="bottom end" />
      <button type="button" className="anf-icon" aria-label={t('staffNotifications.actions.refreshHistory')} title={t('staffNotifications.actions.refreshHistory')} disabled={loading} onClick={() => { setRetry(value => value + 1); onRefresh(); }}><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
    </div>
    <div className="anf-table-scroll"><table aria-label={t('staffNotifications.feed.liveEvents')} aria-busy={loading}><thead><tr>{labels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {loading || current?.error || !current?.items.length ? <tr><td colSpan={6} className="anf-empty"><span role={current?.error ? 'alert' : 'status'}>{loading ? t('staffNotifications.feed.loadingHistory') : current.error || t('staffNotifications.feed.noMatching')}</span>{current?.error && <button type="button" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button>}</td></tr> : current.items.map(m => {
        const title = notificationPresentation(m, t).title || d('untitled');
        return <tr key={m._id || m.id} onClick={() => setSelected(m)}><td><button type="button" className="anf-title" onClick={() => setSelected(m)} aria-haspopup="dialog" title={title}>{title}</button></td><td>{badge(m)}</td><td>{notificationLabel('type', m.type || 'SYSTEM', t)}</td><td>{stateBadge(m)}</td><td><time>{date(m.createdAt, language, t)}</time></td><td><button type="button" className="anf-icon" aria-label={t('staffNotifications.drawer.view', { title })} onClick={event => { event.stopPropagation(); setSelected(m); }}><Eye size={17} /></button></td></tr>;
      })}
    </tbody></table></div>
    <nav className="anf-pagination" aria-label={t('staffNotifications.feed.pagesAria')}><span>{loading ? t('common.loading') : current.error ? t('staffNotifications.feed.resultsUnavailable') : t('subscriptionPagination.pageSummary', { current: page, total: current.pages, count: current.total })}</span><div>
      <button type="button" disabled={loading || !!current?.error || page === 1} onClick={() => setPage(page - 1)}>{t('subscriptionPagination.previous')}</button>
      {!loading && !current.error && getPaginationPages(page, current.pages).map(number => typeof number === 'number' ? <button type="button" key={number} aria-current={number === page ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button> : <span key={number}>...</span>)}
      <button type="button" disabled={loading || !!current?.error || page >= current?.pages} onClick={() => setPage(page + 1)}>{t('subscriptionPagination.next')}</button>
    </div></nav>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} className="anf-dialog"><div className="anf-backdrop" aria-hidden="true" /><div className="anf-dialog-position"><DialogPanel className="anf-panel">{selected && <>
      <header><DialogTitle>{notificationPresentation(selected, t).title || d('untitled')}</DialogTitle>{badge(selected)}</header>
      <dl>{[[labels[1], badge(selected)], [labels[2], notificationLabel('type', selected.type || 'SYSTEM', t)], [d('recipient'), recipient(selected)], [d('status'), stateBadge(selected)], [d('sentAt'), date(selected.createdAt, language, t)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <section><h3>{d('message')}</h3><p>{notificationPresentation(selected, t).content || d('noContent')}</p>{selected.metadata?.eventType === 'STAFF_INCIDENT' && /^[a-f0-9]{24}$/i.test(selected.metadata.incidentId || '') && <Link to={`/admin/notifications?incident=${selected.metadata.incidentId}`} onClick={() => setSelected(null)}>{d('openIssue')}</Link>}</section>
      <footer><button type="button" onClick={() => setSelected(null)}>{t('common.close')}</button></footer>
    </>}</DialogPanel></div></Dialog>
  </div>;
}

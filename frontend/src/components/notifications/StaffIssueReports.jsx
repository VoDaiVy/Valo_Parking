import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { getInternalReport, getInternalReports, updateInternalReport } from '../../services/notificationService';
import { useLanguage } from '../../i18n/hooks/useLanguage';

const button = 'rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50';
const keyOf = value => String(value || '').toLowerCase();

export default function StaffIssueReports({ role, refreshVersion = 0 }) {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const selected = params.get('incident') || '';
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const socket = useSocket();
  const listKey = `${status}:${page}:${refresh}:${refreshVersion}`;
  const timeLabel = new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
  const priorityText = value => t(`staffNotifications.issues.priority.${keyOf(value) === 'error' ? 'urgent' : keyOf(value) === 'warning' ? 'high' : 'normal'}`);
  const statusText = value => t(`staffNotifications.issues.status.${keyOf(value) === 'in_progress' ? 'inProgress' : keyOf(value) === 'closed' ? 'resolved' : 'waitingAdmin'}`);

  useEffect(() => {
    const controller = new AbortController();
    getInternalReports({ status, page, signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setList({ key: listKey, reports: response.data?.data || [], hasMore: response.ok && response.data?.hasMore, error: response.ok ? '' : response.data?.message || t('staffNotifications.issues.errors.load') });
    });
    return () => controller.abort();
  }, [listKey, page, status, t]);

  useEffect(() => {
    if (!selected) return undefined;
    const controller = new AbortController();
    getInternalReport(selected, controller.signal).then(response => {
      if (!controller.signal.aborted) setDetail({ id: selected, report: response.ok ? response.data?.data : null, error: response.ok ? '' : response.data?.message || t('staffNotifications.issues.errors.loadOne') });
    });
    return () => controller.abort();
  }, [selected, refresh, refreshVersion, t]);

  useEffect(() => {
    if (!socket) return undefined;
    const receive = notification => { if (notification?.metadata?.eventType === 'STAFF_INCIDENT') setRefresh(value => value + 1); };
    socket.on('notification:new', receive);
    return () => socket.off('notification:new', receive);
  }, [socket]);

  const select = id => setParams(current => {
    const next = new URLSearchParams(current);
    next.set('view', 'issues');
    if (id) next.set('incident', id); else next.delete('incident');
    return next;
  });
  const current = detail?.id === selected ? detail : null;
  return (
    <section className="snm-issue-reports space-y-4 text-white" aria-label={t('staffNotifications.issues.aria')}>
      {state?.adminNotified === false && <p role="status" className="text-sm text-amber-300">{t('staffNotifications.issues.reportSavedNoAdmin')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {[['ACTIVE', t('staffNotifications.issues.open')], ['CLOSED', t('staffNotifications.issues.resolved')]].map(([value, label]) => (
            <button key={value} type="button" className={`${button} ${status === value ? 'bg-white/15' : ''}`} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); select(''); }}>{label}</button>
          ))}
        </div>
        {role !== "admin" && <button type="button" className={`${button} inline-flex items-center gap-2`} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /> {t('common.refresh')}</button>}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(230px,1fr)_minmax(0,2fr)]">
        <div className="space-y-2">
          {list?.key !== listKey ? <p role="status" className="text-sm text-gray-400">{t('staffNotifications.issues.loading')}</p>
            : list.error ? <p role="alert" className="text-sm text-red-300">{list.error}</p>
              : list.reports.length ? list.reports.map(report => (
                <button key={report._id} type="button" onClick={() => select(report._id)} aria-pressed={selected === report._id} className={`w-full rounded-xl border p-3 text-left ${selected === report._id ? 'border-yellow-400/50 bg-yellow-400/10' : 'border-white/10 bg-white/5'}`}>
                  <div className="flex flex-wrap justify-between gap-1 text-xs"><span className={report.priority === 'ERROR' ? 'font-bold text-rose-300' : 'text-gray-400'}>{priorityText(report.priority)}</span><span className="text-gray-400">{statusText(report.status)}</span></div>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold break-words">{report.content}</p>
                  <span className="mt-1 block text-xs text-gray-400">{report.reporterName} · {timeLabel.format(new Date(report.updatedAt))}</span>
                </button>
              )) : <p className="text-sm text-gray-400">{t('staffNotifications.issues.noReports')}</p>}
          {list?.key === listKey && (page > 1 || list.hasMore) && <div className="flex gap-2"><button type="button" disabled={page <= 1} className={button} onClick={() => setPage(page - 1)}>{t('staffNotifications.issues.previous')}</button><button type="button" disabled={!list.hasMore} className={button} onClick={() => setPage(page + 1)}>{t('common.next')}</button></div>}
        </div>
        {selected ? current?.report ? <ReportThread key={selected} report={current.report} role={role} onUpdate={report => { setDetail({ id: selected, report, error: '' }); setRefresh(value => value + 1); }} /> : <p role={current?.error ? 'alert' : 'status'} className="text-sm text-gray-400">{current?.error || t('staffNotifications.issues.loading')}</p> : <p className="rounded-xl border border-white/10 p-5 text-sm text-gray-400">{t('staffNotifications.issues.selectDiscussion')}</p>}
      </div>
    </section>
  );
}

function ReportThread({ report, role, onUpdate }) {
  const { t, language } = useLanguage();
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timeLabel = new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
  const canReply = report.status !== 'CLOSED' && (role === 'admin' || report.status === 'IN_PROGRESS');
  const priority = report.priority === 'ERROR' ? 'urgent' : report.priority === 'WARNING' ? 'high' : 'normal';
  const stateKey = report.status === 'IN_PROGRESS' ? 'inProgress' : report.status === 'CLOSED' ? 'resolved' : 'waitingAdmin';
  const send = async action => {
    if (!canReply || saving || !content.trim()) return;
    setSaving(true); setError('');
    const response = await updateInternalReport(report._id, { action, content, revision: report.revision });
    setSaving(false);
    if (!response.ok) { setError(response.data?.message || t('staffNotifications.issues.errors.save')); return; }
    setContent(''); onUpdate(response.data.data);
  };
  return <article className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-bold"><AlertTriangle size={17} className="text-amber-300" /> {t('staffNotifications.issues.issueReport')}</h2><span className="text-xs font-semibold text-amber-300">{t(`staffNotifications.issues.priority.${priority}`)} · {t(`staffNotifications.issues.status.${stateKey}`)}</span></header>
    <div className="space-y-3" aria-label={t('staffNotifications.issues.conversation')}>
      {[{ ...report, actorName: report.reporterName, role: 'staff' }, ...report.messages].map(message => <div key={message._id} className="rounded-lg bg-black/20 p-3"><div className="flex flex-wrap justify-between gap-2 text-xs text-gray-400"><strong className={message.role === 'admin' ? 'text-amber-200' : 'text-gray-200'}>{message.actorName} · {message.role === 'admin' ? t('staffNotifications.issues.admin') : t('staffNotifications.issues.staff')}{message.closed && ` · ${t('staffNotifications.issues.resolved')}`}</strong>{timeLabel.format(new Date(message.createdAt))}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.content}</p></div>)}
    </div>
    {canReply ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void send('reply'); }}><label htmlFor="issue-report-reply" className="text-sm font-semibold">{role === 'admin' ? t('staffNotifications.issues.instructions') : t('staffNotifications.issues.progressNotes')}</label><textarea id="issue-report-reply" rows={3} className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white" value={content} onChange={event => setContent(event.target.value)} maxLength={2000} required disabled={saving} />{error && <p role="alert" className="text-sm text-rose-300">{error}</p>}<div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={saving || !content.trim()}>{role === 'admin' ? t('staffNotifications.issues.sendInstructions') : t('staffNotifications.issues.sendUpdate')}</button>{role === 'staff' && <button type="button" className={`${button} border-emerald-400/40 text-emerald-200`} onClick={() => void send('close')} disabled={saving || !content.trim()}>{t('staffNotifications.issues.confirmResolved')}</button>}</div></form> : report.status === 'OPEN' && <p className="text-sm text-gray-400">{t('staffNotifications.issues.waitingAdmin')}</p>}
  </article>;
}

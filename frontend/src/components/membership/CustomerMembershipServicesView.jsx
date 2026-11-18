import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import './CustomerMembershipServicesView.css';

export default function CustomerMembershipServicesView({ t, language, loading, error, grants, requests, legacyUses, pages, grantPage, setGrantPage, requestPage, setRequestPage, params }) {
  const [view, setView] = useState(() => params.get('requestId') ? 'history' : 'benefits');
  const benefits = view === 'benefits';
  const date = (value) => value ? new Date(value).toLocaleDateString(language?.startsWith('vi') ? 'vi-VN' : 'en-US') : '—';
  const label = (key) => t(`membershipServicesUi.${key}`);
  const column = (key) => label(`staffWorkspace.${key}`);
  return <section className="cms-services" aria-labelledby="cms-heading" aria-busy={loading}>
    <header className="cms-header"><div><h2 id="cms-heading"><Sparkles size={21} aria-hidden="true" />{label('title')}</h2><p>{label('customerInstruction')}</p></div></header>
    {error && <p role="alert" className="cms-error">{error}</p>}
    <div className="cms-tabs" role="tablist" aria-label={column('viewsLabel')}>
      {['benefits', 'history'].map((tab) => <button key={tab} id={`cms-tab-${tab}`} type="button" role="tab" aria-selected={view === tab} aria-controls="cms-panel" onClick={() => setView(tab)}>{tab === 'benefits' ? column('benefitsHeading') : label('historyTitle')}</button>)}
    </div>
    <div id="cms-panel" role="tabpanel" aria-labelledby={`cms-tab-${view}`}>
      {loading ? <p className="cms-empty" role="status">{label('loading')}</p> : <>
        <div className="cms-table-scroll"><table><thead><tr><th scope="col">{column('serviceColumn')}</th><th scope="col">{column(benefits ? 'sourceColumn' : 'vehicleColumn')}</th><th scope="col">{column(benefits ? 'allowanceColumn' : 'statusColumn')}</th><th scope="col">{column(benefits ? 'validityColumn' : 'timelineColumn')}</th></tr></thead><tbody>
          {benefits ? grants.items.map((grant) => <tr key={grant._id}><td><strong>{grant.serviceName}</strong>{!grant.canUse && <small>{label('unavailable')}</small>}</td><td><span className="cms-slot">{grant.slotCode || '—'}</span></td><td><span className="cms-remaining">{grant.available} <span>/ {grant.total}</span></span><small>{t('membershipServicesUi.allowanceSummary', { total: grant.total, used: grant.used, reserved: grant.reserved, available: grant.available })}</small></td><td>{date(grant.validFrom)} — {date(grant.expireAt)}</td></tr>) : requests.items.map((request) => <tr key={request._id} id={`request-${request._id}`} className={params.get('requestId') === request._id ? 'cms-highlight' : ''}><td><strong>{request.serviceName}</strong>{request.history?.at(-1)?.reason && <small>{request.history.at(-1).reason}</small>}</td><td><strong>{request.licensePlate || '—'}</strong><small>{request.slotCode || '—'}</small></td><td><span className={`cms-status cms-status-${request.status}`}>{label(`status.${request.status}`)}</span></td><td>{request.startedAt && <small>{t('membershipServicesUi.started', { date: date(request.startedAt) })}</small>}{request.completedAt && <small>{t('membershipServicesUi.completed', { date: date(request.completedAt) })}</small>}{!request.startedAt && !request.completedAt && date(request.createdAt)}</td></tr>)}
        </tbody></table>{!(benefits ? grants.items : requests.items).length && <p className="cms-empty">{label(benefits ? 'noAllowances' : 'noWork')}</p>}</div>
        {benefits && !grants.items.length && legacyUses > 0 && <p className="cms-legacy">{t('membershipServicesUi.legacyUses', { count: legacyUses })}</p>}
        <div className="cms-pagination">{benefits ? pages(grants.pagination, grantPage, setGrantPage) : pages(requests.pagination, requestPage, setRequestPage)}</div>
      </>}
    </div>
  </section>;
}

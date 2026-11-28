import AdminSelect from '../../components/Admin/AdminSelect';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Gift, Search } from 'lucide-react';
import { getQuarterlyLeaderboardAdmin } from '../../services/loyaltyService';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import { paginateVoucherRows } from './voucherTableData';
import { getPaginationPages } from '../Staff/sessionPagination';
import './quarterlyLeaderboard.css';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

export default function QuarterlyLeaderboard({ onChooseRecipient }) {
  const { t, language } = useLanguage();
  const ui = (key, options) => t(`adminPages.leaderboard.${key}`, options);
  const [quarter, setQuarter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState(null);
  const [tooltipPoint, setTooltipPoint] = useState({ x: 0, y: 0 });
  const chartId = useId();
  const chartRef = useRef(null);
  const tooltipRef = useRef(null);
  const [retry, setRetry] = useState(0);
  const retryLoad = useCallback(() => setRetry((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await getQuarterlyLeaderboardAdmin(quarter);
        if (!response.ok) throw new Error(response.data?.message || t('common.noData'));
        if (!cancelled) setData(response.data.data);
      } catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [quarter, retry, t]);

  const leaders = data?.leaders || [];
  const search = query.trim().toLocaleLowerCase();
  const results = paginateVoucherRows(leaders.filter((row) => row.username.toLocaleLowerCase().includes(search)), page);
  const max = Math.max(1, ...leaders.map((row) => row.total));
  const active = leaders.find((row) => row.userId === activeId);
  const showTooltip = (event, row, keyboard = false) => {
    const chart = chartRef.current.getBoundingClientRect();
    const bar = event.currentTarget.getBoundingClientRect();
    setActiveId(row.userId);
    setTooltipPoint({
      x: (keyboard ? bar.left + bar.width / 2 : event.clientX) - chart.left,
      y: (keyboard ? bar.top : event.clientY) - chart.top,
    });
  };

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const chart = chartRef.current;
    if (!active || !tooltip || !chart) return;
    const gap = 12;
    const x = tooltipPoint.x + gap + tooltip.offsetWidth <= chart.clientWidth
      ? tooltipPoint.x + gap : tooltipPoint.x - tooltip.offsetWidth - gap;
    const y = tooltipPoint.y + gap + tooltip.offsetHeight <= chart.clientHeight
      ? tooltipPoint.y + gap : tooltipPoint.y - tooltip.offsetHeight - gap;
    tooltip.style.left = `${Math.max(0, Math.min(x, chart.clientWidth - tooltip.offsetWidth))}px`;
    tooltip.style.top = `${Math.max(0, Math.min(y, chart.clientHeight - tooltip.offsetHeight))}px`;
  }, [active, tooltipPoint]);
  const quarterLabel = (value) => ui('quarterLabel', { quarter: value.slice(-1), year: value.slice(0, 4) });
  const customerLabel = (row) => `${ui('rank')} ${row.rank}, ${row.username}, ${money(row.total)}. ${ui('select')}`;

  return <section className="voucher-leaderboard quarterly-leaderboard" aria-labelledby="leaderboard-title" aria-busy={loading}>
    <div className="ql-heading">
      <h2 id="leaderboard-title">{ui('chartTitle')}</h2>
      <label className="ql-quarter">{ui('viewQuarter')}<AdminSelect ariaLabel={ui('selectQuarter')} value={quarter || data?.quarter || ''} onChange={(value) => { if (value === (quarter || data?.quarter)) return; setQuarter(value); setPage(1); setQuery(''); setActiveId(null); setLoading(true); }} disabled={!data || loading} options={(data?.availableQuarters || []).map((value) => ({ value, label: quarterLabel(value) }))} icon={null} className="voucher-select" buttonClassName="pricing-adjustment-button" menuClassName="pricing-adjustment-menu voucher-management-menu" menuAnchor="bottom end" /></label>
    </div>
    {error && <p role="alert">{error} <button type="button" onClick={retryLoad} className="underline">{t('common.retry')}</button></p>}
    {loading && <p className="ql-empty" role="status">{t('common.loading')}</p>}
    {!loading && !error && data && (leaders.length ? <>
      <div className="ql-overview">
        <div className="ql-chart-section">
          <div className="ql-chart" ref={chartRef} role="group" aria-label={ui('chart')}>
            <div className="ql-scale" aria-hidden="true">{[1, .5, 0].map((ratio) => <span key={ratio}>{new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(max * ratio)}</span>)}</div>
            <div className="ql-bars" onMouseLeave={() => setActiveId(null)}>
              {leaders.map((row, index) => <div className="ql-bar-column" key={row.userId}>
                <button type="button" className={`ql-bar-target${row.rank === 1 ? ' is-first' : ''}`} aria-label={customerLabel(row)} disabled={!onChooseRecipient} onClick={() => onChooseRecipient?.(row)} onMouseEnter={(event) => showTooltip(event, row)} onMouseMove={(event) => showTooltip(event, row)} onMouseLeave={() => setActiveId(null)} onFocus={(event) => showTooltip(event, row, true)} onBlur={() => setActiveId(null)}>
                  <svg viewBox="0 0 20 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={`${chartId}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffe7a3" /><stop offset="100%" stopColor="#d5a936" /></linearGradient></defs><rect x="0" y={100 - row.total / max * 100} width="20" height={row.total / max * 100} rx="1.5" fill={`url(#${chartId}-${index})`} /></svg>
                </button><span aria-hidden="true">#{row.rank}</span>
              </div>)}
            </div>
            {active && <div className="ql-tooltip" ref={tooltipRef} role="tooltip"><strong>{active.username}</strong><span>{ui('rank')} #{active.rank} · {money(active.total)}</span></div>}
          </div>
        </div>
        <div className="ql-ranking">
        <div className="ql-table-toolbar"><h3>{ui('customers')}</h3><label className="voucher-data-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={ui('search')} placeholder={ui('search')} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label></div>
        <table className="voucher-data-table ql-table"><thead><tr><th scope="col">{ui('rank')}</th><th scope="col">{ui('customer')}</th><th scope="col">{ui('spending')}</th><th scope="col"><span className="sr-only">{ui('select')}</span></th></tr></thead><tbody>{results.rows.map((row) => <tr key={row.userId}><td data-label={ui('rank')} className={row.rank === 1 ? 'voucher-data-value' : ''}>#{row.rank}</td><td data-label={ui('customer')}><strong>{row.username}</strong></td><td data-label={ui('spending')}>{money(row.total)}</td><td data-label={ui('select')}><div className="voucher-data-actions"><span className="voucher-issued-action"><button type="button" className="voucher-template-icon" aria-label={`${ui('select')}: ${row.username}`} aria-describedby={`${chartId}-gift-${row.userId}`} disabled={!onChooseRecipient} onClick={() => onChooseRecipient?.(row)}><Gift size={18} aria-hidden="true" /></button><span role="tooltip" id={`${chartId}-gift-${row.userId}`} className="voucher-issued-tooltip">{ui('select')}</span></span></div></td></tr>)}</tbody></table>
        {!results.total && <p className="ql-empty">{t('voucherUi.noRecipients')}</p>}
        <div className="voucher-data-pagination"><span>{t('subscriptionPagination.pageSummary', { current: results.page, total: results.totalPages, count: results.total })}</span><nav aria-label={ui('customers')}><button type="button" disabled={results.page === 1} onClick={() => setPage(results.page - 1)}>{t('subscriptionPagination.previous')}</button>{getPaginationPages(results.page, results.totalPages).map((item) => typeof item === 'number' ? <button type="button" key={item} aria-current={item === results.page ? 'page' : undefined} onClick={() => setPage(item)}>{item}</button> : <span key={item}>…</span>)}<button type="button" disabled={results.page === results.totalPages} onClick={() => setPage(results.page + 1)}>{t('subscriptionPagination.next')}</button></nav></div>
      </div>
      </div>
    </> : <p className="ql-empty">{ui('empty')}</p>)}
  </section>;
}

import './pricingManagement.css';
import './voucherManagement.css';
import './feedbackManagement.css';
import AdminSelect from '../../components/Admin/AdminSelect';
import AdminDateTimePicker from '../../components/Admin/AdminDateTimePicker';
import AdminBackgroundOverlay from '../../components/Admin/AdminBackgroundOverlay';
import { MessageSquare, Star, TriangleAlert, Clock3, RotateCcw, Search, X } from 'lucide-react';
import { getPaginationPages } from '../Staff/sessionPagination.js';
import AnimatedNumber from '../../components/AnimatedNumber';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import '../../components/Admin/adminGridBackground.css';
import { useEffect, useRef, useState } from "react";
import {
  getAdminFeedback,
  getAdminFeedbacks,
  getFeedbackStats,
  replyToFeedback,
} from "../../services/feedbackService";

const initialFilters = {
  search: "",
  rating: "",
  category: "",
  status: "",
  from: "",
  to: "",
};
const inputClass =
  "rounded-xl border border-white/15 bg-[#171717] px-3 py-2 text-sm text-white";
const date = (value, locale) =>
  value
    ? new Date(value).toLocaleString(locale, { timeZone: "Asia/Ho_Chi_Minh" })
    : "—";
const entityId = (item) => item?._id || item?.id;

export default function FeedbackManagement() {
  const { t, language } = useLanguage();
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
  const categoryLabel = (value) => t('adminFeedback.categories.' + value, { defaultValue: value });
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0 });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const detailRequest = useRef(0);
  const dialog = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        setLoading(true);
        setError("");
      }
    });
    Promise.all([
      getAdminFeedbacks({ ...filters, page, limit: 5 }),
      getFeedbackStats(filters),
    ]).then(([items, counts]) => {
      if (!active) return;
      if (items.ok && counts.ok) {
        setList(items.data.data);
        setStats(counts.data.data);
      } else {
        setList({ items: [], total: 0 });
        setStats(null);
        setError(
          items.data?.message ||
            counts.data?.message ||
            t('adminFeedback.couldNotLoadFeedback'),
        );
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [filters, page, refresh, t]);

  const updateFilter = (key, value) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
    if (key !== 'search') {
      setPage(1);
      setFilters((current) => ({ ...current, [key]: value }));
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      if (filters.search === draftFilters.search) return;
      setPage(1);
      setFilters((current) => ({ ...current, search: draftFilters.search }));
    }, 300);
    return () => clearTimeout(timer);
  }, [draftFilters.search, filters.search]);
  const totalPages = Math.max(1, Math.ceil(list.total / 5));

  const openDetail = async (item, preserveDraft = false) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailReady(false);
    setReplyError("");
    if (!preserveDraft) {
      setSelected(item);
      setReply("");
      setConflict(false);
      dialog.current.showModal();
    }
    const res = await getAdminFeedback(entityId(item));
    if (request !== detailRequest.current) return;
    if (res.ok) {
      setSelected(res.data.data);
      setDetailReady(true);
      if (!preserveDraft) setReply(res.data.data.reply?.content || "");
      setConflict(false);
    } else
      setReplyError(res.data?.message || t('adminFeedback.couldNotLoadFeedbackDetails'));
    setDetailLoading(false);
  };
  const close = () => {
    if (saving) return;
    detailRequest.current++;
    dialog.current.close();
    setSelected(null);
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setReplyError("");
    const res = await replyToFeedback(entityId(selected), {
      content: reply.trim(),
      expectedRevision: selected.replyRevision,
    });
    if (res.ok) {
      setSelected(res.data.data);
      setReply(res.data.data.reply.content);
      setRefresh((value) => value + 1);
    } else {
      setReplyError(
        res.data?.message ||
          t('adminFeedback.couldNotSaveResponseYourDraftIsPreserved'),
      );
      if (res.status === 409) setConflict(true);
    }
    setSaving(false);
  };

  return (
    <div className="pricing-page voucher-management feedback-management">
      <AdminBackgroundOverlay />
      <div className="pricing-content">
      <header className="pricing-header feedback-header">
        <div><h1>{t('adminFeedback.bookingFeedback')}</h1>
        <p className="pricing-subtitle">{t('adminFeedback.reviewCustomerExperiencesAndRespondAsValoParkingAllDatesUseVietnamTime')}</p></div>
        <button type="button" className="feedback-icon" title={t('adminFeedback.reset')} aria-label={t('adminFeedback.reset')} onClick={() => {
          setDraftFilters(initialFilters); setFilters(initialFilters); setPage(1);
        }}><RotateCcw size={18} aria-hidden="true" /></button>
      </header>
      <dl className="pricing-metrics feedback-metrics">
        {[
          [t('adminFeedback.totalReviews'), stats?.total, undefined, MessageSquare],
          [t('adminFeedback.averageRating'), stats?.averageRating == null ? '\u2014' : Number(stats.averageRating),
            (number) => `${number.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`, Star],
          [t('adminFeedback.12StarReviews'), stats?.lowRatingCount, undefined, TriangleAlert],
          [t('adminFeedback.awaitingResponse'), stats?.unrepliedCount, undefined, Clock3],
        ].map(([label, value, formatter, Icon]) => (
          <div key={label} className="pricing-metric">
            <span className="pricing-metric-icon"><Icon size={18} aria-hidden="true" /></span>
            <div className="pricing-metric-copy"><dt>{label}</dt><dd><AnimatedNumber formatter={formatter} value={value ?? '\u2014'} /></dd></div>
          </div>
        ))}
      </dl>
      <div className="feedback-filters">
        <label className="feedback-search"><span className="sr-only">{t('adminFeedback.bookingIdOrUsername')}</span><Search size={16} aria-hidden="true" /><input
          className="voucher-input" placeholder={t('adminFeedback.bookingIdOrUsername')} value={draftFilters.search} onChange={(event) => updateFilter('search', event.target.value)} />
        </label>
        {[
          ['rating', t('adminFeedback.rating'), [{ value: '', label: t('adminFeedback.allRatings') }, ...[1, 2, 3, 4, 5].map(value => ({ value: String(value), label: t('adminFeedback.stars', { count: value }) }))]],
          ['category', t('adminFeedback.topic'), [{ value: '', label: t('adminFeedback.allTopics') }, ...['parking', 'staff', 'payment', 'app', 'other'].map(value => ({ value, label: categoryLabel(value) }))]],
          ['status', t('adminFeedback.responseStatus'), [{ value: '', label: t('adminFeedback.allResponses') }, { value: 'UNREPLIED', label: t('adminFeedback.awaitingResponse') }, { value: 'REPLIED', label: t('adminFeedback.responded') }]],
        ].map(([key, label, options]) => <AdminSelect key={key} value={draftFilters[key]} onChange={value => updateFilter(key, value)} options={options} ariaLabel={label} icon={null} buttonClassName="pricing-adjustment-button" menuClassName="pricing-adjustment-menu" menuAnchor="bottom start" />)}
        <div className="feedback-date-range">
          {['from', 'to'].map(key => <div key={key}><div className="feedback-date-heading"><p className="feedback-date-label">{key === 'from' ? t('adminFeedback.fromDate') : t('adminFeedback.toDateExclusive')}</p>{draftFilters[key] && <button type="button" className="feedback-clear-date" aria-label={`${t('adminFeedback.reset')}: ${key === 'from' ? t('adminFeedback.fromDate') : t('adminFeedback.toDateExclusive')}`} onClick={() => updateFilter(key, '')}><X size={12} aria-hidden="true" /></button>}</div><AdminDateTimePicker mode="date" language={language}
            label={key === 'from' ? t('adminFeedback.fromDate') : t('adminFeedback.toDateExclusive')}
            value={draftFilters[key]} onChange={value => updateFilter(key, value.slice(0, 10))} /></div>)}
        </div>
      </div>
      {error && (
        <div role="alert" className="mb-4 text-rose-300">
          {error}{" "}
          <button
            onClick={() => setRefresh((value) => value + 1)}
            className="underline"
          >{t('adminFeedback.retry')}</button>
        </div>
      )}
      {loading ? (
        <p role="status" className="py-10 text-white/50">{t('adminFeedback.loadingFeedback')}</p>
      ) : (
        !error && (
          <>
            <div className="feedback-table-wrap">
              <table className="feedback-table w-full text-left text-sm">
                <thead className="bg-white/5 text-xs text-white/50">
                  <tr>
                    {[
                      t('adminFeedback.customerBooking'),
                      t('adminFeedback.rating'),
                      t('adminFeedback.feedback'),
                      t('adminFeedback.sent'),
                      t('adminFeedback.response'),
                      t('adminFeedback.action'),
                    ].map((label) => (
                      <th key={label} className="p-4 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((item) => (
                    <tr
                      key={entityId(item)}
                      className="border-t border-white/10" onClick={() => openDetail(item)}
                    >
                      <td className="p-4">
                        <p>
                          {item.userId?.username ||
                            item.user?.username ||
                            t('adminFeedback.deletedCustomer')}
                        </p>
                      </td>
                      <td className="whitespace-nowrap p-4 text-yellow-300">
                        {item.rating}/5 ★
                      </td>
                      <td className="max-w-sm p-4">
                        <p className="truncate" title={item.comment || undefined}>
                          {item.comment || t('adminFeedback.noWrittenComment')}
                        </p>
                      </td>
                      <td className="whitespace-nowrap p-4 text-xs text-white/50">
                        {date(item.createdAt, locale)}
                      </td>
                      <td className="p-4 text-xs"><span className={`feedback-status ${item.reply ? 'is-replied' : 'is-pending'}`}>
                        {item.reply ? t('adminFeedback.responded') : t('adminFeedback.awaitingResponse')}</span>
                      </td>
                      <td className="p-4">
                        <button
                          onClick={(event) => { event.stopPropagation(); openDetail(item); }}
                          className="feedback-icon" title={t('adminFeedback.viewRespond')} aria-label={t('adminFeedback.viewRespond')}
                        ><MessageSquare size={18} aria-hidden="true" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.items.length && (
                <p className="p-10 text-center text-white/50">{t('adminFeedback.noFeedbackMatchesTheseFilters')}</p>
              )}
            </div>
            <div className="voucher-data-pagination">
              <span>{t('subscriptionPagination.pageSummary', { current: page, total: totalPages, count: list.total })}</span>
              <nav aria-label={t('adminFeedback.feedbackPagination')}>
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('adminFeedback.previous')}</button>
                {getPaginationPages(page, totalPages).map(item => typeof item === 'number' ? <button type="button" key={item} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}>{item}</button> : <span key={item} aria-hidden="true">...</span>)}
                <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t('adminFeedback.next')}</button>
              </nav>
            </div>
          </>
        )
      )}
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="admin-feedback-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#111111] p-6 text-white backdrop:bg-black/75"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="admin-feedback-title" className="text-xl font-bold">{t('adminFeedback.feedbackDetails')}</h2>
          <button
            type="button"
            disabled={saving}
            onClick={close}
            className={inputClass}
          >{t('adminFeedback.close')}</button>
        </div>
        {selected && (
          <>
            <p className="mt-4 text-lg text-yellow-300">
              {selected.rating}/5 ★
            </p>
            <p className="mt-3 whitespace-pre-wrap break-words">
              {selected.comment || t('adminFeedback.noWrittenComment')}
            </p>
            <p className="mt-2 text-xs text-white/50">
              {selected.categories?.map(categoryLabel).join(" · ")} · {date(selected.createdAt, locale)}
            </p>
            <p className="mt-2 break-all text-xs text-white/50">{t('adminFeedback.booking')}{" "}
              {selected.bookingId && typeof selected.bookingId === "object"
                ? entityId(selected.bookingId)
                : selected.bookingId || t('adminFeedback.deletedBooking')}
            </p>
            {selected.bookingId && typeof selected.bookingId === "object" && (
              <p className="mt-2 text-sm text-white/60">
                {selected.bookingId.licensePlate} · {t('adminFeedback.slot')}{' '}
                {selected.bookingId.parkingSlot} · {t('adminFeedback.bookingStatus.' + selected.bookingId.status, { defaultValue: selected.bookingId.status })}
              </p>
            )}
            {replyError && (
              <p role="alert" className="mt-4 text-sm text-rose-300">
                {replyError}
              </p>
            )}
            {conflict && (
              <button
                type="button"
                onClick={() => openDetail(selected, true)}
                className="mt-3 text-sm text-yellow-300 underline"
              >{t('adminFeedback.loadLatestResponseKeepMyDraft')}</button>
            )}
            {detailLoading ? (
              <p role="status" className="mt-4">{t('adminFeedback.loadingCurrentResponse')}</p>
            ) : !detailReady ? (
              <button
                type="button"
                onClick={() => openDetail(selected, true)}
                className="mt-4 underline"
              >{t('adminFeedback.retryLoadingDetails')}</button>
            ) : !selected.userId || !selected.bookingId ? (
              <section className="mt-5 border-t border-white/10 pt-4">
                <p className="text-sm text-amber-200">{t('adminFeedback.thisFeedbackIsReadOnlyBecauseItsCustomerOrBookingWasDeleted')}</p>
                {selected.reply && (
                  <>
                    <h3 className="mt-4 font-bold">{t('adminFeedback.valoParkingResponse')}</h3>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                      {selected.reply.content}
                    </p>
                  </>
                )}
              </section>
            ) : (
              <form
                onSubmit={save}
                className="mt-6 border-t border-white/10 pt-5"
              >
                <h3 className="font-bold">{t('adminFeedback.officialResponseValoParking')}</h3>
                {selected.reply && (
                  <div className="mt-3 rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-white/50">{t('adminFeedback.currentPublishedResponse')}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                      {selected.reply.content}
                    </p>
                  </div>
                )}
                {conflict && (
                  <p className="mt-2 text-sm text-white/60">{t('adminFeedback.loadTheLatestVersionBeforeSavingYourDraftAgain')}</p>
                )}
                <label className="mt-3 block text-sm">{t('adminFeedback.response')}<textarea
                    required
                    maxLength={2000}
                    rows={5}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    className={`${inputClass} mt-2 w-full`}
                  />
                </label>
                <p className="mt-1 text-xs text-white/40">
                  {t('adminFeedback.replyHint', { count: reply.length })}
                </p>
                <button
                  disabled={saving || conflict || !reply.trim()}
                  className="mt-4 rounded-xl bg-yellow-300 px-4 py-3 text-sm font-bold text-black disabled:opacity-40"
                >
                  {saving
                    ? t('adminFeedback.saving')
                    : selected.reply
                      ? t('adminFeedback.updateResponse')
                      : t('adminFeedback.sendResponse')}
                </button>
              </form>
            )}
            {selected.replyHistory?.length > 0 && (
              <details className="mt-5 border-t border-white/10 pt-4">
                <summary className="cursor-pointer text-sm text-white/60">{t('adminFeedback.internalResponseHistory')}</summary>
                {selected.replyHistory.map((entry, index) => (
                  <div key={index} className="mt-3 rounded-lg bg-white/5 p-3">
                    <p className="text-xs text-white/40">
                      {t('adminFeedback.revision', { revision: entry.revision })} · {date(entry.changedAt, locale)}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                      {entry.content}
                    </p>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </dialog>
    </div>
  );
}

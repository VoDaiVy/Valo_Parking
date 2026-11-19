import { useLanguage } from '../../i18n/hooks/useLanguage';
import '../../components/Admin/adminGridBackground.css';
import { useEffect, useRef, useState } from "react";
import {
  getAdminFeedback,
  getAdminFeedbacks,
  getFeedbackStats,
  replyToFeedback,
  setFeedbackPublication,
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
      getAdminFeedbacks({ ...filters, page, limit: 20 }),
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

  const togglePublication = async () => {
    setSaving(true);
    setReplyError("");
    try {
      const res = await setFeedbackPublication(entityId(selected), !selected.isPublic);
      if (res.ok) {
        setSelected(res.data.data);
        setRefresh((value) => value + 1);
      } else setReplyError(res.data?.message || t('homeTestimonials.publishError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-grid-background min-h-full p-4 text-white sm:p-6 lg:p-8">
      <header className="mb-7">
        <p className="text-xs font-bold uppercase tracking-widest text-yellow-300/70">{t('adminFeedback.customerExperience')}</p>
        <h1 className="mt-2 text-3xl font-bold">{t('adminFeedback.bookingFeedback')}</h1>
        <p className="mt-2 text-sm text-white/50">{t('adminFeedback.reviewCustomerExperiencesAndRespondAsValoParkingAllDatesUseVietnamTime')}</p>
      </header>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [t('adminFeedback.totalReviews'), stats?.total],
          [
            t('adminFeedback.averageRating'),
            stats?.averageRating == null
              ? "—"
              : `${Number(stats.averageRating).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`,
          ],
          [t('adminFeedback.12StarReviews'), stats?.lowRatingCount],
          [t('adminFeedback.awaitingResponse'), stats?.unrepliedCount],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-white/10 bg-[#111111] p-4"
          >
            <p className="text-xs text-white/50">{label}</p>
            <p className="mt-3 text-2xl font-bold text-yellow-200">
              {value ?? "—"}
            </p>
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setFilters({ ...draftFilters });
        }}
        className="mb-5 flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs text-white/60">{t('adminFeedback.bookingIdOrUsername')}<input
            className={inputClass}
            value={draftFilters.search}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, search: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">{t('adminFeedback.rating')}<select
            className={inputClass}
            value={draftFilters.rating}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, rating: e.target.value })
            }
          >
            <option value="">{t('adminFeedback.allRatings')}</option>
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v} value={v}>
                {t('adminFeedback.stars', { count: v })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">{t('adminFeedback.topic')}<select
            className={inputClass}
            value={draftFilters.category}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, category: e.target.value })
            }
          >
            <option value="">{t('adminFeedback.allTopics')}</option>
            {["parking", "staff", "payment", "app", "other"].map((v) => (
              <option key={v} value={v}>
                {categoryLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">{t('adminFeedback.responseStatus')}<select
            className={inputClass}
            value={draftFilters.status}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, status: e.target.value })
            }
          >
            <option value="">{t('adminFeedback.allResponses')}</option>
            <option value="UNREPLIED">{t('adminFeedback.awaitingResponse')}</option>
            <option value="REPLIED">{t('adminFeedback.responded')}</option>
          </select>
        </label>
        {["from", "to"].map((key) => (
          <label
            key={key}
            className="flex flex-col gap-1 text-xs text-white/60"
          >
            {key === "from" ? t('adminFeedback.fromDate') : t('adminFeedback.toDateExclusive')}
            <input
              type="date"
              className={inputClass}
              value={draftFilters[key]}
              onChange={(e) =>
                setDraftFilters({ ...draftFilters, [key]: e.target.value })
              }
            />
          </label>
        ))}
        <button className="rounded-xl bg-yellow-300 px-4 py-2 text-sm font-bold text-black">{t('adminFeedback.applyFilters')}</button>
        <button
          type="button"
          onClick={() => {
            setDraftFilters(initialFilters);
            setFilters(initialFilters);
            setPage(1);
          }}
          className={inputClass}
        >{t('adminFeedback.reset')}</button>
      </form>
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
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-left text-sm">
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
                      className="border-t border-white/10"
                    >
                      <td className="p-4">
                        <p>
                          {item.userId?.username ||
                            item.user?.username ||
                            t('adminFeedback.deletedCustomer')}
                        </p>
                        <p className="mt-1 max-w-[200px] truncate text-xs text-white/40">
                          {item.bookingId && typeof item.bookingId === "object"
                            ? entityId(item.bookingId)
                            : item.bookingId || t('adminFeedback.deletedBooking')}
                        </p>
                      </td>
                      <td className="whitespace-nowrap p-4 text-yellow-300">
                        {item.rating}/5 ★
                      </td>
                      <td className="max-w-sm p-4">
                        <p className="line-clamp-2 break-words">
                          {item.comment || t('adminFeedback.noWrittenComment')}
                        </p>
                      </td>
                      <td className="whitespace-nowrap p-4 text-xs text-white/50">
                        {date(item.createdAt, locale)}
                      </td>
                      <td className="p-4 text-xs">
                        {item.reply ? t('adminFeedback.responded') : t('adminFeedback.awaitingResponse')}
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() => openDetail(item)}
                          className="whitespace-nowrap rounded-lg border border-yellow-300/30 px-3 py-2 text-yellow-200"
                        >{t('adminFeedback.viewRespond')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.items.length && (
                <p className="p-10 text-center text-white/50">{t('adminFeedback.noFeedbackMatchesTheseFilters')}</p>
              )}
            </div>
            <nav
              aria-label={t('adminFeedback.feedbackPagination')}
              className="mt-4 flex items-center justify-between gap-4 text-sm"
            >
              <span>
                {t('adminFeedback.paginationSummary', { count: list.total, page })}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className={`${inputClass} disabled:opacity-40`}
                >{t('adminFeedback.previous')}</button>
                <button
                  disabled={page * 20 >= list.total}
                  onClick={() => setPage(page + 1)}
                  className={`${inputClass} disabled:opacity-40`}
                >{t('adminFeedback.next')}</button>
              </div>
            </nav>
          </>
        )
      )}
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
            {detailReady && (
              <section className="mt-5 rounded-xl border border-yellow-300/20 bg-yellow-300/5 p-4">
                <p className="text-sm text-white/70">{t('homeTestimonials.publicationNote')}</p>
                <button
                  type="button"
                  disabled={saving || (!selected.isPublic && !selected.comment?.trim())}
                  onClick={togglePublication}
                  className="mt-3 rounded-lg border border-yellow-300/40 px-4 py-2 text-sm font-semibold text-yellow-200 disabled:opacity-40"
                >{t(selected.isPublic ? 'homeTestimonials.unpublish' : 'homeTestimonials.publish')}</button>
              </section>
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

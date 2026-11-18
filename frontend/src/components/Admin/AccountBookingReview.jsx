import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('accessToken')}` });
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

export default function AccountBookingReview({ userId, onRestriction }) {
  const [activity, setActivity] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/admin/users/${userId}/booking-review`, {
      cache: 'no-store', headers: authHeaders(), signal: controller.signal,
    }).then(response => {
      if (controller.signal.aborted) return;
      if (response.ok) setActivity(response.data.data);
      setLoadError(response.ok ? '' : response.data?.message || 'Booking activity is unavailable.');
    });
    return () => controller.abort();
  }, [userId, refresh]);

  const restricted = Boolean(activity?.restriction?.blocked);
  const submit = async event => {
    event.preventDefault();
    if (saving || !reason.trim()) return;
    setSaving(true);
    setActionError('');
    const response = await apiFetch(`/admin/users/${userId}/booking-restriction`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify({ blocked: !restricted, reason }),
    });
    setSaving(false);
    if (!response.ok) {
      setActionError(response.data?.message || 'Unable to update booking access.');
      return;
    }
    setActivity(current => ({ ...current, restriction: response.data.data }));
    onRestriction(response.data.data);
    setReason('');
    setEditing(false);
  };

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-[#171717] p-4" aria-label="Booking activity">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-white">Booking activity</h4>
        {activity?.flagged && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-300">Review suggested</span>}
        {!activity?.flagged && activity?.lastFlaggedAt && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-200">Past review flag</span>}
      </div>
      {loadError
        ? <p role="alert" className="text-sm text-rose-300">{loadError} <button type="button" className="underline" onClick={() => { setLoadError(''); setRefresh(value => value + 1); }}>Retry</button></p>
        : !activity ? <p role="status" className="text-sm text-gray-400">Loading booking activity…</p> : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-white/5 p-2"><dt className="text-xs text-gray-400">Cancelled orders in {activity.days} days</dt><dd className="font-bold text-white">{activity.cancelledOrders}</dd></div>
              <div className="rounded-lg bg-white/5 p-2"><dt className="text-xs text-gray-400">Near refund cutoff in {activity.days} days</dt><dd className="font-bold text-white">{activity.nearCutoffOrders}</dd></div>
              {activity.totalCancelledOrders != null && (
                <>
                  <div className="rounded-lg bg-white/5 p-2"><dt className="text-xs text-gray-400">Cancelled orders in history</dt><dd className="font-bold text-white">{activity.totalCancelledOrders}</dd></div>
                  <div className="rounded-lg bg-white/5 p-2"><dt className="text-xs text-gray-400">Near refund cutoff in history</dt><dd className="font-bold text-white">{activity.totalNearCutoffOrders}</dd></div>
                </>
              )}
            </dl>
            <p className="text-xs text-gray-400">Review after {activity.nearCutoffThreshold} orders cancelled within {activity.nearCutoffMinutes} minutes of their 100% parking refund cutoff, or {activity.repeatedThreshold} cancelled orders in {activity.days} days.</p>
            {!activity.flagged && activity.lastFlaggedAt && (
              <p className="text-xs text-amber-200">Last met the review criteria on {dateTime.format(new Date(activity.lastFlaggedAt))}.</p>
            )}
            {activity.samples?.length > 0 && (
              <details className="rounded-lg border border-white/10 p-2 text-xs text-gray-300">
                <summary className="cursor-pointer font-semibold text-white">Latest cancellations</summary>
                <ul className="mt-2 space-y-2">
                  {activity.samples.map(row => <li key={row.bookingId}>
                    {dateTime.format(new Date(row.cancelledAt))} · {row.minutesBeforeStart} min before start · {row.creditedAmount.toLocaleString('en-US')} VND credited
                    {row.nearCutoff && <span className="block text-amber-300">Full refund cutoff at {row.thresholdMinutes} min before start</span>}
                  </li>)}
                </ul>
              </details>
            )}
            <p className={`text-sm font-semibold ${restricted ? 'text-rose-300' : 'text-gray-300'}`}>New bookings {restricted ? 'restricted' : 'allowed'}</p>
            {activity.restriction?.reason && <p className="break-words text-xs text-gray-400">Last decision: {activity.restriction.reason}</p>}
            {!editing ? <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setEditing(true)}>{restricted ? 'Restore booking access' : 'Restrict new bookings'}</button> : (
              <form onSubmit={submit} className="space-y-2">
                <label className="block text-xs font-semibold text-gray-300">Reason
                  <textarea className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 p-2 text-sm text-white" rows={2}
                    value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={saving} required />
                </label>
                {actionError && <p role="alert" className="text-xs text-rose-300">{actionError}</p>}
                <div className="flex gap-2">
                  <button type="button" disabled={saving} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white" onClick={() => { setEditing(false); setReason(''); setActionError(''); }}>Cancel</button>
                  <button type="submit" disabled={saving || !reason.trim()} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
                    {restricted ? 'Confirm restore' : 'Confirm restriction'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
    </section>
  );
}

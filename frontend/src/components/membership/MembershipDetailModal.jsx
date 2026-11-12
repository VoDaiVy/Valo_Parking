import './MembershipHistoryDrawer.css';
import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';
import { getMembershipDetail, getMembershipRenewalHistory } from '../../services/subscriptionService';
import { membershipDate, membershipPresentation, membershipFloorName } from '../../utils/membershipDisplay';
import { useMembershipClock } from '../../hooks/useMembershipClock';

export default function MembershipDetailModal({ id, kind, refreshKey, onClose, onRenew, renewLoading }) {
  useMembershipClock();
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError(''); setDetail(null);
      try {
        const response = await getMembershipDetail(kind, id);
        if (!response.ok || !response.data?.success) throw new Error([403, 404].includes(response.status) ? 'This membership is unavailable. It may have been deleted, transferred, or no longer belong to your account.' : response.data?.message || 'Unable to load membership details.');
        if (!cancelled) setDetail(response.data.data);
      } catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, kind, refreshKey, attempt]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setHistoryLoading(true); setHistoryError(''); setHistory(null);
      try {
        const response = await getMembershipRenewalHistory(kind, id, page);
        if (!response.ok || !response.data?.success) throw new Error(response.data?.message || 'Unable to load renewal history.');
        if (!cancelled) setHistory(response.data.data);
      } catch (err) { if (!cancelled) setHistoryError(err.message); }
      finally { if (!cancelled) setHistoryLoading(false); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, kind, refreshKey, page, attempt]);

  return <Dialog open onClose={onClose} className="membership-recovered-dialog relative z-[60]">
    <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel className="flex max-h-[calc(100dvh-32px)] w-full max-w-2xl flex-col rounded-3xl bg-white text-slate-900 shadow-2xl [overflow-wrap:anywhere]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b p-5">
          <DialogTitle className="text-xl font-bold">Membership details</DialogTitle>
          <button type="button" autoFocus onClick={onClose} aria-label="Close membership details" className="type-button grid h-11 w-11 place-items-center rounded-xl hover:bg-slate-100"><X /></button>
        </header>
        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          {loading ? <p role="status">Loading membership...</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="type-button mt-3 underline" onClick={() => setAttempt(attempt + 1)}>Retry</button></div> : detail && <>
            <h3 className="type-card ">{detail.package?.name || 'Membership'}</h3>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Status</dt><dd><span className={`membership-status membership-status--${membershipPresentation(detail).state.toLowerCase()}`}>{membershipPresentation(detail).statusLabel}</span></dd></div>
              <div><dt className="text-slate-500">Space / floor</dt><dd>{detail.slotCode ? `${detail.slotCode} / ${membershipFloorName(detail.floorName, detail.floorNumber != null ? `Floor ${detail.floorNumber}` : null)}` : (detail.slots || []).map((slot) => `${slot.slotCode} / ${membershipFloorName(slot.floorId?.name, slot.floorId?.floorNumber)}`).join(', ')}</dd></div>
              <div><dt className="text-slate-500">Valid from</dt><dd>{membershipDate(detail.validFrom)}</dd></div>
              <div><dt className="text-slate-500">Expires</dt><dd>{membershipDate(detail.expireAt)}</dd></div>
            </dl>
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{membershipPresentation(detail).state === 'EXPIRED' ? 'This membership has expired.' : membershipPresentation(detail).renewalMessage}</p>
            <section><h3 className="type-card ">Eligible vehicles</h3>
              {detail.eligibleVehicles?.length ? <ul className="mt-2 space-y-2">{detail.eligibleVehicles.map((vehicle) => <li key={vehicle._id} className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{vehicle.licensePlate || 'Plate unavailable'}</strong><span className="mt-1 block text-slate-600">{[vehicle.brand, vehicle.model, vehicle.vehicleType].filter(Boolean).join(' / ') || 'Vehicle details unavailable'}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No approved vehicles.</p>}
              <p className="mt-3 text-sm leading-6 text-slate-600">{detail.vehicleUsageNote}</p>
            </section>
            <section aria-label="Renewal history"><h3 className="type-card ">Renewal history</h3>
              {historyLoading ? <p role="status">Loading history...</p> : historyError ? <div role="alert">{historyError} <button type="button" className="type-button underline" onClick={() => setAttempt(attempt + 1)}>Retry</button></div> : <>
                {!history?.items?.length ? <p className="mt-2 text-sm text-slate-500">No renewal records. The initial purchase is not a renewal.</p> : <ul className="mt-3 space-y-3">{history.items.map((row) => <li key={`${row.scope}-${row._id}`} className="rounded-xl border p-3 text-sm">
                  <p>{membershipDate(row.paidAt || row.createdAt)}</p>
                  {row.status === 'paid' && <p className="mt-1">{membershipDate(row.oldExpireAt)} &rarr; {membershipDate(row.newExpireAt)}</p>}
                  <p className="mt-1 capitalize">{[Number.isFinite(row.amount) ? `${row.amount.toLocaleString('en-GB')} VND` : null, { wallet: 'VALO Wallet', payos: 'PayOS' }[row.paymentMethod], row.status].filter(Boolean).join(' / ')}</p>
                </li>)}</ul>}
                {history?.pagination?.totalPages > 1 && <div className="mt-4 flex items-center gap-4"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="type-button disabled:opacity-40">Previous</button><span>Page {page} of {history.pagination.totalPages}</span><button type="button" disabled={page >= history.pagination.totalPages} onClick={() => setPage(page + 1)} className="type-button disabled:opacity-40">Next</button></div>}
              </>}
            </section>
          </>}
        </div>
        <footer className="flex shrink-0 justify-end gap-3 border-t p-4">
          <button type="button" onClick={onClose} className="type-button min-h-11 rounded-xl border px-5">Close</button>
          {detail && <button type="button" disabled={!membershipPresentation(detail).canRenew || renewLoading} onClick={() => onRenew(kind === 'entitlement' ? id : '', kind === 'subscription' ? id : '')} className="type-button min-h-11 rounded-xl bg-amber-500 px-5 disabled:opacity-40">Renew</button>}
        </footer>
      </DialogPanel>
    </div>
  </Dialog>;
}

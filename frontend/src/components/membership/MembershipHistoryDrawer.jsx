import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Description, Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { History, X, CheckCircle2, XCircle, Clock3, CreditCard, Bell, ChevronDown, Check, Wallet, QrCode } from 'lucide-react';
import { getMembershipActivity } from '../../services/subscriptionService';
import { membershipDate } from '../../utils/membershipDisplay';
import { activityStatus, activityPayment, activityExpiries } from '../../utils/membershipActivityDisplay';
import './MembershipHistoryDrawer.css';

const tones = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
};

const activityFilters = [
  { value: 'all', label: 'All activities', icon: History },
  { value: 'renewals', label: 'Renewals', icon: Clock3 },
  { value: 'payments', label: 'Payments', icon: CreditCard },
  { value: 'notifications', label: 'Notifications', icon: Bell },
];

function Activity({ item }) {
  const status = activityStatus(item);
  const payment = activityPayment(item);
  const Icon = item.kind === 'notification' ? Bell : status.tone === 'failed' ? XCircle : status.tone === 'success' ? CheckCircle2 : item.status === 'pending' ? Clock3 : CreditCard;
  const PaymentIcon = item.paymentMethod === 'wallet' ? Wallet : QrCode;
  const space = item.slotCode || item.slotCodes?.join(', ');
  const floor = item.floorName || item.floorNames?.join(', ');
  const expiries = activityExpiries(item);
  return <li className="border-b border-white/10 py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded-full p-2.5 ${tones[status.tone]}`}><Icon size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <span className="type-label block text-white">{item.title}</span>
          <time dateTime={item.timestamp} className="type-caption mt-1 block text-white/50">{membershipDate(item.timestamp)}</time>
          {(item.packageName || space || floor) && <span className="membership-history-package mt-2 block break-words text-white/85">{[item.packageName, [space, floor].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}</span>}
          <span className="membership-history-status-row mt-3">
            <span className={`type-badge shrink-0 rounded-full px-2 py-0.5 ${tones[status.tone]}`}>{status.label}</span>
            {payment.method && <span className="type-caption inline-flex min-w-0 items-center gap-1.5 text-white/75"><PaymentIcon size={13} aria-hidden="true" className="shrink-0" /><span>{payment.method}</span></span>}
            {payment.amount && <span className="membership-history-amount type-label text-[#DCA11D]">{payment.amount}</span>}
          </span>
          {(expiries.length > 0 || item.summary || item.failureMessage) && <details className="membership-history-details mt-3"><summary>Activity details</summary>
          {expiries.length > 0 && <dl className={`membership-history-expiries mt-3 space-y-2.5 text-sm ${item.kind === 'renewal' ? 'rounded-xl bg-white/[0.035] p-3.5' : ''}`}>
            {expiries.map(({ label, value, renewed }) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <dt className="type-caption text-white/50">{label}</dt>
              <dd className={`min-w-0 break-words tabular-nums ${renewed ? 'font-semibold text-emerald-300' : 'text-white/80'}`}><time dateTime={value}>{membershipDate(value)}</time></dd>
            </div>)}
          </dl>}
          {item.status === 'failed' && (item.failureMessage || item.summary) && <p className="mt-3 break-words text-sm leading-6 text-white/55">{item.failureMessage || item.summary}</p>}
          {item.status !== 'failed' && item.summary && <p className="mt-3 break-words text-sm leading-6 text-white/65">{item.summary}</p>}
          </details>}
        </div>
      </div>
  </li>;
}

export default function MembershipHistoryDrawer({ onClose }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError(false); setResult(null);
      try {
        const response = await getMembershipActivity({ page, filter });
        if (!response.ok || !response.data?.success) throw new Error('History unavailable');
        if (!cancelled) setResult(response.data.data);
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filter, page, attempt]);
  return <Dialog open onClose={onClose} className="membership-recovered-dialog relative z-[70]">
    <div className="fixed inset-0 bg-black/65" aria-hidden="true" />
    <div className="pointer-events-none fixed inset-0 flex justify-end">
      <DialogPanel className="membership-history-drawer pointer-events-auto flex h-dvh w-full max-w-full flex-col border-l border-white/10 bg-[#101113] text-white shadow-2xl sm:w-[530px]">
        <header className="flex shrink-0 items-start gap-3 border-b border-white/10 p-5">
          <History aria-hidden="true" className="mt-1 text-yellow-400" size={22} />
          <div className="min-w-0 flex-1"><DialogTitle className="type-card">History</DialogTitle><Description className="mt-1 text-sm leading-6 text-white/60">Your membership renewals, payments and reminders.</Description></div>
          <button type="button" autoFocus onClick={onClose} aria-label="Close membership history" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-white/10 focus-visible:outline-yellow-400"><X size={20} /></button>
        </header>
        <div className="relative z-10 shrink-0 px-5 py-4">
          <Listbox value={filter} onChange={(value) => { setFilter(value); setPage(1); }}>
            <div className="relative">
              <ListboxButton aria-label="Activity type" className="type-button group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 text-left text-white/85 transition hover:border-[#DCA11D]/40 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DCA11D] data-[open]:border-[#DCA11D]/50">
                <span className="flex min-w-0 items-center gap-2.5"><History size={15} aria-hidden="true" className="shrink-0 text-[#DCA11D]" />{activityFilters.find((option) => option.value === filter)?.label}</span>
                <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-white/40 transition-transform group-data-[open]:rotate-180" />
              </ListboxButton>
              <ListboxOptions transition className="absolute inset-x-0 top-full mt-2 origin-top rounded-2xl border border-white/10 bg-[#1B1C1F] p-1.5 text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)] outline-none transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0 motion-reduce:transition-none">
                {activityFilters.map(({ value, label, icon: Icon }) => <ListboxOption key={value} value={value} className="type-button group flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-white/65 transition data-[focus]:bg-white/[0.06] data-[focus]:text-white data-[selected]:bg-[#DCA11D]/10 data-[selected]:text-[#E6B94F]">
                  <Icon size={16} aria-hidden="true" className="shrink-0 opacity-70 group-data-[selected]:opacity-100" />
                  <span className="flex-1">{label}</span>
                  <Check size={15} aria-hidden="true" className="invisible shrink-0 group-data-[selected]:visible" />
                </ListboxOption>)}
              </ListboxOptions>
            </div>
          </Listbox>
        </div>
        <div className="membership-history-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5" aria-busy={loading}>
          {loading ? <div role="status" aria-label="Loading membership history" className="space-y-4">{[1, 2, 3].map((key) => <div key={key} className="h-36 animate-pulse rounded-2xl bg-white/5 motion-reduce:animate-none" />)}<span className="sr-only">Loading history...</span></div>
            : error ? <div role="alert" className="rounded-2xl border border-red-500/20 p-5 text-sm"><p>Unable to load membership history.</p><button type="button" onClick={() => setAttempt(attempt + 1)} className="type-button mt-4 rounded-xl border border-white/20 px-4 py-2">Retry</button></div>
              : !result?.items?.length ? <div role="status" className="py-12 text-center"><History className="mx-auto mb-4 text-white/30" /><p className="type-label">{filter === 'all' ? 'No membership activity yet' : 'No matching activities'}</p><p className="mt-2 text-sm text-white/50">{filter === 'all' ? 'Recorded membership activity will appear here.' : 'Choose another activity type to see more history.'}</p></div>
                : <ul aria-label="Membership activity timeline">{result.items.map((item) => <Activity key={item.id} item={item} />)}</ul>}
        </div>
        {!loading && !error && result?.pagination?.totalPages > 1 && <nav aria-label="History pages" className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 p-5"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="type-button rounded-xl border border-white/15 px-3 py-2 disabled:opacity-40">Previous</button><span className="type-caption" aria-live="polite">{page} / {result.pagination.totalPages}</span><button type="button" disabled={page >= result.pagination.totalPages} onClick={() => setPage(page + 1)} className="type-button rounded-xl border border-white/15 px-3 py-2 disabled:opacity-40">Next</button></nav>}
      </DialogPanel>
    </div>
  </Dialog>;
}

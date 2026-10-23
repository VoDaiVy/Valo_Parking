import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { QRCodeSVG } from 'qrcode.react';
import { bookingReceipt, linkBookingReceipt } from '../services/telegramReceiptService';

const labels = {
  needs_link: 'Open the bot, press Start and share your phone using the Telegram contact button.',
  awaiting_contact: 'Waiting for you to share your phone in Telegram.',
  queued: 'Sending your ticket...', processing: 'Sending your ticket...', pending: 'Sending your ticket...',
  sent: 'Ticket sent via Telegram.', failed: 'The ticket could not be sent. Your web ticket is still valid.',
  uncertain: 'Delivery is not confirmed. Check Telegram before continuing.',
  disabled: 'Telegram receipts are currently unavailable. Your web ticket is still valid.',
  expired: 'This link has expired. Your web ticket is still valid.',
  cancelled: 'Telegram delivery was cancelled. You can reconnect to receive this ticket.',
};
const terminal = new Set(['sent', 'disabled', 'expired', 'uncertain', 'failed', 'cancelled']);

export default function TelegramReceiptModal({ open, onClose, bookingId }) {
  const [current, setCurrent] = useState({ state: 'loading' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let timer;
    let stopped = false;
    const started = Date.now();
    const poll = async () => {
      try {
        setCheckedAt(Date.now());
        const data = await bookingReceipt(bookingId, controller.signal);
        if (stopped) return;
        if (data) { setCurrent(previous => ({ ...previous, ...data })); setError(''); }
        if (terminal.has(data?.state)) return;
      } catch (failure) {
        if (stopped) return;
        if (failure.message === 'expired') { setCurrent(previous => ({ ...previous, state: 'expired' })); return; }
        setError('Could not update delivery status. Your parking ticket is still valid.');
      }
      if (!stopped && Date.now() - started < 120000) timer = setTimeout(poll, 3000);
      else if (!stopped) setPaused(true);
    };
    poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); controllerRef.current = null; };
  }, [open, bookingId, pollCycle]);

  const action = async () => {
    setBusy(true); setError('');
    try {
      const signal = controllerRef.current?.signal;
      const result = await linkBookingReceipt(bookingId, signal);
      if (!signal?.aborted) { setCurrent(previous => ({ ...previous, ...result })); setPaused(false); setPollCycle(value => value + 1); }
    } catch { if (!controllerRef.current?.signal.aborted) setError('Please try again later.'); }
    finally { setBusy(false); }
  };
  const state = current.state || 'needs_link';
  const rawLink = current.claimLink || current.deepLink;
  const link = typeof rawLink === 'string' && /^https:\/\/t\.me\//.test(rawLink) ? rawLink : null;
  const expiry = current.claimExpiresAt || current.expiresAt;
  const expiredLink = expiry && new Date(expiry).getTime() <= checkedAt;
  const showLink = ['needs_link', 'awaiting_contact', 'expired'].includes(state);
  const relinkable = (state === 'failed' && current.errorCode === 'BOT_BLOCKED') || state === 'cancelled';

  return <Dialog open={open} onClose={onClose} className="relative z-[150]">
    <div className="fixed inset-0 bg-slate-950/60" aria-hidden="true" />
    <div className="fixed inset-0 overflow-y-auto p-4 flex items-center justify-center">
      <DialogPanel className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
        <DialogTitle className="text-xl font-bold">Receive ticket on Telegram</DialogTitle>
        <p role="status" aria-live="polite" className="mt-3 text-sm leading-relaxed">{labels[state] || "Checking ticket status..."}</p>
        {showLink && link && !expiredLink && <div className="mt-5 flex flex-col items-center gap-3">
          <div className="rounded-xl border p-3 bg-white"><QRCodeSVG value={link} size={200} level="M" title="Open Telegram ticket bot" /></div>
          <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => setCurrent(previous => ({ ...previous, state: 'awaiting_contact' }))} className="flex min-h-11 items-center justify-center rounded-xl bg-sky-700 px-5 font-bold text-white">Open Telegram to receive ticket</a>
          <p className="text-xs text-slate-600 text-center">This QR opens Telegram. Your parking QR ticket arrives in the chat.</p>
          {expiry && <p className="text-xs text-slate-600">Expires at {new Date(expiry).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>}
        {showLink && (!link || expiredLink) && bookingId && <button disabled={busy} onClick={() => action()} className="mt-4 min-h-11 rounded-xl bg-sky-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Creating..." : "Create Telegram link"}</button>}
        {relinkable && bookingId && <button disabled={busy} onClick={() => action()} className="mt-4 min-h-11 rounded-xl border px-4 font-semibold">Reconnect Telegram</button>}
        {paused && <p className="mt-3 text-sm">Updates paused. Close and reopen to check again.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <button autoFocus onClick={onClose} className="mt-5 min-h-11 w-full rounded-xl border border-slate-300 px-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-700">Close and continue</button>
      </DialogPanel>
    </div>
  </Dialog>;
}

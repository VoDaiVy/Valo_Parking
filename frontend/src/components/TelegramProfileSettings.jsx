import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, ExternalLink, Send } from 'lucide-react';
import {
  createTelegramProfileLink, getTelegramProfile, setTelegramNotifications, unlinkTelegramProfile,
} from '../services/telegramProfileService';

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-yellow-500/40 px-4 py-2 text-sm font-semibold text-yellow-300 transition-colors hover:bg-yellow-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yellow-400 disabled:cursor-not-allowed disabled:opacity-50';

// The parent keys this component by the server-confirmed phone, so changing the
// saved number aborts both the previous link attempt and its in-flight requests.
export default function TelegramProfileSettings({ phone, disabled = false }) {
  const [status, setStatus] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paused, setPaused] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const actionController = useRef(null);
  const actionGeneration = useRef(0);

  useEffect(() => () => {
    actionGeneration.current += 1;
    actionController.current?.abort();
  }, []);

  useEffect(() => {
    if (busy || disabled) return;
    const controller = new AbortController();
    let timer;
    const deadline = attempt ? Math.min(attempt.startedAt + 120000, new Date(attempt.expiresAt).getTime()) : 0;
    const poll = async () => {
      try {
        const data = await getTelegramProfile(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(data);
        setError('');
        if (data.linked && !data.blocked && data.notificationsEnabled && data.phoneMatches) {
          if (attempt) { setAttempt(null); setPaused(false); setNotice('Telegram connected. New paid bookings will arrive with your parking QR.'); }
          return;
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure.message);
      }
      if (attempt && !controller.signal.aborted) {
        if (Date.now() < deadline) timer = setTimeout(poll, 3000);
        else { setPaused(true); }
      }
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt, refresh, busy, disabled]);

  const act = async (kind) => {
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const generation = ++actionGeneration.current;
    setBusy(kind); setError(''); setNotice('');
    // Stop status polling before a mutation so an old response cannot restore
    // the link state that the mutation has just changed.
    setAttempt(null);
    setPaused(false);
    try {
      if (kind === 'link') {
        const data = await createTelegramProfileLink(controller.signal);
        if (controller.signal.aborted || generation !== actionGeneration.current) return;
        if (typeof data.deepLink !== 'string' || !/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]+$/.test(data.deepLink) || !Number.isFinite(new Date(data.expiresAt).getTime())) {
          throw new Error('Unable to open Telegram. Please create a new link.');
        }
        setAttempt({ ...data, startedAt: Date.now() });
      } else {
        if (kind === 'unlink') await unlinkTelegramProfile(controller.signal);
        else await setTelegramNotifications(!status.notificationsEnabled, controller.signal);
        const data = await getTelegramProfile(controller.signal);
        if (controller.signal.aborted || generation !== actionGeneration.current) return;
        setStatus(data);
        setNotice(kind === 'unlink' ? 'Telegram disconnected.' : data.notificationsEnabled ? 'Automatic tickets enabled.' : 'Automatic tickets paused.');
      }
    } catch (failure) {
      if (!controller.signal.aborted && generation === actionGeneration.current) setError(failure.message);
    } finally {
      if (!controller.signal.aborted && generation === actionGeneration.current) setBusy('');
    }
  };

  const connected = Boolean(status?.linked && status.phoneMatches);
  const canActivate = Boolean(status?.available && !status.needsPhone && phone);
  const canLink = canActivate && !disabled && !busy;
  const hasMapping = Boolean(connected || status?.blocked || status?.linkedAt);
  const waiting = Boolean(attempt && !paused);
  let label = 'Checking Telegram…';
  if (status) {
    if (!status.available) label = 'Telegram is currently unavailable.';
    else if (status.needsPhone || !phone) label = 'Save your phone number in Personal Records first.';
    else if (status.blocked) label = 'Unblock the VALO bot in Telegram, then reconnect.';
    else if (connected) label = status.notificationsEnabled ? 'Automatic tickets are on.' : 'Automatic tickets are paused.';
    else label = 'Connect once to receive your next booking automatically.';
  }

  return <section aria-label="Telegram parking tickets" className="mt-10 border-t border-yellow-500/20 pt-7 text-sm text-slate-200">
    <div className="flex items-center gap-3">
      <Send size={19} className="shrink-0 text-yellow-400" aria-hidden="true" />
      <h3 className="text-xl font-bold text-[#ffdea8]">Tickets on Telegram</h3>
    </div>
    <p className="mt-3 leading-relaxed text-slate-300">Receive booking details, your parking QR after payment and membership renewal reminders 7 days before expiry. Activate once using the same phone number as your saved profile.</p>
    {phone && <p className="mt-3 break-words text-slate-300">Saved phone: <span className="font-semibold text-white">{phone}</span></p>}
    <p role="status" aria-live="polite" className="mt-3 flex items-start gap-2 leading-relaxed text-yellow-200">
      {connected && !status?.blocked && <Check size={17} className="mt-0.5 shrink-0" aria-hidden="true" />}{label}
    </p>
    {disabled && <p className="mt-2 text-slate-300">Finish saving your profile before updating Telegram.</p>}
    {(canActivate || hasMapping) && <div className="mt-4 flex flex-wrap gap-3">
      {canActivate && (!connected || status.blocked) && <button type="button" disabled={!canLink} onClick={() => act('link')} className={`${buttonClass} bg-yellow-500/10`}>
        {busy === 'link' ? 'Creating link…' : attempt ? 'Create a new link' : status.blocked ? 'Reconnect Telegram' : 'Activate Telegram tickets'}
      </button>}
      {connected && !status.blocked && <button type="button" disabled={disabled || Boolean(busy) || (!status.notificationsEnabled && !canActivate)} onClick={() => act('toggle')} className={buttonClass}>
        {busy === 'toggle' ? 'Updating…' : status.notificationsEnabled ? 'Pause automatic tickets' : 'Enable automatic tickets'}
      </button>}
      {hasMapping && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => act('unlink')} className={buttonClass}>
        {busy === 'unlink' ? 'Disconnecting…' : 'Disconnect'}
      </button>}
    </div>}
    {waiting && !disabled && <div className="mt-5 space-y-4 rounded-2xl border border-yellow-500/25 p-4">
      <ol className="list-inside list-decimal space-y-2 leading-relaxed text-slate-200">
        <li>Open the bot and press <strong>Start</strong>.</li>
        <li>Tap <strong>Share my phone number</strong> in Telegram. It must match {phone}.</li>
      </ol>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="rounded-xl bg-white p-3"><QRCodeSVG value={attempt.deepLink} size={148} level="M" title="Scan to open the Telegram bot, not a parking ticket" /></div>
        <div className="space-y-3">
          <a href={attempt.deepLink} target="_blank" rel="noopener noreferrer" className={buttonClass}>Open Telegram <ExternalLink size={15} aria-hidden="true" /></a>
          <p className="text-xs leading-relaxed text-slate-300">This QR opens the bot. Your parking QR will arrive in the chat after booking payment.</p>
        </div>
      </div>
      <p role="status" className="text-slate-300">Waiting for confirmation… Updates stop after two minutes.</p>
      <button type="button" onClick={() => { setAttempt(null); setNotice('Link instructions closed. You can check your connection below.'); }} className={buttonClass}>Close instructions</button>
    </div>}
    {paused && <p role="status" className="mt-4 leading-relaxed text-slate-300">Updates paused. Check your connection below, or create a new link to try again.</p>}
    {notice && <p role="status" className="mt-4 leading-relaxed text-yellow-200">{notice}</p>}
    {error && <p role="alert" className="mt-4 leading-relaxed text-red-300">{error}</p>}
    <button type="button" disabled={Boolean(busy) || disabled} onClick={() => setRefresh(value => value + 1)} className={`${buttonClass} mt-4`}>Check connection</button>
    <p className="mt-4 text-xs leading-relaxed text-slate-300">Changing your saved phone number disconnects Telegram. Activate again to confirm the new number.</p>
  </section>;
}

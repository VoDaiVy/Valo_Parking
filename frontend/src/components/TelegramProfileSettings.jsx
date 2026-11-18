import { useLanguage } from '../i18n/hooks/useLanguage';
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
  const { t } = useLanguage();
  const [status, setStatus] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(false);
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
        setError(false);
        if (data.linked && !data.blocked && data.notificationsEnabled && data.phoneMatches) {
          if (attempt) { setAttempt(null); setPaused(false); setNotice('telegramProfile.telegramConnectedNewPaidBookingsWill'); }
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
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
    setBusy(kind); setError(false); setNotice('');
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
        setNotice(kind === 'unlink' ? 'telegramProfile.telegramDisconnected' : data.notificationsEnabled ? 'telegramProfile.automaticTicketsEnabled' : 'telegramProfile.automaticTicketsPaused');
      }
    } catch {
      if (!controller.signal.aborted && generation === actionGeneration.current) setError(true);
    } finally {
      if (!controller.signal.aborted && generation === actionGeneration.current) setBusy('');
    }
  };

  const connected = Boolean(status?.linked && status.phoneMatches);
  const canActivate = Boolean(status?.available && !status.needsPhone && phone);
  const canLink = canActivate && !disabled && !busy;
  const hasMapping = Boolean(connected || status?.blocked || status?.linkedAt);
  const waiting = Boolean(attempt && !paused);
  let label = t('telegramProfile.checkingTelegram');
  if (status) {
    if (!status.available) label = t('telegramProfile.telegramIsCurrentlyUnavailable');
    else if (status.needsPhone || !phone) label = t('telegramProfile.saveYourPhoneNumberInPersonal');
    else if (status.blocked) label = t('telegramProfile.unblockTheValoBotInTelegram');
    else if (connected) label = status.notificationsEnabled ? t('telegramProfile.automaticTicketsAreOn') : t('telegramProfile.automaticTicketsArePaused');
    else label = t('telegramProfile.connectOnceToReceiveYourNext');
  }

  return <section aria-label={t('telegramProfile.telegramParkingTickets')} className="mt-10 border-t border-yellow-500/20 pt-7 text-sm text-slate-200">
    <div className="flex items-center gap-3">
      <Send size={19} className="shrink-0 text-yellow-400" aria-hidden="true" />
      <h3 className="text-xl font-bold text-[#ffdea8]">{t('telegramProfile.ticketsOnTelegram')}</h3>
    </div>
    <p className="mt-3 leading-relaxed text-slate-300">{t('telegramProfile.receiveBookingDetailsYourParkingQr')}</p>
    {phone && <p className="mt-3 break-words text-slate-300">{t('telegramProfile.savedPhone')} <span className="font-semibold text-white">{phone}</span></p>}
    <p role="status" aria-live="polite" className="mt-3 flex items-start gap-2 leading-relaxed text-yellow-200">
      {connected && !status?.blocked && <Check size={17} className="mt-0.5 shrink-0" aria-hidden="true" />}{label}
    </p>
    {disabled && <p className="mt-2 text-slate-300">{t('telegramProfile.finishSavingYourProfileBeforeUpdating')}</p>}
    {(canActivate || hasMapping) && <div className="mt-4 flex flex-wrap gap-3">
      {canActivate && (!connected || status.blocked) && <button type="button" disabled={!canLink} onClick={() => act('link')} className={`${buttonClass} bg-yellow-500/10`}>
        {busy === 'link' ? t('telegramProfile.creatingLink') : attempt ? t('telegramProfile.createANewLink') : status.blocked ? t('telegramProfile.reconnectTelegram') : t('telegramProfile.activateTelegramTickets')}
      </button>}
      {connected && !status.blocked && <button type="button" disabled={disabled || Boolean(busy) || (!status.notificationsEnabled && !canActivate)} onClick={() => act('toggle')} className={buttonClass}>
        {busy === 'toggle' ? t('telegramProfile.updating') : status.notificationsEnabled ? t('telegramProfile.pauseAutomaticTickets') : t('telegramProfile.enableAutomaticTickets')}
      </button>}
      {hasMapping && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => act('unlink')} className={buttonClass}>
        {busy === 'unlink' ? t('telegramProfile.disconnecting') : t('telegramProfile.disconnect')}
      </button>}
    </div>}
    {waiting && !disabled && <div className="mt-5 space-y-4 rounded-2xl border border-yellow-500/25 p-4">
      <ol className="list-inside list-decimal space-y-2 leading-relaxed text-slate-200">
        <li>{t('telegramProfile.openBot')}</li>
        <li>{t('telegramProfile.sharePhone', { phone })}</li>
      </ol>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="rounded-xl bg-white p-3"><QRCodeSVG value={attempt.deepLink} size={148} level="M" title={t('telegramProfile.scanToOpenTheTelegramBot')} /></div>
        <div className="space-y-3">
          <a href={attempt.deepLink} target="_blank" rel="noopener noreferrer" className={buttonClass}>{t('telegramProfile.openTelegram')} <ExternalLink size={15} aria-hidden="true" /></a>
          <p className="text-xs leading-relaxed text-slate-300">{t('telegramProfile.thisQrOpensTheBotYour')}</p>
        </div>
      </div>
      <p role="status" className="text-slate-300">{t('telegramProfile.waitingForConfirmationUpdatesStopAfter')}</p>
      <button type="button" onClick={() => { setAttempt(null); setNotice('telegramProfile.linkInstructionsClosedYouCanCheck'); }} className={buttonClass}>{t('telegramProfile.closeInstructions')}</button>
    </div>}
    {paused && <p role="status" className="mt-4 leading-relaxed text-slate-300">{t('telegramProfile.updatesPausedCheckYourConnectionBelow')}</p>}
    {notice && <p role="status" className="mt-4 leading-relaxed text-yellow-200">{t(notice)}</p>}
    {error && <p role="alert" className="mt-4 leading-relaxed text-red-300">{t('telegramProfile.requestFailed')}</p>}
    <button type="button" disabled={Boolean(busy) || disabled} onClick={() => setRefresh(value => value + 1)} className={`${buttonClass} mt-4`}>{t('telegramProfile.checkConnection')}</button>
    <p className="mt-4 text-xs leading-relaxed text-slate-300">{t('telegramProfile.changingYourSavedPhoneNumberDisconnects')}</p>
  </section>;
}

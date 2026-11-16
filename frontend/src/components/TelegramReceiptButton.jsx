import { useEffect, useRef, useState } from 'react';
import { bookingReceipt, receiptRequestLocked } from '../services/telegramReceiptService';

export default function TelegramReceiptButton({ bookingId, onClick, refreshKey, className }) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const clickLock = useRef(false);
  const requestKey = JSON.stringify([bookingId, refreshKey, retry]);
  const receipt = result?.key === requestKey ? result.data : null;
  const checking = !receipt;

  useEffect(() => {
    const controller = new AbortController();
    clickLock.current = false;
    bookingReceipt(bookingId, controller.signal).then(data => {
      if (!controller.signal.aborted) { setResult({ key: requestKey, data }); setOpening(false); }
    }).catch(() => {
      if (!controller.signal.aborted) { setResult({ key: requestKey, data: { state: 'error' } }); setOpening(false); }
    });
    return () => controller.abort();
  }, [bookingId, requestKey]);

  const locked = receiptRequestLocked(receipt?.state);
  const disabled = checking || opening || locked || !bookingId;
  const label = checking ? 'Checking Telegram…' : receipt?.state === 'sent' ? 'Ticket sent on Telegram'
    : receipt?.state === 'uncertain' ? 'Delivery requested — check Telegram'
      : locked ? 'Telegram ticket is being sent…' : receipt?.state === 'error' ? 'Retry checking Telegram'
        : 'Receive this ticket on Telegram';

  return <button type="button" disabled={disabled} aria-busy={checking || opening}
    className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    onClick={() => {
      if (disabled || clickLock.current) return;
      if (receipt?.state === 'error') { setRetry(value => value + 1); return; }
      clickLock.current = true;
      setOpening(true);
      onClick();
    }}>{label}</button>;
}

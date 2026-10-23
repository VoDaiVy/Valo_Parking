import { useEffect, useState } from 'react';
import { API_BASE } from '../../services/api';

export default function KioskDeviceSetup({ gate, onReady }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/kiosk-devices/session?gate=${gate}`, { credentials: 'include' })
      .then(response => response.json()).then(result => {
        if (active && result.success && result.data?.authorized) { setReady(true); onReady?.(); }
      }).catch(() => { if (active) setError('Unable to check kiosk authorization.'); });
    return () => { active = false; };
  }, [gate, onReady]);
  const provision = async () => {
    const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
    if (!token) { setError('A staff member must sign in to authorize this kiosk.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/kiosk-devices/session`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ gate }),
      });
      const result = await response.json();
      if (!result.success || !result.data?.authorized) throw new Error(result.message || 'Kiosk authorization failed.');
      setReady(true); onReady?.();
    } catch (err) { setError(err.message || 'Unable to authorize kiosk.'); }
    finally { setBusy(false); }
  };
  if (ready) return null;
  return <div className="rounded-xl border border-amber-400/40 bg-amber-100 p-3 text-slate-900 text-sm">
    <p>Staff authorization is required to operate this kiosk.</p>
    <button disabled={busy} onClick={provision} className="min-h-11 px-4 font-bold underline">{busy ? 'Authorizing…' : 'Authorize this kiosk'}</button>
    <a href="/login" className="ml-3 underline">Staff sign in</a>
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
  </div>;
}

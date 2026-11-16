import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { apiFetch } from '../../services/api';

export default function MembershipServiceSelectionModal({ session, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(null);
  const inFlight = useRef(false);
  const headers = { Authorization: `Bearer ${localStorage.getItem('accessToken')}` };
  const load = async () => {
    const response = await apiFetch(`/membership-services/sessions/${session._id}/benefits`, { headers });
    if (!response.ok || !response.data?.success) throw new Error(response.data?.message || 'Unable to load services.');
    setData(response.data.data);
    setSelected(response.data.data.requests.filter((r) => r.status === 'pending').map((r) => r.serviceId));
  };
  useEffect(() => {
    let active = true;
    apiFetch(`/membership-services/sessions/${session._id}/benefits`, { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } })
      .then((r) => { if (!active) return; if (!r.ok || !r.data?.success) throw new Error(r.data?.message || 'Unable to load services.');
        setData(r.data.data); setSelected(r.data.data.requests.filter((q) => q.status === 'pending').map((q) => q.serviceId)); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [session._id]);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    const signature = JSON.stringify([data.revision, [...selected].sort()]);
    if (key.current?.signature !== signature) key.current = { signature, value: crypto.randomUUID() };
    try {
      const r = await apiFetch(`/membership-services/sessions/${session._id}/selection`, { method: 'PUT', headers,
        body: JSON.stringify({ serviceIds: selected, revision: data.revision, idempotencyKey: key.current.value }) });
      if (!r.ok || !r.data?.success) {
        if (r.status === 409) await load();
        throw new Error(r.data?.message || 'Unable to save.');
      }
      await onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { inFlight.current = false; setBusy(false); }
  };
  const pending = data?.requests.filter((r) => r.status === 'pending') || [];
  const inProgress = data?.requests.filter((r) => r.status === 'in_progress') || [];
  const choices = [...(data?.groupedBenefits || [])];
  for (const r of pending) if (!choices.some((g) => g.serviceId === r.serviceId)) choices.push({ serviceId: r.serviceId, serviceName: r.serviceName, available: 0, reserved: 1 });
  return <Dialog open onClose={() => !busy && onClose()} className="relative z-50">
    <div className="fixed inset-0 bg-black/70" />
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel className="flex max-h-[calc(100dvh-32px)] w-full max-w-xl flex-col rounded-2xl border border-gray-700 bg-[#111118] text-white">
        <div className="border-b border-gray-700 p-5"><DialogTitle className="text-xl font-bold">Membership services</DialogTitle><p className="mt-2 text-yellow-400">{session.licensePlate} · {data?.session.floorName || 'Floor'} · {data?.session.parkingSlot || session.parkingSlot}</p></div>
        <div className="overflow-y-auto p-5">
          {error && <p role="alert" className="mb-3 text-red-400">{error}</p>}
          {!data && !error && <p>Loading…</p>}
          {data && !data.selectionEnabled && <p className="mb-3">New selections are disabled; you can still remove pending services.</p>}
          {data && !choices.length && <p>No included uses available.</p>}
          {choices.map((g) => <label key={g.serviceId} className="mb-3 flex gap-3 rounded-lg border border-gray-700 p-3">
            <input type="checkbox" checked={selected.includes(g.serviceId)} disabled={busy || inProgress.some((r) => r.serviceId === g.serviceId) || (!selected.includes(g.serviceId) && (!data.selectionEnabled || !g.available))}
              onChange={(e) => setSelected((s) => e.target.checked ? [...s, g.serviceId] : s.filter((id) => id !== g.serviceId))} />
            <span><strong>{g.serviceName}</strong><span className="block text-sm text-gray-400">{g.available} available · {g.reserved} reserved{g.nearestExpiry ? ` · Expires ${new Date(g.nearestExpiry).toLocaleString('vi-VN')}` : ''}</span></span>
          </label>)}
          <p className="text-sm text-gray-400">Uses are combined from your eligible packages. Each selected service uses 1 allowance.</p>
          {inProgress.map((r) => <p key={r._id} className="mt-3 text-blue-300">{r.serviceName}: in progress</p>)}
          {data?.requests.filter((r) => ['done', 'cancelled'].includes(r.status)).map((r) => <p key={r._id} className="mt-2 text-sm text-gray-400">{r.serviceName}: {r.status}</p>)}
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-700 p-4"><button disabled={busy} onClick={onClose} className="min-h-11 rounded-lg border border-gray-600 px-4">Close</button><button disabled={!data || busy} onClick={save} className="min-h-11 rounded-lg bg-yellow-400 px-4 font-bold text-black disabled:opacity-40">{busy ? 'Saving…' : 'Save selection'}</button></div>
      </DialogPanel>
    </div>
  </Dialog>;
}

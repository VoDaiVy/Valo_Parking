import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../services/api";
import { useSearchParams } from 'react-router-dom';
import { getMembershipStatus } from "../../services/subscriptionService";

const emptyPage = { items: [], pagination: {} };
const headers = () => ({
  Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
});
const pageData = (data) =>
  Array.isArray(data) ? { items: data, pagination: {} } : data || emptyPage;
const id = (value) => value?._id || value;
const formatDate = (value) => new Date(value).toLocaleString("vi-VN");

export default function MembershipServices({ staff = false }) {
  const [params] = useSearchParams();
  const [grants, setGrants] = useState(emptyPage);
  const [requests, setRequests] = useState(emptyPage);
  const [sessions, setSessions] = useState(emptyPage);
  const [sessionId, setSessionId] = useState(() => params.get('sessionId') || '');
  const [status, setStatus] = useState('');
  const [context, setContext] = useState(null);
  const [selected, setSelected] = useState([]);
  const [grantPage, setGrantPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [legacyUses, setLegacyUses] = useState(0);
  const keys = useRef({});
  const inFlight = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setSessionId(params.get('sessionId') || ''), 0); return () => clearTimeout(timer); }, [params]);

  useEffect(() => {
    let active = true;
    const get = async (path) => {
      const response = await apiFetch(`/membership-services/${path}`, {
        headers: headers(),
      });
      if (!response.ok || !response.data?.success)
        throw new Error(
          response.data?.message || "Unable to load membership services.",
        );
      return response.data.data;
    };
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        if (staff) {
          const [sessionData, benefits, history] = await Promise.all([
            get(
              `staff/sessions?page=${sessionPage}&search=${encodeURIComponent(search)}`,
            ),
            sessionId ? get(`staff/sessions/${sessionId}/benefits${params.get('requestId') ? `?requestId=${encodeURIComponent(params.get('requestId'))}` : ''}`) : null,
            sessionId ? null : get(`requests?page=${requestPage}${status ? `&status=${status}` : ''}`),
          ]);
          if (!active) return;
          setSessions(pageData(sessionData));
          setGrants(pageData(benefits?.grants));
          setContext(benefits?.session || null);
          setRequests(pageData(benefits?.requests || history));
        } else {
          const [grantData, requestData, membership] = await Promise.all([
            get(`grants?page=${grantPage}`),
            get(`requests?page=${requestPage}`),
            getMembershipStatus(),
          ]);
          if (!active) return;
          setGrants(pageData(grantData));
          setRequests(pageData(requestData));
          if (membership.ok && membership.data?.success)
            setLegacyUses(Number(membership.data.data.freeServiceCount || 0));
        }
        setSelected([]);
      } catch (loadError) {
        if (active) {
          setError(loadError.message);
          setGrants(emptyPage);
          setRequests(emptyPage);
          setSelected([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [staff, grantPage, requestPage, sessionPage, sessionId, search, reload, status, params]);

  const mutate = async (path, payload) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`/membership-services/${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });
      if (!response.ok || !response.data?.success)
        throw new Error(
          response.data?.message || "Unable to update service work.",
        );
      setReload((value) => value + 1);
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const start = async () => {
    const grantIds = [...selected].sort();
    const signature = JSON.stringify([sessionId, grantIds]);
    keys.current[signature] ||= crypto.randomUUID();
    if (
      await mutate("staff/start", {
        sessionId,
        grantIds,
        idempotencyKey: keys.current[signature],
      })
    )
      delete keys.current[signature];
  };
  const cancel = (request) => {
    const reason = window.prompt("Reason for cancellation");
    if (reason === null) return;
    if (request.status === "in_progress" && !reason.trim()) {
      setError("Enter a reason to cancel work already started.");
      return;
    }
    void mutate(`requests/${request._id}/cancel`, { reason });
  };
  const activeService = (grant) =>
    requests.items.some(
      (request) =>
        ["pending", "in_progress"].includes(request.status) &&
        (id(request.serviceId) === id(grant.serviceId) ||
          id(request.grantId) === grant._id),
    );
  const toggle = (grant) =>
    setSelected((current) =>
      current.includes(grant._id)
        ? current.filter((value) => value !== grant._id)
        : [
            ...current.filter(
              (value) =>
                id(
                  grants.items.find((item) => item._id === value)?.serviceId,
                ) !== id(grant.serviceId),
            ),
            grant._id,
          ],
    );
  const pages = (pagination, page, setPage) =>
    pagination.totalPages > 1 && (
      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          disabled={loading || busy || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          {page} / {pagination.totalPages}
        </span>
        <button
          type="button"
          disabled={loading || busy || page >= pagination.totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    );
  return (
    <section className="my-8 rounded-2xl border border-gray-200 bg-white p-5 text-slate-900">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Membership services</h2>
        <button
          type="button"
          disabled={loading || busy}
          onClick={() => setReload((value) => value + 1)}
          className="min-h-11 rounded-xl border px-4 font-semibold"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-red-700">
          {error}
        </p>
      )}
      {staff && (
        <div className="mb-5 space-y-3">
          <label className="block text-sm font-semibold">
            Find a parked vehicle
            <input
              value={search}
              disabled={busy}
              onChange={(event) => {
                setSearch(event.target.value);
                setSessionPage(1);
              }}
              placeholder="License plate"
              className="ml-3 rounded-lg border p-3"
            />
          </label>
          <label className="block text-sm font-semibold">
            Active parking session
            <select
              value={sessionId}
              disabled={busy || loading}
              onChange={(event) => {
                setSessionId(event.target.value);
                setSelected([]);
              }}
              className="ml-3 max-w-full rounded-lg border bg-white p-3"
            >
              <option value="">Select vehicle / show service history</option>
              {sessionId &&
                !sessions.items.some(
                  (session) => session._id === sessionId,
                ) && <option value={sessionId}>{context?.licensePlate || sessionId} · {context?.parkingSlot}</option>}
              {sessions.items.map((session) => (
                <option key={session._id} value={session._id}>
                  {session.licensePlate} ·{" "}
                  {session.parkingSlot || session._id.slice(-6)}
                </option>
              ))}
            </select>
          </label>
          {!loading && !sessions.items.length && (
            <p>No matching vehicles currently parked.</p>
          )}
          {pages(sessions.pagination, sessionPage, setSessionPage)}
        </div>
      )}
      {loading ? (
        <p role="status">Loading services...</p>
      ) : (
        <>
          {(!staff || sessionId) && (
            <>
              <p className="mb-4 text-sm text-gray-600">
                {staff
                  ? "Select services to start. Each selected service uses 1 allowance; finish each service independently."
                  : "Ask staff at the parking lot to start an included service. Your remaining uses and history update here."}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {grants.items.map((grant) => {
                  const running = staff && activeService(grant);
                  return (
                    <article key={grant._id} className="rounded-xl border p-4">
                      <h3 className="font-bold">
                        {grant.serviceName} · {grant.slotCode}
                      </h3>
                      <p className="mt-2 text-sm">
                        Granted {grant.total} · Used {grant.used} · Reserved{" "}
                        {grant.reserved} · Remaining {grant.available}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        {formatDate(grant.validFrom)} –{" "}
                        {formatDate(grant.expireAt)}
                      </p>
                      {staff && (
                        <label className="mt-4 flex min-h-11 items-center gap-3 font-semibold">
                          <input
                            type="checkbox"
                            checked={selected.includes(grant._id)}
                            disabled={busy || !grant.canUse || running}
                            onChange={() => toggle(grant)}
                          />
                          {running ? "In progress" : "Select service"}
                        </label>
                      )}
                      {!grant.canUse && (
                        <p className="mt-2 text-xs text-gray-500">
                          Unavailable: check remaining uses, service period and
                          membership status.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
              {!grants.items.length && (
                <p>No service allowances issued for these spaces.</p>
              )}
              {!staff && !grants.pagination.total && legacyUses > 0 && (
                <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm">
                  Your earlier membership records {legacyUses} service uses.
                  Contact staff to identify the included services.
                </p>
              )}
              {!staff && pages(grants.pagination, grantPage, setGrantPage)}
              {staff && (
                <button
                  type="button"
                  disabled={busy || !selected.length}
                  onClick={start}
                  className="mt-4 min-h-11 rounded-xl bg-slate-900 px-4 font-bold text-white disabled:opacity-40"
                >
                  Start selected services ({selected.length})
                </button>
              )}
            </>
          )}
          <h3 className="mb-3 mt-7 text-lg font-bold">
            {staff && sessionId
              ? "Active work and recent history"
              : "Service work and history"}
          </h3>
          {staff && sessionId && (
            <p className="mb-3 text-sm text-gray-500">
              All active services and up to 50 completed or cancelled services.
            </p>
          )}
          {!requests.items.length && <p>No service work yet.</p>}
          {staff && <select aria-label="Filter requests" value={status} onChange={(e) => { setStatus(e.target.value); setRequestPage(1); }} className="mb-3 rounded-lg border p-2"><option value="">All</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select>}
          <div className="space-y-3">
            {requests.items.filter((r) => !status || r.status === status).map((request) => (
              <article
                key={request._id}
                id={`request-${request._id}`}
                className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${params.get('requestId') === request._id ? 'ring-2 ring-yellow-500' : ''}`}
              >
                <div>
                  <h4 className="font-bold">
                    {request.serviceName} · {request.slotCode}
                  </h4>
                  <p className="text-sm">
                    {request.licensePlate} · {request.status}
                  </p>
                  {request.startedAt && (
                    <p className="mt-1 text-xs text-gray-500">
                      Started {formatDate(request.startedAt)}
                    </p>
                  )}
                  {request.completedAt && (
                    <p className="mt-1 text-xs text-gray-500">
                      Completed {formatDate(request.completedAt)}
                    </p>
                  )}
                  {request.history?.at(-1)?.reason && (
                    <p className="mt-1 text-xs text-gray-500">
                      {request.history.at(-1).reason}
                    </p>
                  )}
                </div>
                {staff && (
                  <div className="flex gap-3">
                    {request.status === "pending" && (
                      request.accountingMode === 'customer_reserved' ? <button disabled={busy} onClick={() => mutate(`requests/${request._id}/start`, {})} className="min-h-11 rounded-lg bg-blue-700 px-4 font-bold text-white">Start</button> : <p className="text-sm text-gray-600">
                        Cancel this earlier request, then start the service from
                        the active parking session.
                      </p>
                    )}
                    {request.status === "in_progress" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          mutate(`requests/${request._id}/complete`, {})
                        }
                        className="min-h-11 rounded-lg bg-emerald-700 px-4 font-bold text-white"
                      >
                        Complete this service
                      </button>
                    )}
                    {["pending", "in_progress"].includes(request.status) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => cancel(request)}
                        className="min-h-11 rounded-lg border px-4 font-bold"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {(!staff || !sessionId) &&
            pages(requests.pagination, requestPage, setRequestPage)}
        </>
      )}
    </section>
  );
}

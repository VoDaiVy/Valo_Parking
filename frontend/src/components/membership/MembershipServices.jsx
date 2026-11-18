import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../services/api";
import { useSearchParams } from 'react-router-dom';
import { getMembershipStatus } from "../../services/subscriptionService";
import { useTranslation } from "react-i18next";

import CustomerMembershipServicesView from "./CustomerMembershipServicesView";
import StaffMembershipServicesView from "./StaffMembershipServicesView";

const emptyPage = { items: [], pagination: {} };
const headers = () => ({
  Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
});
const pageData = (data) =>
  Array.isArray(data) ? { items: data, pagination: {} } : data || emptyPage;
const id = (value) => value?._id || value;

export default function MembershipServices({ staff = false }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
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
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(staff);
  const keys = useRef({});
  const inFlight = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setSessionId(params.get('sessionId') || ''), 0); return () => clearTimeout(timer); }, [params]);

  useEffect(() => {
    if (!staff) return;
    let active = true;
    const loadMetrics = async () => {
      setMetricsLoading(true);
      try {
        const counts = await Promise.all(['', 'pending', 'in_progress', 'done'].map(async (value) => {
          const response = await apiFetch(`/membership-services/requests?page=1&limit=1${value ? `&status=${value}` : ''}`, { headers: headers() });
          if (!response.ok || !response.data?.success) throw new Error('Metrics unavailable');
          const total = response.data.data?.pagination?.total;
          return Number.isFinite(total) ? total : null;
        }));
        if (active) setMetrics(Object.fromEntries(['total', 'pending', 'in_progress', 'done'].map((key, index) => [key, counts[index]])));
      } catch {
        if (active) setMetrics(null);
      } finally {
        if (active) setMetricsLoading(false);
      }
    };
    void loadMetrics();
    return () => { active = false; };
  }, [staff, reload]);

  useEffect(() => {
    let active = true;
    const get = async (path) => {
      const response = await apiFetch(`/membership-services/${path}`, {
        headers: headers(),
      });
      if (!response.ok || !response.data?.success)
        throw new Error(
          response.data?.message || t('membershipServicesUi.loadError'),
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
            sessionId ? null : get(`requests?page=${requestPage}&limit=6${status ? `&status=${status}` : ''}`),
          ]);
          if (!active) return;
          setSessions(pageData(sessionData));
          setGrants(pageData(benefits?.grants));
          setContext(benefits?.session || null);
          setRequests(pageData(benefits?.requests || history));
          if (!sessionId && Number.isFinite(history?.pagination?.totalPages)) {
            setRequestPage((page) => Math.min(page, Math.max(1, history.pagination.totalPages)));
          }
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
  }, [staff, grantPage, requestPage, sessionPage, sessionId, search, reload, status, params, t]);

  useEffect(() => {
    if (staff) return;
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener('membership:refresh', refresh);
    return () => window.removeEventListener('membership:refresh', refresh);
  }, [staff]);

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
          response.data?.message || t('membershipServicesUi.updateError'),
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
    const reason = window.prompt(t('membershipServicesUi.cancelReasonPrompt'));
    if (reason === null) return;
    if ((request.status === "in_progress" || request.accountingMode === "customer_reserved") && !reason.trim()) {
      setError(t('membershipServicesUi.cancelReasonRequired'));
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
          {t('membershipServicesUi.previous')}
        </button>
        <span>
          {page} / {pagination.totalPages}
        </span>
        <button
          type="button"
          disabled={loading || busy || page >= pagination.totalPages}
          onClick={() => setPage(page + 1)}
        >
          {t('membershipServicesUi.next')}
        </button>
      </div>
    );
  if (staff) return <StaffMembershipServicesView
    {...{ t, language, loading, busy, error, search, sessions, sessionId, context,
      grants, requests, selected, toggle, start, cancel, mutate, status, pages, metrics, metricsLoading,
      sessionPage, setSessionPage, requestPage, setRequestPage, params, activeService }}
    reload={() => setReload((value) => value + 1)}
    setSearch={(value) => { setSearch(value); setSessionPage(1); }}
    setSessionId={(value) => { setSessionId(value); setSelected([]); setStatus(''); setRequestPage(1); }}
    setStatus={(value) => { setStatus(value); setRequestPage(1); }}
  />;
  return <CustomerMembershipServicesView
    {...{ t, language, loading, busy, error, grants, requests, legacyUses, pages,
      grantPage, setGrantPage, requestPage, setRequestPage, params }}
    reload={() => setReload((value) => value + 1)}
  />;
}

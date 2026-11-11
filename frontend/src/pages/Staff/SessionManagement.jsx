import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Loader2, Search, ShieldCheck, Sparkles, X, MonitorCheck, Car, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { getAllSessions } from '../../services/sessionService';
import { filterAndSortSessions, getPaginationPages, paginateSessions } from './sessionPagination.js';
import StaffDropdown from './components/StaffDropdown.jsx';
import './components/staffManagement.css';
import './components/staffSessionManagement.css';
import '../Admin/sessionManagement.css';
import { sessionMetrics } from './sessionMetrics.js';
import './components/sessionDetails.css';
import AIPlateResolutionModal from './components/AIPlateResolutionModal.jsx';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createSessionVerification, verifiedSessionForQuery, sessionRowTarget, highlightSessionRow } from './sessionDeepLink.js';

export default function SessionManagement() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manualSession, setSelectedSession] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiInitialPlate, setAiInitialPlate] = useState('');
  const [aiInitialImage, setAiInitialImage] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdQuery = searchParams.get('sessionId');
  const location = useLocation();
  const isAdminPage = location.pathname === '/admin/sessions';
  const [verification, setVerification] = useState({ status: 'idle' });
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [rowFocus, setRowFocus] = useState(null);
  const verifier = useMemo(() => createSessionVerification(() => getAllSessions({ cache: 'no-store' }), (result) => {
    setVerification(result);
    if (result.sessions) {
      setSessions(result.sessions);
      setError('');
      setLoading(false);
    } else if (result.status !== 'loading') {
      setLoading(false);
      setError('Không thể tải danh sách phiên đỗ xe. Vui lòng thử lại.');
    }
  }), [setVerification, setSessions, setError, setLoading]);
  const adminDeepLink = isAdminPage && Boolean(sessionIdQuery);
  const verificationKey = `${location.key}:${verificationAttempt}`;
  const linkedSession = adminDeepLink ? verifiedSessionForQuery(verification, sessionIdQuery, verificationKey) : null;
  const selectedSession = adminDeepLink ? null : manualSession;
  const verificationStatus = verification.sessionId === sessionIdQuery && verification.requestKey === verificationKey
    ? verification.status : 'loading';
  const selectManualSession = (session) => {
    setSelectedSession(session);
    if (adminDeepLink) {
      verifier.cancel();
      const params = new URLSearchParams(searchParams);
      params.delete('sessionId');
      setSearchParams(params, { replace: true });
    }
  };

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAllSessions();
      if (response.ok && response.data?.success) {
        setSessions(response.data.data || []);
        setCurrentPage(1);
        setError('');
      } else {
        setError(response.data?.message || 'Failed to load sessions. Please try again.');
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      setError('Failed to load sessions. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminDeepLink) return;
    const timerId = setTimeout(fetchSessions, 0);
    return () => clearTimeout(timerId);
  }, [fetchSessions, adminDeepLink]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      verifier.verify(isAdminPage ? 'admin' : 'staff', sessionIdQuery, verificationKey);
    }, 0);
    return () => { clearTimeout(timerId); verifier.cancel(); };
  }, [verifier, isAdminPage, sessionIdQuery, verificationKey]);

  useEffect(() => {
    const pageScroller = document.querySelector('main');
    pageScroller?.classList.add('scrollbar-hidden');

    return () => pageScroller?.classList.remove('scrollbar-hidden');
  }, []);

  useEffect(() => {
    if (!isAdminPage && sessions.length > 0 && sessionIdQuery) {
      const targetSession = sessions.find(s => s._id === sessionIdQuery);
      if (targetSession) {
        const timerId = setTimeout(() => {
          setSelectedSession(targetSession);
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('sessionId');
          setSearchParams(newParams, { replace: true });
        }, 0);
        return () => clearTimeout(timerId);
      }
    }
  }, [sessions, sessionIdQuery, searchParams, setSearchParams, isAdminPage]);

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  };

  const formatPrice = (price) => new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(price) || 0);

  const filteredSessions = useMemo(
    () => filterAndSortSessions(sessions, {
      searchQuery,
      status: statusFilter,
      sortBy,
    }),
    [sessions, searchQuery, statusFilter, sortBy],
  );

  const pagination = useMemo(
    () => paginateSessions(filteredSessions, currentPage),
    [filteredSessions, currentPage],
  );
  const pageControls = useMemo(
    () => getPaginationPages(pagination.currentPage, pagination.totalPages),
    [pagination.currentPage, pagination.totalPages],
  );

  useEffect(() => {
    if (!linkedSession) return;
    const target = sessionRowTarget(linkedSession._id, verification.sessions);
    if (!target) return;
    const timer = setTimeout(() => {
      setSelectedSession(null);
      setSearchQuery('');
      setStatusFilter('all');
      setSortBy('newest');
      setCurrentPage(target.page);
      setRowFocus({ ...target, requestKey: verificationKey });
    }, 0);
    return () => clearTimeout(timer);
  }, [linkedSession, verification.sessions, verificationKey]);

  useEffect(() => {
    if (!adminDeepLink || rowFocus?.requestKey !== verificationKey) return;
    return highlightSessionRow(document.getElementById(`session-row-${rowFocus.id.toLowerCase()}`));
  }, [rowFocus, adminDeepLink, verificationKey]);

  const [metricsNow, setMetricsNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setMetricsNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, [isAdminPage]);
  const metrics = useMemo(() => sessionMetrics(sessions, metricsNow), [sessions, metricsNow]);

  return (
    <div className={`g3-management-page g3-session-page ${isAdminPage ? 'admin-session-management' : 'staff-session-management'} min-h-full bg-[#080808] px-4 py-6 text-white sm:px-6 lg:px-8`}>
      {isAdminPage && <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />}
      {adminDeepLink && verificationStatus !== 'verified' && (
        <div role={verificationStatus === 'loading' ? 'status' : 'alert'} className="mb-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          {verificationStatus === 'loading' ? 'Verifying the linked session...'
            : verificationStatus === 'missing' ? 'Session not found.'
              : verificationStatus === 'unavailable' ? 'Session access is unavailable. Check your sign-in and permissions.'
                : 'Unable to verify this session. Please try again.'}
          {verificationStatus !== 'loading' && <button type="button" className="ml-3 underline" onClick={() => {
            setVerification({ sessionId: sessionIdQuery, status: 'loading', session: null });
            setVerificationAttempt((attempt) => attempt + 1);
          }}>Retry</button>}
        </div>
      )}
      <div className="g3-management-content g3-header mb-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          {isAdminPage ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Session Management</h1>
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
                <MonitorCheck size={12} /> Session Manager
              </div>
            </div>
          ) : <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Session Management</h1>}
          <p className="g3-subtitle mt-0.5 text-sm font-medium text-blue-200/60">Monitor vehicle entry/exit and security images.</p>
        </div>

        <div className={isAdminPage ? 'admin-session-header-actions' : 'staff-session-header-actions'}>
        {isAdminPage && <button type="button" onClick={() => {
          if (loading) return;
          if (adminDeepLink) {
            setLoading(true);
            setVerificationAttempt((attempt) => attempt + 1);
          } else {
            fetchSessions();
          }
        }} disabled={loading} title="Refresh sessions" aria-label="Refresh sessions" aria-busy={loading} className="admin-session-refresh">
          <RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
        </button>}
        {!isAdminPage && <button type="button" onClick={fetchSessions} disabled={loading} title="Refresh sessions" aria-label="Refresh sessions" className="staff-session-refresh">
          <RefreshCw size={17} aria-hidden="true" className={loading ? 'animate-spin' : ''} />
        </button>}
        {/* AI Blurred Plate Assistant Button */}
        <button
          type="button"
          onClick={() => {
            setAiInitialPlate(searchQuery || '');
            setAiInitialImage(null);
            setShowAiModal(true);
          }}
          className="g4-ai-plate-trigger g3-header-action flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-500/20 to-violet-500/20 border border-violet-400/40 text-violet-300 font-bold text-xs hover:bg-violet-400 hover:text-white transition shadow-lg shadow-violet-500/10 shrink-0"
        >
          <Sparkles size={16} className="text-violet-400 animate-pulse" />
          <span>AI Plate Assistant</span>
        </button>
        </div>
      </div>

      {isAdminPage && (
        <section aria-label="Admin session summary" aria-busy={loading} className="admin-session-metrics">
          {[
            { label: 'Total Sessions', value: metrics.total, Icon: MonitorCheck, note: 'All recorded sessions', tone: 'text-blue-300' },
            { label: 'Currently Parked', value: metrics.parked, Icon: Car, note: 'Active sessions', tone: 'text-cyan-300' },
            { label: 'Completed Today', value: metrics.completedToday, Icon: CheckCircle2, note: 'Checkouts in Vietnam time', tone: 'text-emerald-300' },
            { label: 'Completed Sessions', value: sessions.filter((session) => session.status === 'completed').length, Icon: CheckCircle2, note: 'Finished parking sessions', tone: 'text-emerald-300' },
          ].map(({ label, value, Icon, note, tone }) => (
            <div key={label} className="admin-session-metric" title={loading ? 'Loading sessions' : error ? 'Session API unavailable' : note}>
              <Icon size={18} className={`shrink-0 ${tone}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-blue-200/55">{label}</p>
                {loading ? <div className="mt-1.5 h-6 w-16 animate-pulse rounded bg-white/10" aria-label="Loading" /> : (
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <p className="font-mono text-2xl font-black leading-none text-white">{error || value == null ? 'N/A' : value.toLocaleString('vi-VN')}</p>
                    <span className="truncate text-xs text-emerald-300">{error ? 'Unavailable' : note}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {!isAdminPage && <section aria-label="Session summary" className="g3-management-content staff-session-metrics">
        {[
          { label: 'Total Sessions', value: metrics.total, Icon: MonitorCheck, note: 'All sessions returned by the authorized session API; independent of table filters.' },
          { label: 'Currently Parked', value: metrics.parked, Icon: Car, note: 'All sessions with active status.' },
          { label: 'Completed Today', value: metrics.completedToday, Icon: CheckCircle2, note: 'Completed sessions checked out today in Asia/Ho_Chi_Minh.' },
          { label: 'Needs Attention', value: metrics.needsAttention, Icon: Clock, note: metrics.needsAttention == null ? 'Unavailable: an active session has missing or invalid expected timing.' : 'Active sessions past their recorded expected duration, matching Staff diagnostics.' },
        ].map(({ label, value, Icon, note }) => <article key={label} aria-label={label} title={loading ? 'Loading session data' : error ? 'Session data unavailable' : note} className="staff-session-metric">
          <Icon size={19} aria-hidden="true" />
          <div><p className="staff-session-metric-label">{label}</p><p className="staff-session-metric-value">{loading ? '...' : error ? '\u2014' : value == null ? <span className="staff-session-unavailable">Unavailable</span> : value}</p></div>
        </article>)}
      </section>}

      <section className="g3-management-content g3-session-panel overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0b0b0b] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        {!loading && !error && (
          <div className="g3-toolbar flex flex-col gap-3 border-b border-white/[0.07] bg-[#0d0d0d] p-4 lg:flex-row lg:items-center">
            <label className="g3-search relative min-w-0 flex-1 lg:max-w-md">
              <span className="sr-only">Search sessions</span>
              <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search license plate or phone..."
                className="h-11 w-full rounded-xl border border-white/10 bg-[#080808] pl-10 pr-4 text-sm font-semibold text-white outline-none transition-colors placeholder:text-slate-700 focus:border-[#ffd555]/40 focus:ring-2 focus:ring-[#ffd555]/10"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:items-center">
              <StaffDropdown
                value={statusFilter}
                onChange={(value) => {
                    setStatusFilter(value);
                    setCurrentPage(1);
                }}
                options={[
                  ['all', 'All statuses'],
                  ['active', 'Active'],
                  ['completed', 'Completed'],
                  ['cancelled', 'Cancelled'],
                ]}
                ariaLabel="Filter sessions by status"
                className="w-full sm:min-w-40"
                buttonClassName="text-xs font-black uppercase tracking-[0.08em]"
              />

              <StaffDropdown
                value={sortBy}
                onChange={(value) => {
                    setSortBy(value);
                    setCurrentPage(1);
                }}
                options={[
                  ['newest', 'Newest first'],
                  ['oldest', 'Oldest first'],
                  ['price-high', 'Price: high to low'],
                  ['price-low', 'Price: low to high'],
                ]}
                ariaLabel="Sort sessions"
                align="right"
                className="w-full sm:min-w-48"
                buttonClassName="text-xs font-black uppercase tracking-[0.08em]"
                menuClassName="w-52"
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-14 text-center text-slate-500">
            <Loader2 size={24} className="animate-spin text-[#d7b94a]" />
            <p className="text-sm font-semibold">Loading sessions...</p>
          </div>
        ) : error ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 border border-red-500/10 bg-red-500/[0.04] px-6 py-14 text-center" role="alert">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-300">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="text-sm font-black text-red-200">Session data unavailable</p>
              <p className="mt-1 text-xs font-medium text-red-300/65">{error}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="g3-table-scroll overflow-x-auto [scrollbar-color:rgba(255,213,85,.24)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#d7b94a]/25">
              <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
              <thead className="bg-[#14120c]">
                <tr>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">License Plate</th>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">Phone</th>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">Status</th>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">Check In</th>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">Check Out</th>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">Price</th>
                  <th className="border-b border-[#ffd555]/20 px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.1em] text-[#d7b94a]">Actions</th>
                </tr>
              </thead>
                <tbody>
                {pagination.items.map(session => (
                  <tr key={session._id} id={`session-row-${String(session._id).toLowerCase()}`} className="g3-data-row border-b border-white/[0.06] transition-colors duration-200 last:border-b-0 hover:bg-white/[0.025]">
                    <td className="g3-plate px-4 py-3 font-black tracking-[0.02em] text-white">{session.licensePlate}</td>
                    <td className="px-4 py-3 font-medium text-slate-400">{session.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${
                        session.status === 'active' ? 'border-blue-400/20 bg-blue-500/10 text-blue-300' :
                        session.status === 'completed' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300' :
                        'border-white/10 bg-white/5 text-slate-400'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${session.status === 'active' ? 'bg-blue-400' : session.status === 'completed' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        {session.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-400">{formatDate(session.checkInTime)}</td>
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-400">{formatDate(session.checkOutTime)}</td>
                    <td className="g3-price px-4 py-3 font-black tabular-nums text-[#d7b94a]">{formatPrice(session.totalPrice)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => selectManualSession(session)}
                        className="g3-action inline-flex items-center gap-1.5 rounded-lg border border-[#ffd555]/15 bg-[#ffd555]/[0.04] px-3 py-1.5 text-xs font-black text-[#e4c957] transition-all duration-200 hover:border-[#ffd555]/35 hover:bg-[#ffd555]/10 hover:text-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98]"
                      >
                        <ShieldCheck size={14} /> View Details
                      </button>
                    </td>
                  </tr>
                ))}
                {pagination.totalItems === 0 && (
                  <tr>
                    <td colSpan="7" className="px-6 py-16 text-center">
                      <Camera size={28} className="mx-auto text-slate-700" />
                      <p className="mt-3 text-sm font-bold text-slate-400">
                        {sessions.length === 0 ? 'No sessions found.' : 'No matching sessions.'}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {sessions.length === 0
                          ? 'Vehicle entry and exit records will appear here.'
                          : 'Try changing your search or filters.'}
                      </p>
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </div>

            {(!isAdminPage || pagination.totalItems > 0) && (
              <div className="g3-pagination flex flex-col gap-4 border-t border-white/[0.07] bg-[#0d0d0d] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs font-semibold text-slate-500">
                  {!isAdminPage ? `Page ${pagination.currentPage} of ${pagination.totalPages} \u00b7 ${pagination.totalItems} results` : <>Showing{' '}
                  <span className="text-slate-300">{pagination.startIndex + 1}-{pagination.endIndex}</span>
                  {' '}of <span className="text-slate-300">{pagination.totalItems}</span> sessions
                  {pagination.totalItems !== sessions.length && (
                    <span className="ml-1 text-slate-600">({sessions.length} total)</span>
                  )}
                  <span className="ml-2 text-[#d7b94a]/70">15 per page</span></>}
                </p>

                <nav className="flex items-center gap-1.5" aria-label="Session pagination">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(pagination.currentPage - 1)}
                    disabled={pagination.currentPage === 1}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-[#ffd555]/30 hover:bg-[#ffd555]/10 hover:text-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  {pageControls.map(page => (
                    typeof page === 'number' ? (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setCurrentPage(page)}
                        className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-black transition-colors focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 ${
                          page === pagination.currentPage
                            ? 'border-[#ffd555]/60 bg-[#d7b94a] text-[#080808]'
                            : 'border-white/10 text-slate-400 hover:border-[#ffd555]/30 hover:bg-[#ffd555]/10 hover:text-[#ffe58a]'
                        }`}
                        aria-current={page === pagination.currentPage ? 'page' : undefined}
                        aria-label={`Page ${page}`}
                      >
                        {page}
                      </button>
                    ) : (
                      <span key={page} className="grid h-9 min-w-7 place-items-center text-xs font-bold text-slate-600" aria-hidden="true">
                        ...
                      </span>
                    )
                  ))}

                  <button
                    type="button"
                    onClick={() => setCurrentPage(pagination.currentPage + 1)}
                    disabled={pagination.currentPage === pagination.totalPages}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-[#ffd555]/30 hover:bg-[#ffd555]/10 hover:text-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </nav>
              </div>
            )}
          </>
        )}
      </section>

      {/* Detail Modal */}
      {selectedSession && (
        <div className="g4-session-details fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="g4-session-dialog flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#ffd555]/15 bg-[#111111] text-white shadow-2xl">
            <div className="g4-session-header flex items-center justify-between border-b border-[#ffd555]/15 bg-[#14120c] p-6">
              <div>
                <h3 className="g4-session-title text-xl font-bold text-[#ffd555]">Session Details</h3>
                <p className="g4-session-subtitle text-sm text-white/40">Vehicle {selectedSession.licensePlate}</p>
              </div>
              <button 
                onClick={() => selectManualSession(null)}
                className="g4-session-dismiss flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-[#ffd555]/30 hover:bg-[#ffd555]/10 hover:text-[#ffd555]"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="g4-session-body p-6 grid grid-cols-2 gap-8">
              {/* Entry Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="g4-session-icon flex h-8 w-8 items-center justify-center rounded-full bg-[#ffd555]/15 text-[#ffd555]">
                    <Camera size={16} />
                  </div>
                  <h4 className="font-bold text-lg">Entry Record</h4>
                </div>
                <div className="g4-session-time rounded-xl border border-white/[0.08] bg-[#0b0b0b] p-4">
                  <p className="mb-1 text-sm text-white/40">Check In Time</p>
                  <p className="font-bold text-white">{formatDate(selectedSession.checkInTime)}</p>
                </div>
                <div className="g4-session-image group relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0b0b]">
                  {selectedSession.entryImage_url ? (
                    <img src={selectedSession.entryImage_url} alt="Entry" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-white/30">
                      <Camera size={32} className="mb-2 opacity-50" />
                      <span className="text-sm font-medium">No Entry Image</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Exit Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="g4-session-icon flex h-8 w-8 items-center justify-center rounded-full bg-[#ffd555]/15 text-[#ffd555]">
                    <Camera size={16} />
                  </div>
                  <h4 className="font-bold text-lg">Exit Record</h4>
                </div>
                <div className="g4-session-time rounded-xl border border-white/[0.08] bg-[#0b0b0b] p-4">
                  <p className="mb-1 text-sm text-white/40">Check Out Time</p>
                  <p className="font-bold text-white">{formatDate(selectedSession.checkOutTime)}</p>
                </div>
                <div className="g4-session-image group relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0b0b]">
                  {selectedSession.exitImage_url ? (
                    <img src={selectedSession.exitImage_url} alt="Exit" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-white/30">
                      <Camera size={32} className="mb-2 opacity-50" />
                      <span className="text-sm font-medium">No Exit Image</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="g4-session-footer flex justify-end border-t border-white/[0.07] bg-[#0d0d0d] p-6">
              <button 
                onClick={() => selectManualSession(null)}
                className="g4-session-close rounded-xl bg-[#ffd555] px-6 py-2.5 font-bold text-[#080808] transition-colors hover:bg-[#ffe58a]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Blurred Plate Resolution Modal */}
      <AIPlateResolutionModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        initialPlate={aiInitialPlate}
        initialImage={aiInitialImage}
        onSelectPlate={(selectedPlate) => {
          setSearchQuery(selectedPlate);
          setCurrentPage(1);
        }}
      />
    </div>
  );
}

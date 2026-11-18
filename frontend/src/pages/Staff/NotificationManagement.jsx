import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import StaffIssueReports from "../../components/notifications/StaffIssueReports";
import { useSocket } from "../../hooks/useSocket";
import { Dialog, DialogPanel, DialogTitle, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { vi } from "date-fns/locale";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe2,
  History,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  User,
  Users,
  X,
} from "lucide-react";
import { getAdminHistory, createNotification } from "../../services/notificationService";
import { searchUsers } from "../../services/userService";
import {
  getOperationalValue,
  getOperationalViewState,
  getResponseAvailability,
} from "../../utils/staffOperationalAvailability";
import "./components/staffNotificationManagement.css";
import { getPaginationPages } from "./sessionPagination.js";
import StaffNotificationAudience from "./components/StaffNotificationAudience";
import { STAFF_THEME } from "./components/staffTheme.js";
import { useLanguage } from "../../i18n/hooks/useLanguage";

const TABS = [
  { id: "feed", label: "Inbox" },
  { id: "compose", label: "Send Notification" },
  { id: "issues", label: "Issue Reports" },
];

const PRIORITIES = ["INFO", "SUCCESS", "WARNING", "ERROR", "SYSTEM"];

const PRIORITY_META = {
  INFO: { label: "INFO", bg: "bg-sky-500/10", color: "text-sky-400", border: "border-sky-500/30" },
  SUCCESS: { label: "SUCCESS", bg: "bg-emerald-500/10", color: "text-emerald-400", border: "border-emerald-500/30" },
  WARNING: { label: "WARNING", bg: "bg-amber-500/10", color: "text-amber-400", border: "border-amber-500/30" },
  ERROR: { label: "ERROR", bg: "bg-red-500/10", color: "text-red-400", border: "border-red-500/30" },
  SYSTEM: { label: "SYSTEM", bg: "bg-violet-500/10", color: "text-violet-400", border: "border-violet-500/30" },
};

export default function NotificationManagement({ role }) {
  const { t, language } = useLanguage();
  const isStaffView = role === 'staff';
  const [selectedTab, setSelectedTab] = useState("feed");
  const [params, setParams] = useSearchParams();
  const tab = params.has('incident') || params.get('view') === 'issues' ? 'issues' : selectedTab;
  const socket = useSocket();
  const setTab = value => {
    setSelectedTab(value);
    if (params.has('incident') || params.get('view') === 'issues') {
      const next = new URLSearchParams(params);
      next.delete('incident');
      next.delete('view');
      setParams(next);
    }
  };
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [apiStats, setApiStats] = useState({ totalSent: 0, success: 0, errors: 0 });
  const historyRequestRef = useRef(false);
  const historyState = getOperationalViewState({
    loading: historyLoading,
    error: historyError,
  });

  const fetchHistory = useCallback(async (page = 1, append = false) => {
    if (historyRequestRef.current) return;
    historyRequestRef.current = true;
    if (append) setHistoryLoadingMore(true);
    else setHistoryLoading(true);
    setHistoryError("");

    try {
      const res = await getAdminHistory({ page, limit: isStaffView ? 10 : 50 });
      const responseState = getResponseAvailability(
        res,
        t("staffNotifications.errors.historyUnavailable")
      );
      if (!responseState.isAvailable) {
        setHistoryList([]);
        setHistoryPage(1);
        setHistoryHasMore(false);
        setHistoryTotal(0);
        setApiStats({ totalSent: 0, success: 0, errors: 0 });
        setHistoryError(responseState.error);
        return;
      }

      const incoming = responseState.data || [];
      setHistoryList((current) => {
        if (!append) return incoming;
        const existingIds = new Set(current.map((item) => String(item._id || item.id)));
        return [
          ...current,
          ...incoming.filter((item) => !existingIds.has(String(item._id || item.id))),
        ];
      });
      const pagination = res.data.pagination || {};
      const totalPages = Number(pagination.totalPages || 1);
      setHistoryPage(page);
      setHistoryHasMore(page < totalPages);
      setHistoryTotal(Number(pagination.total || incoming.length));
      setApiStats(res.data.stats || { totalSent: 0, success: 0, errors: 0 });
    } catch (err) {
      console.error("Failed to fetch history:", err);
      setHistoryList([]);
      setHistoryPage(1);
      setHistoryHasMore(false);
      setHistoryTotal(0);
      setApiStats({ totalSent: 0, success: 0, errors: 0 });
      setHistoryError(err?.message || t("staffNotifications.errors.historyUnavailable"));
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
      historyRequestRef.current = false;
    }
  }, [isStaffView, t]);

  const refreshHistory = useCallback(() => {
    fetchHistory(1, false);
  }, [fetchHistory]);

  useEffect(() => {
    if (!socket || tab !== 'feed') return undefined;
    socket.on('notification:new', refreshHistory);
    if (!isStaffView) socket.on('notification:admin:new', refreshHistory);
    return () => {
      socket.off('notification:new', refreshHistory);
      if (!isStaffView) socket.off('notification:admin:new', refreshHistory);
    };
  }, [socket, tab, refreshHistory, isStaffView]);

  const loadMoreHistory = useCallback(() => {
    if (!historyHasMore || historyRequestRef.current) return;
    fetchHistory(historyPage + 1, true);
  }, [fetchHistory, historyHasMore, historyPage]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      refreshHistory();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [refreshHistory]);

  return (
    <div className={`staff-notification-management ${STAFF_THEME.page}`}>
      <div className="snm-content px-6 py-6 max-w-[1400px] mx-auto">
        <header className="snm-header flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="snm-title-line flex items-center gap-3">
              <div>
                <h1 className={STAFF_THEME.title}>{t("staffNotifications.title")}</h1>
              </div>
              {!isStaffView && <LiveBadge state={historyState} t={t} />}
            </div>
            <p className={STAFF_THEME.subtitle}>
              {isStaffView ? t("staffNotifications.subtitle.staff") : t("staffNotifications.subtitle.admin")}
            </p>
          </div>
          {isStaffView && <span className="snm-header-refresh-slot" data-inactive={tab !== "feed" || undefined} aria-hidden={tab !== "feed"} inert={tab !== "feed"}>
            <HistoryRefreshButton loading={historyLoading} loadingMore={historyLoadingMore} onRefresh={refreshHistory} t={t} />
          </span>}
        </header>

        {!isStaffView && <StatsRow stats={apiStats} state={historyState} t={t} />}

        <NotificationTabs activeTab={tab} onChange={setTab} isStaffView={isStaffView} t={t} />

        <section className="mt-6">
          {tab === "feed" && (
            <>
            {isStaffView && <StatsRow stats={apiStats} state={historyState} received t={t} />}
            <FeedTab
              notifications={historyList}
              loading={historyLoading}
              loadingMore={historyLoadingMore}
              error={historyError}
              state={historyState}
              hasMore={historyHasMore}
              total={historyTotal}
              onLoadMore={loadMoreHistory}
              onRefresh={refreshHistory} t={t} language={language}
              showRefresh={!isStaffView}
              paginated={isStaffView}
            />
            </>
          )}
          {tab === "compose" && <ComposeTab onSent={() => { setTab("feed"); refreshHistory(); }} t={t} />}
          {tab === "issues" && <StaffIssueReports role={role} />}
        </section>
      </div>
    </div>
  );
}

function NotificationTabs({ activeTab, onChange, isStaffView, t: translate }) {
  return (
        <nav aria-label={translate("staffNotifications.tabs.aria")} className="snm-tabs mt-6 flex flex-wrap gap-2 border-b border-white/10">
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              aria-pressed={activeTab === tabItem.id}
              onClick={() => onChange(tabItem.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tabItem.id
                  ? "border-[#ffd555] text-[#ffd555]"
                  : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {tabItem.id === 'feed' ? (isStaffView ? translate("staffNotifications.tabs.inbox") : translate("staffNotifications.tabs.liveFeed")) : translate("staffNotifications.tabs." + tabItem.id)}
            </button>
          ))}
        </nav>
  );
}

function LiveBadge({ state, t }) {
  const ok = state.status === "live";
  const loading = state.status === "loading";
  return (
    <span className={`snm-api-state inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border ${
      ok
        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
        : loading
          ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
          : "border-red-500/40 text-red-400 bg-red-500/10"
    }`}>
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-500 animate-pulse" : loading ? "bg-amber-500 animate-pulse" : "bg-red-500"}`} />
      <span className="snm-api-original">{ok ? t("staffNotifications.api.live") : loading ? t("common.loading") : t("staffNotifications.api.unavailable")}</span>
      <span className="snm-api-label hidden">{ok ? t("staffNotifications.api.available") : loading ? t("common.loading") : t("staffNotifications.api.unavailable")}</span>
    </span>
  );
}

function StatsRow({ stats, state, received = false, t }) {
  const iconMap = {
    history: History,
    success: CheckCircle2,
    error: AlertTriangle,
  };

  const cards = [
    { label: received ? t("staffNotifications.metrics.received") : t("staffNotifications.metrics.totalSent"), value: getOperationalValue(state, stats.totalSent), tone: "info", icon: "history" },
    { label: received ? t("staffNotifications.metrics.informational") : t("staffNotifications.metrics.sentSuccessfully"), value: getOperationalValue(state, stats.success), tone: "success", icon: "success" },
    { label: t("staffNotifications.metrics.warningsErrors"), value: getOperationalValue(state, stats.errors), tone: "error", icon: "error" },
  ];

  const toneMap = {
    info: "border-sky-500/30 text-sky-400 bg-sky-500/10",
    success: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    error: "border-red-500/30 text-red-400 bg-red-500/10",
  };

  return (
    <div className="snm-metrics grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((c) => {
        const IconComponent = iconMap[c.icon];
        return (
          <div key={c.label} data-tone={c.tone} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3)] transition-colors hover:border-white/15">
            <div className={`w-11 h-11 rounded-lg border ${toneMap[c.tone]} grid place-items-center`}>
              <IconComponent size={24} />
            </div>
            <div className="mt-4 text-4xl font-bold tracking-tight text-white">{c.value}</div>
            <div className="text-sm text-gray-400 mt-1">{c.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryRefreshButton({ loading, loadingMore, onRefresh, t }) {
  return (
        <button
          onClick={onRefresh}
          disabled={loading || loadingMore}
          aria-label={t("staffNotifications.actions.refreshHistory")}
          title={t("staffNotifications.actions.refreshHistory")}
          className="snm-refresh rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/60 transition hover:border-[#ffd555]/30 hover:bg-[#ffd555]/10 hover:text-[#ffe58a]"
        >
          <RefreshCw size={17} aria-hidden="true" className={`snm-refresh-icon hidden ${loading ? 'animate-spin' : ''}`} />
          <span className="snm-refresh-label">{loading ? t("common.loading") : t("common.refresh")}</span>
        </button>
  );
}

function FeedTab({
  notifications,
  loading,
  loadingMore,
  error,
  state,
  hasMore,
  total,
  onLoadMore,
  onRefresh,
  showRefresh = true,
  paginated = false,
  t,
  language = "en",
}) {
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const loadMoreRef = useRef(null);
  const [selectedNotification, setSelectedNotification] = useState(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (paginated || !target || !hasMore || loading || loadingMore) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [paginated, hasMore, loading, loadingMore, onLoadMore]);

  const [page, setPage] = useState(1);
  const [serverResult, setServerResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const scrollRef = useRef(null);
  const key = JSON.stringify([page, filter, query.trim(), retry]);
  const usesInitialPage = page === 1 && filter === 'ALL' && !query.trim() && retry === 0;
  const currentResult = serverResult?.key === key && serverResult?.source === notifications ? serverResult : null;

  useEffect(() => {
    // Reuse the existing unfiltered first-page request (and its global KPI stats).
    if (!paginated || loading || error || usesInitialPage) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await getAdminHistory({ page, limit: 10, priority: filter === 'ALL' ? undefined : filter, search: query.trim() || undefined });
        const availability = getResponseAvailability(response, t("staffNotifications.errors.historyUnavailable"));
        if (!availability.isAvailable) throw new Error(availability.error);
        const pagination = response.data.pagination;
        if (!Array.isArray(availability.data) || !pagination || !Number.isInteger(pagination.total) || pagination.total < 0 || !Number.isInteger(pagination.totalPages) || pagination.totalPages < 0) throw new Error(t("staffNotifications.errors.paginationUnavailable"));
        if (cancelled) return;
        const totalPages = Math.max(1, pagination.totalPages);
        if (page > totalPages) {
          if (totalPages === 1) setRetry(value => value + 1);
          setPage(totalPages); return;
        }
        setServerResult({ key, source: notifications, items: availability.data, total: pagination.total, totalPages, error: '' });
      } catch (failure) {
        if (!cancelled) setServerResult({ key, source: notifications, items: [], error: failure.message || t("staffNotifications.errors.historyUnavailable") });
      }
    }, query.trim() ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paginated, loading, error, usesInitialPage, page, filter, query, retry, key, notifications, t]);

  useEffect(() => {
    if (paginated && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [paginated, key, notifications]);

  const locallyFiltered = notifications
    .filter((m) => filter === "ALL" || m.priority === filter)
    .filter((m) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        m.title?.toLowerCase().includes(q) ||
        m.content?.toLowerCase().includes(q) ||
        m.targetType?.toLowerCase().includes(q)
      );
    });

  const filtered = paginated ? (usesInitialPage ? notifications : currentResult?.items || []) : locallyFiltered;
  const feedLoading = loading || (paginated && !usesInitialPage && !error && !currentResult);
  const feedError = error || (paginated ? currentResult?.error || '' : '');
  const resultTotal = paginated ? (usesInitialPage ? total : currentResult?.total) : total;
  const totalPages = paginated ? (usesInitialPage ? Math.max(1, Math.ceil(total / 10)) : currentResult?.totalPages || 1) : 1;
  const resultAvailable = !feedLoading && !feedError && Number.isInteger(resultTotal);
  const changeFilter = (value) => { setFilter(value); if (paginated) setPage(1); };
  const changeQuery = (value) => { setQuery(value); if (paginated) setPage(1); };

  return (
    <div data-paginated={paginated} className="snm-feed space-y-4">
      <div className="snm-toolbar flex flex-wrap items-center gap-2">
        {paginated ? (
          <Listbox value={filter} onChange={changeFilter}>
            <ListboxButton className="snm-severity-select" aria-label={`${t("staffNotifications.filters.severity")}: ${filter === "ALL" ? t("staffNotifications.filters.allSeverities") : filter}`}>
              <span>{filter === "ALL" ? t("staffNotifications.filters.allSeverities") : filter}</span><ChevronDown size={14} aria-hidden="true" />
            </ListboxButton>
            <ListboxOptions anchor="bottom start" className="snm-severity-options">
              {["ALL", ...PRIORITIES].map(priority => (
                <ListboxOption key={priority} value={priority} className="snm-severity-option">
                  {({ selected }) => <><span>{priority === "ALL" ? t("staffNotifications.filters.allSeverities") : priority}</span>{selected && <Check size={14} aria-hidden="true" />}</>}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Listbox>
        ) : <div className="snm-priority-filters contents">
        <FilterChip label={t("staffNotifications.filters.all")} active={filter === "ALL"} onClick={() => changeFilter("ALL")} />
        {PRIORITIES.map((p) => (
          <FilterChip key={p} label={p} active={filter === p} onClick={() => changeFilter(p)} tone={p} />
        ))}
        </div>}
        <div className="snm-toolbar-spacer flex-1" />
        <div className="snm-search-actions contents">
        <input
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          aria-label={t("staffNotifications.filters.searchHistory")}
          placeholder={t("staffNotifications.filters.searchPlaceholder")}
          className="w-72 max-w-full rounded-full border border-white/[0.08] bg-[#111] px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#ffd555]/50 focus:ring-1 focus:ring-[#ffd555]/30"
        />
        {showRefresh && <HistoryRefreshButton loading={loading} loadingMore={loadingMore} onRefresh={onRefresh} t={t} />}
        </div>
      </div>

      <div className="snm-stream overflow-hidden rounded-xl border border-white/[0.07] bg-[#111111] shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="font-semibold text-white">{paginated ? t("staffNotifications.feed.received") : t("staffNotifications.feed.liveEvents")}</div>
          <div className="text-xs text-gray-400">
            {paginated ? (resultAvailable ? t("staffNotifications.feed.shown", { count: filtered.length }) : feedLoading ? t("staffNotifications.feed.loading") : t("staffNotifications.feed.countUnavailable")) : state.isAvailable
              ? `${filtered.length} shown · ${notifications.length}/${total} loaded`
              : t("staffNotifications.feed.countUnavailable")}
          </div>
        </div>
        <ul ref={paginated ? scrollRef : undefined} aria-busy={feedLoading} className="snm-event-list divide-y divide-white/5">
          {feedError && !feedLoading && (
            <li className="px-5 py-10 text-center text-red-300 text-sm" role="alert">
              {t("staffNotifications.feed.historyUnavailable")} {feedError}
              {paginated && <button type="button" className="snm-feed-retry" onClick={() => usesInitialPage || error ? onRefresh() : setRetry(value => value + 1)}>{t("common.retry")}</button>}
            </li>
          )}
          {filtered.length === 0 && !feedLoading && !feedError && (
            <li className="px-5 py-10 text-center text-gray-500 text-sm">{t("staffNotifications.feed.noMatching")}</li>
          )}
          {feedLoading && (paginated || filtered.length === 0) && (
            <li className="px-5 py-10 text-center text-gray-500 text-sm">{t("staffNotifications.feed.loadingHistory")}</li>
          )}
          {(!paginated || (!feedLoading && !feedError)) && filtered.map((m) => (
            <MessageRow key={m._id || m.id} m={m} onOpen={paginated ? () => setSelectedNotification(m) : undefined} t={t} language={language} />
          ))}
          {!paginated && <li ref={loadMoreRef} className="px-5 py-5 text-center">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2 text-xs text-emerald-400">
                <Loader2 className="animate-spin" size={15} />
                {t("staffNotifications.feed.loadingOlder")}
              </span>
            ) : hasMore ? (
              <span className="text-xs text-gray-600">{t("staffNotifications.feed.scrollOlder")}</span>
            ) : notifications.length > 0 ? (
              <span className="text-xs text-gray-600">{t("staffNotifications.feed.allLoaded")}</span>
            ) : null}
          </li>}
        </ul>
        {paginated && <nav className="snm-feed-pagination" aria-label={t("staffNotifications.feed.pagesAria")}>
          <span>{resultAvailable ? t("staffNotifications.feed.pageOf", { page, pages: totalPages, total: new Intl.NumberFormat(language === "vi" ? "vi-VN" : "en-US").format(resultTotal) }) : feedLoading ? t("staffNotifications.feed.loading") : t("staffNotifications.feed.resultsUnavailable")}</span>
          <div className="snm-feed-page-controls">
            <button type="button" data-nav disabled={!resultAvailable || page <= 1} onClick={() => setPage(page - 1)}><ArrowLeft size={14} aria-hidden="true" />{t("staffNotifications.feed.previous")}</button>
            {resultAvailable && getPaginationPages(Math.max(2, Math.min(page, totalPages - 1)), totalPages).map(number => typeof number === 'number'
              ? <button type="button" key={number} aria-current={number === page ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button>
              : <span key={number} aria-hidden="true">...</span>)}
            <button type="button" data-nav disabled={!resultAvailable || page >= totalPages} onClick={() => setPage(page + 1)}>{t("common.next")}<ArrowRight size={14} aria-hidden="true" /></button>
          </div>
        </nav>}
      </div>
      <NotificationDrawer notification={selectedNotification} onClose={() => setSelectedNotification(null)} t={t} language={language} />
    </div>
  );
}

function FilterChip({ label, active, onClick, tone }) {
  const toneCls = tone ? PRIORITY_META[tone] : null;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      data-priority={tone || "ALL"}
      className={`snm-filter-chip text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? toneCls
            ? `${toneCls.bg} ${toneCls.color} ${toneCls.border}`
            : "border-[#ffd555]/40 bg-[#ffd555]/15 text-[#ffd555]"
          : "border-white/10 text-gray-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function MessageRow({ m, onOpen, t, language = "en" }) {
  const meta = PRIORITY_META[m.priority] || PRIORITY_META.INFO;
  const targetLabel = m.targetType === "ALL_USERS" ? t("staffNotifications.drawer.wholeSystem") :
                      m.targetType === "ROLE_BASED" ? t("staffNotifications.drawer.role", { roles: (m.targetRoles || []).join(", ") }) :
                      m.targetType === "MULTI_USER" ? t("staffNotifications.drawer.users", { count: m.targetUsers?.length || 0 }) :
                      m.targetType === "SINGLE_USER" ? t("staffNotifications.drawer.oneUser") : t("staffNotifications.drawer.system");

  if (onOpen) return (
    <li className="snm-compact-event" data-priority={m.priority || "INFO"}>
      <button type="button" className="snm-event-open" onClick={onOpen} aria-label={t("staffNotifications.drawer.view", { title: m.title || t("staffNotifications.drawer.untitled") })} aria-haspopup="dialog">
        <span className="snm-event-message">
          <span className="snm-event-title">{m.title || t("staffNotifications.drawer.untitled")}</span>
          <span className="snm-event-preview">{m.content || t("staffNotifications.drawer.noContent")}</span>
        </span>
        <span className="snm-event-severity">{meta.label}</span>
        <span className="snm-event-recipient" title={targetLabel}><span className="sr-only">{t("staffNotifications.drawer.recipient")}: </span>{targetLabel}</span>
        <span className="snm-event-status"><span className="sr-only">{t("staffNotifications.drawer.status")}: </span>{m.isRevoked ? t("staffNotifications.drawer.revoked") : m.status || t("staffNotifications.drawer.sent")}</span>
        <time className="snm-event-time" dateTime={validNotificationDate(m.createdAt)?.toISOString()} title={notificationDate(m.createdAt, language, t)}>{validNotificationDate(m.createdAt) ? formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: language === "vi" ? vi : enUS }) : t("staffNotifications.drawer.timeUnavailable")}</time>
      </button>
    </li>
  );

  return (
    <li data-priority={m.priority || "INFO"} className="snm-event px-5 py-4 flex items-start gap-4 bg-white/[0.02]">
      <div className={`w-10 h-10 rounded-lg border ${meta.bg} ${meta.color} ${meta.border} grid place-items-center text-xs font-bold shrink-0`}>
        {m.priority ? m.priority[0] : "I"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-100">{m.title}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.bg} ${meta.color} border ${meta.border}`}>
            {meta.label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-gray-400">
            {m.type || "SYSTEM"}
          </span>
        </div>
        <div className="text-sm text-gray-400 mt-1">{m.content}</div>
        <div className="text-xs text-gray-500 mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span>{t("staffNotifications.drawer.user")} {targetLabel}</span>
          <span>-</span>
          <span>{t("staffNotifications.drawer.statusPrefix")} {m.status || t("staffNotifications.drawer.sent")}</span>
          <span>-</span>
          <span>{m.createdAt ? formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: language === "vi" ? vi : enUS }) : t("staffNotifications.drawer.justNow")}</span>
        </div>
      </div>
    </li>
  );
}

function validNotificationDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function notificationDate(value, language = "en", t = value => value) {
  return validNotificationDate(value)?.toLocaleString(language === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "long" }) || t("staffNotifications.drawer.timeUnavailable");
}

function NotificationDrawer({ notification: m, onClose, t, language = "en" }) {
  const scope = useLocation().pathname.startsWith('/admin/') ? 'admin' : 'staff';
  // Unpopulated database references belong in Technical Details, not the summary.
  const userLabel = (user) => typeof user === "object" && user
    ? [user.username || user.fullName || user.name, user.email].filter(Boolean).join(", ") || t("staffNotifications.drawer.userUnavailable")
    : t("staffNotifications.drawer.userUnavailable");
  const recipient = m?.targetType === "ALL_USERS" ? t("staffNotifications.drawer.allUsers")
    : m?.targetType === "ROLE_BASED" ? (m.targetRoles?.join(", ") || t("staffNotifications.drawer.selectedRoles"))
      : m?.targetUsers?.length ? m.targetUsers.map(userLabel).join("; ") : t("staffNotifications.drawer.inbox");
  return (
    <Dialog open={Boolean(m)} onClose={onClose} className="snm-detail-dialog">
      <div className="snm-detail-backdrop" aria-hidden="true" />
      <div className="snm-detail-position">
        <DialogPanel className="snm-detail-panel">
          {m && <>
            <header>
              <div className="snm-detail-heading">
                <DialogTitle>{m.title || t("staffNotifications.drawer.untitled")}</DialogTitle>
                <span className="snm-detail-severity" data-priority={m.priority || "INFO"}>{m.priority || "INFO"}</span>
              </div>
              <button type="button" onClick={onClose} aria-label={t("staffNotifications.drawer.close")}><X size={18} /></button>
            </header>
            <div className="snm-detail-body">
              <section className="snm-detail-content" aria-label={t("staffNotifications.drawer.notificationMessage")}>
                <p className="snm-detail-section-label">{t("staffNotifications.drawer.message")}</p>
                <p className="snm-detail-message">{m.content || t("staffNotifications.drawer.noContent")}</p>
                {m.metadata?.eventType === 'STAFF_INCIDENT' && /^[a-f0-9]{24}$/i.test(m.metadata.incidentId || '') && (
                  <Link className="text-sm font-semibold text-amber-300 underline" onClick={onClose}
                    to={`/${scope}/notifications?incident=${m.metadata.incidentId}`}>{t("staffNotifications.drawer.openIssue")}</Link>
                )}
              </section>
              <dl className="snm-detail-info">
                {[
                  [t("staffNotifications.drawer.recipient"), recipient, User],
                  [t("staffNotifications.drawer.status"), m.isRevoked ? t("staffNotifications.drawer.revoked") : m.status || t("staffNotifications.drawer.sent"), CheckCircle2],
                  [t("staffNotifications.drawer.type"), m.type || t("staffNotifications.drawer.system"), Info],
                  [t("staffNotifications.drawer.sentAt"), notificationDate(m.createdAt, language), History],
                ].map(([label, value, Icon]) => <div key={label}><dt><Icon size={14} aria-hidden="true" />{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </div>
          </>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function ComposeTab({ onSent, t }) {
  let isStaffCompose = false;
  try { isStaffCompose = JSON.parse(sessionStorage.getItem('valo_user') || '{}').role === 'staff'; } catch { /* Keep other role presentation unchanged. */ }
  const [audienceKind, setAudienceKind] = useState("single");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState(["customer"]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("INFO");
  const [toast, setToast] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const audienceOptions = [
    { id: "single", label: t("staffNotifications.compose.audience.single"), description: t("staffNotifications.compose.audience.singleHint"), icon: User },
    { id: "multi", label: t("staffNotifications.compose.audience.multi"), description: t("staffNotifications.compose.audience.multiHint"), icon: Users },
    { id: "role", label: t("staffNotifications.compose.audience.role"), description: t("staffNotifications.compose.audience.roleHint"), icon: ShieldCheck },
    { id: "all", label: t("staffNotifications.compose.audience.all"), description: t("staffNotifications.compose.audience.allHint"), icon: Globe2 },
  ];
  const audienceSummary =
    audienceKind === "single"
      ? selectedUsers[0]?.username || t("staffNotifications.compose.summary.noUser")
      : audienceKind === "multi"
        ? t("staffNotifications.compose.summary.users", { count: selectedUsers.length })
        : audienceKind === "role"
          ? selectedRoles.map((role) => role[0].toUpperCase() + role.slice(1)).join(", ") || t("staffNotifications.compose.summary.noRole")
          : t("staffNotifications.compose.summary.allAccounts");
  const audienceReady =
    audienceKind === "all" ||
    (audienceKind === "role" && selectedRoles.length > 0) ||
    (audienceKind === "single" && selectedUsers.length === 1) ||
    (audienceKind === "multi" && selectedUsers.length >= 2);
  const messageReady = Boolean(title.trim() && message.trim());
  const canSubmit = audienceReady && messageReady && !isSubmitting;

  function changeAudience(nextAudience) {
    setAudienceKind(nextAudience);
    setToast(null);
    setSelectedUsers((current) => {
      if (nextAudience === "all") return [];
      if (nextAudience === "role") return [];
      if (nextAudience === "single") return current.slice(0, 1);
      return current;
    });
  }

  async function submit() {
    setToast(null);

    let targetType = "ALL_USERS";
    let targetUsers = [];
    let targetRoles = [];

    if (audienceKind === "role") {
      if (selectedRoles.length === 0) {
        return setToast(t("staffNotifications.errors.selectRole"));
      }
      targetType = "ROLE_BASED";
      targetRoles = selectedRoles;
    } else if (audienceKind === "multi") {
      if (selectedUsers.length < 2) {
        return setToast(t("staffNotifications.errors.selectUsers"));
      }
      targetType = "MULTI_USER";
      targetUsers = selectedUsers.map((u) => u._id);
    } else if (audienceKind === "single") {
      targetType = "SINGLE_USER";
      if (selectedUsers.length === 0) {
        return setToast(t("staffNotifications.errors.selectUser"));
      }
      targetUsers = [selectedUsers[0]._id];
    }

    if (!title.trim() || !message.trim()) {
      return setToast(t("staffNotifications.errors.required"));
    }

    setIsSubmitting(true);
    const payload = {
      title: title.trim(),
      content: message.trim(),
      type: "SYSTEM",
      priority,
      targetType,
      targetUsers,
      ...(targetType === "ROLE_BASED" ? { targetRoles } : {}),
    };

    try {
      const res = await createNotification(payload);
      if (res.ok) {
        setToast(res.data?.message || t("staffNotifications.compose.sent"));
        setTimeout(onSent, 1000);
      } else {
        setToast(t("staffNotifications.errors.api", { message: res.data?.message || JSON.stringify(res.data?.errors) || t("staffNotifications.errors.unknown") }));
      }
    } catch {
      setToast(t("staffNotifications.errors.apiConnection"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const messageSection = (
          <section className="snm-message-section">
            <div className="snm-message-heading">
            <StepHeading number="2" title={isStaffCompose ? t("staffNotifications.compose.message") : t("staffNotifications.compose.writeMessage")} description={t("staffNotifications.compose.messageHint")} />
              {isStaffCompose && <Listbox value={priority} onChange={setPriority}>
                <ListboxButton className="snm-priority-select" data-priority={priority} aria-label={t("staffNotifications.compose.priority")}>
                  <span className="snm-priority-dot" aria-hidden="true" /><span>{priority}</span><ChevronDown size={14} aria-hidden="true" />
                </ListboxButton>
                <ListboxOptions anchor={{ to: 'bottom end', gap: 6, padding: 12 }} className="snm-composer-options snm-priority-menu">
                  {PRIORITIES.map(item => <ListboxOption key={item} value={item} data-priority={item} className="snm-composer-option">
                    {({ selected }) => <><span className="snm-priority-dot" aria-hidden="true" /><span>{PRIORITY_META[item].label}</span>{selected && <Check size={14} aria-hidden="true" />}</>}
                  </ListboxOption>)}
                </ListboxOptions>
              </Listbox>}
            </div>
            <div className="snm-message-fields mt-4 space-y-4">
              <Field label={t("staffNotifications.compose.title")} hint={`${title.length}/200`}>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  placeholder={t("staffNotifications.compose.titlePlaceholder")}
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#0b0b0b] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#ffd555]/50 focus:ring-4 focus:ring-[#ffd555]/[0.06]"
                />
              </Field>
              <Field label={t("staffNotifications.compose.content")} hint={`${message.length}/2000`}>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={2000}
                  rows={6}
                  placeholder={t("staffNotifications.compose.contentPlaceholder")}
                  className="w-full resize-y rounded-xl border border-white/10 bg-[#0b0b0b] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-[#ffd555]/50 focus:ring-4 focus:ring-[#ffd555]/[0.06]"
                />
              </Field>
            </div>
          </section>
  );

  return (
    <div data-compact-composer={isStaffCompose} className="snm-compose max-w-6xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111111] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-3 border-b border-[#ffd555]/15 bg-gradient-to-r from-[#ffd555]/[0.06] to-transparent px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#ffd555]/20 bg-[#ffd555]/10 text-[#ffd555]">
            <BellRing size={19} />
          </span>
          <div>
            <h2 className="font-semibold text-white">{t("staffNotifications.compose.create")}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t("staffNotifications.compose.createHint")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={`h-2 w-2 rounded-full ${audienceReady ? "bg-emerald-400" : "bg-gray-600"}`} />
          {t("staffNotifications.compose.audienceLabel")}
          <span className="text-gray-700">/</span>
          <span className={`h-2 w-2 rounded-full ${messageReady ? "bg-emerald-400" : "bg-gray-600"}`} />
          {t("staffNotifications.compose.message")}
        </div>
      </div>

      <div className="snm-compose-grid grid lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.7fr)]">
        <div className="snm-compose-fields space-y-7 p-5 sm:p-7 lg:border-r lg:border-white/5">
          <section>
            <StepHeading number="1" title={isStaffCompose ? t("staffNotifications.compose.audienceLabel") : t("staffNotifications.compose.chooseAudience")} description={t("staffNotifications.compose.audienceHint")} />
            {isStaffCompose ? <StaffNotificationAudience
              kind={audienceKind} options={audienceOptions} onKindChange={changeAudience}
              users={selectedUsers} onUsersChange={setSelectedUsers}
              roles={selectedRoles} onRolesChange={setSelectedRoles}
            /> : <>
            <div className="snm-audience-segments mt-4 grid gap-3 sm:grid-cols-2">
              {audienceOptions.map((option) => {
                const Icon = option.icon;
                const active = audienceKind === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={active}
                    onClick={() => changeAudience(option.id)}
                    className={`snm-audience-option group flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      active
                        ? "border-[#ffd555]/50 bg-[#ffd555]/10"
                        : "border-white/10 bg-[#101010] hover:border-white/20 hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className={`snm-audience-icon grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                      active ? "bg-[#ffd555]/15 text-[#ffd555]" : "bg-white/5 text-gray-500"
                    }`}>
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`snm-audience-title block text-sm font-medium ${active ? "text-[#ffe58a]" : "text-gray-200"}`}>{option.label}</span>
                      <span className="snm-audience-description mt-0.5 block text-xs text-gray-500">{option.description}</span>
                    </span>
                    <span className={`snm-audience-check grid h-5 w-5 place-items-center rounded-full border ${
                      active ? "border-[#ffd555] bg-[#ffd555] text-black" : "border-white/15 text-transparent"
                    }`}>
                      <Check size={12} strokeWidth={3} />
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              {audienceKind === "role" && (
                <div className="snm-role-selection rounded-xl border border-white/10 bg-[#101010] p-4">
                  <p className="text-xs font-medium text-gray-300">{t("staffNotifications.compose.selectRoles")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["staff", "customer"].map((role) => {
                      const active = selectedRoles.includes(role);
                      return (
                        <button
                          type="button"
                          key={role}
                          aria-pressed={active}
                          onClick={() => setSelectedRoles((current) =>
                            active ? current.filter((item) => item !== role) : [...current, role]
                          )}
                          className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm capitalize transition-colors ${
                            active
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-white/10 text-gray-400 hover:border-white/20"
                          }`}
                        >
                          <span className={`snm-role-check grid h-4 w-4 place-items-center rounded border ${active ? "border-amber-400 bg-amber-400 text-black" : "border-white/20"}`}>
                            {active && <Check size={10} strokeWidth={3} />}
                          </span>
                          {role}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
                    <Info size={13} />
                    {t("staffNotifications.compose.rolesHint")}
                  </p>
                </div>
              )}
              {(audienceKind === "single" || audienceKind === "multi") && (
                <UserPicker multi={audienceKind === "multi"} value={selectedUsers} onChange={setSelectedUsers} t={t} />
              )}
              {audienceKind === "all" && (
                <div className="snm-system-warning flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
                  <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={18} />
                  <div>
                    <p className="text-sm font-medium text-amber-300">{t("staffNotifications.compose.systemWide")}</p>
                    <p className="mt-1 text-xs leading-5 text-amber-200/60">
                      {t("staffNotifications.compose.systemWideHint")}
                    </p>
                  </div>
                </div>
              )}
            </div>
            </>}
          </section>

          {!isStaffCompose && messageSection}
        </div>

        <aside className="snm-preview-column space-y-6 bg-[#0d0d0d] p-5 sm:p-7">
          {isStaffCompose && messageSection}
          {!isStaffCompose && <section>
            <StepHeading number="3" title={t("staffNotifications.compose.priority")} description={t("staffNotifications.compose.priorityHint")} compact />
            <div className="snm-priority-options mt-4 grid grid-cols-2 gap-2">
              {PRIORITIES.map((item) => {
                const meta = PRIORITY_META[item];
                return (
                  <button
                    type="button"
                    key={item}
                    data-priority={item}
                    aria-pressed={priority === item}
                    onClick={() => setPriority(item)}
                    className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors ${
                      priority === item
                        ? `${meta.bg} ${meta.color} ${meta.border}`
                        : "border-white/10 bg-[#0D0D0D] text-gray-500 hover:border-white/20 hover:text-gray-300"
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </section>}

          <section className="snm-review-preview">
            <p className="snm-preview-heading text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{isStaffCompose ? t("staffNotifications.compose.livePreview") : t("staffNotifications.compose.preview")}</p>
            <div className="snm-preview mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0D]">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                <span className="text-xs text-gray-500">{t("staffNotifications.compose.recipientInbox")}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_META[priority].bg} ${PRIORITY_META[priority].color} ${PRIORITY_META[priority].border}`}>
                  {priority}
                </span>
              </div>
              <div className="flex gap-3 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#ffd555]/15 text-[#ffd555]">
                  <BellRing size={18} />
                </span>
                <div className="min-w-0">
                  <p className={`break-words text-sm font-semibold ${title.trim() ? "text-gray-100" : "text-gray-600"}`}>
                    {title.trim() || t("staffNotifications.compose.previewTitle")}
                  </p>
                  <p className={`mt-1 whitespace-pre-wrap break-words text-xs leading-5 ${message.trim() ? "text-gray-400" : "text-gray-700"}`}>
                    {message.trim() || t("staffNotifications.compose.previewContent")}
                  </p>
                  {!isStaffCompose && <p className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-600">
                    <Users size={12} />
                    {audienceSummary}
                  </p>}
                </div>
              </div>
            </div>
            {isStaffCompose && <p className="snm-recipient-summary"><Users size={14} aria-hidden="true" />
              {audienceKind === 'single' || audienceKind === 'multi'
                ? t("staffNotifications.compose.recipientsSelected", { count: selectedUsers.length })
                : audienceKind === 'role' ? `${t("staffNotifications.compose.recipientRoles")}: ${audienceSummary}` : audienceSummary}
            </p>}
          </section>

          {toast && (
            <div role="status" className={`snm-feedback flex gap-2.5 rounded-xl border p-3 text-xs leading-5 ${
              /error|required|select|at least|connection/i.test(toast)
                ? "border-red-500/25 bg-red-500/[0.07] text-red-300"
                : "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300"
            }`}>
              {/error|required|select|at least|connection/i.test(toast)
                ? <AlertTriangle className="mt-0.5 shrink-0" size={15} />
                : <CheckCircle2 className="mt-0.5 shrink-0" size={15} />}
              <span>{toast}</span>
            </div>
          )}

          <div className="snm-compose-action border-t border-white/5 pt-5">
            {!canSubmit && !isSubmitting && (
              <p className="mb-3 text-center text-[11px] text-gray-600">
                {t("staffNotifications.compose.completeHint")}
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="snm-send flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] px-5 text-sm font-black text-[#080808] shadow-[0_10px_30px_rgba(255,213,85,0.14)] transition hover:bg-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-gray-600 disabled:shadow-none"
            >
              {isSubmitting ? (
                <><Loader2 className="animate-spin" size={17} />{t("staffNotifications.compose.sending")}</>
              ) : (
                <><Send size={17} />{t("staffNotifications.compose.send")}</>
              )}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StepHeading({ number, title, description, compact = false }) {
  return (
    <div className="snm-step-heading flex items-start gap-3">
      <span className={`grid shrink-0 place-items-center rounded-lg bg-[#ffd555]/10 text-xs font-bold text-[#ffd555] ${compact ? "h-7 w-7" : "h-8 w-8"}`}>
        {number}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        {hint && <span className="text-[11px] tabular-nums text-gray-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function UserPicker({ multi, value, onChange, t }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    let active = true;
    const fetchUsers = async () => {
      setLoading(true);
      setSearchError("");
      try {
        const res = await searchUsers(q);
        if (!active) return;
        const responseState = getResponseAvailability(
          res,
          t("staffNotifications.errors.userSearchUnavailable")
        );
        if (!responseState.isAvailable) {
          setResults([]);
          setSearchError(responseState.error);
          return;
        }
        setResults(responseState.data || []);
      } catch (err) {
        console.error(err);
        if (active) {
          setResults([]);
          setSearchError(err?.message || t("staffNotifications.errors.userSearchUnavailable"));
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchUsers, 300);
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [q, t]);

  function toggle(user) {
    if (!multi) return onChange([user]);
    const exists = value.find((x) => x._id === user._id);
    onChange(exists ? value.filter((x) => x._id !== user._id) : [...value, user]);
  }

  return (
    <div className="snm-user-picker overflow-hidden rounded-xl border border-white/10 bg-[#101010]">
      <div className="border-b border-white/5 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={16} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t("staffNotifications.compose.userPicker.searchPlaceholder")}
            className="h-11 w-full rounded-lg border border-white/10 bg-[#111] pl-10 pr-10 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#ffd555]/40"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"
              aria-label={t("staffNotifications.compose.userPicker.clear")}
            >
              <X size={15} />
            </button>
          )}
        </div>
        {value.length > 0 && (
          <div className="snm-selected-recipients mt-3 flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {value.map((user) => (
                <span key={user._id} className="snm-recipient-chip inline-flex max-w-full items-center gap-1.5 rounded-md bg-[#ffd555]/10 px-2 py-1 text-xs text-[#ffe58a]">
                  <span className="max-w-40 truncate">{user.username}</span>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((item) => item._id !== user._id))}
                    className="text-[#d7b94a] hover:text-[#ffe58a]"
                    aria-label={t("staffNotifications.compose.userPicker.remove", { username: user.username })}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            {multi && (
              <button type="button" onClick={() => onChange([])} className="shrink-0 py-1 text-[11px] text-gray-600 hover:text-gray-300">
                {t("staffNotifications.compose.userPicker.clear")}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 text-[11px] text-gray-600">
        <span>{multi ? t("staffNotifications.compose.userPicker.minUsers") : t("staffNotifications.compose.userPicker.oneUser")}</span>
        <span>{t("staffNotifications.compose.userPicker.selected", { count: value.length })}</span>
      </div>

      <ul className="scrollbar-hidden max-h-64 overflow-y-auto p-2">
        {loading && (
          <li className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-gray-500">
            <Loader2 className="animate-spin" size={15} />
            {t("staffNotifications.compose.userPicker.searching")}
          </li>
        )}
        {!loading && searchError && (
          <li className="px-3 py-8 text-center text-xs text-red-300" role="alert">
            {t("staffNotifications.compose.userPicker.unavailable")} {searchError}
          </li>
        )}
        {!loading && !searchError && results.length === 0 && (
          <li className="px-3 py-8 text-center text-xs text-gray-500">{t("staffNotifications.compose.userPicker.none")}</li>
        )}
        {!loading && results.map((user) => {
          const selected = value.some((item) => item._id === user._id);
          const initials = (user.username || user.email || "U").slice(0, 2).toUpperCase();
          return (
            <li key={user._id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(user)}
                className={`snm-recipient-option flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selected ? "bg-[#ffd555]/10" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className={`snm-recipient-avatar grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                  selected ? "bg-[#ffd555]/20 text-[#ffd555]" : "bg-white/5 text-gray-500"
                }`}>
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`snm-recipient-name block truncate text-sm font-medium ${selected ? "text-[#ffe58a]" : "text-gray-200"}`}>
                    {user.username}
                  </span>
                  <span className="snm-recipient-email block truncate text-xs text-gray-600">{user.email}</span>
                </span>
                <span data-role={user.role} className="snm-recipient-role rounded-md border border-white/10 px-2 py-0.5 text-[10px] uppercase text-gray-500">
                  {user.role}
                </span>
                <span className={`snm-recipient-check grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  selected ? "border-[#ffd555] bg-[#ffd555] text-black" : "border-white/15 text-transparent"
                }`}>
                  <Check size={11} strokeWidth={3} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

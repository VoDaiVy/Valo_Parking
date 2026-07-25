import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Globe2,
  History,
  Info,
  Loader2,
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
import { STAFF_THEME } from "./components/staffTheme.js";

const TABS = [
  { id: "feed", label: "Live Feed" },
  { id: "compose", label: "Send Notification" },
];

const PRIORITIES = ["INFO", "SUCCESS", "WARNING", "ERROR", "SYSTEM"];

const PRIORITY_META = {
  INFO: { label: "INFO", bg: "bg-sky-500/10", color: "text-sky-400", border: "border-sky-500/30" },
  SUCCESS: { label: "SUCCESS", bg: "bg-emerald-500/10", color: "text-emerald-400", border: "border-emerald-500/30" },
  WARNING: { label: "WARNING", bg: "bg-amber-500/10", color: "text-amber-400", border: "border-amber-500/30" },
  ERROR: { label: "ERROR", bg: "bg-red-500/10", color: "text-red-400", border: "border-red-500/30" },
  SYSTEM: { label: "SYSTEM", bg: "bg-violet-500/10", color: "text-violet-400", border: "border-violet-500/30" },
};

export default function NotificationManagement() {
  const [tab, setTab] = useState("feed");
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
      const res = await getAdminHistory({ page, limit: 50 });
      const responseState = getResponseAvailability(
        res,
        "Notification history is unavailable."
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
      setHistoryError(err?.message || "Notification history is unavailable.");
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
      historyRequestRef.current = false;
    }
  }, []);

  const refreshHistory = useCallback(() => {
    fetchHistory(1, false);
  }, [fetchHistory]);

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
    <div className={STAFF_THEME.page}>
      <div className="px-6 py-6 max-w-[1400px] mx-auto">
        <header className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <div>
                <h1 className={STAFF_THEME.title}>Notification Management</h1>
              </div>
              <LiveBadge state={historyState} />
            </div>
            <p className={STAFF_THEME.subtitle}>
              Send notifications to the whole system or selected users.
            </p>
          </div>
        </header>

        <StatsRow stats={apiStats} state={historyState} />

        <nav className="mt-6 flex flex-wrap gap-2 border-b border-white/10">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? "border-[#ffd555] text-[#ffd555]"
                  : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className="mt-6">
          {tab === "feed" && (
            <FeedTab
              notifications={historyList}
              loading={historyLoading}
              loadingMore={historyLoadingMore}
              error={historyError}
              state={historyState}
              hasMore={historyHasMore}
              total={historyTotal}
              onLoadMore={loadMoreHistory}
              onRefresh={refreshHistory}
            />
          )}
          {tab === "compose" && <ComposeTab onSent={() => { setTab("feed"); refreshHistory(); }} />}
        </section>
      </div>
    </div>
  );
}

function LiveBadge({ state }) {
  const ok = state.status === "live";
  const loading = state.status === "loading";
  return (
    <span className={`inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border ${
      ok
        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
        : loading
          ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
          : "border-red-500/40 text-red-400 bg-red-500/10"
    }`}>
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-500 animate-pulse" : loading ? "bg-amber-500 animate-pulse" : "bg-red-500"}`} />
      {ok ? "LIVE - API" : loading ? "Loading API" : "API unavailable"}
    </span>
  );
}

function StatsRow({ stats, state }) {
  const iconMap = {
    history: History,
    success: CheckCircle2,
    error: AlertTriangle,
  };

  const cards = [
    { label: "Total Sent (History)", value: getOperationalValue(state, stats.totalSent), tone: "info", icon: "history" },
    { label: "Sent Successfully", value: getOperationalValue(state, stats.success), tone: "success", icon: "success" },
    { label: "Warnings & Errors", value: getOperationalValue(state, stats.errors), tone: "error", icon: "error" },
  ];

  const toneMap = {
    info: "border-sky-500/30 text-sky-400 bg-sky-500/10",
    success: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    error: "border-red-500/30 text-red-400 bg-red-500/10",
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((c) => {
        const IconComponent = iconMap[c.icon];
        return (
          <div key={c.label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3)] transition-colors hover:border-white/15">
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
}) {
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loading || loadingMore) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, onLoadMore]);

  const filtered = notifications
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" active={filter === "ALL"} onClick={() => setFilter("ALL")} />
        {PRIORITIES.map((p) => (
          <FilterChip key={p} label={p} active={filter === p} onClick={() => setFilter(p)} tone={p} />
        ))}
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or content..."
          className="w-72 max-w-full rounded-full border border-white/[0.08] bg-[#111] px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#ffd555]/50 focus:ring-1 focus:ring-[#ffd555]/30"
        />
        <button
          onClick={onRefresh}
          disabled={loading || loadingMore}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/60 transition hover:border-[#ffd555]/30 hover:bg-[#ffd555]/10 hover:text-[#ffe58a]"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#111111] shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="font-semibold text-white">Live Events (API Send History)</div>
          <div className="text-xs text-gray-400">
            {state.isAvailable
              ? `${filtered.length} shown · ${notifications.length}/${total} loaded`
              : "History count unavailable"}
          </div>
        </div>
        <ul className="divide-y divide-white/5">
          {error && !loading && (
            <li className="px-5 py-10 text-center text-red-300 text-sm" role="alert">
              Notification history unavailable. {error}
            </li>
          )}
          {filtered.length === 0 && !loading && !error && (
            <li className="px-5 py-10 text-center text-gray-500 text-sm">No matching notifications.</li>
          )}
          {loading && filtered.length === 0 && (
            <li className="px-5 py-10 text-center text-gray-500 text-sm">Loading history from API...</li>
          )}
          {filtered.map((m) => (
            <MessageRow key={m._id || m.id} m={m} />
          ))}
          <li ref={loadMoreRef} className="px-5 py-5 text-center">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2 text-xs text-emerald-400">
                <Loader2 className="animate-spin" size={15} />
                Loading older notifications...
              </span>
            ) : hasMore ? (
              <span className="text-xs text-gray-600">Scroll down to load older notifications</span>
            ) : notifications.length > 0 ? (
              <span className="text-xs text-gray-600">All notifications have been loaded</span>
            ) : null}
          </li>
        </ul>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick, tone }) {
  const toneCls = tone ? PRIORITY_META[tone] : null;
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
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

function MessageRow({ m }) {
  const meta = PRIORITY_META[m.priority] || PRIORITY_META.INFO;
  const targetLabel = m.targetType === "ALL_USERS" ? "Whole system" :
                      m.targetType === "ROLE_BASED" ? `Role: ${(m.targetRoles || []).join(", ")}` :
                      m.targetType === "MULTI_USER" ? `${m.targetUsers?.length || 0} users` :
                      m.targetType === "SINGLE_USER" ? "One user" : "System";

  return (
    <li className="px-5 py-4 flex items-start gap-4 bg-white/[0.02]">
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
          <span>User: {targetLabel}</span>
          <span>-</span>
          <span>Status: {m.status || "SENT"}</span>
          <span>-</span>
          <span>{m.createdAt ? formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: enUS }) : "Just now"}</span>
        </div>
      </div>
    </li>
  );
}

function ComposeTab({ onSent }) {
  const [audienceKind, setAudienceKind] = useState("single");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState(["customer"]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("INFO");
  const [toast, setToast] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const audienceOptions = [
    { id: "single", label: "One user", description: "Send privately to one account", icon: User },
    { id: "multi", label: "Multiple users", description: "Choose two or more accounts", icon: Users },
    { id: "role", label: "By role", description: "Target account groups", icon: ShieldCheck },
    { id: "all", label: "Entire system", description: "Every active account", icon: Globe2 },
  ];
  const audienceSummary =
    audienceKind === "single"
      ? selectedUsers[0]?.username || "No user selected"
      : audienceKind === "multi"
        ? `${selectedUsers.length} users selected`
        : audienceKind === "role"
          ? selectedRoles.map((role) => role[0].toUpperCase() + role.slice(1)).join(", ") || "No role selected"
          : "All active Admin, Staff, and Customer accounts";
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
        return setToast("Please select at least one role.");
      }
      targetType = "ROLE_BASED";
      targetRoles = selectedRoles;
    } else if (audienceKind === "multi") {
      if (selectedUsers.length < 2) {
        return setToast("Please select at least two different users.");
      }
      targetType = "MULTI_USER";
      targetUsers = selectedUsers.map((u) => u._id);
    } else if (audienceKind === "single") {
      targetType = "SINGLE_USER";
      if (selectedUsers.length === 0) {
        return setToast("Please select a user.");
      }
      targetUsers = [selectedUsers[0]._id];
    }

    if (!title.trim() || !message.trim()) {
      return setToast("Title and content are required.");
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
        setToast(res.data?.message || "Notification sent successfully through the API.");
        setTimeout(onSent, 1000);
      } else {
        setToast("API error: " + (res.data?.message || JSON.stringify(res.data?.errors) || "Unknown error"));
      }
    } catch {
      setToast("API connection error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-6xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111111] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-3 border-b border-[#ffd555]/15 bg-gradient-to-r from-[#ffd555]/[0.06] to-transparent px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#ffd555]/20 bg-[#ffd555]/10 text-[#ffd555]">
            <BellRing size={19} />
          </span>
          <div>
            <h2 className="font-semibold text-white">Create notification</h2>
            <p className="mt-0.5 text-xs text-gray-500">Choose the audience, compose the message, then review it.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={`h-2 w-2 rounded-full ${audienceReady ? "bg-emerald-400" : "bg-gray-600"}`} />
          Audience
          <span className="text-gray-700">/</span>
          <span className={`h-2 w-2 rounded-full ${messageReady ? "bg-emerald-400" : "bg-gray-600"}`} />
          Message
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.7fr)]">
        <div className="space-y-7 p-5 sm:p-7 lg:border-r lg:border-white/5">
          <section>
            <StepHeading number="1" title="Choose audience" description="Select exactly who should receive this message." />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {audienceOptions.map((option) => {
                const Icon = option.icon;
                const active = audienceKind === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => changeAudience(option.id)}
                    className={`group flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      active
                        ? "border-[#ffd555]/50 bg-[#ffd555]/10"
                        : "border-white/10 bg-[#101010] hover:border-white/20 hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                      active ? "bg-[#ffd555]/15 text-[#ffd555]" : "bg-white/5 text-gray-500"
                    }`}>
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-medium ${active ? "text-[#ffe58a]" : "text-gray-200"}`}>{option.label}</span>
                      <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
                    </span>
                    <span className={`grid h-5 w-5 place-items-center rounded-full border ${
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
                <div className="rounded-xl border border-white/10 bg-[#101010] p-4">
                  <p className="text-xs font-medium text-gray-300">Select one or more roles</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["admin", "staff", "customer"].map((role) => {
                      const active = selectedRoles.includes(role);
                      return (
                        <button
                          type="button"
                          key={role}
                          onClick={() => setSelectedRoles((current) =>
                            active ? current.filter((item) => item !== role) : [...current, role]
                          )}
                          className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm capitalize transition-colors ${
                            active
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-white/10 text-gray-400 hover:border-white/20"
                          }`}
                        >
                          <span className={`grid h-4 w-4 place-items-center rounded border ${active ? "border-amber-400 bg-amber-400 text-black" : "border-white/20"}`}>
                            {active && <Check size={10} strokeWidth={3} />}
                          </span>
                          {role}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
                    <Info size={13} />
                    Only active accounts in these roles will receive it.
                  </p>
                </div>
              )}
              {(audienceKind === "single" || audienceKind === "multi") && (
                <UserPicker multi={audienceKind === "multi"} value={selectedUsers} onChange={setSelectedUsers} />
              )}
              {audienceKind === "all" && (
                <div className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
                  <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={18} />
                  <div>
                    <p className="text-sm font-medium text-amber-300">System-wide delivery</p>
                    <p className="mt-1 text-xs leading-5 text-amber-200/60">
                      Every active Admin, Staff, and Customer account will receive this message.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <StepHeading number="2" title="Write message" description="Keep it concise and tell recipients what to do next." />
            <div className="mt-4 space-y-4">
              <Field label="Title" hint={`${title.length}/200`}>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  placeholder="Example: Scheduled maintenance tonight"
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#0b0b0b] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#ffd555]/50 focus:ring-4 focus:ring-[#ffd555]/[0.06]"
                />
              </Field>
              <Field label="Content" hint={`${message.length}/2000`}>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={2000}
                  rows={6}
                  placeholder="Explain what happened, when it applies, and what the recipient should do..."
                  className="w-full resize-y rounded-xl border border-white/10 bg-[#0b0b0b] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-[#ffd555]/50 focus:ring-4 focus:ring-[#ffd555]/[0.06]"
                />
              </Field>
            </div>
          </section>
        </div>

        <aside className="space-y-6 bg-[#0d0d0d] p-5 sm:p-7">
          <section>
            <StepHeading number="3" title="Priority" description="Choose how prominently it appears." compact />
            <div className="mt-4 grid grid-cols-2 gap-2">
              {PRIORITIES.map((item) => {
                const meta = PRIORITY_META[item];
                return (
                  <button
                    type="button"
                    key={item}
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
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Preview</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0D]">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                <span className="text-xs text-gray-500">Recipient inbox</span>
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
                    {title.trim() || "Notification title"}
                  </p>
                  <p className={`mt-1 whitespace-pre-wrap break-words text-xs leading-5 ${message.trim() ? "text-gray-400" : "text-gray-700"}`}>
                    {message.trim() || "Your notification content will appear here."}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-gray-600">
                    <Users size={12} />
                    {audienceSummary}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {toast && (
            <div className={`flex gap-2.5 rounded-xl border p-3 text-xs leading-5 ${
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

          <div className="border-t border-white/5 pt-5">
            {!canSubmit && !isSubmitting && (
              <p className="mb-3 text-center text-[11px] text-gray-600">
                Complete the audience, title, and content to continue.
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] px-5 text-sm font-black text-[#080808] shadow-[0_10px_30px_rgba(255,213,85,0.14)] transition hover:bg-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-gray-600 disabled:shadow-none"
            >
              {isSubmitting ? (
                <><Loader2 className="animate-spin" size={17} />Sending...</>
              ) : (
                <><Send size={17} />Send notification</>
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
    <div className="flex items-start gap-3">
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

function UserPicker({ multi, value, onChange }) {
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
          "User search is unavailable."
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
          setSearchError(err?.message || "User search is unavailable.");
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
  }, [q]);

  function toggle(user) {
    if (!multi) return onChange([user]);
    const exists = value.find((x) => x._id === user._id);
    onChange(exists ? value.filter((x) => x._id !== user._id) : [...value, user]);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#101010]">
      <div className="border-b border-white/5 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={16} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search by username or email..."
            className="h-11 w-full rounded-lg border border-white/10 bg-[#111] pl-10 pr-10 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#ffd555]/40"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {value.length > 0 && (
          <div className="mt-3 flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {value.map((user) => (
                <span key={user._id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[#ffd555]/10 px-2 py-1 text-xs text-[#ffe58a]">
                  <span className="max-w-40 truncate">{user.username}</span>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((item) => item._id !== user._id))}
                    className="text-[#d7b94a] hover:text-[#ffe58a]"
                    aria-label={`Remove ${user.username}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            {multi && (
              <button type="button" onClick={() => onChange([])} className="shrink-0 py-1 text-[11px] text-gray-600 hover:text-gray-300">
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 text-[11px] text-gray-600">
        <span>{multi ? "Select at least 2 users" : "Select exactly 1 user"}</span>
        <span>{value.length} selected</span>
      </div>

      <ul className="scrollbar-hidden max-h-64 overflow-y-auto p-2">
        {loading && (
          <li className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-gray-500">
            <Loader2 className="animate-spin" size={15} />
            Searching users...
          </li>
        )}
        {!loading && searchError && (
          <li className="px-3 py-8 text-center text-xs text-red-300" role="alert">
            User search unavailable. {searchError}
          </li>
        )}
        {!loading && !searchError && results.length === 0 && (
          <li className="px-3 py-8 text-center text-xs text-gray-500">No active users found.</li>
        )}
        {!loading && results.map((user) => {
          const selected = value.some((item) => item._id === user._id);
          const initials = (user.username || user.email || "U").slice(0, 2).toUpperCase();
          return (
            <li key={user._id}>
              <button
                type="button"
                onClick={() => toggle(user)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selected ? "bg-[#ffd555]/10" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                  selected ? "bg-[#ffd555]/20 text-[#ffd555]" : "bg-white/5 text-gray-500"
                }`}>
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${selected ? "text-[#ffe58a]" : "text-gray-200"}`}>
                    {user.username}
                  </span>
                  <span className="block truncate text-xs text-gray-600">{user.email}</span>
                </span>
                <span className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] uppercase text-gray-500">
                  {user.role}
                </span>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
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

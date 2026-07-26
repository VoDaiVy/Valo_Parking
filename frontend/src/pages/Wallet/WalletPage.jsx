import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Menu, Transition } from "@headlessui/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import {
  createTopUpUrl,
  getTopUpStatus,
  getTransactionsHistory,
  getWalletInfo,
} from "../../services/walletService";
import { clearAuthSession } from "../../services/authStorage";
import PolicyAcceptancePrompt from "../../components/policies/PolicyAcceptancePrompt";
import { extractMissingPolicies, isPolicyAcceptanceRequired } from "../../utils/policyErrors";
import { getCustomerBookingStatistics } from "../../services/statisticsService";

const DEFAULT_TRANSACTION_LIMIT = 4;
const ALL_TRANSACTION_LIMIT = 50;
const MIN_TOP_UP = 10000;
const QUICK_AMOUNTS = [50000, 100000, 200000, 500000];
const INSIGHT_RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

const formatMoney = (value = 0) =>
  `${Number(value || 0).toLocaleString("vi-VN")} VND`;

const formatDateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "-";

const isCredit = (transaction) =>
  ["TOP_UP", "REFUND", "TRANSFER_IN"].includes(transaction?.type);

const statusStyle = (status = "") => {
  const normalized = String(status).toUpperCase();
  if (["SUCCESS", "COMPLETED", "PAID"].includes(normalized)) {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }
  if (normalized === "PENDING") {
    return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  }
  if (["CANCELLED", "CANCELED"].includes(normalized)) {
    return "bg-white/5 text-gray-400 border-white/10";
  }
  return "bg-rose-500/10 text-rose-400 border-rose-500/20";
};

const statusLabel = (status = "") => {
  const normalized = String(status).toUpperCase();
  if (["SUCCESS", "COMPLETED", "PAID"].includes(normalized)) return "Completed";
  if (normalized === "PENDING") return "Pending";
  if (normalized === "FAILED") return "Failed";
  if (["CANCELLED", "CANCELED"].includes(normalized)) return "Cancelled";
  return normalized || "Unknown";
};

const transactionTitle = (transaction) => {
  if (transaction?.description) return transaction.description;
  if (transaction?.type === "TOP_UP") return "VALO wallet top-up";
  if (transaction?.type === "REFUND") return "Wallet refund";
  if (transaction?.type === "TRANSFER_IN") return "Membership transfer proceeds";
  if (transaction?.type === "TRANSFER_OUT") return "Membership transfer payment";
  if (transaction?.type === "TRANSFER_FEE") return "Membership transfer processing fee";
  if (transaction?.refSource === "parking") return "Parking payment";
  return "Wallet payment";
};

const transactionIcon = (transaction, className = "") => {
  if (transaction?.type === "TOP_UP") return <ArrowDownLeft className={className} />;
  if (transaction?.type === "REFUND") return <RefreshCw className={className} />;
  if (transaction?.type === "TRANSFER_IN") return <ArrowDownLeft className={className} />;
  if (transaction?.refSource === "parking") return <Car className={className} />;
  return <ArrowUpRight className={className} />;
};

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [pollingOrderCode, setPollingOrderCode] = useState(null);
  const [pollingShowsOverlay, setPollingShowsOverlay] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [toast, setToast] = useState(null);
  const [policyPrompt, setPolicyPrompt] = useState({
    open: false,
    missingPolicies: [],
  });
  const [bookingStats, setBookingStats] = useState(null);
  const [statsRange, setStatsRange] = useState("30d");
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const fetchWalletData = useCallback(
    async (transactionLimit = DEFAULT_TRANSACTION_LIMIT, silent = false) => {
      if (!silent) setLoading(true);
      setRefreshing(silent);
      setError("");

      try {
        const [walletRes, transactionsRes] = await Promise.all([
          getWalletInfo(),
          getTransactionsHistory({ page: 1, limit: transactionLimit }),
        ]);

        if (walletRes.status === 401 || transactionsRes.status === 401) {
          clearAuthSession();
          window.location.href = "/login";
          return;
        }

        if (!walletRes.ok) {
          throw new Error(walletRes.data?.message || "Unable to load wallet");
        }

        if (!transactionsRes.ok) {
          throw new Error(
            transactionsRes.data?.message || "Unable to load transactions",
          );
        }

        const walletData = walletRes.data?.data || {};
        setWallet(walletData);
        const txData = Array.isArray(transactionsRes.data?.data) ? transactionsRes.data.data : [];
        setTransactions(txData);
        
        // Auto-sync pending topups if webhook was missed locally
        const pendingTopUp = txData.find(tx => tx.status === 'PENDING' && tx.type === 'TOP_UP' && tx.payosOrderCode);
        if (pendingTopUp) {
          setPollingShowsOverlay(false);
          setPollingOrderCode(pendingTopUp.payosOrderCode);
        }
        window.dispatchEvent(
          new CustomEvent("valo_balance_change", {
            detail: walletData.balance || 0,
          }),
        );
      } catch (err) {
        setError(err.message || "Unable to load wallet data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderCode = params.get("orderCode");
    const payosStatus = params.get("status");
    const cancelFlag = params.get("cancel");

    if (!orderCode) {
      const timerId = window.setTimeout(() => {
        fetchWalletData();
      }, 0);
      return () => window.clearTimeout(timerId);
    }

    window.history.replaceState({}, document.title, window.location.pathname);

    if (cancelFlag === "true" || payosStatus === "CANCELLED") {
      getTopUpStatus(orderCode, true)
        .then(() => {
          showToast("Top-up was cancelled", "error");
          fetchWalletData();
        })
        .catch(() => {
          showToast("Top-up was cancelled", "error");
          fetchWalletData();
        });
      return;
    }

    const timerId = window.setTimeout(() => {
      setPollingShowsOverlay(true);
      setPollingOrderCode(orderCode);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [fetchWalletData, showToast]);

  useEffect(() => {
    if (!pollingOrderCode) return undefined;

    const verifyingTimerId = window.setTimeout(() => {
      setVerifyingPayment(pollingShowsOverlay);
    }, 0);

    const stopPolling = () => {
      clearInterval(intervalId);
      setPollingOrderCode(null);
      setPollingShowsOverlay(false);
      setVerifyingPayment(false);
    };

    const intervalId = setInterval(async () => {
      try {
        const statusRes = await getTopUpStatus(pollingOrderCode);
        if (!statusRes.ok) {
          stopPolling();
          showToast(
            statusRes.data?.message || "Unable to verify the pending top-up",
            "error",
          );
          return;
        }

        const txStatus = String(statusRes.data?.data?.status || "").toUpperCase();

        if (["COMPLETED", "SUCCESS", "PAID"].includes(txStatus)) {
          stopPolling();
          showToast("Top-up completed successfully");
          fetchWalletData();
        }

        if (["CANCELLED", "CANCELED", "FAILED"].includes(txStatus)) {
          stopPolling();
          showToast("Payment failed or was cancelled", "error");
          fetchWalletData();
        }
      } catch (err) {
        console.error("Failed to verify top-up status:", err);
        stopPolling();
        showToast("Unable to verify the pending top-up", "error");
      }
    }, 3000);

    const timeoutId = setTimeout(() => {
      stopPolling();
      showToast("Payment verification timed out", "warning");
      fetchWalletData();
    }, 300000);

    return () => {
      window.clearTimeout(verifyingTimerId);
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [fetchWalletData, pollingOrderCode, pollingShowsOverlay, showToast]);

  useEffect(() => {
    if (!modal) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modal]);

  useEffect(() => {
    let active = true;

    getCustomerBookingStatistics(statsRange)
      .then((response) => {
        if (!active) return;
        if (response.ok && response.data?.success) {
          setBookingStats(response.data.data);
        } else if (response.status !== 404) {
          setStatsError(response.data?.message || "Unable to load booking insights");
        }
      })
      .catch(() => {
        if (active) setStatsError("Unable to load booking insights");
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [statsRange]);

  const handleStatsRangeChange = (nextRange) => {
    setStatsLoading(true);
    setStatsError("");
    setStatsRange(nextRange);
  };



  const weeklyBars = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const totals = labels.map((label) => ({ label, spent: 0, topUp: 0 }));
    const now = new Date();

    transactions.forEach((transaction) => {
      const created = new Date(transaction.createdAt);
      const diffDays = (now - created) / (1000 * 60 * 60 * 24);
      if (Number.isNaN(created.getTime()) || diffDays > 7) return;

      const index = created.getDay() === 0 ? 6 : created.getDay() - 1;
      if (isCredit(transaction)) totals[index].topUp += transaction.amount || 0;
      else totals[index].spent += transaction.amount || 0;
    });

    const maxValue = Math.max(
      ...totals.map((item) => item.spent + item.topUp),
      1,
    );

    return totals.map((item) => ({
      ...item,
      height: Math.max(((item.spent + item.topUp) / maxValue) * 100, 4),
    }));
  }, [transactions]);

  const handleToggleTransactions = async () => {
    const nextShowAll = !showAllTransactions;
    setShowAllTransactions(nextShowAll);
    await fetchWalletData(
      nextShowAll ? ALL_TRANSACTION_LIMIT : DEFAULT_TRANSACTION_LIMIT,
      true,
    );
  };

  return (
    <div className="min-h-full bg-[#0D0D0D] text-white">
      {verifyingPayment && <VerificationOverlay />}

      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 xl:p-8">
        <section className="w-full">
          <BalancePanel
            wallet={wallet}
            loading={loading}
            onTopUp={() => setModal("topup")}
            onRefresh={() =>
              fetchWalletData(
                showAllTransactions
                  ? ALL_TRANSACTION_LIMIT
                  : DEFAULT_TRANSACTION_LIMIT,
                true,
              )
            }
            refreshing={refreshing}
          />
        </section>

        {error && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">
            {error}
          </div>
        )}

        {(statsLoading || bookingStats || statsError) && (
          <BookingInsightsPanel
            data={bookingStats}
            loading={statsLoading}
            error={statsError}
            range={statsRange}
            onRangeChange={handleStatsRangeChange}
          />
        )}

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
          <TransactionsPanel
            transactions={transactions}
            loading={loading}
            showAll={showAllTransactions}
            onToggle={handleToggleTransactions}
          />
          <AnalyticsPanel wallet={wallet} weeklyBars={weeklyBars} />
        </section>
      </main>

      {modal === "topup" && (
        <TopUpModal
          wallet={wallet}
          onClose={() => setModal(null)}
          onStartPolling={(orderCode) => {
            setPollingShowsOverlay(true);
            setPollingOrderCode(orderCode);
          }}
        />
      )}

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function BookingInsightsPanel({ data, loading, error, range, onRangeChange }) {
  const operational = data?.operational || {};
  const money = data?.money || {};

  return (
    <section className="overflow-hidden rounded-[24px] border border-white/5 bg-[#151515]">
      <div className="grid lg:grid-cols-[0.85fr_1.6fr]">
        <div className="relative border-b border-white/5 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#DCA11D] to-transparent opacity-70" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-300">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <InsightRangeDropdown value={range} onChange={onRangeChange} />
          </div>
          <h2 className="mt-6 text-xl font-black tracking-tight">Your parking story</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#AFC2D8]">
            Booking activity and wallet cash flow are separated so every number has a clear source.
          </p>
          {money.financialCoverage === "partial" && (
            <p className="mt-5 rounded-xl border border-yellow-500/10 bg-yellow-500/5 px-3 py-2 text-xs leading-5 text-yellow-100/70">
              PayOS history is estimated from booking records. Wallet charges and refunds include
              transactions with a verified booking reference.
            </p>
          )}
        </div>

        <div className="p-5 sm:p-6">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading booking insights">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          ) : error ? (
            <div className="flex min-h-24 items-center gap-3 rounded-2xl border border-rose-500/15 bg-rose-500/5 px-4 text-sm text-rose-200">
              <RotateCcw className="h-4 w-4" />
              {error}
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
              <InsightMetric
                label="Bookings"
                value={operational.totalBookings || 0}
                note={`${operational.completedBookings || 0} completed`}
              />
              <InsightMetric
                label="Wallet charges"
                value={formatMoney(money.walletBookingCharges)}
                note="Booking sources only"
              />
              <InsightMetric
                label="Refunded"
                value={formatMoney(money.walletBookingRefunds)}
                note={`${money.walletRefundCount || 0} refund events`}
                tone="positive"
              />
              <InsightMetric
                label="Net wallet spend"
                value={formatMoney(money.walletNetBookingSpend)}
                note={`${operational.scheduledHours || 0} scheduled hours`}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function InsightRangeDropdown({ value, onChange }) {
  const selected =
    INSIGHT_RANGE_OPTIONS.find((option) => option.value === value) ||
    INSIGHT_RANGE_OPTIONS[1];

  return (
    <Menu as="div" className="relative z-20">
      {({ open }) => (
        <>
          <Menu.Button
            aria-label="Booking insight period"
            className="flex h-11 min-w-[148px] items-center justify-between gap-3 rounded-xl border border-yellow-500/40 bg-[#0B0B0B] px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] outline-none transition hover:border-yellow-400/70 hover:bg-[#111111] focus-visible:border-yellow-400 focus-visible:ring-2 focus-visible:ring-yellow-400/20"
          >
            <span>{selected.label}</span>
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 text-yellow-300 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </Menu.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-150"
            enterFrom="translate-y-1 scale-95 opacity-0"
            enterTo="translate-y-0 scale-100 opacity-100"
            leave="transition ease-in duration-100"
            leaveFrom="translate-y-0 scale-100 opacity-100"
            leaveTo="translate-y-1 scale-95 opacity-0"
          >
            <Menu.Items className="absolute right-0 mt-2 w-44 origin-top-right overflow-hidden rounded-xl border border-yellow-500/20 bg-[#111111] p-1.5 shadow-2xl shadow-black/70 outline-none">
              {INSIGHT_RANGE_OPTIONS.map((option) => (
                <Menu.Item key={option.value}>
                  {({ active }) => {
                    const isSelected = option.value === value;

                    return (
                      <button
                        type="button"
                        onClick={() => onChange(option.value)}
                        className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition ${
                          isSelected
                            ? "bg-yellow-500/15 text-yellow-200"
                            : active
                              ? "bg-white/[0.06] text-white"
                              : "text-[#AFC2D8]"
                        }`}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {isSelected && <Check aria-hidden="true" className="h-4 w-4" />}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  }}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );
}

function InsightMetric({ label, value, note, tone = "default" }) {
  return (
    <div className="border-l border-white/10 pl-4">
      <p className="text-xs font-semibold text-[#AFC2D8]">{label}</p>
      <p
        className={`mt-2 text-xl font-black tracking-tight ${
          tone === "positive" ? "text-emerald-400" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-white/35">{note}</p>
    </div>
  );
}

function BalancePanel({ wallet, loading, onTopUp, onRefresh, refreshing }) {
  const balance = wallet?.balance || 0;
  const overdraftLimit = wallet?.overdraftLimit ?? -100000;
  const overdraftUsed = Math.max(0, Math.abs(Math.min(balance, 0)));

  return (
    <div className="relative min-h-[320px] overflow-hidden rounded-[28px] border border-yellow-500/10 bg-[linear-gradient(135deg,#171717_0%,#1a160d_52%,#3c2809_100%)] p-6 shadow-2xl sm:p-8">
      <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-yellow-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-amber-500/10 blur-[90px]" />

      <div className="relative flex h-full flex-col justify-between gap-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              Total Balance
            </p>
            <div className="mt-3 text-5xl font-black tracking-tight text-[#DCA11D] sm:text-6xl">
              {loading ? "..." : formatMoney(balance)}
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-white/70">
              <TrendingUp className="h-4 w-4 text-[#DCA11D]" />
              {formatMoney(wallet?.monthlyTopUp)} top-up this month
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-white/60 transition hover:border-yellow-500/30 hover:text-yellow-300"
              title="Refresh wallet"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
              Valo Prime
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <button
            type="button"
            onClick={onTopUp}
            className="group flex min-h-[76px] items-center justify-between gap-4 rounded-3xl border border-yellow-500/25 bg-black/50 px-5 text-left shadow-[0_20px_60px_rgba(0,0,0,0.22)] transition hover:border-yellow-300/70 hover:bg-white/10"
          >
            <span className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-yellow-500/30 bg-black/50 text-[#DCA11D] transition group-hover:scale-105">
                <Plus className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-lg font-black">Top Up Wallet</span>
                <span className="text-xs font-medium text-white/45">
                  payOS QR, banking app, e-wallet
                </span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-[#DCA11D]" />
          </button>

          <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-4 py-3">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400/60">
              <Sparkles className="h-3 w-3" /> Refunds
            </p>
            <p className="mt-1 text-sm font-bold text-emerald-300">
              {formatMoney(wallet?.monthlyRefunded)} <span className="text-[10px] font-medium text-emerald-400/40 normal-case tracking-normal">this month</span>
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
              Overdraft
            </p>
            <p className="mt-1 text-sm font-bold text-white">
              {formatMoney(overdraftUsed)} / {formatMoney(Math.abs(overdraftLimit))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionsPanel({ transactions, loading, showAll, onToggle }) {
  return (
    <div className="rounded-[24px] border border-white/5 bg-[#1A1A1A] p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black tracking-tight">
            Recent Transactions
          </h2>
          <p className="mt-1 text-sm text-[#AFC2D8]">
            {showAll ? "All synced wallet activity" : "Latest wallet activity"}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-[#AFC2D8] transition hover:bg-white/5 hover:text-white"
        >
          {showAll ? "View less" : "View all"}
          <ChevronRight
            className={`h-4 w-4 transition ${showAll ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/5">
        <div className="hidden grid-cols-[1.1fr_2fr_1fr_1fr] border-b border-white/5 bg-white/[0.02] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#AFC2D8] md:grid">
          <span>Time</span>
          <span>Description</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Status</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-14 text-sm font-semibold text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading transactions
          </div>
        ) : transactions.length ? (
          <div className="divide-y divide-white/5">
            {transactions.map((transaction) => (
              <TransactionRow
                key={transaction._id || transaction.payosOrderCode}
                transaction={transaction}
              />
            ))}
          </div>
        ) : (
          <div className="py-14 text-center text-sm font-medium text-gray-500">
            No transactions yet
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionRow({ transaction }) {
  const credit = isCredit(transaction);

  return (
    <div className="grid gap-3 px-4 py-4 transition hover:bg-white/[0.03] md:grid-cols-[1.1fr_2fr_1fr_1fr] md:items-center">
      <div className="text-xs font-medium text-gray-400">
        {formatDateTime(transaction.createdAt)}
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            credit
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-yellow-500/10 text-yellow-300"
          }`}
        >
          {transactionIcon(transaction, "h-5 w-5")}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            {transactionTitle(transaction)}
          </p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">
            Balance: {formatMoney(transaction.balanceAfter)}
          </p>
        </div>
      </div>

      <div
        className={`text-sm font-black md:text-right ${
          credit ? "text-emerald-400" : "text-white"
        }`}
      >
        {credit ? "+" : "-"}
        {formatMoney(transaction.amount)}
      </div>

      <div className="md:text-right">
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-bold ${statusStyle(
            transaction.status,
          )}`}
        >
          {statusLabel(transaction.status)}
        </span>
      </div>
    </div>
  );
}

function AnalyticsPanel({ wallet, weeklyBars }) {
  return (
    <div className="rounded-[24px] border border-white/5 bg-[#1A1A1A] p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black tracking-tight">Wallet Analytics</h2>
          <p className="mt-1 text-sm text-[#AFC2D8]">
            Synced from completed transactions
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-300">
          <BarChart3 className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-7 flex items-baseline gap-3">
        <p className="text-3xl font-black tracking-tight">
          {formatMoney(wallet?.monthlyTopUp)}
        </p>
        <p className="text-sm font-semibold text-[#AFC2D8]">top-up this month</p>
      </div>

      <div className="mt-7 flex h-48 items-end justify-between gap-2">
        {weeklyBars.map((item) => (
          <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-40 w-full items-end rounded-t-xl bg-white/[0.03]">
              <div
                className="w-full rounded-t-xl bg-gradient-to-t from-[#79510F] to-[#DCA11D] transition"
                style={{ height: `${item.height}%` }}
                title={`${formatMoney(item.spent + item.topUp)} activity`}
              />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              {item.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/5 pt-5">
        <AnalyticsMetric label="Lifetime spent" value={formatMoney(wallet?.totalSpent)} />
        <AnalyticsMetric label="Lifetime top-up" value={formatMoney(wallet?.totalTopUp)} />
      </div>
    </div>
  );
}

function AnalyticsMetric({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-white">{value}</p>
    </div>
  );
}

function VerificationOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-[28px] border border-white/10 bg-[#1A1A1A] p-8 text-center shadow-2xl">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#DCA11D] text-black shadow-lg shadow-yellow-500/20">
          <Zap className="h-8 w-8" />
        </div>
        <div>
          <h3 className="text-lg font-black">Verifying payment</h3>
          <p className="mt-1 text-sm text-gray-400">
            Please wait while payOS confirms your top-up.
          </p>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-yellow-300" />
      </div>
    </div>
  );
}

function TopUpModal({ wallet, onClose, onStartPolling }) {
  const [amount, setAmount] = useState(String(MIN_TOP_UP));
  const [loading, setLoading] = useState(false);
  const numericAmount = Number(amount || 0);

  const handleTopUp = async () => {
    if (!numericAmount || numericAmount < MIN_TOP_UP) {
      alert(`Minimum top-up is ${formatMoney(MIN_TOP_UP)}`);
      return;
    }

    setLoading(true);
    try {
      const res = await createTopUpUrl(numericAmount);
      if (res.status === 401) {
        clearAuthSession();
        window.location.href = "/login";
        return;
      }

      if (res.ok && res.data?.data?.checkoutUrl) {
        onStartPolling(res.data.data.orderCode);
        window.location.href = res.data.data.checkoutUrl;
        return;
      }

      alert(res.data?.message || "Unable to create top-up session");
    } catch (err) {
      console.error(err);
      alert("Cannot connect to the server. Please check that the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-lg">
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] text-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 sm:p-7">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#DCA11D] text-black shadow-lg shadow-yellow-500/20">
              <Plus className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">
                Top Up Wallet
              </h2>
              <p className="mt-1 text-sm font-medium text-gray-400">
                Add funds through payOS QR checkout
              </p>
            </div>
          </div>

          <div className="mt-7 rounded-[24px] border border-white/10 bg-black p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">
              Amount
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <input
                value={amount}
                onChange={(event) =>
                  setAmount(event.target.value.replace(/[^0-9]/g, ""))
                }
                className="min-w-0 flex-1 bg-transparent text-4xl font-black tracking-tight text-white outline-none placeholder:text-white/20"
                placeholder="0"
                inputMode="numeric"
              />
              <span className="text-xl font-black text-white">VND</span>
            </div>
            <p className="mt-2 text-xs font-medium text-gray-500">
              Current balance: {formatMoney(wallet?.balance)}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map((quickAmount) => (
              <button
                key={quickAmount}
                type="button"
                onClick={() => setAmount(String(quickAmount))}
                className={`rounded-2xl py-3 text-sm font-black transition ${
                  numericAmount === quickAmount
                    ? "bg-[#DCA11D] text-black"
                    : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                }`}
              >
                {quickAmount / 1000}k
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-[22px] border border-[#DCA11D]/30 bg-[#DCA11D]/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/30 text-yellow-300">
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black">payOS checkout</p>
                <p className="mt-0.5 text-xs font-medium text-gray-400">
                  Banking app, VietQR and supported e-wallets
                </p>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#DCA11D] text-black">
                <Check className="h-4 w-4" />
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleTopUp}
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-[20px] bg-gradient-to-r from-[#DCA11D] to-[#7D520C] py-4 text-sm font-black text-black shadow-lg shadow-yellow-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Processing..." : `Confirm Top Up - ${formatMoney(numericAmount)}`}
          </button>

          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs font-medium text-gray-500">
            <Shield className="h-4 w-4" />
            Secure payment session generated by backend payOS API
          </p>
        </div>
      </div>
    </div>
  );
}

function Toast({ toast, onClose }) {
  const tone =
    toast.type === "success"
      ? "border-emerald-500/20 bg-emerald-500 text-white"
      : toast.type === "error"
        ? "border-rose-500/20 bg-rose-500 text-white"
        : "border-amber-500/20 bg-amber-400 text-black";

  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] flex max-w-sm items-center gap-3 rounded-2xl border px-5 py-4 text-sm font-bold shadow-2xl ${tone}`}
    >
      <Zap className="h-5 w-5 shrink-0" />
      <span>{toast.message}</span>
      <button
        type="button"
        onClick={onClose}
        className="ml-2 rounded-lg p-1 transition hover:bg-black/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

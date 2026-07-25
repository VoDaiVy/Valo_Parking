import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Clock3,
  Download,
  FileText,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { API_BASE } from "../../services/api";
import {
  acceptEntitlementTransfer,
  cancelEntitlementTransfer,
  createEntitlementTransfer,
  getMembershipStatus,
  getMyEntitlementTransfers,
  rejectEntitlementTransfer,
  searchMembershipTransferRecipients,
  settleEntitlementTransfer,
} from "../../services/subscriptionService";
import { getWalletInfo } from "../../services/walletService";
import MembershipOwnershipPanel from "../../components/membership/MembershipOwnershipPanel";
import CustomerPageHeader from "../../components/Customer/CustomerPageHeader";

const STATUS_META = {
  PENDING_RECIPIENT: {
    label: "Waiting for recipient",
    className: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  },
  PENDING_ADMIN: {
    label: "Waiting for admin",
    className: "border-blue-400/20 bg-blue-400/10 text-blue-300",
  },
  AWAITING_PAYMENT: {
    label: "Payment required",
    className: "border-violet-400/20 bg-violet-400/10 text-violet-300",
  },
  LISTED: {
    label: "Live marketplace listing",
    className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  },
  COMPLETED: {
    label: "Completed",
    className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  },
  REJECTED: {
    label: "Rejected",
    className: "border-rose-400/20 bg-rose-400/10 text-rose-300",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "border-white/10 bg-white/5 text-white/45",
  },
  EXPIRED: {
    label: "Expired",
    className: "border-white/10 bg-white/5 text-white/45",
  },
};

const EMPTY_FORM = { mode: "DIRECT", toUserEmail: "", askingPrice: "", reason: "" };
const money = (value) => `${Number(value || 0).toLocaleString("vi-VN")} VND`;
const entityId = (entity) => String(entity?._id || entity || "");

export default function MembershipTransfers() {
  const navigate = useNavigate();
  const currentUser = useMemo(
    () => JSON.parse(sessionStorage.getItem("valo_user") || "{}"),
    [],
  );
  const currentUserId = String(currentUser?._id || currentUser?.id || "");
  const currentUserEmail = String(currentUser?.email || "").toLowerCase();
  const [transfers, setTransfers] = useState([]);
  const [membership, setMembership] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [recipientOptions, setRecipientOptions] = useState([]);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientOpen, setRecipientOpen] = useState(false);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const [transferRes, membershipRes, walletRes] = await Promise.all([
        getMyEntitlementTransfers(),
        getMembershipStatus(),
        getWalletInfo(),
      ]);

      if (membershipRes.ok && membershipRes.data?.success) {
        setMembership(membershipRes.data.data);
      }
      if (walletRes.ok && walletRes.data?.success) {
        setWalletBalance(Number(walletRes.data.data?.balance || 0));
      }
      if (!transferRes.ok || !transferRes.data?.success) {
        throw new Error(transferRes.data?.message || "Unable to load transfer requests.");
      }
      setTransfers(transferRes.data.data || []);
    } catch (error) {
      toast.error(error.message || "Unable to load membership transfers.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => loadData(), 0);
    return () => window.clearTimeout(timerId);
  }, [loadData]);

  useEffect(() => {
    if (!selectedSlot || form.mode !== "DIRECT") {
      return undefined;
    }

    let ignore = false;
    const timerId = window.setTimeout(async () => {
      setRecipientLoading(true);
      try {
        const response = await searchMembershipTransferRecipients(
          form.toUserEmail,
          12,
        );
        if (!ignore) {
          setRecipientOptions(
            response.ok && response.data?.success ? response.data.data || [] : [],
          );
        }
      } catch {
        if (!ignore) setRecipientOptions([]);
      } finally {
        if (!ignore) setRecipientLoading(false);
      }
    }, 250);

    return () => {
      ignore = true;
      window.clearTimeout(timerId);
    };
  }, [form.mode, form.toUserEmail, selectedSlot]);

  const refreshData = useCallback(
    () => loadData({ silent: true }),
    [loadData],
  );

  const filteredTransfers = useMemo(
    () =>
      transfers.filter((transfer) => {
        const isCurrentUser = (entity) =>
          (currentUserId && entityId(entity) === currentUserId) ||
          (currentUserEmail &&
            String(entity?.email || "").toLowerCase() === currentUserEmail);
        if (filter === "incoming") return isCurrentUser(transfer.toUserId);
        if (filter === "outgoing") return isCurrentUser(transfer.fromUserId);
        return true;
      }),
    [currentUserEmail, currentUserId, filter, transfers],
  );

  const handleCreate = async () => {
    if (!selectedSlot?.entitlementId) return;
    setActiveAction(`create:${selectedSlot.entitlementId}`);
    try {
      const response = await createEntitlementTransfer(selectedSlot.entitlementId, {
        mode: form.mode,
        ...(form.mode === "DIRECT" ? { toUserEmail: form.toUserEmail.trim() } : {}),
        askingPrice: Number(form.askingPrice || 0),
        reason: form.reason.trim(),
      });
      if (!response.ok || !response.data?.success) {
        toast.error(response.data?.message || "Unable to create transfer request.");
        return;
      }
      toast.success(
        form.mode === "PUBLIC"
          ? "Public listing submitted for admin review."
          : "Transfer invitation sent to the recipient.",
      );
      setSelectedSlot(null);
      setForm(EMPTY_FORM);
      setRecipientOpen(false);
      setRecipientOptions([]);
      await loadData({ silent: true });
    } catch (error) {
      toast.error(error.message || "Unable to create transfer request.");
    } finally {
      setActiveAction("");
    }
  };

  const handleAction = async (transfer, action) => {
    setActiveAction(`${action}:${transfer._id}`);
    try {
      const response =
        action === "accept"
          ? await acceptEntitlementTransfer(transfer._id)
          : action === "settle"
            ? await settleEntitlementTransfer(transfer._id)
            : action === "cancel"
              ? await cancelEntitlementTransfer(transfer._id)
            : await rejectEntitlementTransfer(
                transfer._id,
                "Declined by recipient",
              );

      if (!response.ok || !response.data?.success) {
        toast.error(response.data?.message || "Unable to update this transfer.");
        return;
      }

      const messages = {
        accept: "Accepted. The request is now waiting for admin review.",
        settle: "Payment completed. The parking space has been transferred.",
        cancel: "Transfer request cancelled.",
        reject: "Transfer invitation declined.",
      };
      toast.success(messages[action]);
      await loadData({ silent: true });
    } catch (error) {
      toast.error(error.message || "Unable to update this transfer.");
    } finally {
      setActiveAction("");
    }
  };

  const downloadContract = async (transferId) => {
    setActiveAction(`pdf:${transferId}`);
    try {
      const response = await fetch(
        `${API_BASE}/membership-entitlement-transfers/${transferId}/pdf`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } },
      );
      if (!response.ok) {
        toast.error("Unable to download the transfer contract.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `Membership-Transfer-${transferId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Unable to download the transfer contract.");
    } finally {
      setActiveAction("");
    }
  };

  return (
    <div className="min-h-full bg-[#0D0D0D] px-4 py-6 text-white sm:px-6 lg:px-8">
      <Toaster position="top-right" />
      <div className="mx-auto max-w-6xl">
        <CustomerPageHeader
          icon={ArrowLeftRight}
          title="Membership"
          description="Send a parking-space entitlement, respond to invitations, pay after admin approval, and keep the signed PDF contract."
          className="border-b border-white/10 pb-6"
          action={<div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate("/customer/membership-transfer-marketplace")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#DCA11D] px-4 text-sm font-black text-[#16130B]">
              <ShoppingBag size={16} /> Marketplace
            </button>
            <button
              type="button"
              onClick={refreshData}
              disabled={refreshing}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>}
        />

        <MembershipOwnershipPanel
          membership={membership}
          walletBalance={walletBalance}
          onRefresh={refreshData}
          onTransfer={(slot) => {
            setSelectedSlot(slot);
            setForm(EMPTY_FORM);
            setRecipientOpen(false);
            setRecipientOptions([]);
          }}
        />

        <section className="mt-6 rounded-3xl border border-white/10 bg-[#151515] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black">Requests and contracts</h2>
              <p className="mt-1 text-sm text-white/40">
                Incoming invitations require your confirmation before admin can see them.
              </p>
            </div>
            <div className="flex rounded-xl bg-black/25 p-1">
              {["all", "incoming", "outgoing"].map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${
                    filter === item
                      ? "bg-white/10 text-white"
                      : "text-white/35 hover:text-white/65"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-white/40">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : filteredTransfers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
                <FileText size={26} className="mx-auto text-white/20" />
                <p className="mt-3 text-sm font-bold text-white/50">
                  No {filter === "all" ? "" : `${filter} `}transfer requests
                </p>
              </div>
            ) : (
              filteredTransfers.map((transfer) => {
                const isCurrentUser = (entity) =>
                  (currentUserId && entityId(entity) === currentUserId) ||
                  (currentUserEmail &&
                    String(entity?.email || "").toLowerCase() === currentUserEmail);
                const isRecipient = isCurrentUser(transfer.toUserId);
                const isSender = isCurrentUser(transfer.fromUserId);
                const status = STATUS_META[transfer.status] || {
                  label: transfer.status,
                  className: "border-white/10 bg-white/5 text-white/50",
                };
                const totalDue =
                  Number(transfer.askingPrice || 0) + Number(transfer.transferFee || 0);
                const processing = activeAction.endsWith(`:${transfer._id}`);

                return (
                  <article
                    key={transfer._id}
                    className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[#DCA11D]">
                          {isRecipient ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong>
                              Space {transfer.entitlementId?.slotCode || "—"}
                            </strong>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${status.className}`}
                            >
                              {status.label}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase text-white/45">
                              {transfer.mode || "DIRECT"}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-xs text-white/40">
                            {transfer.fromUserId?.email || "Unknown"} →{" "}
                            {transfer.toUserId?.email || (transfer.mode === "PUBLIC" ? "Public marketplace" : "Unknown")}
                          </p>
                          <p className="mt-1 text-xs text-white/40">
                            Price {money(transfer.askingPrice)} · Fee{" "}
                            {money(transfer.transferFee)}
                          </p>
                          {transfer.rejectionReason && (
                            <p className="mt-2 text-xs text-rose-300/80">
                              Reason: {transfer.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {isRecipient && transfer.status === "PENDING_RECIPIENT" && (
                          <>
                            <button
                              type="button"
                              disabled={processing}
                              onClick={() => handleAction(transfer, "reject")}
                              className="min-h-10 rounded-xl border border-white/10 px-4 text-xs font-bold text-white/55 hover:bg-white/5 disabled:opacity-40"
                            >
                              Decline
                            </button>
                            <button
                              type="button"
                              disabled={processing}
                              onClick={() => handleAction(transfer, "accept")}
                              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-black disabled:opacity-40"
                            >
                              {processing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              Accept
                            </button>
                          </>
                        )}
                        {isSender &&
                          ["PENDING_RECIPIENT", "PENDING_ADMIN", "LISTED"].includes(transfer.status) && (
                            <button
                              type="button"
                              disabled={processing}
                              onClick={() => handleAction(transfer, "cancel")}
                              className="min-h-10 rounded-xl border border-rose-400/20 px-4 text-xs font-bold text-rose-300 hover:bg-rose-400/10 disabled:opacity-40"
                            >
                              Cancel request
                            </button>
                          )}
                        {isRecipient && transfer.status === "PENDING_ADMIN" && (
                          <span className="inline-flex min-h-10 items-center gap-2 px-2 text-xs text-white/40">
                            <Clock3 size={15} />
                            Admin review
                          </span>
                        )}
                        {isRecipient && transfer.status === "AWAITING_PAYMENT" && (
                          <>
                            <div className="mr-2 text-right text-xs">
                              <p className="text-white/35">Total due</p>
                              <p className="mt-1 font-black text-[#E8B63E]">
                                {money(totalDue)}
                              </p>
                            </div>
                            {walletBalance >= totalDue ? (
                              <button
                                type="button"
                                disabled={processing}
                                onClick={() => handleAction(transfer, "settle")}
                                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#DCA11D] px-4 text-xs font-black text-[#16130B] disabled:opacity-40"
                              >
                                {processing ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
                                Pay from wallet
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => navigate("/customer/wallet")}
                                className="min-h-10 rounded-xl bg-rose-400/10 px-4 text-xs font-black text-rose-300"
                              >
                                Top up {money(totalDue - walletBalance)}
                              </button>
                            )}
                          </>
                        )}
                        {transfer.status === "COMPLETED" && (
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => downloadContract(transfer._id)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-xs font-black text-white/70 hover:bg-white/5 disabled:opacity-40"
                          >
                            {processing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            Download PDF
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      {selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 px-3 py-3 backdrop-blur-sm sm:items-center">
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#171717] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[#DCA11D]">
                  New transfer
                </p>
                <h2 className="mt-1 text-xl font-black">
                  Transfer space {selectedSlot.slotCode}
                </h2>
                <p className="mt-1 text-xs leading-5 text-white/40">
                  Choose a specific recipient or publish an admin-reviewed marketplace listing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSlot(null);
                  setRecipientOpen(false);
                  setRecipientOptions([]);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/40 hover:bg-white/5 hover:text-white"
                aria-label="Close transfer form"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <fieldset>
                <legend className="text-xs font-bold text-white/50">Transfer method</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { value: "DIRECT", label: "Direct", support: "Choose one customer" },
                    { value: "PUBLIC", label: "Marketplace", support: "Open to customers" },
                  ].map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => {
                        setForm((current) => ({ ...current, mode: option.value }));
                        if (option.value !== "DIRECT") {
                          setRecipientOpen(false);
                          setRecipientOptions([]);
                        }
                      }}
                      className={`min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${
                        form.mode === option.value
                          ? "border-[#DCA11D]/60 bg-[#DCA11D]/10"
                          : "border-white/10 bg-white/[0.025] hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-black">
                        {option.value === "PUBLIC" ? <Globe2 size={15} /> : <ArrowLeftRight size={15} />}
                        {option.label}
                      </span>
                      <span className="mt-1 block text-[11px] text-white/35">{option.support}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {form.mode === "DIRECT" && (
                <label className="relative block">
                  <span className="text-xs font-bold text-white/50">Recipient email</span>
                  <div className="relative mt-1.5">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                    />
                    <input
                      type="email"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={recipientOpen}
                      aria-controls="membership-transfer-recipient-options"
                      autoComplete="off"
                      value={form.toUserEmail}
                      onFocus={() => setRecipientOpen(true)}
                      onBlur={() =>
                        window.setTimeout(() => setRecipientOpen(false), 120)
                      }
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          toUserEmail: event.target.value,
                        }));
                        setRecipientOpen(true);
                      }}
                      className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-10 text-sm outline-none focus:border-[#DCA11D]"
                      placeholder="Search customer email..."
                    />
                    {recipientLoading && (
                      <Loader2
                        size={15}
                        className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/35"
                      />
                    )}
                  </div>
                  {recipientOpen && (
                    <div
                      id="membership-transfer-recipient-options"
                      role="listbox"
                      className="scrollbar-hidden absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#202020] p-1 shadow-2xl"
                    >
                      {!recipientLoading && recipientOptions.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-white/40">
                          No active customer email found.
                        </p>
                      ) : (
                        recipientOptions.map((recipient) => (
                          <button
                            key={recipient._id}
                            type="button"
                            role="option"
                            aria-selected={form.toUserEmail === recipient.email}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setForm((current) => ({
                                ...current,
                                toUserEmail: recipient.email,
                              }));
                              setRecipientOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-white/85">
                                {recipient.email}
                              </span>
                              {recipient.username && (
                                <span className="block truncate text-[11px] text-white/35">
                                  {recipient.username}
                                </span>
                              )}
                            </span>
                            {form.toUserEmail === recipient.email && (
                              <Check size={14} className="shrink-0 text-[#DCA11D]" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </label>
              )}
              <label className="block">
                <span className="text-xs font-bold text-white/50">Transfer price (VND)</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={form.askingPrice}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, askingPrice: event.target.value }))
                  }
                  className="mt-1.5 w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-[#DCA11D] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="0 for a free transfer"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-white/50">Reason</span>
                <textarea
                  rows="2"
                  maxLength="500"
                  value={form.reason}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, reason: event.target.value }))
                  }
                  className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-[#DCA11D]"
                  placeholder="Why are you transferring this parking space?"
                />
              </label>
              <p className="rounded-xl bg-white/5 px-3 py-2.5 text-xs leading-5 text-white/40">
                {form.mode === "PUBLIC"
                  ? "Admin reviews the listing before it appears in Marketplace. The first eligible customer to claim it gets a 15-minute payment window."
                  : "The recipient accepts first, then admin reviews the request before wallet payment."}{" "}
                The price cannot exceed the prorated remaining value and the buyer pays the transfer fee.
              </p>
              <button
                type="button"
                disabled={
                  activeAction.startsWith("create:") ||
                  (form.mode === "DIRECT" && !form.toUserEmail.trim()) ||
                  !form.reason.trim()
                }
                onClick={handleCreate}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#DCA11D] px-5 text-sm font-black text-[#16130B] disabled:opacity-40"
              >
                {activeAction.startsWith("create:") && (
                  <Loader2 size={17} className="animate-spin" />
                )}
                {form.mode === "PUBLIC" ? "Submit marketplace listing" : "Send transfer invitation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { membershipTarget, createMembershipHighlightController } from '../../utils/membershipDeepLink';
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import MembershipDetailModal from "./MembershipDetailModal";
import { useMembershipClock } from '../../hooks/useMembershipClock';
import { membershipDate, membershipTiming, membershipPresentation } from "../../utils/membershipDisplay";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRight,
  CalendarClock,
  Crown,
  Loader2,
  MapPin,
  QrCode,
  RotateCcw,
  Wallet,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { apiFetch } from "../../services/api";
import { notifyAuthChange } from "../../services/authStorage";
import {
  createEntitlementRenewalPayment,
  createRenewalPayment,
  getEntitlementRenewalQuote,
  getMembershipQr,
  getMembershipDetail,
  getRenewalQuote,
  renewEntitlementWithWallet,
  renewSubscriptionWithWallet,
  verifyEntitlementRenewalPayment,
  verifyRenewalPayment,
} from "../../services/subscriptionService";
import PolicyAcceptancePrompt from "../policies/PolicyAcceptancePrompt";
import {
  extractMissingPolicies,
  isPolicyAcceptanceRequired,
} from "../../utils/policyErrors";

const RenewDate = ({ label, value, align = "left" }) => (
  <div className={align === "right" ? "text-right" : ""}>
    <p className="text-xs text-white/35">{label}</p>
    <p className="mt-1 text-sm font-black">
      {new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(value))}
    </p>
  </div>
);

const makeIdempotencyKey = () =>
  window.crypto?.randomUUID?.() ||
  `renew-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function MembershipOwnershipPanel({
  membership,
  membershipLoading = false,
  walletBalance,
  onRefresh,
  onTransfer,
}) {
  useMembershipClock();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const target = useMemo(() => membershipTarget(searchParams), [searchParams]);
  const detailId = target?.invalid ? null : target?.id;
  const detailKind = target?.kind;
  const cardRefs = useRef(new Map());
  const [highlightController] = useState(createMembershipHighlightController);
  useEffect(() => {
    highlightController.update({
      target, navigationKey: location.key,
      cards: membership?.reservedSlots || [], loading: membershipLoading,
      getCard: (index) => cardRefs.current.get(index),
    });
  }, [highlightController, target, location.key, membership?.reservedSlots, membershipLoading]);
  useEffect(() => () => highlightController.dispose(), [highlightController]);
  const missingPackageIds = [...new Set((membership?.reservedSlots || []).filter((slot) => !slot.package?.name).map((slot) => String(slot.sourceSubscriptionId || '')).filter((id) => /^[a-f\d]{24}$/i.test(id)))].sort().join(',');
  const [packageNames, setPackageNames] = useState({});
  useEffect(() => {
    if (!missingPackageIds) return;
    let cancelled = false;
    Promise.all(missingPackageIds.split(',').map(async (id) => {
      try {
        const response = await getMembershipDetail('subscription', id);
        return [id, response.ok && response.data?.success ? response.data.data?.package?.name : null];
      } catch { return [id, null]; }
    })).then((entries) => { if (!cancelled) setPackageNames(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [missingPackageIds]);
  const [renewSubscriptionId, setRenewSubscriptionId] = useState('');
  const openDetail = (slot) => {
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    params.delete('entitlementId'); params.delete('subscriptionId');
    params.set(slot.entitlementId ? 'entitlementId' : 'subscriptionId', slot.entitlementId || slot.sourceSubscriptionId);
    setSearchParams(params);
  };
  const closeDetail = () => {
    highlightController.close(target);
    const params = new URLSearchParams(searchParams);
    if (target && !target.invalid) params.delete('tab');
    params.delete('entitlementId'); params.delete('subscriptionId');
    setSearchParams(params, { replace: true });
  };
  const [membershipQr, setMembershipQr] = useState("");
  const [membershipQrError, setMembershipQrError] = useState("");
  const [membershipQrOpen, setMembershipQrOpen] = useState(false);
  const [renewQuote, setRenewQuote] = useState(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewMethod, setRenewMethod] = useState("wallet");
  const [renewLoading, setRenewLoading] = useState(false);
  const [renewEntitlementId, setRenewEntitlementId] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [policyPrompt, setPolicyPrompt] = useState({
    open: false,
    missingPolicies: [],
  });

  const syncCurrentUserProfile = async () => {
    const { ok, data } = await apiFetch("/profile", {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
      },
    });
    if (!ok || !data?.success) return;

    const cached = JSON.parse(sessionStorage.getItem("valo_user") || "null");
    const updatedUser = {
      ...(cached || {}),
      ...data.data,
      avatar:
        data.data.profile?.avatar ||
        cached?.avatar ||
        cached?.profile?.avatar ||
        "",
    };
    sessionStorage.setItem("valo_user", JSON.stringify(updatedUser));
    notifyAuthChange();
  };

  useEffect(() => {
    let cancelled = false;
    const timerId = window.setTimeout(async () => {
      setMembershipQr("");
      setMembershipQrError("");
      if (membership?.status !== "active" || !membership?.subscriptionId) return;

      try {
        const response = await getMembershipQr();
        if (cancelled) return;
        if (response.ok && response.data?.success && response.data.data?.available) {
          setMembershipQr(response.data.data.payload);
        } else {
          setMembershipQrError(
            response.data?.message || "Membership QR is currently unavailable.",
          );
        }
      } catch {
        if (!cancelled) {
          setMembershipQrError("Membership QR is currently unavailable.");
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [membership?.status, membership?.subscriptionId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const renewalOrderCode = params.get("renewOrderCode");
    const entitlementOrderCode = params.get("entitlementRenewOrderCode");
    if (!renewalOrderCode && !entitlementOrderCode) return undefined;

    if (params.get("cancel") === "true") {
      toast.error("Renewal payment was cancelled.");
      ['renewOrderCode', 'entitlementRenewOrderCode', 'cancel', 'status', 'code', 'id', 'orderCode'].forEach((key) => params.delete(key));
      setSearchParams(params, { replace: true });
      return undefined;
    }

    const startTimerId = window.setTimeout(() => setVerifying(true), 0);
    let attempts = 0;
    const intervalId = window.setInterval(async () => {
      attempts += 1;
      try {
        const response = entitlementOrderCode
          ? await verifyEntitlementRenewalPayment(entitlementOrderCode)
          : await verifyRenewalPayment(renewalOrderCode);
        if (response.ok && response.data?.success) {
          window.clearInterval(intervalId);
          await Promise.all([onRefresh(), syncCurrentUserProfile()]);
          setVerifying(false);
          toast.success("Membership renewal completed.");
          ['renewOrderCode', 'entitlementRenewOrderCode', 'cancel', 'status', 'code', 'id', 'orderCode'].forEach((key) => params.delete(key));
          setSearchParams(params, { replace: true });
        } else if (
          attempts >= 100 ||
          response.data?.code !== "PAYMENT_NOT_COMPLETED"
        ) {
          window.clearInterval(intervalId);
          setVerifying(false);
          toast.error(response.data?.message || "Renewal verification failed.");
          ['renewOrderCode', 'entitlementRenewOrderCode', 'cancel', 'status', 'code', 'id', 'orderCode'].forEach((key) => params.delete(key));
          setSearchParams(params, { replace: true });
        }
      } catch {
        if (attempts >= 100) {
          window.clearInterval(intervalId);
          setVerifying(false);
          toast.error("Renewal verification timed out.");
        }
      }
    }, 3000);

    return () => {
      window.clearTimeout(startTimerId);
      window.clearInterval(intervalId);
    };
  }, [onRefresh, setSearchParams]);

  const openRenewal = async (entitlementId = "", subscriptionId = membership?.subscriptionId) => {
    if (!entitlementId && !subscriptionId) return;
    setRenewLoading(true);
    try {
      const response = entitlementId
        ? await getEntitlementRenewalQuote(entitlementId)
        : await getRenewalQuote(subscriptionId);
      if (!response.ok || !response.data?.success) {
        toast.error(response.data?.message || "Renewal is not available yet.");
        return;
      }
      setRenewQuote(response.data.data);
      setRenewEntitlementId(entitlementId);
      setRenewSubscriptionId(subscriptionId || "");
      setRenewMethod(
        walletBalance >= Number(response.data.data.amount || 0) ? "wallet" : "payos",
      );
      setRenewOpen(true);
    } catch {
      toast.error("Unable to load the renewal quote.");
    } finally {
      setRenewLoading(false);
    }
  };

  const confirmRenewal = async () => {
    if ((!renewSubscriptionId && !renewEntitlementId) || !renewQuote) return;
    if (renewMethod === "wallet" && walletBalance < renewQuote.amount) {
      toast.error("Your wallet balance is not enough for this renewal.");
      return;
    }

    setRenewLoading(true);
    try {
      const idempotencyKey = makeIdempotencyKey();
      const response =
        renewMethod === "wallet"
          ? renewEntitlementId
            ? await renewEntitlementWithWallet(renewEntitlementId, idempotencyKey)
            : await renewSubscriptionWithWallet(
                renewSubscriptionId,
                idempotencyKey,
              )
          : renewEntitlementId
            ? await createEntitlementRenewalPayment(
                renewEntitlementId,
                idempotencyKey,
              )
            : await createRenewalPayment(
                renewSubscriptionId,
                idempotencyKey,
              );

      if (isPolicyAcceptanceRequired(response.data)) {
        setPolicyPrompt({
          open: true,
          missingPolicies: extractMissingPolicies(response.data),
        });
        return;
      }
      if (!response.ok || !response.data?.success) {
        toast.error(response.data?.message || "Unable to renew this membership.");
        return;
      }
      if (renewMethod === "payos" && response.data.data?.checkoutUrl) {
        window.location.href = response.data.data.checkoutUrl;
        return;
      }

      await Promise.all([onRefresh(), syncCurrentUserProfile()]);
      setRenewOpen(false);
      setRenewQuote(null);
      toast.success("Membership renewal completed.");
    } catch {
      toast.error("Unable to renew this membership.");
    } finally {
      setRenewLoading(false);
    }
  };

  return (
    <>
      {target?.invalid && <div role="alert" className="mt-4 text-sm text-amber-200">This membership link is invalid. <button type="button" onClick={closeDetail} className="min-h-11 underline">Dismiss</button></div>}
      {detailId && !membershipLoading && !renewOpen && <MembershipDetailModal key={`${detailKind}-${detailId}`} id={detailId} kind={detailKind} refreshKey={membership} onClose={closeDetail} onRenew={openRenewal} renewLoading={renewLoading} />}
      {verifying && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#0D0D0D]/95">
          <Loader2 size={44} className="animate-spin text-[#DCA11D]" />
          <p className="mt-4 text-sm font-bold text-white/55">
            Verifying renewal payment...
          </p>
        </div>
      )}

      {membership?.package && (
        <section className="mt-6 overflow-hidden rounded-3xl border border-[#DCA11D]/20 bg-[#111318] shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
          <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
            <div className="relative p-6 sm:p-8">
              <div className="absolute inset-y-0 left-0 w-1 bg-[#DCA11D]" />
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#DCA11D]/10 text-[#E8B63E]">
                      <Crown size={21} />
                    </span>
                    <div>
                      <p className="text-xs font-bold text-white/45">
                        Current membership
                      </p>
                      <h2 className="mt-1 text-2xl font-black tracking-tight">
                        {membership.package.name}
                      </h2>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-x-7 gap-y-3 text-sm text-white/60">
                    <span className="flex items-center gap-2">
                      <CalendarClock size={16} className="text-[#E8B63E]" />
                      {membership.earliestExpireAt
                        ? `Next space expiry: ${membershipTiming(membership.earliestExpireAt, membership.status).label}`
                        : membershipTiming(membership.expireAt, membership.status).label}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin size={16} className="text-[#E8B63E]" />
                      {membership.reservedSlots?.length || 0} reserved spaces
                    </span>
                  </div>
                  {membership.status === "active" && (
                    <button
                      type="button"
                      onClick={() => setMembershipQrOpen(true)}
                      disabled={!membershipQr}
                      className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#DCA11D]/35 bg-[#DCA11D]/10 px-4 text-sm font-black text-[#E8B63E] transition hover:bg-[#DCA11D]/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <QrCode size={17} />
                      {membershipQr ? "Show membership QR" : "QR unavailable"}
                    </button>
                  )}
                  {membershipQrError && (
                    <p className="mt-2 text-xs text-rose-300">
                      {membershipQrError}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                    membership.status === "active"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                      : "border-rose-500/20 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  {membership.status === "active" ? "Active" : "Expired"}
                </span>
              </div>
            </div>

            <div className="flex flex-col justify-center border-t border-white/5 bg-white/[0.025] p-6 sm:p-8 lg:border-l lg:border-t-0">
              <p className="text-xs font-bold text-white/45">Renewal</p>
              <p className="mt-2 text-sm leading-6 text-white/65">
                {membership.renewal?.message}
              </p>
              <button
                type="button"
                onClick={() => openRenewal()}
                disabled={
                  membership.reservedSlots?.some((slot) => slot.entitlementId) ||
                  !membershipPresentation(membership).canRenew ||
                  renewLoading
                }
                className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#DCA11D] px-5 text-sm font-black text-[#16130B] transition hover:bg-[#E8B63E] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
              >
                {renewLoading ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <RotateCcw size={17} />
                )}
                {membership.reservedSlots?.some((slot) => slot.entitlementId)
                  ? "Renew each space below"
                  : membership.renewal?.canRenew
                    ? "Review renewal"
                    : "Renewal unavailable"}
              </button>
            </div>
          </div>
        </section>
      )}

      {membership?.reservedSlots?.length > 0 && (
        <section className="mt-6 rounded-3xl border border-white/10 bg-[#151515] p-5 sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#DCA11D]">
                Individual entitlements
              </p>
              <h2 className="mt-1 text-xl font-black">
                Your reserved parking spaces
              </h2>
            </div>
            <span className="text-sm font-bold text-white/35">
              {membership.reservedSlots.length}/3 spaces
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {membership.reservedSlots.map((slot, index) => (
              <article
                key={slot.entitlementId || `${slot.floorId}-${slot.slotCode}`}
                ref={(element) => { if (element) cardRefs.current.set(index, element); else cardRefs.current.delete(index); }}
                onClick={() => openDetail(slot)}
                className="membership-space-card rounded-2xl border border-white/10 bg-white/[0.025] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-white/65">{slot.package?.name || packageNames[String(slot.sourceSubscriptionId)] || "Package unavailable"}</p>
                    <p className="mt-1 text-lg font-black">Space {slot.slotCode}</p>
                    <p className="mt-1 text-xs text-white/40">
                      {slot.floorName || (slot.floorNumber != null ? `Floor ${slot.floorNumber}` : "Floor unavailable")}
                    </p>
                  </div>
                  <span className={`membership-status membership-status--${membershipPresentation(slot).state.toLowerCase()}`}>
                    {membershipPresentation(slot).statusLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs text-white/60">{membershipTiming(slot.expireAt, slot.status || "active").label}</p>
                <p className="mt-2 text-xs text-white/60">{membershipPresentation(slot).renewalMessage}</p>
                <button type="button" onClick={(event) => { event.stopPropagation(); openDetail(slot); }} className="mt-3 min-h-10 text-sm text-amber-300 underline">View details</button>
                {slot.expireAt && (
                  <p className="mt-4 text-xs text-white/45">
                    Valid until{" "}
                    <strong className="text-white/75">
                      {membershipDate(slot.expireAt)}
                    </strong>
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); openRenewal(slot.entitlementId || "", slot.sourceSubscriptionId); }}
                    disabled={!membershipPresentation(slot).canRenew || renewLoading}
                    className="min-h-10 rounded-xl bg-white px-3 text-xs font-black text-black transition hover:bg-white/85 disabled:opacity-35"
                  >
                    Renew
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onTransfer(slot); }}
                    disabled={!slot.canTransfer}
                    className="min-h-10 rounded-xl border border-[#DCA11D]/30 bg-[#DCA11D]/10 px-3 text-xs font-black text-[#E8B63E] transition hover:bg-[#DCA11D]/15 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Transfer
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {renewOpen && renewQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#13151A] shadow-2xl">
            <div className="flex items-start justify-between border-b border-white/5 p-6">
              <div>
                <p className="text-xs font-bold text-[#DCA11D]">Keep your place</p>
                <h3 className="mt-2 text-2xl font-black">
                  Renew {renewQuote.package?.name}
                </h3>
                <p className="mt-2 text-sm text-white/50">
                  Review the new period before payment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRenewOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-white/45 hover:bg-white/5 hover:text-white"
                aria-label="Close renewal review"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-6 p-6">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-white/[0.035] p-4">
                <RenewDate label="Current expiry" value={renewQuote.currentExpireAt} />
                <ArrowRight size={18} className="text-[#DCA11D]" />
                <RenewDate
                  label="New expiry"
                  value={renewQuote.newExpireAt}
                  align="right"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="border-l border-white/10 pl-4">
                  <p className="text-xs text-white/40">Spaces retained</p>
                  <p className="mt-1 text-xl font-black">
                    {renewQuote.retainedSlots?.length || 1}
                  </p>
                </div>
                <div className="border-l border-white/10 pl-4">
                  <p className="text-xs text-white/40">Renewal total</p>
                  <p className="mt-1 text-xl font-black text-[#E8B63E]">
                    {Number(renewQuote.amount || 0).toLocaleString("vi-VN")} VND
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-3 text-xs font-bold text-white/45">
                  Payment method
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: "wallet", label: "VALO Wallet", Icon: Wallet },
                    { id: "payos", label: "PayOS QR", Icon: QrCode },
                  ].map(({ id, label, Icon }) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() => setRenewMethod(id)}
                      className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border text-sm font-bold ${
                        renewMethod === id
                          ? "border-[#DCA11D]/60 bg-[#DCA11D]/10 text-[#E8B63E]"
                          : "border-white/10 bg-white/[0.025] text-white/55"
                      }`}
                    >
                      <Icon size={18} />
                      {label}
                    </button>
                  ))}
                </div>
                {renewMethod === "wallet" && walletBalance < renewQuote.amount && (
                  <p className="mt-3 text-xs text-rose-300">
                    Wallet shortfall:{" "}
                    {Number(renewQuote.amount - walletBalance).toLocaleString("vi-VN")}{" "}
                    VND
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={confirmRenewal}
                disabled={
                  renewLoading ||
                  (renewMethod === "wallet" && walletBalance < renewQuote.amount)
                }
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#DCA11D] px-5 text-sm font-black text-[#16130B] disabled:opacity-40"
              >
                {renewLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <RotateCcw size={18} />
                )}
                Pay {Number(renewQuote.amount || 0).toLocaleString("vi-VN")} VND
              </button>
            </div>
          </div>
        </div>
      )}

      {membershipQrOpen && membershipQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center text-gray-900 shadow-2xl">
            <div className="flex items-start justify-between text-left">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[#B9820D]">
                  Parking access
                </p>
                <h3 className="mt-1 text-xl font-black">Membership QR</h3>
              </div>
              <button
                type="button"
                onClick={() => setMembershipQrOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100"
                aria-label="Close membership QR"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mx-auto mt-6 inline-flex rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <QRCodeSVG value={membershipQr} size={230} level="M" includeMargin />
            </div>
            <p className="mt-5 text-sm leading-6 text-gray-500">
              Show this code to staff when the kiosk is unavailable. Staff must
              photograph the vehicle before check-in or check-out.
            </p>
            <p className="mt-2 text-xs font-semibold text-rose-500">
              This QR automatically becomes invalid when the membership expires.
            </p>
          </div>
        </div>
      )}

      <PolicyAcceptancePrompt
        open={policyPrompt.open}
        missingPolicies={policyPrompt.missingPolicies}
        onClose={() => setPolicyPrompt({ open: false, missingPolicies: [] })}
        onAccepted={() => {
          setPolicyPrompt({ open: false, missingPolicies: [] });
          confirmRenewal();
        }}
      />
    </>
  );
}

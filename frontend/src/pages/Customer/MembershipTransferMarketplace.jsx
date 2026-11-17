import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Clock3,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import CustomerPageHeader from "../../components/Customer/CustomerPageHeader";
import {
  claimMembershipTransferListing,
  getMembershipTransferListing,
  getMembershipTransferMarketplace,
  settleEntitlementTransfer,
} from "../../services/subscriptionService";
import { getWalletInfo } from "../../services/walletService";
import { useLanguage } from "../../i18n/hooks/useLanguage";

const money = (value) => `${Number(value || 0).toLocaleString("vi-VN")} VND`;
const dateTime = (value) => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
};

const unwrapList = (response) => {
  const payload = response?.data?.data;
  if (Array.isArray(payload)) return { items: payload, pagination: null };
  return {
    items: payload?.items || payload?.transfers || payload?.listings || [],
    pagination: payload?.pagination || null,
  };
};

const listingId = (listing) => String(listing?.transferId || listing?._id || "");

export default function MembershipTransferMarketplace({ embedded = false }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { transferId: routeTransferId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = routeTransferId || searchParams.get("transferId") || "";
  const [listings, setListings] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [selected, setSelected] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    minPrice: "",
    maxPrice: "",
    sort: "newest",
  });

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const [listingResponse, walletResponse] = await Promise.all([
        getMembershipTransferMarketplace({
          minPrice: filters.minPrice,
          maxPrice: filters.maxPrice,
          sort: filters.sort,
          limit: 50,
        }),
        getWalletInfo(),
      ]);
      if (!listingResponse.ok || !listingResponse.data?.success) {
        throw new Error(listingResponse.data?.message || "Unable to load marketplace.");
      }
      const normalized = unwrapList(listingResponse);
      setListings(normalized.items);
      setPagination(normalized.pagination);
      if (walletResponse.ok && walletResponse.data?.success) {
        setWalletBalance(Number(walletResponse.data.data?.balance || 0));
      }
    } catch (error) {
      toast.error(error.message || "Unable to load marketplace.");
    } finally {
      setLoading(false);
    }
  }, [filters.maxPrice, filters.minPrice, filters.sort]);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setSelected(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await getMembershipTransferListing(id);
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.message || "This listing is no longer available.");
      }
      const detail = response.data.data;
      setSelected(detail);
      if (detail?.walletBalance !== undefined) {
        setWalletBalance(Number(detail.walletBalance || 0));
      }
    } catch (error) {
      setSelected(null);
      toast.error(error.message || "Unable to load listing.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(loadListings, 0);
    return () => window.clearTimeout(timerId);
  }, [loadListings]);

  useEffect(() => {
    const timerId = window.setTimeout(() => loadDetail(selectedId), 0);
    return () => window.clearTimeout(timerId);
  }, [loadDetail, selectedId]);

  const visibleListings = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    if (!term) return listings;
    return listings.filter((item) =>
      [
        item.slotCode,
        item.parkingLot?.name,
        item.parkingLot?.address,
        item.floor?.name,
        item.package?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [filters.search, listings]);

  const openDetail = (id) => {
    if (routeTransferId) {
      navigate(
        id
          ? `/customer/membership-transfer-marketplace/${encodeURIComponent(id)}`
          : "/customer/membership-transfer-marketplace",
      );
      return;
    }
    setSearchParams(
      embedded
        ? id
          ? { tab: "marketplace", transferId: id }
          : { tab: "marketplace" }
        : id
          ? { transferId: id }
          : {},
    );
  };

  const refreshAll = async () => {
    await loadListings();
    if (selectedId) await loadDetail(selectedId);
  };

  const handleClaim = async () => {
    const id = listingId(selected);
    if (!id) return;
    setActiveAction(`claim:${id}`);
    try {
      const response = await claimMembershipTransferListing(id);
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.message || "Unable to claim this listing.");
      }
      const claim = response.data.data || {};
      setSelected((current) => ({
        ...current,
        ...claim,
        status: "AWAITING_PAYMENT",
        canSettle: true,
      }));
      if (claim.walletBalance !== undefined) {
        setWalletBalance(Number(claim.walletBalance || 0));
      }
      toast.success("Listing reserved for 15 minutes. Complete wallet payment now.");
      await loadListings();
    } catch (error) {
      toast.error(error.message || "Another customer may have claimed this listing.");
      await loadDetail(id);
    } finally {
      setActiveAction("");
    }
  };

  const handleSettle = async () => {
    const id = listingId(selected);
    if (!id) return;
    setActiveAction(`settle:${id}`);
    try {
      const response = await settleEntitlementTransfer(id);
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.message || "Unable to complete payment.");
      }
      toast.success("Payment complete. The membership space is now yours.");
      openDetail("");
      await loadListings();
    } catch (error) {
      toast.error(error.message || "Unable to complete payment.");
    } finally {
      setActiveAction("");
    }
  };

  return (
    <div
      className={
        embedded
          ? "text-white"
          : "min-h-full bg-[#0D0D0D] px-4 py-6 text-white sm:px-6 lg:px-8"
      }
    >
      {!embedded && <Toaster position="top-right" />}
      <div className={embedded ? "" : "mx-auto max-w-7xl"}>
        {!embedded && <CustomerPageHeader
          icon={ShoppingBag}
          title={t('marketplacePage.title')}
          description={t('marketplacePage.description')}
          className="border-b border-white/10 pb-6"
          action={
            <button
              type="button"
              onClick={refreshAll}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              {t('common.refresh')}
            </button>
          }
        />}

        {embedded && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={refreshAll}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              {t('common.refresh')}
            </button>
          </div>
        )}

        <section className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-[#151515] p-4 md:grid-cols-[1fr_140px_140px_180px]">
          <label className="relative">
            <span className="sr-only">{t('marketplacePage.searchLabel')}</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={17} />
            <input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder={t('marketplacePage.searchPlaceholder')}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-black/30 pl-10 pr-3 text-sm outline-none transition placeholder:text-white/25 focus:border-[#DCA11D]/60"
            />
          </label>
          <input
            type="number"
            min="0"
            value={filters.minPrice}
            onChange={(event) => setFilters((current) => ({ ...current, minPrice: event.target.value }))}
            placeholder={t('marketplacePage.minPrice')}
            aria-label={t('marketplacePage.minPrice')}
            className="min-h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none focus:border-[#DCA11D]/60"
          />
          <input
            type="number"
            min="0"
            value={filters.maxPrice}
            onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))}
            placeholder={t('marketplacePage.maxPrice')}
            aria-label={t('marketplacePage.maxPrice')}
            className="min-h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none focus:border-[#DCA11D]/60"
          />
          <label className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
            <select
              value={filters.sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
              aria-label={t('marketplacePage.sortLabel')}
              className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-black/30 pl-10 pr-3 text-sm outline-none focus:border-[#DCA11D]/60"
            >
              <option value="newest">{t('marketplacePage.newest')}</option>
              <option value="price_asc">{t('marketplacePage.lowestPrice')}</option>
              <option value="expiry_asc">{t('marketplacePage.expiringSoon')}</option>
            </select>
          </label>
        </section>

        <div className="mt-5 flex items-center justify-between text-xs text-white/35">
          <span>{t('marketplacePage.availableListings', { count: visibleListings.length })}</span>
          {pagination?.totalPages > 1 && <span>{t('marketplacePage.pageOf', { page: pagination.page, total: pagination.totalPages })}</span>}
        </div>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-white/40">
            <Loader2 className="animate-spin" size={26} />
          </div>
        ) : visibleListings.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-white/10 p-12 text-center">
            <ShoppingBag className="mx-auto text-white/20" size={34} />
            <h2 className="mt-4 font-black">{t('marketplacePage.noMatches')}</h2>
            <p className="mt-2 text-sm text-white/40">{t('marketplacePage.noMatchesHint')}</p>
          </div>
        ) : (
          <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleListings.map((item) => (
              <article
                key={listingId(item)}
                className="group flex flex-col rounded-3xl border border-white/10 bg-[#151515] p-5 transition hover:-translate-y-0.5 hover:border-[#DCA11D]/35 motion-reduce:transform-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#DCA11D]">
                      {item.package?.name || "Membership space"}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">{item.slotCode || "VIP slot"}</h2>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-300">
                    {t('marketplacePage.available')}
                  </span>
                </div>
                <div className="mt-5 space-y-2 text-sm text-white/50">
                  <p className="flex items-center gap-2"><Building2 size={15} /> {item.parkingLot?.name || "Parking lot"}</p>
                  <p className="flex items-center gap-2"><MapPin size={15} /> {item.floor?.name || item.parkingLot?.address || "Floor details unavailable"}</p>
                  <p className="flex items-center gap-2"><CalendarClock size={15} /> Valid until {dateTime(item.expireAt)}</p>
                </div>
                <div className="mt-6 border-t border-white/10 pt-4">
                  <p className="text-xs text-white/35">{t('marketplacePage.totalDue')}</p>
                  <p className="mt-1 text-xl font-black text-[#E8B63E]">{money(item.totalDue ?? Number(item.askingPrice || 0) + Number(item.transferFee || 0))}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openDetail(listingId(item))}
                  className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-[#F4D06F]"
                >
                  {t('marketplacePage.viewDetails')} <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </section>
        )}
      </div>

      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={() => openDetail("")}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketplace-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#161616] p-5 shadow-2xl sm:rounded-3xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#DCA11D]">{t('marketplacePage.verifiedListing')}</p>
                <h2 id="marketplace-detail-title" className="mt-2 text-2xl font-black">{t('marketplacePage.membershipTransfer')}</h2>
              </div>
              <button type="button" onClick={() => openDetail("")} aria-label={t('common.close')} className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-white/50 hover:bg-white/5 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-white/40" /></div>
            ) : selected ? (
              <>
                <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-white/40">{selected.package?.name || "Membership package"}</p>
                      <p className="mt-1 text-3xl font-black">{selected.slotCode || "VIP slot"}</p>
                    </div>
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-300">
                      {selected.canSettle
                        ? t('marketplacePage.reservedByYou')
                        : selected.status === "LISTED"
                          ? t('marketplacePage.available')
                          : t('marketplacePage.unavailable')}
                    </span>
                  </div>
                  <div className="mt-5 grid gap-3 text-sm text-white/50 sm:grid-cols-2">
                    <p><span className="block text-xs text-white/25">{t('marketplacePage.parkingLot')}</span>{selected.parkingLot?.name || t('marketplacePage.notAvailable')}</p>
                    <p><span className="block text-xs text-white/25">{t('marketplacePage.floor')}</span>{selected.floor?.name || t('marketplacePage.notAvailable')}</p>
                    <p><span className="block text-xs text-white/25">{t('marketplacePage.membershipExpires')}</span>{dateTime(selected.expireAt)}</p>
                    <p><span className="block text-xs text-white/25">{t('marketplacePage.listingExpires')}</span>{dateTime(selected.listingExpiresAt)}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 p-5">
                  <div className="flex justify-between text-sm text-white/45"><span>{t('marketplacePage.sellerPrice')}</span><span>{money(selected.askingPrice)}</span></div>
                  <div className="mt-3 flex justify-between text-sm text-white/45"><span>{t('marketplacePage.transferFee')}</span><span>{money(selected.transferFee)}</span></div>
                  <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                    <div><p className="text-xs text-white/35">{t('marketplacePage.walletBalance')}</p><p className="mt-1 font-bold">{money(walletBalance)}</p></div>
                    <div className="text-right"><p className="text-xs text-white/35">{t('marketplacePage.totalDue')}</p><p className="mt-1 text-xl font-black text-[#E8B63E]">{money(selected.totalDue ?? Number(selected.askingPrice || 0) + Number(selected.transferFee || 0))}</p></div>
                  </div>
                </div>

                {selected.canSettle && selected.lockExpiresAt && (
                  <p className="mt-4 flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-200">
                    <Clock3 size={16} /> Reservation ends {dateTime(selected.lockExpiresAt)}
                  </p>
                )}

                {selected.canSettle ? (
                  walletBalance >= Number(selected.totalDue ?? Number(selected.askingPrice || 0) + Number(selected.transferFee || 0)) ? (
                    <button type="button" onClick={handleSettle} disabled={Boolean(activeAction)} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#DCA11D] px-5 font-black text-[#16130B] disabled:opacity-50">
                      {activeAction ? <Loader2 size={17} className="animate-spin" /> : <Wallet size={17} />} {t('marketplacePage.payFromWallet')}
                    </button>
                  ) : (
                    <div className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
                      <p>{t('marketplacePage.insufficientBalance')}</p>
                      <button
                        type="button"
                        onClick={() => navigate("/customer/wallet")}
                        className="mt-3 min-h-10 rounded-lg border border-rose-200/20 px-4 text-xs font-black text-rose-100 hover:bg-rose-100/10"
                      >
                        {t('walletPage.topUp')}
                      </button>
                    </div>
                  )
                ) : selected.status === "LISTED" ? (
                  <button type="button" onClick={handleClaim} disabled={Boolean(activeAction) || selected.status !== "LISTED"} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 font-black text-black transition hover:bg-[#F4D06F] disabled:cursor-not-allowed disabled:opacity-50">
                    {activeAction ? <Loader2 size={17} className="animate-spin" /> : <ShoppingBag size={17} />} {t('marketplacePage.reserve15')}
                  </button>
                ) : (
                  <p className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
                    {t('marketplacePage.unavailable')}
                  </p>
                )}
                <p className="mt-3 text-center text-xs leading-5 text-white/30">{t('marketplacePage.claimHint')}</p>
              </>
            ) : (
              <div className="py-12 text-center text-white/45">{t('marketplacePage.unavailable')}</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

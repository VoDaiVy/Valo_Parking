import SocketContext from '../../contexts/SocketProvider';
import { useContext, useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import MembershipHistoryDrawer from '../../components/membership/MembershipHistoryDrawer';
import { ArrowLeftRight, ShoppingBag, History, RefreshCw } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import CustomerPageHeader from "../../components/Customer/CustomerPageHeader";
import MembershipTransferMarketplace from "./MembershipTransferMarketplace";
import MembershipTransfers from "./MembershipTransfers";
import MembershipServices from '../../components/membership/MembershipServices';

const TABS = [
  {
    id: "transfers",
    label: 'membershipHub.myMembership',
    icon: ArrowLeftRight,
  },
  {
    id: "marketplace",
    label: 'membershipHub.marketplace',
    icon: ShoppingBag,
  },
];

export default function MembershipHub() {
  const socket = useContext(SocketContext);
  const refreshMembership = () => window.dispatchEvent(new Event('membership:refresh'));
  useEffect(() => {
    const refresh = () => window.dispatchEvent(new Event('membership:refresh'));
    const notification = (payload) => {
      const type = payload?.metadata?.eventType || payload?.notification?.metadata?.eventType || '';
      if (/MEMBERSHIP|ENTITLEMENT|TRANSFER/.test(type)) refresh();
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    socket?.on('notification:new', notification);
    socket?.on('connect', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      socket?.off('notification:new', notification);
      socket?.off('connect', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [socket]);
  const { t } = useLanguage();
  const [historyOpen, setHistoryOpen] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hash, key: locationKey } = useLocation();
  useEffect(() => {
    if (hash !== '#membership-services') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('membership-services')?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, locationKey]);
  const activeTab = !searchParams.has("entitlementId") && !searchParams.has("subscriptionId") && searchParams.get("tab") === "marketplace" ? "marketplace" : "transfers";

  const changeTab = (tab) => {
    const params = new URLSearchParams(searchParams);
    params.delete('entitlementId'); params.delete('subscriptionId');
    if (tab === 'marketplace') params.set('tab', 'marketplace');
    else params.delete('tab');
    navigate({ pathname: '/customer/membership-transfers', search: params.toString() });
  };

  const handleTabKeyDown = (event, currentTab) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const nextTab =
      event.key === "Home"
        ? TABS[0].id
        : event.key === "End"
          ? TABS[TABS.length - 1].id
          : currentTab === "transfers"
            ? "marketplace"
            : "transfers";

    changeTab(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(`membership-tab-${nextTab}`)?.focus();
    });
  };

  return (
    <div className="min-h-full bg-[#0D0D0D] px-4 py-6 text-white sm:px-6 lg:px-8">
      <Toaster position="top-right" />
      <div className="mx-auto max-w-7xl">
        <CustomerPageHeader
          icon={ArrowLeftRight}
          title={t('membershipHub.title')}
          description={t('membershipHub.description')}
          action={<div className="flex gap-2"><button type="button" onClick={refreshMembership} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-white hover:bg-white/10"><RefreshCw size={17} />{t('common.refresh')}</button><button type="button" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10"><History size={17} aria-hidden="true" />{t('membershipHub.history')}</button></div>}
          className="border-b border-white/10 pb-6"
        />

        {historyOpen && <MembershipHistoryDrawer onClose={() => setHistoryOpen(false)} />}
        <nav
          role="tablist"
          aria-label={t('membershipHub.sections')}
          className="mt-6 grid rounded-2xl border border-white/10 bg-[#151515] p-1.5 sm:inline-grid sm:grid-cols-2"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                id={`membership-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`membership-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => changeTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition ${
                  selected
                    ? "bg-[#DCA11D] text-[#16130B]"
                    : "text-white/45 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                <Icon size={16} />
                {t(tab.label)}
              </button>
            );
          })}
        </nav>

        <div
          id={`membership-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`membership-tab-${activeTab}`}
          className="mt-6"
        >
          {activeTab === "marketplace" ? (
            <MembershipTransferMarketplace embedded />
          ) : (
            <MembershipTransfers embedded />
          )}
        </div>
        <div id="membership-services"><MembershipServices key={locationKey} /></div>
      </div>
    </div>
  );
}

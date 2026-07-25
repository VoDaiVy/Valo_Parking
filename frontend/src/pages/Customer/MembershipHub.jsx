import { ArrowLeftRight, ShoppingBag } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import CustomerPageHeader from "../../components/Customer/CustomerPageHeader";
import MembershipTransferMarketplace from "./MembershipTransferMarketplace";
import MembershipTransfers from "./MembershipTransfers";

const TABS = [
  {
    id: "transfers",
    label: "My Membership",
    icon: ArrowLeftRight,
  },
  {
    id: "marketplace",
    label: "Marketplace",
    icon: ShoppingBag,
  },
];

export default function MembershipHub() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "marketplace" ? "marketplace" : "transfers";

  const changeTab = (tab) => {
    navigate(
      tab === "marketplace"
        ? "/customer/membership-transfers?tab=marketplace"
        : "/customer/membership-transfers",
    );
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
          title="Membership"
          description="Manage your membership spaces and transfers, or find an available space in the marketplace."
          className="border-b border-white/10 pb-6"
        />

        <nav
          role="tablist"
          aria-label="Membership sections"
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
                {tab.label}
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
      </div>
    </div>
  );
}

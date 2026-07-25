import { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { apiFetch } from "../services/api";
import { logoutUser } from "../services/authService";
import { clearAuthSession, notifyAuthChange } from "../services/authStorage";
import logoImg from "../assets/images/logo.png";
import { useNotifications } from "../hooks/useNotifications";
import { sendInternalReport } from "../services/notificationService";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  ParkingCircle,
  Ticket,
  Wrench,
  BarChart2,
  DollarSign,
  Crown,
  // Customer icons
  Home,
  User,
  Wallet,
  Settings,
  History,
  // Manager icons
  MonitorCheck,
  Car,
  ScrollText,
  BookOpen,
  CalendarCheck,
  ArrowLeftRight,
  ShoppingBag,
  // Common
  Bell,
  LogOut,
  Menu,
  ChevronDown,
  AlertTriangle,
  X,
  Send,
  Loader2,
} from "lucide-react";

// ─── Nav configs per role ─────────────────────────────────────────────────────
const NAV_CONFIG = {
  admin: [
    {
      label: "Overview",
      icon: <LayoutDashboard size={18} />,
      to: "/admin/dashboard",
    },
    {
      label: "Account Management",
      icon: <Users size={18} />,
      to: "/admin/accounts",
    },
    {
      label: "Parking Lots",
      icon: <ParkingCircle size={18} />,
      to: "/admin/parking-lots",
    },
    {
      label: "Pricing",
      icon: <DollarSign size={18} />,
      to: "/admin/pricing",
    },
    {
      label: "Ticket Packages",
      icon: <Ticket size={18} />,
      to: "/admin/tickets",
    },
    {
      label: "Subscriptions",
      icon: <Crown size={18} />,
      to: "/admin/subscriptions",
    },
    { label: "Services", icon: <Wrench size={18} />, to: "/admin/services" },
    { label: "Policies", icon: <ScrollText size={18} />, to: "/admin/policies" },
    {
      label: "Vehicles & 3D",
      icon: <Car size={18} />,
      to: "/admin/vehicle-models",
    },
    {
      label: "Revenue Analytics",
      icon: <BarChart2 size={18} />,
      to: "/admin/revenue",
    },
  ],
  staff: [
    {
      label: "Overview",
      icon: <LayoutDashboard size={18} />,
      to: "/staff/dashboard",
    },
    {
      label: "Customer Management",
      icon: <Users size={18} />,
      to: "/staff/accounts",
    },
    {
      label: "Session Management",
      icon: <MonitorCheck size={18} />,
      to: "/staff/sessions",
    },
    {
      label: "Live Grid Monitor",
      icon: <MonitorCheck size={18} />,
      to: "/staff/live-grid",
    },
    { label: "Gate Control", icon: <Car size={18} />, to: "/staff/gate" },
    {
      label: "Booking Management",
      icon: <BookOpen size={18} />,
      to: "/staff/bookings",
    },
    {
      label: "Ticket Packages",
      icon: <Ticket size={18} />,
      to: "/staff/tickets",
    },
    {
      label: "Subscriptions",
      icon: <Crown size={18} />,
      to: "/staff/subscriptions",
    },
    {
      label: "Notification Management",
      icon: <Bell size={18} />,
      to: "/staff/notifications",
    },
  ],
  customer: [
    { label: "Home", icon: <Home size={18} />, to: "/" },
    { label: "Profile", icon: <User size={18} />, to: "/profile" },
    {
      label: "Membership ",
      icon: <ArrowLeftRight size={18} />,
      to: "/customer/membership-transfers",
    },
    {
      label: "Transfer Marketplace",
      icon: <ShoppingBag size={18} />,
      to: "/customer/membership-transfer-marketplace",
    },
    { label: "My Vehicles", icon: <Car size={18} />, to: "/customer/vehicles" },
    {
      label: "My Bookings",
      icon: <CalendarCheck size={18} />,
      to: "/customer/booking",
    },
    { label: "History", icon: <History size={18} />, to: "/customer/history" },
    { label: "Wallet", icon: <Wallet size={18} />, to: "/customer/wallet" },
    {
      label: "Settings",
      icon: <Settings size={18} />,
      to: "/customer/settings",
    },
  ],
};

const ROLE_THEME = {
  admin: {
    accent: "from-yellow-400 to-yellow-600",
    activeBg: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    activeHover: "hover:text-yellow-300",
    badge: { cls: "bg-red-900/50 text-red-400", label: "Admin" },
    panelLabel: "Admin Panel",
    headerBadgeCls: "bg-red-500/10 border-red-500/20 text-red-400",
  },
  staff: {
    accent: "from-emerald-400 to-teal-600",
    activeBg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    activeHover: "hover:text-emerald-300",
    badge: { cls: "bg-emerald-900/50 text-emerald-400", label: "Staff" },
    panelLabel: "Staff Panel",
    headerBadgeCls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  },
  customer: {
    accent: "from-yellow-400 to-yellow-600",
    activeBg: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    activeHover: "hover:text-yellow-300",
    badge: { cls: "bg-yellow-900/50 text-yellow-400", label: "Customer" },
    panelLabel: "My Account",
    headerBadgeCls: "bg-yellow-500/10 border-yellow-500/20 text-yellow-400",
  },
};

const getInitials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function DashboardLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() =>
    JSON.parse(sessionStorage.getItem("valo_user") || "{}"),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  // Hook for notifications
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    hasMore,
    fetchMore,
    markAsRead,
    markAllAsRead,
  } =
    useNotifications({ contextRole: user?.role });

  const role = user?.role;
  const navItems = NAV_CONFIG[role] || [];
  const theme = ROLE_THEME[role] || ROLE_THEME.admin;
  const displayName = user
    ? [user.profile?.firstName, user.profile?.lastName]
      .filter(Boolean)
      .join(" ") ||
    user.username ||
    "User"
    : "User";

  // Always dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Listen for auth changes (including profile updates)
  useEffect(() => {
    const handleAuthChange = () => {
      setUser(JSON.parse(sessionStorage.getItem("valo_user") || "{}"));
    };
    window.addEventListener("valo_auth_change", handleAuthChange);
    return () =>
      window.removeEventListener("valo_auth_change", handleAuthChange);
  }, []);

  // Fetch profile if avatar or membership metadata is missing
  useEffect(() => {
    const fetchProfileAvatar = async () => {
      if (!user || Object.keys(user).length === 0) return;
      const needsProfile = !user.profile || (user.membership?.isVip && !user.membership?.packageType);
      if (!needsProfile) return;

      const token = localStorage.getItem("accessToken");
      if (!token) return;

      try {
        const { ok, data } = await apiFetch("/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (ok && data?.success) {
          const freshAvatar = data.data.profile?.avatar || "";
          const updatedUser = {
            ...user,
            ...data.data,
            avatar: freshAvatar || user.avatar || user.profile?.avatar || user.avatarUrl || "",
          };
          sessionStorage.setItem("valo_user", JSON.stringify(updatedUser));
          setUser(updatedUser);
          notifyAuthChange();
        }
      } catch (err) {
        console.error("Failed fetching profile for avatar sync", err);
      }
    };

    fetchProfileAvatar();
  }, [user]);

  const handleSendReport = async () => {
    if (!reportContent.trim()) return;
    try {
      setReportLoading(true);
      const res = await sendInternalReport(reportContent, 'WARNING');
      if (res.ok) {
        setReportModalOpen(false);
        setReportContent("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setReportLoading(false);
    }
  };

  // Close notif dropdown on outside click
  useEffect(() => {
    const h = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target))
        setNotifOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      // Still clear local auth state if the server logout request fails.
    }
    clearAuthSession();
    navigate("/login");
  };

  return (
    <div className="h-screen overflow-hidden bg-gray-100 dark:bg-[#0D0D0D] flex font-sans transition-colors duration-300">
      {/* ══════════ SIDEBAR ══════════ */}
      <aside
        className={`
          ${collapsed ? "w-[72px]" : "w-60"}
          flex-shrink-0 bg-white dark:bg-[#111111] border-r border-gray-200 dark:border-white/5
          flex flex-col transition-all duration-300 ease-in-out relative
          z-40
        `}
      >
        {/* Logo */}
        <div className="h-[70px] flex items-center px-4 border-b border-gray-200 dark:border-white/5 gap-3 shrink-0">
          {/* Icon */}
          <img
            src={logoImg}
            alt="Valo Parking"
            className="w-9 h-9 object-contain shrink-0"
          />
          {!collapsed && (
            <div className="overflow-hidden leading-none">
              <p
                className="
                  text-[13px] font-black tracking-[0.18em] whitespace-nowrap
                  bg-gradient-to-r from-yellow-500 via-yellow-300 to-yellow-600
                  bg-clip-text text-transparent
                "
              >
                VALO PARKING
              </p>
              <p className="text-[9px] font-semibold tracking-[0.25em] text-gray-400 dark:text-gray-500 uppercase whitespace-nowrap mt-0.5">
                {theme.panelLabel}
              </p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to.split("/").length === 2}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold
                 transition-all duration-150 whitespace-nowrap overflow-hidden group
                 ${isActive
                  ? `${theme.activeBg} border`
                  : `text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent`
                }`
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="
            absolute -right-3 top-[82px]
            w-6 h-6 bg-gray-100 dark:bg-[#1C1C1C] border border-gray-200 dark:border-white/10 rounded-full
            flex items-center justify-center
            text-gray-500 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/30
            transition-all z-20
          "
        >
          {collapsed ? (
            <ChevronDown size={11} className="-rotate-90" />
          ) : (
            <ChevronDown size={11} className="rotate-90" />
          )}
        </button>
      </aside>

      {/* ══════════ MAIN AREA ══════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-[70px] bg-white dark:bg-[#111111] border-b border-gray-200 dark:border-white/5 flex items-center justify-between px-6 shrink-0 transition-colors duration-300">
          {/* Hamburger (mobile) */}
          <button
            className="lg:hidden text-gray-500 hover:text-gray-900 dark:hover:text-white"
            onClick={() => setCollapsed((c) => !c)}
          >
            <Menu size={20} />
          </button>

          <div className="hidden lg:block" />

          {/* Right zone */}
          <div className="flex items-center gap-3">
            {/* Role badge */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${theme.headerBadgeCls}`}
            >
              <ShieldCheck size={13} />
              <span className="text-xs font-bold uppercase">
                {theme.badge.label}
              </span>
            </div>

            {/* Report Issue (Staff only) */}
            {role === 'staff' && (
              <button
                onClick={() => setReportModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 h-9 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 border border-orange-500/20 transition-all font-semibold text-xs"
                title="Report an Issue"
              >
                <AlertTriangle size={15} />
                <span className="hidden sm:inline">Report Issue</span>
              </button>
            )}

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-red-500/10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut size={17} />
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((o) => !o)}
                className="relative w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <Bell size={17} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-80 bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 flex flex-col max-h-[400px]">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex justify-between items-center bg-gray-50 dark:bg-[#111]">
                    <p className="text-gray-900 dark:text-white font-bold text-sm">
                      Notifications
                    </p>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-xs text-emerald-500 hover:text-emerald-400 font-medium"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-gray-500 text-sm">
                        No notifications
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n._id || n.notificationId}
                          onClick={() =>
                            !n.isRead && markAsRead(n.notificationId || n._id)
                          }
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5 last:border-0 cursor-pointer transition-colors ${!n.isRead ? "bg-emerald-50/50 dark:bg-emerald-500/5" : ""}`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.isRead ? "bg-emerald-500" : "bg-transparent"}`}
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-xs font-medium ${!n.isRead ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}
                            >
                              {n.title}
                            </p>
                            <p className="text-gray-500 dark:text-gray-500 text-[11px] mt-0.5 line-clamp-2">
                              {n.content}
                            </p>
                            <p className="text-gray-400 dark:text-gray-600 text-[10px] mt-1">
                              {n.createdAt
                                ? formatDistanceToNow(new Date(n.createdAt), {
                                  addSuffix: true,
                                  locale: enUS,
                                })
                                : "Just now"}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#111]">
                    <button
                      onClick={() => {
                        if (role === "staff" || role === "admin") {
                          setNotifOpen(false);
                          navigate(`/${role}/notification-inbox`);
                        } else {
                          fetchMore();
                        }
                      }}
                      disabled={
                        role === "customer" && (notificationsLoading || !hasMore)
                      }
                      className="w-full text-center text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white py-1"
                    >
                      {role === "customer"
                        ? notificationsLoading
                          ? "Loading earlier notifications..."
                          : hasMore
                            ? "View earlier notifications"
                            : "All notifications loaded"
                        : "Open notification inbox"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Avatar */}
            <div
              className={`w-9 h-9 rounded-full bg-gradient-to-br ${theme.accent}
                flex items-center justify-center text-black font-extrabold text-sm cursor-pointer overflow-hidden shrink-0 shadow-sm select-none`}
              title={displayName}
            >
              {user?.avatar || user?.profile?.avatar || user?.avatarUrl ? (
                <img
                  src={user.avatar || user.profile?.avatar || user.avatarUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{getInitials(displayName)}</span>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main
          className="scrollbar-hidden flex-1 overflow-y-auto bg-gray-100 transition-colors duration-300 dark:bg-[#0D0D0D]"
        >
          <Outlet />
        </main>
      </div>

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1A1A] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="text-orange-500" size={20} />
                Report an Issue
              </h3>
              <button
                onClick={() => setReportModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Describe the issue you are experiencing in detail. This message will be sent directly to the Admin with high priority.
              </p>

              <textarea
                value={reportContent}
                onChange={(e) => setReportContent(e.target.value)}
                placeholder="Type your report here..."
                className="w-full h-32 px-4 py-3 bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 text-gray-900 dark:text-white text-sm resize-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
              />
            </div>

            <div className="px-6 py-4 border-t border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#111111] flex justify-end gap-3">
              <button
                onClick={() => setReportModalOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/5 transition-colors"
                disabled={reportLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleSendReport}
                disabled={!reportContent.trim() || reportLoading}
                className="px-6 py-2 rounded-xl text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all shadow-lg shadow-orange-500/20"
              >
                {reportLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Send Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

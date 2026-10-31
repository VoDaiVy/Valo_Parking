import NotificationDropdownItem from './notifications/NotificationDropdownItem';
import NotificationDetailModal from './notifications/NotificationDetailModal';
import { useNotificationDetails } from '../hooks/useNotificationDetails';
import { useState, useEffect, useRef, useCallback } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { apiFetch } from "../services/api";
import { logoutUser } from "../services/authService";
import { clearAuthSession, notifyAuthChange } from "../services/authStorage";
import {
  LogOut,
  User,
  Crown,
  ChevronDown,
  Bell,
  CalendarCheck,
  Map,
  FileText,
  X,
  Shield,
  History,
  Sparkles,
  Settings,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";
import Logo from "../assets/images/logo.png";
import { useNotifications } from "../hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";

/* VALO PARKING - Premium Navbar */

const guestLinks = [
  { to: "/", label: "Home", icon: Sparkles },
  { to: "/services", label: "Services", icon: Settings },
  { to: "/parking-map", label: "Parking Map", icon: Map },
  { to: "/policies", label: "Policy", icon: FileText },
];

const customerLinks = [
  { to: '/', label: 'Home', icon: Sparkles },
  { to: '/booking', label: 'Booking', icon: CalendarCheck },
  { to: '/services', label: 'Services', icon: Settings },
  { to: '/parking-map', label: 'Parking Map', icon: Map },
  { to: '/membership', label: 'Package', icon: Crown },
];

const roleBadge = {
  admin: { label: "Admin", bg: "bg-red-500", text: "text-white" },
  manager: { label: "Manager", bg: "bg-blue-500", text: "text-white" },
  customer: { label: "Customer", bg: "bg-emerald-500", text: "text-white" },
};

const getMembershipTier = (membership = {}) => {
  const expireAt = membership.expireAt ? new Date(membership.expireAt) : null;
  const isActiveVip =
    membership.isVip && (!expireAt || Number.isNaN(expireAt.getTime()) || expireAt > new Date());

  if (!isActiveVip) return "member";
  if (membership.packageType === "yearly") return "yearly";
  if (membership.packageType === "monthly") return "monthly";
  return "monthly";
};

const navAvatarThemes = {
  monthly: {
    className:
      "bg-gradient-to-br from-yellow-200 via-amber-300 to-yellow-600 ring-[2px] ring-yellow-400 animate-vip-ripple-sm z-10",
    style: {
      "--vip-ripple-strong": "rgba(251, 191, 36, 0.72)",
      "--vip-ripple-soft": "rgba(251, 191, 36, 0.32)",
      "--vip-ripple-faint": "rgba(251, 191, 36, 0.12)",
      "--vip-ripple-clear": "rgba(251, 191, 36, 0)",
    },
  },
  yearly: {
    className:
      "bg-gradient-to-br from-purple-300 via-fuchsia-300 to-violet-600 ring-[2px] ring-purple-400 animate-vip-ripple-sm z-10",
    style: {
      "--vip-ripple-strong": "rgba(168, 85, 247, 0.74)",
      "--vip-ripple-soft": "rgba(168, 85, 247, 0.34)",
      "--vip-ripple-faint": "rgba(217, 70, 239, 0.14)",
      "--vip-ripple-clear": "rgba(168, 85, 247, 0)",
    },
  },
};

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem("valo_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [expandedNotificationIds, setExpandedNotificationIds] = useState(
    () => new Set(),
  );
  const [scrollY, setScrollY] = useState(0);
  const profileRef = useRef(null);
  const notifRef = useRef(null);

  // Hook for notifications
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    refresh: refreshNotifications,
    hasMore,
    fetchMore,
    markAsRead,
    markAllAsRead,
  } =
    useNotifications({ contextRole: 'customer', limit: 5 });

  const { selectedNotification, openNotification, closeNotification } = useNotificationDetails(markAsRead);

  const toggleNotificationDetails = useCallback((notificationId) => {
    const id = String(notificationId);
    setExpandedNotificationIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Sync user
  const syncUser = useCallback(() => {
    const raw = sessionStorage.getItem("valo_user");
    setUser(raw ? JSON.parse(raw) : null);
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      syncUser();
    }, 0);
    window.addEventListener("focus", syncUser);
    window.addEventListener("valo_auth_change", syncUser);
    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener("focus", syncUser);
      window.removeEventListener("valo_auth_change", syncUser);
    };
  }, [syncUser]);

  // Scroll detection
  useEffect(() => {
    const onScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the page behind the notification panel fixed while it is open.
  useEffect(() => {
    if (!notifOpen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [notifOpen]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target))
        setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target))
        setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on route change
  useEffect(() => {
    window.requestAnimationFrame(() => {
      setMobileOpen(false);
      setProfileOpen(false);
      setNotifOpen(false);
    });
  }, [location.pathname]);

  // Fetch profile if avatar is missing
  useEffect(() => {
    const fetchProfileAvatar = async () => {
      if (!user) return;
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
      } catch {
        // Profile enrichment is best-effort; keep the cached user if it fails.
      }
    };

    fetchProfileAvatar();
  }, [user]);

  // Logout
  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      // Still clear local auth state if the server logout request fails.
    }
    clearAuthSession();
    setUser(null);
    setProfileOpen(false);
    navigate("/");
  };

  const getInitials = (name = "") => {
    return (name || "U")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  const navLinks = user ? customerLinks : guestLinks;

  const displayName = user
    ? [user.profile?.firstName, user.profile?.lastName]
      .filter(Boolean)
      .join(" ") ||
    user.name ||
    user.fullName ||
    user.username ||
    "User"
    : "User";

  const isScrolled = scrollY > 40;
  const membershipTier = getMembershipTier(user?.membership);
  const navAvatarTheme = navAvatarThemes[membershipTier];
  const navAvatarClass = navAvatarTheme?.className || "bg-gradient-to-br from-gray-200 to-gray-400 shadow-sm";
  const navAvatarLargeClass = navAvatarTheme?.className || "bg-gradient-to-br from-gray-200 to-gray-400 shadow-md";
  const navAvatarStyle = navAvatarTheme?.style || {};

  return (
    <>
      {user?.role === 'customer' && <NotificationDetailModal notification={selectedNotification} contextRole="customer" onClose={() => { closeNotification(); notifRef.current?.querySelector('#nav-notifications')?.focus(); }} />}
      <nav id="main-navbar" className="fixed top-0 left-0 right-0 z-50">
        {/* ─── Outer wrapper: adds margin + pill shape when scrolled ─── */}
        <div
          className="transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            margin: isScrolled ? "16px 5% 0" : "0",
            borderRadius: isScrolled ? "100px" : "0",
            background: isScrolled
              ? "rgba(253, 251, 247, 0.85)" /* Soft premium warm tint */
              : "rgba(255,255,255,0.95)",
            backdropFilter: isScrolled
              ? "blur(24px) saturate(180%)"
              : "blur(12px)",
            WebkitBackdropFilter: isScrolled
              ? "blur(24px) saturate(180%)"
              : "blur(12px)",
            boxShadow: isScrolled
              ? "0 10px 40px rgba(0,0,0,0.06), 0 2px 10px rgba(212,175,55,0.05), inset 0 1px 0 rgba(255,255,255,0.8)"
              : "0 1px 0 rgba(0,0,0,0.04)",
            border: isScrolled
              ? "1px solid rgba(212,175,55,0.15)" /* Subtle gold border */
              : "1px solid transparent",
          }}
        >
          <div
            className="max-w-7xl mx-auto px-5 sm:px-8 flex items-center justify-between transition-all duration-500"
            style={{ height: isScrolled ? "52px" : "72px" }}
          >
            {/* ─── LOGO ─── */}
            <Link
              to="/"
              className="flex items-center gap-2.5 group shrink-0"
              id="nav-logo"
            >
              <div className="relative">
                <img
                  src={Logo}
                  alt="VALO"
                  className="object-contain transition-all duration-500 h-9 w-9"
                />
                <div className="absolute inset-0 rounded-full bg-gold/30 blur-xl scale-150 opacity-0 group-hover:opacity-100 transition-all duration-500" />
              </div>
              <div className="hidden sm:flex flex-col overflow-hidden transition-all duration-500">
                <span className="text-sm font-black tracking-wider text-gray-900 leading-none whitespace-nowrap">
                  VALO
                </span>
                <span className="text-[9px] font-bold tracking-[0.25em] text-gray-400 uppercase whitespace-nowrap">
                  Parking
                </span>
              </div>
            </Link>

            <div className="hidden lg:flex items-center">
              <div className="flex items-center gap-0.5 relative">
                {navLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === "/"}
                    id={`nav-${link.label.replace(/\s+/g, "-").toLowerCase()}`}
                    className="relative"
                  >
                    {({ isActive }) => (
                      <div
                        className={`
                          relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold
                          transition-all duration-300 ease-out cursor-pointer select-none
                          ${isActive
                            ? "text-gray-900"
                            : "text-gray-500 hover:text-gray-800"
                          }
                        `}
                      >
                        {isActive && (
                          <span className="absolute inset-0 rounded-xl bg-gray-900/[0.06] nav-active-bg" />
                        )}

                        <link.icon
                          size={14}
                          strokeWidth={2.2}
                          className={`relative z-10 transition-colors duration-300 ${isActive ? "text-gold" : "text-gray-400"
                            }`}
                        />
                        <span className="relative z-10">{link.label}</span>

                        {isActive && (
                          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-gold nav-dot-enter" />
                        )}
                      </div>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {user ? (
                <>
                  {/* Notification */}
                  <div className="relative" ref={notifRef} onKeyDown={(event) => {
                    if (user?.role === 'customer' && event.key === 'Escape') { setNotifOpen(false); notifRef.current?.querySelector('#nav-notifications')?.focus(); }
                  }}>
                    <button
                      id="nav-notifications"
                      aria-label={user?.role === 'customer' ? 'Notifications' : undefined}
                      aria-expanded={user?.role === 'customer' ? notifOpen : undefined}
                      onClick={() => setNotifOpen((o) => !o)}
                      className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 nav-btn-hover ${notifOpen ? "bg-black/[0.06] text-gray-900" : "text-gray-400 hover:text-gray-700 hover:bg-black/[0.04]"}`}
                      title="Notifications"
                    >
                      <Bell size={18} strokeWidth={2} />
                      {unreadCount > 0 && (
                        <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-[5px] flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full ring-2 ring-white">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </button>

                    {/* ─── NOTIFICATIONS DROPDOWN ─── */}
                    {notifOpen && (
                      <div className={`${user?.role === "customer" ? "customer-notification-dropdown" : ""} absolute right-0 top-[calc(100%+8px)] w-96 bg-white/95 backdrop-blur-2xl rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] border border-white/60 overflow-hidden nav-dropdown-enter z-50 flex flex-col max-h-[460px]`}>
                        <div className="px-4 py-3 flex justify-between items-center bg-gradient-to-r from-white to-gray-50 border-b border-gray-100">
                          <div className="flex items-center gap-3">
                            <p className="text-gray-900 font-bold text-sm">
                              Notifications
                            </p>
                            {unreadCount > 0 && (
                              <span className="text-[11px] font-semibold text-white bg-rose-500 rounded-full px-2 py-0.5">
                                {unreadCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                              <button
                                onClick={markAllAsRead}
                                className="text-xs text-emerald-600 hover:text-emerald-500 font-medium transition-colors"
                              >
                                Mark all as read
                              </button>
                            )}
                            <button
                              onClick={() => setNotifOpen(false)}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              Close
                            </button>
                          </div>
                        </div>

                        <div className="scrollbar-hidden overflow-y-auto overscroll-contain flex-1 text-left p-2 space-y-2">
                          {user?.role === 'customer' && notificationsError ? (
                            <div className="customer-notification-state" role="alert">Unable to load notifications.<button type="button" onClick={refreshNotifications}>Try again</button></div>
                          ) : notificationsLoading && notifications.length === 0 ? (
                            <div className="p-6 text-center text-gray-500 text-sm">
                              Loading notifications...
                            </div>
                          ) : notifications.length === 0 ? (
                            <div className="p-6 text-center text-gray-500 text-sm">
                              No notifications
                            </div>
                          ) : (
                            notifications.map((n) => {
                              if (user?.role === 'customer') return <NotificationDropdownItem key={n.notificationId || n._id} notification={n} onRead={markAsRead} onOpen={() => { setNotifOpen(false); openNotification(n); }} />;
                              const notificationId = n.notificationId || n._id;
                              const isExpanded = expandedNotificationIds.has(
                                String(notificationId),
                              );
                              return (
                              <div
                                key={n._id || n.notificationId}
                                onClick={() =>
                                  !n.isRead &&
                                  markAsRead(notificationId)
                                }
                                className={`flex items-start gap-3 p-3 rounded-xl hover:shadow-sm transition-all bg-white border cursor-pointer ${!n.isRead ? "ring-1 ring-emerald-100" : "border-gray-100"}`}
                              >
                                <div className="flex flex-col items-center">
                                  <div
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm ${!n.isRead ? "bg-emerald-500" : "bg-gray-200 text-gray-600"}`}
                                  >
                                    {n.title ? n.title[0] || "N" : "N"}
                                  </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start gap-2">
                                    <p
                                      className={`text-sm font-semibold truncate ${!n.isRead ? "text-gray-900" : "text-gray-700"}`}
                                    >
                                      {n.title}
                                    </p>
                                    <div className="ml-auto text-[11px] text-gray-400">
                                      {n.createdAt
                                        ? formatDistanceToNow(
                                          new Date(n.createdAt),
                                          { addSuffix: true, locale: enUS },
                                        )
                                        : "Just now"}
                                    </div>
                                  </div>
                                  <p className={`text-gray-500 text-[13px] mt-1 ${isExpanded ? "whitespace-pre-wrap break-words" : "line-clamp-2"}`}>
                                    {n.content}
                                  </p>
                                  <div className="mt-2 flex items-center gap-2">
                                    {!n.isRead && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          markAsRead(notificationId);
                                        }}
                                        className="text-xs text-emerald-600 hover:text-emerald-500 font-medium transition-colors"
                                      >
                                        Mark as read
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleNotificationDetails(notificationId);
                                      }}
                                      className="text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors"
                                    >
                                      {isExpanded ? "Less" : "More"}
                                    </button>
                                    {n.type === "BOOKING" && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!n.isRead) markAsRead(notificationId);
                                          const bookingId = n.metadata?.bookingId;
                                          navigate(
                                            bookingId
                                              ? `/customer/booking?bookingId=${bookingId}`
                                              : "/customer/booking",
                                          );
                                          setNotifOpen(false);
                                        }}
                                        className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
                                      >
                                        View booking
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              );
                            })
                          )}
                        </div>

                        <div className="p-3 border-t border-gray-100 bg-gray-50/50">
                          <button
                            type="button"
                            onClick={fetchMore}
                            disabled={notificationsLoading || !hasMore}
                            className="w-full text-center text-xs text-gray-600 hover:text-gray-900 py-2 font-medium transition-colors rounded-xl bg-white/60 disabled:cursor-default disabled:text-gray-400"
                          >
                            {notificationsLoading
                              ? "Loading earlier notifications..."
                              : hasMore
                                ? "View all notifications"
                                : "All notifications loaded"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative" ref={profileRef}>
                    <button
                      id="nav-profile-btn"
                      onClick={() => setProfileOpen((o) => !o)}
                      className={`
                        flex items-center gap-2 pl-[3px] pr-2.5 py-[3px] rounded-2xl
                        transition-all duration-300 nav-btn-hover
                        ${profileOpen
                          ? "bg-black/[0.06] ring-1 ring-black/[0.08]"
                          : "hover:bg-black/[0.04]"
                        }
                      `}
                    >
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-black font-extrabold text-sm cursor-pointer select-none shrink-0 ${navAvatarClass}`}
                        style={navAvatarStyle}
                      >
                        {user?.avatar ||
                          user?.profile?.avatar ||
                          user?.avatarUrl ? (
                          <img
                            src={
                              user.avatar ||
                              user.profile?.avatar ||
                              user.avatarUrl
                            }
                            alt={displayName}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <span>{getInitials(displayName)}</span>
                        )}
                      </div>
                      <span className="hidden sm:block text-[13px] font-semibold text-gray-700 max-w-[90px] truncate">
                        {displayName.split(" ").pop()}
                      </span>
                      <ChevronDown
                        size={12}
                        className={`text-gray-400 transition-transform duration-300 ${profileOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {profileOpen && (
                      <div className="absolute right-0 top-[calc(100%+8px)] w-[280px] bg-white rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] border border-gray-100 overflow-hidden nav-dropdown-enter">
                        {/* User card */}
                        <div className="p-4 border-b border-gray-100/80">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-11 h-11 rounded-full flex items-center justify-center text-black font-extrabold text-lg cursor-pointer select-none shrink-0 ${navAvatarLargeClass}`}
                              style={navAvatarStyle}
                            >
                              {user?.avatar ||
                                user?.profile?.avatar ||
                                user?.avatarUrl ? (
                                <img
                                  src={
                                    user.avatar ||
                                    user.profile?.avatar ||
                                    user.avatarUrl
                                  }
                                  alt={displayName}
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                <span>{getInitials(displayName)}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[15px] font-bold text-gray-900 leading-none truncate">
                                {displayName}
                              </p>
                              <p className="text-[13px] text-gray-500 font-medium truncate mt-1">
                                {user?.email || "No email"}
                              </p>
                            </div>
                            {roleBadge[user.role] && (
                              <span
                                className={`text-[9px] font-bold px-2 py-1 rounded-lg ${roleBadge[user.role].bg} ${roleBadge[user.role].text} shadow-sm`}
                              >
                                {roleBadge[user.role].label}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="p-2 mt-1">
                          {[
                            {
                              id: "profile",
                              icon: User,
                              label: "Profile",
                              to: "/profile",
                            },
                            {
                              id: "transactions",
                              icon: History,
                              label: "Transaction History",
                              to: "/customer/wallet",
                            },
                            {
                              id: "policy",
                              icon: FileText,
                              label: "Policy",
                              to: "/policies",
                            },
                          ].map((item) => (
                            <Link
                              key={item.id}
                              id={`nav-dd-${item.id}`}
                              to={item.to}
                              onClick={() => setProfileOpen(false)}
                              className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gradient-to-r hover:from-gold/5 hover:to-transparent transition-all duration-300 group"
                            >
                              <div className="w-8 h-8 rounded-[10px] bg-gray-50 border border-gray-100/80 group-hover:bg-white group-hover:border-gold/30 group-hover:shadow-[0_2px_8px_rgba(212,175,55,0.15)] flex items-center justify-center transition-all duration-300">
                                <item.icon
                                  size={15}
                                  className="text-gray-400 group-hover:text-gold transition-colors duration-300"
                                />
                              </div>
                              <span className="font-semibold tracking-wide">
                                {item.label}
                              </span>
                              <ChevronRight
                                size={14}
                                className="ml-auto text-gray-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"
                              />
                            </Link>
                          ))}

                          {(user.role === "admin" || user.role === "staff") && (
                            <>
                              <div className="h-px bg-gray-100 my-1 mx-3" />
                              <Link
                                id="nav-dd-dashboard"
                                to={`/${user.role}/dashboard`}
                                onClick={() => setProfileOpen(false)}
                                className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-transparent transition-all duration-300 group"
                              >
                                <div className="w-8 h-8 rounded-[10px] bg-blue-50 border border-blue-100/50 group-hover:bg-white group-hover:border-blue-300/40 group-hover:shadow-[0_2px_8px_rgba(59,130,246,0.15)] flex items-center justify-center transition-all duration-300">
                                  <Shield size={15} className="text-blue-500" />
                                </div>
                                <span className="font-semibold tracking-wide">
                                  {user.role === "admin" ? "Admin" : "Staff"}{" "}
                                  Panel
                                </span>
                                <ChevronRight
                                  size={14}
                                  className="ml-auto text-gray-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"
                                />
                              </Link>
                            </>
                          )}
                        </div>

                        <div className="border-t border-gray-100/80 p-2">
                          <button
                            id="nav-btn-logout"
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[13px] text-red-500 hover:text-red-600 hover:bg-red-50/80 transition-all duration-300 font-semibold group"
                          >
                            <div className="w-8 h-8 rounded-[10px] bg-red-50 border border-red-100/50 group-hover:bg-white group-hover:border-red-300/40 group-hover:shadow-[0_2px_8px_rgba(239,68,68,0.15)] flex items-center justify-center transition-all duration-300">
                              <LogOut
                                size={15}
                                className="text-red-400 group-hover:text-red-500 transition-colors"
                              />
                            </div>
                            <span className="tracking-wide">Sign Out</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    to="/login"
                    id="nav-btn-login"
                    className="hidden sm:flex items-center px-4 py-2 text-[13px] font-semibold text-gray-600 hover:text-gray-900 rounded-xl hover:bg-black/[0.04] transition-all duration-200"
                  >
                    Log In
                  </Link>
                  <Link
                    to="/login"
                    id="nav-btn-signup"
                    className="relative group px-5 py-2 rounded-xl text-[13px] font-bold overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97]"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 group-hover:from-gold group-hover:via-yellow-400 group-hover:to-gold transition-all duration-500" />
                    <span className="relative flex items-center gap-1.5 text-white group-hover:text-gray-900 transition-colors duration-500">
                      Get Started
                      <ArrowUpRight
                        size={14}
                        className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      />
                    </span>
                  </Link>
                </div>
              )}

              <button
                id="nav-mobile-toggle"
                onClick={() => setMobileOpen((o) => !o)}
                className="lg:hidden w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-black/[0.04] transition-all duration-200"
              >
                <div className="relative w-5 h-5">
                  <span
                    className={`absolute left-0 w-5 h-[2px] bg-current rounded-full transition-all duration-300 ${mobileOpen ? "top-[9px] rotate-45" : "top-1"}`}
                  />
                  <span
                    className={`absolute left-0 top-[9px] w-5 h-[2px] bg-current rounded-full transition-all duration-300 ${mobileOpen ? "opacity-0 translate-x-2" : "opacity-100"}`}
                  />
                  <span
                    className={`absolute left-0 w-5 h-[2px] bg-current rounded-full transition-all duration-300 ${mobileOpen ? "top-[9px] -rotate-45" : "top-[17px]"}`}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div
        className={`fixed inset-0 z-40 transition-all duration-500 ${mobileOpen ? "pointer-events-auto" : "pointer-events-none"
          }`}
      >
        <div
          className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-500 ${mobileOpen ? "opacity-100" : "opacity-0"
            }`}
          onClick={() => setMobileOpen(false)}
        />

        {/* Panel */}
        <div
          className={`absolute top-0 right-0 w-[300px] h-full bg-white/95 backdrop-blur-2xl shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${mobileOpen ? "translate-x-0" : "translate-x-full"
            }`}
        >
          {/* Close */}
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <img src={Logo} alt="VALO" className="h-7 w-7 object-contain" />
              <span className="text-sm font-black tracking-wider text-gray-900">
                VALO
              </span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Links */}
          <div className="p-4 space-y-1">
            {navLinks.map((link, i) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                id={`nav-m-${link.label.replace(/\s+/g, "-").toLowerCase()}`}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${isActive
                    ? "bg-gold/10 text-gray-900"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                  }`
                }
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {({ isActive }) => (
                  <>
                    <link.icon
                      size={18}
                      className={isActive ? "text-gold" : "text-gray-400"}
                    />
                    {link.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          {/* Mobile auth */}
          {!user && (
            <div className="absolute bottom-0 left-0 right-0 p-5 border-t border-gray-100 bg-white/80 backdrop-blur-xl space-y-2">
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center py-3 text-sm font-bold text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
              >
                Log In
              </Link>
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center py-3 text-sm font-bold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition shadow-lg"
              >
                Get Started
              </Link>
            </div>
          )}

          {/* Mobile user card */}
          {user && (
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100 bg-white/80 backdrop-blur-xl">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-xl overflow-hidden ${user.avatar ? "" : "bg-[#050505] border border-gold/20"} flex items-center justify-center shadow-md`}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={Logo}
                      alt="VALO"
                      className="w-[65%] h-[65%] object-contain"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm truncate">
                    {user.name}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {user.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setMobileOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition"
              >
                <LogOut size={15} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

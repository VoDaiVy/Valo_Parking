import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationItem from './NotificationItem';
import { getSafeCustomerNotificationLink } from '../../utils/notificationLinks';

export default function NotificationBell({ dark = false, contextRole }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
  } = useNotifications({ autoFetch: true, limit: 5, contextRole });

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const recentNotifs = notifications.slice(0, 5);

  if (dark) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          id="notif-bell-dark"
          className="relative w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          title="Notifications"
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-[5px] flex items-center justify-center text-[9px] font-bold text-black bg-yellow-400 rounded-full ring-2 ring-[#111111] animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-[calc(100%+8px)] w-[340px] bg-[#1A1A1A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <p className="text-white font-bold text-sm">Notifications</p>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllAsRead()}
                    className="flex items-center gap-1 text-[10px] font-semibold text-yellow-400 hover:text-yellow-300 transition-colors"
                  >
                    <CheckCheck size={12} />
                    Mark all as read
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {loading && recentNotifs.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-6 h-6 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin mx-auto" />
                  <p className="text-gray-500 text-xs mt-3">Loading...</p>
                </div>
              ) : recentNotifs.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
                    <Bell size={20} className="text-gray-600" />
                  </div>
                  <p className="text-gray-500 text-xs font-medium">No notifications</p>
                </div>
              ) : (
                recentNotifs.map((n) => (
                  <NotificationItem
                    key={n._id}
                    notification={n}
                    onRead={markAsRead}
                    compact
                    onClick={() => {
                      setOpen(false);
                      if (!contextRole || contextRole === 'customer') {
                        const destination = getSafeCustomerNotificationLink(n);
                        if (destination) navigate(destination);
                      }
                    }}
                  />
                ))
              )}
            </div>

            <div className="border-t border-white/5 p-2">
              <Link
                to="/customer/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold text-yellow-400 hover:bg-yellow-500/10 transition-colors"
              >
                View all
                <ExternalLink size={12} />
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        id="notif-bell-light"
        className="relative w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-black/[0.04] transition-all duration-200"
        title="Notifications"
      >
        <Bell size={18} strokeWidth={2} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-[5px] flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[340px] bg-white/90 backdrop-blur-2xl rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] border border-white/60 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100/80 flex items-center justify-between">
            <p className="text-gray-900 font-bold text-sm">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 hover:text-amber-700 transition-colors"
              >
                <CheckCheck size={12} />
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {loading && recentNotifs.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-6 h-6 border-2 border-amber-300/30 border-t-amber-500 rounded-full animate-spin mx-auto" />
                <p className="text-gray-400 text-xs mt-3">Loading...</p>
              </div>
            ) : recentNotifs.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                  <Bell size={20} className="text-gray-300" />
                </div>
                <p className="text-gray-400 text-xs font-medium">No notifications</p>
              </div>
            ) : (
              recentNotifs.map((n) => (
                <div key={n._id}
                  onClick={() => {
                    if (!n.isRead) markAsRead(n.notificationId || n._id);
                    setOpen(false);
                    if (!contextRole || contextRole === 'customer') {
                      const destination = getSafeCustomerNotificationLink(n);
                      if (destination) navigate(destination);
                    }
                  }}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-all duration-200 border-b border-gray-100/60 last:border-0 ${
                    n.isRead ? 'hover:bg-gray-50/50' : 'bg-amber-50/30 hover:bg-amber-50/50'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    n.isRead ? 'bg-gray-300' :
                    n.priority === 'ERROR' ? 'bg-red-400' :
                    n.priority === 'WARNING' ? 'bg-amber-400' :
                    n.priority === 'SUCCESS' ? 'bg-emerald-400' : 'bg-blue-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${n.isRead ? 'text-gray-400' : 'text-gray-700'}`}>
                      {n.title}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate mt-0.5">{n.content}</p>
                    <p className="text-[10px] text-gray-300 mt-1">
                      {(() => {
                        const now = new Date();
                        const d = new Date(n.createdAt);
                        const s = Math.floor((now - d) / 1000);
                        if (s < 60) return 'Just now';
                        if (s < 3600) return `${Math.floor(s / 60)}m`;
                        if (s < 86400) return `${Math.floor(s / 3600)}h`;
                        return `${Math.floor(s / 86400)}d`;
                      })()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-gray-100/80 p-2">
            <Link
              to="/customer/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold text-amber-600 hover:bg-amber-50 transition-colors"
            >
              View all
              <ExternalLink size={12} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

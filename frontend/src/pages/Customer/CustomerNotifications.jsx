import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Search, ChevronDown } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationItem from '../../components/notifications/NotificationItem';

const TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PARKING', label: 'Parking' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'BOOKING', label: 'Booking' },
  { value: 'ACCOUNT', label: 'Account' },
  { value: 'SYSTEM', label: 'System' },
];

const CUSTOMER_DEEP_LINKS = [
  '/customer/membership-transfer-marketplace',
  '/customer/membership-transfers',
  '/customer/booking',
  '/customer/wallet',
];

const getSafeCustomerDeepLink = (notification) => {
  const rawLink = notification?.metadata?.deepLink;
  if (typeof rawLink === 'string' && rawLink.startsWith('/') && !rawLink.startsWith('//')) {
    try {
      const parsed = new URL(rawLink, window.location.origin);
      const isMarketplaceDetail = /^\/customer\/membership-transfer-marketplace\/[a-f\d]{24}$/i.test(
        parsed.pathname
      );
      const allowed = isMarketplaceDetail || CUSTOMER_DEEP_LINKS.some(
        (path) => parsed.pathname === path
      );
      if (parsed.origin === window.location.origin && allowed) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Fall through to the typed notification fallback.
    }
  }

  const eventType = String(notification?.metadata?.eventType || '');
  if (eventType.startsWith('MEMBERSHIP_TRANSFER_')) {
    const transferId = notification?.metadata?.transferId;
    return transferId
      ? `/customer/membership-transfer-marketplace?transferId=${encodeURIComponent(transferId)}`
      : '/customer/membership-transfer-marketplace';
  }
  if (notification?.type === 'BOOKING') {
    const bookingId = notification?.metadata?.bookingId;
    return bookingId
      ? `/customer/booking?bookingId=${encodeURIComponent(bookingId)}`
      : '/customer/booking';
  }
  return null;
};

export default function CustomerNotifications({ contextRole = 'customer' }) {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    filters,
    fetchMore,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    updateFilters,
  } = useNotifications({ autoFetch: true, limit: 20, contextRole });

  const [searchInput, setSearchInput] = useState('');

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    updateFilters({ search: searchInput });
  }, [searchInput, updateFilters]);

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-gray-100 px-4 py-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Notifications</h1>
            <p className="text-sm text-gray-500 mt-1">
              {error ? 'Notifications unavailable' : unreadCount > 0 ? `${unreadCount} unread notifications` : 'All caught up'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 text-yellow-400 text-sm font-semibold hover:bg-yellow-500/20 transition-colors"
            >
              <CheckCheck size={16} />
              Mark all as read
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => updateFilters({ type: f.value || null })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  (filters.type || '') === f.value
                    ? 'bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search notifications..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-yellow-500/30 transition-colors"
              />
            </div>
          </form>
        </div>

        <div className="space-y-2">
          {error ? (
            <div className="flex flex-col items-center py-16 text-center" role="alert">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
                <Bell size={28} className="text-red-400" />
              </div>
              <p className="text-red-300 font-medium">Unable to load notifications</p>
              <p className="text-red-200/60 text-sm mt-1">{error}</p>
            </div>
          ) : loading && notifications.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <div className="w-8 h-8 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
              <p className="text-gray-500 text-sm mt-4">Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <Bell size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 font-medium">No notifications</p>
              <p className="text-gray-600 text-sm mt-1">New notifications will appear here</p>
            </div>
          ) : (
            <>
              {notifications.map((n) => (
                <NotificationItem
                  key={n._id}
                  notification={n}
                  onRead={markAsRead}
                  onDelete={deleteNotification}
                  onClick={() => {
                    if (contextRole === 'customer') {
                      const destination = getSafeCustomerDeepLink(n);
                      if (destination) navigate(destination);
                    }
                  }}
                />
              ))}

              {hasMore && (
                <button
                  onClick={fetchMore}
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-white/5 text-gray-400 text-sm font-medium hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" />
                  ) : (
                    <>
                      <ChevronDown size={16} />
                      Load more
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

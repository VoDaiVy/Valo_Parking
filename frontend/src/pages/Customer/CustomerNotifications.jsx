import { useLanguage } from '../../i18n/hooks/useLanguage';
import NotificationDropdownItem from '../../components/notifications/NotificationDropdownItem';
import NotificationDetailModal from '../../components/notifications/NotificationDetailModal';
import { useNotificationDetails } from '../../hooks/useNotificationDetails';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Search, ChevronDown } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationItem from '../../components/notifications/NotificationItem';
import { getIssueReportLink, getSafeStaffDeepLink } from '../../utils/staffDeepLink';

const TYPE_FILTERS = [
  { value: '', label: 'customer.all' },
  { value: 'PARKING', label: 'booking.parking' },
  { value: 'WALLET', label: 'notificationInbox.wallet' },
  { value: 'PAYMENT', label: 'notificationInbox.payment' },
  { value: 'BOOKING', label: 'booking.bookingAction' },
  { value: 'ACCOUNT', label: 'notificationInbox.account' },
  { value: 'SYSTEM', label: 'notificationInbox.system' },
];

export default function CustomerNotifications({ contextRole = 'customer' }) {
  const { t } = useLanguage();
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
    refresh,
  } = useNotifications({ autoFetch: true, limit: 20, contextRole });

  const { selectedNotification, openNotification, closeNotification } = useNotificationDetails(markAsRead);
  const [searchInput, setSearchInput] = useState('');

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    updateFilters({ search: searchInput });
  }, [searchInput, updateFilters]);

  if (contextRole === 'customer') return (
    <div className="customer-notifications-page">
      <NotificationDetailModal notification={selectedNotification} onClose={closeNotification} />
      <div className="customer-notifications-page__container">
        <header className="customer-notifications-page__header">
          <div><h1>{t('notificationInbox.notifications')}</h1><p>{error ? t('notificationInbox.notificationsUnavailable') : unreadCount > 0 ? t('notificationInbox.unread', { count: unreadCount }) : t('notificationInbox.youReAllCaughtUp')}</p></div>
          {unreadCount > 0 && <button type="button" onClick={markAllAsRead} className="customer-notifications-page__read-all"><CheckCheck size={16} aria-hidden="true" />{t('notificationInbox.markAllAsRead')}</button>}
        </header>
        <section className="customer-notifications-page__list" aria-label={t('notificationInbox.yourNotifications')}>
          <div className="customer-notifications-page__toolbar">
            <div className="customer-notifications-page__filters" aria-label={t('notificationInbox.notificationCategories')}>{TYPE_FILTERS.map((f) => <button type="button" key={f.value} aria-pressed={(filters.type || '') === f.value} onClick={() => updateFilters({ type: f.value || null })}>{t(f.label)}</button>)}</div>
            <form onSubmit={handleSearch} className="customer-notifications-page__search" role="search">
              <Search size={16} aria-hidden="true" /><input aria-label={t('notificationInbox.searchNotifications')} placeholder={t('notificationInbox.searchNotifications2')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </form>
          </div>
          {error ? <div className="customer-notification-state" role="alert"><p>{t('notificationInbox.unableToLoadNotifications')}</p><p>{error}</p><button type="button" onClick={refresh}>{t('notificationInbox.tryAgain')}</button></div>
            : loading && notifications.length === 0 ? <div className="customer-notification-state" role="status">{t('notificationInbox.loadingNotifications')}</div>
              : notifications.length === 0 ? <div className="customer-notification-state" role="status"><Bell size={28} className="mx-auto mb-3" aria-hidden="true" /><p>{t('notificationInbox.noNotifications')}</p><p>{t('notificationInbox.newNotificationsWillAppearHere')}</p></div>
                : <>{notifications.map((n) => <NotificationDropdownItem key={n.notificationId || n._id} notification={n} onRead={markAsRead} onOpen={() => openNotification(n)} onDelete={deleteNotification} />)}
                  {hasMore && <button type="button" onClick={fetchMore} disabled={loading} className="customer-notifications-page__more">{loading ? t('notificationInbox.loadingEarlierNotifications') : t('notificationInbox.loadMore')}</button>}</>}
        </section>
      </div>
    </div>
  );

  return (
    <div className="dashboard-notification-inbox min-h-screen bg-[#0D0D0D] text-gray-100 px-4 py-6 lg:px-8">
      {contextRole === "customer" && <NotificationDetailModal notification={selectedNotification} onClose={closeNotification} />}
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('notificationInbox.notifications')}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {error ? t('notificationInbox.notificationsUnavailable') : unreadCount > 0 ? t('notificationInbox.unread', { count: unreadCount }) : t('notificationInbox.allCaughtUp')}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 text-yellow-400 text-sm font-semibold hover:bg-yellow-500/20 transition-colors"
            >
              <CheckCheck size={16} />
              {t('notificationInbox.markAllAsRead')}
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
                {t(f.label)}
              </button>
            ))}
          </div>
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder={t('notificationInbox.searchNotifications3')}
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
              <p className="text-red-300 font-medium">{t('notificationInbox.unableToLoadNotifications')}</p>
              <p className="text-red-200/60 text-sm mt-1">{error}</p>
            </div>
          ) : loading && notifications.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <div className="w-8 h-8 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
              <p className="text-gray-500 text-sm mt-4">{t('notificationInbox.loadingNotifications2')}</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <Bell size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 font-medium">{t('notificationInbox.noNotifications')}</p>
              <p className="text-gray-600 text-sm mt-1">{t('notificationInbox.newNotificationsWillAppearHere2')}</p>
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
                      openNotification(n);
                    } else if (contextRole === 'staff') {
                      const destination = getSafeStaffDeepLink(n);
                      if (destination) navigate(destination);
                    } else if (contextRole === 'admin') {
                      const destination = getIssueReportLink(n, contextRole);
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
                      {t('notificationInbox.loadMore')}
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

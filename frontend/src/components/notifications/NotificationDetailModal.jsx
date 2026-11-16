import { membershipExpiryNotification } from '../../utils/membershipExpiryNotification';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogPanel } from '@headlessui/react';
import { ArrowUpRight, X } from 'lucide-react';
import { getSafeCustomerNotificationLink } from '../../utils/notificationLinks';
import { getSafeStaffDeepLink } from '../../utils/staffDeepLink';
import { NOTIFICATION_MASCOTS, resolveNotificationMascotStatus } from '../../utils/notificationMascotStatus';
import './NotificationDetailModal.css';

export default function NotificationDetailModal({ notification, onClose, contextRole = 'customer' }) {
  const navigate = useNavigate();
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef(null);
  const presentation = NOTIFICATION_MASCOTS[resolveNotificationMascotStatus(notification)];
  const expiryPresentation = contextRole === 'customer' ? membershipExpiryNotification(notification) : null;
  const destination = contextRole === 'customer'
    ? getSafeCustomerNotificationLink(notification)
    : contextRole === 'staff' ? getSafeStaffDeepLink(notification) : null;
  const sentAtValue = notification?.notificationCreatedAt || notification?.createdAt;
  const sentAt = sentAtValue ? new Date(sentAtValue) : null;
  const sentAtText = sentAt && !Number.isNaN(sentAt.getTime())
    ? sentAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })
    : 'Send time unavailable';

  if (!notification) return null;
  return createPortal(
    <Dialog open onClose={onClose} initialFocus={closeRef} className="notification-detail" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <div className="notification-detail__overlay" aria-hidden="true" />
      <div className="notification-detail__viewport">
        <DialogPanel className="notification-detail__panel">
          <img src={`/assets/notification-mascots/${presentation.image}.png`} alt="" aria-hidden="true" className="notification-detail__mascot" />
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close notification details" className="type-button notification-detail__close">
              <X size={20} />
            </button>
          <div className="notification-detail__main">
            <header className="notification-detail__header">
              <span translate="no" className={`type-badge inline-flex rounded-full px-3 py-1 ${presentation.badge} ${presentation.accent}`}>{presentation.label}</span>
              <h2 translate="no" id={titleId} className="type-section notification-detail__title">{expiryPresentation?.title ?? (notification.title || 'Notification')}</h2>
              <time dateTime={sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt.toISOString() : undefined} className="notification-detail__time">{sentAtText}</time>
            </header>
          <div className="notification-detail__body">
            <p translate="no" id={descriptionId}>{expiryPresentation?.content ?? (notification.content || 'No additional content.')}</p>
          </div>
          </div>
          <footer className="notification-detail__footer">
            <button type="button" onClick={onClose} className="type-button notification-detail__secondary">Close</button>
            {destination && <button type="button" onClick={() => { onClose(); navigate(destination); }} className="type-button notification-detail__primary">
              {/^\/customer\/membership-transfers\?(entitlementId|subscriptionId)=/.test(destination) ? 'View membership' : destination.startsWith('/customer/booking?') ? 'View booking' : 'View details'}<ArrowUpRight size={16} />
            </button>}
          </footer>
        </DialogPanel>
      </div>
    </Dialog>, document.body,
  );
}

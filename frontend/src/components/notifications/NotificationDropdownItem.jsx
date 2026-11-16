import { membershipExpiryNotification } from '../../utils/membershipExpiryNotification';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { NOTIFICATION_MASCOTS, resolveNotificationMascotStatus } from '../../utils/notificationMascotStatus';
import './CustomerNotifications.css';

export default function NotificationDropdownItem({ notification, onOpen, onRead, onDelete }) {
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const presentation = NOTIFICATION_MASCOTS[resolveNotificationMascotStatus(notification)];
  const expiryPresentation = membershipExpiryNotification(notification);
  const date = new Date(notification.notificationCreatedAt || notification.createdAt);
  const markRead = async (event) => {
    event.stopPropagation();
    if (reading || notification.isRead) return;
    setReading(true);
    setReadError('');
    try {
      const succeeded = await onRead?.(notification.notificationId || notification._id);
      if (succeeded === false) setReadError('Unable to mark notification as read. Please try again.');
    } catch {
      setReadError('Unable to mark notification as read. Please try again.');
    }
    finally { setReading(false); }
  };

  return <article className={`customer-notification-item ${notification.isRead ? 'is-read' : 'is-unread'}`}>
    {!notification.isRead && <span className="customer-notification-item__unread" role="img" aria-label="Unread" />}
    <div aria-label={presentation.label} title={presentation.label} className={`customer-notification-item__avatar ${presentation.badge}`}>
      <img src={`/assets/notification-mascots/${presentation.image}.png`} alt="" aria-hidden="true" width="48" height="48" />
    </div>
    <div className="customer-notification-item__content">
      <button type="button" onClick={onOpen} className="customer-notification-item__open">
        <span className="customer-notification-item__heading"><span>{expiryPresentation?.title ?? notification.title}</span></span>
        <span className={`customer-notification-item__summary${expiryPresentation ? " customer-notification-item__summary--membership" : ""}`}>{expiryPresentation?.summary ?? notification.content}</span>
      </button>
      <time className="customer-notification-item__time" dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}>{Number.isNaN(date.getTime()) ? 'Time unavailable' : formatDistanceToNow(date, { addSuffix: true, locale: enUS })}</time>
      <div className="customer-notification-item__actions">
        <button type="button" onClick={markRead} disabled={notification.isRead || reading}>
          {notification.isRead ? 'Read' : reading ? 'Marking...' : 'Mark as read'}
        </button>
        <button type="button" onClick={onOpen}>More</button>
        {onDelete && <button type="button" aria-label={`Delete notification: ${notification.title}`} onClick={() => onDelete(notification.notificationId || notification._id)} className="customer-notification-item__delete"><Trash2 size={14} aria-hidden="true" /></button>}
      </div>
      {readError && !notification.isRead && <p role="alert" className="customer-notification-item__error">{readError}</p>}
    </div>
  </article>;
}

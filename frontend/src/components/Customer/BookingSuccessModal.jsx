import { useLanguage } from '../../i18n/hooks/useLanguage';
import { useState } from 'react';
import { CheckCircle2, MapPin, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import TelegramReceiptButton from '../TelegramReceiptButton';
import { bookingConfirmationSummary } from '../../utils/bookingConfirmation';
import './BookingSuccessModal.css';

const money = value => value === null ? '—' : `${Number(value).toLocaleString('en-US')} VND`;
const dateTime = value => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Unavailable';
};

export default function BookingSuccessModal({ bookingInfo, countdown = 10, telegramBookingId, onReceipt }) {
  const { t } = useLanguage();
  const { bookings, total } = bookingConfirmationSummary(bookingInfo);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, bookings.length - 1));
  const selected = bookings[activeIndex];

  return (
    <div className="booking-confirmation-overlay">
      <section className="booking-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-confirmation-title">
        <header className="booking-confirmation-header">
          <span className="booking-confirmation-check"><CheckCircle2 size={25} aria-hidden="true" /></span>
          <div>
            <span className="booking-confirmation-eyebrow">{t('booking.bookingConfirmed')}</span>
            <h2 id="booking-confirmation-title">{t('booking.bookingConfirmed')}</h2>
            <p>{t('bookingSuccess.yourParkingIsReadyUseThe')}</p>
          </div>
        </header>

        <div className="booking-confirmation-body">
          <div className="booking-confirmation-details">
            <div className="booking-confirmation-total">
              <div><span>{t('bookingSuccess.orderTotal')}</span><strong>{money(total)}</strong></div>
              <div><span>{t('bookingSuccess.bookings')}</span><b>{bookings.length}</b></div>
              {total === null && <p>{t('bookingSuccess.openMyBookingsToCheckThe')}</p>}
            </div>

            <div className="booking-confirmation-list-heading">
              <h3>{t('booking.details')}</h3>
              {bookings.length > 1 && <span>{t('bookingSuccess.selectAVehicleToViewIts')}</span>}
            </div>
            <div className="booking-confirmation-bookings">
              {bookings.map((booking, index) => (
                <button type="button" key={booking.bookingId || index}
                  className={`booking-confirmation-card ${index === activeIndex ? 'is-selected' : ''}`}
                  aria-pressed={index === activeIndex} onClick={() => setSelectedIndex(index)}>
                  <div className="booking-confirmation-card-heading">
                    <div><span>Booking {index + 1}</span><strong>{booking.licensePlate || t('booking.vehicle')}</strong></div>
                    <span className="booking-confirmation-slot"><MapPin size={14} aria-hidden="true" />{booking.slotCode || 'Space unavailable'}</span>
                  </div>
                  <dl>
                    <div><dt>{t('bookingSuccess.from')}</dt><dd>{dateTime(booking.startTime)}</dd></div>
                    <div><dt>{t('bookingSuccess.until')}</dt><dd>{dateTime(booking.endTime)}</dd></div>
                    {booking.totalAmount !== null && <div className="booking-confirmation-card-amount"><dt>{t('bookingSuccess.paid')}</dt><dd>{money(booking.totalAmount)}</dd></div>}
                  </dl>
                </button>
              ))}
              {!bookings.length && <p className="booking-confirmation-empty">{t('bookingSuccess.openMyBookingsToViewYour')}</p>}
            </div>
          </div>

          <aside className="booking-confirmation-qr-panel" aria-label="Selected vehicle check-in QR">
            <div className="booking-confirmation-qr-heading"><QrCode size={18} aria-hidden="true" /><h3>{t('bookingSuccess.checkInQr')}</h3></div>
            {selected && <div className="booking-confirmation-qr-vehicle">
              <strong>{selected.licensePlate || `Booking ${activeIndex + 1}`}</strong>
              <span>{selected.slotCode ? `Space ${selected.slotCode}` : `Booking ${activeIndex + 1}`}</span>
            </div>}
            <div className="booking-confirmation-qr-frame">
              {selected?.qrCode
                ? <QRCodeSVG value={String(selected.qrCode)} size={188} title={`Check-in QR for ${selected.licensePlate || 'your booking'}`} />
                : <p>{t('bookingSuccess.qrCheckInIsTemporarilyUnavailable')}</p>}
            </div>
            <p className="booking-confirmation-qr-note">{t('bookingSuccess.eachVehicleHasItsOwnCheck')}</p>
            {selected?.bookingId && <TelegramReceiptButton key={selected.bookingId} bookingId={selected.bookingId}
              refreshKey={telegramBookingId} onClick={() => onReceipt?.(selected.bookingId)} className="booking-confirmation-telegram" />}
          </aside>
        </div>

        <footer className="booking-confirmation-footer">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>Redirecting to <a href="/customer/booking">{t('customer.myBookingsTitle')}</a> in <strong>{countdown}s</strong></span>
        </footer>
      </section>
    </div>
  );
}

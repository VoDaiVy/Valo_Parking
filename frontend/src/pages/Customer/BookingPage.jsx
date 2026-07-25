import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  QrCode,
  RotateCcw,
  TimerReset,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import {
  cancelBooking,
  extendBooking,
  getBookingCancellationQuote,
  getBookingQr,
  getMyBookings,
  updateBookingVehicle,
} from '../../services/bookingService';
import { getMyVehicles } from '../../services/vehicleService';
import { useSocket } from '../../hooks/useSocket';
import CustomerPageHeader from '../../components/Customer/CustomerPageHeader';

const formatMoney = (value = 0) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

const formatDateTime = (value) =>
  new Date(value).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

const getBookingStatus = (booking) => String(booking?.status || '').toUpperCase();
const getBookingStart = (booking) => booking.scheduledStart || booking.startTime;
const getBookingEnd = (booking) => booking.scheduledEnd || booking.endTime;
const getBookingSlot = (booking) => booking.parkingSlot || booking.slotCode || '--';
const getBookingPaidAmount = (booking) => {
  const candidates = [
    booking?.prepaidAmount,
    booking?.paymentBreakdownSnapshot?.totalAmount,
    booking?.finalAmount,
    booking?.totalAmount,
  ];
  const amount = candidates.find((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return Number(amount || 0);
};

const statusClass = (status) => {
  const normalizedStatus = String(status || '').toUpperCase();
  if (normalizedStatus === 'PAID') return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
  if (normalizedStatus === 'ACTIVE') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
  if (normalizedStatus === 'PAUSED') return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
  if (normalizedStatus === 'COMPLETED') return 'bg-white/10 text-white/70 border-white/10';
  if (normalizedStatus === 'CANCELLED') return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
  return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
};

const addMinutesLocalInput = (dateValue, minutes) => {
  const date = new Date(dateValue);
  date.setMinutes(date.getMinutes() + minutes);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getBookingTiming = (booking) => {
  const now = new Date();
  const status = getBookingStatus(booking);
  const start = new Date(getBookingStart(booking));
  const end = new Date(getBookingEnd(booking));
  const minutesToStart = Math.ceil((start.getTime() - now.getTime()) / 60000);
  const minutesToEnd = Math.ceil((end.getTime() - now.getTime()) / 60000);

  return {
    canEditBeforeCheckIn: status === 'PAID' && now < start,
    canExtend: ['PAID', 'ACTIVE', 'PAUSED'].includes(status),
    canComplete: false, // Customers cannot complete/check-out remotely. Must use Kiosk.
    isNearExpiry: status === 'ACTIVE' && minutesToEnd > 0 && minutesToEnd <= 30,
    minutesToStart,
    minutesToEnd,
  };
};

export default function BookingPage() {
  const socket = useSocket();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [dialog, setDialog] = useState(null); // { type: 'plate' | 'extend', booking: obj }
  const [vehicles, setVehicles] = useState([]);
  const [vehicleInput, setVehicleInput] = useState('');
  const [manualPlateInput, setManualPlateInput] = useState('');
  const [extendEndTime, setExtendEndTime] = useState('');
  const [qrDialog, setQrDialog] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(null);
  const [cancelQuoteLoading, setCancelQuoteLoading] = useState('');
  const lastEventRef = useRef(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const [bookingRes, vehicleRes] = await Promise.all([
        getMyBookings(),
        getMyVehicles()
      ]);
      if (bookingRes.ok) setBookings(bookingRes.data?.data || []);
      if (vehicleRes.ok) setVehicles(vehicleRes.data?.data || []);
    } catch {
      setError('Could not load data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadData();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const handleBookingChanged = (payload) => {
      lastEventRef.current = payload;
      setSuccess('Booking status updated automatically.');
      loadData(true);
    };

    socket.on('booking:changed', handleBookingChanged);
    return () => {
      socket.off('booking:changed', handleBookingChanged);
    };
  }, [socket]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    }, 15000);

    const handleFocus = () => loadData(true);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!success) return undefined;
    const timer = setTimeout(() => setSuccess(''), 2500);
    return () => clearTimeout(timer);
  }, [success]);

  const runBookingAction = async (actionKey, action) => {
    setActionLoading(actionKey);
    setError('');
    setSuccess('');

    try {
      const res = await action();
      if (!res.ok) {
        setError(res.data?.message || 'Booking action failed.');
        return null;
      }

      await loadData(true);
      return res;
    } catch {
      setError('Network error while updating booking.');
      return null;
    } finally {
      setActionLoading('');
    }
  };

  const openPlateDialog = (booking) => {
    setDialog({ type: 'plate', booking });
    const approvedVehicles = vehicles.filter(v => v.status === 'approved');
    const match = approvedVehicles.find(v => v.licensePlate === booking.licensePlate);
    setVehicleInput(match ? match._id : (approvedVehicles.length > 0 ? approvedVehicles[0]._id : ''));
    setError('');
  };

  const openExtendDialog = (booking, minutes = 60) => {
    setDialog({ type: 'extend', booking });
    setExtendEndTime(addMinutesLocalInput(getBookingEnd(booking), minutes));
    setError('');
  };

  const submitPlateChange = async () => {
    if (!dialog?.booking || !vehicleInput) {
      setError('Please select a vehicle.');
      return;
    }

    if (vehicleInput === 'manual' && !manualPlateInput.trim()) {
      setError('Please enter a license plate.');
      return;
    }

    const payload = vehicleInput === 'manual'
      ? { licensePlate: manualPlateInput.trim() }
      : { vehicleId: vehicleInput };

    const res = await runBookingAction(`plate-${dialog.booking._id}`, () =>
      updateBookingVehicle(dialog.booking._id, payload)
    );

    if (res) {
      setDialog(null);
      setSuccess('Vehicle updated successfully.');
    }
  };

  const submitExtension = async () => {
    if (!dialog?.booking || !extendEndTime) {
      setError('New end time is required.');
      return;
    }

    const res = await runBookingAction(`extend-${dialog.booking._id}`, () =>
      extendBooking(dialog.booking._id, {
        newStart: new Date(getBookingStart(dialog.booking)).toISOString(),
        newEnd: new Date(extendEndTime).toISOString(),
      })
    );

    if (res) {
      setDialog(null);
      const extra = res.data?.data?.extraAmount || 0;
      setSuccess(extra > 0 ? `Booking extended. Wallet charged ${formatMoney(extra)}.` : 'Booking extended.');
    }
  };

  const handleCancel = async (booking) => {
    setError('');
    setCancelQuoteLoading(booking._id);
    try {
      const response = await getBookingCancellationQuote(booking._id);
      if (!response.ok) {
        setError(response.data?.message || 'Could not calculate the cancellation refund.');
        return;
      }
      setCancelDialog({
        booking,
        quote: response.data?.data || null,
      });
    } catch {
      setError('Network error while calculating the cancellation refund.');
    } finally {
      setCancelQuoteLoading('');
    }
  };

  const confirmCancel = async () => {
    if (!cancelDialog) return;

    const booking = cancelDialog.booking;
    const res = await runBookingAction(`cancel-${booking._id}`, () => cancelBooking(booking._id));
    if (res) {
      setCancelDialog(null);
      setSuccess(`Booking cancelled. Refunded ${formatMoney(res.data?.data?.refundAmount || 0)}.`);
    }
  };

  const openQrDialog = async (booking) => {
    setQrLoading(true);
    setError('');
    try {
      const response = await getBookingQr(booking._id);
      if (!response.ok || !response.data?.data?.payload) {
        setError(response.data?.message || 'This booking QR is no longer available.');
        return;
      }
      setQrDialog({
        booking,
        payload: response.data.data.payload,
      });
    } catch {
      setError('Network error while loading the booking QR.');
    } finally {
      setQrLoading(false);
    }
  };

  const approvedVehicles = vehicles.filter(v => v.status === 'approved');

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#050505] text-white p-6 md:p-8">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#050505] text-white p-6 md:p-8">
      <CustomerPageHeader
        icon={CalendarClock}
        title="My Bookings"
        description="Manage your parking reservations and check-in status."
        className="mb-8"
      />

      {(error || success) && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 flex items-start gap-3 ${error
            ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
          }`}>
          {error ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
          <span className="text-sm font-medium">{error || success}</span>
        </div>
      )}

      <section className="rounded-3xl bg-[#101010] border border-white/10 p-5 md:p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-black">All Reservations</h2>
            <p className="text-sm text-white/40">Present your booking QR code at the Kiosk to check in.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300 flex items-center gap-2">
              <Wifi size={12} />
              Live sync
            </div>
            <button
              type="button"
              onClick={() => loadData()}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-white/60 hover:text-white hover:bg-white/5 transition"
            >
              Refresh
            </button>
          </div>
        </div>

        {bookings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40 flex flex-col items-center">
            <CalendarClock size={48} className="mb-4 text-white/20" />
            <p className="text-lg font-bold text-white/60 mb-2">No bookings yet</p>
            <p className="text-sm max-w-sm">You haven't made any parking reservations. Click "Booking" on the top navigation bar to reserve a spot.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => {
              const timing = getBookingTiming(booking);
              const isBusy = actionLoading.endsWith(booking._id);
              const isCancelQuoteBusy = cancelQuoteLoading === booking._id;

              return (
                <div key={booking._id} className={`rounded-2xl border bg-white/[0.03] p-5 flex flex-col lg:flex-row lg:items-center gap-4 justify-between transition hover:border-white/20 ${
                  timing.isNearExpiry ? 'border-amber-400/40' : 'border-white/10'
                }`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xl font-black text-white">{getBookingSlot(booking)}</span>
                      <span className={`px-2.5 py-1 rounded-full border text-xs font-bold uppercase ${statusClass(booking.status)}`}>
                        {booking.status}
                      </span>
                      <span className="text-sm text-white/45">{booking.floorId?.name || 'Floor'}</span>
                      {timing.isNearExpiry && (
                        <span className="px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-400/10 text-xs font-bold uppercase text-amber-200">
                          {timing.minutesToEnd} min left
                        </span>
                      )}
                      {getBookingStatus(booking) === 'PAID' && timing.minutesToStart <= 15 && timing.minutesToStart >= -15 && (
                        <span className="px-2.5 py-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-xs font-bold uppercase text-cyan-200">
                          Arrival window
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-y-2 gap-x-6 text-sm text-white/60">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-widest uppercase text-white/30 mb-0.5">License Plate</span>
                        <span className="font-semibold text-white/80">{booking.licensePlate}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-widest uppercase text-white/30 mb-0.5">Time</span>
                        <span className="font-semibold text-white/80">{formatDateTime(getBookingStart(booking))} - {formatDateTime(getBookingEnd(booking))}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-widest uppercase text-white/30 mb-0.5">Paid</span>
                        <span className="font-bold text-yellow-400/90">{formatMoney(getBookingPaidAmount(booking))}</span>
                      </div>
                    </div>
                    {booking.services?.length > 0 && (
                      <div className="mt-3 text-xs text-yellow-400/70 font-medium">
                        + Services: {booking.services.map((service) => service.serviceName).join(', ')}
                      </div>
                    )}
                    {booking.refundAmount > 0 && (
                      <div className="mt-1 text-xs text-emerald-400/80 font-medium">
                        Refunded: {formatMoney(booking.refundAmount)}
                      </div>
                    )}
                    {getBookingStatus(booking) === 'EXPIRED' && (
                      <div className="mt-2 text-xs text-amber-300/80 font-medium">
                        This booking expired after the 15-minute late arrival grace period.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap lg:justify-end gap-2 shrink-0">
                    {['PAID', 'ACTIVE', 'PAUSED'].includes(getBookingStatus(booking)) && (
                      <button
                        type="button"
                        disabled={qrLoading}
                        onClick={() => openQrDialog(booking)}
                        className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-400/20 transition flex items-center gap-2 disabled:opacity-50"
                      >
                        {qrLoading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                        Show QR
                      </button>
                    )}
                    {timing.canExtend && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openExtendDialog(booking, timing.isNearExpiry ? 30 : 60)}
                        className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/20 transition flex items-center gap-2 disabled:opacity-50"
                      >
                        <TimerReset size={14} />
                        Extend
                      </button>
                    )}
                    {timing.canEditBeforeCheckIn && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openPlateDialog(booking)}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:bg-white/5 transition flex items-center gap-2 disabled:opacity-50"
                      >
                        <Edit3 size={14} />
                        Change plate
                      </button>
                    )}
                    {timing.canEditBeforeCheckIn && (
                      <button
                        type="button"
                        disabled={isBusy || Boolean(cancelQuoteLoading)}
                        onClick={() => handleCancel(booking)}
                        className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-400/20 transition flex items-center gap-2 disabled:opacity-50"
                      >
                        {isCancelQuoteBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Cancel
                      </button>
                    )}
                    {!timing.canExtend && !timing.canEditBeforeCheckIn && (
                      <button
                        type="button"
                        onClick={() => { window.location.href = '/booking'; }}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 transition flex items-center gap-2"
                      >
                        <RotateCcw size={14} />
                        Book again
                      </button>
                    )}
                    {isBusy && <Loader2 size={16} className="animate-spin text-white/40 mt-2" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 className="text-xl font-black text-white">
                  {dialog.type === 'plate' ? 'Change License Plate' : 'Extend Parking'}
                </h3>
                <p className="text-sm text-white/45 mt-1">
                  Slot {getBookingSlot(dialog.booking)} - {dialog.booking.floorId?.name || 'Floor'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/50 hover:text-white hover:bg-white/5 transition"
              >
                Close
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 flex items-start gap-3 text-rose-400">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}

            {dialog.type === 'plate' ? (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">Select New Vehicle</span>
                  <select
                    value={vehicleInput}
                    onChange={(event) => setVehicleInput(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-[#1e1e1e] px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-400"
                  >
                    <option value="" disabled>-- Choose a registered vehicle --</option>
                    <option value="manual">Manual plate</option>
                    {approvedVehicles.map(v => (
                      <option key={v._id} value={v._id}>
                        {v.licensePlate} ({v.type})
                      </option>
                    ))}
                  </select>
                </label>
                {vehicleInput === 'manual' && (
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">Enter License Plate</span>
                    <input
                      type="text"
                      placeholder="e.g. 51G12345"
                      value={manualPlateInput}
                      onChange={(event) => setManualPlateInput(event.target.value.toUpperCase())}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-400"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">New end time</span>
                  <input
                    type="datetime-local"
                    value={extendEndTime}
                    min={addMinutesLocalInput(getBookingEnd(dialog.booking), 30)}
                    onChange={(event) => setExtendEndTime(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-400"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[30, 60, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setExtendEndTime(addMinutesLocalInput(getBookingEnd(dialog.booking), minutes))}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 transition flex items-center justify-center gap-1"
                    >
                      <Clock size={13} />
                      +{minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 hover:text-white hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(actionLoading)}
                onClick={dialog.type === 'plate' ? submitPlateChange : submitExtension}
                className="flex-1 rounded-2xl bg-yellow-400 px-4 py-3 text-sm font-black text-black hover:bg-yellow-300 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-rose-400/25 bg-[#121212] p-6 shadow-2xl">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-400/25 bg-rose-400/10 text-rose-200">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-xl font-black text-white">Cancel booking?</h3>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Slot {getBookingSlot(cancelDialog.booking)} - {cancelDialog.booking.licensePlate}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold text-white/50">Policy refund</span>
                <span className="font-black text-yellow-300">
                  {formatMoney(cancelDialog.quote?.refundAmount || 0)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 text-xs">
                <span className="font-semibold text-white/35">Paid amount</span>
                <span className="font-bold text-white/55">{formatMoney(getBookingPaidAmount(cancelDialog.booking))}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/40">
                Applied policy: {cancelDialog.quote?.refundBreakdown?.appliedRefundPercent ?? 0}% refund for the current cancellation window.
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={Boolean(actionLoading)}
                onClick={() => setCancelDialog(null)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                Keep booking
              </button>
              <button
                type="button"
                disabled={Boolean(actionLoading)}
                onClick={confirmCancel}
                className="flex-1 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {qrDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-white">Booking QR</h3>
                <p className="mt-1 text-sm text-white/45">
                  {getBookingSlot(qrDialog.booking)} · {qrDialog.booking.licensePlate}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close booking QR"
                onClick={() => setQrDialog(null)}
                className="rounded-xl border border-white/10 p-2 text-white/50 hover:bg-white/5 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-5">
              <QRCodeSVG
                value={qrDialog.payload}
                size={256}
                level="M"
                className="h-auto w-full"
              />
            </div>
            <p className="mt-4 text-center text-xs leading-5 text-white/45">
              Present this code to the kiosk or staff. It becomes invalid when the booking ends.
            </p>
            <p className="mt-2 break-all text-center font-mono text-[10px] text-white/25">
              Ref: {qrDialog.booking._id}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

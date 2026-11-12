import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import ParkingMapViewer from '../../components/ParkingMapViewer';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { formatLicensePlateDisplay } from '../../utils/licensePlate';

const resolveZoneLabel = (slotRecord, slotCode) => {
  const rawZoneName = slotRecord?.zoneID?.zoneName;
  if (typeof rawZoneName === 'string' && rawZoneName.trim()) {
    const normalized = rawZoneName.trim();
    if (/^zone\b/i.test(normalized)) return normalized;
    if (/^[A-Z]$/i.test(normalized)) return `Zone ${normalized.toUpperCase()}`;
    return normalized;
  }

  const zoneMatch = String(slotCode || '').trim().match(/^[A-Z]+/i);
  if (zoneMatch) {
    return `Zone ${zoneMatch[0].toUpperCase()}`;
  }

  return '--';
};

export default function KioskFastPass({ formData, isMonthly, onAutoCheckIn, onComplete, successSession }) {
  const socket = useSocket();
  const [issuedSession, setIssuedSession] = useState(successSession);
  const [status, setStatus] = useState(successSession ? 'ready' : 'checking-in');
  const [errorMessage, setErrorMessage] = useState('');
  const [floors, setFloors] = useState([]);
  const [dbSlots, setDbSlots] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [availableSlots, setAvailableSlots] = useState(null);
  const [activeHolds, setActiveHolds] = useState([]);
  const [vipRedirectInfo, setVipRedirectInfo] = useState(null);
  const [currentSlot, setCurrentSlot] = useState(successSession?.parkingSlot || formData.selectedSlot);
  const hasStartedRef = useRef(false);
  const mountTimeRef = useRef(0);
  const hasSeenOpenRef = useRef(false);
  const isRedirectingRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const returnToStart = useCallback(() => {
    if (isRedirectingRef.current) return;
    isRedirectingRef.current = true;

    try {
      onCompleteRef.current?.();
    } catch (e) {
      console.error(e);
    } finally {
      window.location.replace('/kiosk');
    }
  }, []);

  // Màn hình tự động quay trở lại màn hình chính (Click to start) khi xe đi qua barrier ENTRY_1 hoặc staff đóng cổng
  useEffect(() => {
    mountTimeRef.current = Date.now();
    let returnTimerId = null;

    const scheduleReturn = () => {
      if (returnTimerId || isRedirectingRef.current) return;
      const elapsed = Date.now() - mountTimeRef.current;
      const delay = Math.max(0, 1500 - elapsed);
      if (delay === 0) {
        returnToStart();
      } else {
        returnTimerId = setTimeout(returnToStart, delay);
      }
    };

    const processGateState = (gateData) => {
      if (!gateData || (gateData.gate && gateData.gate !== 'ENTRY_1')) return;
      if (gateData.open) {
        hasSeenOpenRef.current = true;
        return;
      }
      const closedAfterMount = Boolean(gateData.forceClose)
        && Number(gateData.timestamp || 0) >= mountTimeRef.current;
      if (hasSeenOpenRef.current || closedAfterMount) {
        scheduleReturn();
      }
    };

    // 1. Kiểm tra trạng thái đóng của Barrier ENTRY_1 qua Polling
    const checkBarrier = async () => {
      try {
        const res = await fetch(`${API_BASE}/iot/barrier-status?gate=ENTRY_1&_t=${Date.now()}`, {
          cache: 'no-store'
        });
        const data = await res.json();
        if (data.success && data.data) {
          processGateState(data.data);
        }
      } catch {
        // ignore
      }
    };

    // Initial check immediately
    checkBarrier();
    const interval = setInterval(checkBarrier, 300);

    // Bộ đếm an toàn 35s chỉ kích hoạt nếu ESP32 mất kết nối hoàn toàn
    const maxTimeoutTimer = setTimeout(() => {
      returnToStart();
    }, 35000);

    // 2. Lắng nghe real-time qua Socket.IO
    const handleBarrierControl = (data) => {
      processGateState(data);
    };

    if (socket) {
      socket.on('gate:barrier_control', handleBarrierControl);
    }

    return () => {
      clearInterval(interval);
      clearTimeout(maxTimeoutTimer);
      if (returnTimerId) clearTimeout(returnTimerId);
      if (socket) {
        socket.off('gate:barrier_control', handleBarrierControl);
      }
    };
  }, [socket, returnToStart]);

  useEffect(() => {
    if (successSession) {
      const timerId = window.setTimeout(() => setStatus('ready'), 0);
      return () => window.clearTimeout(timerId);
    }

    if (hasStartedRef.current) return undefined;
    hasStartedRef.current = true;
    let ignore = false;

    const runFastPassEntry = async () => {
      try {
        setStatus('checking-in');
        const resData = await onAutoCheckIn();
        if (ignore) return;

        if (resData.vipRedirected) {
          setVipRedirectInfo({ message: resData.message });
          setCurrentSlot(resData.newSlot);
        }
        setIssuedSession({ ...resData.data, pass: resData.pass });
        setStatus('ready');
      } catch (error) {
        if (ignore) return;
        setStatus('error');
        setErrorMessage(error.message || 'Fast-pass check-in failed.');
      }
    };

    runFastPassEntry();

    return () => {
      ignore = true;
    };
  }, [onAutoCheckIn, successSession]);

  useEffect(() => {
    if (!formData.floorId) return undefined;
    let ignore = false;

    const fetchMapData = async () => {
      try {
        const effectiveHours = Number(formData.durationHours || 1);
        const startTimeStr = new Date().toISOString();
        const endTimeStr = new Date(Date.now() + effectiveHours * 60 * 60 * 1000).toISOString();

        const [floorsRes, slotsRes, sessionsRes, availableRes, holdsRes] = await Promise.all([
          fetch(`${API_BASE}/parking-floors`),
          fetch(`${API_BASE}/parking-floors/${formData.floorId}/slots`),
          fetch(`${API_BASE}/sessions/active-status`),
          fetch(`${API_BASE}/bookings/available-slots?startTime=${startTimeStr}&endTime=${endTimeStr}`, {
            headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken')}` }
          }),
          fetch(`${API_BASE}/bookings/active-holds`, {
            headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken')}` }
          })
        ]);

        const [floorsData, slotsData, sessionsData] = await Promise.all([floorsRes.json(), slotsRes.json(), sessionsRes.json()]);

        let availableData = { success: false };
        let holdsData = { success: false };
        if (availableRes.ok) availableData = await availableRes.json();
        if (holdsRes.ok) holdsData = await holdsRes.json();

        if (ignore) return;

        if (floorsData.success) setFloors(floorsData.data || []);
        if (slotsData.success) setDbSlots(slotsData.data || []);
        if (sessionsData.success) setActiveSessions(sessionsData.data || []);
        if (availableData.success && availableData.data?.slots) setAvailableSlots(availableData.data.slots);
        if (holdsData.success) setActiveHolds(holdsData.data || []);
      } catch (error) {
        console.error('Failed to load fast-pass map data', error);
      }
    };

    fetchMapData();
    return () => {
      ignore = true;
    };
  }, [formData.floorId, formData.durationHours]);

  const isSubscriptionFlow = Boolean(isMonthly);
  const floorRecord = floors.find((floor) => floor._id === formData.floorId);
  const selectedSlotRecord = dbSlots.find((slot) => slot.slotNumber === currentSlot);
  const zoneLabel = resolveZoneLabel(selectedSlotRecord, currentSlot);
  const floorLabel = floorRecord?.name || formData.bookingFloorName || (isSubscriptionFlow ? 'Member floor' : 'Reserved floor');
  const ticketSession = successSession || issuedSession;
  const qrCodeValue = ticketSession?.pass?.payload || ticketSession?.exitQrPayload || null;
  const displayPlate = formatLicensePlateDisplay(ticketSession?.licensePlate || formData.licensePlate) || '--';
  const sessionTypeLabel = ticketSession?.type === 'SUBSCRIPTION' || isSubscriptionFlow
    ? 'VIP Member'
    : ticketSession?.type === 'BOOKING'
      ? 'Pre-Booked'
      : 'Walk-in Pass';
  const checkInTimeLabel = ticketSession?.checkInTime
    ? new Date(ticketSession.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 items-center overflow-hidden">
      <div className="w-full max-w-[1040px] flex flex-col gap-3 flex-1 min-h-0">
        {vipRedirectInfo && (
          <div className="bg-amber-50 border-2 border-amber-400 text-amber-900 rounded-[18px] shadow-sm px-4 py-2.5 flex items-center gap-3 animate-fade-in shrink-0">
            <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="font-black text-sm uppercase tracking-tight text-amber-800">Sự cố ô đỗ VIP</h3>
              <p className="font-semibold text-xs leading-tight text-amber-700">{vipRedirectInfo.message}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-[22px] border border-gray-100 shadow-[0_14px_30px_rgba(15,23,42,0.07)] px-4 py-3 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-600">
              Parking Access
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {checkInTimeLabel && (
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold text-gray-600">
                  In at {checkInTimeLabel}
                </span>
              )}
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  status === 'ready'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : status === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-cyan-50 border-cyan-200 text-cyan-700'
                }`}
              >
                {status === 'ready' ? `${sessionTypeLabel} · Ready` : status === 'error' ? 'Check-in Error' : 'Checking in...'}
              </span>
            </div>
          </div>

          <div className="flex items-stretch justify-between gap-3 min-w-0">
            <div className="grid min-w-0 flex-1 grid-cols-2 2xl:grid-cols-4 gap-2">
              <SummaryItem
                label="License Plate"
                value={displayPlate}
                valueClassName="text-[15px] md:text-[16px]"
              />
              <SummaryItem label="Slot" value={currentSlot || '--'} valueClassName="text-[15px] md:text-[16px]" />
              <SummaryItem label="Zone" value={zoneLabel} valueClassName="text-[14px] md:text-[15px]" />
              <SummaryItem label="Floor" value={floorLabel} valueClassName="text-[14px] md:text-[15px]" />
            </div>

            {/* Mã QR dành cho khách chụp lại để check-out */}
            {status === 'ready' && qrCodeValue && (
              <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-[16px] px-3 py-2 shrink-0">
                <div className="bg-white p-1 rounded-lg border border-gray-100 shadow-xs shrink-0">
                  <QRCodeSVG value={qrCodeValue} size={64} level="M" title="Parking ticket for checkout" />
                </div>
                <div className="flex flex-col justify-center min-w-[84px]">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-cyan-700">
                    Exit QR Code
                  </span>
                  <span className="text-[11px] font-bold text-[#0f172a] leading-tight mt-0.5">
                    Scan at exit
                  </span>
                  <span className="text-[9px] font-medium text-gray-500 leading-snug mt-0.5">
                    Save or snap
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {status === 'error' ? (
          <div className="w-full max-w-[1040px] bg-red-50 border border-red-200 rounded-[24px] px-8 py-7 text-center text-red-600 font-semibold">
            {errorMessage}
          </div>
        ) : (
          <div className="w-full bg-white rounded-[24px] border border-gray-100 shadow-[0_16px_36px_rgba(15,23,42,0.08)] p-3.5 flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-4 mb-2 shrink-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-600">
                Parking Layout
              </div>
              <div className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-700 shrink-0">
                {floorLabel} · {zoneLabel} · Slot {currentSlot || formData.selectedSlot || '--'}
              </div>
            </div>

            <div className="rounded-[20px] overflow-hidden border border-[#0b0e16] shadow-sm bg-[#0b0e16] flex-1 min-h-0 relative">
              <ParkingMapViewer
                floors={floors.filter((floor) => floor._id === formData.floorId)}
                currentFloorId={formData.floorId}
                onFloorSelect={() => { }}
                activeSessions={activeSessions}
                dbSlots={dbSlots}
                availableSlots={availableSlots}
                activeHolds={activeHolds}
                selectedSlotId={currentSlot}
                onSelectSlot={null}
                is2DMode={true}
                hideUI={true}
                theme="dark"
                initialZoom={0.58}
                staticFit={true}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryItem({ label, value, valueClassName = 'text-[15px] md:text-[16px]' }) {
  return (
    <div className="rounded-[14px] border border-gray-200 bg-gray-50 px-3 py-1.5 min-w-0 flex flex-col justify-center">
      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 leading-none mb-0.5">{label}</div>
      <div className={`${valueClassName} font-black text-[#0f172a] leading-tight whitespace-nowrap`}>{value}</div>
    </div>
  );
}

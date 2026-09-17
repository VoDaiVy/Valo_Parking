import { useEffect, useRef, useState } from 'react';
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
  const hasCompletedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Màn hình chỉ thực sự đóng và quay trở lại màn hình chính khi xe đi qua barrier ENTRY_1 hoặc staff đóng cổng
  useEffect(() => {
    if (status !== 'ready') return undefined;

    let hasSeenOpen = false; // Bắt đầu là false, chỉ kích hoạt khi cổng ENTRY_1 đã được xác nhận mở

    const returnToStart = () => {
      if (hasCompletedRef.current) return;
      hasCompletedRef.current = true;

      try {
        onCompleteRef.current?.();
      } finally {
        window.setTimeout(() => {
          window.location.assign('/kiosk');
        }, 150);
      }
    };

    // Kiểm tra trạng thái đóng của Barrier ENTRY_1 qua Polling
    const checkBarrier = async () => {
      try {
        const res = await fetch(`${API_BASE}/iot/barrier-status?gate=ENTRY_1`);
        const data = await res.json();
        if (data.success && data.data) {
          if (data.data.open) {
            hasSeenOpen = true;
          } else if (hasSeenOpen && !data.data.open) {
            // Cổng ENTRY_1 đã đóng sau khi xe qua -> hoàn tất và quay về màn hình chính
            returnToStart();
          }
        }
      } catch (err) {
        // ignore
      }
    };

    const interval = setInterval(checkBarrier, 500);

    const handleBarrierControl = (data) => {
      if (data && (data.gate === 'ENTRY_1' || !data.gate)) {
        if (data.open) {
          hasSeenOpen = true;
        } else if (hasSeenOpen && !data.open) {
          returnToStart();
        }
      }
    };

    if (socket) {
      socket.on('gate:barrier_control', handleBarrierControl);
    }

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.off('gate:barrier_control', handleBarrierControl);
      }
    };
  }, [status, socket]);

  useEffect(() => {
    if (successSession) {
      setStatus('ready');
      return undefined;
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
  const qrCodeValue = successSession?._id || successSession?.sessionId || null;

  return (
    <div className="flex flex-col flex-1 min-h-0 items-center overflow-hidden">
      <div className="w-full max-w-[980px] flex flex-col gap-4 flex-1 min-h-0">
        {vipRedirectInfo && (
          <div className="bg-amber-50 border-2 border-amber-400 text-amber-900 rounded-[20px] shadow-sm px-5 py-4 flex items-center gap-4 animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="font-black text-lg uppercase tracking-tight text-amber-800 mb-0.5">Sự cố ô đỗ VIP</h3>
              <p className="font-semibold text-sm leading-tight text-amber-700">{vipRedirectInfo.message}</p>
            </div>
          </div>
        )}
        
        <div className="bg-white rounded-[26px] border border-gray-100 shadow-[0_20px_40px_rgba(15,23,42,0.08)] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-3 min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-600">
                Parking Access
              </div>

              <div className="grid min-w-0 grid-cols-[minmax(0,1.45fr)_minmax(88px,0.58fr)_minmax(112px,0.74fr)_minmax(112px,0.74fr)] gap-3">
                <SummaryItem
                  label="License Plate"
                  value={formatLicensePlateDisplay(successSession?.licensePlate || formData.licensePlate) || '--'}
                  valueClassName="text-[18px] md:text-[20px]"
                />
                <SummaryItem label="Slot" value={currentSlot || '--'} />
                <SummaryItem label="Zone" value={zoneLabel} />
                <SummaryItem label="Floor" value={floorLabel} />
              </div>
            </div>

            {/* Mã QR dành cho khách vãng lai chụp lại để check-out */}
            {qrCodeValue && (
              <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-2xl p-2.5 shrink-0">
                <QRCodeSVG value={qrCodeValue} size={64} />
                <div className="flex flex-col justify-center pr-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Exit QR Code</span>
                  <span className="text-[11px] font-bold text-gray-700">Scan at exit</span>
                  <span className="text-[9px] font-mono text-gray-400">{qrCodeValue.slice(0, 8)}...</span>
                </div>
              </div>
            )}
          </div>
        </div>

      {status === 'error' ? (
        <div className="w-full max-w-[980px] bg-red-50 border border-red-200 rounded-[28px] px-8 py-7 text-center text-red-600 font-semibold">
          {errorMessage}
        </div>
      ) : (
        <div className="w-full bg-white rounded-[28px] border border-gray-100 shadow-[0_20px_40px_rgba(15,23,42,0.08)] p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-600">
              Parking Layout
            </div>
            <div className="rounded-full bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-gray-600 shrink-0">
              {zoneLabel} · {currentSlot || formData.selectedSlot || '--'}
            </div>
          </div>

          <div className="rounded-[24px] overflow-hidden border border-[#0b0e16] shadow-sm bg-[#0b0e16] flex-1 min-h-0 relative">
            <ParkingMapViewer
              floors={floors.filter((floor) => floor._id === formData.floorId)}
              currentFloorId={formData.floorId}
              onFloorSelect={() => {}}
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

function SummaryItem({ label, value, valueClassName = 'text-[18px] md:text-[19px]' }) {
  return (
    <div className="rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3 min-w-0 overflow-hidden">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</div>
      <div className={`${valueClassName} font-black text-[#0f172a] leading-tight truncate`}>{value}</div>
    </div>
  );
}

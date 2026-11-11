import { useCallback, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ParkingMapGrid from "../../components/ParkingMapGrid";
import { getAllFloors, getFloorSlots } from "../../services/parkingFloorService";
import { getActiveSessions } from "../../services/sessionService";
import {
  MonitorCheck,
  X,
  Camera,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  History,
  Clock,
  CheckCircle2,
  Phone,
  RotateCw,
  RotateCcw,
  Maximize2
} from "lucide-react";
import StaffCheckoutModal from "./StaffCheckoutModal";
import { getAvailableBookingSlots, getActiveHolds, getActiveMapBookings } from "../../services/bookingService";
import { getRequiredSourcesAvailability } from "../../utils/staffOperationalAvailability";
import StaffDropdown from "./components/StaffDropdown.jsx";
import { STAFF_THEME } from "./components/staffTheme.js";
import SlotCameraMonitorModal from "./components/SlotCameraMonitorModal.jsx";
import ViolationResolutionModal from "./components/ViolationResolutionModal.jsx";
import GlobalViolationHistoryModal from "./components/GlobalViolationHistoryModal.jsx";
import { formatLicensePlateDisplay } from "../../utils/licensePlate";
import { getSlotLogs, clearAllViolationsApi } from "../../services/aiSurveillanceService";
import toast from "react-hot-toast";

export default function LiveGridMonitor() {
  const [floors, setFloors] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);
  const [liveDataAvailable, setLiveDataAvailable] = useState(false);
  const [liveDataError, setLiveDataError] = useState('Live operational data is unavailable.');
  const [availableSlots, setAvailableSlots] = useState(null);
  const [activeHolds, setActiveHolds] = useState([]);
  const [activeBookings, setActiveBookings] = useState([]);
  const [dbSlots, setDbSlots] = useState([]);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryFloorId = searchParams.get("floorId");

  // Slot Slideover Tabs & History
  const [slotTab, setSlotTab] = useState('details'); // 'details' | 'history'
  const [slotLogs, setSlotLogs] = useState([]);
  const [loadingSlotLogs, setLoadingSlotLogs] = useState(false);

  useEffect(() => {
    if (floors.length > 0 && queryFloorId) {
      const targetFloor = floors.find((f) => String(f._id) === queryFloorId);
      if (targetFloor) {
        setTimeout(() => {
          setCurrentFloorId(queryFloorId);
          const newParams = new URLSearchParams(searchParams);
          newParams.delete("floorId");
          setSearchParams(newParams, { replace: true });
        }, 0);
      }
    }
  }, [floors, queryFloorId, searchParams, setSearchParams]);

  // AI Surveillance & Global History States
  const [showSurveillanceModal, setShowSurveillanceModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [floorAiStatusesMap, setFloorAiStatusesMap] = useState({});
  const [selectedViolation, setSelectedViolation] = useState(null);

  // Persistence: Merge DB-saved slot observations with fresh camera scans
  const aiSlotStatuses = useMemo(() => {
    const dbStatuses = (dbSlots || [])
      .filter((s) => s.aiObservation && (s.aiObservation.occupied || s.aiObservation.isViolation))
      .map((s) => ({
        slotCode: s.slotNumber,
        floorId: s.floorID?._id || s.floorID,
        occupied: s.aiObservation.occupied,
        plate: s.aiObservation.detectedPlate,
        detectedPlate: s.aiObservation.detectedPlate,
        isViolation: s.aiObservation.isViolation,
        violationType: s.aiObservation.violationType,
        status: s.aiObservation.isViolation
          ? (s.aiObservation.violationType || 'WRONG_SLOT_VIOLATION')
          : 'OCCUPIED_VALID',
        expectedSlot: s.aiObservation.expectedSlot,
        expectedPlate: s.aiObservation.expectedPlate,
        evidenceSnapshot: s.aiObservation.evidenceSnapshot,
        fullSnapshot: s.aiObservation.fullSnapshot,
        violationMessage: s.aiObservation.violationMessage,
        sessionId: s.aiObservation.sessionId,
      }));

    const freshScans = Object.values(floorAiStatusesMap).flat();
    const map = new Map();
    dbStatuses.forEach((s) => map.set(s.slotCode?.toUpperCase(), s));
    freshScans.forEach((s) => map.set(s.slotCode?.toUpperCase(), s));

    const seenPlates = new Set();
    const seenSlots = new Set();
    const result = [];

    for (const slot of map.values()) {
      const slotKey = `${slot.slotCode?.toUpperCase()}`;
      const plate = (slot.plate || slot.detectedPlate || slot.session?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      
      if (seenSlots.has(slotKey)) continue;
      seenSlots.add(slotKey);

      if (plate) {
        if (seenPlates.has(plate)) continue;
        seenPlates.add(plate);
      }
      result.push(slot);
    }
    return result;
  }, [dbSlots, floorAiStatusesMap]);

  useEffect(() => {
    document.body.classList.add("bg-[#080808]");
    return () => document.body.classList.remove("bg-[#080808]");
  }, []);

  const invalidateLiveData = useCallback((message) => {
    setFloors([]);
    setDbSlots([]);
    setActiveSessions([]);
    setAvailableSlots(null);
    setActiveHolds([]);
    setActiveBookings([]);
    setLiveDataAvailable(false);
    setLiveDataError(message);
    setSelectedSlot(null);
    setShowCheckoutModal(false);
  }, []);

  const fetchLiveStatus = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const floorsRes = await getAllFloors();
      const floorsState = getRequiredSourcesAvailability([{ name: 'Floors', response: floorsRes }]);
      if (!floorsState.isAvailable) {
        invalidateLiveData(floorsState.error);
        return;
      }

      const nextFloors = floorsRes.data.data || [];
      const floorSlotResults = await Promise.all(
        nextFloors.map(async (floor) => ({
          name: `Floor slots (${floor.name || floor._id})`,
          response: await getFloorSlots(floor._id),
        })),
      );
      const startTimeStr = new Date().toISOString();
      const endTimeStr = new Date(Date.now() + 60 * 1000).toISOString();
      const [sessionsRes, availableRes, holdsRes, bookingsRes] = await Promise.all([
        getActiveSessions(),
        getAvailableBookingSlots({ startTime: startTimeStr, endTime: endTimeStr }),
        getActiveHolds(),
        getActiveMapBookings(),
      ]);
      const availability = getRequiredSourcesAvailability([
        { name: 'Floors', response: floorsRes },
        ...floorSlotResults,
        { name: 'Active sessions', response: sessionsRes },
        { name: 'Available booking slots', response: availableRes },
        { name: 'Active holds', response: holdsRes },
        { name: 'Active map bookings', response: bookingsRes },
      ]);
      if (!availability.isAvailable) {
        invalidateLiveData(availability.error);
        return;
      }

      setFloors(nextFloors);
      setDbSlots(floorSlotResults.flatMap(({ response }) => response.data.data || []));
      setActiveSessions(sessionsRes.data.data || []);
      setAvailableSlots(availableRes.data.data?.slots || []);
      setActiveHolds(holdsRes.data.data || []);
      setActiveBookings(bookingsRes.data.data || []);
      setLiveDataAvailable(true);
      setLiveDataError('');
    } catch (err) {
      console.error("Failed to fetch live status", err);
      invalidateLiveData(err?.message || 'Live operational data is unavailable.');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [invalidateLiveData]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchLiveStatus(true);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [fetchLiveStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchLiveStatus(false);
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [fetchLiveStatus]);

  // Violations list computed from AI surveillance: only actual wrong-slot / unauthorized violations
  const violations = useMemo(() => {
    if (!Array.isArray(aiSlotStatuses)) return [];
    return aiSlotStatuses.filter((s) => {
      const isWrongSlot = s.status === 'WRONG_SLOT_VIOLATION' || s.violationType === 'WRONG_SLOT_VIOLATION';
      const isUnauth = s.status === 'UNAUTHORIZED_PARKING' || s.violationType === 'UNAUTHORIZED_PARKING' || s.status === 'UNAUTHORIZED_OCCUPANCY';
      // If expectedSlot matches current slot, vehicle is parked in its assigned slot (NOT a wrong slot!)
      if (isWrongSlot && s.expectedSlot && s.slotCode && s.expectedSlot.toUpperCase() === s.slotCode.toUpperCase()) {
        return false;
      }
      return (isWrongSlot || isUnauth) && s.isViolation;
    });
  }, [aiSlotStatuses]);

  const handleResetAlerts = async () => {
    try {
      const res = await clearAllViolationsApi(currentFloorId || null);
      if (res.success) {
        toast.success(res.message || 'Đã đặt lại và hủy cảnh báo!');
        setFloorAiStatusesMap({});
        fetchLiveStatus();
      } else {
        toast.error(res.message || 'Không thể đặt lại cảnh báo');
      }
    } catch (err) {
      toast.error('Lỗi khi đặt lại cảnh báo');
    }
  };

  // When selectedSlot changes, fetch its individual logs
  useEffect(() => {
    if (selectedSlot?.id) {
      setSlotTab('details');
      setLoadingSlotLogs(true);
      getSlotLogs(selectedSlot.id, selectedSlot.floorId)
        .then((res) => {
          if (res?.success) setSlotLogs(res.data || []);
          else setSlotLogs([]);
        })
        .catch(() => setSlotLogs([]))
        .finally(() => setLoadingSlotLogs(false));
    } else {
      setSlotLogs([]);
    }
  }, [selectedSlot?.id, selectedSlot?.floorId]);

  // Handle slot click from 3D map
  const handleSlotClick = (clickedItem) => {
    if (clickedItem?.isWrongSlot && clickedItem?.aiStatus) {
      setSelectedViolation({
        ...clickedItem.aiStatus,
        slotCode: clickedItem.id,
        actualSlot: clickedItem.id,
      });
      return;
    }
    setSelectedSlot(clickedItem);
  };

  return (
    <div className={`${STAFF_THEME.page} relative flex h-[calc(100vh-70px)] flex-col overflow-hidden font-sans`}
      style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`, backgroundSize: '30px 30px' }}>

      {/* Top Toolbar: Minimal, Clean, Focused */}
      <div className="absolute left-8 top-4 z-50 flex items-center gap-3 rounded-xl border border-[#ffd555]/15 bg-[#111111]/95 p-2 shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur flex-wrap">
        <div className="flex items-center gap-2 px-3 border-r border-white/10">
          <MonitorCheck size={18} className="text-[#ffd555]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#ffd555]">Live Monitor</span>
        </div>

        <StaffDropdown
          value={currentFloorId || ""}
          onChange={(value) => setCurrentFloorId(value === "" ? null : value)}
          options={floors.length > 0
            ? [
              ["", "Overview (All Floors)"],
              ...floors.map((floor) => [floor._id, floor.name]),
            ]
            : [{ value: "", label: "No floors available", disabled: true }]}
          ariaLabel="Select parking floor"
          disabled={floors.length === 0}
          className="min-w-[190px]"
          buttonClassName="bg-black/40 text-xs font-bold uppercase tracking-wide"
          menuClassName="w-full min-w-[220px]"
        />

        <div className="flex items-center gap-1.5 px-3 border-r border-white/10">
          <div className={`w-2 h-2 rounded-full ${liveDataAvailable ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-[10px] font-mono ${liveDataAvailable ? 'text-gray-400' : 'text-red-400'}`}>
            {liveDataAvailable ? 'LIVE UPDATE' : 'LIVE DATA UNAVAILABLE'}
          </span>
        </div>

        {/* Primary Action 1: Camera AI */}
        <button
          type="button"
          onClick={() => setShowSurveillanceModal(true)}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/40 text-cyan-300 font-extrabold text-xs hover:bg-cyan-500 hover:text-black transition shadow-sm active:scale-95"
          title="Mở Camera AI Giám Sát Ô Đỗ"
        >
          <Camera size={14} className="text-cyan-400" />
          <span>Camera AI</span>
          {violations.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] font-black bg-red-500 text-white rounded-full animate-bounce">
              {violations.length} Vi phạm
            </span>
          )}
        </button>

        {/* Primary Action 2: Lịch Sử Vi Phạm Toàn Bãi */}
        <button
          type="button"
          onClick={() => setShowHistoryModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400/20 to-yellow-500/20 border border-amber-400/40 text-amber-300 font-bold text-xs hover:bg-amber-400 hover:text-black transition shadow-sm active:scale-95"
          title="Xem toàn bộ lịch sử vi phạm & nhật ký xử lý bãi đỗ"
        >
          <History size={14} className="text-amber-400" />
          <span>Lịch Sử Vi Phạm</span>
        </button>
      </div>

      {/* Real-Time Violation Alert Banner */}
      {violations.length > 0 && (
        <div className="absolute top-20 left-8 right-8 z-40 bg-gradient-to-r from-red-950/95 via-red-900/90 to-red-950/95 border border-red-500/60 backdrop-blur-md px-5 py-3 rounded-2xl shadow-[0_10px_35px_rgba(239,68,68,0.3)] flex items-center justify-between text-white animate-in slide-in-from-top-4 duration-300 flex-wrap gap-3">
          <div className="flex items-center gap-3.5 flex-1 min-w-[320px]">
            <div className="p-2.5 rounded-xl bg-red-500/30 text-red-400 border border-red-500/50 shadow-inner shrink-0">
              <ShieldAlert size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-xs text-red-300 uppercase tracking-wider">
                  Cảnh báo: Phát hiện {violations.length} xe đỗ sai vị trí!
                </span>
                <span className="px-2 py-0.2 text-[9px] font-bold bg-red-500 text-white rounded-full uppercase">
                  AI Surveillance
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {violations.map((v) => {
                  const plateText = v.plate || v.detectedPlate || v.session?.licensePlate;
                  return (
                    <button
                      key={v.slotCode}
                      type="button"
                      onClick={() => setSelectedViolation({
                        ...v,
                        actualSlot: v.slotCode,
                        detectedPlate: plateText
                      })}
                      className="px-2.5 py-1 rounded-lg bg-black/50 hover:bg-black/80 border border-red-500/40 text-xs text-left transition hover:scale-105 active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-sm"
                      title="Bấm để xem bằng chứng & xử lý vi phạm ô này"
                    >
                      <span className="font-mono font-black text-amber-300">
                        {plateText ? formatLicensePlateDisplay(plateText) : 'Vehicle'}
                      </span>
                      <span className="text-gray-300 text-[11px]">
                        {v.expectedSlot ? (
                          <>
                            (Gốc: <strong className="text-emerald-300">{v.expectedSlot}</strong> → Đỗ: <strong className="text-red-400 underline">{v.slotCode}</strong>)
                          </>
                        ) : (
                          <>
                            (<strong className="text-amber-400 font-bold">Chiếm dụng ô {v.slotCode}</strong>)
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleResetAlerts}
              className="px-3.5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 font-extrabold text-xs uppercase tracking-wider transition border border-red-500/30 flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Hủy/Đặt lại cảnh báo để test lại từ đầu"
            >
              <RotateCcw size={14} />
              <span>Hủy Cảnh Báo</span>
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs uppercase tracking-wider transition border border-white/10 flex items-center gap-1.5 shadow-sm active:scale-95"
            >
              <History size={14} className="text-amber-400" />
              <span>Xem Lịch Sử & Xử Lý</span>
            </button>
          </div>
        </div>
      )}

      {/* Main 3D Parking Map View */}
      <div className="flex-1 overflow-hidden relative">
        {liveDataAvailable ? (
          <ParkingMapGrid
            floors={floors}
            currentFloorId={currentFloorId}
            onFloorSelect={setCurrentFloorId}
            onSlotClick={handleSlotClick}
            activeSessions={activeSessions}
            dbSlots={dbSlots}
            availableSlots={availableSlots}
            activeHolds={activeHolds}
            activeBookings={activeBookings}
            aiSlotStatuses={aiSlotStatuses}
            loading={loading}
            isEditMode={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6" role="alert">
            <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-center shadow-lg">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-red-400">Live operational data unavailable</p>
              <p className="mt-2 text-sm text-red-200/80">{liveDataError}</p>
            </div>
          </div>
        )}
      </div>

      {/* Slide-over panel for slots */}
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${selectedSlot ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={() => setSelectedSlot(null)}></div>
      <div className={`absolute bottom-0 right-0 top-0 z-50 flex w-[440px] transform flex-col border-l border-[#ffd555]/20 bg-[#111111]/[0.98] p-8 text-slate-200 shadow-[-20px_0_50px_rgba(0,0,0,0.38)] backdrop-blur-3xl transition-transform duration-300 ease-in-out ${selectedSlot ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedSlot && (
          <>
            <div className="flex justify-between items-start mb-4 flex-shrink-0">
              <div>
                <span className="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-[#d7b94a]">{selectedSlot.type} TICKET</span>
                <h2 className="text-3xl font-extrabold text-white flex items-center gap-2">
                  Ô <span className="text-[#ffd555]">{selectedSlot.id}</span>
                </h2>
              </div>
              <button onClick={() => setSelectedSlot(null)} className="text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-700/50 w-8 h-8 rounded-full flex items-center justify-center transition-all border border-white/5 flex-shrink-0">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Slideover Tabs: Chi Tiết vs Lịch Sử Riêng Của Ô */}
            <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => setSlotTab('details')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition ${
                  slotTab === 'details'
                    ? 'bg-amber-400 text-black shadow'
                    : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                Chi Tiết Hiện Tại
              </button>
              <button
                type="button"
                onClick={() => setSlotTab('history')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition flex items-center gap-1.5 ${
                  slotTab === 'history'
                    ? 'bg-amber-400 text-black shadow'
                    : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                <History size={13} />
                <span>Lịch Sử Ô Này ({slotLogs.length})</span>
              </button>
            </div>

            {/* Tab 1: Current Slot Details */}
            {slotTab === 'details' && (
              <div className="mb-4 flex-1 overflow-y-auto pr-2 space-y-4">
                {(() => {
                  const dbSlotInfo = dbSlots.find(s => s.slotNumber === selectedSlot.id && (s.floorID === selectedSlot.floorId || s.floorID?._id === selectedSlot.floorId));
                  const isMaintenance = dbSlotInfo?.status === 'maintenance';
                  const aiObs = dbSlotInfo?.aiObservation;
                  const isViolation = aiObs?.isViolation || selectedSlot.isWrongSlot;

                  return (
                    <div className="space-y-4">
                      {/* Violation Alert Box inside Slot Drawer */}
                      {isViolation && (
                        <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-500/50 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-red-300">
                            <span className="flex items-center gap-1.5">
                              <ShieldAlert size={15} className="text-red-400 animate-pulse" />
                              Ô ĐANG BỊ VI PHẠM ĐỖ SAI!
                            </span>
                          </div>

                          {aiObs?.evidenceSnapshot && (
                            <div className="rounded-lg overflow-hidden border border-red-500/30 max-h-[140px] bg-black/60 flex items-center justify-center">
                              <img src={aiObs.evidenceSnapshot} alt="Evidence" className="w-full h-auto max-h-[140px] object-contain" />
                            </div>
                          )}

                          <div className="text-xs text-red-200">
                            {aiObs?.violationMessage || 'Xe đỗ không đúng vị trí quy định.'}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedViolation({
                                ...(aiObs || {}),
                                slotCode: selectedSlot.id,
                                actualSlot: selectedSlot.id,
                                detectedPlate: aiObs?.detectedPlate,
                              });
                            }}
                            className="w-full py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white font-extrabold text-xs uppercase tracking-wider transition shadow"
                          >
                            Xử Lý Vi Phạm Ô Này
                          </button>
                        </div>
                      )}

                      {isMaintenance ? (
                        <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-80">
                          <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center border border-red-500/50 mb-2">
                            <span className="text-red-500 font-bold text-2xl">⚠</span>
                          </div>
                          <p className="text-red-400 font-bold uppercase tracking-widest">Bảo trì ô đỗ</p>
                          <p className="text-xs text-red-500 max-w-[200px]">Ô này đang tạm khóa để bảo trì kỹ thuật.</p>
                        </div>
                      ) : selectedSlot.session ? (
                        <div className="flex flex-col gap-3">
                          <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-3 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold mb-0.5">Trạng thái</span>
                            <span className="text-base text-white font-black uppercase">Đang đỗ xe</span>
                          </div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Biển số xe</span><span className="font-mono text-sm font-semibold text-white bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/50">{selectedSlot.session.licensePlate}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Số điện thoại</span><span className="font-medium text-white">{selectedSlot.session.phone || <span className="text-slate-500 italic">Khách lẻ</span>}</span></div>
                          {selectedSlot.session.userId?.email && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Email</span><span className="font-medium text-emerald-400">{selectedSlot.session.userId.email}</span></div>
                          )}
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Loại xe</span><span className="font-medium text-white uppercase">{selectedSlot.session.vehicleType || 'Ô tô'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Giờ vào cổng</span><span className="font-medium text-white">{new Date(selectedSlot.session.checkInTime).toLocaleString('vi-VN')}</span></div>
                        </div>
                      ) : (aiObs?.occupied || dbSlotInfo?.status === 'occupied' || selectedSlot.isOccupied) ? (
                        <div className="flex flex-col gap-3">
                          <div className="bg-rose-900/20 border border-rose-500/40 rounded-xl p-3 flex flex-col items-center justify-center text-center">
                            <span className="text-[10px] text-rose-400 uppercase tracking-widest font-bold mb-0.5">Trạng thái</span>
                            <span className="text-base text-white font-black uppercase">Đang Có Xe Đỗ (AI Khóa)</span>
                            <span className="text-[11px] text-amber-300 font-semibold mt-1 flex items-center gap-1">
                              🛡️ Tự động khóa an toàn chống trùng ô
                            </span>
                          </div>

                          {(aiObs?.detectedPlate || selectedSlot.aiStatus?.detectedPlate || selectedSlot.aiStatus?.plate) && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                              <span className="text-slate-400 text-xs">Biển số nhận diện</span>
                              <span className="font-mono text-sm font-semibold text-white bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/50">
                                {aiObs?.detectedPlate || selectedSlot.aiStatus?.detectedPlate || selectedSlot.aiStatus?.plate}
                              </span>
                            </div>
                          )}

                          <div className="flex justify-between items-center pb-2 border-b border-white/5">
                            <span className="text-slate-400 text-xs">Ghi nhận bởi</span>
                            <span className="font-medium text-cyan-400 text-xs">Camera AI Giám Sát</span>
                          </div>

                          {(aiObs?.lastSeenAt || aiObs?.detectedAt) && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                              <span className="text-slate-400 text-xs">Thời điểm phát hiện</span>
                              <span className="font-medium text-slate-300 text-xs">
                                {new Date(aiObs.lastSeenAt || aiObs.detectedAt).toLocaleString('vi-VN')}
                              </span>
                            </div>
                          )}

                          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed">
                            💡 <strong>Khóa an toàn:</strong> Dù cảnh báo vi phạm đã được hủy hoặc xe chưa có phiên đăng ký tại ô này, hệ thống vẫn khóa trạng thái thực tế để ngăn không cho Kiosk hoặc App cấp trùng ô cho xe khác.
                          </div>
                        </div>
                      ) : selectedSlot.isReserved ? (
                        <div className="flex flex-col gap-3">
                          <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-3 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-purple-400 uppercase tracking-widest font-bold mb-0.5">Trạng thái</span>
                            <span className="text-base text-white font-black uppercase">Đã Đặt / VIP</span>
                          </div>
                          {dbSlotInfo?.subscriptionDetail ? (
                            <>
                              {dbSlotInfo.subscriptionDetail.user && (
                                <>
                                  <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Khách hàng</span><span className="font-medium text-white">{dbSlotInfo.subscriptionDetail.user.username || 'N/A'}</span></div>
                                  <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">SĐT</span><span className="font-medium text-white">{dbSlotInfo.subscriptionDetail.user.phone || 'N/A'}</span></div>
                                </>
                              )}
                              <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Hết hạn</span><span className="font-bold text-purple-400">{new Date(dbSlotInfo.subscriptionDetail.expireAt).toLocaleString('vi-VN')}</span></div>
                            </>
                          ) : (
                            <p className="text-xs text-purple-300 text-center mt-4">Ô đỗ được giữ trước cho khách VIP hoặc lượt đặt trước.</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-70">
                          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 mb-2">
                            <MonitorCheck size={24} className="text-slate-500" />
                          </div>
                          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Ô đang trống</p>
                          <p className="text-xs text-slate-500 max-w-[200px]">Sẵn sàng tiếp nhận xe tiếp theo vào đỗ.</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Tab 2: Specific Slot History Timeline */}
            {slotTab === 'history' && (
              <div className="mb-4 flex-1 overflow-y-auto pr-2 divide-y divide-white/5">
                {loadingSlotLogs ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-amber-400" />
                    Đang tải nhật ký ô...
                  </div>
                ) : slotLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    Chưa có ghi nhận lịch sử nào cho ô này.
                  </div>
                ) : (
                  slotLogs.map((log) => {
                    const isViol = log.changeType === 'VIOLATION_DETECTED';
                    const isReassigned = log.changeType === 'SLOT_REASSIGNED';
                    const isMaintenance = log.changeType === 'MAINTENANCE' || log.changeType === 'MAINTENANCE_LOCKED' || log.changeType === 'MAINTENANCE_UNLOCKED';
                    return (
                      <div key={log._id} className="py-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                              isViol
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : isMaintenance
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : isReassigned
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-700/40 text-slate-300'
                            }`}
                          >
                            {isViol ? 'Phát hiện vi phạm' : isMaintenance ? 'Bảo trì ô đỗ' : isReassigned ? 'Đã đổi ô' : 'Biến động đỗ xe'}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>

                        {log.detectedPlate && (
                          <div className="text-slate-200 font-mono font-bold">
                            Biển số: {formatLicensePlateDisplay(log.detectedPlate)}
                          </div>
                        )}

                        {log.evidenceSnapshot && (
                          <div className="rounded-lg overflow-hidden border border-white/10 max-h-[100px] bg-black/60 my-1">
                            <img src={log.evidenceSnapshot} alt="Evidence Crop" className="w-full h-auto max-h-[100px] object-contain" />
                          </div>
                        )}

                        {log.resolutionNote && (
                          <div className="text-[11px] text-emerald-400 italic">
                            {log.resolutionNote}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {selectedSlot.session && (
              <div className="mt-auto flex-shrink-0 pt-2 pb-2">
                <button
                  onClick={() => setShowCheckoutModal(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] py-4 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(255,213,85,0.18)] transition-all hover:bg-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98]">
                  <X size={18} />
                  Thanh Toán & Trả Ô (Check-out)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Staff Checkout Modal */}
      {showCheckoutModal && selectedSlot?.session && (
        <StaffCheckoutModal
          isOpen={showCheckoutModal}
          onClose={() => setShowCheckoutModal(false)}
          session={{ ...selectedSlot.session, parkingSlot: selectedSlot.id }}
          onSuccess={() => {
            setShowCheckoutModal(false);
            setSelectedSlot(null);
            fetchLiveStatus();
          }}
        />
      )}

      {/* AI Overhead Camera Surveillance Modal */}
      {showSurveillanceModal && (
        <SlotCameraMonitorModal
          isOpen={showSurveillanceModal}
          onClose={() => setShowSurveillanceModal(false)}
          floors={floors}
          currentFloorId={currentFloorId}
          activeSessions={activeSessions}
          onSlotStatusUpdate={(results, floorId) => {
            if (!floorId) return;
            setFloorAiStatusesMap((prev) => {
              const currentPlates = new Set(
                results
                  .filter((r) => r.occupied && (r.plate || r.detectedPlate))
                  .map((r) => (r.plate || r.detectedPlate).replace(/[^A-Z0-9]/gi, '').toUpperCase())
              );

              const updated = {};
              Object.entries(prev).forEach(([fId, fSlots]) => {
                if (fId === floorId) return;
                updated[fId] = fSlots.filter((s) => {
                  const p = (s.plate || s.detectedPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                  return !p || !currentPlates.has(p);
                });
              });
              updated[floorId] = results;
              return updated;
            });
          }}
          onCheckoutSlot={(sessionOrSlot) => {
            setSelectedSlot({
              id: sessionOrSlot.parkingSlot,
              session: sessionOrSlot
            });
            setShowCheckoutModal(true);
          }}
        />
      )}

      {/* Wrong-Slot Violation Resolution Modal */}
      {selectedViolation && (
        <ViolationResolutionModal
          isOpen={Boolean(selectedViolation)}
          onClose={() => setSelectedViolation(null)}
          violation={selectedViolation}
          onReassignSuccess={(sessionId, newSlotCode) => {
            fetchLiveStatus();
            setFloorAiStatusesMap((prev) => {
              const updated = {};
              Object.entries(prev).forEach(([fId, slots]) => {
                updated[fId] = slots.filter((s) => s.slotCode !== selectedViolation.slotCode);
              });
              return updated;
            });
          }}
          onCheckout={(session) => {
            setSelectedSlot({
              id: session.parkingSlot,
              session
            });
            setShowCheckoutModal(true);
          }}
        />
      )}

      {/* Global Violation History Modal */}
      <GlobalViolationHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        floors={floors}
        currentFloorId={currentFloorId}
        onViolationResolved={(slotCode) => {
          fetchLiveStatus();
          if (slotCode) {
            setFloorAiStatusesMap((prev) => {
              const updated = {};
              Object.entries(prev).forEach(([fId, slots]) => {
                updated[fId] = slots.filter((s) => s.slotCode !== slotCode);
              });
              return updated;
            });
          }
        }}
      />
    </div>
  );
}

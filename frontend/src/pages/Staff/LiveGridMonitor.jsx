import { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Maximize2,
  Layers
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
  const navigate = useNavigate();
  const rawUser = sessionStorage.getItem('valo_user');
  const currentUser = rawUser ? JSON.parse(rawUser) : null;
  const isAdmin = currentUser?.role === 'admin';

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
      .filter((s) => (
        s.aiObservation && (
          s.aiObservation.occupied ||
          s.aiObservation.isViolation ||
          s.aiObservation.violationType === 'CHECKED_IN_PENDING_PARK'
        )
      ))
      .map((s) => {
        const vType = s.aiObservation.violationType || null;
        const isPending = vType === 'CHECKED_IN_PENDING_PARK';
        return {
          slotCode: s.slotNumber,
          floorId: String(s.floorID?._id || s.floorID || ''),
          occupied: Boolean(s.aiObservation.occupied),
          plate: s.aiObservation.detectedPlate,
          detectedPlate: s.aiObservation.detectedPlate,
          isViolation: Boolean(s.aiObservation.isViolation && !isPending),
          violationType: vType,
          status: isPending
            ? 'CHECKED_IN_PENDING_PARK'
            : (s.aiObservation.isViolation ? (vType || 'WRONG_SLOT_VIOLATION') : 'OCCUPIED_VALID'),
          expectedSlot: s.aiObservation.expectedSlot,
          expectedPlate: s.aiObservation.expectedPlate,
          evidenceSnapshot: s.aiObservation.evidenceSnapshot,
          fullSnapshot: s.aiObservation.fullSnapshot,
          violationMessage: s.aiObservation.violationMessage,
          sessionId: s.aiObservation.sessionId,
          lastScannedAt: s.aiObservation.lastScannedAt,
        };
      });

    const map = new Map();
    const makeKey = (s) => `${String(s.floorId?._id || s.floorId || '')}-${String(s.slotCode || '').trim().toUpperCase()}`;
    dbStatuses.forEach((s) => {
      if (s.slotCode) map.set(makeKey(s), s);
    });

    Object.entries(floorAiStatusesMap).forEach(([fId, fSlots]) => {
      (fSlots || []).forEach((s) => {
        if (!s?.slotCode) return;
        const normalized = { ...s, floorId: String(s.floorId?._id || s.floorId || fId || '') };
        map.set(makeKey(normalized), normalized);
      });
    });

    return Array.from(map.values());
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

  // Violations list computed from AI surveillance: wrong-slot, double-parking, unauthorized
  const violations = useMemo(() => {
    if (!Array.isArray(aiSlotStatuses)) return [];
    return aiSlotStatuses.filter((s) => {
      const vType = s.violationType || s.status;
      if (vType === 'CHECKED_IN_PENDING_PARK') return false;
      const isWrongSlot = vType === 'WRONG_SLOT_VIOLATION';
      const isUnauth = vType === 'UNAUTHORIZED_PARKING' || vType === 'UNAUTHORIZED_OCCUPANCY';
      const isDoubleParking = vType === 'DOUBLE_PARKING_VIOLATION' || Boolean(s.occupiedByOverlap);
      // If expectedSlot matches current slot and not overlapping another, vehicle is in its assigned slot
      if (isWrongSlot && !isDoubleParking && s.expectedSlot && s.slotCode && s.expectedSlot.toUpperCase() === s.slotCode.toUpperCase()) {
        return false;
      }
      return (isWrongSlot || isUnauth || isDoubleParking) && Boolean(s.isViolation);
    });
  }, [aiSlotStatuses]);

  const handleResetAlerts = async () => {
    try {
      const res = await clearAllViolationsApi(currentFloorId || null);
      if (res.success) {
        toast.success(res.message || 'Alerts cleared and safely locked!');
        setFloorAiStatusesMap({});
        fetchLiveStatus();
      } else {
        toast.error(res.message || 'Unable to reset alerts');
      }
    } catch (err) {
      toast.error('Error resetting alerts');
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
    if (clickedItem?.isWrongSlot) {
      const obsFallback = clickedItem?.dbSlot?.aiObservation;
      const violationSource = clickedItem?.aiStatus || (obsFallback?.isViolation ? {
        ...obsFallback,
        plate: obsFallback.detectedPlate,
        slotCode: clickedItem.id,
        floorId: clickedItem.floorId,
      } : null);
      if (violationSource) {
        setSelectedViolation({
          ...violationSource,
          floorId: clickedItem.floorId || violationSource.floorId,
          slotCode: clickedItem.id,
          actualSlot: clickedItem.id,
          session: clickedItem.session || violationSource.session || null,
        });
        return;
      }
    }
    setSelectedSlot(clickedItem);
  };

  return (
    <div className={`${STAFF_THEME.page} staff-live-grid relative flex h-[calc(100vh-70px)] flex-col overflow-hidden font-sans`}
      style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`, backgroundSize: '30px 30px' }}>

      {/* Top Toolbar: Minimal, Clean, Focused */}
      <div className="staff-live-grid-toolbar absolute left-8 top-4 z-50 flex items-center gap-3 rounded-xl border border-[#ffd555]/15 bg-[#111111]/95 p-2 shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur flex-wrap">
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

        {/* Primary Action 1: AI Camera */}
        <button
          type="button"
          onClick={() => setShowSurveillanceModal(true)}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/40 text-cyan-300 font-extrabold text-xs hover:bg-cyan-500 hover:text-black transition shadow-sm active:scale-95"
          title="Open AI Slot Surveillance Camera"
        >
          <Camera size={14} className="text-cyan-400" />
          <span>Camera AI</span>
          {violations.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] font-black bg-red-500 text-white rounded-full animate-bounce">
              {violations.length} {violations.length === 1 ? 'Violation' : 'Violations'}
            </span>
          )}
        </button>

        {/* Primary Action 2: Global Violation History */}
        <button
          type="button"
          onClick={() => setShowHistoryModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400/20 to-yellow-500/20 border border-amber-400/40 text-amber-300 font-bold text-xs hover:bg-amber-400 hover:text-black transition shadow-sm active:scale-95"
          title="View parking violation history and resolution audit logs"
        >
          <History size={14} className="text-amber-400" />
          <span>Violation History</span>
        </button>

        {/* Admin Action: Chuyển sang thiết kế sơ đồ bãi đỗ */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate('/admin/parking-lots')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border border-purple-400/40 text-purple-300 font-bold text-xs hover:bg-purple-500 hover:text-white transition shadow-sm active:scale-95"
            title="Chuyển sang trang Thiết Kế / Chỉnh Sửa Sơ Đồ Bãi Đỗ (Builder)"
          >
            <Layers size={14} className="text-purple-400" />
            <span>Sơ Đồ / Builder</span>
          </button>
        )}
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
                  Alert: {violations.length} parking {violations.length === 1 ? 'violation' : 'violations'} detected!
                </span>
                <span className="px-2 py-0.2 text-[9px] font-bold bg-red-500 text-white rounded-full uppercase">
                  AI Surveillance
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {violations.map((v) => {
                  const plateText = v.plate || v.detectedPlate || v.session?.licensePlate;
                  const isDouble = (v.violationType || v.status) === 'DOUBLE_PARKING_VIOLATION' || Boolean(v.occupiedByOverlap);
                  return (
                    <button
                      key={`${v.floorId || ''}-${v.slotCode}`}
                      type="button"
                      onClick={() => setSelectedViolation({
                        ...v,
                        actualSlot: v.slotCode,
                        detectedPlate: plateText
                      })}
                      className={`px-2.5 py-1 rounded-lg bg-black/50 hover:bg-black/80 border ${isDouble ? 'border-orange-500/50' : 'border-red-500/40'} text-xs text-left transition hover:scale-105 active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-sm`}
                      title="Click to view evidence & resolve this slot violation"
                    >
                      <span className="font-mono font-black text-amber-300">
                        {plateText ? formatLicensePlateDisplay(plateText) : 'Vehicle'}
                      </span>
                      <span className="text-gray-300 text-[11px]">
                        {isDouble ? (
                          <>
                            (<strong className="text-orange-400 font-bold">Encroaching slot {v.slotCode}</strong>
                            {v.expectedSlot ? ` · Assigned: ${v.expectedSlot}` : ''})
                          </>
                        ) : v.expectedSlot ? (
                          <>
                            (Assigned: <strong className="text-emerald-300">{v.expectedSlot}</strong> → Parked: <strong className="text-red-400 underline">{v.slotCode}</strong>)
                          </>
                        ) : (
                          <>
                            (<strong className="text-amber-400 font-bold">Unauthorized slot {v.slotCode}</strong>)
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
              title="Reset / clear active violation alerts"
            >
              <RotateCcw size={14} />
              <span>Reset Alerts</span>
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs uppercase tracking-wider transition border border-white/10 flex items-center gap-1.5 shadow-sm active:scale-95"
            >
              <History size={14} className="text-amber-400" />
              <span>View History & Resolve</span>
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
                  const isPendingSlot = Boolean(
                    selectedSlot.isPendingPark ||
                    aiObs?.violationType === 'CHECKED_IN_PENDING_PARK' ||
                    selectedSlot.aiStatus?.violationType === 'CHECKED_IN_PENDING_PARK'
                  );
                  const isViolation = Boolean(
                    (aiObs?.isViolation && aiObs?.violationType !== 'CHECKED_IN_PENDING_PARK') ||
                    selectedSlot.isWrongSlot
                  );

                  return (
                    <div className="space-y-4">
                      {/* In-Transit Info Box */}
                      {isPendingSlot && !isViolation && !aiObs?.occupied && (
                        <div className="p-3.5 rounded-xl bg-purple-950/60 border border-purple-500/50 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-purple-300">
                            <span>⏳ VEHICLE EN ROUTE TO SLOT (IN TRANSIT)</span>
                          </div>
                          <div className="text-xs text-purple-200">
                            {aiObs?.violationMessage || selectedSlot.aiStatus?.violationMessage || 'Vehicle has checked in at the gate and is moving toward its assigned slot.'}
                          </div>
                        </div>
                      )}

                      {/* Violation Alert Box inside Slot Drawer */}
                      {isViolation && (
                        <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-500/50 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-red-300">
                            <span className="flex items-center gap-1.5">
                              <ShieldAlert size={15} className="text-red-400 animate-pulse" />
                              PARKING VIOLATION ACTIVE!
                            </span>
                          </div>

                          {aiObs?.evidenceSnapshot && (
                            <div className="rounded-lg overflow-hidden border border-red-500/30 max-h-[140px] bg-black/60 flex items-center justify-center">
                              <img src={aiObs.evidenceSnapshot} alt="Evidence" className="w-full h-auto max-h-[140px] object-contain" />
                            </div>
                          )}

                          <div className="text-xs text-red-200">
                            {aiObs?.violationMessage || 'Vehicle is not parked in its assigned slot.'}
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
                            Resolve Slot Violation
                          </button>
                        </div>
                      )}

                      {isMaintenance ? (
                        <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-80">
                          <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center border border-red-500/50 mb-2">
                            <span className="text-red-500 font-bold text-2xl">⚠</span>
                          </div>
                          <p className="text-red-400 font-bold uppercase tracking-widest">Slot Maintenance</p>
                          <p className="text-xs text-red-500 max-w-[200px]">This slot is temporarily locked for technical maintenance.</p>
                        </div>
                      ) : selectedSlot.session ? (
                        <div className="flex flex-col gap-3">
                          <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-3 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold mb-0.5">Status</span>
                            <span className="text-base text-white font-black uppercase">Occupied</span>
                          </div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">License Plate</span><span className="font-mono text-sm font-semibold text-white bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/50">{selectedSlot.session.licensePlate}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Phone</span><span className="font-medium text-white">{selectedSlot.session.phone || <span className="text-slate-500 italic">Walk-in</span>}</span></div>
                          {selectedSlot.session.userId?.email && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Email</span><span className="font-medium text-emerald-400">{selectedSlot.session.userId.email}</span></div>
                          )}
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Vehicle Type</span><span className="font-medium text-white uppercase">{selectedSlot.session.vehicleType || 'Car'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Check-in Time</span><span className="font-medium text-white">{new Date(selectedSlot.session.checkInTime).toLocaleString('en-US')}</span></div>
                        </div>
                      ) : (aiObs?.occupied || dbSlotInfo?.status === 'occupied' || selectedSlot.isOccupied) ? (
                        <div className="flex flex-col gap-3">
                          <div className="bg-rose-900/20 border border-rose-500/40 rounded-xl p-3 flex flex-col items-center justify-center text-center">
                            <span className="text-[10px] text-rose-400 uppercase tracking-widest font-bold mb-0.5">Status</span>
                            <span className="text-base text-white font-black uppercase">Occupied (AI Locked)</span>
                            <span className="text-[11px] text-amber-300 font-semibold mt-1 flex items-center gap-1">
                              🛡️ Safety lock prevents duplicate assignment
                            </span>
                          </div>

                          {(aiObs?.detectedPlate || selectedSlot.aiStatus?.detectedPlate || selectedSlot.aiStatus?.plate) && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                              <span className="text-slate-400 text-xs">Detected Plate</span>
                              <span className="font-mono text-sm font-semibold text-white bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/50">
                                {aiObs?.detectedPlate || selectedSlot.aiStatus?.detectedPlate || selectedSlot.aiStatus?.plate}
                              </span>
                            </div>
                          )}

                          <div className="flex justify-between items-center pb-2 border-b border-white/5">
                            <span className="text-slate-400 text-xs">Recorded By</span>
                            <span className="font-medium text-cyan-400 text-xs">AI Surveillance Camera</span>
                          </div>

                          {(aiObs?.lastSeenAt || aiObs?.detectedAt) && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                              <span className="text-slate-400 text-xs">Detected At</span>
                              <span className="font-medium text-slate-300 text-xs">
                                {new Date(aiObs.lastSeenAt || aiObs.detectedAt).toLocaleString('en-US')}
                              </span>
                            </div>
                          )}

                          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed">
                            💡 <strong>Safety Lock:</strong> Even if alerts are cleared or there is no active session on this slot, the physical occupied state stays locked so Kiosk/App cannot assign it to another vehicle.
                          </div>
                        </div>
                      ) : selectedSlot.isReserved ? (
                        <div className="flex flex-col gap-3">
                          <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-3 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-purple-400 uppercase tracking-widest font-bold mb-0.5">Status</span>
                            <span className="text-base text-white font-black uppercase">Reserved / VIP</span>
                          </div>
                          {dbSlotInfo?.subscriptionDetail ? (
                            <>
                              {dbSlotInfo.subscriptionDetail.user && (
                                <>
                                  <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Customer</span><span className="font-medium text-white">{dbSlotInfo.subscriptionDetail.user.username || 'N/A'}</span></div>
                                  <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Phone</span><span className="font-medium text-white">{dbSlotInfo.subscriptionDetail.user.phone || 'N/A'}</span></div>
                                </>
                              )}
                              <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Expires</span><span className="font-bold text-purple-400">{new Date(dbSlotInfo.subscriptionDetail.expireAt).toLocaleString('en-US')}</span></div>
                            </>
                          ) : (
                            <p className="text-xs text-purple-300 text-center mt-4">Slot is reserved for a VIP member or pre-booked driver.</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-70">
                          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 mb-2">
                            <MonitorCheck size={24} className="text-slate-500" />
                          </div>
                          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Slot Available</p>
                          <p className="text-xs text-slate-500 max-w-[200px]">Ready for the next incoming vehicle.</p>
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
                    Loading slot history...
                  </div>
                ) : slotLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No history recorded for this slot yet.
                  </div>
                ) : (
                  slotLogs.map((log) => {
                    const isViol = log.changeType === 'VIOLATION_DETECTED';
                    const isReassigned = log.changeType === 'SLOT_REASSIGNED';
                    const isMaintenance = log.changeType === 'MAINTENANCE' || log.changeType === 'MAINTENANCE_LOCKED' || log.changeType === 'MAINTENANCE_UNLOCKED';
                    const isCheckout = log.resolutionAction === 'CHECKOUT_RELEASED';
                    const isVehicleLeft = log.resolutionAction === 'VEHICLE_LEFT';
                    const isVehicleParked = log.resolutionAction === 'VEHICLE_PARKED';

                    let badgeText = 'Parking Event';
                    let badgeClass = 'bg-slate-700/40 text-slate-300';
                    if (isViol) {
                      badgeText = 'Violation Detected';
                      badgeClass = 'bg-red-500/20 text-red-400 border border-red-500/30';
                    } else if (isMaintenance) {
                      badgeText = 'Slot Maintenance';
                      badgeClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
                    } else if (isCheckout) {
                      badgeText = 'Checkout - Available';
                      badgeClass = 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30';
                    } else if (isVehicleLeft) {
                      badgeText = 'Vehicle Left - Available';
                      badgeClass = 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
                    } else if (isVehicleParked) {
                      badgeText = 'Vehicle Parked';
                      badgeClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
                    } else if (isReassigned) {
                      badgeText = 'Slot Reassigned';
                      badgeClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
                    }

                    return (
                      <div key={log._id} className="py-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${badgeClass}`}>
                            {badgeText}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>

                        {log.detectedPlate && (
                          <div className="text-slate-200 font-mono font-bold">
                            Plate: {formatLicensePlateDisplay(log.detectedPlate)}
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
                  Checkout & Release Slot
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
            const targetCode = String(selectedSlot.id || '').trim().toUpperCase();
            const targetPlate = String(selectedSlot.session?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
            setFloorAiStatusesMap((prev) => {
              const updated = {};
              Object.entries(prev).forEach(([fId, slots]) => {
                updated[fId] = (slots || []).filter((s) => {
                  const sCode = String(s.slotCode || '').trim().toUpperCase();
                  const sPlate = String(s.plate || s.detectedPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                  return sCode !== targetCode && (!targetPlate || sPlate !== targetPlate);
                });
              });
              return updated;
            });
            setShowCheckoutModal(false);
            setSelectedSlot(null);
            fetchLiveStatus(false);
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
            fetchLiveStatus(false);
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
            const codesToClear = new Set(
              [selectedViolation?.slotCode, selectedViolation?.expectedSlot, newSlotCode]
                .filter(Boolean)
                .map((c) => String(c).trim().toUpperCase())
            );
            setFloorAiStatusesMap((prev) => {
              const updated = {};
              Object.entries(prev).forEach(([fId, slots]) => {
                updated[fId] = (slots || []).filter(
                  (s) => !codesToClear.has(String(s.slotCode || '').trim().toUpperCase())
                );
              });
              return updated;
            });
            fetchLiveStatus(false);
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
        onViolationResolved={(slotCode, expectedSlot) => {
          const codes = [slotCode, expectedSlot].filter(Boolean).map((c) => String(c).trim().toUpperCase());
          if (codes.length > 0) {
            const codeSet = new Set(codes);
            setFloorAiStatusesMap((prev) => {
              const updated = {};
              Object.entries(prev).forEach(([fId, slots]) => {
                updated[fId] = (slots || []).filter(
                  (s) => !codeSet.has(String(s.slotCode || '').trim().toUpperCase())
                );
              });
              return updated;
            });
          } else {
            setFloorAiStatusesMap({});
          }
          fetchLiveStatus(false);
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useState, useMemo } from "react";
import ParkingMapGrid from "../../components/ParkingMapGrid";
import { getAllFloors, getFloorSlots } from "../../services/parkingFloorService";
import { getActiveSessions } from "../../services/sessionService";
import { MonitorCheck, Sparkles, X, Camera, ShieldAlert, AlertTriangle, RefreshCw } from "lucide-react";
import StaffCheckoutModal from "./StaffCheckoutModal";
import { getAvailableBookingSlots, getActiveHolds, getActiveMapBookings } from "../../services/bookingService";
import { getRequiredSourcesAvailability } from "../../utils/staffOperationalAvailability";
import StaffDropdown from "./components/StaffDropdown.jsx";
import { STAFF_THEME } from "./components/staffTheme.js";
import AIPlateResolutionModal from "./components/AIPlateResolutionModal.jsx";
import SlotCameraMonitorModal from "./components/SlotCameraMonitorModal.jsx";
import ViolationResolutionModal from "./components/ViolationResolutionModal.jsx";
import { formatLicensePlateDisplay } from "../../utils/licensePlate";

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
  const [showAiModal, setShowAiModal] = useState(false);

  // AI Surveillance & Wrong-Slot Violation States
  const [showSurveillanceModal, setShowSurveillanceModal] = useState(false);
  const [floorAiStatusesMap, setFloorAiStatusesMap] = useState({});
  const [selectedViolation, setSelectedViolation] = useState(null);

  const aiSlotStatuses = useMemo(() => {
    const all = Object.values(floorAiStatusesMap).flat();
    const seenPlates = new Set();
    const seenSlots = new Set();
    const result = [];

    for (const slot of all) {
      const slotKey = `${slot.slotCode}`;
      const plate = (slot.plate || slot.detectedPlate || slot.session?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      
      // Prevent duplicate slot entries
      if (seenSlots.has(slotKey)) continue;
      seenSlots.add(slotKey);

      // Prevent duplicate vehicle plates across multiple slots or floors
      if (plate) {
        if (seenPlates.has(plate)) continue;
        seenPlates.add(plate);
      }
      result.push(slot);
    }
    return result;
  }, [floorAiStatusesMap]);

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

  // Violations list computed from AI surveillance
  const violations = useMemo(() => {
    if (!Array.isArray(aiSlotStatuses)) return [];
    return aiSlotStatuses.filter(
      (s) => s.status === 'WRONG_SLOT_VIOLATION' || s.status === 'UNAUTHORIZED_OCCUPANCY'
    );
  }, [aiSlotStatuses]);

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

      {/* Top Toolbar */}
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

        {/* AI Slot Surveillance Camera Button */}
        <button
          type="button"
          onClick={() => setShowSurveillanceModal(true)}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/40 text-cyan-300 font-extrabold text-xs hover:bg-cyan-500 hover:text-black transition shadow-sm active:scale-95"
          title="Open AI Overhead Slot Surveillance Camera"
        >
          <Camera size={14} className="text-cyan-400" />
          <span>AI Slot Surveillance</span>
          {violations.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] font-black bg-red-500 text-white rounded-full animate-bounce">
              {violations.length} Violation{violations.length > 1 ? 's' : ''}
            </span>
          )}
        </button>

        {/* AI Plate Assistant Button */}
        <button
          type="button"
          onClick={() => setShowAiModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400/20 to-yellow-500/20 border border-amber-400/40 text-amber-300 font-bold text-xs hover:bg-amber-400 hover:text-black transition"
        >
          <Sparkles size={14} className="text-amber-400" />
          <span>AI Plate Assistant</span>
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
                  Warning: Detected {violations.length} Wrong-Slot Violation{violations.length > 1 ? 's' : ''}!
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
                      title="Click to view details and resolve this violation"
                    >
                      <span className="font-mono font-black text-amber-300">
                        {plateText ? formatLicensePlateDisplay(plateText) : 'Vehicle'}
                      </span>
                      <span className="text-gray-300 text-[11px]">
                        (Assigned: <strong className="text-emerald-300">{v.expectedSlot || 'Other'}</strong> → Parked at: <strong className="text-red-400 underline">{v.slotCode}</strong>)
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
              onClick={() => {
                const first = violations[0];
                const plateText = first.plate || first.detectedPlate || first.session?.licensePlate;
                setSelectedViolation({
                  ...first,
                  actualSlot: first.slotCode,
                  detectedPlate: plateText
                });
              }}
              className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-extrabold text-xs uppercase tracking-wider transition shadow-lg active:scale-95 flex items-center gap-1.5"
            >
              <span>Resolve Violations ({violations.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSurveillanceModal(true)}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 font-bold text-xs transition border border-white/10 flex items-center gap-1.5"
            >
              <Camera size={14} className="text-amber-400" />
              <span>View AI Camera</span>
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
      <div className={`absolute bottom-0 right-0 top-0 z-50 flex w-[420px] transform flex-col border-l border-[#ffd555]/20 bg-[#111111]/[0.98] p-8 text-slate-200 shadow-[-20px_0_50px_rgba(0,0,0,0.38)] backdrop-blur-3xl transition-transform duration-300 ease-in-out ${selectedSlot ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedSlot && (
          <>
            <div className="flex justify-between items-start mb-6 flex-shrink-0">
              <div>
                <span className="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-[#d7b94a]">{selectedSlot.type} TICKET</span>
                <h2 className="text-4xl font-extrabold text-white flex items-center gap-2">
                  SLOT <span className="text-[#ffd555]">{selectedSlot.id}</span>
                </h2>
              </div>
              <button onClick={() => setSelectedSlot(null)} className="text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-700/50 w-8 h-8 rounded-full flex items-center justify-center transition-all border border-white/5 flex-shrink-0">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="mb-4 flex-1 overflow-y-auto pr-2">
              <h3 className="text-slate-500 text-[11px] font-bold uppercase tracking-[0.15em] mb-4">Slot Details</h3>

              {(() => {
                const dbSlotInfo = dbSlots.find(s => s.slotNumber === selectedSlot.id && s.floorID === selectedSlot.floorId);
                const isMaintenance = dbSlotInfo?.status === 'maintenance';

                if (isMaintenance) {
                  return (
                    <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-80">
                      <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center border border-red-500/50 mb-2">
                        <span className="text-red-500 font-bold text-2xl">⚠</span>
                      </div>
                      <p className="text-red-400 font-bold uppercase tracking-widest">Under Maintenance</p>
                      <p className="text-xs text-red-500 max-w-[200px]">This slot is currently locked for maintenance.</p>
                    </div>
                  );
                }

                if (selectedSlot.session) {
                  return (
                    <div className="flex flex-col gap-4">
                      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-4 flex flex-col items-center justify-center mb-2">
                        <span className="text-xs text-emerald-400 uppercase tracking-widest font-bold mb-1">Status</span>
                        <span className="text-lg text-white font-black uppercase">Occupied</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">License Plate</span><span className="font-mono text-base font-semibold text-white bg-slate-800/80 px-3 py-1 rounded border border-slate-700/50">{selectedSlot.session.licensePlate}</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Phone</span><span className="font-medium text-white">{selectedSlot.session.phone || <span className="text-slate-500 italic">Guest</span>}</span></div>
                      {selectedSlot.session.userId?.email && (
                        <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Email</span><span className="font-medium text-emerald-400">{selectedSlot.session.userId.email}</span></div>
                      )}
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Vehicle Type</span><span className="font-medium text-white uppercase">{selectedSlot.session.vehicleType || 'Unknown'}</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Check-in Time</span><span className="font-medium text-white">{new Date(selectedSlot.session.checkInTime).toLocaleString('vi-VN')}</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Expected Duration</span><span className="font-medium text-white">{selectedSlot.session.expectedDurationHours} hr(s)</span></div>
                      <div className="flex justify-between items-center"><span className="text-slate-400 text-sm">Expiration Time</span><span className="font-bold text-emerald-400">{new Date(new Date(selectedSlot.session.checkInTime).getTime() + (selectedSlot.session.expectedDurationHours || 0) * 3600000).toLocaleString('vi-VN')}</span></div>
                    </div>
                  );
                }

                if (selectedSlot.isReserved) {
                  return (
                    <div className="flex flex-col gap-4">
                      <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 flex flex-col items-center justify-center mb-2">
                        <span className="text-xs text-purple-400 uppercase tracking-widest font-bold mb-1">Status</span>
                        <span className="text-lg text-white font-black uppercase">Reserved / VIP</span>
                      </div>
                      {dbSlotInfo?.subscriptionDetail ? (
                        <>
                          {dbSlotInfo.subscriptionDetail.user && (
                            <>
                              <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Customer Name</span><span className="font-medium text-white">{dbSlotInfo.subscriptionDetail.user.username || 'N/A'}</span></div>
                              <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Phone</span><span className="font-medium text-white">{dbSlotInfo.subscriptionDetail.user.phone || 'N/A'}</span></div>
                              <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Email</span><span className="font-medium text-emerald-400">{dbSlotInfo.subscriptionDetail.user.email || 'N/A'}</span></div>
                            </>
                          )}
                          {dbSlotInfo.subscriptionDetail.ticketPackage && (
                            <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Package</span><span className="font-medium text-purple-400 uppercase">{dbSlotInfo.subscriptionDetail.ticketPackage.name || dbSlotInfo.subscriptionDetail.ticketPackage.type}</span></div>
                          )}
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Valid Until</span><span className="font-bold text-purple-400">{new Date(dbSlotInfo.subscriptionDetail.expireAt).toLocaleString('vi-VN')}</span></div>
                        </>
                      ) : (
                        <p className="text-xs text-purple-300 text-center mt-4">This slot is currently reserved for a VIP subscription package or an upcoming booking.</p>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-70">
                    <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 mb-2">
                      <MonitorCheck size={24} className="text-slate-500" />
                    </div>
                    <p className="text-slate-400 font-bold uppercase tracking-widest">Slot is Empty</p>
                    <p className="text-xs text-slate-500 max-w-[200px]">Ready for next incoming vehicle assignment.</p>
                  </div>
                );
              })()}
            </div>

            {selectedSlot.session && (
              <div className="mt-auto flex-shrink-0 pt-2 pb-2">
                <button
                  onClick={() => setShowCheckoutModal(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] py-4 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(255,213,85,0.18)] transition-all hover:bg-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98]">
                  <X size={18} />
                  Process Check-out
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

      {/* AI Blurred Plate Resolution Modal */}
      <AIPlateResolutionModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onSelectPlate={(selectedPlate) => {
          console.log('[LiveGrid] AI Plate resolved:', selectedPlate);
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import ParkingMapGrid from "../../components/ParkingMapGrid";
import { getAllFloors, getFloorSlots } from "../../services/parkingFloorService";
import { getActiveSessions } from "../../services/sessionService";
import { MonitorCheck, X } from "lucide-react";
import StaffCheckoutModal from "./StaffCheckoutModal";
import { getAvailableBookingSlots, getActiveHolds, getActiveMapBookings } from "../../services/bookingService";
import { getRequiredSourcesAvailability } from "../../utils/staffOperationalAvailability";
import StaffDropdown from "./components/StaffDropdown.jsx";
import { STAFF_THEME } from "./components/staffTheme.js";

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

  const fetchLiveStatus = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [invalidateLiveData]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchLiveStatus();
    }, 0);
    const interval = setInterval(fetchLiveStatus, 15000); // refresh every 15s
    return () => {
      window.clearTimeout(timerId);
      clearInterval(interval);
    };
  }, [fetchLiveStatus]);

  return (
    <div className={`${STAFF_THEME.page} relative flex h-[calc(100vh-70px)] flex-col overflow-hidden font-sans`}
         style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`, backgroundSize: '30px 30px' }}>
      
      {/* Top Toolbar */}
      <div className="absolute left-8 top-4 z-50 flex items-center gap-4 rounded-xl border border-[#ffd555]/15 bg-[#111111]/95 p-2 shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur">
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
        <div className="flex items-center gap-1.5 px-3">
            <div className={`w-2 h-2 rounded-full ${liveDataAvailable ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
            <span className={`text-[10px] font-mono ${liveDataAvailable ? 'text-gray-400' : 'text-red-400'}`}>
              {liveDataAvailable ? 'LIVE UPDATE' : 'LIVE DATA UNAVAILABLE'}
            </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {liveDataAvailable ? (
          <ParkingMapGrid
            floors={floors}
            currentFloorId={currentFloorId}
            onFloorSelect={setCurrentFloorId}
            onSlotClick={setSelectedSlot}
            activeSessions={activeSessions}
            dbSlots={dbSlots}
            availableSlots={availableSlots}
            activeHolds={activeHolds}
            activeBookings={activeBookings}
            loading={loading}
            isEditMode={false} // Staff cannot edit layout
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

      {showCheckoutModal && selectedSlot?.session && (
        <StaffCheckoutModal 
          isOpen={showCheckoutModal}
          onClose={() => setShowCheckoutModal(false)}
          session={{...selectedSlot.session, parkingSlot: selectedSlot.id}}
          onSuccess={() => {
            setShowCheckoutModal(false);
            setSelectedSlot(null);
            fetchLiveStatus();
          }}
        />
      )}
    </div>
  );
}

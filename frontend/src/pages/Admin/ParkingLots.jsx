import { useCallback, useEffect, useState } from "react";
import { Plus, Edit, Copy, Trash2, X } from "lucide-react";
import ParkingLotsBuilder from "./ParkingLotsBuilder/ParkingLotsBuilder";
import ParkingMapGrid from "../../components/ParkingMapGrid";
import AdminSelect from "../../components/Admin/AdminSelect";
import { getAllFloors, createFloor, updateFloorLayout, deleteFloor, getFloorSlots } from "../../services/parkingFloorService";
import { startMaintenance, endMaintenance } from "../../services/maintenanceService";
import { API_BASE } from "../../services/api";
import { getAvailableBookingSlots, getActiveHolds, getActiveMapBookings } from "../../services/bookingService";
import StaffCheckoutModal from "../Staff/StaffCheckoutModal";

const LiveDuration = ({ checkInTime, expectedDurationHours }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const checkIn = new Date(checkInTime).getTime();
  const elapsed = Math.max(0, now - checkIn);
  const expirationTime = checkIn + (expectedDurationHours || 0) * 3600000;
  const isOverdue = now > expirationTime;
  
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-base font-black ${isOverdue ? 'text-red-400' : 'text-emerald-400'}`}>
        {hours}h {minutes.toString().padStart(2, '0')}m {seconds.toString().padStart(2, '0')}s
      </span>
      {isOverdue && <span className="bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5 rounded border border-red-500/30 font-bold uppercase tracking-wider animate-pulse">Overdue</span>}
    </div>
  );
};

export default function ParkingLots() {
  const [floors, setFloors] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const raw = sessionStorage.getItem('valo_user');
  const user = raw ? JSON.parse(raw) : null;
  const isAdmin = user?.role === 'admin';
  const [availableSlots, setAvailableSlots] = useState(null);
  const [activeHolds, setActiveHolds] = useState([]);
  const [activeBookings, setActiveBookings] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [dbSlots, setDbSlots] = useState([]);

  // Custom Modal State for Maintenance
  const [maintenanceModal, setMaintenanceModal] = useState({ isOpen: false, item: null, isZone: false });
  const [maintenanceReason, setMaintenanceReason] = useState("");
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  
  // activeSessions to track live cars
  const [activeSessions, setActiveSessions] = useState([]);

  useEffect(() => {
    document.body.classList.add("bg-[#080808]");
    return () => document.body.classList.remove("bg-[#080808]");
  }, []);

  const currentFloor = floors.find(f => f._id === currentFloorId);

  const getSlotFloorId = (slot) => String(slot.floorID?._id || slot.floorID || "");
  const sameId = (a, b) => String(a || "") === String(b || "");
  const sameSlotCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  const getNextFloorNumber = () => Math.max(0, ...floors.map(f => Number(f.floorNumber) || 0)) + 1;

  const getSlotPrefix = (slotName = "") => {
    const match = String(slotName).trim().match(/^([a-zA-Z]+)(?=\d|[-_\s]|$)/);
    return match ? match[1].toUpperCase() : null;
  };

  const prefixToIndex = (prefix) => {
    return [...prefix].reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0);
  };

  const indexToPrefix = (index) => {
    let next = index;
    let prefix = "";
    while (next > 0) {
      const remainder = (next - 1) % 26;
      prefix = String.fromCharCode(65 + remainder) + prefix;
      next = Math.floor((next - 1) / 26);
    }
    return prefix;
  };

  const renameSlotPrefix = (slotName, prefixMapping) => {
    const prefix = getSlotPrefix(slotName);
    if (!prefix || !prefixMapping[prefix]) return slotName;
    return String(slotName).replace(new RegExp(`^${prefix}`, "i"), prefixMapping[prefix]);
  };

  const renameZoneName = (zoneName, prefixMapping) => {
    return Object.entries(prefixMapping).reduce((name, [oldPrefix, newPrefix]) => {
      return name.replace(new RegExp(`\\b${oldPrefix}\\b`, "gi"), newPrefix);
    }, String(zoneName));
  };

  const syncFloorSlotsFromLayout = async (floorId) => {
    const floor = floors.find(f => sameId(f._id, floorId));
    if (!floor) return false;

    const res = await updateFloorLayout(floor._id, floor.layoutData);
    if (!res.ok) {
      alert("Failed to sync slots from layout: " + (res.data?.message || "Unknown error"));
      return false;
    }

    setFloors(prev => prev.map(f => sameId(f._id, floor._id) ? res.data.data : f));
    await fetchDbSlots(floor._id);
    return true;
  };

  const seedDefaultFloor = useCallback(async () => {
    const defaultLayout = {
      width: 1000,
      height: 600,
      elements: [
        { id: "gate-1", type: "gate", x: 20, y: 120, w: 80, h: 30, name: "ENTRANCE" },
        { id: "gate-2", type: "gate", x: 900, y: 120, w: 80, h: 30, name: "EXIT" },
        { id: "zone-1", type: "zone", x: 120, y: 50, w: 350, h: 200, name: "ZONE A - VIP", color: "purple" },
        { id: "slot-a1", type: "slot", x: 140, y: 100, w: 50, h: 70, name: "A01" },
        { id: "slot-a2", type: "slot", x: 210, y: 100, w: 50, h: 70, name: "A02" },
        { id: "slot-a3", type: "slot", x: 280, y: 100, w: 50, h: 70, name: "A03" },
        { id: "zone-2", type: "zone", x: 520, y: 50, w: 350, h: 200, name: "ZONE B - EV", color: "emerald" },
        { id: "slot-b1", type: "slot", x: 540, y: 100, w: 50, h: 70, name: "B01" },
        { id: "slot-b2", type: "slot", x: 610, y: 100, w: 50, h: 70, name: "B02" },
        { id: "planter-1", type: "planter", x: 40, y: 250, w: 30, h: 100, name: "" },
        { id: "planter-2", type: "planter", x: 930, y: 250, w: 30, h: 100, name: "" }
      ]
    };
    await createFloor({ floorNumber: 1, name: "Floor 1", layoutData: defaultLayout });
  }, []);

  const fetchFloors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAllFloors();
      if (res.ok && res.data.data) {
        if (res.data.data.length === 0) {
          await seedDefaultFloor();
          const retryRes = await getAllFloors();
          if (retryRes.ok && retryRes.data.data.length > 0) {
            setFloors(retryRes.data.data);
          }
        } else {
          setFloors(res.data.data);
        }
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [seedDefaultFloor]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFloors();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchFloors]);

  // Fetch Slots for current floor to know maintenance status
  const fetchDbSlots = useCallback(async (floorId) => {
    try {
      if (floorId) {
        const res = await getFloorSlots(floorId);
        if (res.ok && res.data.success) {
          setDbSlots(res.data.data);
        }
      } else {
        if (floors.length === 0) {
          setDbSlots([]);
          return;
        }
        const promises = floors.map(f => getFloorSlots(f._id));
        const results = await Promise.all(promises);
        const allSlots = results.flatMap(r => (r.ok && r.data.success) ? r.data.data : []);
        setDbSlots(allSlots);
      }
    } catch (e) {
      console.error("Failed to fetch slots", e);
    }
  }, [floors]);

  useEffect(() => {
    fetchDbSlots(currentFloorId);
  }, [currentFloorId, fetchDbSlots]);

  const fetchLiveData = useCallback(async () => {
    try {
      const sessionRes = await fetch(`${API_BASE}/sessions/active-status`);
      const sessionData = await sessionRes.json();
      if (sessionData.success) {
        setActiveSessions(sessionData.data);
      }

      const startTimeStr = new Date().toISOString();
      const endTimeStr = new Date(Date.now() + 60 * 1000).toISOString();
      const availableRes = await getAvailableBookingSlots({
        startTime: startTimeStr,
        endTime: endTimeStr,
      });
      if (availableRes.ok && availableRes.data?.data?.slots) {
        setAvailableSlots(availableRes.data.data.slots);
      }

      const holdsRes = await getActiveHolds();
      if (holdsRes.ok && holdsRes.data?.data) {
        setActiveHolds(holdsRes.data.data);
      }
      
      const bookingsRes = await getActiveMapBookings();
      if (bookingsRes.ok && bookingsRes.data?.data) {
        setActiveBookings(bookingsRes.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch live data', err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLiveData();
    const interval = setInterval(fetchLiveData, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [fetchLiveData]);

  const handleCreateFloor = async () => {
    const floorNumber = getNextFloorNumber();
    const name = `Floor ${floorNumber}`;
    const res = await createFloor({ floorNumber, name });
    if (res.ok && res.data.data) {
      setFloors([...floors, res.data.data]);
      setCurrentFloorId(res.data.data._id);
    }
  };

  const handleDuplicateFloor = async () => {
    if (!currentFloorId) return;
    const currentFloor = floors.find(f => f._id === currentFloorId);
    if (!currentFloor) return;

    // 1. Find the highest slot prefix used across all floors.
    let maxPrefixIndex = 0;
    floors.forEach(f => {
      f.layoutData?.elements?.forEach(el => {
        if (el.type.startsWith('slot') && el.name) {
          const prefix = getSlotPrefix(el.name);
          if (prefix) {
            maxPrefixIndex = Math.max(maxPrefixIndex, prefixToIndex(prefix));
          }
        }
      });
    });

    // 2. Find unique prefixes used in CURRENT floor
    const sourcePrefixes = new Set();
    currentFloor.layoutData?.elements?.forEach(el => {
      if (el.type.startsWith('slot') && el.name) {
        const prefix = getSlotPrefix(el.name);
        if (prefix) {
          sourcePrefixes.add(prefix);
        }
      }
    });
    const sortedSourcePrefixes = Array.from(sourcePrefixes).sort((a, b) => prefixToIndex(a) - prefixToIndex(b));

    // 3. Create mapping from old prefix to new prefix
    const prefixMapping = {};
    let nextPrefixIndex = maxPrefixIndex + 1;
    sortedSourcePrefixes.forEach(prefix => {
      prefixMapping[prefix] = indexToPrefix(nextPrefixIndex);
      nextPrefixIndex++;
    });

    // 4. Duplicate elements with renamed prefixes and new unique IDs
    const idMapping = {};
    const renamedElements = (currentFloor.layoutData?.elements || []).map(el => {
      const newId = `${el.type}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      idMapping[el.id] = newId;

      let newName = el.name;
      if (newName) {
        if (el.type.startsWith('slot')) {
          newName = renameSlotPrefix(newName, prefixMapping);
        } else if (el.type === 'zone') {
          newName = renameZoneName(newName, prefixMapping);
        }
      }
      return { ...el, id: newId, name: newName };
    });

    // 5. Update parentIds to maintain group structures
    const finalElements = renamedElements.map(el => {
      if (el.parentId && idMapping[el.parentId]) {
        return { ...el, parentId: idMapping[el.parentId] };
      }
      return el;
    });

    const newLayoutData = {
      ...currentFloor.layoutData,
      elements: finalElements
    };

    const floorNumber = getNextFloorNumber();
    const name = `Floor ${floorNumber}`;
    const res = await createFloor({ floorNumber, name, layoutData: newLayoutData });
    if (res.ok && res.data.data) {
      const newFloor = res.data.data;
      const syncRes = await updateFloorLayout(newFloor._id, newLayoutData);
      if (!syncRes.ok) {
        alert("Duplicated the floor layout, but failed to create its slots/zones: " + (syncRes.data?.message || "Unknown error"));
      }
      const syncedFloor = syncRes.ok && syncRes.data?.data ? syncRes.data.data : newFloor;
      setFloors([...floors, syncedFloor]);
      setCurrentFloorId(syncedFloor._id);
      await fetchDbSlots(syncedFloor._id);
    } else {
      alert("Failed to duplicate floor: " + (res.data?.message || "Unknown error"));
    }
  };

  const handleDeleteFloor = async () => {
    if (!currentFloorId) return;
    const currentIndex = floors.findIndex(f => f._id === currentFloorId);
    const currentFloor = floors[currentIndex];
    if (!currentFloor) return;

    if (window.confirm(`Are you sure you want to delete ${currentFloor.name}?`)) {
       const res = await deleteFloor(currentFloorId);
       if (res.ok) {
          const updatedFloors = floors.filter(f => f._id !== currentFloorId);
          setFloors(updatedFloors);
          if (updatedFloors.length > 0) {
             const nextIndex = Math.max(0, currentIndex - 1);
             setCurrentFloorId(updatedFloors[nextIndex]._id);
          } else {
             setCurrentFloorId(null);
          }
       } else {
          alert("Failed to delete floor: " + (res.data?.message || "Forbidden or Network error"));
       }
    }
  };

  const handleSaveLayout = async (layoutData) => {
    try {
      const res = await updateFloorLayout(currentFloorId, layoutData);
      if (res.ok) {
        setIsEditMode(false);
        fetchFloors();
        fetchDbSlots(currentFloorId);
      } else {
        alert("Failed to save map. Backend returned an error: " + (res.data?.message || "Unknown error"));
        console.error("Save Map Error:", res);
      }
    } catch (error) {
      alert("Failed to save map. Network error or session expired.");
      console.error("Save Map Exception:", error);
    }
  };

  if (isEditMode && currentFloor) {
    return (
      <ParkingLotsBuilder 
        floor={currentFloor} 
        dbSlots={dbSlots}
        onSave={handleSaveLayout} 
        onCancel={() => setIsEditMode(false)} 
      />
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-70px)] bg-[#080808] text-gray-200 font-sans relative overflow-hidden"
         style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`, backgroundSize: '30px 30px' }}>
      
      {/* Top Toolbar */}
      <div className="absolute top-4 left-8 z-50 flex items-center gap-4 bg-[#171717]/80 backdrop-blur border border-white/10 p-2 rounded-xl shadow-lg">
        <AdminSelect
          value={currentFloorId || ""}
          onChange={(nextFloorId) => setCurrentFloorId(nextFloorId === "" ? null : nextFloorId)}
          options={
            floors.length > 0
              ? [
                  { value: "", label: "Overview (All Floors)" },
                  ...floors.map((floor) => ({ value: floor._id, label: floor.name })),
                ]
              : [{ value: "", label: "No floors available" }]
          }
          className="min-w-[190px]"
          ariaLabel="Select parking floor"
        />
        
        {isAdmin && (
          <button onClick={handleCreateFloor} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition border border-white/10" title="Add new floor">
            <Plus size={18} className="text-cyan-400" />
          </button>
        )}

        {(currentFloor && isAdmin) && (
          <div className="flex items-center gap-2 ml-4 border-l border-white/10 pl-4">
            <button onClick={() => setIsEditMode(true)} className="flex items-center gap-2 bg-cyan-500/20 text-cyan-400 px-4 py-2 rounded-lg font-bold hover:bg-cyan-500/30 transition border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
              <Edit size={16} /> Edit Layout ({currentFloor.name})
            </button>
            <button onClick={handleDuplicateFloor} className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition border border-white/10" title="Duplicate this floor">
              <Copy size={16} />
            </button>
            <button onClick={handleDeleteFloor} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition border border-red-500/30" title="Delete this floor">
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Main Map Container using reusable component */}
      <div className="flex-1 overflow-hidden relative">
        <ParkingMapGrid
          floors={floors}
          currentFloorId={currentFloorId}
          onFloorSelect={setCurrentFloorId}
          onSlotClick={setSelectedItem}
          onZoneClick={setSelectedItem}
          activeSessions={activeSessions}
          dbSlots={dbSlots}
          availableSlots={availableSlots}
          activeHolds={activeHolds}
          activeBookings={activeBookings}
          loading={loading}
          isEditMode={isEditMode}
        />
      </div>

      {/* Slide-over panel for slots */}
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${selectedItem ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={() => setSelectedItem(null)}></div>
      <div className={`absolute top-0 right-0 bottom-0 w-[420px] bg-[#111111]/95 backdrop-blur-2xl border-l border-white/10 p-8 flex flex-col shadow-[-20px_0_50px_rgba(0,0,0,0.5)] text-slate-200 z-50 transform transition-transform duration-300 ease-in-out ${selectedItem ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedItem && (() => {
           const isZone = selectedItem.type === 'zone';
           const dbSlotInfo = !isZone
             ? dbSlots.find(s => sameSlotCode(s.slotNumber, selectedItem.id) && sameId(getSlotFloorId(s), selectedItem.floorId))
             : null;
           const zoneSlots = isZone
             ? dbSlots.filter(s => sameId(getSlotFloorId(s), selectedItem.floorId) && s.zoneID?.zoneName === selectedItem.name)
             : [];
           const zoneId = zoneSlots[0]?.zoneID?._id || zoneSlots[0]?.zoneID || null;
           const isMaintenance = isZone
             ? zoneSlots.length > 0 && zoneSlots.every(s => s.status === 'maintenance')
             : dbSlotInfo?.status === 'maintenance';

           const handleToggleMaintenance = async () => {
             try {
               if (isMaintenance) {
                 const res = await endMaintenance(isZone ? { zoneID: zoneId } : { slotID: dbSlotInfo._id });
                 if (res.ok) fetchDbSlots(currentFloorId);
                 else alert("Failed to end maintenance: " + (res.data?.message || "Unknown error"));
               } else {
                 setMaintenanceModal({ isOpen: true, item: isZone ? zoneId : dbSlotInfo._id, isZone });
               }
             } catch (e) {
               console.error("Maintenance toggle failed", e);
               alert("Network error while trying to toggle maintenance.");
             }
           };

           return (
           <>
              <div className="flex justify-between items-start mb-6 flex-shrink-0">
                <div>
                    <span className="text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] mb-1 block">{isZone ? "Maintenance Zone" : `${selectedItem.type} Ticket`}</span>
                    <h2 className="text-4xl font-extrabold text-white flex items-center gap-2">
                        {isZone ? "ZONE" : "SLOT"} <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">{isZone ? selectedItem.name : selectedItem.id}</span>
                    </h2>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-700/50 w-8 h-8 rounded-full flex items-center justify-center transition-all border border-white/5 flex-shrink-0">
                    <X size={16} strokeWidth={2} />
                </button>
            </div>
            <div className="mb-4 flex-1 overflow-y-auto pr-2">
                <h3 className="text-slate-500 text-[11px] font-bold uppercase tracking-[0.15em] mb-4">{isZone ? "Zone Details" : "Slot Details"}</h3>
                
                {(dbSlotInfo || (isZone && zoneId)) && (!selectedItem.session) && (
                  <div className="mb-4">
                    <button 
                      onClick={handleToggleMaintenance}
                      className={`w-full py-2 rounded font-bold transition-all ${isMaintenance ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'}`}
                    >
                      {isMaintenance ? "End Maintenance" : "Start Maintenance"}
                    </button>
                  </div>
                )}

                {isZone && (
                  <div className="mb-4 rounded-xl border border-white/10 bg-slate-900/60 p-4 text-sm">
                    <div className="flex justify-between border-b border-white/5 pb-2"><span className="text-slate-400">Total slots</span><span className="font-bold text-white">{zoneSlots.length}</span></div>
                    <div className="flex justify-between pt-2"><span className="text-slate-400">Maintenance slots</span><span className="font-bold text-red-400">{zoneSlots.filter(s => s.status === 'maintenance').length}</span></div>
                  </div>
                )}

                {((!isZone && !dbSlotInfo) || (isZone && !zoneId)) && (
                  <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <p className="text-xs text-amber-200 mb-3">
                      This {isZone ? "zone" : "slot"} exists in the layout but is not synced to the database yet.
                    </p>
                    <button
                      onClick={() => syncFloorSlotsFromLayout(selectedItem.floorId)}
                      className="w-full rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/30 transition"
                    >
                      Sync slots from layout
                    </button>
                  </div>
                )}

                {isMaintenance ? (
                  <div className="flex flex-col gap-3 h-full items-center justify-center text-center py-10 opacity-90">
                      <div className="w-16 h-16 rounded-full bg-red-900/40 flex items-center justify-center border border-red-500/60 mb-2 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                          <span className="text-red-500 font-bold text-2xl">⚠</span>
                      </div>
                      
                      {(!isZone && dbSlotInfo?.maintenanceReason) ? (
                        <>
                          <h3 className="text-xl font-bold text-white max-w-[280px] break-words leading-relaxed">
                            {dbSlotInfo.maintenanceReason}
                          </h3>
                          <span className="bg-red-500/20 text-red-400 text-[10px] px-3 py-1 rounded-full border border-red-500/30 font-bold uppercase tracking-widest mt-1">
                            Under Maintenance
                          </span>
                        </>
                      ) : (
                        <>
                          <h3 className="text-xl font-bold text-white max-w-[280px] break-words leading-relaxed">
                            System Maintenance
                          </h3>
                          <span className="bg-red-500/20 text-red-400 text-[10px] px-3 py-1 rounded-full border border-red-500/30 font-bold uppercase tracking-widest mt-1">
                            Under Maintenance
                          </span>
                          <p className="text-xs text-slate-400 max-w-[250px] mt-2">
                            This {isZone ? "zone" : "slot"} is currently locked for maintenance.
                          </p>
                        </>
                      )}
                  </div>
                ) : !isZone && selectedItem.session ? (
                  <div className="flex flex-col gap-4">
                      <div className="bg-rose-900/20 border border-rose-500/30 rounded-xl p-4 flex flex-col items-center justify-center mb-2">
                          <span className="text-xs text-rose-400 uppercase tracking-widest font-bold mb-1">Status</span>
                          <span className="text-lg text-white font-black uppercase">Occupied</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">License Plate</span><span className="font-mono text-base font-semibold text-white bg-slate-800/80 px-3 py-1 rounded border border-slate-700/50">{selectedItem.session.licensePlate}</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Phone</span><span className="font-medium text-white">{selectedItem.session.phone || <span className="text-slate-500 italic">Guest</span>}</span></div>
                      {selectedItem.session.userId?.email && (
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Email</span><span className="font-medium text-cyan-400">{selectedItem.session.userId.email}</span></div>
                      )}
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Vehicle Type</span><span className="font-medium text-white uppercase">{selectedItem.session.vehicleType || 'Unknown'}</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Check-in Time</span><span className="font-medium text-white">{new Date(selectedItem.session.checkInTime).toLocaleString('vi-VN')}</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Expected Duration</span><span className="font-medium text-white">{selectedItem.session.expectedDurationHours} hr(s)</span></div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Expiration Time</span><span className="font-bold text-rose-400">{new Date(new Date(selectedItem.session.checkInTime).getTime() + (selectedItem.session.expectedDurationHours || 0) * 3600000).toLocaleString('vi-VN')}</span></div>
                      <div className="flex justify-between items-center mt-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                          <span className="text-cyan-400 text-sm font-bold tracking-wide uppercase">Parked For</span>
                          <LiveDuration checkInTime={selectedItem.session.checkInTime} expectedDurationHours={selectedItem.session.expectedDurationHours} />
                      </div>
                  </div>
                ) : !isZone && selectedItem.isReserved ? (
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
                              <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Email</span><span className="font-medium text-cyan-400">{dbSlotInfo.subscriptionDetail.user.email || 'N/A'}</span></div>
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
                ) : !isZone && selectedItem.isHeld ? (
                  <div className="flex flex-col gap-4">
                      <div className="bg-orange-900/20 border border-orange-500/30 rounded-xl p-4 flex flex-col items-center justify-center mb-2">
                          <span className="text-xs text-orange-400 uppercase tracking-widest font-bold mb-1">Status</span>
                          <span className="text-lg text-white font-black uppercase">Holding / Booked</span>
                      </div>
                      {selectedItem.booking ? (
                        <>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Customer Name</span><span className="font-medium text-white">{selectedItem.booking.userId?.username || 'N/A'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Phone</span><span className="font-medium text-white">{selectedItem.booking.userId?.phone || 'N/A'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Email</span><span className="font-medium text-cyan-400">{selectedItem.booking.userId?.email || 'N/A'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">License Plate</span><span className="font-mono text-base font-semibold text-white bg-slate-800/80 px-3 py-1 rounded border border-slate-700/50">{selectedItem.booking.licensePlate || 'N/A'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">Start Time</span><span className="font-medium text-white">{new Date(selectedItem.booking.scheduledStart).toLocaleString('vi-VN')}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-sm">End Time</span><span className="font-medium text-white">{new Date(selectedItem.booking.scheduledEnd).toLocaleString('vi-VN')}</span></div>
                        </>
                      ) : (
                        <p className="text-xs text-orange-400 text-center mt-4">This slot is currently held for an upcoming booking or checkout process.</p>
                      )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-10 opacity-70">
                      <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 mb-2">
                          <span className="text-slate-500 font-bold text-2xl">P</span>
                      </div>
                      <p className="text-slate-400 font-bold uppercase tracking-widest">Slot is Empty</p>
                      <p className="text-xs text-slate-500 max-w-[200px]">Ready for next incoming vehicle assignment.</p>
                  </div>
                )}
            </div>
            
            {!isZone && selectedItem.session && (
              <div className="mt-auto flex-shrink-0 pt-4 pb-2">
                 <button 
                    onClick={() => setShowCheckoutModal(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] py-4 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(255,213,85,0.18)] transition-all hover:bg-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98]">
                    <X size={18} />
                    Process Check-out
                 </button>
              </div>
            )}
            
           </>
        )})()}
      </div>

      {/* Maintenance Reason Modal */}
      {maintenanceModal.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#171717] rounded-2xl border border-white/10 w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-white/5">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30">
                  <span className="text-red-500 text-sm">⚠</span>
                </div>
                Start Maintenance
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Reason for Maintenance
                </label>
                <textarea
                  autoFocus
                  className="w-full h-24 bg-black/50 border border-white/10 rounded-xl p-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 resize-none transition-all"
                  placeholder="E.g., Cleaning, Repairing broken sensor..."
                  value={maintenanceReason}
                  onChange={(e) => setMaintenanceReason(e.target.value)}
                />
              </div>
            </div>
            <div className="p-6 bg-black/40 flex justify-end gap-3 border-t border-white/5">
              <button
                onClick={() => {
                  setMaintenanceModal({ isOpen: false, item: null, isZone: false });
                  setMaintenanceReason("");
                }}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!maintenanceReason.trim()}
                onClick={async () => {
                  if (!maintenanceReason.trim()) return;
                  try {
                    const { item, isZone } = maintenanceModal;
                    const payload = isZone ? { zoneID: item, reason: maintenanceReason } : { slotID: item, reason: maintenanceReason };
                    const res = await startMaintenance(payload);
                    if (res.ok) {
                      fetchDbSlots(currentFloorId);
                      setMaintenanceModal({ isOpen: false, item: null, isZone: false });
                      setMaintenanceReason("");
                    } else {
                      alert("Failed to start maintenance: " + (res.data?.message || "Unknown error"));
                    }
                  } catch (e) {
                    console.error("Maintenance start failed", e);
                    alert("Network error while trying to start maintenance.");
                  }
                }}
                className="px-5 py-2.5 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white transition-colors shadow-[0_0_20px_rgba(239,68,68,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showCheckoutModal && selectedItem?.session && (
        <StaffCheckoutModal 
          isOpen={showCheckoutModal}
          onClose={() => setShowCheckoutModal(false)}
          session={{...selectedItem.session, parkingSlot: selectedItem.id}}
          onSuccess={() => {
            setShowCheckoutModal(false);
            setSelectedItem(null);
            if (currentFloorId) {
              fetchLiveData();
              fetchDbSlots(currentFloorId);
            }
          }}
        />
      )}

    </div>
  );
}

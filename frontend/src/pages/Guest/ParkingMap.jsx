import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import ParkingMapGrid from '../../components/ParkingMapGrid';
import { getLiveMapData, getAllFloors } from '../../services/parkingFloorService';
import { Car, ChevronDown, X, LayoutDashboard } from 'lucide-react';

const MapFloorPicker = ({ floors, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedFloor = floors.find((floor) => floor._id === value);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectFloor = (floorId) => {
    onChange(floorId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-11 min-w-[116px] items-center justify-between rounded-xl border border-transparent bg-gray-100 px-3 text-left text-sm font-bold text-gray-800 outline-none transition hover:border-gold/40 hover:bg-white focus:border-gold focus:ring-1 focus:ring-gold"
      >
        <span className="min-w-0 truncate">{selectedFloor?.name || 'Select floor'}</span>
        <ChevronDown
          size={15}
          className={`ml-3 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-2 max-h-56 min-w-full overflow-y-auto rounded-2xl border border-gray-100 bg-white py-2 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
          {floors.map((floor) => {
            const isActive = floor._id === value;
            return (
              <button
                key={floor._id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => selectFloor(floor._id)}
                className={`mx-2 flex w-[calc(100%_-_1rem)] min-w-[100px] items-center justify-between whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  isActive
                    ? 'bg-gold/10 font-bold text-gold'
                    : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span>{floor.name}</span>
                {isActive && <span className="ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default function ParkingMap() {
  const navigate = useNavigate();
  
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem("valo_user");
    return raw ? JSON.parse(raw) : null;
  });

  useEffect(() => {
    const syncUser = () => {
      const raw = sessionStorage.getItem("valo_user");
      setUser(raw ? JSON.parse(raw) : null);
    };
    window.addEventListener("valo_auth_change", syncUser);
    return () => window.removeEventListener("valo_auth_change", syncUser);
  }, []);

  const [floors, setFloors] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  
  const [liveData, setLiveData] = useState([]);
  
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [dbSlots, setDbSlots] = useState([]);

  // Stats
  const totalSlots = liveData.length;
  const availableSlotsCount = liveData.filter(s => s.status === 'available').length;
  const maintenanceSlotsCount = liveData.filter(s => s.status === 'maintenance').length;
  const occupiedSlotsCount = totalSlots - availableSlotsCount - maintenanceSlotsCount;

  useEffect(() => {
    document.title = "Live Parking Map - Valo Parking";
    
    const fetchData = async () => {
      try {
        const [floorsRes, liveRes] = await Promise.all([
          getAllFloors(),
          getLiveMapData()
        ]);
        
        if (floorsRes.ok && floorsRes.data?.data) {
          setFloors(floorsRes.data.data);
          if (floorsRes.data.data.length > 0) {
            setCurrentFloorId(floorsRes.data.data[0]._id);
          }
        }
        
        if (liveRes.ok && liveRes.data?.data) {
          // Filter out slots without floorId to avoid rendering ghost slots
          setLiveData(liveRes.data.data.filter(s => s.floorId));
        }
      } catch (err) {
        console.error("Failed to fetch map data", err);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!currentFloorId) return;
    const fetchDbSlots = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/parking-floors/${currentFloorId}/slots`);
        const data = await res.json();
        if (data.success) {
          setDbSlots(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch db slots", err);
      }
    };
    fetchDbSlots();
  }, [currentFloorId]);

  const activeSessions = useMemo(() => {
    return liveData.filter(s => s.status === 'occupied').map(s => ({
      floorId: s.floorId,
      parkingSlot: s.id
    }));
  }, [liveData]);

  const availableSlotsList = useMemo(() => {
    return liveData.filter(s => s.status === 'available').map(s => ({
      floorId: s.floorId,
      slotCode: s.id
    }));
  }, [liveData]);

  const handleSlotSelect = (slotData, floorId) => {
    // slotData = { id: 'A1', type: 'slot-standard' }
    const liveSlot = liveData.find(s => s.id === slotData.id && s.floorId === floorId);
    if (!liveSlot) return;

    if (liveSlot.status !== 'available') return;

    if (!user) {
      setSelectedSlot(liveSlot);
      setShowGuestModal(true);
    } else {
      navigate('/booking', { state: { selectedSlot: liveSlot } });
    }
  };

  const handleLoginRedirect = () => {
    navigate('/login', { state: { returnUrl: '/booking' } });
  };

  return (
    <div className="h-screen bg-white font-sans flex flex-col overflow-hidden pt-[52px] sm:pt-[72px]">
      <Navbar />

      {/* Header Compact */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm z-10 shrink-0">
        <div className="mb-3 sm:mb-0">
          <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <LayoutDashboard className="text-gold" size={24} />
            INTERACTIVE MAP
          </h1>
          <p className="text-xs text-gray-500 font-medium">Live real-time updates</p>
        </div>
        
        <div className="flex gap-2 sm:gap-4 items-center">
          <div className="flex flex-col items-center bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 min-w-[80px]">
            <span className="text-sm font-black text-gray-900">{totalSlots}</span>
            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Total Slots</span>
          </div>
          <div className="flex flex-col items-center bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5 min-w-[80px]">
            <span className="text-sm font-black text-emerald-600">{availableSlotsCount}</span>
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Available</span>
          </div>
          <div className="flex flex-col items-center bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5 min-w-[80px]">
            <span className="text-sm font-black text-rose-600">{occupiedSlotsCount}</span>
            <span className="text-[9px] font-bold text-rose-600 uppercase tracking-widest">Occupied</span>
          </div>
          <div className="flex flex-col items-center bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 min-w-[80px]">
            <span className="text-sm font-black text-amber-600">{maintenanceSlotsCount}</span>
            <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Maintenance</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden bg-[#f8fafc]">
        {floors.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-medium">
            Loading map data...
          </div>
        ) : (
          <>
            <ParkingMapGrid
              floors={floors}
              currentFloorId={currentFloorId}
              onFloorSelect={setCurrentFloorId}
              onSlotClick={handleSlotSelect}
              activeSessions={activeSessions}
              dbSlots={dbSlots}
              availableSlots={availableSlotsList}
              is2DMode={true}
            />

            {/* Floor Selector Floating */}
            <div className="absolute top-4 left-4 z-40 bg-white/90 backdrop-blur-md p-2 rounded-xl border border-gray-200 shadow-sm flex items-center gap-2">
               <span className="text-xs font-bold text-gray-500 ml-2">FLOOR:</span>
               <MapFloorPicker
                 floors={floors}
                 value={currentFloorId || ""}
                 onChange={setCurrentFloorId}
               />
            </div>

            {/* Status Legend Floating */}
            <div className="absolute bottom-4 left-4 z-40 bg-white/95 backdrop-blur-md p-4 rounded-2xl border border-gray-100 shadow-xl flex flex-col gap-2.5">
               <h4 className="text-[10px] font-black text-gold tracking-widest uppercase mb-1">Status Legend</h4>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-md bg-white border-[2px] border-slate-300 shadow-sm"></div>
                 <span className="text-xs font-bold text-gray-700">Available</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-md bg-red-100 border-[2px] border-red-500 shadow-sm"></div>
                 <span className="text-xs font-bold text-red-600">Occupied</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-md bg-cyan-100 border-[2px] border-cyan-500 shadow-sm"></div>
                 <span className="text-xs font-bold text-cyan-600">Selected</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-md bg-yellow-100 border-[2px] border-yellow-500 shadow-sm"></div>
                 <span className="text-xs font-bold text-yellow-600">VIP Pass</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-md bg-red-200 border-[2px] border-red-500 shadow-sm" style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.2) 4px, rgba(127, 29, 29, 0.3) 4px, rgba(127, 29, 29, 0.3) 8px)' }}></div>
                 <span className="text-xs font-bold text-red-700">Maintenance</span>
               </div>
            </div>
          </>
        )}
      </div>

      {/* Guest Modal */}
      {showGuestModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onClick={() => setShowGuestModal(false)}></div>
          
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl transform transition-all relative overflow-hidden flex flex-col">
            <div className="p-6 pb-0 flex justify-between items-start relative z-10">
              <div className="bg-gold/20 text-yellow-700 p-3 rounded-2xl">
                <Car size={32} strokeWidth={1.5} />
              </div>
              <button 
                onClick={() => setShowGuestModal(false)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 pt-6 relative z-10">
              <h3 className="text-2xl font-black text-gray-900 mb-2">Login to Book</h3>
              <p className="text-gray-600 mb-6 font-medium leading-relaxed">
                Slot <span className="font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">{selectedSlot?.id}</span> is available. Please login to reserve your spot and proceed to payment.
              </p>

              <button
                onClick={handleLoginRedirect}
                className="w-full bg-gray-900 hover:bg-black text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
              >
                Go to Login
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

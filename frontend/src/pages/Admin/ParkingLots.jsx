import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Edit,
  Copy,
  Trash2,
  X,
  MonitorCheck,
  Camera,
  ShieldAlert,
  History,
  RefreshCw,
  Clock,
  CheckCircle2,
  Phone,
  RotateCw,
  RotateCcw,
  Maximize2,
  Settings,
  ChevronDown
} from "lucide-react";
import ParkingLotsBuilder from "./ParkingLotsBuilder/ParkingLotsBuilder";
import ParkingMapGrid from "../../components/ParkingMapGrid";
import AdminSelect from "../../components/Admin/AdminSelect";
import { getAllFloors, createFloor, updateFloorLayout, deleteFloor, getFloorSlots } from "../../services/parkingFloorService";
import { startMaintenance, endMaintenance } from "../../services/maintenanceService";
import { API_BASE } from "../../services/api";
import { getAvailableBookingSlots, getActiveHolds, getActiveMapBookings, getAllBookings } from "../../services/bookingService";
import StaffCheckoutModal from "../Staff/StaffCheckoutModal";
import ConfirmModal from "../../components/Admin/ConfirmModal";
import SlotCameraMonitorModal from "../Staff/components/SlotCameraMonitorModal.jsx";
import ViolationResolutionModal from "../Staff/components/ViolationResolutionModal.jsx";
import GlobalViolationHistoryModal from "../Staff/components/GlobalViolationHistoryModal.jsx";
import { formatLicensePlateDisplay } from "../../utils/licensePlate";
import { getSlotLogs, clearAllViolationsApi } from "../../services/aiSurveillanceService";
import toast from "react-hot-toast";

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
  const navigate = useNavigate();
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
  const [slotLoads, setSlotLoads] = useState({});
  const slotRequests = useRef({});
  const pendingSlotRequests = useRef({});
  const dbSlots = useMemo(() => floors.flatMap(floor => slotLoads[floor._id]?.slots || []), [floors, slotLoads]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  // Custom Modal State for Maintenance
  const [maintenanceModal, setMaintenanceModal] = useState({ isOpen: false, item: null, isZone: false });
  const [maintenanceReason, setMaintenanceReason] = useState("");
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutSessionData, setCheckoutSessionData] = useState(null);
  
  // activeSessions to track live cars
  const [activeSessions, setActiveSessions] = useState([]);
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, floorId: null, floorName: "" });

  // AI Surveillance & Global History States
  const [showSurveillanceModal, setShowSurveillanceModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [floorAiStatusesMap, setFloorAiStatusesMap] = useState({});
  const [selectedViolation, setSelectedViolation] = useState(null);

  // Slot Slideover Tabs & History
  const [slotTab, setSlotTab] = useState('details'); // 'details' | 'history'
  const [slotLogs, setSlotLogs] = useState([]);
  const [loadingSlotLogs, setLoadingSlotLogs] = useState(false);

  const [searchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId");
  const floorIdParam = searchParams.get('floorId');
  const slotIdParam = searchParams.get('slotId');
  const bookingRequest = useRef(0);
  const [deepLinkError, setDeepLinkError] = useState('');

  useEffect(() => {
    document.body.classList.add("bg-[#080808]");
    return () => document.body.classList.remove("bg-[#080808]");
  }, []);

  const currentFloor = floors.find(f => f._id === currentFloorId);

  const getSlotFloorId = (slot) => String(slot.floorID?._id || slot.floorID || "");
  const sameId = (a, b) => String(a?._id || a || "") === String(b?._id || b || "");
  const sameSlotCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  const selectedSession = activeSessions.find(session => selectedItem
    && sameId(session.floorId, selectedItem.floorId)
    && sameSlotCode(session.parkingSlot, selectedItem.id)) || (!sessionsLoaded ? selectedItem?.session : null);

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

  // Verify each URL independently; stale responses must never open another record.
  useEffect(() => {
    const generation = ++bookingRequest.current;
    if (!bookingIdParam || floors.length === 0) return;
    const load = async () => {
      setSelectedItem(null);
      setDeepLinkError('');
      if (!/^[a-f\d]{24}$/i.test(bookingIdParam)) { setDeepLinkError('Invalid booking link.'); return; }
      try {
        const res = await getAllBookings({ bookingId: bookingIdParam });
        if (generation !== bookingRequest.current) return;
        const booking = res.ok && res.data?.data?.find(row => String(row._id).toLowerCase() === bookingIdParam.toLowerCase());
        const floorId = booking?.floorId?._id || booking?.floorId;
        if (!booking || !floors.some(floor => floor._id === floorId) || !booking.parkingSlot) {
          setDeepLinkError('Booking not found or unavailable on this parking map.'); return;
        }
        setCurrentFloorId(floorId);
        setSelectedItem({ id: booking.parkingSlot, type: 'hourly', floorId, isHeld: true, booking });
      } catch { if (generation === bookingRequest.current) setDeepLinkError('Unable to open this booking. Please try again.'); }
    };
    const timer = setTimeout(load, 0);
    return () => { clearTimeout(timer); bookingRequest.current += 1; };
  }, [bookingIdParam, floors]);

  useEffect(() => {
    if (!floorIdParam || bookingIdParam || !floors.length) return;
    let active = true;
    const timer = setTimeout(async () => {
      setSelectedItem(null); setDeepLinkError('');
      const floor = /^[a-f\d]{24}$/i.test(floorIdParam) && floors.find(row => row._id.toLowerCase() === floorIdParam.toLowerCase());
      if (!floor) { setDeepLinkError('Parking floor not found or unavailable.'); return; }
      setCurrentFloorId(floor._id);
      if (!slotIdParam) return;
      if (!/^[a-f\d]{24}$/i.test(slotIdParam)) { setDeepLinkError('Invalid parking slot link.'); return; }
      try {
        const res = await getFloorSlots(floor._id);
        if (!active) return;
        const slot = res.ok && res.data?.data?.find(row => row._id.toLowerCase() === slotIdParam.toLowerCase());
        if (!slot) { setDeepLinkError('Parking slot not found or unavailable.'); return; }
        setSelectedItem({ id: slot.slotNumber, type: slot.slotType, floorId: floor._id });
      } catch { if (active) setDeepLinkError('Unable to open this parking slot. Please try again.'); }
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [floorIdParam, slotIdParam, bookingIdParam, floors]);

  // Each floor retains its own slots and request state. A late response must
  // never replace a newer response or evict slots from the all-floor overview.
  const fetchDbSlots = useCallback(async (floorId) => {
    const ids = floorId ? [String(floorId)] : floors.map(floor => floor._id);
    await Promise.all(ids.map(async id => {
      // Slow requests must finish instead of being superseded by each poll.
      if (pendingSlotRequests.current[id]) return;
      pendingSlotRequests.current[id] = true;
      const request = (slotRequests.current[id] || 0) + 1;
      slotRequests.current[id] = request;
      setSlotLoads(previous => ({ ...previous, [id]: { ...previous[id], status: 'loading', error: '' } }));
      try {
        const res = await getFloorSlots(id);
        if (!res.ok || !res.data?.success || !Array.isArray(res.data.data)) {
          throw new Error(res.data?.message || `Unable to load slots${res.status ? ` (HTTP ${res.status})` : ''}.`);
        }
        if (slotRequests.current[id] !== request) return;
        setSlotLoads(previous => ({ ...previous, [id]: { status: 'success', slots: res.data.data, error: '' } }));
      } catch (error) {
        if (slotRequests.current[id] !== request) return;
        setSlotLoads(previous => ({ ...previous, [id]: { ...previous[id], status: 'error', error: error.message } }));
      } finally {
        pendingSlotRequests.current[id] = false;
      }
    }));
  }, [floors]);

  useEffect(() => {
    const requests = slotRequests.current;
    const refresh = () => { void fetchDbSlots(); };
    const timer = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      Object.keys(requests).forEach(id => { requests[id] += 1; });
    };
  }, [fetchDbSlots]);

  const fetchLiveData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('accessToken');
      const sessionRes = await fetch(`${API_BASE}/sessions/active-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const sessionData = await sessionRes.json();
      if (sessionData.success) {
        setActiveSessions(sessionData.data);
        setSessionsLoaded(true);
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
    fetchLiveData();
    const interval = setInterval(fetchLiveData, 5000); // 5s interval for live monitor
    return () => clearInterval(interval);
  }, [fetchLiveData]);

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

  // Violations list computed from AI surveillance
  const violations = useMemo(() => {
    if (!Array.isArray(aiSlotStatuses)) return [];
    return aiSlotStatuses.filter((s) => {
      const isWrongSlot = s.status === 'WRONG_SLOT_VIOLATION' || s.violationType === 'WRONG_SLOT_VIOLATION';
      const isUnauth = s.status === 'UNAUTHORIZED_PARKING' || s.violationType === 'UNAUTHORIZED_PARKING' || s.status === 'UNAUTHORIZED_OCCUPANCY';
      if (isWrongSlot && s.expectedSlot && s.slotCode && s.expectedSlot.toUpperCase() === s.slotCode.toUpperCase()) {
        return false;
      }
      return (isWrongSlot || isUnauth) && s.isViolation;
    });
  }, [aiSlotStatuses]);

  const handleResetAlerts = async () => {
    try {
      const res = await clearAllViolationsApi(currentFloorId || null);
      if (res.success || res.ok) {
        toast.success(res.message || res.data?.message || 'Violations reset and cleared successfully!');
        setFloorAiStatusesMap({});
        fetchDbSlots(currentFloorId);
        fetchLiveData();
      } else {
        toast.error(res.message || res.data?.message || 'Failed to reset violations');
      }
    } catch (err) {
      toast.error('Error connecting to reset violations');
    }
  };

  // When selectedItem changes, load its individual history logs
  useEffect(() => {
    if (selectedItem?.id && selectedItem.type !== 'zone') {
      setSlotTab('details');
      setLoadingSlotLogs(true);
      getSlotLogs(selectedItem.id, selectedItem.floorId)
        .then((res) => {
          if (res?.success) setSlotLogs(res.data || []);
          else if (res?.ok && res.data?.data) setSlotLogs(res.data.data || []);
          else setSlotLogs([]);
        })
        .catch(() => setSlotLogs([]))
        .finally(() => setLoadingSlotLogs(false));
    } else {
      setSlotLogs([]);
    }
  }, [selectedItem?.id, selectedItem?.floorId, selectedItem?.type]);

  const handleTriggerCheckout = (sessionOrSlot) => {
    const session = sessionOrSlot.session || sessionOrSlot;
    const slotId = sessionOrSlot.parkingSlot || sessionOrSlot.id || session.parkingSlot;
    setCheckoutSessionData({ ...session, parkingSlot: slotId });
    setShowCheckoutModal(true);
  };

  const handleCreateFloor = async () => {
    const floorNumber = getNextFloorNumber();
    const name = `Floor ${floorNumber}`;
    const code = `F${floorNumber}`;
    const res = await createFloor({ floorNumber, name, code });
    if (res.ok && res.data?.data) {
      setFloors([...floors, res.data.data]);
      setCurrentFloorId(res.data.data._id);
      toast.success(`Created ${name}`);
    } else {
      toast.error(res.data?.message || "Không thể tạo tầng mới");
    }
  };

  const handleDuplicateFloor = async (targetFloor = null) => {
    const floorToDuplicate = targetFloor || (currentFloorId ? floors.find(f => f._id === currentFloorId) : null);
    if (!floorToDuplicate) return;
    const currentFloor = floorToDuplicate;

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

    const prefixMapping = {};
    let nextPrefixIndex = maxPrefixIndex + 1;
    sortedSourcePrefixes.forEach(prefix => {
      prefixMapping[prefix] = indexToPrefix(nextPrefixIndex);
      nextPrefixIndex++;
    });

    const floorNumber = getNextFloorNumber();
    const name = `Floor ${floorNumber}`;
    const code = `F${floorNumber}`;

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
      let newText = el.text;
      if (el.type === 'text' && typeof el.text === 'string') {
        newText = el.text.replace(/FLOOR \d+/gi, `FLOOR ${floorNumber}`);
      }
      return { ...el, id: newId, name: newName, ...(newText ? { text: newText } : {}) };
    });

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

    const res = await createFloor({ floorNumber, name, code, layoutData: newLayoutData });
    if (res.ok && res.data?.data) {
      const newFloor = res.data.data;
      const syncRes = await updateFloorLayout(newFloor._id, newLayoutData);
      if (!syncRes.ok) {
        toast.error("Duplicated layout, but failed to sync slots: " + (syncRes.data?.message || "Unknown error"));
      }
      const syncedFloor = syncRes.ok && syncRes.data?.data ? syncRes.data.data : newFloor;
      setFloors([...floors, syncedFloor]);
      setCurrentFloorId(syncedFloor._id);
      await fetchDbSlots(syncedFloor._id);
      toast.success(`Đã nhân bản thành công sang ${name}`);
    } else {
      toast.error("Không thể nhân bản tầng: " + (res.data?.message || "Lỗi hệ thống"));
    }
  };

  const handleDeleteFloor = () => {
    if (!currentFloorId) return;
    const currentFloor = floors.find(f => f._id === currentFloorId);
    if (!currentFloor) return;
    setDeleteModal({ isOpen: true, floorId: currentFloorId, floorName: currentFloor.name });
  };

  const executeDeleteFloor = async () => {
    const { floorId } = deleteModal;
    if (!floorId) return;
    const currentIndex = floors.findIndex(f => f._id === floorId);
    const res = await deleteFloor(floorId);
    if (res.ok) {
      const updatedFloors = floors.filter(f => f._id !== floorId);
      setFloors(updatedFloors);
      if (updatedFloors.length > 0) {
        const nextIndex = Math.max(0, currentIndex - 1);
        setCurrentFloorId(updatedFloors[nextIndex]._id);
      } else {
        setCurrentFloorId(null);
      }
      toast.success("Đã xoá tầng thành công");
    } else {
      toast.error(res.data?.message || "Không thể xoá tầng: Có ràng buộc dữ liệu hoặc lỗi mạng");
    }
    setDeleteModal({ isOpen: false, floorId: null, floorName: "" });
  };

  const handleSaveLayout = async (layoutData) => {
    try {
      const res = await updateFloorLayout(currentFloorId, layoutData);
      if (res.ok) {
        setIsEditMode(false);
        fetchFloors();
        fetchDbSlots(currentFloorId);
        toast.success("Layout saved successfully!");
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
      {deepLinkError && <p role="alert" className="m-4 rounded-lg bg-red-950 p-3 text-red-200">{deepLinkError}</p>}
      
      {/* Top Floating Control Bar: Responsive, Two-Cluster Layout */}
      <div className="absolute top-4 left-6 right-6 z-40 flex items-center justify-between gap-3 pointer-events-none flex-wrap">
        
        {/* Left Cluster: Floor Selection & Layout Management */}
        <div className="pointer-events-auto flex items-center gap-2 bg-[#111111]/95 backdrop-blur-md border border-white/10 p-2 rounded-xl shadow-[0_18px_45px_rgba(0,0,0,0.4)] shrink-0">
          {/* Title Badge */}
          <div className="flex items-center gap-1.5 px-2 border-r border-white/10 shrink-0">
            <MonitorCheck size={16} className="text-cyan-400" />
            <span className="text-xs font-black uppercase tracking-wider text-cyan-400 hidden sm:inline">LIVE MONITOR</span>
          </div>

          {/* Floor Selector Dropdown */}
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
            className="min-w-[150px] max-w-[190px]"
            ariaLabel="Select parking floor"
          />

          {/* Admin Quick Action: [+] Add New Floor */}
          {isAdmin && (
            <button
              type="button"
              onClick={handleCreateFloor}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition border border-white/10 text-cyan-400 active:scale-95 shrink-0"
              title="Thêm tầng mới"
            >
              <Plus size={16} />
            </button>
          )}

          {/* Admin Quick Action: [Edit Layout], [Duplicate], [Delete] */}
          {(currentFloor && isAdmin) && (
            <div className="flex items-center gap-1.5 border-l border-white/10 pl-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsEditMode(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-400/40 text-xs font-bold transition shadow-sm active:scale-95 shrink-0"
                title={`Edit visual layout for ${currentFloor.name}`}
              >
                <Edit size={13} className="text-cyan-400" />
                <span>Edit Layout</span>
              </button>
              <button
                type="button"
                onClick={() => handleDuplicateFloor(currentFloor)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition active:scale-95 shrink-0"
                title="Duplicate this floor"
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                onClick={handleDeleteFloor}
                className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition active:scale-95 shrink-0"
                title="Delete this floor"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Right Cluster: Live Surveillance & Action Tools */}
        <div className="pointer-events-auto flex items-center gap-2 bg-[#111111]/95 backdrop-blur-md border border-white/10 p-2 rounded-xl shadow-[0_18px_45px_rgba(0,0,0,0.4)] shrink-0">
          {/* Live Update Pulse */}
          <div className="flex items-center gap-1.5 px-2 shrink-0">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider hidden md:inline">
              LIVE UPDATE
            </span>
          </div>

          {/* Action 1: Camera AI */}
          <button
            type="button"
            onClick={() => setShowSurveillanceModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/40 text-cyan-300 font-extrabold text-xs hover:bg-cyan-500 hover:text-black transition shadow-sm active:scale-95 shrink-0"
            title="Open Camera AI Slot Surveillance"
          >
            <Camera size={14} className="text-cyan-400" />
            <span>Camera AI</span>
            {violations.length > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] font-black bg-red-500 text-white rounded-full animate-bounce">
                {violations.length}
              </span>
            )}
          </button>

          {/* Action 2: Violation History */}
          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-400/20 to-yellow-500/20 border border-amber-400/40 text-amber-300 font-bold text-xs hover:bg-amber-400 hover:text-black transition shadow-sm active:scale-95 shrink-0"
            title="View violation history and audit logs"
          >
            <History size={14} className="text-amber-400" />
            <span>Violation History</span>
          </button>
        </div>
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
                  Real-Time Violation Alert
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-500 text-white">
                  {violations.length} wrongly parked {violations.length === 1 ? 'car' : 'cars'}
                </span>
              </div>
              <p className="text-xs text-red-100/90 mt-0.5">
                Camera AI detected violation: {violations.map((v) => `${v.detectedPlate || v.plate || 'Vehicle'} at slot ${v.slotCode || v.actualSlot}`).join(', ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedViolation(violations[0])}
              className="px-3.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-white text-xs font-black uppercase tracking-wider transition shadow"
            >
              Resolve Violation
            </button>
            <button
              type="button"
              onClick={handleResetAlerts}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-semibold transition"
            >
              Dismiss & Reset
            </button>
          </div>
        </div>
      )}

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
          aiSlotStatuses={aiSlotStatuses}
          loading={loading}
          isEditMode={isEditMode}
        />
      </div>

      {/* Slide-over panel for slots & zones */}
      <div 
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${selectedItem ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} 
        onClick={() => setSelectedItem(null)}
      />
      
      <div className={`absolute top-0 right-0 bottom-0 w-[420px] bg-[#111111]/95 backdrop-blur-2xl border-l border-white/10 p-6 flex flex-col shadow-[-20px_0_50px_rgba(0,0,0,0.5)] text-slate-200 z-50 transform transition-transform duration-300 ease-in-out ${selectedItem ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedItem && (() => {
           const isZone = selectedItem.type === 'zone';
           const slotLoad = slotLoads[selectedItem.floorId];
           const slotLoadStatus = slotLoad?.status || 'loading';
           const selectedBooking = activeBookings.find(booking => sameId(booking.floorId, selectedItem.floorId)
             && sameSlotCode(booking.parkingSlot, selectedItem.id)) || selectedItem.booking;
           const isHeld = activeHolds.some(hold => sameId(hold.floorId, selectedItem.floorId)
             && sameSlotCode(hold.slotCode, selectedItem.id) && new Date(hold.expiresAt) > new Date())
             || Boolean(selectedBooking);

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
           const currentSession = selectedSession;

          const aiObs = dbSlotInfo?.aiObservation;
          const isViolation = aiObs?.isViolation || selectedItem.isWrongSlot;

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
              {/* Drawer Header */}
              <div className="flex justify-between items-start mb-4 flex-shrink-0">
                <div>
                  <span className="text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] mb-1 block">
                    {isZone ? "Maintenance Zone" : `${selectedItem.type || 'Parking'} Slot`}
                  </span>
                  <h2 className="text-3xl font-extrabold text-white flex items-center gap-2">
                    {isZone ? "ZONE" : "SLOT"} <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">{isZone ? selectedItem.name : selectedItem.id}</span>
                  </h2>
                </div>
                <button 
                  onClick={() => setSelectedItem(null)} 
                  className="text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-700/50 w-8 h-8 rounded-full flex items-center justify-center transition-all border border-white/5 flex-shrink-0"
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </div>

              {/* Tabs for Individual Slot */}
              {!isZone && (
                <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setSlotTab('details')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider transition ${
                      slotTab === 'details'
                        ? 'bg-cyan-500 text-black shadow'
                        : 'text-slate-400 hover:text-white bg-white/5'
                    }`}
                  >
                    Details
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
                    <span>Slot History ({slotLogs.length})</span>
                  </button>
                </div>
              )}

              {/* Tab 1: Current Slot / Zone Details */}
              {(isZone || slotTab === 'details') && (
                <div className="mb-4 flex-1 overflow-y-auto pr-2 space-y-4">
                  {/* Violation Alert Box inside Slot Drawer */}
                  {!isZone && isViolation && (
                    <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-500/50 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-red-300">
                        <span className="flex items-center gap-1.5">
                          <ShieldAlert size={15} className="text-red-400 animate-pulse" />
                          WRONG-SLOT VIOLATION DETECTED!
                        </span>
                      </div>

                      {aiObs?.evidenceSnapshot && (
                        <div className="rounded-lg overflow-hidden border border-red-500/30 max-h-[140px] bg-black/60 flex items-center justify-center">
                          <img src={aiObs.evidenceSnapshot} alt="Evidence" className="w-full h-auto max-h-[140px] object-contain" />
                        </div>
                      )}

                      <div className="text-xs text-red-200">
                        {aiObs?.violationMessage || 'Vehicle parked in an unassigned or prohibited slot.'}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedViolation({
                            ...(aiObs || {}),
                            slotCode: selectedItem.id,
                            actualSlot: selectedItem.id,
                            detectedPlate: aiObs?.detectedPlate,
                          });
                        }}
                        className="w-full py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white font-extrabold text-xs uppercase tracking-wider transition shadow"
                      >
                        Resolve This Violation
                      </button>
                    </div>
                  )}

                  {/* Maintenance Toggle Button */}
                  {(dbSlotInfo || (isZone && zoneId)) && (!selectedItem.session) && (
                    <div className="mb-2">
                      <button 
                        onClick={handleToggleMaintenance}
                        className={`w-full py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${isMaintenance ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'}`}
                      >
                        {isMaintenance ? "End Maintenance" : "Start Maintenance"}
                      </button>
                    </div>
                  )}

                  {/* Zone Overview */}
                  {isZone && (
                    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-sm space-y-2">
                      <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-slate-400">Total Slots</span>
                        <span className="font-bold text-white">{zoneSlots.length}</span>
                      </div>
                      <div className="flex justify-between pt-1">
                        <span className="text-slate-400">Maintenance Slots</span>
                        <span className="font-bold text-red-400">{zoneSlots.filter(s => s.status === 'maintenance').length}</span>
                      </div>
                    </div>
                  )}

                {slotLoadStatus !== 'success' && (
                  <div role={slotLoadStatus === 'error' ? 'alert' : 'status'} className="mb-4 rounded-xl border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-xs text-slate-300 mb-3">
                      {slotLoadStatus === 'error' ? `Unable to load slot details: ${slotLoad.error}` : 'Loading slot details...'}
                      {dbSlotInfo && ' Showing the last loaded details.'}
                    </p>
                    {slotLoadStatus === 'error' && <button onClick={() => fetchDbSlots(selectedItem.floorId)} className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/20 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-500/30 transition">Retry loading slots</button>}
                  </div>
                )}

                {slotLoadStatus === 'success' && ((!isZone && !dbSlotInfo) || (isZone && !zoneId)) && (
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

                {!isZone && dbSlotInfo?.subscriptionDetail && (

                  <div className="flex flex-col gap-4">
                      <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 flex flex-col items-center justify-center mb-2">
                          <span className="text-xs text-purple-400 uppercase tracking-widest font-bold mb-1">Membership reservation</span>
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
                )}


                  {/* Slot Status Body */}
                  {!isZone && !dbSlotInfo ? null : isMaintenance ? (
                    <div className="flex flex-col gap-3 h-full items-center justify-center text-center py-8 opacity-90">
                      <div className="w-16 h-16 rounded-full bg-red-900/40 flex items-center justify-center border border-red-500/60 mb-2 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                        <span className="text-red-500 font-bold text-2xl">⚠</span>
                      </div>
                      
                      {(!isZone && dbSlotInfo?.maintenanceReason) ? (
                        <>
                          <h3 className="text-lg font-bold text-white max-w-[280px] break-words leading-relaxed">
                            {dbSlotInfo.maintenanceReason}
                          </h3>
                          <span className="bg-red-500/20 text-red-400 text-[10px] px-3 py-1 rounded-full border border-red-500/30 font-bold uppercase tracking-widest mt-1">
                            Under Maintenance
                          </span>
                        </>
                      ) : (
                        <>
                          <h3 className="text-lg font-bold text-white max-w-[280px] break-words leading-relaxed">
                            System Maintenance
                          </h3>
                          <span className="bg-red-500/20 text-red-400 text-[10px] px-3 py-1 rounded-full border border-red-500/30 font-bold uppercase tracking-widest mt-1">
                            Under Maintenance
                          </span>
                          <p className="text-xs text-slate-400 max-w-[250px] mt-2">
                            This {isZone ? "zone" : "slot"} is temporarily locked for maintenance.
                          </p>
                        </>
                      )}
                    </div>
                  ) : !isZone && currentSession ? (
                    <div className="flex flex-col gap-3">
                      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-3 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold mb-0.5">Status</span>
                        <span className="text-base text-white font-black uppercase">Occupied</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5">
                        <span className="text-slate-400 text-xs">License Plate</span>
                        <span className="font-mono text-sm font-bold text-white bg-slate-800/90 px-2.5 py-1 rounded border border-slate-700/60 tracking-wider">
                          {currentSession.licensePlate || 'Chưa nhận diện biển số'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5">
                        <span className="text-slate-400 text-xs">Phone Number</span>
                        {currentSession.phone || currentSession.userId?.phone ? (
                          <a
                            href={`tel:${currentSession.phone || currentSession.userId?.phone}`}
                            className="font-bold text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1.5 text-xs bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20 active:scale-95 transition"
                            title="Bấm để gọi trực tiếp"
                          >
                            <Phone size={12} className="text-emerald-400" />
                            <span>{currentSession.phone || currentSession.userId?.phone}</span>
                          </a>
                        ) : (
                          <span className="text-slate-500 italic text-xs">Khách vãng lai (Chưa có SĐT)</span>
                        )}
                      </div>
                      {currentSession.userId?.email && (
                        <div className="flex justify-between items-center pb-2 border-b border-white/5">
                          <span className="text-slate-400 text-xs">Email</span>
                          <span className="font-medium text-cyan-400">{currentSession.userId.email}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pb-2 border-b border-white/5">
                        <span className="text-slate-400 text-xs">Vehicle Type</span>
                        <span className="font-medium text-white uppercase">{currentSession.vehicleType || 'Car'}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-white/5">
                        <span className="text-slate-400 text-xs">Check-in Time</span>
                        <span className="font-medium text-white">{new Date(currentSession.checkInTime).toLocaleString('en-US')}</span>
                      </div>
                      <div className="flex justify-between items-center mt-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                        <span className="text-cyan-400 text-xs font-bold tracking-wide uppercase">Parked Duration</span>
                        <LiveDuration checkInTime={currentSession.checkInTime} expectedDurationHours={currentSession.expectedDurationHours} />
                      </div>
                    </div>
                  ) : !isZone && (aiObs?.occupied || dbSlotInfo?.status === 'occupied' || selectedItem.isOccupied) ? (
                    <div className="flex flex-col gap-3">
                      <div className="bg-rose-900/20 border border-rose-500/40 rounded-xl p-3 flex flex-col items-center justify-center text-center">
                        <span className="text-[10px] text-rose-400 uppercase tracking-widest font-bold mb-0.5">Status</span>
                        <span className="text-base text-white font-black uppercase">Occupied (AI Safe Lock)</span>
                        <span className="text-[11px] text-amber-300 font-semibold mt-1 flex items-center gap-1">
                          🛡️ Automatic anti-collision occupancy lock
                        </span>
                      </div>

                      {(aiObs?.detectedPlate || selectedItem.aiStatus?.detectedPlate || selectedItem.aiStatus?.plate) && (
                        <div className="flex justify-between items-center pb-2 border-b border-white/5">
                          <span className="text-slate-400 text-xs">Detected Plate</span>
                          <span className="font-mono text-sm font-semibold text-white bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/50">
                            {aiObs?.detectedPlate || selectedItem.aiStatus?.detectedPlate || selectedItem.aiStatus?.plate}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center pb-2 border-b border-white/5">
                        <span className="text-slate-400 text-xs">Reported By</span>
                        <span className="font-medium text-cyan-400 text-xs">AI Camera Surveillance</span>
                      </div>

                      {(aiObs?.lastSeenAt || aiObs?.detectedAt) && (
                        <div className="flex justify-between items-center pb-2 border-b border-white/5">
                          <span className="text-slate-400 text-xs">Detection Timestamp</span>
                          <span className="font-medium text-slate-300 text-xs">
                            {new Date(aiObs.lastSeenAt || aiObs.detectedAt).toLocaleString('en-US')}
                          </span>
                        </div>
                      )}

                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed">
                        💡 <strong>Safety Lock:</strong> Even if violation alerts are dismissed or unregistered vehicles occupy the slot, the system locks actual occupancy to prevent Kiosk or App from assigning this slot to others.
                      </div>
                    </div>
                  ) : !isZone && selectedItem.isReserved ? (
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
                              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                                <span className="text-slate-400 text-xs">Phone</span>
                                {dbSlotInfo.subscriptionDetail.user.phone ? (
                                  <a href={`tel:${dbSlotInfo.subscriptionDetail.user.phone}`} className="font-bold text-emerald-400 hover:underline flex items-center gap-1 text-xs">
                                    <Phone size={11} />
                                    <span>{dbSlotInfo.subscriptionDetail.user.phone}</span>
                                  </a>
                                ) : (
                                  <span className="font-medium text-slate-500">Chưa có SĐT</span>
                                )}
                              </div>
                            </>
                          )}
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Valid Until</span><span className="font-bold text-purple-400">{new Date(dbSlotInfo.subscriptionDetail.expireAt).toLocaleString('en-US')}</span></div>
                        </>
                      ) : (
                        <p className="text-xs text-purple-300 text-center mt-4">This slot is reserved for VIP subscriptions or scheduled bookings.</p>
                      )}
                    </div>
                  ) : !isZone && isHeld ? (
                    <div className="flex flex-col gap-3">
                      <div className={`border rounded-xl p-3 flex flex-col items-center justify-center ${selectedBooking?.status === 'CANCELLED' ? 'bg-red-900/20 border-red-500/30' : 'bg-orange-900/20 border-orange-500/30'}`}>
                        <span className={`text-[10px] uppercase tracking-widest font-bold mb-0.5 ${selectedBooking?.status === 'CANCELLED' ? 'text-red-400' : 'text-orange-400'}`}>Status</span>
                        <span className="text-base text-white font-black uppercase">{selectedBooking?.status === 'CANCELLED' ? 'Cancelled / Historical' : 'Holding / Booked'}</span>
                      </div>
                      {selectedBooking && (
                        <>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">Customer</span><span className="font-medium text-white">{selectedBooking.userId?.username || 'N/A'}</span></div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5">
                            <span className="text-slate-400 text-xs">Phone</span>
                            {selectedBooking.userId?.phone ? (
                              <a href={`tel:${selectedBooking.userId.phone}`} className="font-bold text-emerald-400 hover:underline flex items-center gap-1 text-xs">
                                <Phone size={11} />
                                <span>{selectedBooking.userId.phone}</span>
                              </a>
                            ) : (
                              <span className="font-medium text-slate-500">Chưa có SĐT</span>
                            )}
                          </div>
                          <div className="flex justify-between items-center pb-2 border-b border-white/5"><span className="text-slate-400 text-xs">License Plate</span><span className="font-mono text-sm font-semibold text-white">{selectedBooking.licensePlate || 'N/A'}</span></div>
                        </>
                      )}
                    </div>
                  ) : !isZone ? (
                    <div className="flex flex-col gap-4 h-full items-center justify-center text-center py-8 opacity-70">
                      <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 mb-2">
                        <MonitorCheck size={24} className="text-slate-500" />
                      </div>
                      <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Physically Empty</p>
                      <p className="text-xs text-slate-500 max-w-[200px]">{dbSlotInfo?.subscriptionDetail ? 'Physically empty. Membership reservation remains active.' : 'Ready for next incoming vehicle assignment.'}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Tab 2: Specific Slot History Timeline */}
              {!isZone && slotTab === 'history' && (
                <div className="mb-4 flex-1 overflow-y-auto pr-2 divide-y divide-white/5">
                  {loadingSlotLogs ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-amber-400" />
                      Loading slot logs...
                    </div>
                  ) : slotLogs.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No activity logs recorded for this slot yet.
                    </div>
                  ) : (
                    slotLogs.map((log) => {
                      const isViol = log.changeType === 'VIOLATION_DETECTED';
                      const isReassigned = log.changeType === 'SLOT_REASSIGNED';
                      const isMaintenance = log.changeType === 'MAINTENANCE' || log.changeType === 'MAINTENANCE_LOCKED' || log.changeType === 'MAINTENANCE_UNLOCKED';
                      const isCheckout = log.resolutionAction === 'CHECKOUT_RELEASED';
                      const isVehicleLeft = log.resolutionAction === 'VEHICLE_LEFT';
                      const isVehicleParked = log.resolutionAction === 'VEHICLE_PARKED';

                      let badgeText = 'Slot Activity';
                      let badgeClass = 'bg-slate-700/40 text-slate-300';
                      if (isViol) {
                        badgeText = 'Violation Detected';
                        badgeClass = 'bg-red-500/20 text-red-400 border border-red-500/30';
                      } else if (isMaintenance) {
                        badgeText = 'Maintenance';
                        badgeClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
                      } else if (isCheckout) {
                        badgeText = 'Checkout - Released';
                        badgeClass = 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30';
                      } else if (isVehicleLeft) {
                        badgeText = 'Vehicle Left - Empty';
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
                            <div className="flex items-center justify-between text-slate-200 font-mono font-bold">
                              <span>Biển số: {formatLicensePlateDisplay(log.detectedPlate)}</span>
                              {log.phone && (
                                <a
                                  href={`tel:${log.phone}`}
                                  className="text-emerald-400 font-sans text-[11px] font-normal hover:underline flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20"
                                  title="Gọi cho khách"
                                >
                                  <Phone size={10} />
                                  <span>{log.phone}</span>
                                </a>
                              )}
                            </div>
                          )}
                          {log.customerName && (
                            <div className="text-[11px] text-slate-400">
                              Khách hàng: <span className="text-slate-200 font-medium">{log.customerName}</span>
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

              {/* Action: Checkout vehicle button */}
              {!isZone && currentSession && (
                <div className="mt-auto flex-shrink-0 pt-4 pb-2">
                  <button 
                    onClick={() => handleTriggerCheckout(currentSession)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] py-3.5 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(255,213,85,0.18)] transition-all hover:bg-[#ffe58a] focus:outline-none focus:ring-2 focus:ring-[#ffd555]/30 active:scale-[0.98] text-xs"
                  >
                    <X size={16} />
                    Process Check-out
                  </button>
                </div>
              )}
            </>
          );
        })()}
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
                  placeholder="E.g., Slot cleaning, sensor repair, surface painting..."
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
                className="px-5 py-2.5 rounded-xl font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-xs"
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
                      toast.success("Maintenance activated successfully!");
                    } else {
                      alert("Failed to start maintenance: " + (res.data?.message || "Unknown error"));
                    }
                  } catch (e) {
                    console.error("Maintenance start failed", e);
                    alert("Network error while trying to start maintenance.");
                  }
                }}
                className="px-5 py-2.5 rounded-xl font-bold bg-red-500 hover:bg-red-600 text-white transition-colors shadow-[0_0_20px_rgba(239,68,68,0.3)] disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                Confirm Maintenance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff Checkout Modal */}
      {showCheckoutModal && (checkoutSessionData || selectedItem?.session) && (
        <StaffCheckoutModal 
          isOpen={showCheckoutModal}
          onClose={() => {
            setShowCheckoutModal(false);
            setCheckoutSessionData(null);
          }}
          session={checkoutSessionData || { ...selectedItem.session, parkingSlot: selectedItem.id }}
          onSuccess={() => {
            setShowCheckoutModal(false);
            setCheckoutSessionData(null);
            setSelectedItem(null);
            if (currentFloorId) {
              fetchLiveData();
              fetchDbSlots(currentFloorId);
            }
          }}
        />
      )}

      {/* Confirm Delete Floor Modal */}
      <ConfirmModal 
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, floorId: null, floorName: "" })}
        onConfirm={executeDeleteFloor}
        title="Delete Floor"
        message={`Are you sure you want to delete ${deleteModal.floorName}? This action cannot be undone.`}
        confirmText="Confirm Delete"
        cancelText="Cancel"
        isDestructive={true}
      />

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
            handleTriggerCheckout(sessionOrSlot);
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
            fetchLiveData();
            fetchDbSlots(currentFloorId);
            setFloorAiStatusesMap((prev) => {
              const updated = {};
              Object.entries(prev).forEach(([fId, slots]) => {
                updated[fId] = slots.filter((s) => s.slotCode !== selectedViolation.slotCode);
              });
              return updated;
            });
          }}
          onCheckout={(session) => {
            handleTriggerCheckout(session);
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
          fetchLiveData();
          fetchDbSlots(currentFloorId);
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

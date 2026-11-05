import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { getAllFloors, getFloorSlots } from '../../services/parkingFloorService';
import { getAllBookings } from '../../services/bookingService';
import { getAllSessions } from '../../services/sessionService';
import { getAdminPlatformRevenueStatistics } from '../../services/statisticsService';
import {
  buildStaffDashboardMetrics,
  buildStaffLotDiagnostics,
  getStaffDashboardOperationalStatus,
  getStaffDashboardSyncStatus,
  getStaffDashboardViewAvailability,
} from '../../utils/staffDashboardDiagnostics';
import {
  getOperationalViewState,
} from '../../utils/staffOperationalAvailability';
import toast, { Toaster } from 'react-hot-toast';
import StaffDashboardView from './components/StaffDashboardView.jsx';

const EMPTY_REVENUE_STATISTICS = Object.freeze({
  vip: { revenue: 0, transactionCount: 0 },
  booking: { revenue: 0, completedCount: 0 },
  service: { revenue: 0, completedBookingCount: 0 },
  totalRevenue: 0,
});

const normalizeRevenueStatistics = (statistics) => ({
  vip: {
    revenue: Number(statistics?.vip?.revenue || 0),
    transactionCount: Number(statistics?.vip?.transactionCount || 0),
  },
  booking: {
    revenue: Number(statistics?.booking?.revenue || 0),
    completedCount: Number(statistics?.booking?.completedCount || 0),
  },
  service: {
    revenue: Number(statistics?.service?.revenue || 0),
    completedBookingCount: Number(
      statistics?.service?.completedBookingCount || 0
    ),
  },
  totalRevenue: Number(statistics?.totalRevenue || 0),
});

const getSlotZoneKey = (slot) => {
  const slotLabel = String(slot?.name || slot?.id || '').trim();
  const firstCharacter = slotLabel.charAt(0).toUpperCase();

  return /^[A-Z]$/.test(firstCharacter) ? firstCharacter : 'OTHER';
};

const compareSlotLabels = (firstSlot, secondSlot) => {
  const firstLabel = firstSlot.name || firstSlot.id;
  const secondLabel = secondSlot.name || secondSlot.id;

  return firstLabel.localeCompare(secondLabel, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};

export default function StaffDashboard() {
  const navigate = useNavigate();
  const socket = useSocket();
  const [selectedGate, setSelectedGate] = useState('ENTRY_1'); // 'ENTRY_1' | 'EXIT_1'
  const [isTriggeringGate, setIsTriggeringGate] = useState(false);
  const [gatesState, setGatesState] = useState({
    ENTRY_1: { open: false, holdOpen: false, gate: 'ENTRY_1', licensePlate: '' },
    EXIT_1: { open: false, holdOpen: false, gate: 'EXIT_1', licensePlate: '' }
  });
  const [floors, setFloors] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [dbSlots, setDbSlots] = useState([]);
  const [revenueStatistics, setRevenueStatistics] = useState(
    EMPTY_REVENUE_STATISTICS
  );
  const [revenueError, setRevenueError] = useState('');
  const [syncStatus, setSyncStatus] = useState(() =>
    getStaffDashboardSyncStatus()
  );
  const [loading, setLoading] = useState(true);

  // Lắng nghe trạng thái độc lập của từng Barrier real-time từ Socket + Polling
  useEffect(() => {
    const fetchBarrierStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/iot/barrier-status`);
        const data = await res.json();
        if (data.success && data.gates) {
          setGatesState(prev => ({
            ...prev,
            ...data.gates
          }));
        }
      } catch {
        // bỏ qua lỗi mạng
      }
    };

    fetchBarrierStatus();
    const interval = setInterval(fetchBarrierStatus, 1000);

    const handleBarrierControl = (data) => {
      if (data && data.gate) {
        const normGate = (data.gate || 'ENTRY_1').toUpperCase();
        setGatesState(prev => ({
          ...prev,
          [normGate]: {
            ...(prev[normGate] || {}),
            ...data,
            open: Boolean(data.open),
            holdOpen: Boolean(data.holdOpen)
          }
        }));
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
  }, [socket]);

  const activeGateState = gatesState[selectedGate] || {
    open: false,
    holdOpen: false,
    gate: selectedGate,
    licensePlate: ''
  };
  const gateOpen = Boolean(activeGateState.open);
  const gateHold = Boolean(activeGateState.holdOpen);

  // Xử lý mở cổng Barrier độc lập theo cổng được chọn
  const handleOpenGate = async (gateType = selectedGate) => {
    setIsTriggeringGate(true);
    try {
      const fallbackPlate = gateType === 'ENTRY_1' ? 'STAFF-IN' : 'STAFF-OUT';
      const res = await fetch(`${API_BASE}/iot/open-barrier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || ''}` },
        body: JSON.stringify({
          gate: gateType,
          licensePlate: fallbackPlate,
          slotCode: 'STAFF'
        })
      });
      const data = await res.json();
      if (data.success) {
        setGatesState(prev => ({
          ...prev,
          [gateType]: {
            ...(prev[gateType] || {}),
            open: true,
            holdOpen: false,
            gate: gateType,
            licensePlate: fallbackPlate
          }
        }));
        const label = gateType === 'ENTRY_1' ? 'Entry Gate (IN)' : 'Exit Gate (OUT)';
        toast.success(`${label} opened successfully!`);
      } else {
        toast.error('Failed to trigger gate open!');
      }
    } catch {
      toast.error('IoT Barrier connection error!');
    } finally {
      setIsTriggeringGate(false);
    }
  };

  // Xử lý đóng cổng Barrier độc lập theo cổng được chọn
  const handleCloseGate = async (gateType = selectedGate) => {
    setIsTriggeringGate(true);
    try {
      const res = await fetch(`${API_BASE}/iot/close-barrier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || ''}` },
        body: JSON.stringify({ gate: gateType })
      });
      const data = await res.json();
      if (data.success) {
        setGatesState(prev => ({
          ...prev,
          [gateType]: {
            ...(prev[gateType] || {}),
            open: false,
            holdOpen: false
          }
        }));
        const label = gateType === 'ENTRY_1' ? 'Entry Gate (IN)' : 'Exit Gate (OUT)';
        toast.success(`${label} closed successfully!`);
      } else {
        toast.error('Failed to close gate!');
      }
    } catch {
      toast.error('IoT Barrier connection error!');
    } finally {
      setIsTriggeringGate(false);
    }
  };

  // Xử lý chế độ Tạm dừng Barrier độc lập theo cổng được chọn
  const handleToggleHoldGate = async (gateType = selectedGate) => {
    setIsTriggeringGate(true);
    const targetGate = gatesState[gateType] || {};
    const newHold = !targetGate.holdOpen;
    try {
      const res = await fetch(`${API_BASE}/iot/hold-barrier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || ''}` },
        body: JSON.stringify({ hold: newHold, gate: gateType })
      });
      const data = await res.json();
      if (data.success) {
        setGatesState(prev => ({
          ...prev,
          [gateType]: {
            ...(prev[gateType] || {}),
            holdOpen: newHold
          }
        }));
        const label = gateType === 'ENTRY_1' ? 'Entry Gate' : 'Exit Gate';
        if (newHold) {
          toast(`${label} Paused: IR sensor disabled & position locked!`);
        } else {
          toast.success(`${label} Resumed: Normal operation active!`);
        }
      }
    } catch {
      toast.error('IoT Barrier connection error!');
    } finally {
      setIsTriggeringGate(false);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      // Fetch floors and bookings
      const [floorsRes, bookingsRes, revenueRes] = await Promise.all([
        getAllFloors(),
        getAllBookings(), // Fetch all bookings to calculate today's cancelled/violations
        getAdminPlatformRevenueStatistics('all'),
      ]);
      
      const sessionsRes = await getAllSessions();

      const floorSourceSucceeded = Boolean(
        floorsRes.ok && floorsRes.data?.success
      );
      const bookingSourceSucceeded = Boolean(
        bookingsRes.ok && bookingsRes.data?.success
      );
      const sessionSourceSucceeded = Boolean(
        sessionsRes.ok && sessionsRes.data?.success
      );
      const revenueSourceSucceeded = Boolean(
        revenueRes.ok && revenueRes.data?.success
      );
      const fetchedFloors = floorSourceSucceeded
        ? (floorsRes.data.data || floorsRes.data.floors || [])
        : [];
      setFloors(fetchedFloors);

      let slotsOk = floorSourceSucceeded && fetchedFloors.length === 0;
      
      if (fetchedFloors.length > 0) {
        const promises = fetchedFloors.map(f => getFloorSlots(f._id));
        const results = await Promise.all(promises);
        slotsOk = results.every((result) => result.ok && result.data?.success);
        const allSlots = results.flatMap((result) =>
          result.ok && result.data?.success ? result.data.data : []
        );
        setDbSlots(allSlots);
      } else {
        setDbSlots([]);
      }

      setSyncStatus(getStaffDashboardSyncStatus({
        floors: floorSourceSucceeded,
        bookings: bookingSourceSucceeded,
        sessions: sessionSourceSucceeded,
        slotsOk,
        revenue: revenueSourceSucceeded,
      }));

      setBookings(bookingSourceSucceeded ? (bookingsRes.data.data || []) : []);
      setSessions(sessionSourceSucceeded ? (sessionsRes.data.data || []) : []);
      if (revenueSourceSucceeded) {
        setRevenueStatistics(normalizeRevenueStatistics(revenueRes.data.data));
        setRevenueError('');
      } else {
        setRevenueStatistics(EMPTY_REVENUE_STATISTICS);
        setRevenueError(
          revenueRes.data?.message || 'Revenue data could not be synchronized.'
        );
      }

    } catch {
      setFloors([]);
      setBookings([]);
      setSessions([]);
      setDbSlots([]);
      setSyncStatus(getStaffDashboardSyncStatus());
      setRevenueStatistics(EMPTY_REVENUE_STATISTICS);
      setRevenueError('Revenue data could not be synchronized.');
      toast.error('Failed to sync dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialFetch = setTimeout(fetchData, 0);
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchData]);

  const dashboardMetrics = useMemo(
    () => buildStaffDashboardMetrics({ floors, dbSlots, sessions, bookings }),
    [floors, dbSlots, sessions, bookings]
  );
  const {
    activeFloor,
    activeFloorSlots,
  } = dashboardMetrics;
  const viewAvailability = getStaffDashboardViewAvailability(
    syncStatus.sources
  );
  const operationalStatus = getStaffDashboardOperationalStatus(
    syncStatus.sources
  );
  const lotDiagnostics = buildStaffLotDiagnostics({
    metrics: dashboardMetrics,
    availability: operationalStatus,
  });
  const revenueState = getOperationalViewState({
    loading,
    error: revenueError || (!syncStatus.sources.revenue
      ? 'Revenue data could not be synchronized.'
      : ''),
  });

  const activeFloorZones = useMemo(() => {
    const slotsByZone = activeFloorSlots.reduce((zones, slot) => {
      const zoneKey = getSlotZoneKey(slot);

      if (!zones.has(zoneKey)) zones.set(zoneKey, []);
      zones.get(zoneKey).push(slot);

      return zones;
    }, new Map());

    return Array.from(slotsByZone.entries())
      .sort(([firstZone], [secondZone]) => {
        if (firstZone === 'OTHER') return 1;
        if (secondZone === 'OTHER') return -1;
        return firstZone.localeCompare(secondZone, undefined, { numeric: true });
      })
      .map(([zoneKey, slots]) => ({
        key: zoneKey,
        label: zoneKey === 'OTHER' ? 'Other slots' : `Zone ${zoneKey}`,
        slots: [...slots].sort(compareSlotLabels),
      }));
  }, [activeFloorSlots]);

  const getSlotData = (slotObj) => {
    const slotLabel = slotObj.name || slotObj.id;
    if (!activeFloor) return { status: 'EMPTY', isVip: false };
    
    // Check if slot is under maintenance
    const dbSlotInfo = dbSlots.find(s => s.slotNumber === slotLabel && s.floorID === activeFloor._id);
    
    // Determine VIP status from DB (subscription) or layout type
    const isLayoutVip = slotObj.type === 'slot_vip' || slotObj.type?.includes('vip');
    const isDbVip = dbSlotInfo && ['monthly', 'yearly'].includes(dbSlotInfo.subscriptionType);
    const isVip = isLayoutVip || isDbVip;

    if (dbSlotInfo && dbSlotInfo.status === 'maintenance') {
      return { status: 'MAINTENANCE', plate: null, isVip };
    }

    // Check sessions first (actual physical occupancy)
    const activeSession = sessions.find(s => 
      (s.status === 'active' || s.status === 'ACTIVE') && 
      s.parkingSlot === slotLabel &&
      (!s.floorId || s.floorId?._id === activeFloor._id || s.floorId === activeFloor._id)
    );

    if (activeSession) {
      return { status: 'OCCUPIED', plate: activeSession.licensePlate, isVip };
    }

    const booking = bookings.find(b => 
      b.parkingSlot === slotLabel && 
      (b.floorId?._id === activeFloor._id || b.floorId === activeFloor._id) &&
      ['ACTIVE', 'PENDING'].includes(b.status)
    );
    
    if (booking) {
      if (booking.status === 'ACTIVE') return { status: 'OCCUPIED', plate: booking.licensePlate, isVip };
      if (booking.status === 'PENDING') return { status: 'RESERVED', plate: booking.licensePlate, isVip };
    }
    
    return { status: 'EMPTY', isVip };
  };

  return (
    <>
      {!(loading && floors.length === 0) && <Toaster position="top-right" toastOptions={{
        style: { background: '#171D25', color: '#F8FAFC', border: '1px solid #29313A' }
      }} />}
      <StaffDashboardView
        loading={loading} floors={floors} metrics={dashboardMetrics}
        syncStatus={syncStatus} viewAvailability={viewAvailability}
        revenueState={revenueState} revenueStatistics={revenueStatistics}
        activeFloorZones={activeFloorZones} getSlotData={getSlotData}
        lotDiagnostics={lotDiagnostics} navigate={navigate}
        selectedGate={selectedGate} setSelectedGate={setSelectedGate}
        gateOpen={gateOpen} gateHold={gateHold} isTriggeringGate={isTriggeringGate}
        handleOpenGate={handleOpenGate} handleCloseGate={handleCloseGate}
        handleToggleHoldGate={handleToggleHoldGate}
      />
    </>
  );
}

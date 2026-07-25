import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import {
  MonitorCheck, Car, FileWarning, ClipboardList,
  TrendingUp, CheckCircle2, AlertTriangle, DoorOpen,
  ArrowRightCircle, QrCode, Activity, PlayCircle, Crown,
  CircleDollarSign, CalendarCheck2, Wrench
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  getOperationalValue,
  getOperationalViewState,
} from '../../utils/staffOperationalAvailability';
import toast, { Toaster } from 'react-hot-toast';
import { STAFF_THEME } from './components/staffTheme.js';

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

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

// ─── Stat Card ─────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, sub, color, hoverBorder }) => (
  <div className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111111] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition-all duration-300 ${hoverBorder}`}>
    {/* Subtle gradient background glow */}
    <div className={`absolute -inset-20 opacity-0 group-hover:opacity-10 transition-opacity duration-500 blur-3xl ${color}`} />
    
    <div className="relative z-10 flex min-w-0 items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${color} shadow-lg shadow-black/50 ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="whitespace-nowrap text-lg font-black leading-none tracking-tight text-white tabular-nums xl:text-xl 2xl:text-[17px]">
          {value}
        </p>
        <p className="mt-1 text-[10px] font-bold uppercase leading-4 tracking-[0.12em] text-gray-400">
          {label}
        </p>
      </div>
      <TrendingUp size={13} className="shrink-0 text-white/15 transition-colors group-hover:text-emerald-400/70" />
    </div>
    {sub && (
      <p className="relative z-10 mt-2 flex items-center gap-1 text-[10px] font-semibold leading-4 text-emerald-400/90">
        <Activity size={10} className="shrink-0" />
        <span>{sub}</span>
      </p>
    )}
  </div>
);

// ─── Slot status grid cell ─────────────────────────────────────────────────────
const SlotCell = ({ id, name, status, plate, isVip, onClick }) => {
  const cfg = {
    OCCUPIED: { 
      bg: 'bg-gradient-to-b from-gray-800 to-gray-900 border-gray-700/50', 
      text: 'text-gray-300', 
      badge: 'text-gray-400 bg-gray-800/80 border border-gray-600/50',
      glow: ''
    },
    EMPTY:    { 
      bg: 'bg-gradient-to-b from-emerald-900/35 to-[#0b0b0b] border-emerald-700/40',
      text: 'text-emerald-400', 
      badge: 'text-emerald-300 bg-emerald-900/60 border border-emerald-500/30',
      glow: 'shadow-[0_0_15px_rgba(16,185,129,0.1)]'
    },
    MAINTENANCE: {
      bg: 'bg-gradient-to-b from-red-900/25 to-[#0b0b0b] border-red-700/40',
      text: 'text-red-400',
      badge: 'text-red-300 bg-red-900/60 border border-red-500/30',
      glow: 'shadow-[0_0_15px_rgba(239,68,68,0.1)]'
    },
    RESERVED: { 
      bg: 'bg-gradient-to-b from-yellow-900/25 to-[#0b0b0b] border-yellow-700/40',
      text: 'text-yellow-400', 
      badge: 'text-yellow-300 bg-yellow-900/60 border border-yellow-500/30',
      glow: 'shadow-[0_0_15px_rgba(234,179,8,0.1)]'
    },
  }[status] || {};

  const hasName = name && name.trim().length > 0;
  const displayName = hasName ? name : 'Unnamed Slot';

  return (
    <div onClick={onClick} className={`rounded-xl border p-3 flex flex-col items-center justify-center gap-1.5 ${cfg.bg} ${cfg.glow} ${!hasName ? 'opacity-50 border-dashed bg-transparent shadow-none' : 'hover:-translate-y-1 hover:brightness-125 transition-all duration-300 cursor-pointer'} text-center h-[95px] w-full overflow-hidden relative group`}>
      {isVip && (
        <div className="absolute top-1.5 right-1.5 text-yellow-400 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all drop-shadow-[0_0_5px_rgba(250,204,21,0.5)]">
          <Crown size={12} strokeWidth={3} />
        </div>
      )}
      <span className={`text-xs font-black ${cfg.text} truncate w-full tracking-wide`} title={hasName ? name : id}>
        {displayName}
      </span>
      
      {!hasName ? (
        <span className="text-[9px] text-gray-500 font-mono truncate w-full px-1" title={id}>
          #{id.split('-').pop()}
        </span>
      ) : (
        plate && <span className="text-[10px] text-gray-400 font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5">{plate}</span>
      )}
      
      <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full ${cfg.badge} mt-auto shadow-sm`}>
        {status}
      </span>
    </div>
  );
};

// ─── Booking row ───────────────────────────────────────────────────────────────
const BookingRow = ({ id, plate, slot, time, status }) => (
  <div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.02] px-2 rounded-lg transition-colors cursor-pointer group">
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center shrink-0 border border-white/10 group-hover:scale-105 transition-transform">
      <Car size={15} className="text-gray-400 group-hover:text-white transition-colors" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-bold text-gray-200 font-mono tracking-wide">{plate}</p>
      <p className="text-[10px] text-gray-500 mt-0.5 font-medium">Booking {id} <span className="text-gray-700">•</span> Slot {slot}</p>
    </div>
    <div className="text-right shrink-0">
      <p className="text-[11px] text-gray-400 font-medium mb-1">{time}</p>
      <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider border ${
        status === 'ACTIVE'    ? 'bg-green-900/30 text-green-400 border-green-500/30'  :
        status === 'COMPLETED' ? 'bg-blue-900/30 text-blue-400 border-blue-500/30'    :
        status === 'PENDING'   ? 'bg-yellow-900/30 text-yellow-400 border-yellow-500/30':
                                 'bg-red-900/30 text-red-400 border-red-500/30'
      }`}>{status}</span>
    </div>
  </div>
);

// ─── Alert pill ────────────────────────────────────────────────────────────────
const AlertPill = ({ icon, text, time, level }) => (
  <div className={`flex items-start gap-3 p-3.5 rounded-xl border backdrop-blur-sm transition-all duration-300 hover:brightness-110 ${
    level === 'warn'  ? 'bg-yellow-500/10 border-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.05)]' :
    level === 'error' ? 'bg-red-500/10 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.05)]'       :
                        'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.05)]'
  }`}>
    <div className={`shrink-0 mt-0.5 p-1.5 rounded-lg ${
      level === 'warn' ? 'bg-yellow-500/20' : level === 'error' ? 'bg-red-500/20' : 'bg-emerald-500/20'
    }`}>{icon}</div>
    <div>
      <p className="text-[13px] text-gray-200 font-medium leading-snug">{text}</p>
      <p className="text-[10px] text-gray-500 mt-1 font-medium">{time}</p>
    </div>
  </div>
);

export default function StaffDashboard() {
  const navigate = useNavigate();
  const [gateOpen, setGateOpen] = useState(false);
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
    totalSlots,
    activeFloor,
    activeFloorSlots,
    vehiclesInside,
    cancellationsToday,
    recentBookings,
    occupancyRate,
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

  if (loading && floors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-white/40">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-sm font-medium animate-pulse tracking-wide">Syncing System Data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${STAFF_THEME.page} space-y-8 p-6 lg:p-8`}>
      <Toaster position="top-right" toastOptions={{
        style: { background: '#111111', color: '#fff', border: '1px solid rgba(255,213,85,0.18)' }
      }} />
      
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className={STAFF_THEME.title}>System Overview</h1>
          <p className={`text-sm mt-1.5 font-medium flex items-center gap-2 ${
            syncStatus.isAvailable ? 'text-emerald-400/80' : 'text-red-400/90'
          }`}>
            {syncStatus.isAvailable ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            ) : (
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            )}
            {syncStatus.isAvailable
              ? 'Real-time data synced'
              : `Operational sync unavailable: ${syncStatus.error}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-400 font-medium">{format(new Date(), 'EEEE, MMM dd, yyyy')}</p>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="space-y-4">
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className={STAFF_THEME.eyebrow}>
              System Statistics
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard
              icon={<MonitorCheck size={20} className="text-yellow-100" />}
              color="from-yellow-600/80 to-yellow-500/20"
              hoverBorder="hover:border-yellow-500/30"
              label="Managed Slots"
              value={viewAvailability.managedSlots ? totalSlots : '—'}
              sub={viewAvailability.managedSlots
                ? `${floors.length} active floors`
                : 'Data unavailable'}
            />
            <StatCard
              icon={<Car size={20} className="text-sky-100" />}
              color="from-sky-600/80 to-sky-500/20"
              hoverBorder="hover:border-sky-500/30"
              label="Vehicles Inside"
              value={viewAvailability.vehiclesInside ? vehiclesInside : '—'}
              sub={viewAvailability.occupancy
                ? `${occupancyRate}% occupancy`
                : 'Data unavailable'}
            />
            <StatCard
              icon={<FileWarning size={20} className="text-orange-100" />}
              color="from-orange-600/80 to-orange-500/20"
              hoverBorder="hover:border-orange-500/30"
              label="Cancellations"
              value={viewAvailability.cancellations ? cancellationsToday : '—'}
              sub={viewAvailability.cancellations
                ? 'Requires attention'
                : 'Data unavailable'}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className={STAFF_THEME.eyebrow}>
              Revenue Statistics
            </p>
            <p className={`text-[10px] font-semibold ${revenueError ? 'text-red-300/80' : 'text-emerald-400/60'}`}>
              {revenueState.isAvailable
                ? 'All-time realized revenue'
                : revenueState.error || 'Revenue data unavailable'}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Crown size={20} className="text-violet-100" />}
              color="from-violet-600/80 to-violet-500/20"
              hoverBorder="hover:border-violet-500/30"
              label="VIP Revenue"
              value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.vip.revenue))}
              sub={revenueState.isAvailable
                ? `${revenueStatistics.vip.transactionCount} paid transactions`
                : 'Data unavailable'}
            />
            <StatCard
              icon={<CalendarCheck2 size={20} className="text-emerald-100" />}
              color="from-emerald-600/80 to-emerald-500/20"
              hoverBorder="hover:border-emerald-500/30"
              label="Booking Revenue"
              value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.booking.revenue))}
              sub={revenueState.isAvailable
                ? `${revenueStatistics.booking.completedCount} completed bookings`
                : 'Data unavailable'}
            />
            <StatCard
              icon={<Wrench size={20} className="text-cyan-100" />}
              color="from-cyan-600/80 to-cyan-500/20"
              hoverBorder="hover:border-cyan-500/30"
              label="Service Revenue"
              value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.service.revenue))}
              sub={revenueState.isAvailable
                ? `${revenueStatistics.service.completedBookingCount} completed with services`
                : 'Data unavailable'}
            />
            <StatCard
              icon={<CircleDollarSign size={20} className="text-amber-100" />}
              color="from-amber-600/80 to-amber-500/20"
              hoverBorder="hover:border-amber-500/30"
              label="Platform Revenue"
              value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.totalRevenue))}
              sub={revenueState.isAvailable ? 'VIP + booking + services' : 'Data unavailable'}
            />
          </div>
        </section>
      </div>

      {/* ── Mid row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Live Grid */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111111] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)] lg:col-span-2">
          {/* Decorative background glow */}
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 relative z-10">
            <div>
              <h3 className="text-white font-extrabold text-lg flex items-center gap-2">
                Live Grid <span className="text-gray-500 font-normal">—</span> <span className="text-[#ffd555]">{activeFloor ? activeFloor.name : 'Loading...'}</span>
              </h3>
              <p className="text-gray-400 text-xs mt-1 font-medium tracking-wide uppercase">Real-time slot telemetry</p>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-inner ${
              viewAvailability.liveGrid
                ? 'bg-black/40 border-white/5'
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              {viewAvailability.liveGrid ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              ) : (
                <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
              )}
              <span className={`text-[11px] font-bold uppercase tracking-widest ${
                viewAvailability.liveGrid ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {viewAvailability.liveGrid ? 'Live Sync' : 'Data unavailable'}
              </span>
            </div>
          </div>
          
          {!viewAvailability.liveGrid && (
            <div className="relative z-10 flex flex-col items-center justify-center py-20 text-center">
              <AlertTriangle size={48} className="mb-4 text-red-400" />
              <p className="font-medium text-red-200">Live grid data unavailable.</p>
              <p className="mt-1 text-xs text-red-300/70">
                Floor, slot, session, or booking data could not be synchronized.
              </p>
            </div>
          )}

          <div className={`${viewAvailability.liveGrid ? 'max-h-[450px] overflow-y-auto pb-4' : 'hidden'} scrollbar-hidden relative z-10`}>
            {activeFloorZones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 opacity-50">
                <MonitorCheck size={48} className="text-gray-600 mb-4" />
                <p className="text-white font-medium">No slot layout found on this floor.</p>
              </div>
            ) : (
              <div className="space-y-7">
                {activeFloorZones.map(zone => (
                  <section key={zone.key} aria-labelledby={`dashboard-zone-${zone.key}`}>
                    <div className="mb-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-emerald-400/25" />
                      <h4
                        id={`dashboard-zone-${zone.key}`}
                        className="shrink-0 text-xs font-black uppercase tracking-[0.2em] text-[#d7b94a]"
                      >
                        {zone.label}
                      </h4>
                      <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
                        {zone.slots.length} slots
                      </span>
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-emerald-400/25" />
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                      {zone.slots.map(slotObj => {
                        const data = getSlotData(slotObj);
                        return (
                          <SlotCell
                            key={slotObj.id}
                            id={slotObj.id}
                            name={slotObj.name}
                            status={data.status}
                            plate={data.plate}
                            isVip={data.isVip}
                            onClick={() => navigate('/staff/live-grid')}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className={`${viewAvailability.liveGrid ? 'flex' : 'hidden'} items-center gap-6 mt-2 pt-4 border-t border-white/10 relative z-10`}>
            {[
              { color: 'bg-gray-500 shadow-[0_0_8px_rgba(107,114,128,0.5)]', label: 'Occupied' },
              { color: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]', label: 'Empty' },
              { color: 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]', label: 'Reserved' },
              { color: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]', label: 'Maintenance' },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                <span className="text-xs font-bold text-gray-400 tracking-wide uppercase">{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gate Control Panel */}
        <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111111] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="absolute -top-40 -left-40 w-80 h-80 bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />
          
          <h3 className="text-white font-extrabold text-lg relative z-10">Gate & Actions</h3>

          {/* Open Gate Manually */}
          <div className={`mt-2 rounded-2xl border p-5 flex flex-col items-center gap-4 transition-all duration-500 relative z-10 overflow-hidden ${
            gateOpen ? 'bg-emerald-900/40 border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.15)]' : 'bg-black/40 border-white/10'
          }`}>
            <div className={`absolute inset-0 bg-gradient-to-t from-emerald-500/10 to-transparent opacity-0 transition-opacity duration-500 ${gateOpen ? 'opacity-100' : ''}`} />
            
            <DoorOpen size={36} className={`transition-all duration-500 relative z-10 ${gateOpen ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'text-gray-500'}`} />
            <p className="text-xs text-gray-400 text-center font-bold tracking-widest uppercase relative z-10">Gate A-01</p>
            
            <button
              onClick={() => setGateOpen((o) => !o)}
              className={`w-full py-3 rounded-xl text-sm font-black tracking-wide transition-all duration-300 relative z-10 shadow-lg ${
                gateOpen
                  ? 'bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(52,211,153,0.4)]'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {gateOpen ? <><PlayCircle size={16}/> GATE OPEN</> : 'OPEN GATE MANUALLY'}
              </div>
            </button>
            
            {gateOpen && (
              <p className="text-[10px] text-emerald-400 text-center animate-pulse font-bold tracking-widest uppercase relative z-10">
                Auto-closing in 30s...
              </p>
            )}
          </div>

          <div className="space-y-3 mt-2 relative z-10">
            {/* Process Vehicle Exit */}
            <button className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 hover:border-sky-500/40 hover:shadow-[0_0_15px_rgba(14,165,233,0.15)] transition-all duration-300 text-left group">
              <div className="p-2 rounded-xl bg-sky-500/20 group-hover:scale-110 transition-transform">
                <ArrowRightCircle size={18} className="text-sky-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-sky-100 tracking-wide">Process Exit</p>
                <p className="text-[11px] text-sky-400/60 font-medium mt-0.5">Confirm payment & exit</p>
              </div>
            </button>

            {/* Scan QR Check-out */}
            <button className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/20 hover:border-yellow-500/40 hover:shadow-[0_0_15px_rgba(234,179,8,0.15)] transition-all duration-300 text-left group">
              <div className="p-2 rounded-xl bg-yellow-500/20 group-hover:scale-110 transition-transform">
                <QrCode size={18} className="text-yellow-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-yellow-100 tracking-wide">Scan QR Code</p>
                <p className="text-[11px] text-yellow-400/60 font-medium mt-0.5">Manual fallback checkout</p>
              </div>
            </button>

            {/* Update Slot Status */}
            <button className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 text-left group">
              <div className="p-2 rounded-xl bg-white/10 group-hover:scale-110 transition-transform">
                <ClipboardList size={18} className="text-gray-300" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-200 tracking-wide">Update Slot</p>
                <p className="text-[11px] text-gray-500 font-medium mt-0.5">Mark maintenance issues</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">

        {/* Recent Bookings */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111111] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between mb-5 relative z-10">
            <h3 className="text-white font-extrabold text-lg">Activity Stream</h3>
            <span className="text-[11px] text-emerald-400 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-colors uppercase tracking-wider">
              View All
            </span>
          </div>
          <div className="space-y-2 relative z-10 bg-black/20 p-2 rounded-2xl border border-white/5">
            {!viewAvailability.activityStream ? (
              <div className="py-8 flex flex-col items-center text-center">
                <AlertTriangle size={32} className="text-red-400 mb-2" />
                <p className="text-red-200 font-medium">Activity data unavailable.</p>
                <p className="text-xs text-red-300/70 mt-1">Booking records could not be synchronized.</p>
              </div>
            ) : recentBookings.length === 0 ? (
              <div className="py-8 flex flex-col items-center opacity-50">
                <Activity size={32} className="text-gray-500 mb-2" />
                <p className="text-white font-medium">No activities today.</p>
              </div>
            ) : (
              recentBookings.map(b => (
                <BookingRow 
                  key={b._id} 
                  id={`#B-${b._id.slice(-4).toUpperCase()}`} 
                  plate={b.licensePlate} 
                  slot={b.parkingSlot} 
                  time={format(new Date(b.createdAt || b.scheduledStart), 'HH:mm')} 
                  status={b.status} 
                />
              ))
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111111] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-red-500/5 rounded-full blur-[100px] pointer-events-none" />
          
          <h3 className="text-white font-extrabold text-lg mb-5 relative z-10">Lot Diagnostics</h3>
          <div className="space-y-3 relative z-10">
            {lotDiagnostics.map((diagnostic) => (
              <AlertPill
                key={diagnostic.key}
                icon={diagnostic.key === 'maintenance'
                  ? <Wrench size={16} className="text-orange-400" />
                  : diagnostic.key === 'cancellations'
                    ? <FileWarning size={16} className="text-orange-400" />
                    : diagnostic.level === 'ok'
                      ? <CheckCircle2 size={16} className="text-emerald-400" />
                      : <AlertTriangle size={16} className={diagnostic.level === 'error' ? 'text-red-400' : 'text-yellow-400'} />}
                text={diagnostic.text}
                time={diagnostic.time}
                level={diagnostic.level}
              />
            ))}

            <AlertPill
              icon={<CheckCircle2 size={16} className="text-emerald-400" />}
              text="Gate A-01 sensors and cameras operating normally."
              time="System verified" level="ok"
            />
          </div>
        </div>
      </div>

    </div>
  );
}

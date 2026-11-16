import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  History,
  RefreshCw,
  Eye,
  RotateCw,
  RotateCcw,
  Phone,
  ShieldAlert,
  Maximize2,
  Search,
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  Check,
  ChevronDown,
  CheckCircle2,
  Camera,
  Layers,
  Filter,
  Info,
  AlertTriangle,
  Sparkles,
  Navigation,
  CheckCheck
} from 'lucide-react';
import {
  getViolationLogs,
  getViolationLogEvidence,
  resolveViolation,
  clearAllViolationsApi,
} from '../../../services/aiSurveillanceService';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';
import toast from 'react-hot-toast';

const PAGE_SIZE = 30;

export default function GlobalViolationHistoryModal({
  isOpen,
  onClose,
  floors = [],
  currentFloorId,
  onViolationResolved
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [serverEmptySlotPendingCount, setServerEmptySlotPendingCount] = useState(0);

  const [selectedLog, setSelectedLog] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Lazy-loaded evidence state & in-memory cache
  const evidenceCacheRef = useRef(new Map());
  const listAbortRef = useRef(null);
  const evidenceAbortRef = useRef(null);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);

  // Custom Time Filter States (defaults to Today's violations for shift clarity)
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const [timeFilter, setTimeFilter] = useState('today'); // 'today' | 'all' | 'yesterday' | 'week' | 'month' | 'single' | 'range'
  const [singleDate, setSingleDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const timeDropdownRef = useRef(null);

  // Custom Floor Filter States
  const [floorDropdownOpen, setFloorDropdownOpen] = useState(false);
  const [floorFilter, setFloorFilter] = useState(currentFloorId || '');
  const floorDropdownRef = useRef(null);

  // Custom Status Filter States
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const statusDropdownRef = useRef(null);

  const [viewFullImage, setViewFullImage] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Close all dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(event.target)) {
        setTimeDropdownOpen(false);
      }
      if (floorDropdownRef.current && !floorDropdownRef.current.contains(event.target)) {
        setFloorDropdownOpen(false);
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounce server-side search so typing remains 0ms responsive while still querying full history
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const buildQueryParams = useCallback(
    (targetPage = 1) => {
      const params = {
        floorId: floorFilter || undefined,
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page: targetPage,
        limit: PAGE_SIZE,
      };
      if (['today', 'yesterday', 'week', 'month'].includes(timeFilter)) {
        params.quickRange = timeFilter;
      } else if (timeFilter === 'single' && singleDate) {
        params.date = singleDate;
      } else if (timeFilter === 'range') {
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
      }
      return params;
    },
    [floorFilter, statusFilter, debouncedSearch, timeFilter, singleDate, startDate, endDate]
  );

  // Fetch paginated lightweight metadata logs from backend (snapshots lazy-loaded on demand)
  const fetchLogs = useCallback(
    async ({ targetPage = 1, append = false, clearCache = false } = {}) => {
      if (clearCache) {
        evidenceCacheRef.current.clear();
      }

      if (listAbortRef.current) {
        listAbortRef.current.abort();
      }
      const controller = new AbortController();
      listAbortRef.current = controller;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setLoadError(null);
      }

      try {
        const res = await getViolationLogs(buildQueryParams(targetPage), {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        if (res.success) {
          const incoming = res.data || [];
          setLogs((prev) => {
            if (!append) return incoming;
            const seenIds = new Set(prev.map((item) => item._id));
            return [...prev, ...incoming.filter((item) => !seenIds.has(item._id))];
          });
          setPage(res.page || targetPage);
          setTotalRecords(typeof res.total === 'number' ? res.total : incoming.length);
          setHasMore(Boolean(res.hasMore));
          if (typeof res.emptySlotPendingCount === 'number') {
            setServerEmptySlotPendingCount(res.emptySlotPendingCount);
          }
          setLoadError(null);
        } else {
          const errMsg = res.message || 'Unable to load violation logs';
          setLoadError(errMsg);
          toast.error(errMsg);
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load violation logs:', err);
        const errMsg = err?.message || 'Unable to load violation logs';
        setLoadError(errMsg);
        toast.error('Unable to load violation logs');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildQueryParams]
  );

  useEffect(() => {
    if (!isOpen) {
      if (listAbortRef.current) listAbortRef.current.abort();
      if (evidenceAbortRef.current) evidenceAbortRef.current.abort();
      setTimeFilter('today');
      setSingleDate('');
      setStartDate('');
      setEndDate('');
      return;
    }
    fetchLogs({ targetPage: 1, append: false });
    return () => {
      if (listAbortRef.current) listAbortRef.current.abort();
    };
  }, [isOpen, fetchLogs]);

  // Lazy-load evidenceSnapshot & fullSnapshot ONLY for the currently selected log
  useEffect(() => {
    if (!isOpen || !selectedLog?._id) {
      setSelectedEvidence(null);
      setEvidenceLoading(false);
      setEvidenceError(false);
      return;
    }

    const logId = selectedLog._id;
    const cached = evidenceCacheRef.current.get(logId);
    if (cached) {
      setSelectedEvidence(cached);
      setEvidenceLoading(false);
      setEvidenceError(false);
      return;
    }

    // If log somehow already includes snapshot URLs/data, cache & show immediately
    if (selectedLog.evidenceSnapshot || selectedLog.fullSnapshot) {
      const direct = {
        evidenceSnapshot: selectedLog.evidenceSnapshot || null,
        fullSnapshot: selectedLog.fullSnapshot || null,
      };
      evidenceCacheRef.current.set(logId, direct);
      setSelectedEvidence(direct);
      setEvidenceLoading(false);
      setEvidenceError(false);
      return;
    }

    if (evidenceAbortRef.current) {
      evidenceAbortRef.current.abort();
    }
    const controller = new AbortController();
    evidenceAbortRef.current = controller;

    setSelectedEvidence(null);
    setEvidenceLoading(true);
    setEvidenceError(false);

    getViolationLogEvidence(logId, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.data) {
          const payload = {
            evidenceSnapshot: res.data.evidenceSnapshot || null,
            fullSnapshot: res.data.fullSnapshot || null,
          };
          const hasAnySnapshot = Boolean(payload.evidenceSnapshot || payload.fullSnapshot);
          const isOldRecord =
            selectedLog.createdAt &&
            Date.now() - new Date(selectedLog.createdAt).getTime() > 15000;
          if (hasAnySnapshot || isOldRecord) {
            evidenceCacheRef.current.set(logId, payload);
          }
          setSelectedEvidence(payload);
        } else {
          setEvidenceError(true);
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setEvidenceError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setEvidenceLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [isOpen, selectedLog?._id]);

  // Instant Client-side Filter (0ms latency on typing E9, e9, 99C, date range, etc.)
  const filteredLogs = useMemo(() => {
    let result = logs;
    const term = searchTerm.trim().toLowerCase();

    if (term) {
      const cleanTerm = term.replace(/[-.\s]/g, '');
      result = result.filter((l) => {
        const slot = (l.slotCode || '').toLowerCase();
        const rawPlate = (l.detectedPlate || '').toLowerCase();
        const cleanPlate = rawPlate.replace(/[-.\s]/g, '');
        const expSlot = (l.expectedSlot || '').toLowerCase();
        const expPlate = (l.expectedPlate || '').toLowerCase().replace(/[-.\s]/g, '');
        const resolver = (l.resolverName || '').toLowerCase();
        const msg = (l.violationMessage || '').toLowerCase();
        const note = (l.resolutionNote || '').toLowerCase();

        return (
          slot.includes(term) ||
          rawPlate.includes(term) ||
          cleanPlate.includes(cleanTerm) ||
          expSlot.includes(term) ||
          expPlate.includes(cleanTerm) ||
          resolver.includes(term) ||
          msg.includes(term) ||
          note.includes(term)
        );
      });
    }

    if (floorFilter) {
      result = result.filter((l) => (l.floorId?._id || l.floorId) === floorFilter);
    }

    if (statusFilter) {
      if (statusFilter === 'ACTIVE_OCCUPIED') {
        result = result.filter((l) => l.status === 'PENDING' && !l.isVehicleGone && !l.isSlotEmpty);
      } else if (statusFilter === 'SELF_CORRECTED') {
        result = result.filter((l) => l.resolutionAction === 'SELF_CORRECTED' || l.vehicleCurrentStatus?.status === 'SELF_CORRECTED' || l.isNowInCorrectSlot);
      } else if (statusFilter === 'EMPTY_MOVED') {
        result = result.filter((l) => l.status === 'PENDING' && (l.isVehicleGone || l.isSlotEmpty));
      } else {
        result = result.filter((l) => l.status === statusFilter);
      }
    }

    if (timeFilter !== 'all') {
      const now = new Date();
      result = result.filter((l) => {
        const d = new Date(l.createdAt);
        if (timeFilter === 'today') {
          return (
            d.getDate() === now.getDate() &&
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
          );
        }
        if (timeFilter === 'yesterday') {
          const y = new Date(now);
          y.setDate(y.getDate() - 1);
          return (
            d.getDate() === y.getDate() &&
            d.getMonth() === y.getMonth() &&
            d.getFullYear() === y.getFullYear()
          );
        }
        if (timeFilter === 'week') {
          const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return d >= past7;
        }
        if (timeFilter === 'month') {
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        if (timeFilter === 'single' && singleDate) {
          const logYear = d.getFullYear();
          const logMonth = String(d.getMonth() + 1).padStart(2, '0');
          const logDay = String(d.getDate()).padStart(2, '0');
          const logDateStr = `${logYear}-${logMonth}-${logDay}`;
          return logDateStr === singleDate;
        }
        if (timeFilter === 'range') {
          const logYear = d.getFullYear();
          const logMonth = String(d.getMonth() + 1).padStart(2, '0');
          const logDay = String(d.getDate()).padStart(2, '0');
          const logDateStr = `${logYear}-${logMonth}-${logDay}`;
          if (startDate && logDateStr < startDate) return false;
          if (endDate && logDateStr > endDate) return false;
          return true;
        }
        return true;
      });
    }

    return result;
  }, [logs, searchTerm, floorFilter, statusFilter, timeFilter, singleDate, startDate, endDate]);

  // Keep selected item synced with filtered results
  useEffect(() => {
    if (filteredLogs.length > 0) {
      setSelectedLog((prev) => {
        if (!prev) return filteredLogs[0];
        const stillInList = filteredLogs.find((l) => l._id === prev._id);
        return stillInList || filteredLogs[0];
      });
    } else {
      setSelectedLog(null);
    }
  }, [filteredLogs]);

  const isTodayView = timeFilter === 'today' && !singleDate && !startDate && !endDate;
  const isCustomDateFilter = !['today', 'all'].includes(timeFilter);

  const hasActiveFilter = Boolean(
    searchTerm ||
    (floorFilter && floorFilter !== currentFloorId) ||
    statusFilter ||
    timeFilter !== 'today' ||
    singleDate ||
    startDate ||
    endDate
  );

  const handleResetFilters = () => {
    setSearchTerm('');
    setFloorFilter(currentFloorId || '');
    setStatusFilter('');
    setTimeFilter('today');
    setSingleDate('');
    setStartDate('');
    setEndDate('');
  };

  const handleSwitchToToday = () => {
    setTimeFilter('today');
    setSingleDate('');
    setStartDate('');
    setEndDate('');
    setTimeDropdownOpen(false);
  };

  const handleSwitchToHistory = () => {
    setTimeFilter('all');
    setSingleDate('');
    setStartDate('');
    setEndDate('');
    setTimeDropdownOpen(false);
  };

  const getTimeLabel = () => {
    switch (timeFilter) {
      case 'today':
      case 'all':
        return 'Filter Date';
      case 'yesterday':
        return 'Yesterday';
      case 'week':
        return 'Last 7 Days';
      case 'month':
        return 'This Month';
      case 'single':
        return singleDate ? new Date(singleDate + 'T00:00:00').toLocaleDateString('en-US') : 'Specific Date';
      case 'range':
        if (startDate && endDate) {
          return `${new Date(startDate + 'T00:00:00').toLocaleDateString('en-US')} - ${new Date(endDate + 'T00:00:00').toLocaleDateString('en-US')}`;
        }
        if (startDate) return `From ${new Date(startDate + 'T00:00:00').toLocaleDateString('en-US')}`;
        if (endDate) return `To ${new Date(endDate + 'T00:00:00').toLocaleDateString('en-US')}`;
        return 'Date Range';
      default:
        return 'Filter Date';
    }
  };

  const getFloorLabel = () => {
    if (!floorFilter) return 'All Floors';
    const found = floors.find((f) => f._id === floorFilter);
    return found ? (found.name || `Floor ${found.floorNumber}`) : 'All Floors';
  };

  const getStatusLabel = () => {
    switch (statusFilter) {
      case 'PENDING':
        return 'All Pending';
      case 'ACTIVE_OCCUPIED':
        return '🔴 Occupied';
      case 'SELF_CORRECTED':
        return '🟢 Self-Corrected';
      case 'EMPTY_MOVED':
        return '⚪ Vehicle Left';
      case 'RESOLVED':
        return 'Resolved';
      case 'DISMISSED':
        return 'Dismissed';
      default:
        return 'All Statuses';
    }
  };

  const handleReassign = async (log) => {
    if (!log) return;
    setActionLoading(true);
    try {
      const res = await resolveViolation({
        logId: log._id,
        slotCode: log.slotCode,
        floorId: log.floorId?._id || log.floorId,
        action: 'REASSIGN_SLOT',
        newSlotCode: log.slotCode,
        sessionId: log.sessionId?._id || log.sessionId,
        note: `Staff reassigned parking slot to ${log.slotCode} from violation logs`,
      });

      if (res.success) {
        toast.success(res.message || 'Violation resolved successfully!');
        fetchLogs({ targetPage: 1, append: false, clearCache: true });
        if (onViolationResolved) onViolationResolved(log.slotCode, log.expectedSlot);
      } else {
        toast.error(res.message || 'Failed to resolve violation');
      }
    } catch (err) {
      toast.error(err.message || 'Connection error while resolving violation');
    } finally {
      setActionLoading(false);
    }
  };

  const emptySlotPendingCount = useMemo(() => {
    const localCount = logs.filter(l => l.status === 'PENDING' && (l.isSlotEmpty || l.isVehicleGone)).length;
    return Math.max(serverEmptySlotPendingCount, localCount);
  }, [logs, serverEmptySlotPendingCount]);

  const handleDismissOrWarning = async (log, actionType) => {
    if (!log) return;
    setActionLoading(true);
    try {
      let defaultNote = '';
      if (actionType === 'SELF_CORRECTED') {
        const correctSlot = log.vehicleCurrentStatus?.slotNumber || log.expectedSlot || '';
        defaultNote = `Confirmed driver self-corrected and moved to assigned slot${correctSlot ? ` (${correctSlot})` : ''}`;
      } else if (actionType === 'DISMISS') {
        defaultNote = 'Violation alert dismissed by staff';
      } else {
        defaultNote = 'Staff contacted driver / issued warning to move vehicle';
      }

      const res = await resolveViolation({
        logId: log._id,
        slotCode: log.slotCode,
        floorId: log.floorId?._id || log.floorId,
        action: actionType,
        note: defaultNote,
      });

      if (res.success) {
        toast.success(res.message || 'Violation status updated!');
        fetchLogs({ targetPage: 1, append: false, clearCache: true });
        if (onViolationResolved) onViolationResolved(log.slotCode);
      } else {
        toast.error(res.message || 'Action failed');
      }
    } catch (err) {
      toast.error(err.message || 'Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismissEmptySlots = async () => {
    if (!window.confirm(`Close ${emptySlotPendingCount} pending violation alerts where the vehicle has already left the slot?`)) return;
    setActionLoading(true);
    try {
      const res = await resolveViolation({
        action: 'DISMISS_EMPTY_SLOTS',
      });
      if (res.success) {
        toast.success(res.message || 'Cleared empty-slot violation alerts!');
        fetchLogs({ targetPage: 1, append: false, clearCache: true });
        if (onViolationResolved) onViolationResolved(null);
      } else {
        toast.error(res.message || 'Unable to clear empty-slot alerts');
      }
    } catch (err) {
      toast.error(err.message || 'Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to clear/reset all violation alerts to start a fresh inspection?')) return;
    setActionLoading(true);
    try {
      const res = await clearAllViolationsApi(floorFilter || null);
      if (res.success) {
        toast.success(res.message || 'All violation alerts have been reset!');
        fetchLogs({ targetPage: 1, append: false, clearCache: true });
        if (onViolationResolved) onViolationResolved(null);
      } else {
        toast.error(res.message || 'Unable to reset alerts');
      }
    } catch (err) {
      toast.error(err.message || 'Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchLogs({ targetPage: 1, append: false, clearCache: true });
  };

  const handleLoadMore = () => {
    if (!hasMore || loadingMore || loading) return;
    fetchLogs({ targetPage: page + 1, append: true });
  };

  if (!isOpen) return null;

  const displayEvidenceUrl = selectedEvidence?.evidenceSnapshot || selectedLog?.evidenceSnapshot || null;
  const displayFullUrl = selectedEvidence?.fullSnapshot || selectedLog?.fullSnapshot || null;
  const remainingCount = Math.max(0, totalRecords - logs.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[85vh] bg-[#10141d] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans">

        {/* Header - Minimalist & Focused */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#141a26]/90 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500/20 to-amber-500/20 border border-red-500/30 text-amber-400">
              <History size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide text-white flex items-center gap-2">
                PARKING VIOLATION LOGS
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold">
                  {filteredLogs.length} / {totalRecords || logs.length} records
                </span>
              </h2>
              <p className="text-xs text-slate-400">Monitor camera snapshots, vehicle matching, and violation audit logs</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {emptySlotPendingCount > 0 && (
              <button
                onClick={handleDismissEmptySlots}
                disabled={actionLoading}
                className="p-2 px-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 hover:text-white transition flex items-center gap-1.5 text-xs font-semibold cursor-pointer animate-in fade-in"
                title="Close all pending alerts where AI confirms the slot is now empty"
              >
                <CheckCheck size={14} className={actionLoading ? 'animate-spin' : ''} />
                <span>Clear {emptySlotPendingCount} Empty</span>
              </button>
            )}
            <button
              onClick={handleClearAll}
              disabled={actionLoading}
              className="p-2 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 hover:text-white transition flex items-center gap-1.5 text-xs font-semibold"
              title="Clear/reset all violation alerts to start a fresh check"
            >
              <RotateCcw size={14} className={actionLoading ? 'animate-spin' : ''} />
              <span>Reset Alerts</span>
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition flex items-center gap-1.5 text-xs font-semibold"
              title="Refresh list"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Unified, Streamlined Filter Bar: Today/History Switcher + Search + Date/Floor/Status */}
        <div className="px-5 py-2.5 border-b border-white/10 bg-[#121620] flex items-center justify-between gap-2 flex-wrap lg:flex-nowrap flex-shrink-0">

          {/* Quick View Switcher: Today (Default) vs Full History */}
          <div className="inline-flex items-center p-0.5 rounded-xl bg-black/50 border border-white/15 shrink-0">
            <button
              type="button"
              onClick={handleSwitchToToday}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${isTodayView
                  ? 'bg-amber-400 text-black shadow-sm'
                  : 'text-slate-300 hover:text-white'
                }`}
            >
              <Clock size={12} />
              <span>Today</span>
            </button>
            <button
              type="button"
              onClick={handleSwitchToHistory}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${!isTodayView
                  ? 'bg-amber-400 text-black shadow-sm'
                  : 'text-slate-300 hover:text-white'
                }`}
            >
              <History size={12} />
              <span>Full History</span>
            </button>
          </div>

          {/* Main Search Input: Filters instantly as you type */}
          <div className="relative flex-1 min-w-[165px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search slot (E9, F4...), plate, handler..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-black/40 border border-white/15 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Quick Filters Group */}
          <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap shrink-0">

            {/* 1. Date & Range Filter Dropdown Popover */}
            <div className="relative" ref={timeDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setTimeDropdownOpen(!timeDropdownOpen);
                  setFloorDropdownOpen(false);
                  setStatusDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] transition border whitespace-nowrap cursor-pointer ${isCustomDateFilter
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-bold shadow-sm'
                    : 'bg-black/40 hover:bg-black/60 border-white/15 text-slate-200'
                  }`}
                title="Filter violation history by specific date or date range"
              >
                <Calendar size={12} className="text-amber-400 shrink-0" />
                <span className="truncate max-w-[135px]">{getTimeLabel()}</span>
                <ChevronDown
                  size={12}
                  className={`text-slate-400 transition-transform duration-200 ${timeDropdownOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {timeDropdownOpen && (
                <div className="absolute left-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] bg-[#141a26]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-3 space-y-2.5 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Filter by Date</span>
                    {!isTodayView && (
                      <button
                        type="button"
                        onClick={handleSwitchToToday}
                        className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold lowercase cursor-pointer whitespace-nowrap"
                      >
                        reset to today
                      </button>
                    )}
                  </div>

                  {/* Quick Date Presets (Single-line compact buttons) */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'yesterday', label: 'Yesterday' },
                      { id: 'week', label: 'Last 7 Days' },
                      { id: 'month', label: 'This Month' },
                    ].map((preset) => {
                      const isSelected = timeFilter === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setTimeFilter(preset.id);
                            setSingleDate('');
                            setStartDate('');
                            setEndDate('');
                            setTimeDropdownOpen(false);
                          }}
                          className={`px-1.5 py-1.5 rounded-xl text-[10.5px] font-semibold transition text-center whitespace-nowrap cursor-pointer border ${isSelected
                              ? 'bg-amber-400/20 text-amber-300 font-bold border-amber-400/40'
                              : 'bg-black/40 border-white/10 text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Option: Specific Single Day */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setTimeFilter('single')}
                      className={`w-full flex items-center justify-between text-left cursor-pointer ${timeFilter === 'single' ? 'text-amber-300 font-bold' : 'text-slate-300'
                        }`}
                    >
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <CalendarDays size={12} className="text-amber-400 shrink-0" />
                        <span className="text-[11px] font-semibold">Specific Date</span>
                      </div>
                      {timeFilter === 'single' && <Check size={12} className="text-amber-400 shrink-0" />}
                    </button>
                    <input
                      type="date"
                      value={singleDate}
                      onChange={(e) => {
                        setSingleDate(e.target.value);
                        setTimeFilter(e.target.value ? 'single' : 'all');
                      }}
                      className="w-full bg-black/60 border border-white/15 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-[11px] font-medium tabular-nums text-amber-300 focus:outline-none"
                    />
                  </div>

                  {/* Option: Date Range (From -> To) */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-2">
                    <button
                      type="button"
                      onClick={() => setTimeFilter('range')}
                      className={`w-full flex items-center justify-between text-left cursor-pointer ${timeFilter === 'range' ? 'text-amber-300 font-bold' : 'text-slate-300'
                        }`}
                    >
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <CalendarRange size={12} className="text-amber-400 shrink-0" />
                        <span className="text-[11px] font-semibold">Date Range (From → To)</span>
                      </div>
                      {timeFilter === 'range' && <Check size={12} className="text-amber-400 shrink-0" />}
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <span className="text-[10px] text-slate-400 block mb-1">From</span>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => {
                            setStartDate(e.target.value);
                            setTimeFilter('range');
                          }}
                          className="w-full bg-black/60 border border-white/15 focus:border-amber-400 rounded-lg px-2 py-1 text-[11px] font-medium tabular-nums text-amber-300 focus:outline-none"
                        />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-slate-400 block mb-1">To</span>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => {
                            setEndDate(e.target.value);
                            setTimeFilter('range');
                          }}
                          className="w-full bg-black/60 border border-white/15 focus:border-amber-400 rounded-lg px-2 py-1 text-[11px] font-medium tabular-nums text-amber-300 focus:outline-none"
                        />
                      </div>
                    </div>

                    {(startDate || endDate) && (
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[10px] text-amber-400/80">Date range active</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStartDate('');
                            setEndDate('');
                            setTimeFilter('all');
                          }}
                          className="text-[10px] text-red-400 hover:text-red-300 underline font-semibold cursor-pointer"
                        >
                          Clear range
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Apply / Close button */}
                  <div className="flex items-center gap-2 pt-0.5">
                    {isCustomDateFilter && (
                      <button
                        type="button"
                        onClick={handleSwitchToHistory}
                        className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-bold text-xs transition cursor-pointer"
                      >
                        All History
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setTimeDropdownOpen(false)}
                      className="flex-1 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs uppercase tracking-wider transition cursor-pointer shadow-md"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Custom Floor Filter Dropdown (Dark Glassmorphism) */}
            <div className="relative" ref={floorDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setFloorDropdownOpen(!floorDropdownOpen);
                  setTimeDropdownOpen(false);
                  setStatusDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] transition border whitespace-nowrap cursor-pointer ${floorFilter && floorFilter !== currentFloorId
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-bold shadow-sm'
                    : 'bg-black/40 hover:bg-black/60 border-white/15 text-slate-200'
                  }`}
              >
                <Layers size={12} className="text-amber-400 shrink-0" />
                <span className="truncate max-w-[100px]">{getFloorLabel()}</span>
                <ChevronDown
                  size={12}
                  className={`text-slate-400 transition-transform duration-200 ${floorDropdownOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {floorDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-[#141a26]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-2 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Select Floor
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFloorFilter('');
                      setFloorDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${!floorFilter
                        ? 'bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                  >
                    <span>All Floors</span>
                    {!floorFilter && <Check size={14} className="text-amber-400" />}
                  </button>

                  {floors.map((f) => {
                    const isSelected = floorFilter === f._id;
                    return (
                      <button
                        key={f._id}
                        type="button"
                        onClick={() => {
                          setFloorFilter(f._id);
                          setFloorDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${isSelected
                            ? 'bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30'
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                          }`}
                      >
                        <span>{f.name || `Floor ${f.floorNumber}`}</span>
                        {isSelected && <Check size={14} className="text-amber-400" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Custom Status Filter Dropdown (Dark Glassmorphism) */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setStatusDropdownOpen(!statusDropdownOpen);
                  setTimeDropdownOpen(false);
                  setFloorDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] transition border whitespace-nowrap cursor-pointer ${statusFilter
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-bold shadow-sm'
                    : 'bg-black/40 hover:bg-black/60 border-white/15 text-slate-200'
                  }`}
              >
                {statusFilter === 'PENDING' ? (
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                ) : statusFilter === 'RESOLVED' ? (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                ) : statusFilter === 'DISMISSED' ? (
                  <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                ) : (
                  <Filter size={12} className="text-amber-400 shrink-0" />
                )}
                <span className="truncate max-w-[110px]">{getStatusLabel()}</span>
                <ChevronDown
                  size={12}
                  className={`text-slate-400 transition-transform duration-200 ${statusDropdownOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {statusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-[#141a26]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-2 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Resolution Status
                  </div>
                  {[
                    { id: '', label: 'All Statuses', dot: null },
                    { id: 'ACTIVE_OCCUPIED', label: '🔴 Occupied (Action Needed)', dot: 'bg-red-500 animate-pulse' },
                    { id: 'SELF_CORRECTED', label: '🟢 Self-Corrected', dot: 'bg-cyan-400' },
                    { id: 'EMPTY_MOVED', label: '⚪ Vehicle Left', dot: 'bg-slate-500' },
                    { id: 'PENDING', label: 'All Pending', dot: 'bg-red-500' },
                    { id: 'RESOLVED', label: 'Resolved', dot: 'bg-emerald-500' },
                    { id: 'DISMISSED', label: 'Dismissed', dot: 'bg-slate-400' },
                  ].map((st) => {
                    const isSelected = statusFilter === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setStatusFilter(st.id);
                          setStatusDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${isSelected
                            ? 'bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30'
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          {st.dot && <span className={`w-2 h-2 rounded-full ${st.dot}`} />}
                          <span>{st.label}</span>
                        </div>
                        {isSelected && <Check size={14} className="text-amber-400" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reset Filters button if active */}
            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition whitespace-nowrap cursor-pointer"
                title="Reset all filters back to Today"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Main Content: Split View (List on Left, Details on Right) */}
        <div className="flex-1 flex overflow-hidden">

          {/* Left Column: Timeline List */}
          <div className="w-[360px] border-r border-white/10 flex flex-col bg-[#0e1219]/70 flex-shrink-0">
            <div className="p-3 border-b border-white/5 flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <span>{isTodayView ? "TODAY'S VIOLATIONS" : 'VIOLATION HISTORY'}</span>
              <span className="font-mono text-amber-400 font-bold">
                {filteredLogs.length}
                {totalRecords > filteredLogs.length ? ` / ${totalRecords}` : ''} records
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {loading && logs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-amber-400" />
                  Loading violation logs...
                </div>
              ) : loadError && logs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs space-y-2.5">
                  <AlertTriangle size={28} className="mx-auto text-red-400" />
                  <p className="text-red-300 font-semibold">Unable to load violation logs</p>
                  <p className="text-[11px] text-slate-500">{loadError}</p>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold transition cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs space-y-3">
                  <ShieldAlert size={28} className="mx-auto text-slate-600" />
                  <p>
                    {searchTerm
                      ? `No violations matching "${searchTerm}".`
                      : isTodayView
                        ? 'No violations recorded today.'
                        : 'No violation records match the selected filters.'}
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {isTodayView && (
                      <button
                        type="button"
                        onClick={handleSwitchToHistory}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <History size={13} />
                        <span>Open Full History</span>
                      </button>
                    )}
                    {hasActiveFilter && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isSelected = selectedLog?._id === log._id;
                  const isPending = log.status === 'PENDING';
                  const isResolved = log.status === 'RESOLVED';
                  const timeStr = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const dateStr = new Date(log.createdAt).toLocaleDateString();

                  // Dynamic smart status badge
                  let dynamicBadge = null;
                  if (isPending) {
                    if (log.isNowInCorrectSlot) {
                      dynamicBadge = (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                          <CheckCheck size={10} /> Moved to {log.currentVehicleSlot}
                        </span>
                      );
                    } else if (log.isSlotEmpty || log.isVehicleGone) {
                      dynamicBadge = (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider bg-slate-700/60 text-slate-300 border border-slate-600/40">
                          Vehicle Left
                        </span>
                      );
                    } else {
                      dynamicBadge = (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                          Pending
                        </span>
                      );
                    }
                  } else if (isResolved) {
                    if (log.resolutionAction === 'SELF_CORRECTED') {
                      dynamicBadge = (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          Self-Corrected
                        </span>
                      );
                    } else {
                      dynamicBadge = (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Resolved
                        </span>
                      );
                    }
                  } else {
                    dynamicBadge = (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider bg-slate-700/40 text-slate-400">
                        Dismissed
                      </span>
                    );
                  }

                  return (
                    <button
                      key={log._id}
                      onClick={() => {
                        setSelectedLog(log);
                        setViewFullImage(false);
                      }}
                      className={`w-full text-left p-3.5 transition flex items-start justify-between gap-3 ${isSelected ? 'bg-amber-500/10 border-l-4 border-amber-400' : 'hover:bg-white/5'
                        }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-black text-sm text-amber-300">
                            Slot {log.slotCode}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-slate-300 font-bold">
                            {log.floorId?.name || 'Floor 2'}
                          </span>
                          {dynamicBadge}
                          {log.plateViolationCount > 1 && (
                            <span
                              className="text-[9px] font-extrabold px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              title={`This vehicle has ${log.plateViolationCount} violation events in the selected range`}
                            >
                              Violation x{log.plateViolationCount}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-300 font-mono font-bold">
                          {log.detectedPlate ? formatLicensePlateDisplay(log.detectedPlate) : 'Plate Unknown'}
                        </div>

                        <div className="text-[11px] text-slate-400 line-clamp-1">
                          {log.expectedSlot ? `Assigned: Slot ${log.expectedSlot} → Parked: ${log.slotCode}` : (log.violationMessage || 'Parked in unauthorized slot')}
                        </div>
                      </div>

                      <div className="text-right text-[10px] text-slate-500 flex flex-col items-end shrink-0 pt-0.5">
                        <span className="font-mono text-slate-400 font-semibold">{timeStr}</span>
                        <span>{dateStr}</span>
                      </div>
                    </button>
                  );
                })
              )}
              {hasMore && filteredLogs.length > 0 && (
                <div className="p-3 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-amber-300 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={13} className={loadingMore ? 'animate-spin' : ''} />
                    <span>
                      {loadingMore
                        ? 'Loading more...'
                        : `Load more records${remainingCount > 0 ? ` (${remainingCount} remaining)` : ''}`}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Detailed Evidence & Resolution Panel */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#10141d] flex flex-col justify-between">
            {selectedLog ? (
              <div className="space-y-5">

                {/* Detail Header */}
                <div className="flex items-start justify-between border-b border-white/10 pb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 font-mono font-black text-base">
                        Slot {selectedLog.slotCode}
                      </span>
                      <span className="text-sm font-bold text-slate-300">
                        {selectedLog.floorId?.name || 'Floor 2'}
                      </span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${selectedLog.status === 'PENDING'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
                            : selectedLog.status === 'RESOLVED'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-700/50 text-slate-400'
                          }`}
                      >
                        {selectedLog.status === 'PENDING' ? 'Pending' : selectedLog.status === 'RESOLVED' ? 'Resolved' : 'Dismissed'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Recorded at: <strong className="text-slate-200">{new Date(selectedLog.createdAt).toLocaleString()}</strong>
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Detected Plate</span>
                    <span className="font-mono font-black text-lg px-3 py-1 rounded-lg bg-black border border-white/20 text-amber-300 inline-block shadow-inner">
                      {formatLicensePlateDisplay(selectedLog.detectedPlate || 'N/A')}
                    </span>
                  </div>
                </div>

                {/* Evidence Image Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                    <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                      <Eye size={14} className="text-amber-400" />
                      {viewFullImage ? 'Full Parking Lot Camera View' : 'AI Cropped Violation Slot View'}
                    </span>
                    {displayFullUrl && displayEvidenceUrl && (
                      <button
                        onClick={() => setViewFullImage(!viewFullImage)}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition text-xs font-semibold cursor-pointer"
                      >
                        <Maximize2 size={13} />
                        <span>{viewFullImage ? 'View Cropped Slot' : 'View Full Parking Lot'}</span>
                      </button>
                    )}
                  </div>

                  <div className="relative rounded-xl border border-white/10 bg-black/60 overflow-hidden min-h-[220px] max-h-[300px] flex items-center justify-center">
                    {evidenceLoading ? (
                      <div className="p-8 text-center text-slate-400 text-xs space-y-2">
                        <RefreshCw size={22} className="animate-spin mx-auto text-amber-400" />
                        <p>Loading evidence image...</p>
                      </div>
                    ) : evidenceError ? (
                      <div className="p-8 text-center text-slate-500 text-xs">
                        <Camera size={28} className="mx-auto mb-2 opacity-40" />
                        Unable to load evidence image for this event
                      </div>
                    ) : viewFullImage && displayFullUrl ? (
                      <img
                        src={displayFullUrl}
                        alt="Camera Full Evidence"
                        loading="lazy"
                        onError={() => setEvidenceError(true)}
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                    ) : displayEvidenceUrl ? (
                      <img
                        src={displayEvidenceUrl}
                        alt="Camera Cropped Slot Evidence"
                        loading="lazy"
                        onError={() => setEvidenceError(true)}
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                    ) : displayFullUrl ? (
                      <img
                        src={displayFullUrl}
                        alt="Camera Evidence"
                        loading="lazy"
                        onError={() => setEvidenceError(true)}
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                    ) : (
                      <div className="p-8 text-center text-slate-500 text-xs">
                        <Camera size={28} className="mx-auto mb-2 opacity-40" />
                        {evidenceError
                          ? 'Unable to load evidence image for this event'
                          : 'No snapshot captured for this event'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Slot Comparison Box */}
                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10 text-center">
                  <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Assigned Slot</span>
                    <span className="text-base font-black text-emerald-400 font-mono">
                      {selectedLog.expectedSlot || 'Other / Unregistered'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/30">
                    <span className="text-[10px] text-red-300 uppercase font-bold block mb-1">Actual Occupied Slot</span>
                    <span className="text-base font-black text-red-400 font-mono">
                      Slot {selectedLog.slotCode}
                    </span>
                  </div>
                </div>

                {/* Resolution Status / Trail */}
                {selectedLog.status === 'RESOLVED' && (
                  <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-1.5 text-xs text-emerald-200">
                    <div className="flex items-center gap-2 font-bold text-emerald-400">
                      <CheckCircle2 size={16} />
                      <span>Violation Resolved</span>
                    </div>
                    <p className="text-slate-300">
                      Handled by: <strong className="text-white">{selectedLog.resolverName || 'On-duty Staff'}</strong> at{' '}
                      {selectedLog.resolvedAt ? new Date(selectedLog.resolvedAt).toLocaleString() : 'N/A'}
                    </p>
                    {selectedLog.resolutionNote && (
                      <p className="text-slate-400 italic">Note: {selectedLog.resolutionNote}</p>
                    )}
                  </div>
                )}

                {/* Quick Action Buttons if PENDING */}
                {selectedLog.status === 'PENDING' && (
                  <div className="pt-2 border-t border-white/10 space-y-2.5">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Resolution Actions:
                    </div>

                    {/* Scenario A: Customer self-corrected and moved to the correct expected slot */}
                    {selectedLog.isNowInCorrectSlot || selectedLog.vehicleCurrentStatus?.status === 'SELF_CORRECTED' ? (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-black border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-3 shadow-lg">
                          <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 shrink-0">
                            <Sparkles size={18} />
                          </div>
                          <div className="space-y-1">
                            <p className="font-bold text-white text-sm flex items-center gap-2">
                              <span>Driver self-corrected to assigned slot</span>
                              <span className="font-mono text-emerald-300 font-black px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                                Slot {selectedLog.currentVehicleSlot || selectedLog.expectedSlot}
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-300">
                              AI Camera confirms the vehicle has vacated slot {selectedLog.slotCode} and moved into its assigned slot ({selectedLog.expectedSlot}).
                              Recommended to confirm self-correction and close this alert without penalty.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => handleDismissOrWarning(selectedLog, 'SELF_CORRECTED')}
                            disabled={actionLoading}
                            className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95 cursor-pointer"
                          >
                            <CheckCircle2 size={16} />
                            <span>Confirm Self-Correction</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDismissOrWarning(selectedLog, 'DISMISS')}
                            disabled={actionLoading}
                            className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 border border-white/10 shadow disabled:opacity-50 active:scale-95 cursor-pointer"
                          >
                            <span>Close / Dismiss Alert</span>
                          </button>
                        </div>
                      </div>
                    ) : selectedLog.isRoamingMismatch || selectedLog.vehicleCurrentStatus?.status === 'ROAMING_MISMATCH' ? (
                      /* Scenario B: Vehicle left this slot but moved to another WRONG slot */
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-950/40 via-orange-950/30 to-black border border-amber-500/40 text-xs text-amber-200 flex items-start gap-3 shadow-lg">
                          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                            <AlertTriangle size={18} />
                          </div>
                          <div className="space-y-1">
                            <p className="font-bold text-white text-sm flex items-center gap-2">
                              <span>Vehicle is still parked in another wrong slot</span>
                              <span className="font-mono text-amber-300 font-black px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30">
                                Slot {selectedLog.currentVehicleSlot}
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-300">
                              Vehicle left slot {selectedLog.slotCode} but has not moved to {selectedLog.expectedSlot}; currently parked at slot {selectedLog.currentVehicleSlot}.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setSearchTerm(selectedLog.currentVehicleSlot || '')}
                            disabled={actionLoading}
                            className="py-2.5 px-4 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow disabled:opacity-50 active:scale-95 cursor-pointer"
                          >
                            <Search size={15} />
                            <span>Inspect Slot {selectedLog.currentVehicleSlot}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDismissOrWarning(selectedLog, 'ISSUE_WARNING')}
                            disabled={actionLoading}
                            className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95 cursor-pointer"
                          >
                            <Phone size={15} />
                            <span>Issue Warning / Log</span>
                          </button>
                        </div>
                      </div>
                    ) : selectedLog.isVehicleGone || selectedLog.isSlotEmpty || selectedLog.isSessionEnded ? (
                      /* Scenario C: Vehicle left or already checked out */
                      <div className="space-y-2.5">
                        <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300 flex items-start gap-2.5 shadow-inner">
                          <Info size={16} className="text-cyan-400 flex-shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <p className="font-bold text-white">
                              {selectedLog.isSessionEnded
                                ? 'Vehicle has completed checkout and exited the parking lot.'
                                : `AI Camera confirms slot ${selectedLog.slotCode} is now empty (vehicle left).`}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Slot reassignment is unavailable because the vehicle is no longer at this slot.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => handleDismissOrWarning(selectedLog, 'DISMISS')}
                            disabled={actionLoading}
                            className="py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow disabled:opacity-50 active:scale-95 cursor-pointer"
                          >
                            <span>Close / Dismiss Alert</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDismissOrWarning(selectedLog, 'ISSUE_WARNING')}
                            disabled={actionLoading}
                            className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95 cursor-pointer"
                          >
                            <Phone size={15} />
                            <span>Issue Warning / Log</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Scenario D: Vehicle is physically still at the wrong slot */
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => handleReassign(selectedLog)}
                          disabled={actionLoading}
                          className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95 cursor-pointer"
                        >
                          <RotateCw size={15} className={actionLoading ? 'animate-spin' : ''} />
                          <span>Allow Slot {selectedLog.slotCode}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDismissOrWarning(selectedLog, 'ISSUE_WARNING')}
                          disabled={actionLoading}
                          className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95 cursor-pointer"
                        >
                          <Phone size={15} />
                          <span>Notify / Issue Warning</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Select an event from the left list to view detailed evidence.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

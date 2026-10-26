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
  Filter
} from 'lucide-react';
import { getViolationLogs, resolveViolation, clearAllViolationsApi } from '../../../services/aiSurveillanceService';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';
import toast from 'react-hot-toast';

export default function GlobalViolationHistoryModal({
  isOpen,
  onClose,
  floors = [],
  currentFloorId,
  onViolationResolved
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Custom Time Filter States
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const [timeFilter, setTimeFilter] = useState('all'); // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'single' | 'range'
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

  // Fetch all logs from backend
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getViolationLogs({
        floorId: floorFilter || undefined,
        limit: 200,
      });
      if (res.success) {
        setLogs(res.data || []);
      }
    } catch (err) {
      console.error('Failed to load violation logs:', err);
      toast.error('Không thể tải lịch sử vi phạm');
    } finally {
      setLoading(false);
    }
  }, [floorFilter]);

  useEffect(() => {
    if (!isOpen) return;
    fetchLogs();
  }, [isOpen, fetchLogs]);

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
      result = result.filter((l) => l.status === statusFilter);
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

  const hasActiveFilter = Boolean(
    searchTerm ||
    (floorFilter && floorFilter !== currentFloorId) ||
    statusFilter ||
    timeFilter !== 'all' ||
    singleDate ||
    startDate ||
    endDate
  );

  const handleResetFilters = () => {
    setSearchTerm('');
    setFloorFilter(currentFloorId || '');
    setStatusFilter('');
    setTimeFilter('all');
    setSingleDate('');
    setStartDate('');
    setEndDate('');
  };

  const getTimeLabel = () => {
    switch (timeFilter) {
      case 'today':
        return 'Hôm nay';
      case 'yesterday':
        return 'Hôm qua';
      case 'week':
        return '7 ngày qua';
      case 'month':
        return 'Tháng này';
      case 'single':
        return singleDate ? new Date(singleDate + 'T00:00:00').toLocaleDateString('vi-VN') : '1 ngày cụ thể';
      case 'range':
        if (startDate && endDate) {
          return `${new Date(startDate + 'T00:00:00').toLocaleDateString('vi-VN')} - ${new Date(endDate + 'T00:00:00').toLocaleDateString('vi-VN')}`;
        }
        if (startDate) return `Từ ${new Date(startDate + 'T00:00:00').toLocaleDateString('vi-VN')}`;
        if (endDate) return `Đến ${new Date(endDate + 'T00:00:00').toLocaleDateString('vi-VN')}`;
        return 'Khoảng ngày';
      default:
        return 'Tất cả thời gian';
    }
  };

  const getFloorLabel = () => {
    if (!floorFilter) return 'Tất cả các tầng';
    const found = floors.find((f) => f._id === floorFilter);
    return found ? (found.name || `Floor ${found.floorNumber}`) : 'Tất cả các tầng';
  };

  const getStatusLabel = () => {
    switch (statusFilter) {
      case 'PENDING':
        return 'Chưa xử lý';
      case 'RESOLVED':
        return 'Đã xử lý';
      case 'DISMISSED':
        return 'Đã bỏ qua';
      default:
        return 'Tất cả trạng thái';
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
        note: `Nhân viên xử lý đổi ô đỗ sang ${log.slotCode} từ lịch sử vi phạm`,
      });

      if (res.success) {
        toast.success(res.message || 'Đã giải quyết vi phạm thành công!');
        fetchLogs();
        if (onViolationResolved) onViolationResolved(log.slotCode);
      } else {
        toast.error(res.message || 'Xử lý thất bại');
      }
    } catch (err) {
      toast.error(err.message || 'Lỗi kết nối khi xử lý');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismissOrWarning = async (log, actionType) => {
    if (!log) return;
    setActionLoading(true);
    try {
      const res = await resolveViolation({
        logId: log._id,
        slotCode: log.slotCode,
        floorId: log.floorId?._id || log.floorId,
        action: actionType,
        note: actionType === 'DISMISS' ? 'Bỏ qua cảnh báo vi phạm' : 'Nhân viên đã gọi điện nhắc nhở tài xế dời xe',
      });

      if (res.success) {
        toast.success(res.message || 'Đã cập nhật trạng thái xử lý!');
        fetchLogs();
        if (onViolationResolved) onViolationResolved(log.slotCode);
      } else {
        toast.error(res.message || 'Xử lý thất bại');
      }
    } catch (err) {
      toast.error(err.message || 'Lỗi kết nối');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Bạn có chắc muốn xóa/hủy tất cả cảnh báo vi phạm để bắt đầu lượt kiểm tra mới?')) return;
    setActionLoading(true);
    try {
      const res = await clearAllViolationsApi(floorFilter || null);
      if (res.success) {
        toast.success(res.message || 'Đã hủy và đặt lại cảnh báo thành công!');
        fetchLogs();
        if (onViolationResolved) onViolationResolved(null);
      } else {
        toast.error(res.message || 'Không thể đặt lại cảnh báo');
      }
    } catch (err) {
      toast.error(err.message || 'Lỗi kết nối');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

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
                LỊCH SỬ VI PHẠM BÃI ĐỖ
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold">
                  {filteredLogs.length} / {logs.length} bản ghi
                </span>
              </h2>
              <p className="text-xs text-slate-400">Theo dõi ảnh chụp camera, đối chiếu xe và nhật ký xử lý vi phạm</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleClearAll}
              disabled={actionLoading}
              className="p-2 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 hover:text-white transition flex items-center gap-1.5 text-xs font-semibold"
              title="Hủy/Đặt lại toàn bộ cảnh báo để kiểm tra lại từ đầu"
            >
              <RotateCcw size={14} className={actionLoading ? 'animate-spin' : ''} />
              <span>Đặt lại cảnh báo</span>
            </button>
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition flex items-center gap-1.5 text-xs font-semibold"
              title="Làm mới danh sách"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Làm mới</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Unified, Clean 1-Row Filter Bar */}
        <div className="px-6 py-3 border-b border-white/10 bg-[#121620] flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          
          {/* Main Search Input: Filters instantly as you type */}
          <div className="relative flex-1 min-w-[280px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Tìm nhanh ô (E9, F4...), biển số xe, người xử lý..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                title="Xóa tìm kiếm"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Quick Filters Group: All Custom Sleek Dropdowns */}
          <div className="flex items-center gap-2.5 flex-wrap">
            
            {/* 1. Custom Time Filter Dropdown Popover (Dark Glassmorphism) */}
            <div className="relative" ref={timeDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  setTimeDropdownOpen(!timeDropdownOpen);
                  setFloorDropdownOpen(false);
                  setStatusDropdownOpen(false);
                }}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition border cursor-pointer ${
                  timeFilter !== 'all'
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-bold shadow-sm'
                    : 'bg-black/40 hover:bg-black/60 border-white/15 text-slate-200'
                }`}
              >
                <Calendar size={13} className="text-amber-400 shrink-0" />
                <span className="truncate max-w-[150px]">{getTimeLabel()}</span>
                <ChevronDown
                  size={13}
                  className={`text-slate-400 transition-transform duration-200 ${
                    timeDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {timeDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-[#141a26]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-3 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-1 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Lọc theo thời gian</span>
                    {timeFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => {
                          setTimeFilter('all');
                          setSingleDate('');
                          setStartDate('');
                          setEndDate('');
                        }}
                        className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold lowercase"
                      >
                        đặt lại
                      </button>
                    )}
                  </div>

                  {/* Preset Options */}
                  <div className="space-y-0.5">
                    {[
                      { id: 'all', label: 'Tất cả thời gian', icon: Clock },
                      { id: 'today', label: 'Hôm nay', icon: Calendar },
                      { id: 'yesterday', label: 'Hôm qua', icon: CalendarDays },
                      { id: 'week', label: '7 ngày qua', icon: CalendarDays },
                      { id: 'month', label: 'Tháng này', icon: CalendarDays },
                    ].map((preset) => {
                      const isSelected = timeFilter === preset.id;
                      const IconComp = preset.icon;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setTimeFilter(preset.id);
                            setTimeDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${
                            isSelected
                              ? 'bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <IconComp size={14} className={isSelected ? 'text-amber-400' : 'text-slate-400'} />
                            <span>{preset.label}</span>
                          </div>
                          {isSelected && <Check size={14} className="text-amber-400" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t border-white/10 my-2" />

                  {/* Option: Specific Single Day */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setTimeFilter('single')}
                      className={`w-full flex items-center justify-between text-left cursor-pointer ${
                        timeFilter === 'single' ? 'text-amber-300 font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <CalendarDays size={13} className="text-amber-400" />
                        <span className="text-[11px] font-semibold">1 ngày cụ thể</span>
                      </div>
                      {timeFilter === 'single' && <Check size={13} className="text-amber-400" />}
                    </button>
                    <input
                      type="date"
                      value={singleDate}
                      onChange={(e) => {
                        setSingleDate(e.target.value);
                        setTimeFilter('single');
                      }}
                      className="w-full bg-black/60 border border-white/15 focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none"
                    />
                  </div>

                  {/* Option: Date Range (Từ ngày -> Đến ngày) */}
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-2">
                    <button
                      type="button"
                      onClick={() => setTimeFilter('range')}
                      className={`w-full flex items-center justify-between text-left cursor-pointer ${
                        timeFilter === 'range' ? 'text-amber-300 font-bold' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <CalendarRange size={13} className="text-amber-400" />
                        <span className="text-[11px] font-semibold">Khoảng ngày (Từ ngày → Đến ngày)</span>
                      </div>
                      {timeFilter === 'range' && <Check size={13} className="text-amber-400" />}
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">Từ ngày</span>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => {
                            setStartDate(e.target.value);
                            setTimeFilter('range');
                          }}
                          className="w-full bg-black/60 border border-white/15 focus:border-amber-400 rounded-lg px-2 py-1 text-[11px] text-amber-300 font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">Đến ngày</span>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => {
                            setEndDate(e.target.value);
                            setTimeFilter('range');
                          }}
                          className="w-full bg-black/60 border border-white/15 focus:border-amber-400 rounded-lg px-2 py-1 text-[11px] text-amber-300 font-mono focus:outline-none"
                        />
                      </div>
                    </div>

                    {(startDate || endDate) && (
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[10px] text-amber-400/80">Đang lọc khoảng ngày</span>
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
                          Xóa khoảng
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Apply / Close button */}
                  <div className="pt-1.5">
                    <button
                      type="button"
                      onClick={() => setTimeDropdownOpen(false)}
                      className="w-full py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs uppercase tracking-wider transition cursor-pointer shadow-md"
                    >
                      Xác nhận
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
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition border cursor-pointer ${
                  floorFilter && floorFilter !== currentFloorId
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-bold shadow-sm'
                    : 'bg-black/40 hover:bg-black/60 border-white/15 text-slate-200'
                }`}
              >
                <Layers size={13} className="text-amber-400 shrink-0" />
                <span className="truncate max-w-[130px]">{getFloorLabel()}</span>
                <ChevronDown
                  size={13}
                  className={`text-slate-400 transition-transform duration-200 ${
                    floorDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {floorDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-[#141a26]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-2 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Chọn tầng
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFloorFilter('');
                      setFloorDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${
                      !floorFilter
                        ? 'bg-amber-400/20 text-amber-300 font-bold border border-amber-400/30'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span>Tất cả các tầng</span>
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
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${
                          isSelected
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
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition border cursor-pointer ${
                  statusFilter
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
                  <Filter size={13} className="text-amber-400 shrink-0" />
                )}
                <span className="truncate max-w-[130px]">{getStatusLabel()}</span>
                <ChevronDown
                  size={13}
                  className={`text-slate-400 transition-transform duration-200 ${
                    statusDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {statusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-[#141a26]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl p-2 space-y-1 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Trạng thái xử lý
                  </div>
                  {[
                    { id: '', label: 'Tất cả trạng thái', dot: null },
                    { id: 'PENDING', label: 'Chưa xử lý', dot: 'bg-red-500' },
                    { id: 'RESOLVED', label: 'Đã xử lý', dot: 'bg-emerald-500' },
                    { id: 'DISMISSED', label: 'Đã bỏ qua', dot: 'bg-slate-400' },
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
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition text-left cursor-pointer ${
                          isSelected
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
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold transition cursor-pointer"
              >
                Đặt lại
              </button>
            )}
          </div>
        </div>

        {/* Main Content: Split View (List on Left, Details on Right) */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Column: Timeline List */}
          <div className="w-[360px] border-r border-white/10 flex flex-col bg-[#0e1219]/70 flex-shrink-0">
            <div className="p-3 border-b border-white/5 flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Danh sách sự kiện vi phạm</span>
              <span className="font-mono text-amber-400 font-bold">{filteredLogs.length} bản ghi</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {loading && logs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-amber-400" />
                  Đang tải lịch sử...
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs space-y-2">
                  <ShieldAlert size={28} className="mx-auto text-slate-600" />
                  <p>
                    {searchTerm
                      ? `Không tìm thấy vi phạm nào khớp với "${searchTerm}".`
                      : 'Không có bản ghi vi phạm nào phù hợp với bộ lọc.'}
                  </p>
                  {hasActiveFilter && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-amber-400 text-xs font-semibold transition"
                    >
                      Xóa bộ lọc để xem tất cả
                    </button>
                  )}
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isSelected = selectedLog?._id === log._id;
                  const isPending = log.status === 'PENDING';
                  const isResolved = log.status === 'RESOLVED';
                  const timeStr = new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const dateStr = new Date(log.createdAt).toLocaleDateString();

                  return (
                    <button
                      key={log._id}
                      onClick={() => {
                        setSelectedLog(log);
                        setViewFullImage(false);
                      }}
                      className={`w-full text-left p-3.5 transition flex items-start justify-between gap-3 ${
                        isSelected ? 'bg-amber-500/10 border-l-4 border-amber-400' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-sm text-amber-300">
                            Ô {log.slotCode}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-slate-300 font-bold">
                            {log.floorId?.name || 'Floor 2'}
                          </span>
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full uppercase tracking-wider ${
                              isPending
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : isResolved
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-700/40 text-slate-400'
                            }`}
                          >
                            {isPending ? 'Chưa xử lý' : isResolved ? 'Đã xử lý' : 'Bỏ qua'}
                          </span>
                        </div>

                        <div className="text-xs text-slate-300 font-mono font-bold">
                          {log.detectedPlate ? formatLicensePlateDisplay(log.detectedPlate) : 'Chưa rõ biển số'}
                        </div>

                        <div className="text-[11px] text-slate-400 line-clamp-1">
                          {log.expectedSlot ? `Gốc: Ô ${log.expectedSlot} → Đỗ: ${log.slotCode}` : (log.violationMessage || 'Đỗ sai ô quy định')}
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
                        Ô {selectedLog.slotCode}
                      </span>
                      <span className="text-sm font-bold text-slate-300">
                        {selectedLog.floorId?.name || 'Floor 2'}
                      </span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          selectedLog.status === 'PENDING'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
                            : selectedLog.status === 'RESOLVED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-700/50 text-slate-400'
                        }`}
                      >
                        {selectedLog.status === 'PENDING' ? 'Chưa xử lý' : selectedLog.status === 'RESOLVED' ? 'Đã xử lý' : 'Đã bỏ qua'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Ghi nhận lúc: <strong className="text-slate-200">{new Date(selectedLog.createdAt).toLocaleString()}</strong>
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Biển số phát hiện</span>
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
                      {viewFullImage ? 'Ảnh Camera Toàn Bãi Đỗ' : 'Ảnh AI Crop Cận Cảnh Ô Đỗ Vi Phạm'}
                    </span>
                    {selectedLog.fullSnapshot && selectedLog.evidenceSnapshot && (
                      <button
                        onClick={() => setViewFullImage(!viewFullImage)}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition text-xs font-semibold"
                      >
                        <Maximize2 size={13} />
                        <span>{viewFullImage ? 'Xem ảnh crop ô đỗ' : 'Xem toàn cảnh bãi đỗ'}</span>
                      </button>
                    )}
                  </div>

                  <div className="relative rounded-xl border border-white/10 bg-black/60 overflow-hidden min-h-[220px] max-h-[300px] flex items-center justify-center">
                    {viewFullImage && selectedLog.fullSnapshot ? (
                      <img
                        src={selectedLog.fullSnapshot}
                        alt="Camera Full Evidence"
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                    ) : selectedLog.evidenceSnapshot ? (
                      <img
                        src={selectedLog.evidenceSnapshot}
                        alt="Camera Cropped Slot Evidence"
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                    ) : selectedLog.fullSnapshot ? (
                      <img
                        src={selectedLog.fullSnapshot}
                        alt="Camera Evidence"
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                    ) : (
                      <div className="p-8 text-center text-slate-500 text-xs">
                        <Camera size={28} className="mx-auto mb-2 opacity-40" />
                        Chưa có hình ảnh chụp khoảnh khắc này
                      </div>
                    )}
                  </div>
                </div>

                {/* Slot Comparison Box */}
                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10 text-center">
                  <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Ô cấp phép ban đầu</span>
                    <span className="text-base font-black text-emerald-400 font-mono">
                      {selectedLog.expectedSlot || 'Khác / Chưa đăng ký'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/30">
                    <span className="text-[10px] text-red-300 uppercase font-bold block mb-1">Ô đang đỗ thực tế</span>
                    <span className="text-base font-black text-red-400 font-mono">
                      Ô {selectedLog.slotCode}
                    </span>
                  </div>
                </div>

                {/* Resolution Status / Trail */}
                {selectedLog.status === 'RESOLVED' && (
                  <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-1.5 text-xs text-emerald-200">
                    <div className="flex items-center gap-2 font-bold text-emerald-400">
                      <CheckCircle2 size={16} />
                      <span>Đã giải quyết vi phạm</span>
                    </div>
                    <p className="text-slate-300">
                      Xử lý bởi: <strong className="text-white">{selectedLog.resolverName || 'Nhân viên trực'}</strong> lúc{' '}
                      {selectedLog.resolvedAt ? new Date(selectedLog.resolvedAt).toLocaleString() : 'N/A'}
                    </p>
                    {selectedLog.resolutionNote && (
                      <p className="text-slate-400 italic">Ghi chú: {selectedLog.resolutionNote}</p>
                    )}
                  </div>
                )}

                {/* Quick Action Buttons if PENDING */}
                {selectedLog.status === 'PENDING' && (
                  <div className="pt-2 border-t border-white/10 space-y-2.5">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Hành động xử lý vi phạm:
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => handleReassign(selectedLog)}
                        disabled={actionLoading}
                        className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95"
                      >
                        <RotateCw size={15} className={actionLoading ? 'animate-spin' : ''} />
                        <span>Chấp nhận cho đỗ ô {selectedLog.slotCode}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDismissOrWarning(selectedLog, 'ISSUE_WARNING')}
                        disabled={actionLoading}
                        className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-95"
                      >
                        <Phone size={15} />
                        <span>Nhắc nhở / Lập biên bản</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                Chọn một sự kiện từ danh sách bên trái để xem bằng chứng chi tiết.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

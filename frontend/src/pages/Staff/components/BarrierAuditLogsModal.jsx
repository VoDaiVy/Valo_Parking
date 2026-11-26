import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  RefreshCw,
  Shield,
  Camera,
  Filter,
  Maximize2,
  Clock,
  User,
  Car,
  Lock,
  Unlock,
  PauseCircle,
  Search,
  Calendar,
  RotateCcw,
} from 'lucide-react';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';
import { apiFetch } from '../../../services/api';

export default function BarrierAuditLogsModal({ isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters State
  const [gateFilter, setGateFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(''); // YYYY-MM-DD
  const [previewImage, setPreviewImage] = useState(null);

  const resetAllFilters = () => {
    setGateFilter('ALL');
    setActionFilter('ALL');
    setSearchQuery('');
    setSelectedDate('');
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token =
        localStorage.getItem('accessToken') ||
        localStorage.getItem('token') ||
        sessionStorage.getItem('accessToken') ||
        sessionStorage.getItem('token') ||
        '';

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const params = new URLSearchParams();
      params.append('limit', '300');
      if (gateFilter !== 'ALL') params.append('gate', gateFilter);
      if (actionFilter !== 'ALL') params.append('action', actionFilter.toLowerCase());
      if (selectedDate) params.append('date', selectedDate);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await apiFetch(`/iot/barrier-audit-logs?${params.toString()}`, {
        headers,
      });
      if (res.ok && res.data?.success && Array.isArray(res.data.data)) {
        setLogs(res.data.data);
      } else {
        setLogs([]);
        setError(res.data?.message || 'Unable to load barrier audit logs.');
      }
    } catch (err) {
      console.error('Fetch barrier logs error:', err);
      setError('Unable to load barrier audit logs.');
    } finally {
      setLoading(false);
    }
  }, [gateFilter, actionFilter, selectedDate, searchQuery]);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  // Client-side quick filter
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (gateFilter !== 'ALL' && String(log.gate || '').toUpperCase() !== gateFilter) {
        return false;
      }
      if (actionFilter !== 'ALL' && String(log.action || '').toLowerCase() !== actionFilter.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const plate = String(log.licensePlate || '').toLowerCase();
        const staff = String(log.staffName || log.staffId?.fullName || log.staffId?.username || '').toLowerCase();
        const reason = String(log.reason || '').toLowerCase();
        const notes = String(log.notes || '').toLowerCase();
        const gate = String(log.gate || '').toLowerCase();

        const match =
          plate.includes(q) ||
          staff.includes(q) ||
          reason.includes(q) ||
          notes.includes(q) ||
          gate.includes(q);
        if (!match) return false;
      }
      if (selectedDate) {
        const logDateStr = new Date(log.createdAt).toISOString().slice(0, 10);
        if (logDateStr !== selectedDate) return false;
      }
      return true;
    });
  }, [logs, gateFilter, actionFilter, searchQuery, selectedDate]);

  // Group logs by Date
  const groupedLogs = useMemo(() => {
    const groups = {};
    filteredLogs.forEach((log) => {
      const d = new Date(log.createdAt);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(log);
    });

    return Object.keys(groups)
      .sort((a, b) => (a < b ? 1 : -1))
      .map((dateKey) => ({
        dateKey,
        items: groups[dateKey],
      }));
  }, [filteredLogs]);

  if (!isOpen) return null;

  const formatDateHeader = (dateKey) => {
    try {
      const [y, m, d] = dateKey.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const today = new Date();
      const isToday =
        today.getFullYear() === y && today.getMonth() === m - 1 && today.getDate() === d;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday =
        yesterday.getFullYear() === y && yesterday.getMonth() === m - 1 && yesterday.getDate() === d;

      const dateStr = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      if (isToday) return `Today • ${dateStr}`;
      if (isYesterday) return `Yesterday • ${dateStr}`;
      return dateStr;
    } catch {
      return dateKey;
    }
  };

  const getActionBadge = (action) => {
    const act = String(action || '').toLowerCase();
    if (act === 'open') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
          <Unlock size={10} className="stroke-[2.5]" />
          OPEN
        </span>
      );
    }
    if (act === 'hold') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase bg-amber-500/15 border border-amber-500/30 text-amber-300">
          <PauseCircle size={10} className="stroke-[2.5]" />
          HOLD
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase bg-rose-500/15 border border-rose-500/30 text-rose-400">
        <Lock size={10} className="stroke-[2.5]" />
        CLOSE
      </span>
    );
  };

  const getGateBadge = (gate) => {
    const isExit = String(gate || '').toUpperCase().includes('EXIT');
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${
          isExit
            ? 'bg-cyan-500/15 border border-cyan-400/30 text-cyan-300'
            : 'bg-emerald-500/15 border border-emerald-400/30 text-emerald-300'
        }`}
      >
        {isExit ? 'EXIT_1' : 'ENTRY_1'}
      </span>
    );
  };

  const formatReason = (reason) => {
    const r = String(reason || '').toUpperCase();
    if (r === 'CHECKOUT_SUCCESS') return 'Checkout Success';
    if (r === 'MANUAL_OVERRIDE') return 'Staff Manual Override';
    if (r === 'EMERGENCY_OPEN') return 'Emergency Open';
    if (r === 'HOLD_PAUSE') return 'Hold / Pause Sensor';
    if (r === 'RESUME_NORMAL') return 'Resume Normal Gate';
    if (r === 'FREE_PASS_OVERRIDE') return 'Free Pass Release';
    if (r === 'MANUAL_CLOSE') return 'Staff Close Barrier';
    if (r === 'CHECKIN_AUTO' || r === 'KIOSK_ENTRY') return 'Kiosk Check-in';
    if (r === 'VIP_AUTO_ENTRY') return 'VIP FastPass Entry';
    if (r === 'GATE_AUTO_CLOSED') return 'Sensor Auto-Close';
    return reason || 'Manual Control';
  };

  const isFilteringActive =
    gateFilter !== 'ALL' ||
    actionFilter !== 'ALL' ||
    searchQuery.trim() !== '' ||
    selectedDate !== '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className="relative flex flex-col w-full max-w-4xl h-[86vh] max-h-[850px] bg-[#0c0f17] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 1. COMPACT HEADER ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#121622]/90 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center text-amber-300 flex-shrink-0">
              <Shield size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Barrier Activity & Camera Evidence Logs
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                  {filteredLogs.length} events
                </span>
              </div>
              <p className="text-[11px] text-white/45">
                Audit trail of gate barrier operations with timestamp, operator, and camera snapshots.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={fetchLogs}
              disabled={loading}
              className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition disabled:opacity-40 cursor-pointer"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-amber-400' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-300 text-white/70 transition cursor-pointer"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── 2. COMPACT SEARCH & FILTER TOOLBAR (SINGLE SLIM ROW) ── */}
        <div className="px-5 py-2.5 border-b border-white/10 bg-[#0e121b] flex flex-wrap items-center justify-between gap-2.5 text-xs flex-shrink-0">
          {/* Left: Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search plate, operator, reason..."
              className="w-full pl-8 pr-7 py-1.5 bg-[#161b28] border border-white/10 rounded-lg text-xs text-white placeholder-white/35 focus:outline-none focus:border-amber-400/50 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Right: Date picker & Filter dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date filter */}
            <div className="flex items-center gap-1.5 bg-[#161b28] border border-white/10 rounded-lg px-2 py-1">
              <Calendar size={13} className="text-amber-400 flex-shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer [color-scheme:dark]"
              />
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="text-white/40 hover:text-white"
                  title="Clear date"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Gate filter buttons */}
            <div className="inline-flex rounded-lg border border-white/10 bg-[#161b28] p-0.5">
              {['ALL', 'ENTRY_1', 'EXIT_1'].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGateFilter(g)}
                  className={`px-2 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                    gateFilter === g
                      ? 'bg-amber-400 text-black shadow-sm'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  {g === 'ALL' ? 'All Gates' : g}
                </button>
              ))}
            </div>

            {/* Action filter buttons */}
            <div className="inline-flex rounded-lg border border-white/10 bg-[#161b28] p-0.5">
              {['ALL', 'OPEN', 'HOLD', 'CLOSE'].map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setActionFilter(a)}
                  className={`px-2 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                    actionFilter === a
                      ? 'bg-amber-400 text-black shadow-sm'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  {a === 'ALL' ? 'All' : a}
                </button>
              ))}
            </div>

            {/* Reset button if filtered */}
            {isFilteringActive && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="p-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 transition cursor-pointer"
                title="Reset filters"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── 3. CLEAN LOG LIST (GROUPED BY DATE) ── */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading && logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/40">
              <RefreshCw size={22} className="animate-spin text-amber-400 mb-2" />
              <p className="text-xs">Loading logs...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/30 text-center text-xs text-red-200">
              {error}
            </div>
          ) : groupedLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/40">
              <Shield size={28} className="text-white/20 mb-2" />
              <p className="text-xs font-semibold text-white/60">No activity logs found.</p>
              {isFilteringActive && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="mt-2.5 px-3 py-1 bg-white/10 hover:bg-white/15 rounded-lg text-xs text-amber-300 font-semibold transition"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            groupedLogs.map((group) => (
              <div key={group.dateKey} className="space-y-2">
                {/* Slim Date Divider */}
                <div className="flex items-center gap-2 py-1">
                  <div className="h-[1px] flex-1 bg-white/10" />
                  <span className="text-[11px] font-mono font-bold text-amber-300/80 px-2 uppercase tracking-wider">
                    {formatDateHeader(group.dateKey)} ({group.items.length})
                  </span>
                  <div className="h-[1px] flex-1 bg-white/10" />
                </div>

                {/* Event rows */}
                <div className="space-y-1.5">
                  {group.items.map((log) => {
                    const hasEvidence = Boolean(log.evidenceImage && log.evidenceImage.length > 10);
                    const logTime = new Date(log.createdAt);

                    return (
                      <div
                        key={log._id || log.createdAt}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#121622]/40 hover:bg-[#121622]/80 border border-white/5 hover:border-white/10 transition"
                      >
                        {/* Left Info Column */}
                        <div className="flex items-center gap-2.5 flex-1 min-w-0 flex-wrap sm:flex-nowrap">
                          {/* Badges: Action & Gate */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {getActionBadge(log.action)}
                            {getGateBadge(log.gate)}
                          </div>

                          {/* Reason Title & Plate */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="text-xs font-semibold text-white truncate">
                              {formatReason(log.reason)}
                            </span>

                            {log.licensePlate &&
                              log.licensePlate !== 'TEST-VEHICLE' &&
                              log.licensePlate !== 'STAFF-OVERRIDE' &&
                              log.licensePlate !== 'PAUSED' && (
                                <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-amber-400/30 flex-shrink-0">
                                  {formatLicensePlateDisplay(log.licensePlate)}
                                </span>
                              )}
                          </div>

                          {/* Metadata: Time & Operator */}
                          <div className="flex items-center gap-2 text-[11px] text-white/40 flex-shrink-0">
                            <span className="font-mono text-white/60">
                              {logTime.toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                            <span>•</span>
                            <span className="truncate max-w-[130px]">
                              {log.staffName || log.staffId?.fullName || log.staffId?.username || 'Auto'}
                            </span>
                            {log.notes && (
                              <>
                                <span>•</span>
                                <span className="italic text-white/50 truncate max-w-[150px]">
                                  "{log.notes}"
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Right Camera Snapshot */}
                        <div className="flex-shrink-0 self-end sm:self-center">
                          {hasEvidence ? (
                            <div
                              onClick={() => setPreviewImage(log.evidenceImage)}
                              className="group relative w-20 h-12 rounded-lg overflow-hidden border border-white/15 bg-black/60 cursor-pointer hover:border-amber-400 transition"
                              title="Click to view snapshot"
                            >
                              <img
                                src={log.evidenceImage}
                                alt="Evidence"
                                className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                              />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                <Maximize2 size={12} className="text-white drop-shadow" />
                              </div>
                            </div>
                          ) : (
                            <div className="w-20 h-12 rounded-lg border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center text-white/20 text-[9px] gap-1">
                              <Camera size={11} />
                              <span>No image</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── 4. COMPACT FOOTER ── */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/10 bg-[#121622]/60 text-[11px] text-white/40 flex-shrink-0">
          <span>Camera snapshots are captured automatically upon barrier activation.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold text-xs transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* ── 5. LIGHTBOX PREVIEW MODAL ── */}
      {previewImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-[#0e121b] border border-white/20 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-black/40">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <Camera size={13} />
                <span>Gate Camera Snapshot</span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 bg-black flex items-center justify-center p-2 overflow-hidden">
              <img
                src={previewImage}
                alt="Full Snapshot"
                className="max-h-[75vh] w-auto max-w-full object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { apiFetch } from "../../services/api";
import {
  History,
  MapPin,
  Clock,
  Car,
  Calendar,
  CreditCard,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  X,
  Camera,
  LogIn,
  LogOut
} from "lucide-react";
import CustomerPageHeader from "../../components/Customer/CustomerPageHeader";
import { formatLicensePlateDisplay } from "../../utils/licensePlate";

export default function ParkingHistory() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);

  const fetchHistory = async () => {
    setLoading(true);
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setError("Please login to view history");
      setLoading(false);
      return;
    }

    try {
      const { ok, data } = await apiFetch("/sessions/my-history", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ok && data?.success) {
        setSessions(data.data);
      } else {
        setError(data?.message || "Failed to load history.");
      }
    } catch {
      setError("Network error occurred.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchHistory();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  const getStatusBadge = (status) => {
    switch (status) {
      case "active":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.2)]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
            PARKING NOW
          </span>
        );
      case "completed":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 size={12} /> COMPLETED
          </span>
        );
      case "cancelled":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
            <AlertCircle size={12} /> CANCELLED
          </span>
        );
      default:
        return null;
    }
  };

  const calculateDuration = (checkIn, checkOut) => {
    const start = new Date(checkIn);
    const end = checkOut ? new Date(checkOut) : new Date();
    const diffMs = end - start;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    
    if (diffHrs === 0) return `${diffMins} mins`;
    return `${diffHrs}h ${diffMins}m`;
  };

  const formatMoney = (value) => {
    if (value === undefined || value === null) return "—";
    return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderSnapshotPanel = ({
    title,
    icon,
    time,
    imageUrl,
    emptyLabel,
  }) => (
    <div className="bg-[#101018] border border-gray-800/70 rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm font-black text-white mb-4 uppercase tracking-wide">
        {icon}
        <span>{title}</span>
      </div>

      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
          Time
        </p>
        <p className="text-lg font-bold text-gray-100">
          {time ? formatDate(time) : emptyLabel}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-800 bg-[#07070a] min-h-[240px]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="w-full h-[260px] object-cover"
          />
        ) : (
          <div className="w-full h-[260px] flex flex-col items-center justify-center text-center px-6 text-gray-500">
            <Camera size={34} className="mb-3 text-gray-600" />
            <p className="font-semibold">{emptyLabel}</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="min-h-full flex flex-col p-4 md:p-8"
      style={{
        backgroundColor: "#050505",
      }}
    >
      {/* ── HEADER ── */}
      <CustomerPageHeader
        icon={History}
        title="Parking History"
        description="Review your past parking sessions and expenses."
        className="mb-8 md:mb-10"
      />

      {/* ── CONTENT ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-2xl text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-medium">{error}</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center opacity-60 px-4">
          <History size={64} className="text-gray-500 mb-4" />
          <h3 className="text-xl font-bold text-gray-300">No History Found</h3>
          <p className="text-gray-500 mt-2 text-sm">
            You don't have any parking sessions yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col space-y-6">
          {sessions.map((session, index) => (
            <div
              key={session._id}
              className={`relative group bg-[#0d0d12] rounded-3xl border overflow-hidden transition-all duration-300 hover:shadow-[0_8px_30px_rgba(234,179,8,0.06)] ${
                index === 0
                  ? "border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.08)]"
                  : "border-gray-800/50 hover:border-yellow-500/30"
              }`}
            >
              <div
                className={`absolute top-0 left-0 w-1.5 h-full transition-opacity ${
                  index === 0
                    ? "bg-gradient-to-b from-yellow-400 to-yellow-600 opacity-100"
                    : "bg-gradient-to-b from-yellow-400 to-yellow-600 opacity-0 group-hover:opacity-100"
                }`}
              ></div>

              <div className="p-5 md:p-6">
                {/* Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className="w-12 h-12 shrink-0 bg-gray-800/50 rounded-xl flex items-center justify-center border border-gray-700/50">
                      <Car size={24} className="text-yellow-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">
                          LICENSE PLATE
                        </p>
                        {index === 0 && (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black bg-yellow-500 text-black tracking-wider uppercase shadow-[0_0_10px_rgba(234,179,8,0.4)]">
                            LATEST
                          </span>
                        )}
                      </div>
                      <h4 className="text-xl md:text-2xl font-black text-white tracking-wide">
                        {formatLicensePlateDisplay(session.licensePlate)}
                      </h4>
                    </div>
                  </div>
                  <div className="self-start">
                    {getStatusBadge(session.status)}
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-y-5 gap-x-4 mb-6">
                  <div>
                    <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                      <Calendar size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">CHECK-IN</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-200">
                      {formatDate(session.checkInTime)}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                      <Clock size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">DURATION</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-200">
                      {calculateDuration(session.checkInTime, session.checkOutTime)}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                      <MapPin size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">SLOT</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-200">
                      {session.parkingSlot || "Unassigned"}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                      <CreditCard size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">TOTAL</span>
                    </div>
                    <p className="text-sm font-bold text-yellow-400">
                      {formatMoney(session.totalPrice)}
                    </p>
                  </div>
                </div>

                {/* Footer / Image */}
                {session.entryImage_url && (
                  <div className="pt-4 mt-2 border-t border-gray-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-[11px] md:text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                      <ImageIcon size={14} className="shrink-0" /> Entry Snapshot Captured
                    </span>
                    <a
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setSelectedSession(session);
                      }}
                      className="text-[11px] md:text-xs font-bold text-yellow-500 hover:text-yellow-400 transition-colors w-fit border border-yellow-500/30 px-3 py-1.5 rounded-lg hover:bg-yellow-500/10"
                    >
                      View Details
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedSession && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-[#09090d] border border-yellow-500/20 rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4 p-6 md:p-7 border-b border-gray-800/70">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-yellow-500 mb-2">
                  Session Details
                </p>
                <h2 className="text-2xl md:text-3xl font-black text-white">
                  {formatLicensePlateDisplay(selectedSession.licensePlate)}
                </h2>
                <p className="text-sm text-gray-400 mt-2">
                  Slot {selectedSession.parkingSlot || "Unassigned"} •{" "}
                  {selectedSession.totalPrice !== undefined && selectedSession.totalPrice !== null
                    ? formatMoney(selectedSession.totalPrice)
                    : "No charge"}
                </p>
              </div>

              <button
                onClick={() => setSelectedSession(null)}
                className="shrink-0 w-11 h-11 rounded-xl border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 hover:bg-white/5 transition-colors flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 md:p-7">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {renderSnapshotPanel({
                  title: "Check-In",
                  icon: <LogIn size={18} className="text-emerald-400" />,
                  time: selectedSession.checkInTime,
                  imageUrl: selectedSession.entryImage_url,
                  emptyLabel: "No check-in image captured",
                })}

                {renderSnapshotPanel({
                  title: "Check-Out",
                  icon: <LogOut size={18} className="text-sky-400" />,
                  time: selectedSession.checkOutTime,
                  imageUrl: selectedSession.exitImage_url,
                  emptyLabel:
                    selectedSession.status === "active"
                      ? "Vehicle has not checked out yet"
                      : "No check-out image captured",
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

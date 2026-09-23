import { useState } from 'react';
import {
  X,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  Phone,
  User,
  Clock,
  Car,
  RotateCw,
  LogOut,
  BellRing
} from 'lucide-react';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';
import { reassignSessionSlot } from '../../../services/sessionService';

export default function ViolationResolutionModal({
  isOpen,
  onClose,
  violation,
  onReassignSuccess,
  onCheckout
}) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !violation) return null;

  const {
    detectedPlate,
    expectedSlot,
    actualSlot,
    slotCode,
    session,
    mismatchDetails
  } = violation;

  const currentActualSlot = actualSlot || slotCode;
  const plate = detectedPlate || session?.licensePlate || 'N/A';

  const handleReassign = async () => {
    if (!session?._id) {
      setErrorMsg('Không tìm thấy mã phiên đỗ xe tương ứng để đổi ô.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await reassignSessionSlot(session._id, {
        newSlotCode: currentActualSlot,
        reason: `Staff chấp nhận đổi ô đỗ từ ${expectedSlot || 'cũ'} sang ${currentActualSlot}`
      });

      if (res.ok && res.data?.success) {
        setSuccessMsg(`Đã cập nhật ô đỗ thành công cho xe ${plate}!`);
        if (onReassignSuccess) {
          onReassignSuccess(session._id, currentActualSlot);
        }
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setErrorMsg(res.data?.message || 'Không thể cập nhật ô đỗ.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi kết nối khi cập nhật ô đỗ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#12161f] border border-red-500/40 rounded-2xl shadow-2xl overflow-hidden text-gray-100 font-sans">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-red-950/80 to-red-900/40 border-b border-red-500/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/40 shadow-inner">
              <ShieldAlert size={22} className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-black text-white uppercase tracking-wide">Wrong-Slot Violation Alert</h3>
              <p className="text-xs text-red-300">Detected by AI Overhead Camera Surveillance</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          
          {/* License Plate & Slot Comparison Box */}
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">License Plate:</span>
              <span className="font-mono text-base font-black px-3 py-1 rounded-lg bg-black border border-white/20 text-amber-300">
                {formatLicensePlateDisplay(plate)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10 text-center">
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">Originally Assigned Slot</span>
                <span className="text-lg font-black text-emerald-400 font-mono">
                  {expectedSlot || 'N/A'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/40">
                <span className="text-[10px] text-red-300 uppercase font-bold block mb-1">Actual Parked Slot</span>
                <span className="text-lg font-black text-red-400 font-mono flex items-center justify-center gap-1">
                  {currentActualSlot}
                  <AlertTriangle size={14} className="text-red-400" />
                </span>
              </div>
            </div>
          </div>

          {/* Session Details */}
          {session && (
            <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2 text-xs">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Customer Details:</span>
              <div className="grid grid-cols-2 gap-2 text-gray-300">
                {session.userId?.username && (
                  <div className="flex items-center gap-1.5">
                    <User size={13} className="text-gray-400" />
                    <span>{session.userId.username}</span>
                  </div>
                )}
                {session.userId?.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone size={13} className="text-cyan-400" />
                    <span className="font-mono">{session.userId.phone}</span>
                  </div>
                )}
                {session.checkInTime && (
                  <div className="flex items-center gap-1.5 col-span-2 text-gray-400">
                    <Clock size={13} />
                    <span>Check-in: {new Date(session.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(session.checkInTime).toLocaleDateString()})</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Success / Error Notifications */}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={handleReassign}
              disabled={loading || !session?._id}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-[0.98]"
            >
              <RotateCw size={15} className={loading ? 'animate-spin' : ''} />
              <span>Reassign Parking Slot to {currentActualSlot}</span>
            </button>

            {onCheckout && session && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCheckout(session);
                }}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition flex items-center justify-center gap-2 border border-white/10"
              >
                <LogOut size={15} className="text-amber-400" />
                <span>Process Check-out Immediately</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

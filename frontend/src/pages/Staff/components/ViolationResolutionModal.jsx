import { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Phone,
  PhoneCall,
  User,
  Clock,
  RotateCw,
  BellRing,
  Camera,
  Volume2,
  VolumeX,
  Mail,
  Crown,
  Send,
  Loader2
} from 'lucide-react';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';
import {
  resolveViolation,
  getDriverContactInfoApi,
  sendViolationWarningEmailApi
} from '../../../services/aiSurveillanceService';
import {
  speakViolationAnnouncement,
  stopAnnouncement,
  isSpeechSupported
} from '../../../utils/speechUtils';
import toast from 'react-hot-toast';

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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [contactData, setContactData] = useState(null);
  const [loadingContact, setLoadingContact] = useState(false);

  const currentActualSlot = violation?.actualSlot || violation?.slotCode;
  const plate = violation?.detectedPlate || violation?.session?.licensePlate || 'N/A';

  // Fetch driver contact & VIP owner info whenever modal opens
  useEffect(() => {
    if (isOpen && (plate || currentActualSlot)) {
      setLoadingContact(true);
      getDriverContactInfoApi(plate, currentActualSlot)
        .then((res) => {
          if (res?.success) {
            setContactData(res);
          } else {
            setContactData(null);
          }
        })
        .catch(() => setContactData(null))
        .finally(() => setLoadingContact(false));
    } else {
      setContactData(null);
      stopAnnouncement();
      setIsSpeaking(false);
    }

    return () => {
      stopAnnouncement();
    };
  }, [isOpen, plate, currentActualSlot]);

  if (!isOpen || !violation) return null;

  const {
    expectedSlot,
    session,
    evidenceSnapshot,
    fullSnapshot,
  } = violation;

  const isPendingPark = violation.status === 'CHECKED_IN_PENDING_PARK' || violation.violationType === 'CHECKED_IN_PENDING_PARK';
  const isVipSlot = Boolean(contactData?.isVipSlot);
  const activePhone = contactData?.driverContact?.phone || session?.userId?.phone || '';
  const activeEmail = contactData?.driverContact?.email || session?.userId?.email || '';
  const customerName = contactData?.driverContact?.fullName || session?.userId?.fullName || session?.userId?.username || 'Khách vãng lai';

  const handleReassign = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await resolveViolation({
        slotCode: currentActualSlot,
        floorId: violation.floorId,
        action: 'REASSIGN_SLOT',
        newSlotCode: currentActualSlot,
        sessionId: session?._id || null,
        note: `Nhân viên chấp nhận đổi ô đỗ sang ${currentActualSlot}`,
      });

      if (res.success) {
        setSuccessMsg(`Đã cập nhật đổi ô thành công sang ${currentActualSlot}!`);
        toast.success(`Đã đổi ô cho xe ${formatLicensePlateDisplay(plate)}`);
        if (onReassignSuccess) {
          onReassignSuccess(session?._id, currentActualSlot);
        }
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setErrorMsg(res.message || 'Không thể cập nhật ô đỗ.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi kết nối khi cập nhật ô đỗ.');
    } finally {
      setLoading(false);
    }
  };

  const handleIssueWarning = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await resolveViolation({
        slotCode: currentActualSlot,
        floorId: violation.floorId,
        action: 'ISSUE_WARNING',
        sessionId: session?._id || null,
        note: `Nhân viên đã nhắc nhở / lập biên bản đối với tài xế xe ${plate}`,
      });

      if (res.success) {
        setSuccessMsg('Đã ghi nhận nhắc nhở thành công vào lịch sử!');
        toast.success('Đã ghi nhận nhắc nhở tài xế');
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setErrorMsg(res.message || 'Không thể lưu ghi nhận.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi kết nối.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleVoiceBroadcast = () => {
    if (isSpeaking) {
      stopAnnouncement();
      setIsSpeaking(false);
    } else {
      speakViolationAnnouncement({
        plate,
        slotCode: currentActualSlot,
        isVip: isVipSlot,
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
        onError: (err) => {
          setIsSpeaking(false);
          toast.error(err.message || 'Không thể phát loa');
        },
      });
    }
  };

  const handleSendWarningEmail = async () => {
    if (!activeEmail) {
      toast.error('Phương tiện này chưa có địa chỉ email trong hệ thống.');
      return;
    }

    setSendingEmail(true);
    try {
      const res = await sendViolationWarningEmailApi({
        slotCode: currentActualSlot,
        detectedPlate: plate,
        recipientEmail: activeEmail,
        isVipSlot,
      });

      if (res?.success) {
        toast.success(res.message || 'Đã gửi email cảnh báo thành công!');
      } else {
        toast.error(res?.message || 'Không thể gửi email cảnh báo');
      }
    } catch (err) {
      toast.error('Lỗi khi gửi email cảnh báo');
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className={`w-full max-w-lg bg-[#121622] border ${isVipSlot ? 'border-amber-500/70 shadow-[0_0_35px_rgba(245,158,11,0.25)]' : isPendingPark ? 'border-purple-500/50' : 'border-red-500/50'} rounded-2xl shadow-2xl overflow-hidden text-gray-100 font-sans`}>
        
        {/* Modal Header */}
        <div className={`flex items-center justify-between px-6 py-4 ${
          isVipSlot 
            ? 'bg-gradient-to-r from-amber-950/90 via-red-950/80 to-amber-900/50 border-b border-amber-500/40' 
            : isPendingPark 
              ? 'bg-gradient-to-r from-purple-950/90 to-indigo-900/50 border-b border-purple-500/30' 
              : 'bg-gradient-to-r from-red-950/90 to-red-900/50 border-b border-red-500/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border shadow-inner ${
              isVipSlot 
                ? 'bg-amber-500/20 text-amber-400 border-amber-400/50' 
                : isPendingPark 
                  ? 'bg-purple-500/20 text-purple-300 border-purple-400/40' 
                  : 'bg-red-500/20 text-red-400 border-red-500/40'
            }`}>
              {isVipSlot ? <Crown size={22} className="animate-bounce" /> : isPendingPark ? <Clock size={22} className="animate-pulse" /> : <ShieldAlert size={22} className="animate-pulse" />}
            </div>
            <div>
              <h3 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
                {isVipSlot ? (
                  <>
                    <span className="text-amber-400">🚨 VI PHẠM Ô VIP:</span>
                    <span>{currentActualSlot}</span>
                  </>
                ) : isPendingPark ? (
                  'Xe Đã Check-in (Chưa Vào Ô)'
                ) : (
                  `Cảnh Báo Đỗ Sai Ô: ${currentActualSlot}`
                )}
              </h3>
              <p className={`text-xs ${isVipSlot ? 'text-amber-300 font-semibold' : isPendingPark ? 'text-purple-300' : 'text-red-300'}`}>
                {isVipSlot ? 'Chiếm dụng trái phép ô đỗ VIP của thành viên!' : isPendingPark ? 'Xe đã qua cổng nhưng chưa đỗ vào vị trí' : 'Phát hiện bởi Camera AI Giám Sát'}
              </p>
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
        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          
          {/* VIP Owner Details Banner if this slot is a dedicated VIP slot */}
          {isVipSlot && contactData?.vipOwner && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-amber-300">
                <span className="flex items-center gap-1.5 uppercase tracking-wide">
                  <Crown size={14} className="text-amber-400" />
                  Chủ Sở Hữu Hợp Pháp Của Ô VIP {currentActualSlot}
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 text-[10px] font-black border border-amber-500/30">
                  {contactData.vipOwner.packageName || 'GÓI VIP'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-1 border-t border-amber-500/20">
                <div>Khách hàng: <strong className="text-white">{contactData.vipOwner.fullName || contactData.vipOwner.username}</strong></div>
                <div>Hạn quyền: <strong className="text-amber-300">{new Date(contactData.vipOwner.expireAt).toLocaleDateString('vi-VN')}</strong></div>
                {contactData.vipOwner.email && (
                  <div className="col-span-2 truncate">Email: <span className="text-cyan-300">{contactData.vipOwner.email}</span></div>
                )}
                {contactData.vipOwner.phone && (
                  <div className="col-span-2 flex items-center gap-1.5">
                    SĐT Chủ VIP: 
                    <a href={`tel:${contactData.vipOwner.phone}`} className="font-mono text-cyan-300 hover:underline font-bold">
                      {contactData.vipOwner.phone}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Smart Crop Evidence Photo if available */}
          {(evidenceSnapshot || fullSnapshot) && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={13} className="text-amber-400" />
                Ảnh Bằng Chứng Từ Camera:
              </span>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-black/60 max-h-[160px] flex items-center justify-center">
                <img
                  src={evidenceSnapshot || fullSnapshot}
                  alt="Evidence"
                  className="w-full h-auto max-h-[160px] object-contain"
                />
              </div>
            </div>
          )}

          {/* License Plate & Slot Comparison Box */}
          <div className={`p-4 rounded-xl border space-y-3 ${isVipSlot ? 'bg-amber-950/20 border-amber-500/40' : isPendingPark ? 'bg-purple-500/10 border-purple-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Biển số phát hiện:</span>
              <span className="font-mono text-base font-black px-3 py-1 rounded-lg bg-black border border-white/20 text-amber-300 shadow-inner flex items-center gap-1.5">
                {isVipSlot && <span className="text-xs text-amber-400">⚠️</span>}
                {formatLicensePlateDisplay(plate)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10 text-center">
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">Ô cấp phép ban đầu</span>
                <span className="text-lg font-black text-emerald-400 font-mono">
                  {expectedSlot || (isVipSlot ? 'Không có (Chiếm VIP)' : 'Chưa đăng ký')}
                </span>
              </div>
              <div className={`p-2.5 rounded-lg border ${isVipSlot ? 'bg-amber-950/60 border-amber-500/50' : isPendingPark ? 'bg-purple-950/60 border-purple-500/40' : 'bg-red-950/60 border-red-500/40'}`}>
                <span className={`text-[10px] uppercase font-bold block mb-1 ${isVipSlot ? 'text-amber-300' : isPendingPark ? 'text-purple-300' : 'text-red-300'}`}>
                  {isPendingPark ? 'Trạng thái ô' : 'Ô đang đỗ thực tế'}
                </span>
                <span className={`text-base font-black font-mono flex items-center justify-center gap-1 ${isVipSlot ? 'text-amber-300 text-lg' : isPendingPark ? 'text-purple-300' : 'text-red-400 text-lg'}`}>
                  {isPendingPark ? 'Trống (Chưa vào)' : `Ô ${currentActualSlot}`}
                  {isVipSlot ? <Crown size={15} className="text-amber-400" /> : isPendingPark ? <Clock size={14} className="text-purple-400" /> : <AlertTriangle size={14} className="text-red-400" />}
                </span>
              </div>
            </div>
          </div>

          {/* Voice PA Broadcast (Phát Loa Thông Báo Bãi Đỗ) */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 size={15} className="text-amber-400" />
                Hệ Thống Phát Loa Bãi Đỗ (Giọng Nói AI)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Tiếng Việt • PA Chime</span>
            </div>

            <button
              type="button"
              onClick={handleToggleVoiceBroadcast}
              className={`w-full py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 border shadow-lg active:scale-[0.98] ${
                isSpeaking
                  ? 'bg-red-500 text-white border-red-400 animate-pulse'
                  : 'bg-amber-400 hover:bg-amber-300 text-black border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
              }`}
            >
              {isSpeaking ? (
                <>
                  <VolumeX size={16} />
                  <span>⏹️ Dừng Phát Loa Ngay</span>
                </>
              ) : (
                <>
                  <Volume2 size={16} />
                  <span>📢 Phát Loa Nhắc Nhở Biển Số {formatLicensePlateDisplay(plate)}</span>
                </>
              )}
            </button>
          </div>

          {/* Offending Vehicle Contact Details */}
          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2.5 text-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Thông tin liên hệ tài xế:</span>
            <div className="grid grid-cols-2 gap-2 text-gray-300">
              <div className="flex items-center gap-1.5">
                <User size={13} className="text-gray-400" />
                <span className="font-semibold text-white truncate">{customerName}</span>
              </div>

              {activePhone ? (
                <div className="flex items-center gap-1.5">
                  <PhoneCall size={13} className="text-emerald-400" />
                  <a href={`tel:${activePhone}`} className="font-mono text-emerald-300 hover:underline font-bold">
                    {activePhone}
                  </a>
                </div>
              ) : (
                <div className="text-gray-500 italic">Chưa có SĐT (Xe vãng lai)</div>
              )}

              {activeEmail && (
                <div className="flex items-center gap-1.5 col-span-2 text-slate-300">
                  <Mail size={13} className="text-cyan-400" />
                  <span className="truncate">{activeEmail}</span>
                </div>
              )}

              {session?.checkInTime && (
                <div className="flex items-center gap-1.5 col-span-2 text-gray-400">
                  <Clock size={13} />
                  <span>Check-in: {new Date(session.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(session.checkInTime).toLocaleDateString()})</span>
                </div>
              )}
            </div>
          </div>

          {/* Feedback messages */}
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

          {/* Quick Action Suite: Call + Email + Reassign */}
          <div className="pt-2 space-y-2.5">
            {/* Direct Phone & Email Actions */}
            <div className="grid grid-cols-2 gap-2">
              {activePhone ? (
                <a
                  href={`tel:${activePhone}`}
                  className="py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-extrabold text-xs transition flex items-center justify-center gap-1.5 border border-emerald-500/40 shadow-sm"
                >
                  <PhoneCall size={14} className="text-emerald-400" />
                  <span>Gọi Ngay ({activePhone})</span>
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="py-2.5 rounded-xl bg-white/5 text-gray-500 text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/5 cursor-not-allowed"
                >
                  <Phone size={14} />
                  <span>Không có SĐT</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSendWarningEmail}
                disabled={sendingEmail || !activeEmail}
                className={`py-2.5 rounded-xl font-extrabold text-xs transition flex items-center justify-center gap-1.5 border shadow-sm ${
                  activeEmail
                    ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border-cyan-500/40 active:scale-[0.98]'
                    : 'bg-white/5 text-gray-500 border-white/5 cursor-not-allowed'
                }`}
                title={activeEmail ? `Gửi email cảnh báo tới ${activeEmail}` : 'Không có địa chỉ email'}
              >
                {sendingEmail ? (
                  <Loader2 size={14} className="animate-spin text-cyan-400" />
                ) : (
                  <Send size={14} className={activeEmail ? 'text-cyan-400' : 'text-gray-500'} />
                )}
                <span>Gửi Email Cảnh Báo</span>
              </button>
            </div>

            {/* Reassign / Relocate Button */}
            <button
              type="button"
              onClick={handleReassign}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-[0.98]"
            >
              <RotateCw size={15} className={loading ? 'animate-spin' : ''} />
              <span>Chấp Nhận Cho Đỗ Ô {currentActualSlot} (Đổi Ô)</span>
            </button>

            {/* Issue Warning Button */}
            <button
              type="button"
              onClick={handleIssueWarning}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-extrabold text-xs transition flex items-center justify-center gap-1.5 border border-amber-500/30 active:scale-[0.98]"
            >
              <BellRing size={14} />
              <span>Lập Biên Bản Nhắc Nhở / Khóa Bánh</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


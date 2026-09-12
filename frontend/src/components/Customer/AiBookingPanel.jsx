import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarDays, CheckCircle2, Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react';
import PolicyAcceptancePrompt from '../policies/PolicyAcceptancePrompt';
import { extractMissingPolicies, isPolicyAcceptanceRequired } from '../../utils/policyErrors';
import { interpretAiBooking } from '../../services/aiBookingService';
import {
  cancelBooking, createBookingHold, createBulkBooking, extendBooking,
  getAvailableBookingSlots, getBookingCancellationQuote, getMyBookings,
  quoteBulkBooking, releaseBookingHold,
} from '../../services/bookingService';
import { getWalletInfo } from '../../services/walletService';
import { checkAiAvailability, confirmAiBooking, confirmAiExistingAction, findAiActionBookings, prepareAiBooking, prepareAiExistingAction } from '../../utils/aiBookingFlow';
import { createAiBookingRecognition } from '../../utils/aiBookingVoice';

const gateway = {
  cancelBooking, createBookingHold, createBulkBooking, extendBooking,
  getAvailableBookingSlots, getBookingCancellationQuote, getMyBookings,
  getWalletInfo, quoteBulkBooking, releaseBookingHold,
};
const money = (amount) => `${Number(amount || 0).toLocaleString('vi-VN')} VND`;
const dayText = (day) => day?.split('-').reverse().join('/') || '';
const nowInVietnam = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const vnParts = (value) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
};
const bookingStart = (booking) => booking.scheduledStart || booking.startTime;
const bookingEnd = (booking) => booking.scheduledEnd || booking.endTime;
const labelBooking = (booking) => {
  const time = vnParts(bookingStart(booking));
  return `${dayText(time.date)} · ${time.time} · ${booking.licensePlate} · ${booking.parkingSlot || booking.slotCode}`;
};

export default function AiBookingPanel({ vehicles = [], onSwitchToManual }) {
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState({});
  const [intent, setIntent] = useState('UNKNOWN');
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Chào bạn! Hãy nói ngày, giờ và xe cần đặt. Ví dụ: “Đặt chỗ ngày mai từ 8 giờ đến 10 giờ”.' }]);
  const [preview, setPreview] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [availability, setAvailability] = useState(null);
  const [choices, setChoices] = useState([]);
  const [target, setTarget] = useState(null);
  const [actionQuote, setActionQuote] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [policyItems, setPolicyItems] = useState([]);
  const [manualSuggestion, setManualSuggestion] = useState(false);
  const recognitionRef = useRef(null);
  const requestRef = useRef(0);
  const confirmationKeyRef = useRef(null);
  const busyRef = useRef(false);
  const conversationRef = useRef(null);

  useEffect(() => () => {
    requestRef.current += 1;
    recognitionRef.current?.abort();
  }, []);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, busy, error]);

  const say = (text) => setMessages((current) => [...current, { role: 'assistant', text }]);
  const clearResult = () => {
    setPreview(null); setConflicts([]); setAvailability(null); setChoices([]); setTarget(null);
    setActionQuote(null); setEdit(null); setSuccess(null); setError(''); setManualSuggestion(false);
    confirmationKeyRef.current = null;
  };

  const findTargetBookings = async (nextIntent, nextDraft) => {
    const bookings = await findAiActionBookings(nextIntent, nextDraft, gateway);
    if (!bookings.length) {
      say('Mình không tìm thấy booking phù hợp trong tài khoản của bạn. Hãy kiểm tra ngày hoặc biển số.');
      return;
    }
    if (nextIntent === 'VIEW_BOOKING') {
      setChoices(bookings.slice(0, 10));
      say(`Bạn có ${bookings.length} booking phù hợp. Chọn một booking bên phải để xem chi tiết.`);
      return;
    }
    setChoices(bookings);
    say(bookings.length === 1 ? 'Mình đã tìm thấy booking. Hãy xem kỹ trước khi tiếp tục.' : 'Có nhiều booking phù hợp. Hãy chọn đúng booking cần thao tác.');
    if (bookings.length === 1) await selectTarget(bookings[0], nextIntent, nextDraft);
  };

  const selectTarget = async (booking, nextIntent = intent, nextDraft = draft) => {
    setTarget(booking);
    setError('');
    if (nextIntent === 'CANCEL_BOOKING') {
      setActionQuote(await prepareAiExistingAction(nextIntent, booking, gateway));
    }
    if (nextIntent === 'MODIFY_BOOKING') {
      const start = vnParts(bookingStart(booking));
      const end = vnParts(bookingEnd(booking));
      setEdit({
        startDate: booking.status === 'PAID' ? nextDraft.startDate || start.date : start.date,
        startTime: booking.status === 'PAID' ? nextDraft.startTime || start.time : start.time,
        endDate: nextDraft.endDate || end.date,
        endTime: nextDraft.endTime || end.time,
      });
    }
  };

  const submitMessage = async (spokenText) => {
    const text = String(spokenText ?? prompt).trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    const request = ++requestRef.current;
    setPrompt('');
    clearResult();
    setMessages((current) => [...current, { role: 'user', text }]);
    setBusy(true);
    try {
      const result = await interpretAiBooking(text, { ...draft, __intent: intent }, nowInVietnam());
      if (!result.ok) {
        if (result.status === 404 && /Route .* not found/i.test(result.data?.message || '')) {
          throw new Error('Backend đang chạy phiên bản cũ chưa có AI Booking. Vui lòng khởi động lại backend rồi thử lại.');
        }
        throw new Error(result.data?.message || 'AI chưa xử lý được yêu cầu.');
      }
      if (request !== requestRef.current) return;
      const nextIntent = result.data?.data?.intent || 'UNKNOWN';
      const nextDraft = result.data?.data?.draft || {};
      const clarification = result.data?.data?.clarification;
      setIntent(nextIntent); setDraft(nextDraft);
      if (clarification) {
        say(clarification);
        setManualSuggestion(clarification.includes('Đặt chỗ thủ công'));
        return;
      }
      if (nextIntent === 'CREATE_BOOKING') {
        const nextPreview = await prepareAiBooking(nextDraft, gateway, vehicles);
        if (nextPreview.missing) say(nextPreview.missing.join(' '));
        else if (nextPreview.conflicts) { setConflicts(nextPreview.conflicts); say(nextPreview.conflicts.join('\n')); }
        else {
          setDraft((current) => ({ ...current, vehicleId: nextPreview.items[0]?.vehicleId || '', licensePlate: nextPreview.items[0]?.licensePlate || current.licensePlate }));
          setPreview(nextPreview); confirmationKeyRef.current = crypto.randomUUID();
          say('Mình đã chuẩn bị bản xem trước. Bạn có thể sửa thông tin rồi kiểm tra lại trước khi xác nhận.');
        }
      } else if (nextIntent === 'CHECK_AVAILABILITY') {
        const checked = await checkAiAvailability(nextDraft, gateway);
        if (checked.missing) say(checked.missing.join(' '));
        else { setAvailability(checked.availability); say('Đây là số chỗ còn trống theo từng ngày.'); }
      } else if (['CANCEL_BOOKING', 'MODIFY_BOOKING', 'VIEW_BOOKING'].includes(nextIntent)) {
        await findTargetBookings(nextIntent, nextDraft);
      } else say('Mình hỗ trợ đặt chỗ, kiểm tra chỗ trống, xem, sửa hoặc hủy booking. Bạn muốn làm gì?');
    } catch (caught) {
      setError(caught.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
      setPrompt((current) => current || text);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const refreshPreview = async () => {
    setBusy(true); setError(''); setPreview(null); setConflicts([]);
    try {
      const checked = await prepareAiBooking(draft, gateway, vehicles);
      if (checked.missing) say(checked.missing.join(' '));
      else if (checked.conflicts) { setConflicts(checked.conflicts); say(checked.conflicts.join('\n')); }
      else {
        setDraft((current) => ({ ...current, vehicleId: checked.items[0]?.vehicleId || '', licensePlate: checked.items[0]?.licensePlate || current.licensePlate }));
        setPreview(checked); confirmationKeyRef.current = crypto.randomUUID(); say('Bản xem trước đã được cập nhật.');
      }
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const confirmCreation = async () => {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      const result = await confirmAiBooking(preview, draft, gateway, vehicles, confirmationKeyRef.current);
      if (result.refreshed) {
        setPreview(result.refreshed.items ? result.refreshed : null);
        setConflicts(result.refreshed.conflicts || []);
        say(result.refreshed.conflicts?.join('\n') || 'Thông tin chỗ hoặc giá đã thay đổi. Vui lòng xem lại và xác nhận lần nữa.');
      } else {
        setSuccess(result.success);
        setPreview(null);
        say('Đặt chỗ thành công! Bạn có thể xem mã QR trong My Bookings.');
      }
    } catch (caught) {
      if (isPolicyAcceptanceRequired(caught.responseData)) setPolicyItems(extractMissingPolicies(caught.responseData));
      setError(caught.message || 'Không thể tạo booking. Vui lòng thử lại.');
    } finally { setBusy(false); }
  };

  const confirmExistingAction = async () => {
    if (!target || busy) return;
    setBusy(true); setError('');
    try {
      const result = await confirmAiExistingAction(intent, target, edit, gateway);
      setSuccess(result);
      setTarget(null); setChoices([]); setActionQuote(null);
      say(intent === 'CANCEL_BOOKING' ? 'Booking đã được hủy.' : 'Booking đã được cập nhật.');
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const startVoice = () => {
    setError('');
    const recognition = createAiBookingRecognition(window, {
      onTranscript: submitMessage,
      onError: setError,
      onEnd: () => { setListening(false); recognitionRef.current = null; },
    });
    if (!recognition) { setError('Trình duyệt này chưa hỗ trợ nhận giọng nói. Bạn có thể nhập bằng bàn phím.'); return; }
    try {
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError('Không thể mở micro. Vui lòng thử lại hoặc nhập bằng bàn phím.');
    }
  };

  const changeDraft = (field, value) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === 'startDate' && (!current.endDate || current.endDate === current.startDate) ? { endDate: value } : {}),
      ...(['startTime', 'endTime'].includes(field) ? { pendingStartTime: '', pendingEndTime: '' } : {}),
    }));
    setPreview(null); setConflicts([]);
  };
  const fieldClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-yellow-400';

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 pb-8">
      <section className="xl:col-span-5 rounded-3xl border border-gray-200 bg-white shadow-sm flex flex-col min-h-[560px] overflow-hidden">
        <div className="border-b border-gray-100 bg-gradient-to-r from-yellow-50 to-white px-5 py-4 flex items-center gap-3">
          <div className="rounded-2xl bg-yellow-400 p-2.5 text-gray-900"><Bot size={22} /></div>
          <div><h2 className="font-black text-gray-900">Trợ lý đặt chỗ VALO</h2><p className="text-xs text-gray-500">Nhập hoặc nói yêu cầu bằng tiếng Việt</p></div>
        </div>
        <div ref={conversationRef} className="flex-1 max-h-[520px] overflow-y-auto px-5 py-5 space-y-3" aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={`max-w-[90%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'ml-auto bg-gray-900 text-white' : 'bg-yellow-50 border border-yellow-100 text-gray-800'}`}>{message.text}</div>
          ))}
          {busy && <div className="inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Đang xử lý...</div>}
        </div>
        {error && <div role="alert" className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {manualSuggestion && onSwitchToManual && <button type="button" onClick={onSwitchToManual} className="mx-5 mb-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-bold text-yellow-900">Chuyển sang Đặt chỗ thủ công</button>}
        <form className="border-t border-gray-100 p-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ví dụ: Đặt chỗ ngày mai từ 8h đến 10h" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-yellow-400" aria-label="Yêu cầu cho AI Booking" />
          <button type="button" onClick={() => { if (listening) recognitionRef.current?.stop(); else startVoice(); }} className={`rounded-xl p-3 ${listening ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-700'}`} aria-label={listening ? 'Dừng ghi âm' : 'Nhập bằng giọng nói'}>{listening ? <MicOff size={19} /> : <Mic size={19} />}</button>
          <button type="submit" disabled={!prompt.trim() || busy} className="rounded-xl bg-yellow-400 p-3 text-gray-900 disabled:opacity-50" aria-label="Gửi yêu cầu"><Send size={19} /></button>
        </form>
      </section>

      <section className="xl:col-span-7 rounded-3xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm min-h-[560px]">
        <div className="mb-5 flex items-center gap-3"><Sparkles size={21} className="text-yellow-500" /><div><h2 className="text-lg font-black text-gray-900">{intent === 'CHECK_AVAILABILITY' ? 'Chỗ còn trống' : intent === 'VIEW_BOOKING' ? 'Booking của bạn' : intent === 'CANCEL_BOOKING' ? 'Xác nhận hủy' : intent === 'MODIFY_BOOKING' ? 'Sửa booking' : 'Xem trước booking'}</h2><p className="text-xs text-gray-500">Mọi thay đổi chỉ được thực hiện sau khi bạn xác nhận.</p></div></div>

        {success && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><div className="flex items-center gap-2 font-black"><CheckCircle2 size={20} /> Thao tác thành công</div><Link to="/customer/booking" className="mt-2 inline-block text-sm font-bold underline">Xem My Bookings</Link></div>}

        {intent === 'CREATE_BOOKING' && (draft.startDate || draft.startTime || draft.licensePlate) && !success && (
          <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-bold text-gray-500">Từ ngày<input type="date" value={draft.startDate || ''} onChange={(event) => changeDraft('startDate', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Đến ngày<input type="date" value={draft.endDate || draft.startDate || ''} onChange={(event) => changeDraft('endDate', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Giờ vào<input type="time" value={draft.startTime || ''} onChange={(event) => changeDraft('startTime', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Giờ ra<input type="time" value={draft.endTime || ''} onChange={(event) => changeDraft('endTime', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Xe<select value={draft.vehicleId || ''} onChange={(event) => { const vehicle = vehicles.find((item) => item._id === event.target.value); setDraft((current) => ({ ...current, vehicleId: vehicle?._id || '', licensePlate: vehicle?.licensePlate || '' })); setPreview(null); }} className={fieldClass}><option value="">Chọn xe hoặc nhập biển số</option>{vehicles.filter((item) => item.status === 'approved' && (!draft.vehicleType || item.vehicleType === draft.vehicleType)).map((vehicle) => <option key={vehicle._id} value={vehicle._id}>{vehicle.licensePlate}</option>)}</select></label>
            <label className="text-xs font-bold text-gray-500">Biển số<input value={draft.licensePlate || ''} onChange={(event) => { setDraft((current) => ({ ...current, vehicleId: '', licensePlate: event.target.value })); setPreview(null); }} className={fieldClass} placeholder="43A12345" /></label>
            <label className="text-xs font-bold text-gray-500">Tầng (không bắt buộc)<input value={draft.floorName || ''} onChange={(event) => changeDraft('floorName', event.target.value)} className={fieldClass} placeholder="Floor 2" /></label>
            <label className="text-xs font-bold text-gray-500">Ô đỗ (không bắt buộc)<input value={draft.slotCode || ''} onChange={(event) => changeDraft('slotCode', event.target.value)} className={fieldClass} placeholder="A-015" /></label>
            <button type="button" onClick={refreshPreview} disabled={busy} className="sm:col-span-2 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 font-black text-yellow-900 disabled:opacity-50">Kiểm tra lại chỗ và giá</button>
          </div>
        )}

        {conflicts.length > 0 && <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="mb-2 font-black">Chưa thể đặt chỗ</div>{conflicts.map((conflict, index) => <p key={index} className="mb-1">{conflict}</p>)}</div>}

        {preview?.items && <div className="space-y-3">
          {preview.items.map((item, index) => <div key={item.clientItemId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex flex-wrap items-center justify-between gap-2"><div><div className="font-black text-gray-900">{dayText(item.date)} · {draft.startTime}–{draft.endTime}</div><div className="text-sm text-gray-500">{item.licensePlate} · {item.floorName} · {item.slotCode}</div></div><strong className="text-yellow-700">{money(preview.quotes?.[index]?.totalAmount)}</strong></div>)}
          <div className="rounded-2xl bg-gray-900 p-5 text-white flex justify-between items-center"><span>Tổng tạm tính · {preview.durationMinutes} phút/ngày</span><strong className="text-xl text-yellow-300">{money(preview.total)}</strong></div>
          {preview.walletBalance < preview.total && <p className="text-sm text-rose-600">Ví còn {money(preview.walletBalance)}. <Link to="/customer/wallet" className="font-bold underline">Nạp thêm</Link> trước khi xác nhận.</p>}
          <div className="flex gap-3"><button type="button" onClick={confirmCreation} disabled={busy || preview.walletBalance < preview.total} className="flex-1 rounded-xl bg-yellow-400 px-4 py-3 font-black text-gray-900 disabled:opacity-50">Xác nhận đặt chỗ</button><button type="button" onClick={() => { setPreview(null); say('Đã hủy bản xem trước. Chưa có booking nào được tạo.'); }} className="rounded-xl border border-gray-200 px-4 py-3 font-bold text-gray-600">Hủy</button></div>
        </div>}

        {availability && <div className="space-y-3">{availability.map((day) => <div key={day.date} className="rounded-2xl border border-gray-200 p-4"><strong>{dayText(day.date)}: {day.count} chỗ trống</strong><p className="text-sm text-gray-500">{day.suggestions.map((slot) => `${slot.floorName} · ${slot.slotCode}`).join(', ') || 'Hãy thử giờ hoặc tầng khác.'}</p></div>)}</div>}

        {choices.length > 0 && <div className="space-y-2 mb-5">{choices.map((booking) => <button key={booking._id} type="button" onClick={() => selectTarget(booking).catch((caught) => setError(caught.message))} className={`block w-full rounded-xl border p-4 text-left text-sm font-bold ${target?._id === booking._id ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300'}`}>{labelBooking(booking)} <span className="ml-2 text-gray-400">{booking.status}</span></button>)}</div>}

        {target && intent === 'VIEW_BOOKING' && <div className="rounded-2xl bg-gray-50 p-5 text-sm"><p className="font-black">{labelBooking(target)}</p><p>Trạng thái: {target.status}</p><p>Giá đã trả: {money(target.prepaidAmount)}</p></div>}
        {target && intent === 'CANCEL_BOOKING' && actionQuote && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><p className="font-black text-gray-900">{labelBooking(target)}</p><p className="mt-2 text-sm text-gray-700">Số tiền hoàn dự kiến: {money(actionQuote.refundAmount)}</p><div className="mt-4 flex gap-3"><button type="button" disabled={busy} onClick={confirmExistingAction} className="rounded-xl bg-rose-600 px-4 py-3 font-black text-white">Xác nhận hủy booking</button><button type="button" onClick={() => setTarget(null)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">Giữ booking</button></div></div>}
        {target && intent === 'MODIFY_BOOKING' && edit && <div className="rounded-2xl bg-gray-50 p-5 space-y-3"><p className="font-black">{labelBooking(target)}</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Ngày vào<input type="date" value={edit.startDate} disabled={target.status !== 'PAID'} onChange={(event) => setEdit((current) => ({ ...current, startDate: event.target.value }))} className={`${fieldClass} disabled:opacity-50`} /></label><label className="text-xs font-bold">Giờ vào<input type="time" value={edit.startTime} disabled={target.status !== 'PAID'} onChange={(event) => setEdit((current) => ({ ...current, startTime: event.target.value }))} className={`${fieldClass} disabled:opacity-50`} /></label><label className="text-xs font-bold">Ngày ra<input type="date" value={edit.endDate} onChange={(event) => setEdit((current) => ({ ...current, endDate: event.target.value }))} className={fieldClass} /></label><label className="text-xs font-bold">Giờ ra<input type="time" value={edit.endTime} onChange={(event) => setEdit((current) => ({ ...current, endTime: event.target.value }))} className={fieldClass} /></label></div><p className="text-xs text-gray-500">{target.status === 'PAID' ? 'Hệ thống sẽ kiểm tra chỗ và tính phí chênh lệch khi xác nhận.' : 'Xe đã vào bãi: chỉ có thể đổi giờ ra. Hệ thống sẽ tính phí chênh lệch khi xác nhận.'}</p><div className="flex gap-3"><button type="button" disabled={busy} onClick={confirmExistingAction} className="rounded-xl bg-yellow-400 px-4 py-3 font-black">Xác nhận sửa booking</button><button type="button" onClick={() => setTarget(null)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">Hủy</button></div></div>}

        {!preview && !availability && !choices.length && !success && !conflicts.length && <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-center text-gray-400"><CalendarDays size={32} className="mb-3" /><p className="text-sm">Bản xem trước sẽ xuất hiện ở đây sau khi AI hiểu yêu cầu.</p></div>}
      </section>
      <PolicyAcceptancePrompt open={policyItems.length > 0} missingPolicies={policyItems} onClose={() => setPolicyItems([])} onAccepted={() => { setPolicyItems([]); say('Đã chấp nhận chính sách. Vui lòng xác nhận booking lại.'); }} />
    </div>
  );
}

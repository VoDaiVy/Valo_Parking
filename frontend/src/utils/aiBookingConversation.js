const normalize = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const confirmationPhrases = new Set([
  'dat', 'dat cho', 'dat di', 'dat ngay', 'dat luon', 'dat cho nay', 'dat cho nay di',
  'ok', 'oke', 'okay', 'ok dat', 'oke dat', 'ok dat di', 'oke dat di',
  'u', 'uh', 'um', 'da', 'vang', 'co', 'co dat', 'duoc', 'duoc roi',
  'chot', 'chot di', 'chot luon', 'cho', 'lam di', 'tiep tuc',
  'xac nhan', 'xac nhan dat', 'xac nhan dat cho', 'dong y', 'toi dong y',
  'ok dat', 'oke dat', 'duoc dat cho toi', 'duoc roi dat cho toi', 'tien hanh dat',
  'tien hanh dat cho', 'toi muon xac nhan', 'toi muon xac nhan dat cho',
  'toi xac nhan dat cho', 'dong y dat cho', 'dat cho toi', 'dat cho toi di',
]);
const cancellationPhrases = new Set([
  'khong', 'huy', 'khong dat nua', 'thoi', 'huy dat', 'huy dat cho',
  'khong dong y', 'toi khong dong y', 'khong xac nhan', 'khong muon dat nua',
  'thoi khong dat', 'toi huy dat cho',
]);

export function routeBookingReply(phase, message) {
  const value = normalize(message).replace(/^(?:da|vang)\s+/, '').replace(/\s+(?:nhe|nha)$/, '');
  if (phase !== 'WAITING_CONFIRMATION') {
    if (confirmationPhrases.has(value)) return 'no_preview';
    if (cancellationPhrases.has(value)) return 'cancel_draft';
    return 'interpret';
  }
  // A negative word always wins over a positive one. Never book a mixed reply.
  if (/\b(khong|huy|thoi|dung)\b/.test(value)) {
    return cancellationPhrases.has(value) ? 'cancel' : 'clarify';
  }
  if (confirmationPhrases.has(value)) return 'confirm';
  if (/\b(doi|sua|chuyen|thay|ngay|mai|hom|thu|cuoi tuan|gio|bien|xe|tang|floor|slot|o do|buoi|sang|chieu|toi|trua|\d{1,2}h|\d{1,2}:\d{2})\b/.test(value)) {
    return 'interpret';
  }
  return 'clarify';
}

export function routeAssistantActionReply(message) {
  const value = normalize(message).replace(/^(?:da|vang)\s+/, '').replace(/\s+(?:nhe|nha)$/, '');
  if (/\b(khong|huy|thoi|dung)\b/.test(value)) return 'cancel';
  if (confirmationPhrases.has(value)
    || /^(?:dong y|xac nhan|ok|oke|duoc)(?:\s+(?:them|xoa|sua|cap nhat|lam))?(?:\s+(?:xe|di))?$/.test(value)
    || /^(?:them|xoa|sua|cap nhat|lam)\s+di$/.test(value)) return 'confirm';
  return 'interpret';
}

export function bookingPreviewSummary(preview, draft = {}) {
  const items = preview?.items || [];
  if (!items.length) return '';
  const parts = (value, fallbackDate, fallbackTime) => {
    if (!value || Number.isNaN(new Date(value).getTime())) {
      return { date: String(fallbackDate || '').split('-').reverse().join('/'), time: fallbackTime || '' };
    }
    const formatted = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (name) => formatted.find((entry) => entry.type === name)?.value || '';
    return { date: `${part('day')}/${part('month')}/${part('year')}`, time: `${part('hour')}:${part('minute')}` };
  };
  const payment = Number(preview.walletBalance) < Number(preview.total)
    ? 'Ví chưa đủ tiền. Vui lòng nạp thêm.'
    : 'Xác nhận đặt?';
  if (items.length === 1) {
    const start = parts(items[0].startTime, items[0].date, draft.startTime);
    const end = parts(items[0].endTime, items[0].date, draft.endTime);
    return `${start.date}, ${start.time}–${end.time}. Xe ${items[0].licensePlate}. `
      + `${items[0].floorName}, ô ${items[0].slotCode}. ${Number(preview.total).toLocaleString('vi-VN')}đ. ${payment}`;
  }
  const details = items.map((item) => {
    const start = parts(item.startTime, item.date, draft.startTime);
    const end = parts(item.endTime, item.date, draft.endTime);
    return { item, start, end };
  });
  const sameSchedule = details.every(({ start, end }) => (
    start.date === details[0].start.date
    && start.time === details[0].start.time
    && end.time === details[0].end.time
  ));
  const lines = sameSchedule
    ? details.map(({ item }) => `- ${item.licensePlate}: ${item.floorName}, ô ${item.slotCode}`)
    : details.map(({ item, start, end }) => (
      `- ${item.licensePlate}: ${start.date}, ${start.time}–${end.time}, ${item.floorName}, ô ${item.slotCode}`
    ));
  const heading = sameSchedule
    ? `${items.length} xe, ${details[0].start.date}, ${details[0].start.time}–${details[0].end.time}:`
    : `${items.length} chỗ:`;
  return `${heading}\n${lines.join('\n')}\nTổng ${Number(preview.total).toLocaleString('vi-VN')}đ. `
    + (Number(preview.walletBalance) < Number(preview.total)
      ? 'Ví chưa đủ tiền. Vui lòng nạp thêm.'
      : `Xác nhận đặt ${items.length} chỗ?`);
}

export function vipPlatePrompt(plate) {
  return `Xe ${plate} có VIP. Hãy đọc hoặc nhập biển số khác; mình giữ nguyên ngày giờ.`;
}

export function bookingSuccessSummary(items = []) {
  if (!items.length) return 'Đặt chỗ thành công. QR có trong My Bookings.';
  const details = items.map((item) => {
    const bookingDate = String(item.date || '').split('-').reverse().join('/');
    return `${bookingDate ? `${bookingDate}: ` : ''}xe ${item.licensePlate}, ${item.floorName}, ô ${item.slotCode}`;
  });
  if (details.length === 1) return `Đặt xong. ${details[0]}. QR trong My Bookings.`;
  return `Đặt xong ${details.length} chỗ:\n${details.map((detail) => `- ${detail}`).join('\n')}\nQR trong My Bookings.`;
}

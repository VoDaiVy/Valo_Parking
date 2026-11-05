const normalize = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const floorLabel = (value, language) => {
  const text = String(value || '');
  return language === 'en' ? text.replace(/^Tầng\b/i, 'Floor') : text.replace(/^Floor\b/i, 'Tầng');
};

const confirmationPhrases = new Set([
  'dat', 'dat cho', 'dat di', 'dat ngay', 'dat luon', 'dat cho nay', 'dat cho nay di',
  'ok', 'oke', 'okay', 'ok dat', 'oke dat', 'ok dat di', 'oke dat di',
  'u', 'uh', 'um', 'da', 'vang', 'co', 'co dat', 'duoc', 'duoc roi',
  'chot', 'chot di', 'chot luon', 'cho', 'lam di', 'tiep tuc',
  'xac nhan', 'xac nhan dat', 'xac nhan dat cho', 'dong y', 'toi dong y',
  'ok dat', 'oke dat', 'duoc dat cho toi', 'duoc roi dat cho toi', 'tien hanh dat',
  'tien hanh dat cho', 'toi muon xac nhan', 'toi muon xac nhan dat cho',
  'toi xac nhan dat cho', 'dong y dat cho', 'dat cho toi', 'dat cho toi di',
  'yes', 'yes please', 'confirm', 'confirm booking', 'book it', 'go ahead', 'proceed',
  'looks good', 'that is correct', 'thats correct', 'do it', 'reserve it',
  'yes confirm', 'confirm it', 'thats right', 'everything looks good',
  'yes thats what i want', 'please confirm', 'you can book it', 'thats fine', 'im ready',
]);
const cancellationPhrases = new Set([
  'khong', 'huy', 'khong dat nua', 'thoi', 'huy dat', 'huy dat cho',
  'khong dong y', 'toi khong dong y', 'khong xac nhan', 'khong muon dat nua',
  'thoi khong dat', 'toi huy dat cho',
  'no', 'no thanks', 'cancel', 'cancel it', 'never mind', 'nevermind', 'stop',
  'do not book', 'dont book', 'not now',
  'cancel this', 'cancel the booking', 'forget it', 'cancel that', 'i want to cancel',
  'i dont want to book anymore', 'dont book it', 'i changed my mind',
]);
const topUpPhrases = new Set([
  'nap', 'nap them', 'nap tien', 'nap vi', 'nap them tien', 'nap them vao vi',
  'toi muon nap', 'toi muon nap them', 'minh muon nap them', 'nap cho toi',
  'them tien', 'them tien vao vi', 'top up', 'topup',
  'thanh toan', 'thanh toan qr', 'thanh toan bang qr', 'thanh toan qua qr',
  'quet qr', 'quet ma qr', 'mo qr', 'mo ma qr', 'hien qr', 'hien ma qr',
  'tao qr', 'tao ma qr', 'ma qr', 'qr', 'cho toi ma qr', 'chuyen khoan',
  'add money', 'add funds', 'top up wallet', 'pay by qr', 'pay with qr',
  'show qr', 'show qr code', 'bank transfer', 'make payment',
]);
const isTopUpRequest = (value) => topUpPhrases.has(value)
  || /^(?:toi|minh)?\s*(?:muon|can|hay|lam|cho)?\s*(?:nap|them)\s+(?:them\s+)?(?:tien|vao\s+vi|tien\s+vao\s+vi)$/i.test(value)
  || /^(?:wallet\s+)?(?:top\s*up|add\s+(?:more\s+)?(?:money|funds))(?:\s+(?:my\s+)?wallet)?$/i.test(value);

export const isVipInquiry = (value) => {
  const text = normalize(value);
  return /\b(goi\s+vip|goi\s+thang|goi\s+nam|ve\s+thang|ve\s+nam|dang\s+ky\s+vip|mua\s+vip|quyen\s+loi\s+vip|bang\s+gia\s+goi|vip\s+packages?|membership|monthly\s+(?:pass|package)|annual\s+(?:pass|package)|yearly\s+(?:pass|package)|subscription\s+plans?|parking\s+packages?)\b/i.test(text)
    || /\b(?:xem|mo|hien|liet\s+ke|cho\s+xem|tham\s+khao)\s+(?:cac\s+|nhung\s+)?goi(?:\s+(?:vip|thang|nam|ve|uu\s+dai))?\b/i.test(text)
    || /\b(?:cac|nhung)\s+goi(?:\s+(?:vip|thang|nam|ve|uu\s+dai))?\b/i.test(text)
    || /\b(?:show|view|list|see)\s+(?:the\s+|all\s+|available\s+)?(?:vip\s+|parking\s+|monthly\s+)?packages?\b/i.test(text);
};
export const isPricingInquiry = (value) => {
  const text = normalize(value);
  const asksAboutActiveVehicle = /\b\d{2}\s*[a-z]{1,2}\s*\d{4,5}\b/i.test(text)
    || /\b(hien tai|toi gio|dang do|xe cua toi|xe nay|current|so far|my car)\b/i.test(text);
  if (asksAboutActiveVehicle) return false;
  return /\b(bang\s+gia|gia\s+do\s+xe|gia\s+gui\s+xe|phi\s+giu\s+xe|phi\s+do\s+xe|bao\s+nhieu\s+mot\s+tieng|pricing|parking\s+fee)\b/i.test(text);
};
export const isPolicyInquiry = (value) => /\b(chinh\s+sach|quy\s+dinh|hoan\s+tien|huy\s+(?:booking|dat\s+cho).*(?:mat\s+phi|duoc\s+hoan|hoan\s+bao\s+nhieu)|huy\s+co\s+mat\s+phi|cancellation\s+policy|refund\s+policy)\b/i.test(value);
export const isServiceInquiry = (value) => {
  if (/\b(dat|them|chon|dung|lay|book|add|select)\b/i.test(value)) return false;
  if (/\b(car\s*wash|vacuuming|water\s*spot|coating|polishing|scratch|deep\s*cleaning|ozone|rua\s*xe|hut\s*bui|tay\s*o|danh\s*bong)\b/i.test(value)) return false;
  return /\b(dich\s*vu|service|services)\b/i.test(value)
    && /\b(gi|nao|co\b|danh\s*sach|cac\s*loai|tat\s*ca|bang\s*gia|gia|phi|bao\s*nhieu|xem|he\s*thong|list|info|what|available)\b/i.test(value);
};
export const isPeakTimesInquiry = (value) => {
  const text = normalize(value);
  return /\b(gio\s+cao\s+diem|khi\s+nao\s+(?:bai\s+)?dong|co\s+dong\s+xe|mat\s+do|peak\s+times?|when\s+is\s+it\s+busy|occupancy)\b/i.test(text);
};

export const isHelpInquiry = (value) => {
  const text = normalize(value);
  return /\b(ban\s+(?:co\s+the\s+)?lam\s+duoc\s+gi|ban\s+ho\s+tro\s+gi|tro\s+ly\s+(?:co\s+)?chuc\s+nang\s+gi|huong\s+dan\s+(?:su\s+dung|toi)|toi\s+co\s+the\s+hoi\s+gi|help|what\s+can\s+you\s+do|how\s+can\s+you\s+help|show\s+me\s+what\s+you\s+can\s+do)\b/i.test(text);
};

export const isGreeting = (value) => /^(xin\s+chao|chao|hello|hi|hey|good\s+(?:morning|afternoon|evening))[!. ]*$/i.test(normalize(value));
export const isThanks = (value) => /^(cam\s+on|cam\s+on\s+ban|thanks|thank\s+you|thank\s+you\s+very\s+much)[!. ]*$/i.test(normalize(value));

export const isOutOfScopeInquiry = (value) => {
  const text = normalize(value);
  return /\b(thoi\s+tiet|du\s+bao\s+thoi\s+tiet|hom\s+nay\s+co\s+mua|weather\s+forecast|temperature)\b/i.test(text)
    || /\b(ty\s+so|bong\s+da|world\s+cup|premier\s+league|football\s+score|sports?\s+score)\b/i.test(text)
    || /\b(cong\s+thuc\s+nau|nau\s+mon|mon\s+an|recipe|how\s+to\s+cook)\b/i.test(text)
    || /\b(tin\s+tuc|chinh\s+tri|bau\s+cu|news\s+today|politics|election)\b/i.test(text)
    || /\b(ke\s+chuyen\s+cuoi|hat\s+mot\s+bai|lam\s+tho|phim\s+gi|tell\s+(?:me\s+)?a\s+joke|sing\s+(?:me\s+)?a\s+song|write\s+(?:me\s+)?a\s+poem|movie\s+recommendation)\b/i.test(text)
    || /\b(giai\s+bai\s+tap|giai\s+phuong\s+trinh|lam\s+bai\s+van|solve\s+(?:this\s+)?equation|homework)\b/i.test(text)
    || /\b(gia\s+vang|chung\s+khoan|bitcoin|crypto|stock\s+price|exchange\s+rate)\b/i.test(text)
    || /\b(chan\s+doan\s+benh|ke\s+don\s+thuoc|tu\s+van\s+phap\s+luat|medical\s+diagnosis|legal\s+advice)\b/i.test(text);
};

export function routeBookingReply(phase, message, { hasSlotSuggestion = false } = {}) {
  const value = normalize(message).replace(/^(?:da|vang)\s+/, '').replace(/\s+(?:nhe|nha)$/, '');
  const containsBookingDetails = /\b(dat|giu\s+cho|book|reserve)\b/i.test(value)
    && (/\b(ngay|hom\s+nay|ngay\s+mai|gio|xe|bien|plate|vehicle|car|today|tomorrow|date|time|\d{1,2}h|\d{1,2}:\d{2})\b/i.test(value));
  // A mixed sentence such as "đặt xe ... và thêm dịch vụ" must reach the
  // booking interpreter as one unit. Informational shortcuts would otherwise
  // discard its dates, times and vehicle.
  if (containsBookingDetails) return 'interpret';
  if (isVipInquiry(value)) return 'view_vip_packages';
  if (isServiceInquiry(value)) return 'service_info';
  if (isPricingInquiry(value)) return 'pricing_info';
  // Published policy content and refund rules live on the server and can
  // change. Let the assistant endpoint answer from the current policy data.
  if (isPolicyInquiry(value)) return 'interpret';
  if (isPeakTimesInquiry(value)) return 'peak_times_info';
  if (isHelpInquiry(value)) return 'help';
  if (isGreeting(value)) return 'greeting';
  if (isThanks(value)) return 'thanks';
  if (isOutOfScopeInquiry(value)) return 'out_of_scope';

  if (phase !== 'WAITING_CONFIRMATION') {
    if (hasSlotSuggestion && (confirmationPhrases.has(value)
      || /^(?:lay|chon|dung)\s+(?:o\s+)?(?:goi y|de xuat)$/i.test(value)
      || /^(?:use|take|choose|select)\s+(?:the\s+)?suggest(?:ed|ion)(?:\s+slot)?$/i.test(value))) {
      return 'accept_suggestion';
    }
    if (confirmationPhrases.has(value)) return 'no_preview';
    if (cancellationPhrases.has(value)) return 'cancel_draft';
    return 'interpret';
  }
  if (cancellationPhrases.has(value)) return 'cancel';
  // Wallet actions must be checked before booking edits. Otherwise phrases
  // such as "nạp thêm" and "làm thêm tiền" are mistaken for an edit merely
  // because they contain the word "thêm".
  if (isTopUpRequest(value)) return 'top_up';
  // A correction may contain a negative word ("không, đổi giờ ra 12h"). It is
  // an edit, not a cancellation, as long as the whole phrase is not an exact
  // cancellation command.
  if (/\b(?:dung|use|apply)\s+(?:a\s+|my\s+|the\s+)?(?:voucher|ma\s+giam\s+gia|discount)\b/i.test(value)) {
    return 'interpret';
  }
  if (/\b(doi|sua|chuyen|thay|them|chon|lay|bo|xoa|ngay|mai|hom|thu|cuoi tuan|gio|bien|xe|tang|floor|slot|o do|buoi|sang|chieu|toi|trua|dich\s*vu|service|voucher|ma\s+giam\s+gia|discount|rua\s*xe|wash|sac|charging|coating|water\s*spot|polishing|scratch|cleaning|ozone|hut\s*bui|tay\s*o|danh\s*bong|change|correct|instead|actually|date|time|tomorrow|today|plate|vehicle|car|arrive|leave|am|pm|\d{1,2}h|\d{1,2}:\d{2})\b/i.test(value)) {
    return 'interpret';
  }
  if (/\b(khong|huy|thoi|dung|no|cancel|stop|nevermind|dont)\b|\b(?:never mind|do not)\b/.test(value)) {
    return 'clarify';
  }
  if (confirmationPhrases.has(value)) return 'confirm';
  // A preview should not turn the assistant into a yes/no-only state. Forward
  // every other request (wallet, vehicle, booking status, policies, etc.) to
  // the normal interpreter while keeping the current preview available.
  return 'interpret';
}

export function routeAssistantActionReply(message) {
  const value = normalize(message).replace(/^(?:da|vang)\s+/, '').replace(/\s+(?:nhe|nha)$/, '');
  if (/\b(khong|huy|thoi|dung|no|cancel|stop|nevermind)\b|\bnever mind\b/.test(value)) return 'cancel';
  if (confirmationPhrases.has(value)
    || /^(?:dong y|xac nhan|ok|oke|duoc)(?:\s+(?:them|xoa|sua|cap nhat|lam))?(?:\s+(?:xe|di))?$/.test(value)
    || /^(?:them|xoa|sua|cap nhat|lam)\s+di$/.test(value)) return 'confirm';
  return 'interpret';
}

export function bookingPreviewSummary(preview, draft = {}, language = 'vi') {
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
  const vipTip = preview?.suggestVipPackage
    ? (language === 'en'
      ? '\n💡 Tip: For bookings longer than 7 days, consider subscribing to a VIP monthly package for lower rates and a dedicated spot.'
      : '\nvalo Gợi ý: Với thời gian đỗ dài ngày (> 7 ngày), bạn có thể tham khảo đăng ký gói ưu tiên (gói tháng) để có mức giá ưu đãi hơn và được giữ chỗ cố định.')
    : '';

  if (language === 'en') {
    const serviceList = Array.isArray(draft.serviceNames) && draft.serviceNames.length
      ? ` (${items.length > 1 ? 'Services for each vehicle' : 'With services'}: ${draft.serviceNames.join(', ')})`
      : '';
    const details = items.map((item) => {
      const start = parts(item.startTime, item.date, draft.startTime);
      const end = parts(item.endTime, item.endDate || item.date, draft.endTime);
      return `Vehicle ${item.licensePlate}: ${start.date} ${start.time} to ${end.date} ${end.time}, ${floorLabel(item.floorName, 'en')}, slot ${item.slotCode}${serviceList}`;
    });
    const payment = Number(preview.walletBalance) < Number(preview.total)
      ? 'Your wallet balance is insufficient. Say “top up” to display a payment QR code.'
      : 'Would you like to confirm this booking?';
    return `${details.join('\n')}\nTotal ${Number(preview.total).toLocaleString('en-US')} VND. ${payment}${vipTip}`;
  }
  const payment = Number(preview.walletBalance) < Number(preview.total)
    ? 'Ví chưa đủ tiền. Vui lòng nạp thêm.'
    : 'Bạn có xác nhận đặt chỗ không?';
  const serviceList = Array.isArray(draft.serviceNames) && draft.serviceNames.length
    ? ` (${items.length > 1 ? 'Dịch vụ áp dụng cho từng xe' : 'Kèm dịch vụ'}: ${draft.serviceNames.join(', ')})`
    : '';
  if (items.length === 1) {
    const start = parts(items[0].startTime, items[0].date, draft.startTime);
    const end = parts(items[0].endTime, items[0].endDate || items[0].date, draft.endTime);
    return `Xe ${items[0].licensePlate}: ${start.date} ${start.time} đến ${end.date} ${end.time}. `
      + `Giữ chỗ liên tục, ${items[0].floorName}, ô ${items[0].slotCode}${serviceList}. `
      + `${Number(preview.total).toLocaleString('vi-VN')}đ. ${payment}${vipTip}`;
  }
  const details = items.map((item) => {
    const start = parts(item.startTime, item.date, draft.startTime);
    const end = parts(item.endTime, item.endDate || item.date, draft.endTime);
    return { item, start, end };
  });
  const sameSchedule = details.every(({ start, end }) => (
    start.date === details[0].start.date
    && start.time === details[0].start.time
    && end.date === details[0].end.date
    && end.time === details[0].end.time
  ));
  const lines = sameSchedule
    ? details.map(({ item }) => `- ${item.licensePlate}: ${item.floorName}, ô ${item.slotCode}`)
    : details.map(({ item, start, end }) => (
      `- ${item.licensePlate}: ${start.date} ${start.time} đến ${end.date} ${end.time}, ${item.floorName}, ô ${item.slotCode}`
    ));
  const heading = sameSchedule
    ? `${items.length} xe, ${details[0].start.date} ${details[0].start.time} đến ${details[0].end.date} ${details[0].end.time}:`
    : `${items.length} chỗ:`;
  return `${heading}\n${lines.join('\n')}${serviceList ? `\n${serviceList.trim()}` : ''}\nTổng ${Number(preview.total).toLocaleString('vi-VN')}đ. `
    + (Number(preview.walletBalance) < Number(preview.total)
      ? 'Ví chưa đủ tiền. Vui lòng nạp thêm.'
      : `Xác nhận đặt ${items.length} chỗ?`)
    + vipTip;
}

export function vipPlatePrompt(plate, language = 'vi') {
  return language === 'en'
    ? `Vehicle ${plate} already has a dedicated VIP space and does not need an hourly booking. Use the VIP space directly, or say or enter another license plate; I will keep the date and time.`
    : `Xe ${plate} đã có ô đỗ VIP riêng nên không cần booking theo giờ. Hãy dùng trực tiếp ô VIP, hoặc đọc hay nhập biển số khác; mình sẽ giữ nguyên ngày giờ.`;
}

export function resolveContextualVehicleReply(message, vehicles = [], draft = {}, language = 'vi') {
  // While editing a multi-vehicle preview, ordinals refer to the preview rows,
  // not to the account's registered-vehicle order. Let the booking interpreter
  // resolve that target from reservationItems so "xe 1" cannot select another car.
  if (draft.pendingReservationEditField === 'target'
    || Number.isInteger(draft.pendingReservationEditIndex)) {
    return String(message || '');
  }
  const value = normalize(message);
  const approved = vehicles.filter((vehicle) => vehicle?.status === 'approved'
    && (!draft.vehicleType || vehicle.vehicleType === draft.vehicleType));
  const ordinalWords = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    nhat: 1, mot: 1, hai: 2, ba: 3, tu: 4, bon: 4, nam: 5,
  };
  const ordinal = value.match(/^(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+(?:one|car|vehicle))?$/)
    || value.match(/^(?:lay|chon|dung|la)?\s*(?:xe\s+)?(?:thu\s+)?(nhat|mot|hai|ba|tu|bon|nam|[1-5])(?:\s+nhe)?$/);
  let selected = null;
  if (ordinal) {
    const position = Number(ordinalWords[ordinal[1]] || ordinal[1]);
    selected = approved[position - 1] || null;
  } else if (/^(?:the\s+)?other\s+(?:one|car|vehicle)$|^(?:xe\s+)?(?:con\s+lai|khac)$/.test(value)) {
    const currentPlate = String(draft.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const alternatives = approved.filter((vehicle) => String(vehicle.licensePlate || '')
      .replace(/[^A-Z0-9]/gi, '').toUpperCase() !== currentPlate);
    if (alternatives.length === 1) selected = alternatives[0];
  }
  if (!selected?.licensePlate) return String(message || '');
  return language === 'en'
    ? `License plate ${selected.licensePlate}`
    : `Biển số ${selected.licensePlate}`;
}

export function applySlotSuggestionToDraft(draft = {}, suggestion = null) {
  const next = { ...draft };
  delete next.pendingSlotSuggestion;
  if (!suggestion?.slotCode) return next;

  const existingItems = Array.isArray(next.reservationItems) ? next.reservationItems : [];
  const plates = Array.isArray(next.licensePlates) && next.licensePlates.length
    ? next.licensePlates : (next.licensePlate ? [next.licensePlate] : []);
  const itemCount = Math.min(5, Math.max(existingItems.length, plates.length, Number(next.requestedVehicleCount || 0)));
  const sourceIndex = Number(suggestion.sourceIndex);
  const targetIndex = Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < 5 ? sourceIndex : 0;

  if (existingItems.length || itemCount > 1) {
    const count = Math.max(itemCount, targetIndex + 1);
    next.reservationItems = Array.from({ length: count }, (_, index) => {
      const existing = existingItems[index] || {};
      const item = {
        ...existing,
        licensePlate: existing.licensePlate || plates[index] || '',
        startDate: existing.startDate || next.startDate || '',
        endDate: existing.endDate || next.endDate || next.startDate || '',
        startTime: existing.startTime || next.startTime || '',
        endTime: existing.endTime || next.endTime || '',
        floorName: existing.floorName || next.floorName || '',
        zoneName: existing.zoneName || next.zoneName || '',
        slotCode: existing.slotCode || '',
      };
      return index === targetIndex ? {
        ...item,
        floorName: suggestion.floorName || '',
        zoneName: '',
        slotCode: suggestion.slotCode,
      } : item;
    });
    return next;
  }

  return {
    ...next,
    floorName: suggestion.floorName || '',
    zoneName: '',
    slotCode: suggestion.slotCode,
  };
}

export function applyMapSlotSelectionToDraft(draft = {}, selection = null) {
  const slotCode = String(selection?.slotCode || '').trim().toUpperCase();
  if (!slotCode) return { ...draft };
  const floorName = String(selection?.floorName || '').trim();
  const existingItems = Array.isArray(draft.reservationItems) ? draft.reservationItems : [];
  const plates = Array.isArray(draft.licensePlates) && draft.licensePlates.length
    ? draft.licensePlates : (draft.licensePlate ? [draft.licensePlate] : []);
  const itemCount = Math.min(5, Math.max(
    existingItems.length,
    plates.length,
    Number(draft.requestedVehicleCount || 0),
  ));
  const sourceIndex = Number(selection?.sourceIndex);
  const targetIndex = Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < itemCount
    ? sourceIndex : 0;
  const next = {
    ...draft,
    floorName,
    zoneName: '',
    slotCode,
  };
  delete next.pendingSlotSuggestion;
  if (itemCount > 1) {
    next.floorName = '';
    next.zoneName = '';
    next.slotCode = '';
    next.reservationItems = Array.from({ length: itemCount }, (_, index) => {
      const existing = existingItems[index] || {};
      const item = {
        ...existing,
        licensePlate: existing.licensePlate || plates[index] || '',
        startDate: existing.startDate || draft.startDate || '',
        endDate: existing.endDate || draft.endDate || draft.startDate || '',
        startTime: existing.startTime || draft.startTime || '',
        endTime: existing.endTime || draft.endTime || '',
      };
      return index === targetIndex ? { ...item, floorName, zoneName: '', slotCode } : item;
    });
  } else if (existingItems.length === 1) {
    next.reservationItems = [{ ...existingItems[0], floorName, zoneName: '', slotCode }];
  }
  return next;
}

export function applySingleVehicleSelectionToDraft(draft = {}, vehicle = null) {
  const vehicleId = vehicle?._id || '';
  const licensePlate = String(vehicle?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const next = {
    ...draft,
    vehicleId,
    licensePlate,
    licensePlates: [],
    requestedVehicleCount: vehicle ? 1 : 0,
    blockedVipPlate: '',
  };
  delete next.pendingSlotSuggestion;
  if (vehicle && Array.isArray(draft.reservationItems) && draft.reservationItems.length) {
    next.reservationItems = [{ ...draft.reservationItems[0], vehicleId, licensePlate }];
  } else {
    next.reservationItems = [];
  }
  return next;
}

export function applyBookingDraftField(draft = {}, field, value, options = {}) {
  const sourceIndex = Number(options.sourceIndex);
  const existingItems = Array.isArray(draft.reservationItems) ? draft.reservationItems : [];
  const plates = Array.isArray(draft.licensePlates) && draft.licensePlates.length
    ? draft.licensePlates : (draft.licensePlate ? [draft.licensePlate] : []);
  const itemCount = Math.min(5, Math.max(
    existingItems.length,
    plates.length,
    Number(draft.requestedVehicleCount || 0),
  ));
  if (itemCount > 1 && Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < itemCount) {
    const next = { ...draft };
    delete next.pendingSlotSuggestion;
    next.reservationItems = Array.from({ length: itemCount }, (_, index) => {
      const original = existingItems[index] || {};
      const item = {
        ...original,
        licensePlate: original.licensePlate || plates[index] || '',
        startDate: original.startDate || draft.startDate || '',
        endDate: original.endDate || draft.endDate || draft.startDate || '',
        startTime: original.startTime || draft.startTime || '',
        endTime: original.endTime || draft.endTime || '',
      };
      if (index !== sourceIndex) return item;
      const updated = { ...item, [field]: value };
      if (field === 'startDate' && (!item.endDate || item.endDate === item.startDate)) updated.endDate = value;
      if (field === 'floorName') {
        updated.zoneName = '';
        updated.slotCode = '';
      }
      return updated;
    });
    const values = next.reservationItems.map((item) => item[field] || '');
    next[field] = values.every((entry) => entry === values[0]) ? values[0] : '';
    if (field === 'startDate') {
      const endDates = next.reservationItems.map((item) => item.endDate || '');
      next.endDate = endDates.every((entry) => entry === endDates[0]) ? endDates[0] : '';
    }
    if (['startTime', 'endTime'].includes(field)) {
      next.pendingStartTime = '';
      next.pendingEndTime = '';
    }
    if (field === 'floorName') {
      next.zoneName = '';
      next.slotCode = '';
    }
    return next;
  }

  const next = { ...draft, [field]: value };
  delete next.pendingSlotSuggestion;
  if (field === 'startDate' && (!draft.endDate || draft.endDate === draft.startDate)) next.endDate = value;
  if (['startTime', 'endTime'].includes(field)) {
    next.pendingStartTime = '';
    next.pendingEndTime = '';
  }
  if (field === 'floorName') {
    next.zoneName = '';
    next.slotCode = '';
  }
  if (!Array.isArray(draft.reservationItems) || !draft.reservationItems.length) return next;
  next.reservationItems = draft.reservationItems.map((item) => {
    const updated = { ...item, [field]: value };
    if (field === 'startDate' && (!item.endDate || item.endDate === item.startDate)) updated.endDate = value;
    if (field === 'floorName') {
      updated.zoneName = '';
      updated.slotCode = '';
    }
    return updated;
  });
  return next;
}

export function bookingSuccessSummary(items = [], language = 'vi') {
  if (!items.length) return language === 'en'
    ? 'Booking completed successfully. Your QR code is available in My Bookings.'
    : 'Đặt chỗ thành công. QR có trong My Bookings.';
  const details = items.map((item) => {
    const start = item.startTime ? new Date(item.startTime) : null;
    const end = item.endTime ? new Date(item.endTime) : null;
    const format = (value) => value && !Number.isNaN(value.getTime())
      ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'vi-VN', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(value)
      : '';
    const range = start && end ? `${format(start)} ${language === 'en' ? 'to' : 'đến'} ${format(end)}` : String(item.date || '').split('-').reverse().join('/');
    return language === 'en'
      ? `${range ? `${range}: ` : ''}vehicle ${item.licensePlate}, ${floorLabel(item.floorName, 'en')}, slot ${item.slotCode}`
      : `${range ? `${range}: ` : ''}xe ${item.licensePlate}, ${item.floorName}, ô ${item.slotCode}`;
  });
  if (language === 'en') {
    return details.length === 1
      ? `Booking completed. ${details[0]}. Your QR code is in My Bookings.`
      : `${details.length} bookings completed:\n${details.map((detail) => `- ${detail}`).join('\n')}\nYour QR codes are in My Bookings.`;
  }
  if (details.length === 1) return `Đặt xong. ${details[0]}. QR trong My Bookings.`;
  return `Đặt xong ${details.length} chỗ:\n${details.map((detail) => `- ${detail}`).join('\n')}\nQR trong My Bookings.`;
}

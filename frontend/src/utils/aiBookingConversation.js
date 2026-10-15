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

export function routeBookingReply(phase, message, { hasSlotSuggestion = false } = {}) {
  const value = normalize(message).replace(/^(?:da|vang)\s+/, '').replace(/\s+(?:nhe|nha)$/, '');
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
  // A negative word always wins over a positive one. Never book a mixed reply.
  if (/\b(khong|huy|thoi|dung|no|cancel|stop|nevermind|dont)\b|\b(?:never mind|do not)\b/.test(value)) {
    return cancellationPhrases.has(value) ? 'cancel' : 'clarify';
  }
  if (topUpPhrases.has(value)) return 'top_up';
  if (confirmationPhrases.has(value)) return 'confirm';
  if (/\b(doi|sua|chuyen|thay|ngay|mai|hom|thu|cuoi tuan|gio|bien|xe|tang|floor|slot|o do|buoi|sang|chieu|toi|trua|change|correct|instead|actually|date|time|tomorrow|today|plate|vehicle|car|arrive|leave|am|pm|\d{1,2}h|\d{1,2}:\d{2})\b/.test(value)) {
    return 'interpret';
  }
  return 'clarify';
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
  if (language === 'en') {
    const details = items.map((item) => {
      const start = parts(item.startTime, item.date, draft.startTime);
      const end = parts(item.endTime, item.endDate || item.date, draft.endTime);
      return `Vehicle ${item.licensePlate}: ${start.date} ${start.time} to ${end.date} ${end.time}, ${floorLabel(item.floorName, 'en')}, slot ${item.slotCode}`;
    });
    const payment = Number(preview.walletBalance) < Number(preview.total)
      ? 'Your wallet balance is insufficient. Say “top up” to display a payment QR code.'
      : 'Would you like to confirm this booking?';
    return `${details.join('\n')}\nTotal ${Number(preview.total).toLocaleString('en-US')} VND. ${payment}`;
  }
  const payment = Number(preview.walletBalance) < Number(preview.total)
    ? 'Ví chưa đủ tiền. Vui lòng nạp thêm.'
    : 'Bạn có xác nhận đặt chỗ không?';
  if (items.length === 1) {
    const start = parts(items[0].startTime, items[0].date, draft.startTime);
    const end = parts(items[0].endTime, items[0].endDate || items[0].date, draft.endTime);
    return `Xe ${items[0].licensePlate}: ${start.date} ${start.time} đến ${end.date} ${end.time}. `
      + `Giữ chỗ liên tục, ${items[0].floorName}, ô ${items[0].slotCode}. `
      + `${Number(preview.total).toLocaleString('vi-VN')}đ. ${payment}`;
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
  return `${heading}\n${lines.join('\n')}\nTổng ${Number(preview.total).toLocaleString('vi-VN')}đ. `
    + (Number(preview.walletBalance) < Number(preview.total)
      ? 'Ví chưa đủ tiền. Vui lòng nạp thêm.'
      : `Xác nhận đặt ${items.length} chỗ?`);
}

export function vipPlatePrompt(plate, language = 'vi') {
  return language === 'en'
    ? `Vehicle ${plate} has a VIP subscription. Please say or enter another license plate; I will keep the date and time.`
    : `Xe ${plate} có VIP. Hãy đọc hoặc nhập biển số khác; mình giữ nguyên ngày giờ.`;
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

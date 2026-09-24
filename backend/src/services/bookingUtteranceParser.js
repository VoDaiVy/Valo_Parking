const simplify = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const manualOnlyPattern = /\b(hang ngay|moi ngay|lap lai|sac|vip|dich vu|gan|khu|zone|cong|loi ra|uu tien|co mai|ngoai troi)\b/;
const supportedLocationCodePattern = /\b(?:zone|khu(?:\s+vuc)?)\s*([a-z]+\d+)\b/;
const withoutSupportedLocationCode = (message) => message.replace(supportedLocationCodePattern, ' ');

function specialBookingRequest(prompt, previous = {}) {
  const message = simplify(prompt);
  if (/\bxe may\b/.test(message)) return 'VALO hiện chỉ hỗ trợ đặt chỗ cho ô tô.';
  const bookingCue = /\b(dat|giu cho|book|do xe|dau xe|gui xe|mai|hom nay|ngay kia)\b/.test(message)
    || /\b\d{1,2}\s*(?:h|gio|:)/.test(message)
    || previous.__intent === 'CREATE_BOOKING';
  if (bookingCue && manualOnlyPattern.test(withoutSupportedLocationCode(message))) {
    return 'Yêu cầu này cần chọn thêm điều kiện trong Đặt chỗ thủ công để tránh đặt sai chỗ hoặc sai dịch vụ.';
  }
  return '';
}

const validDate = (value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const pad = (value) => String(value).padStart(2, '0');
const addDays = (date, count) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};

const plateDigits = {
  khong: '0', linh: '0', le: '0', mot: '1', hai: '2', ba: '3', bon: '4', bong: '4', tu: '4',
  nam: '5', lam: '5', sau: '6', bay: '7', tam: '8', chin: '9',
};
const plateLetters = {
  a: 'A', b: 'B', be: 'B', bo: 'B', c: 'C', ce: 'C', xe: 'C', d: 'D', de: 'D',
  e: 'E', g: 'G', ge: 'G', h: 'H', hat: 'H', k: 'K', ca: 'K', m: 'M', em: 'M',
  n: 'N', no: 'N', p: 'P', pe: 'P', r: 'R', ro: 'R', s: 'S', et: 'S',
  t: 'T', te: 'T', v: 'V', ve: 'V', x: 'X', ich: 'X',
};
const fullPlatePattern = /^[1-9]\d[A-Z]{1,2}\d{4,5}$/;
const directPlatePattern = /\b[1-9]\d[\s,.;-]*[a-z]{1,2}(?:[\s,.;-]*\d){4,5}\b/g;

function extractDirectLicensePlates(message) {
  return [...String(message || '').matchAll(directPlatePattern)]
    .map((match) => match[0].replace(/[^a-z0-9]/gi, '').toUpperCase())
    .filter((plate) => fullPlatePattern.test(plate));
}

function decodeSpokenPlate(value) {
  const raw = String(value || '').trim().replace(/\btu\s+\d{1,2}\s*(?:h|gio|:)\b.*$/, '').trim();
  const compact = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/^(?:\d{1,2}[A-Z]{0,2}\d{0,6}|[A-Z]{1,2}\d{1,6})$/.test(compact)) return compact;
  const tokens = raw.replace(/\b(?:bien so|bien|khac|la|cua|toi)\b/g, ' ')
    .split(/[\s,.;:-]+/).filter(Boolean);
  if (!tokens.length) return '';
  let plate = '';
  for (const token of tokens) {
    if (token === 'muoi') continue;
    if (/^\d+$/.test(token)) plate += token;
    else if (plateDigits[token] !== undefined) plate += plateDigits[token];
    else if (plateLetters[token] && (plate === '' || /^\d{2}[A-Z]?$/.test(plate))) plate += plateLetters[token];
    else if (fullPlatePattern.test(plate)) break;
    else return '';
    if (plate.length > 12) return '';
  }
  return plate;
}

function extractLicensePlate(message) {
  const direct = extractDirectLicensePlates(message);
  if (direct.length) return direct[0];
  const spoken = message.match(/\b(?:bien so|bien|xe)\s+(?:khac\s+)?(?:la\s+)?([^.!?]+)/);
  if (!spoken) return '';
  const plate = decodeSpokenPlate(spoken[1]);
  return fullPlatePattern.test(plate) ? plate : '';
}

function extractLicensePlates(message) {
  const direct = extractDirectLicensePlates(message);
  const spoken = extractLicensePlate(message);
  return [...new Set([...direct, ...(spoken ? [spoken] : [])])];
}

function extractVehicleCount(message) {
  const words = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5 };
  const match = message.match(/\b(\d+|mot|hai|ba|bon|nam)\s*xe\b/);
  return match ? Number(words[match[1]] || match[1]) : 0;
}

function parsePlateFollowUp(message, previous = {}) {
  const spoken = decodeSpokenPlate(message);
  if (!spoken) return null;
  const pending = String(previous.pendingLicensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const pendingPrefix = pending.match(/^\d{2}[A-Z]{1,2}/)?.[0] || '';
  const complete = [spoken, `${pending}${spoken}`, `${spoken}${pending}`, `${pendingPrefix}${spoken}`]
    .find((plate) => fullPlatePattern.test(plate));
  if (complete) {
    const priorPlates = Array.isArray(previous.licensePlates) ? previous.licensePlates : [];
    const licensePlates = [...new Set([...priorPlates, complete])];
    const requestedVehicleCount = Number(previous.requestedVehicleCount || 0);
    return {
      changes: {
        licensePlate: complete,
        licensePlates,
        requestedVehicleCount,
      },
      clearPendingPlate: true,
      clarification: requestedVehicleCount > licensePlates.length
        ? `Mình đã nhận ${licensePlates.length}/${requestedVehicleCount} biển số. Hãy đọc biển số xe tiếp theo.`
        : '',
    };
  }
  const partial = pending && (spoken.startsWith(pending) || pending.startsWith(spoken))
    ? (spoken.length >= pending.length ? spoken : pending)
    : `${pending}${spoken}`;
  const plausible = /^\d{1,2}$/.test(partial)
    || /^[A-Z]{1,2}\d{0,6}$/.test(partial)
    || /^\d{2}[A-Z]{0,2}\d{0,5}$/.test(partial);
  if (!plausible) return {
    changes: {}, clarification: 'Biển số chưa hợp lệ. Hãy đọc lại biển số đầy đủ của ô tô, gồm 2 số tỉnh, 1 đến 2 chữ cái và 4 đến 5 số cuối, ví dụ 43A12345.',
  };
  const clarification = /^[A-Z]/.test(partial)
    ? `Mình đã ghi ${partial}. Hãy đọc 2 số đầu của biển số.`
    : /^\d{1,2}$/.test(partial)
      ? `Mình đã ghi ${partial}. Hãy đọc chữ cái và dãy số cuối.`
      : `Mình đã ghi ${partial}. Hãy đọc tiếp phần còn lại của biển số.`;
  return { changes: {}, pendingLicensePlate: partial, clarification };
}

function reservationItemsFromPrevious(previous, count) {
  const previousItems = Array.isArray(previous.reservationItems) ? previous.reservationItems : [];
  const previousPlates = Array.isArray(previous.licensePlates) ? previous.licensePlates : [];
  return Array.from({ length: count }, (_, index) => ({
    licensePlate: previousItems[index]?.licensePlate || previousPlates[index] || '',
    startDate: previousItems[index]?.startDate || previous.startDate || '',
    endDate: previousItems[index]?.endDate || previous.endDate || previous.startDate || '',
    startTime: previousItems[index]?.startTime || previous.startTime || '',
    endTime: previousItems[index]?.endTime || previous.endTime || '',
    floorName: previousItems[index]?.floorName || previous.floorName || '',
    zoneName: previousItems[index]?.zoneName || previous.zoneName || '',
    slotCode: previousItems[index]?.slotCode || '',
  }));
}

function plateClarification(items, count, prefix = '') {
  const received = items.filter((item) => fullPlatePattern.test(item.licensePlate || '')).length;
  if (received >= count) return '';
  const nextIndex = items.findIndex((item) => !fullPlatePattern.test(item.licensePlate || ''));
  const lead = prefix ? `${prefix} ` : '';
  return `${lead}Mình đã nhận ${received}/${count} biển số. Hãy đọc biển số xe ${nextIndex + 1}.`;
}

function parseSequentialReservationTimes(message, previous = {}) {
  const count = Number(previous.requestedVehicleCount || 0);
  if (count < 2 || count > 5) return null;
  const times = extractTimes(message);
  if (times.length !== count * 2) return null;
  const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
  if (parsedTimes.includes(null)) return null;
  const items = reservationItemsFromPrevious(previous, count);
  for (let index = 0; index < count; index += 1) {
    const startTime = parsedTimes[index * 2];
    const endTime = parsedTimes[index * 2 + 1];
    if (endTime <= startTime) return null;
    items[index].startTime = startTime;
    items[index].endTime = endTime;
  }
  return {
    changes: {
      requestedVehicleCount: count,
      reservationItems: items,
      licensePlates: items.map((item) => item.licensePlate).filter(Boolean),
      licensePlate: items.find((item) => item.licensePlate)?.licensePlate || '',
    },
    clarification: plateClarification(items, count, `Mình đã lưu ${count} khung giờ riêng.`),
  };
}

function parseReservationEdit(message, today, previous = {}) {
  const previousItems = Array.isArray(previous.reservationItems) ? previous.reservationItems : [];
  const count = Math.max(Number(previous.requestedVehicleCount || 0), previousItems.length);
  if (count < 2 || count > 5) return null;

  const items = reservationItemsFromPrevious(previous, count);
  const mentionedPlates = extractLicensePlates(message);
  const pendingIndex = Number(previous.pendingReservationEditIndex);
  const hasPendingTarget = Number.isInteger(pendingIndex) && pendingIndex >= 0 && pendingIndex < count;
  const editCue = /\b(?:doi|sua|thay|chinh)(?:\s+lai)?\b/.test(message);
  const namesExistingVehicle = mentionedPlates.some((plate) => items.some((item) => item.licensePlate === plate));
  const suppliesReplacementSchedule = extractTimes(message).length > 0
    || /\b(?:hom nay|ngay mai|ngay kia|ngay mot|mai|\d{1,2}\/\d{1,2})\b/.test(message);
  if (!editCue && !hasPendingTarget && !(namesExistingVehicle && suppliesReplacementSchedule)) return null;

  const ordinal = message.match(/\b(?:xe|bien so)\s*(?:thu\s*)?(1|2|3|4|5|nhat|mot|hai|ba|tu|bon|nam)\b/);
  const ordinalWords = { nhat: 1, mot: 1, hai: 2, ba: 3, tu: 4, bon: 4, nam: 5 };
  let targetIndex = ordinal ? Number(ordinalWords[ordinal[1]] || ordinal[1]) - 1 : -1;
  if (targetIndex < 0 && mentionedPlates.length) {
    targetIndex = items.findIndex((item) => item.licensePlate === mentionedPlates[0]);
  }
  if (targetIndex < 0 && hasPendingTarget) targetIndex = pendingIndex;
  if (targetIndex < 0 || targetIndex >= count) {
    return {
      changes: { requestedVehicleCount: count, reservationItems: items },
      clarification: 'Bạn muốn sửa xe nào? Hãy nói số thứ tự hoặc biển số xe.',
    };
  }

  const datePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;
  const dateToken = message.match(datePattern)?.[0] || '';
  const date = dateToken ? parseDateToken(dateToken, today) : '';
  const times = extractTimes(message);
  const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
  if (parsedTimes.includes(null) || times.length > 2) return null;

  const pendingField = String(previous.pendingReservationEditField || '');
  const wantsTime = /\b(?:gio|thoi gian|tu\s+\d{1,2})\b/.test(message) || pendingField === 'giờ';
  const wantsDate = /\bngay\b/.test(message) || pendingField === 'ngày';
  const changesDate = wantsDate && Boolean(date);
  const changesPlate = /\b(?:bien so|doi xe|thay xe)\b/.test(message) || pendingField === 'biển số';
  let changed = false;
  if (times.length === 2 && parsedTimes[1] > parsedTimes[0]) {
    items[targetIndex].startTime = parsedTimes[0];
    items[targetIndex].endTime = parsedTimes[1];
    changed = true;
  }
  if (date) {
    items[targetIndex].startDate = date;
    items[targetIndex].endDate = date;
    changed = true;
  }
  if (changesPlate && mentionedPlates.length) {
    const replacement = mentionedPlates.find((plate) => plate !== items[targetIndex].licensePlate);
    if (replacement) {
      items[targetIndex].licensePlate = replacement;
      changed = true;
    }
  }

  const baseChanges = {
    requestedVehicleCount: count,
    reservationItems: items,
    licensePlates: items.map((item) => item.licensePlate).filter(Boolean),
    licensePlate: items.find((item) => item.licensePlate)?.licensePlate || '',
  };
  if (changed) {
    return {
      changes: baseChanges,
      clearPendingReservationEdit: true,
      clarification: plateClarification(items, count),
    };
  }

  const target = items[targetIndex].licensePlate ? `xe ${items[targetIndex].licensePlate}` : `xe ${targetIndex + 1}`;
  const field = changesPlate ? 'biển số' : wantsDate ? 'ngày' : wantsTime ? 'giờ' : 'thông tin';
  return {
    changes: baseChanges,
    pendingReservationEditIndex: targetIndex,
    pendingReservationEditField: field,
    clarification: field === 'giờ'
      ? `Bạn muốn đổi giờ của ${target} thành từ mấy giờ đến mấy giờ?`
      : field === 'biển số'
        ? `Bạn muốn đổi ${target} sang biển số nào?`
        : `Bạn muốn sửa thông tin nào của ${target}?`,
  };
}

function parseDateToken(token, today) {
  if (/^(?:hom nay|nay|toi nay)$/.test(token)) return today;
  if (/^(?:ngay mai|mai)$/.test(token)) return addDays(today, 1);
  if (/^(?:ngay kia|ngay mot)$/.test(token)) return addDays(today, 2);
  if (token === 'cuoi tuan') {
    const current = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    return addDays(today, (5 - current + 7) % 7);
  }
  const weekday = token.match(/^(thu\s*(2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|chu nhat)(?:\s+tuan\s+(sau|nay))?$/);
  if (weekday) {
    const weekdays = { '2': 0, hai: 0, '3': 1, ba: 1, '4': 2, tu: 2, '5': 3, nam: 3, '6': 4, sau: 4, '7': 5, bay: 5 };
    const target = weekday[1] === 'chu nhat' ? 6 : weekdays[weekday[2]];
    const current = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const difference = weekday[3] === 'sau' ? 7 - current + target
      : weekday[3] === 'nay' ? target - current : (target - current + 7) % 7;
    return addDays(today, difference);
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(token)) {
    const [year, month, day] = token.split('-').map(Number);
    const result = `${year}-${pad(month)}-${pad(day)}`;
    return validDate(result) ? result : '';
  }
  const [day, month, yearText] = token.split('/');
  let year = yearText ? Number(yearText) : Number(today.slice(0, 4));
  if (yearText?.length === 2) year += 2000;
  let result = `${year}-${pad(month)}-${pad(day)}`;
  if (!yearText && validDate(result) && result < today) {
    const daysBehind = Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${result}T12:00:00Z`)) / 86400000);
    // Around New Year, a date such as 02/01 naturally means the upcoming year.
    // A recently elapsed date remains in the current year so it can be rejected explicitly.
    if (daysBehind > 180) {
      year += 1;
      result = `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  return validDate(result) ? result : '';
}

function parseHour(hourText, minuteText, period) {
  let hour = Number(hourText);
  const minute = minuteText === 'ruoi' ? 30 : Number(minuteText || 0);
  if (hour > 23 || minute > 59) return null;
  if (period && hour === 0) return null;
  if ((period === 'toi' || period === 'chieu') && hour <= 12) {
    if (hour === 12) return null;
    hour += 12;
  } else if (period === 'sang' && hour <= 12) {
    if (hour === 12) hour = 0;
  } else if (period === 'trua' && hour !== 11 && hour !== 12) {
    return null;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

function extractTimes(message) {
  const compact = message.match(/\b(\d{1,2})\s*(?:-|den)\s*(\d{1,2})\s*(?:h|gio)(?:\s*(sang|chieu|toi|trua))?\b/);
  if (compact) return [
    { hour: compact[1], minute: '', period: compact[3] || '' },
    { hour: compact[2], minute: '', period: compact[3] || '' },
  ];
  return [...message.matchAll(/\b(\d{1,2})\s*(?:h|gio|:)\s*(\d{1,2}|ruoi)?\s*(?:phut|p)?\s*(sang|chieu|toi|trua)?\b/g)]
    .map((match) => ({ hour: match[1], minute: match[2], period: match[3] || '' }));
}

const indexedDatePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;

function parseIndexedReservationItems(message, today, previous = {}) {
  const numberWords = { nhat: 1, mot: 1, hai: 2, ba: 3, tu: 4, bon: 4, nam: 5 };
  const markers = [...message.matchAll(/\bxe\s*(?:thu\s*)?(1|2|3|4|5|nhat|mot|hai|ba|tu|bon|nam)(?=\s|[:,.]|$)/g)];
  const continuingMultiple = Number(previous.requestedVehicleCount || 0) > 1
    || (Array.isArray(previous.reservationItems) && previous.reservationItems.length > 1);
  if (!markers.length || (markers.length === 1 && !continuingMultiple)) return null;

  const indices = markers.map((marker) => Number(numberWords[marker[1]] || marker[1]));
  const requestedVehicleCount = Math.max(Number(previous.requestedVehicleCount || 0), ...indices);
  if (!Number.isInteger(requestedVehicleCount) || requestedVehicleCount < 2 || requestedVehicleCount > 5) return null;
  const previousItems = Array.isArray(previous.reservationItems) ? previous.reservationItems : [];
  const previousPlates = Array.isArray(previous.licensePlates) ? previous.licensePlates : [];
  const prefixDateToken = message.slice(0, markers[0].index).match(indexedDatePattern)?.[0] || '';
  const prefixDate = prefixDateToken ? parseDateToken(prefixDateToken, today) : '';
  const items = Array.from({ length: requestedVehicleCount }, (_, index) => ({
    licensePlate: previousItems[index]?.licensePlate || previousPlates[index] || '',
    startDate: previousItems[index]?.startDate || prefixDate || previous.startDate || '',
    endDate: previousItems[index]?.endDate || prefixDate || previous.endDate || previous.startDate || '',
    startTime: previousItems[index]?.startTime || previous.startTime || '',
    endTime: previousItems[index]?.endTime || previous.endTime || '',
    floorName: previousItems[index]?.floorName || previous.floorName || '',
    zoneName: previousItems[index]?.zoneName || previous.zoneName || '',
    slotCode: previousItems[index]?.slotCode || '',
  }));
  const invalidPlates = [];

  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const itemIndex = indices[markerIndex] - 1;
    const segmentStart = markers[markerIndex].index + markers[markerIndex][0].length;
    const segmentEnd = markers[markerIndex + 1]?.index ?? message.length;
    const segment = message.slice(segmentStart, segmentEnd);
    const dateToken = segment.match(indexedDatePattern)?.[0] || '';
    if (dateToken) {
      const date = parseDateToken(dateToken, today);
      if (!date) return null;
      items[itemIndex].startDate = date;
      items[itemIndex].endDate = date;
    }
    const times = extractTimes(segment);
    if (times.length > 2) return null;
    const periods = new Set([...segment.matchAll(/\b(sang|chieu|toi|trua)\b/g)].map((match) => match[1]));
    if (periods.size === 1) times.forEach((time) => { if (!time.period) time.period = [...periods][0]; });
    const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
    if (parsedTimes.includes(null)) return null;
    if (parsedTimes.length === 2) {
      [items[itemIndex].startTime, items[itemIndex].endTime] = parsedTimes;
    }
    const plates = extractLicensePlates(segment);
    if (plates[0]) items[itemIndex].licensePlate = plates[0];
    else {
      const plateLike = segment.match(/\b\d{2}[\s.-]*[a-z]{1,2}[\s.-]*\d{1,7}\b/)?.[0]
        ?.replace(/[^a-z0-9]/g, '').toUpperCase();
      if (plateLike) invalidPlates.push({ itemIndex, value: plateLike });
    }
  }

  const missingSchedule = items.findIndex((item) => !item.startDate || !item.startTime || !item.endTime);
  let clarification = '';
  if (missingSchedule >= 0) {
    const item = items[missingSchedule];
    clarification = !item.startDate
      ? `Xe ${missingSchedule + 1} đỗ ngày nào?`
      : `Xe ${missingSchedule + 1} đỗ từ mấy giờ đến mấy giờ?`;
  } else if (invalidPlates.length) {
    clarification = `Biển số xe ${invalidPlates[0].itemIndex + 1} chưa hợp lệ. Hãy đọc lại đầy đủ, ví dụ 43A12345; mình đã giữ lịch và thông tin xe còn lại.`;
  } else if (items.some((item) => !item.licensePlate)) {
    clarification = `Mình đã lưu lịch riêng cho ${requestedVehicleCount} xe. Hãy cho biết biển số của từng xe theo thứ tự.`;
  }
  const result = {
    changes: {
      requestedVehicleCount,
      reservationItems: items,
      licensePlates: items.map((item) => item.licensePlate).filter(Boolean),
      licensePlate: items.find((item) => item.licensePlate)?.licensePlate || '',
    },
    clarification,
  };
  if (invalidPlates.length) result.pendingLicensePlate = invalidPlates[0].value;
  return result;
}

// Only common, explicit CREATE_BOOKING language is handled locally. Unknown constraints go to Gemini.
function parseBookingUtterance(prompt, today, previous = {}, currentTime = '') {
  if (!validDate(today)) return null;
  const words = { 'muoi mot': 11, 'muoi hai': 12, mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10 };
  const message = simplify(String(prompt || '').replace(/\btôi\b/giu, 'nguoi_dung').replace(/\btới\b/giu, 'đến').replace(/\bmốt\b/giu, 'ngày mốt'))
    .replace(/\btoi\s+(?=muon|xin|can|se|dat|co)\b/g, 'nguoi_dung ')
    .replace(/(\d{1,2}\s*(?:h|gio|:\d{2})?)\s+toi\s+(?=\d{1,2})/g, '$1 den ')
    .replace(/\b(muoi mot|muoi hai|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s+(gio|tieng)\b/g,
      (match, word, unit) => `${words[word]} ${unit}`)
    .replace(/\b(\d{1,2})\s+ruoi\s+(sang|chieu|toi|trua)\b/g, '$1 gio ruoi $2')
    .replace(/\b(\d{1,2})\s+thang\s+(muoi mot|muoi hai|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|\d{1,2})(?:\s+nam\s+(\d{4}))?\b/g,
      (_, day, month, year) => `${day}/${words[month] || month}${year ? `/${year}` : ''}`);
  const continuing = previous.__intent === 'CREATE_BOOKING';
  const asksForOtherVehicle = /\b(?:(?:dat|cho)(?:\s+cho)?\s+)?(?:mot\s+)?xe\s+khac\b/.test(message);
  const periodAnswer = message.replace(/[.!?]+$/, '').trim()
    .match(/^(?:(?:nguoi_dung\s+)?(?:muon|can)?\s*(?:dat(?: cho)?\s+)?(?:vao\s+)?|(?:doi|chuyen)\s+sang\s+)?(?:buoi\s+)?(sang|chieu|toi|trua)(?:\s+(?:nhe|nha))?$/);
  if (continuing && periodAnswer) {
    if (!previous.pendingStartTime && !previous.startTime) {
      return { changes: {}, clarification: `Bạn muốn đỗ từ mấy giờ đến mấy giờ vào buổi ${periodAnswer[1]}?` };
    }
    const convert = (value) => {
      if (!/^\d{2}:\d{2}$/.test(value || '')) return '';
      const [hour, minute] = value.split(':');
      const target = periodAnswer[1];
      const parsedHour = Number(hour);
      const clockHour = (target === 'sang' && parsedHour >= 13) || (['chieu', 'toi'].includes(target) && parsedHour >= 13)
        ? parsedHour % 12 : parsedHour;
      const converted = parseHour(clockHour, minute, target);
      if (!converted) return '';
      const convertedHour = Number(converted.slice(0, 2));
      if ((target === 'sang' && convertedHour >= 12)
        || (target === 'chieu' && (convertedHour < 12 || convertedHour >= 18))
        || (target === 'toi' && convertedHour < 18)) return '';
      return converted;
    };
    const sourceStart = previous.pendingStartTime || previous.startTime;
    const sourceEnd = previous.pendingEndTime || previous.endTime;
    const startTime = convert(sourceStart);
    const endTime = sourceEnd ? convert(sourceEnd) : '';
    if (!startTime || (sourceEnd && (!endTime || endTime <= startTime))) {
      return { changes: { startTime: '', endTime: '' }, clearTimes: true,
        clarification: 'Mình đã giữ ngày và xe. Bạn vui lòng nói rõ giờ vào và giờ ra theo 24 giờ.' };
    }
    return { changes: { startTime, endTime }, clearPending: true, clarification: '' };
  }
  const reservationEdit = parseReservationEdit(message, today, previous);
  if (reservationEdit) return reservationEdit;
  const sequentialTimes = parseSequentialReservationTimes(message, previous);
  if (sequentialTimes) return sequentialTimes;
  const indexedReservations = parseIndexedReservationItems(message, today, previous);
  if (indexedReservations) return indexedReservations;
  const previousPlates = Array.isArray(previous.licensePlates) ? previous.licensePlates : [];
  const waitingForPlate = continuing && (previous.blockedVipPlate || previous.pendingLicensePlate
    || (!previous.licensePlate && !previousPlates.length)
    || Number(previous.requestedVehicleCount || 0) > previousPlates.length);
  if (waitingForPlate && extractTimes(message).length === 0) {
    const plateFollowUp = parsePlateFollowUp(message, previous);
    if (plateFollowUp) return plateFollowUp;
  }
  if (asksForOtherVehicle) {
    const replacements = extractLicensePlates(message);
    if (replacements.length) return { changes: {
      startDate: previous.startDate || '', endDate: previous.endDate || '',
      startTime: previous.startTime || '', endTime: previous.endTime || '',
      licensePlate: replacements[0], licensePlates: replacements, requestedVehicleCount: 1,
    } };
    return { changes: {
      startDate: previous.startDate || '', endDate: previous.endDate || '',
      startTime: previous.startTime || '', endTime: previous.endTime || '',
      requestedVehicleCount: 1,
    }, clearVehicle: true,
      clarification: 'Mình vẫn giữ ngày và giờ đã chọn. Bạn vui lòng đọc biển số đầy đủ của xe khác.' };
  }
  if (/\b(huy|huy bo|xem|kiem tra|con cho|con trong|co cho khong|co o trong|gia bao nhieu|bao gia)\b/.test(message)) return null;
  if (/\b(khong|dung|thoi)\s+(?:muon\s+)?(?:dat|giu cho|book)\b/.test(message)) return null;
  if (/\b(sua|doi|gia han)\s*(?:booking|dat cho|lich dat)\b/.test(message)) return null;
  const createCue = /\b(dat|giu cho|book|do xe|dau xe|gui xe)\b/.test(message);
  if (!createCue && previous.__intent && !['UNKNOWN', 'CREATE_BOOKING'].includes(previous.__intent)) return null;
  if (/\b(thang|xe may|toi da|toi thieu)\b/.test(message)
    || manualOnlyPattern.test(withoutSupportedLocationCode(message))) return null;
  const requestedVehicleCount = extractVehicleCount(message) || Number(previous.requestedVehicleCount || 0);
  const unspecifiedMultipleVehicles = /\b(?:nhieu|vai)\s+xe\b/.test(message) && !requestedVehicleCount;
  if (requestedVehicleCount > 5 || /\b\d+\s*(?:cho|o do)\b/.test(message)) return null;

  const datePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|cuoi tuan|thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)(?:\s+tuan\s+(?:sau|nay))?|chu nhat(?:\s+tuan\s+(?:sau|nay))?|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g;
  const dateMatches = [...message.matchAll(datePattern)];
  const dateTokens = dateMatches.map((match) => match[0]);
  if (dateTokens.length > 2) return null;
  const withoutDateWords = message.replace(datePattern, '');
  if (/\b(thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|chu nhat|tuan)\b/.test(withoutDateWords)) return null;
  if (dateTokens.length > 1 && dateTokens.some((token) => /^(thu|chu nhat|cuoi tuan)/.test(token))) return null;
  const dates = dateTokens.map((token) => parseDateToken(token, today));
  if (dates.some((date) => !date)) return null;
  const pastDate = dates.find((date) => date < today);
  if (pastDate) {
    return {
      changes: { requestedVehicleCount }, clearDates: true, clearTimes: true,
      clarification: `Ngày ${pastDate.split('-').reverse().join('/')} đã qua. Bạn vui lòng chọn ngày hôm nay hoặc một ngày trong tương lai.`,
    };
  }
  let startDate = dates[0] || '';
  let endDate = dates[1] || (dateTokens[0] === 'cuoi tuan' ? addDays(startDate, 1) : startDate);
  if (startDate && endDate < startDate) return null;
  const crossDateClarification = 'Bạn đang muốn đỗ liên tục qua ngày. Vui lòng chọn Đặt chỗ thủ công để nhập riêng ngày giờ vào và ngày giờ ra.';
  if (/\b(qua dem|lien tuc|hom sau|sang ngay sau)\b/.test(message)) {
    return { changes: { startDate, endDate, startTime: '', endTime: '' }, clearTimes: true, clarification: crossDateClarification };
  }

  // A clock time before the second date means a continuous cross-date stay,
  // not one repeated booking on each date in the range.
  if (dateMatches.length === 2 && /\b\d{1,2}\s*(?:h|gio|:)/.test(message.slice(0, dateMatches[1].index))) {
    return {
      changes: { startDate, endDate, startTime: '', endTime: '' }, clearTimes: true,
      clarification: crossDateClarification,
    };
  }

  const withoutDates = message.replace(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g, '');
  const relativeDelayMatch = withoutDates.match(/\b(?:sau\s+|trong\s+)?(\d{1,3})\s*(phut|gio|tieng)\s+nua\b/)
    || withoutDates.match(/\bsau\s+(\d{1,3})\s*(phut|gio|tieng)\b/)
    || withoutDates.match(/\b(?:sau\s+|trong\s+)?(nua)\s*(gio|tieng)\s+nua\b/);
  let relativeStartTime = '';
  if (relativeDelayMatch) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(currentTime)) {
      return { changes: {}, clarification: 'Mình chưa xác định được giờ hiện tại. Bạn vui lòng nói giờ vào cụ thể.' };
    }
    const delayMinutes = relativeDelayMatch[1] === 'nua'
      ? 30 : Number(relativeDelayMatch[1]) * (relativeDelayMatch[2] === 'phut' ? 1 : 60);
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 24 * 60) {
      return { changes: {}, clarification: 'Thời điểm bắt đầu chưa hợp lệ. Bạn vui lòng nói giờ vào cụ thể.' };
    }
    const [currentHour, currentMinute] = currentTime.split(':').map(Number);
    const targetMinutes = currentHour * 60 + currentMinute + delayMinutes;
    const dayOffset = Math.floor(targetMinutes / (24 * 60));
    startDate = addDays(today, dayOffset);
    endDate = startDate;
    const minuteOfDay = targetMinutes % (24 * 60);
    relativeStartTime = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
  }
  const timeSource = relativeDelayMatch ? withoutDates.replace(relativeDelayMatch[0], '') : withoutDates;
  const durationMatch = timeSource.match(/\b(?:trong|suot|keo dai)\s*(\d{1,3})\s*(gio|tieng|phut)(?:\s*(ruoi))?\b/)
    || timeSource.match(/\b(\d{1,3})\s*(gio|tieng|phut)(?:\s*(ruoi))?\s+(?:tu(?:\s+luc)?|bat dau(?:\s+tu|\s+luc)?)\b/)
    || timeSource.match(/\b(\d{1,3})\s*(tieng)(?:\s*(ruoi))?\b/);
  const durationMinutes = durationMatch
    ? Number(durationMatch[1]) * (durationMatch[2] === 'phut' ? 1 : 60) + (durationMatch[3] ? 30 : 0)
    : 0;
  const times = extractTimes(durationMatch ? timeSource.replace(durationMatch[0], '') : timeSource);
  if (times.length > 2) return null;
  if (times.length === 2 && Number(times[0].hour) >= 13 && Number(times[1].hour) <= 12 && !times[1].period) {
    return { changes: { startDate, endDate, startTime: '', endTime: '' }, clearTimes: true, clarification: crossDateClarification };
  }
  const periodSource = message.replace(/\bsang\s+(?:tang|floor|o|ngay)\b/g, '');
  const periods = new Set([...periodSource.matchAll(/\b(sang|chieu|toi|trua)\b/g)].map((match) => match[1]));
  if (periods.size === 1) times.forEach((time) => { if (!time.period) time.period = [...periods][0]; });
  // Bare hours follow 24-hour notation (8h = 08:00); the user hears the
  // interpreted time in the preview and must explicitly confirm it.
  const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
  if (parsedTimes.includes(null)) return null;

  const incomingPlates = extractLicensePlates(message);
  const licensePlates = [...new Set([...(continuing ? previousPlates : []), ...incomingPlates]
    .map((plate) => String(plate).replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(Boolean))];
  const licensePlate = incomingPlates[0] || '';
  const vehicleType = /\b(xe dien|oto dien|o to dien)\b/.test(message) ? 'electric_car'
    : /\b(xe xang|xe thuong|oto thuong|o to thuong)\b/.test(message) ? 'car' : '';
  const floorMatch = message.match(/\b(?:tang|floor)\s*([a-z]?\d+)\b/);
  const floorName = floorMatch ? `tầng ${floorMatch[1].toUpperCase()}` : '';
  const zoneMatch = message.match(supportedLocationCodePattern);
  const zoneName = zoneMatch?.[1].toUpperCase() || '';
  const slotMatch = message.match(/\b(?:o do|o|slot)\s*(?:so|ma)?\s*([a-z][-_.]?\d+(?:[-_.]\d+)?)\b/);
  const slotCode = slotMatch?.[1].toUpperCase() || '';
  const mentionedPlate = /\b(bien so|bien|xe\s+[0-9]{2}[a-z0-9.-]+)\b/.test(message);
  const mentionedFloor = /\b(tang|floor)\b/.test(message);
  const mentionedSlot = /\b(o do|slot)\b/.test(message);

  if (!startDate && !times.length && !durationMatch && !licensePlate && !requestedVehicleCount
    && !vehicleType && !floorName && !zoneName && !slotCode && !createCue && !mentionedPlate) return null;
  const changes = { startDate, endDate, licensePlate, licensePlates, requestedVehicleCount,
    vehicleType, floorName, zoneName, slotCode, startTime: '', endTime: '' };
  let clarification = '';
  let clearTimes = false;
  if (relativeStartTime) {
    changes.startTime = relativeStartTime;
  } else if (times.length === 2) {
    [changes.startTime, changes.endTime] = parsedTimes;
    if (changes.endTime <= changes.startTime) {
      clarification = 'Giờ ra cần sau giờ vào trong cùng ngày. Nếu muốn đỗ qua đêm, vui lòng chọn Đặt chỗ thủ công.';
      clearTimes = true;
    } else if (durationMatch) {
      const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      if (minutes(changes.endTime) - minutes(changes.startTime) !== durationMinutes) {
        clarification = 'Khoảng giờ vào/ra và thời lượng bạn nói chưa khớp. Vui lòng xác nhận lại giờ vào và giờ ra.';
        clearTimes = true;
      }
    }
  } else if (times.length === 1) {
    const isEnd = /\b(gio ra|ket thuc|den luc|den\s+\d)/.test(message)
      || (continuing && previous.startTime && !previous.endTime);
    changes[isEnd ? 'endTime' : 'startTime'] = parsedTimes[0];
    if (durationMatch && !isEnd) {
      const [hour, minute] = parsedTimes[0].split(':').map(Number);
      const endMinute = hour * 60 + minute + durationMinutes;
      if (durationMinutes < 30 || endMinute >= 24 * 60) {
        clarification = 'Khoảng đỗ qua ngày hoặc dưới 30 phút chưa phù hợp. Vui lòng chọn lại giờ vào và giờ ra.';
        clearTimes = true;
      } else {
        changes.endTime = `${pad(Math.floor(endMinute / 60))}:${pad(endMinute % 60)}`;
      }
    }
  } else if (durationMatch && continuing && /^\d{2}:\d{2}$/.test(previous.startTime || '')) {
    const [hour, minute] = previous.startTime.split(':').map(Number);
    const endMinute = hour * 60 + minute + durationMinutes;
    if (durationMinutes < 30 || endMinute >= 24 * 60) {
      clarification = 'Khoảng đỗ qua ngày hoặc dưới 30 phút chưa phù hợp. Vui lòng chọn lại giờ vào và giờ ra.';
      clearTimes = true;
    } else {
      changes.endTime = `${pad(Math.floor(endMinute / 60))}:${pad(endMinute % 60)}`;
    }
  }
  const effectiveStartDate = changes.startDate || (continuing ? previous.startDate : '');
  const effectiveStartTime = changes.startTime || (continuing ? previous.startTime : '');
  const effectiveEndTime = changes.endTime || (continuing ? previous.endTime : '');
  if (effectiveStartDate === today && /^([01]\d|2[0-3]):[0-5]\d$/.test(currentTime)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(effectiveStartTime) && effectiveStartTime <= currentTime) {
    clarification = `Giờ ${effectiveStartTime} hôm nay đã qua. Bạn vui lòng chọn giờ bắt đầu sau ${currentTime}.`;
    clearTimes = true;
  }
  if (!clarification && mentionedPlate && !licensePlate) clarification = 'Biển số chưa hợp lệ. Hãy đọc lại biển số đầy đủ của ô tô, gồm 2 số tỉnh, 1 đến 2 chữ cái và 4 đến 5 số cuối, ví dụ 43A12345.';
  if (!clarification && requestedVehicleCount > 1 && (!effectiveStartTime || !effectiveEndTime)) {
    clarification = `Mình sẽ đặt ${requestedVehicleCount} chỗ. Bạn muốn đỗ từ mấy giờ đến mấy giờ?`;
  }
  if (!clarification && requestedVehicleCount > licensePlates.length) {
    clarification = `Bạn muốn đặt ${requestedVehicleCount} xe. Vui lòng đọc đủ ${requestedVehicleCount} biển số; hiện mình nhận được ${licensePlates.length}.`;
  }
  if (!clarification && unspecifiedMultipleVehicles) {
    clarification = 'Bạn muốn đặt bao nhiêu xe? Vui lòng nói số lượng và đọc đầy đủ biển số từng xe.';
  }
  if (mentionedFloor && !floorName) clarification = 'Bạn muốn tầng nào? Hãy ghi rõ số hoặc tên tầng.';
  if (mentionedSlot && !slotCode) clarification = 'Bạn muốn ô đỗ nào? Hãy ghi rõ mã ô, ví dụ A-015.';
  if (!clarification && previous.pendingStartTime && !times.length) {
    clarification = 'Bạn muốn đỗ vào giờ sáng hay tối? Chỉ cần trả lời “sáng” hoặc “tối”.';
  }
  return { changes, clarification, clearTimes, clearPending: times.length > 0 };
}

module.exports = { parseBookingUtterance, specialBookingRequest };

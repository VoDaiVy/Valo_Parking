const simplify = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const { detectBookingLanguage } = require('./aiBookingLanguage');
const manualOnlyPattern = /\b(sac|vip|dich vu|gan|khu|zone|cong|loi ra|uu tien|co mai|ngoai troi)\b/;
const supportedLocationCodePattern = /\b(?:zone|khu(?:\s+vuc)?)\s*([a-z]+\d+)\b/;
const withoutSupportedLocationCode = (message) => message.replace(supportedLocationCodePattern, ' ');

function specialBookingRequest(prompt, previous = {}) {
  const message = simplify(prompt);
  if (/\bxe may\b/.test(message)) return 'VALO hiện chỉ hỗ trợ đặt chỗ cho ô tô.';
  const bookingCue = /\b(dat|giu cho|book|do xe|dau xe|gui xe|mai|hom nay|ngay kia)\b/.test(message)
    || /\b\d{1,2}\s*(?:h|gio|:)/.test(message)
    || previous.__intent === 'CREATE_BOOKING';
  if (bookingCue && /\b(moi ngay|hang ngay|lap lai moi ngay)\b/.test(message)) {
    return 'VALO chỉ hỗ trợ một khoảng giữ chỗ liên tục. Hãy nói rõ thời gian bắt đầu và thời gian kết thúc.';
  }
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
const nextMonthDay = (today, day = 1) => {
  const value = new Date(`${today}T12:00:00Z`);
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + 1);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + 1;
  const result = `${year}-${pad(month)}-${pad(day)}`;
  return validDate(result) ? result : '';
};
const dayOfMonthRange = (startDay, endDay, today) => {
  const reference = new Date(`${today}T12:00:00Z`);
  const make = (year, month, day) => {
    const value = `${year}-${pad(month)}-${pad(day)}`;
    return validDate(value) ? value : '';
  };
  let year = reference.getUTCFullYear();
  let month = reference.getUTCMonth() + 1;
  let start = make(year, month, Number(startDay));
  if (!start) return [];
  if (start < today) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    start = make(year, month, Number(startDay));
  }
  if (!start) return [];
  let end = make(year, month, Number(endDay));
  if (end && end < start) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    end = make(year, month, Number(endDay));
  }
  return end ? [start, end] : [];
};

const vietnameseDayWordPattern = '(?:ba muoi(?:\\s+mot)?|hai muoi(?:\\s+(?:mot|hai|ba|bon|nam|sau|bay|tam|chin))?|muoi(?:\\s+(?:mot|hai|ba|bon|nam|sau|bay|tam|chin))?|hai|ba|bon|nam|sau|bay|tam|chin)';
const vietnameseDayNumber = (value) => {
  const text = String(value || '').trim();
  if (/^\d{1,2}$/.test(text)) {
    const number = Number(text);
    return number >= 1 && number <= 31 ? number : 0;
  }
  const units = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9 };
  const tokens = text.split(/\s+/).filter(Boolean);
  let number = 0;
  if (tokens.length === 1) number = units[tokens[0]] || (tokens[0] === 'muoi' ? 10 : 0);
  else if (tokens[0] === 'muoi') number = 10 + (units[tokens[1]] || 0);
  else if (tokens[1] === 'muoi') number = (units[tokens[0]] || 0) * 10 + (units[tokens[2]] || 0);
  return number >= 1 && number <= 31 ? number : 0;
};

// Voice transcripts commonly put the date before its vehicle, for example
// "mười cho xe một, ngày 12 cho xe 2". Reorder those clauses into the same
// indexed shape used by the deterministic multi-vehicle parser.
function normalizeIndexedDateAssignments(message) {
  const assignment = new RegExp(`\\b(?:ngay\\s+)?(\\d{1,2}|${vietnameseDayWordPattern})\\s+(?:cho|cua)\\s+xe\\s*(?:thu\\s*)?(1|2|3|4|5|nhat|mot|hai|ba|tu|bon|nam)\\b`, 'g');
  return message.replace(assignment, (_, rawDay, vehicle) => {
    const day = vietnameseDayNumber(rawDay);
    return day ? `xe ${vehicle} ngay ${day}` : _;
  });
}

const plateDigits = {
  khong: '0', linh: '0', le: '0', mot: '1', hai: '2', ba: '3', bon: '4', bong: '4', tu: '4',
  nam: '5', lam: '5', sau: '6', bay: '7', tam: '8', chin: '9',
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  owe: '0', won: '1', want: '1', to: '2', too: '2', tree: '3', free: '3', chi: '3',
  for: '4', fore: '4', fire: '5', sex: '6', heaven: '7', ate: '8', mine: '9',
};
const plateLetters = {
  a: 'A', b: 'B', be: 'B', bo: 'B', c: 'C', ce: 'C', xe: 'C', d: 'D', de: 'D',
  e: 'E', g: 'G', ge: 'G', h: 'H', hat: 'H', k: 'K', ca: 'K', m: 'M', em: 'M',
  n: 'N', no: 'N', p: 'P', pe: 'P', r: 'R', ro: 'R', s: 'S', et: 'S',
  t: 'T', te: 'T', v: 'V', ve: 'V', x: 'X', ich: 'X',
  ay: 'A', bee: 'B', see: 'C', sea: 'C', dee: 'D', gee: 'G', jay: 'J', kay: 'K',
  el: 'L', en: 'N', pee: 'P', cue: 'Q', ar: 'R', ess: 'S', tee: 'T', vee: 'V',
  doubleyou: 'W', why: 'Y', zee: 'Z', zed: 'Z', i: 'I',
  alpha: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F',
  golf: 'G', hotel: 'H', india: 'I', juliett: 'J', juliet: 'J', kilo: 'K', lima: 'L',
  mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R',
  sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', xray: 'X',
  yankee: 'Y', zulu: 'Z',
};
const fullPlatePattern = /^[1-9]\d[A-Z]{1,2}\d{4,5}$/;
const directPlatePattern = /\b[1-9]\d[\s,.;-]*[a-z]{1,2}(?:[\s,.;-]*\d){4,5}\b/g;

// Browser speech recognition commonly returns English homophones for isolated
// plate characters (for/four, want/one, to/two, fire/five). Scan only sequences
// that have the exact Vietnamese car-plate shape so normal English sentences
// are not rewritten as license plates.
function decodeSpokenPlateSequence(value) {
  const tokens = String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let start = 0; start < tokens.length; start += 1) {
    let plate = '';
    let provinceDigits = 0;
    let letters = 0;
    let finalDigits = 0;
    let best = '';
    for (let index = start; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (provinceDigits < 2) {
        const digit = /^\d$/.test(token) ? token : plateDigits[token];
        if (digit === undefined || (provinceDigits === 0 && digit === '0')) break;
        plate += digit;
        provinceDigits += 1;
        continue;
      }
      if (letters === 0 || (letters < 2 && finalDigits === 0 && plateDigits[token] === undefined)) {
        const letter = plateLetters[token] || (/^[a-z]$/.test(token) ? token.toUpperCase() : '');
        if (!letter) break;
        plate += letter;
        letters += 1;
        continue;
      }
      const digit = /^\d$/.test(token) ? token : plateDigits[token];
      if (digit === undefined || finalDigits >= 5) break;
      plate += digit;
      finalDigits += 1;
      if (fullPlatePattern.test(plate)) best = plate;
    }
    if (best) return best;
  }
  return '';
}

function extractDirectLicensePlates(message) {
  return [...String(message || '').matchAll(directPlatePattern)]
    .map((match) => match[0].replace(/[^a-z0-9]/gi, '').toUpperCase())
    .filter((plate) => fullPlatePattern.test(plate));
}

function decodeSpokenPlate(value) {
  const raw = String(value || '').trim().replace(/\btu\s+\d{1,2}\s*(?:h|gio|:)\b.*$/, '').trim();
  const compact = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/^(?:\d{1,2}[A-Z]{0,2}\d{0,6}|[A-Z]{1,2}\d{1,6})$/.test(compact)) return compact;
  const recognizedSequence = decodeSpokenPlateSequence(raw);
  if (recognizedSequence) return recognizedSequence;
  const tokens = raw.replace(/\b(?:bien so|bien|khac|la|cua|toi|my|the|license|plate|number|registration|vehicle|car|letter|is|its|it s)\b/g, ' ')
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
  const spoken = message.match(/\b(?:bien so|bien|xe|license plate|plate number|registration number|vehicle registration|plate)\s+(?:khac\s+)?(?:la|is)?\s*([^.!?]+)/);
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
  const match = message.match(/\b(\d+|mot|hai|ba|bon|nam)\s*(?:chiec\s+)?xe\b/);
  if (match) return Number(words[match[1]] || match[1]);
  if (/\b(?:ca|cho)\s+hai\s+xe\b|\bca\s+doi\s+xe\b/.test(message)) return 2;
  return 0;
}

// Slot codes are often supplied as a very short contextual reply ("E6",
// "cho tôi E6", "I'll take E6"). Keep this deliberately narrower than a
// license-plate matcher: a slot has one/two letters and at most four digits.
function extractContextualSlotCode(message, continuing = false) {
  const prefixed = message.match(/\b(?:o(?:\s+do)?|bai(?:\s+xe)?(?:\s+do)?|cho(?:\s+do)?|vi\s+tri|slot|parking\s+(?:spot|space)|doi(?:\s+(?:sang|qua))?|chuyen(?:\s+(?:sang|qua))?|lay|chon|dung|use|take|choose|pick|select|switch\s+to|change\s+to|give\s+me|cho\s+(?:nguoi_dung|minh))\s*(?:o(?:\s+do)?|bai(?:\s+xe)?(?:\s+do)?|cho(?:\s+do)?|vi\s+tri|slot)?\s*([a-z]{1,2})\s*([-_.]?)\s*(\d{1,4})\b/);
  if (prefixed) return `${prefixed[1]}${prefixed[2]}${prefixed[3]}`.toUpperCase();
  if (!continuing) return '';
  const bare = message.trim().match(/^([a-z]{1,2})\s*[-_. ]?\s*(\d{1,4})[.!?]?$/);
  return bare ? `${bare[1]}${bare[2]}`.toUpperCase() : '';
}

function parsePlateFollowUp(message, previous = {}, language = 'vi') {
  const tr = (english, vietnamese) => language === 'en' ? english : vietnamese;
  const spoken = decodeSpokenPlate(message);
  if (!spoken) return null;
  const rawPending = String(previous.pendingLicensePlate || '').toUpperCase();
  const missingLetter = rawPending.match(/^(\d{2})_([0-9]{4,5})$/);
  if (missingLetter && /^[A-Z]{1,2}$/.test(spoken)) {
    const complete = `${missingLetter[1]}${spoken}${missingLetter[2]}`;
    if (fullPlatePattern.test(complete)) {
      const priorPlates = Array.isArray(previous.licensePlates) ? previous.licensePlates : [];
      const licensePlates = [...new Set([...priorPlates, complete])];
      const requestedVehicleCount = Number(previous.requestedVehicleCount || 0);
      return {
        changes: { licensePlate: complete, licensePlates, requestedVehicleCount },
        clearPendingPlate: true,
        clarification: requestedVehicleCount > licensePlates.length
          ? tr(
            `I have received ${licensePlates.length} of ${requestedVehicleCount} license plates. Please provide the next plate.`,
            `Mình đã nhận ${licensePlates.length}/${requestedVehicleCount} biển số. Hãy đọc biển số xe tiếp theo.`,
          )
          : '',
      };
    }
  }
  if (/^\d{6,7}$/.test(spoken)) {
    // Six digits means the middle letter was omitted. With seven digits, speech
    // recognition often turns A/B/C into the third digit, so preserve the last
    // four digits and ask only for the ambiguous letter.
    const province = spoken.slice(0, 2);
    const finalDigits = spoken.length === 6 ? spoken.slice(2) : spoken.slice(3);
    const pendingLicensePlate = `${province}_${finalDigits}`;
    return {
      changes: {},
      pendingLicensePlate,
      clarification: tr(
        `I heard only numbers: ${spoken}. Which letter is between ${province} and ${finalDigits}? Please say Alpha, Bravo, Charlie, or another NATO letter.`,
        `Mình chỉ nghe được các số ${spoken}. Chữ cái nằm giữa ${province} và ${finalDigits} là gì? Hãy đọc chữ cái đó, ví dụ Alpha, Bravo hoặc Charlie.`,
      ),
    };
  }
  const pending = rawPending.replace(/[^A-Z0-9]/g, '');
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
        ? tr(
          `I have received ${licensePlates.length} of ${requestedVehicleCount} license plates. Please provide the next plate.`,
          `Mình đã nhận ${licensePlates.length}/${requestedVehicleCount} biển số. Hãy đọc biển số xe tiếp theo.`,
        )
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
    changes: {}, clarification: tr(
      'The license plate is invalid. Please provide the full car plate: two province digits, one or two letters, and four or five final digits, for example 43A12345.',
      'Biển số chưa hợp lệ. Hãy đọc lại biển số đầy đủ của ô tô, gồm 2 số tỉnh, 1 đến 2 chữ cái và 4 đến 5 số cuối, ví dụ 43A12345.',
    ),
  };
  const clarification = /^[A-Z]/.test(partial)
    ? tr(`I recorded ${partial}. Please provide the first two digits of the plate.`, `Mình đã ghi ${partial}. Hãy đọc 2 số đầu của biển số.`)
    : /^\d{1,2}$/.test(partial)
      ? tr(`I recorded ${partial}. Please provide the letters and final digits.`, `Mình đã ghi ${partial}. Hãy đọc chữ cái và dãy số cuối.`)
      : tr(`I recorded ${partial}. Please provide the rest of the license plate.`, `Mình đã ghi ${partial}. Hãy đọc tiếp phần còn lại của biển số.`);
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
  const pendingField = String(previous.pendingReservationEditField || '');
  const isWaitingForTarget = pendingField === 'target';
  const editCue = /\b(?:doi|sua|thay|chinh)(?:\s+lai)?\b/.test(message);
  const namesExistingVehicle = mentionedPlates.some((plate) => items.some((item) => item.licensePlate === plate));
  const suppliesReplacementSchedule = extractTimes(message).length > 0
    || /\b(?:hom nay|ngay mai|ngay kia|ngay mot|mai|\d{1,2}\/\d{1,2})\b/.test(message);
  if (!editCue && !hasPendingTarget && !isWaitingForTarget
    && !(namesExistingVehicle && suppliesReplacementSchedule)) return null;

  const ordinal = message.match(/\b(?:xe\s*(?:(?:so|thu)\s*)?|(?:so|thu)\s+|sai\s+so\s+)(1|2|3|4|5|nhat|mot|hai|ba|tu|bon|nam)\b/);
  const ordinalWords = { nhat: 1, mot: 1, hai: 2, ba: 3, tu: 4, bon: 4, nam: 5 };
  let targetIndex = ordinal ? Number(ordinalWords[ordinal[1]] || ordinal[1]) - 1 : -1;
  if (targetIndex < 0 && mentionedPlates.length) {
    targetIndex = items.findIndex((item) => item.licensePlate === mentionedPlates[0]);
  }
  if (targetIndex < 0 && hasPendingTarget) targetIndex = pendingIndex;
  if (targetIndex < 0 || targetIndex >= count) {
    return {
      changes: { requestedVehicleCount: count, reservationItems: items },
      pendingReservationEditIndex: -1,
      pendingReservationEditField: 'target',
      clarification: 'Bạn muốn sửa xe nào? Hãy nói số thứ tự hoặc biển số xe.',
    };
  }

  const datePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;
  const dateToken = message.match(datePattern)?.[0] || '';
  const date = dateToken ? parseDateToken(dateToken, today) : '';
  const times = extractTimes(message);
  const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
  if (parsedTimes.includes(null) || times.length > 2) return null;

  const wantsTime = /\b(?:gio|thoi gian|tu\s+\d{1,2})\b/.test(message) || pendingField === 'giờ';
  const wantsDate = /\bngay\b/.test(message) || pendingField === 'ngày';
  const changesPlate = /\b(?:bien so|doi xe|thay xe)\b/.test(message) || pendingField === 'biển số';
  const slotCode = extractContextualSlotCode(message, true);
  const wantsSlot = Boolean(slotCode)
    || /\b(?:o(?:\s+do)?|bai(?:\s+xe)?(?:\s+do)?|vi\s+tri|slot)\b/.test(message)
    || pendingField === 'ô đỗ';
  const floorMatch = message.match(/\b(?:tang|floor)\s*([a-z]?\d+)\b/);
  const wantsFloor = Boolean(floorMatch) || pendingField === 'tầng';
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
  if (floorMatch) {
    items[targetIndex].floorName = `tầng ${floorMatch[1].toUpperCase()}`;
    items[targetIndex].zoneName = '';
    items[targetIndex].slotCode = '';
    changed = true;
  }
  if (slotCode) {
    items[targetIndex].slotCode = slotCode;
    if (!floorMatch) {
      items[targetIndex].floorName = '';
      items[targetIndex].zoneName = '';
    }
    changed = true;
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
  const field = changesPlate ? 'biển số'
    : wantsDate ? 'ngày'
      : wantsTime ? 'giờ'
        : wantsSlot ? 'ô đỗ'
          : wantsFloor ? 'tầng' : 'thông tin';
  return {
    changes: baseChanges,
    pendingReservationEditIndex: targetIndex,
    pendingReservationEditField: field,
    clarification: field === 'giờ'
      ? `Bạn muốn đổi giờ của ${target} thành từ mấy giờ đến mấy giờ?`
      : field === 'biển số'
        ? `Bạn muốn đổi ${target} sang biển số nào?`
        : field === 'ô đỗ'
          ? `Bạn muốn đổi ${target} sang ô đỗ nào?`
          : field === 'tầng'
            ? `Bạn muốn đổi ${target} sang tầng nào?`
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
  const bareDay = token.match(/^ngay\s+(\d{1,2})$/);
  if (bareDay) return dayOfMonthRange(bareDay[1], bareDay[1], today)[0] || '';
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

const indexedDatePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|ngay\s+\d{1,2}(?!\s*\/))\b/;

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

function nextReservationQuestion(items, count) {
  const missingSchedule = items.findIndex((item) => !item.startDate || !item.startTime || !item.endTime);
  if (missingSchedule >= 0) {
    const item = items[missingSchedule];
    return !item.startDate
      ? `Xe ${missingSchedule + 1} đỗ ngày nào?`
      : `Xe ${missingSchedule + 1} đỗ từ mấy giờ đến mấy giờ?`;
  }
  return plateClarification(items, count);
}

// When the previous reply asked for one missing vehicle field, a short answer
// such as "ngày mười" or "7h đến 8h" belongs to that first incomplete item.
// This prevents the generic shared draft from forgetting which vehicle was
// being completed and asking for every date again.
function parsePendingReservationScheduleAnswer(message, today, previous = {}) {
  const previousItems = Array.isArray(previous.reservationItems) ? previous.reservationItems : [];
  const count = Math.max(Number(previous.requestedVehicleCount || 0), previousItems.length);
  if (count < 2 || count > 5 || !previousItems.length) return null;
  if (/\bxe\s*(?:thu\s*)?(?:[1-5]|nhat|mot|hai|ba|tu|bon|nam)\b/.test(message)) return null;

  const items = reservationItemsFromPrevious(previous, count);
  const missingDateIndex = items.findIndex((item) => !item.startDate);
  const dateToken = message.match(indexedDatePattern)?.[0] || '';
  const dateOnlyRemainder = dateToken
    ? message.replace(dateToken, '').replace(/\b(?:vao|la|do|nhe|nha|a|oi)\b/g, '').replace(/[^a-z0-9]+/g, '')
    : 'not-a-date-answer';
  if (missingDateIndex >= 0 && dateToken && !dateOnlyRemainder) {
    const date = parseDateToken(dateToken, today);
    if (!date) return null;
    items[missingDateIndex].startDate = date;
    items[missingDateIndex].endDate = date;
    return {
      changes: {
        requestedVehicleCount: count,
        reservationItems: items,
        licensePlates: items.map((item) => item.licensePlate).filter(Boolean),
        licensePlate: items.find((item) => item.licensePlate)?.licensePlate || '',
      },
      clarification: nextReservationQuestion(items, count),
    };
  }

  const missingTimeIndex = items.findIndex((item) => !item.startTime || !item.endTime);
  const times = extractTimes(message);
  if (missingTimeIndex >= 0 && times.length === 2) {
    const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
    if (parsedTimes.includes(null) || parsedTimes[1] <= parsedTimes[0]) return null;
    items[missingTimeIndex].startTime = parsedTimes[0];
    items[missingTimeIndex].endTime = parsedTimes[1];
    return {
      changes: {
        requestedVehicleCount: count,
        reservationItems: items,
        licensePlates: items.map((item) => item.licensePlate).filter(Boolean),
        licensePlate: items.find((item) => item.licensePlate)?.licensePlate || '',
      },
      clarification: nextReservationQuestion(items, count),
    };
  }
  return null;
}

const englishNumbers = {
  zero: 0, one: 1, an: 1, a: 1, two: 2, couple: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const englishOrdinals = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, 'twenty first': 21, 'twenty second': 22,
  'twenty third': 23, 'twenty fourth': 24, 'twenty fifth': 25, 'twenty sixth': 26,
  'twenty seventh': 27, 'twenty eighth': 28, 'twenty ninth': 29, thirtieth: 30,
  'thirty first': 31,
};
const englishMonths = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const englishWeekdays = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
const englishNumber = (value) => {
  const text = String(value || '').trim().replace(/^(?:a|an)\s+couple(?:\s+of)?$/, 'couple');
  if (/^\d+$/.test(text)) return Number(text);
  return englishNumbers[text] ?? englishOrdinals[text] ?? null;
};
const upcomingWeekday = (today, weekday, forceFollowing = false) => {
  const current = new Date(`${today}T12:00:00Z`).getUTCDay();
  let difference = (weekday - current + 7) % 7;
  if (forceFollowing && difference === 0) difference = 7;
  return addDays(today, difference);
};

function parseEnglishDate(message, today) {
  if (/\bday after tomorrow\b/.test(message)) return addDays(today, 2);
  if (/\btomorrow\b/.test(message)) return addDays(today, 1);
  if (/\btoday\b/.test(message)) return today;
  if (/\btonight\b/.test(message)) return today;
  if (/\bnext\s+week\b/.test(message)) return upcomingWeekday(today, 1, true);
  if (/\bnext\s+month\b/.test(message)) return nextMonthDay(today);
  const weekend = message.match(/\b(next\s+)?weekend\b/);
  if (weekend) {
    let date = upcomingWeekday(today, 6, true);
    if (weekend[1]) date = addDays(date, 7);
    return date;
  }
  const weekday = message.match(/\b(?:(next|this|following)\s+|on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekday) return upcomingWeekday(today, englishWeekdays[weekday[2]], ['next', 'following'].includes(weekday[1]));

  const monthFirst = message.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty first|twenty second|twenty third|twenty fourth|twenty fifth|twenty sixth|twenty seventh|twenty eighth|twenty ninth|thirtieth|thirty first)(?:,?\s+(\d{4}))?\b/);
  const dayFirst = message.match(/\b(?:the\s+)?(\d{1,2}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty first|twenty second|twenty third|twenty fourth|twenty fifth|twenty sixth|twenty seventh|twenty eighth|twenty ninth|thirtieth|thirty first)\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/);
  const match = monthFirst || dayFirst;
  if (!match) {
    const standaloneOrdinal = message.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
    return standaloneOrdinal ? dayOfMonthRange(standaloneOrdinal[1], standaloneOrdinal[1], today)[0] || '' : '';
  }
  const monthText = monthFirst ? match[1] : match[2];
  const rawDayText = monthFirst ? match[2] : match[1];
  const dayText = /^\d/.test(rawDayText) ? rawDayText.replace(/(?:st|nd|rd|th)$/i, '') : rawDayText;
  const month = englishMonths[monthText];
  const day = englishNumber(dayText);
  let year = Number(match[3] || today.slice(0, 4));
  if (!day) return '';
  let result = `${year}-${pad(month)}-${pad(day)}`;
  if (!validDate(result)) return '';
  if (!match[3] && result < today) {
    year += 1;
    result = `${year}-${pad(month)}-${pad(day)}`;
  }
  return validDate(result) ? result : '';
}

const englishClockPattern = '(?:\\d{1,2}(?::\\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\\s*(?:am|pm)|\\s+in the (?:morning|afternoon|evening|night))?';

function parseEnglishClock(value, inferredPeriod = '') {
  const text = String(value || '').trim().replace(/\./g, '');
  const match = text.match(/^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|in the morning|in the afternoon|in the evening|in the night)?$/);
  if (!match) return '';
  let hour = englishNumber(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3] || inferredPeriod;
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return '';
  if (/pm|afternoon|evening|night/.test(period) && hour < 12) hour += 12;
  if (/am|morning/.test(period) && hour === 12) hour = 0;
  return `${pad(hour)}:${pad(minute)}`;
}

function extractEnglishTimeData(message, previous = {}) {
  const approximate = /\b(?:around|about|approximately|roughly)\s+(?:at\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s+hours?\b)/.test(message);
  if (approximate) return { clarification: 'What exact time would you like to use?' };
  const clock = englishClockPattern;
  const patterns = [
    new RegExp(`\\b(?:from|between)\\s+(${clock})\\s+(?:to|until|and|through|-)\\s+(${clock})\\b`),
    // Speech recognition commonly drops "from/to" and returns a natural pair
    // such as "5 AM and 9 AM". In a booking turn, two complete clock values
    // joined by "and" still unambiguously mean arrival and departure.
    new RegExp(`\\b(${clock})\\s+(?:to|until|till|and(?:\\s+then)?|through|-)\\s+(${clock})\\b`),
    new RegExp(`\\b(?:arrive|arriving|start|starting)\\s+(?:at\\s+)?(${clock}).*?\\b(?:leave|leaving|end|ending)\\s+(?:at\\s+)?(${clock})\\b`),
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    const secondPeriod = /\b(pm|in the afternoon|in the evening|in the night)\b/.test(match[2]) ? 'pm'
      : /\b(am|in the morning)\b/.test(match[2]) ? 'am' : '';
    const startTime = parseEnglishClock(match[1], secondPeriod);
    const endTime = parseEnglishClock(match[2]);
    if (startTime && endTime) return { startTime, endTime };
  }

  const start = message.match(new RegExp(`\\b(?:at|from|starting at|start at|arrive at|will arrive at|want to arrive at|arrival time is|plan to arrive at)\\s+(${clock})\\b`));
  const end = message.match(new RegExp(`\\b(?:until|up to|leave at|will leave at|be leaving at|leaving at|departure time is|end at|ending at)\\s+(${clock})\\b`));
  if (start || end) return {
    startTime: start ? parseEnglishClock(start[1]) : '',
    endTime: end ? parseEnglishClock(end[1]) : '',
  };
  const short = message.replace(/[.!?]+$/g, '').trim().match(new RegExp(`^(${clock})$`));
  if (short) {
    const time = parseEnglishClock(short[1]);
    if (!time) return {};
    return previous.startTime && !previous.endTime ? { endTime: time } : { startTime: time };
  }
  return {};
}

function addDuration(startDate, startTime, durationMinutes) {
  if (!startDate || !startTime || !durationMinutes) return {};
  const start = new Date(`${startDate}T${startTime}:00+07:00`);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const local = new Date(end.getTime() + 7 * 3600000).toISOString();
  return { endDate: local.slice(0, 10), endTime: local.slice(11, 16) };
}

// Defensive normalization for text produced by English browser speech
// recognition. Keep every rule tied to parking vocabulary; never infer dates,
// clock values or license-plate characters from an uncertain transcript.
function normalizeEnglishRecognitionErrors(value) {
  return String(value || '')
    .replace(/\bi\s+(?:nick|neat|knead)\s+(?=book)/gi, 'I need to ')
    .replace(/\bi\s+(?:nick|neat|knead)\b/gi, 'I need')
    .replace(/\bi\s+(?:one|won)\s+to\s+(?=book|reserve|park)/gi, 'I want to ')
    .replace(/\bi\s+want\s+a\s+(?=book\b)/gi, 'I want to ')
    .replace(/\b(?:book\s*wonder|book\s*wander|bookwonder|bookwander)\b/gi, 'book a parking space')
    .replace(/\bparking\s+(?:sport|sports|spock|stop)\b/gi, 'parking spot')
    .replace(/\bparking\s+(?:spice|pace)\b/gi, 'parking space')
    .replace(/\bbook\s+kings?\b/gi, 'bookings')
    .replace(/\blicen[cs]e\s+(?:place|played|plain)\b/gi, 'license plate')
    .replace(/\bnumber\s+plate\b/gi, 'license plate')
    .replace(/\bwallet\s+balanced\b/gi, 'wallet balance')
    .replace(/\bwhere\s+is\s+my\s+card\b/gi, 'where is my car')
    .replace(/\bhow\s+(?:match|mash)\b/gi, 'how much')
    .replace(/\bcouncil\s+my\s+booking\b/gi, 'cancel my booking')
    .replace(/\bfor\s+(?:too|to)\s+hours?\b/gi, 'for two hours')
    .replace(/\bto\s+morrow\b/gi, 'tomorrow')
    .replace(/\b(?:cancel|change|modify|show|view|check)\s+my\s+book\s+in\b/gi,
      (match) => match.replace(/book\s+in/i, 'booking'))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEnglishBookingUtterance(prompt, today, previous = {}, currentTime = '', responseLanguage = 'en') {
  if (!validDate(today)) return null;
  const eveningClock = (clock) => {
    const [hourText] = String(clock).split(':');
    const numeric = englishNumber(hourText);
    if (!Number.isInteger(numeric) || numeric > 23) return clock;
    if (numeric === 12) return `${clock} am`;
    if (numeric > 12 || numeric === 0) return clock;
    return `${clock} pm`;
  };
  let message = simplify(normalizeEnglishRecognitionErrors(prompt))
    .replace(/\ba\.m\.?\b/g, 'am').replace(/\bp\.m\.?\b/g, 'pm')
    .replace(/\bnoon\b/g, '12 pm').replace(/\bmidnight\b/g, '12 am')
    .replace(/\bhalf\s+past\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/g,
      (_, hour) => `${englishNumber(hour)}:30`)
    .replace(/\bquarter\s+past\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/g,
      (_, hour) => `${englishNumber(hour)}:15`)
    .replace(/\bquarter\s+to\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/g,
      (_, hour) => {
        const numeric = englishNumber(hour);
        return numeric ? `${numeric === 1 ? 12 : numeric - 1}:45` : hour;
      })
    .replace(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+tomorrow\s+morning\b/g, 'tomorrow at $1 am');
  const naturalClock = '(?:\\d{1,2}(?::\\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  const namedDate = '(?:(?:next|this|following)\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|today|tomorrow';
  message = message
    .replace(new RegExp(`\\b(${namedDate})\\s+(?:night|evening)\\s+(?:at\\s+)?(${naturalClock})\\b`, 'g'),
      (_, date, clock) => `${date} night at ${eveningClock(clock)}`)
    .replace(new RegExp(`\\btonight\\s+(?:at\\s+)?(${naturalClock})\\b`, 'g'),
      (_, clock) => `tonight at ${eveningClock(clock)}`)
    .replace(new RegExp(`\\b(${naturalClock})\\s+tonight\\b`, 'g'),
      (_, clock) => `tonight at ${eveningClock(clock)}`)
    .replace(new RegExp(`\\b(${naturalClock})\\s+(${namedDate})\\s+(?:night|evening)\\b`, 'g'),
      (_, clock, date) => `${date} night at ${eveningClock(clock)}`);
  const continuing = previous.__intent === 'CREATE_BOOKING';
  const createCue = /\b(?:book|reserve|reservation|parking|park|spot|space|license plate|registration|somewhere to park|place to leave|save me)\b/.test(message)
    || /\b(?:want|need|like)\b.*\b(?:dat|xe|cho)\b/.test(message);
  const correctionCue = /\b(?:change|correct|instead|actually|wrong|meant)\b/.test(message);
  if (!continuing && !createCue) return null;

  const tr = (english, vietnamese) => responseLanguage === 'en' ? english : vietnamese;
  const contextualSlotCode = extractContextualSlotCode(message, continuing);
  const barePlateFollowUp = continuing && /\d/.test(message)
    && /^[a-z0-9\s,.-]{1,50}$/.test(message)
    && !/\b(?:am|pm|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hour|hours|from|until|to|at)\b/.test(message);
  const spokenPlateFollowUp = /\b(?:zero|oh|owe|one|won|want|two|to|too|three|tree|free|chi|four|for|fore|five|fire|six|sex|seven|heaven|eight|ate|nine|mine|alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliett|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|xray|yankee|zulu)\b/.test(message);
  const priorPlates = Array.isArray(previous.licensePlates) ? previous.licensePlates : [];
  const expectsPlateFollowUp = continuing && (!previous.licensePlate
    || Number(previous.requestedVehicleCount || 0) > priorPlates.length
    || previous.pendingLicensePlate);
  if ((expectsPlateFollowUp && (/\d/.test(message) || spokenPlateFollowUp)) || barePlateFollowUp) {
    const plateFollowUp = parsePlateFollowUp(message, previous, responseLanguage);
    if (plateFollowUp) return plateFollowUp;
  }
  if (/\b(?:change|correct).*(?:time|arrival|departure)\b/.test(message)
    && !new RegExp(englishClockPattern).test(message)) {
    return { changes: {}, clearTimes: true,
      clarification: tr('What arrival and departure times would you like instead?', 'Bạn muốn đổi giờ vào và giờ ra thành mấy giờ?') };
  }
  if (/\b(?:change|correct).*(?:date|day)\b/.test(message) && !parseEnglishDate(message, today)) {
    return { changes: {}, clearDates: true,
      clarification: tr('What date would you like instead?', 'Bạn muốn đổi sang ngày nào?') };
  }
  if (/\b(?:wrong plate|plate.*wrong|change the (?:license )?plate|wrong registration)\b/.test(message)
    && !extractLicensePlates(message).length) {
    return { changes: {}, clearVehicle: true,
      clarification: tr('What is the correct license plate?', 'Biển số đúng là gì?') };
  }

  if (/\b(?:in|after)\s+(?:a\s+)?few\s+days\b|\bsometime\s+(?:today|tomorrow|next\s+week)\b/.test(message)) {
    return { changes: {}, clearDates: true, clarification: tr(
      'Which exact date would you like?',
      'Bạn muốn chính xác ngày nào?',
    ) };
  }
  const relativeDays = message.match(/\bin\s+(two|three|four|five|\d+)\s+days?\b/);
  const englishRange = message.match(/\b(?:from\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+(?:to|through|until)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  const weekdayRange = message.match(/\b(?:from\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:to|through|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  let startDate = relativeDays ? addDays(today, englishNumber(relativeDays[1])) : parseEnglishDate(message, today);
  const midnightEndsNamedNight = /\b(?:tonight|night)\b.*\bat\s+12(?::\d{2})?\s+am\b/.test(message);
  if (startDate && midnightEndsNamedNight) startDate = addDays(startDate, 1);
  let endDate = startDate;
  if (englishRange) [startDate, endDate] = dayOfMonthRange(englishRange[1], englishRange[2], today);
  if (weekdayRange) {
    startDate = upcomingWeekday(today, englishWeekdays[weekdayRange[1]], false);
    endDate = upcomingWeekday(startDate, englishWeekdays[weekdayRange[2]], true);
  } else if (/\b(?:the\s+)?whole\s+weekend\b|\b(?:this|next)\s+weekend\b/.test(message) && startDate) {
    endDate = addDays(startDate, 1);
  }
  const hasAmbiguousOrdinal = /\b(?:on\s+)?(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th))\b/.test(message)
    && !Object.keys(englishMonths).some((month) => message.includes(month));
  if (!startDate && hasAmbiguousOrdinal) {
    return { changes: {}, clarification: tr('Which month do you mean?', 'Bạn muốn ngày đó trong tháng nào?') };
  }

  const timeData = extractEnglishTimeData(message, previous);
  if (timeData.clarification) return { changes: { startDate, endDate: startDate }, clearTimes: true, clarification: tr(
    timeData.clarification, 'Bạn muốn chính xác mấy giờ?',
  ) };
  let { startTime = '', endTime = '' } = timeData;
  const replacementTime = message.match(new RegExp(`\\b(?:make it|i meant|i want)\\s+(${englishClockPattern})\\s*(?:instead)?\\b`));
  if (replacementTime && !startTime && !endTime) {
    const replacement = parseEnglishClock(replacementTime[1]);
    if (replacement) {
      if (previous.startTime && !previous.endTime) endTime = replacement;
      else startTime = replacement;
    }
  }
  const hourDuration = message.match(/\b(?:just\s+)?for\s+(?:about\s+|around\s+|approximately\s+|only\s+)?(a\s+couple(?:\s+of)?|a|an|one|two|three|four|five|couple(?:\s+of)?|\d+)\s+hours?\b/)
    || message.match(/\band\s+(one|two|three|four|five|\d+)\s+hours?\b/);
  const minuteDuration = message.match(/\b(?:for\s+)?(\d+)\s+minutes?\b/);
  const dayDuration = message.match(/\bfor\s+(one|two|three|four|five|\d+)\s+days?\b/)
    || (relativeDays ? null : message.match(/\b(one|two|three|four|five|\d+)\s+days?\b/));
  const durationMinutes = /\b(?:for\s+)?(?:a|one)\s+day\s+and\s+a\s+half\b/.test(message) ? 36 * 60
    : /\b(?:for\s+)?half\s+an?\s+hour\b/.test(message) ? 30
    : /\b(?:for\s+)?(?:an?|one)\s+hour\s+and\s+a\s+half\b/.test(message) ? 90
      : (dayDuration ? englishNumber(dayDuration[1]) * 1440 : 0)
        + (hourDuration ? englishNumber(hourDuration[1].replace(/\s+of$/, '')) * 60 : 0)
        + (minuteDuration ? Number(minuteDuration[1]) : 0);
  const effectiveStartDate = startDate || previous.startDate || '';
  const effectiveEndDate = endDate || previous.endDate || effectiveStartDate;
  if (startTime && endTime && endTime <= startTime && effectiveStartDate && effectiveEndDate === effectiveStartDate
    && (/\b(?:overnight|through the night)\b/.test(message) || /\bpm\b.*\bam\b/.test(message))) {
    endDate = addDays(effectiveEndDate, 1);
  }
  const effectiveStartTime = startTime || previous.startTime || '';
  if (durationMinutes && effectiveStartDate && effectiveStartTime && !endTime) {
    const calculated = addDuration(effectiveStartDate, effectiveStartTime, durationMinutes);
    endTime = calculated.endTime;
  }

  const countMatch = message.match(/\b(one|two|three|four|five|\d+)\s+(?:cars?|vehicles?|parking spaces?|spots?)\b/)
    || message.match(/\b(?:for|bringing|have)\s+(one|two|three|four|five|\d+)\s+(?:cars?|vehicles?)\b/);
  const priorVehicleCount = Number(previous.requestedVehicleCount || (previous.licensePlate ? 1 : 0));
  const requestedVehicleCount = countMatch ? englishNumber(countMatch[1])
    : /\b(?:both|the\s+two)\s+(?:cars?|vehicles?)\b/.test(message) ? 2
      : /\b(?:add|bring|include)\s+another\s+(?:car|vehicle)\b/.test(message)
        ? Math.max(2, priorVehicleCount + 1)
        : priorVehicleCount;
  if (requestedVehicleCount > 5) return null;
  const incomingPlates = extractLicensePlates(message);
  let licensePlates = [...new Set([...(continuing && Array.isArray(previous.licensePlates) ? previous.licensePlates : []), ...incomingPlates])];
  let pendingLicensePlate = '';
  if (!incomingPlates.length && /\b(?:license plate|plate number|registration|plate is)\b/.test(message)) {
    const spoken = decodeSpokenPlate(message);
    if (fullPlatePattern.test(spoken)) licensePlates = [...new Set([...licensePlates, spoken])];
    else if (spoken) pendingLicensePlate = spoken;
  }
  if (!incomingPlates.length && continuing && (!previous.licensePlate || Number(previous.requestedVehicleCount || 0) > licensePlates.length)) {
    const spoken = decodeSpokenPlate(message);
    if (fullPlatePattern.test(spoken)) licensePlates = [...new Set([...licensePlates, spoken])];
  }
  const licensePlate = licensePlates.find((plate) => !Array.isArray(previous.licensePlates) || !previous.licensePlates.includes(plate))
    || licensePlates[0] || '';

  if (!startDate && !startTime && !endTime && !durationMinutes && !licensePlate && !requestedVehicleCount
    && !createCue && !correctionCue) return null;
  const changes = {
    startDate, endDate, startTime, endTime, licensePlate, licensePlates,
    requestedVehicleCount, vehicleType: /\b(?:electric car|electric vehicle|ev)\b/.test(message) ? 'electric_car' : '',
    floorName: '', zoneName: '', slotCode: contextualSlotCode,
  };
  if (durationMinutes && effectiveStartDate && effectiveStartTime) Object.assign(changes, addDuration(effectiveStartDate, effectiveStartTime, durationMinutes));
  let clarification = '';
  if (startTime && endTime && endTime <= startTime && (!changes.endDate || changes.endDate === effectiveStartDate)) {
    clarification = tr('The departure time must be after the arrival time. What times would you like?', 'Giờ ra cần sau giờ vào. Bạn muốn đổi lại khoảng giờ nào?');
  } else if (pendingLicensePlate) {
    clarification = tr('Could you confirm the full license plate?', 'Bạn đọc lại đầy đủ biển số giúp mình nhé.');
  } else if (requestedVehicleCount > licensePlates.length) {
    clarification = tr(
      `You are booking for ${requestedVehicleCount} vehicles. Please provide all ${requestedVehicleCount} license plates. I have ${licensePlates.length} so far.`,
      `Bạn muốn đặt ${requestedVehicleCount} xe. Vui lòng đọc đủ ${requestedVehicleCount} biển số; hiện mình nhận được ${licensePlates.length}.`,
    );
  }
  const result = { changes, clarification };
  if (/\b(?:change|switch).*(?:vehicle|car)\b/.test(message) && !licensePlate) result.clearVehicle = true;
  if (pendingLicensePlate) result.pendingLicensePlate = pendingLicensePlate;
  return result;
}

// Existing Vietnamese parser remains isolated so bilingual support cannot regress it.
function parseVietnameseBookingUtterance(prompt, today, previous = {}, currentTime = '') {
  if (!validDate(today)) return null;
  const words = { 'muoi mot': 11, 'muoi hai': 12, mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10 };
  const markedPrompt = String(prompt || '')
    .replace(/tháng\s+sáu/giu, 'thang6')
    .replace(/tháng\s+sau/giu, 'thangtieptheo')
    .replace(/tuần\s+tới/giu, 'tuan sau');
  let message = simplify(markedPrompt.replace(/\btôi\b/giu, 'nguoi_dung').replace(/\btới\b/giu, 'đến').replace(/\b(?:ngày\s+)?mốt\b/giu, 'ngaykia'))
    .replace(/\bngaykia\b/g, 'ngay kia')
    .replace(/\bngay(?=\d)/g, 'ngay ')
    .replace(/\btoi\s+(?=muon|xin|can|se|dat|co)\b/g, 'nguoi_dung ')
    .replace(/(\d{1,2}\s*(?:h|gio|:\d{2})?)\s+toi\s+(?=\d{1,2})/g, '$1 den ')
    .replace(/\b(muoi mot|muoi hai|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s+(gio|tieng)\b/g,
      (match, word, unit) => `${words[word]} ${unit}`)
    .replace(/\b(\d{1,2})\s+ruoi\s+(sang|chieu|toi|trua)\b/g, '$1 gio ruoi $2')
    .replace(/\bnua\s+(?:gio|tieng)\b/g, 'trong 30 phut')
    .replace(/\bmot\s+tuan\b/g, 'trong 7 ngay')
    .replace(/\bnua\s+dem\b/g, '0 gio')
    .replace(/\b12\s+trua\b/g, '12 gio trua')
    .replace(/\b(\d{1,2})\s+thang6(?:\s+nam\s+(\d{4}))?\b/g,
      (_, day, year) => `${day}/6${year ? `/${year}` : ''}`)
    .replace(/\b(\d{1,2})\s+thang\s+(muoi mot|muoi hai|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|\d{1,2})(?:\s+nam\s+(\d{4}))?\b/g,
      (_, day, month, year) => `${day}/${words[month] || month}${year ? `/${year}` : ''}`);
  message = message.replace(new RegExp(`\\bngay\\s+(${vietnameseDayWordPattern})\\b`, 'g'), (match, rawDay) => {
    const day = vietnameseDayNumber(rawDay);
    return day ? `ngay ${day}` : match;
  });
  message = normalizeIndexedDateAssignments(message);
  const nextMonth = nextMonthDay(today);
  const nextMonthParts = nextMonth ? nextMonth.split('-') : [];
  const weekendRangeRequested = /\b(?:ca\s+|suot\s+)?cuoi\s+tuan\b/.test(message);
  message = message
    .replace(/\btu\s+ngay\s+(\d{1,2})\s+(?:den|toi)\s+ngay\s+(\d{1,2})\s+thangtieptheo\b/g,
      (_, startDay, endDay) => `tu ngay ${startDay}/${nextMonthParts[1]}/${nextMonthParts[0]} den ngay ${endDay}/${nextMonthParts[1]}/${nextMonthParts[0]}`)
    .replace(/\bngay\s+(\d{1,2})\s+thangtieptheo\b/g,
      (_, day) => `${day}/${nextMonthParts[1]}/${nextMonthParts[0]}`)
    .replace(/\b(\d{1,3})\s+ngay\s+nua\b/g, (_, count) => addDays(today, Number(count)));
  message = message.replace(
    /\b(thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|chu\s+nhat)\s+tuan\s+toi\b/g,
    '$1 tuan sau',
  );
  if (!/\b(?:thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|chu\s+nhat|cuoi)\s+tuan\s+(?:sau|toi)\b/.test(message)) {
    message = message.replace(/\btuan\s+(?:sau|toi)\b/g, upcomingWeekday(today, 1, true));
  }
  message = message
    .replace(/\bcuoi\s+tuan\s+sau\b/g, addDays(upcomingWeekday(today, 6, true), 7))
    .replace(/\bthangtieptheo\b/g, nextMonth);
  const continuing = previous.__intent === 'CREATE_BOOKING';
  const contextualSlotCode = extractContextualSlotCode(message, continuing);
  if (/\b(?:vai\s+ngay\s+nua|luc\s+nao\s+do|khi\s+nao\s+do)\b/.test(message)) {
    return { changes: {}, clearDates: true, clarification: 'Bạn muốn chính xác ngày nào?' };
  }
  if (/\b(?:khoang|tam|xap\s+xi)\s+(?:luc\s+)?\d{1,2}(?:\s*(?:h|gio)|:\d{2})/.test(message)) {
    return { changes: {}, clearTimes: true, clarification: 'Bạn muốn chính xác mấy giờ?' };
  }
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
  const pendingReservationSchedule = parsePendingReservationScheduleAnswer(message, today, previous);
  if (pendingReservationSchedule) return pendingReservationSchedule;
  const previousPlates = [...new Set([
    ...(Array.isArray(previous.licensePlates) ? previous.licensePlates : []),
    ...(Array.isArray(previous.reservationItems)
      ? previous.reservationItems.map((item) => item?.licensePlate) : []),
  ].filter(Boolean))];
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
  if (/\b(moi ngay|hang ngay|lap lai moi ngay)\b/.test(message)) {
    return { changes: {}, clarification: 'VALO chỉ hỗ trợ một khoảng giữ chỗ liên tục. Hãy nói rõ thời gian bắt đầu và thời gian kết thúc.' };
  }
  if (/\b(thang|xe may|toi da|toi thieu)\b/.test(message)
    || manualOnlyPattern.test(withoutSupportedLocationCode(message))) return null;
  const requestedVehicleCount = extractVehicleCount(message) || Number(previous.requestedVehicleCount || 0);
  const unspecifiedMultipleVehicles = /\b(?:nhieu|vai)\s+xe\b/.test(message) && !requestedVehicleCount;
  if (requestedVehicleCount > 5 || /\b\d+\s*(?:cho|o do)\b/.test(message)) return null;

  const datePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|cuoi tuan|thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)(?:\s+tuan\s+(?:sau|nay))?|chu nhat(?:\s+tuan\s+(?:sau|nay))?|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|ngay\s+\d{1,2}(?!\s*\/))\b/g;
  const sharedMonthRange = message.match(/\btu\s+(?:ngay\s+)?(\d{1,2})\s+(?:den|toi)\s+(?:ngay\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const bareDayRange = !sharedMonthRange
    ? message.match(/\b(?:tu\s+)?ngay\s+(\d{1,2})\s+(?:den|toi)\s+ngay\s+(\d{1,2})\b/) : null;
  const dateMatches = sharedMonthRange || bareDayRange ? [] : [...message.matchAll(datePattern)];
  const dateTokens = dateMatches.map((match) => match[0]);
  if (dateTokens.length > 2) return null;
  const withoutDateWords = message.replace(datePattern, '');
  if (/\b(thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|chu nhat|tuan)\b/.test(withoutDateWords)) return null;
  if (dateTokens.length > 1 && dateTokens.some((token) => /^(thu|chu nhat|cuoi tuan)/.test(token))) return null;
  const dates = sharedMonthRange ? [
    parseDateToken(`${sharedMonthRange[1]}/${sharedMonthRange[3]}${sharedMonthRange[4] ? `/${sharedMonthRange[4]}` : ''}`, today),
    parseDateToken(`${sharedMonthRange[2]}/${sharedMonthRange[3]}${sharedMonthRange[4] ? `/${sharedMonthRange[4]}` : ''}`, today),
  ] : bareDayRange ? dayOfMonthRange(bareDayRange[1], bareDayRange[2], today)
    : dateTokens.map((token) => parseDateToken(token, today));
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
  if (weekendRangeRequested && startDate && !dates[1]) endDate = addDays(startDate, 1);
  if (startDate && endDate < startDate) return null;
  const withoutDates = message
    .replace(sharedMonthRange?.[0] || /$^/, '')
    .replace(bareDayRange?.[0] || /$^/, '')
    .replace(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g, '');
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
  const durationMatch = timeSource.match(/\b(?:trong|suot|keo dai)\s*(\d+)\s*(ngay|tuan|gio|tieng|phut)(?:\s*(ruoi))?\b/)
    || timeSource.match(/\b(\d+)\s*(ngay|tuan|gio|tieng|phut)(?:\s*(ruoi))?\s+(?:tu(?:\s+luc)?|bat dau(?:\s+tu|\s+luc)?)\b/)
    || timeSource.match(/\b(?:dat|giu(?:\s+cho)?|do(?:\s+xe)?|de\s+xe)\s+(?:lien\s+tuc\s+)?(\d+)\s*(ngay|tuan|tieng)(?:\s*(ruoi))?\b/)
    || timeSource.match(/\b(\d+)\s*(tieng)(?:\s*(ruoi))?\b/);
  const durationUnitMinutes = durationMatch
    ? (durationMatch[2] === 'phut' ? 1 : durationMatch[2] === 'tuan' ? 7 * 24 * 60 : durationMatch[2] === 'ngay' ? 24 * 60 : 60)
    : 0;
  const durationMinutes = durationMatch
    ? Number(durationMatch[1]) * durationUnitMinutes + (durationMatch[3] ? durationUnitMinutes / 2 : 0)
    : 0;
  const times = extractTimes(durationMatch ? timeSource.replace(durationMatch[0], '') : timeSource);
  if (times.length > 2) return null;
  const periodSource = message.replace(/\bsang\s+(?:tang|floor|o|ngay)\b/g, '');
  const periods = new Set([...periodSource.matchAll(/\b(sang|chieu|toi|trua)\b/g)].map((match) => match[1]));
  if (periods.size === 1) times.forEach((time) => { if (!time.period) time.period = [...periods][0]; });
  // Bare hours follow 24-hour notation (8h = 08:00); the user hears the
  // interpreted time in the preview and must explicitly confirm it.
  const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
  if (parsedTimes.includes(null)) return null;
  if (times.length === 2 && parsedTimes[1] <= parsedTimes[0]
    && /\b(qua dem|lien tuc)\b/.test(message) && startDate && endDate === startDate) {
    endDate = addDays(endDate, 1);
  }

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
  const slotMatch = message.match(/\b(?:o do|o|bai(?: do)?|cho(?: do)?|vi tri|slot|parking (?:spot|space))\s*(?:so|ma)?\s*([a-z][-_.]?\d+(?:[-_.]\d+)?)\b/);
  const slotCode = contextualSlotCode || slotMatch?.[1].toUpperCase() || '';
  const mentionedPlate = /\b(bien so|bien|xe\s+[0-9]{2}[a-z0-9.-]+)\b/.test(message);
  const mentionedFloor = /\b(tang|floor)\b/.test(message);
  const mentionedSlot = /\b(o do|bai(?: do)?|cho do|vi tri|slot|parking (?:spot|space))\b/.test(message);

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
    if (changes.endTime <= changes.startTime && startDate === endDate) {
      clarification = 'Giờ ra cần sau giờ vào trong cùng ngày.';
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
      if (!Number.isFinite(durationMinutes) || durationMinutes < 30) {
        clarification = 'Thời lượng đặt chỗ phải tối thiểu 30 phút.';
        clearTimes = true;
      } else {
        const dayOffset = Math.floor(endMinute / (24 * 60));
        const minuteOfDay = endMinute % (24 * 60);
        const baseDate = changes.startDate || (continuing ? previous.startDate : '');
        changes.endDate = baseDate ? addDays(baseDate, dayOffset) : changes.endDate;
        changes.endTime = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
      }
    }
  } else if (durationMatch && continuing && /^\d{2}:\d{2}$/.test(previous.startTime || '')) {
    const [hour, minute] = previous.startTime.split(':').map(Number);
    const endMinute = hour * 60 + minute + durationMinutes;
    if (!Number.isFinite(durationMinutes) || durationMinutes < 30) {
      clarification = 'Thời lượng đặt chỗ phải tối thiểu 30 phút.';
      clearTimes = true;
    } else {
      const dayOffset = Math.floor(endMinute / (24 * 60));
      const minuteOfDay = endMinute % (24 * 60);
      changes.endDate = previous.startDate ? addDays(previous.startDate, dayOffset) : changes.endDate;
      changes.endTime = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
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
  const existingReservationItems = Array.isArray(previous.reservationItems)
    ? previous.reservationItems.slice(0, requestedVehicleCount) : [];
  const hasCompletePerVehicleSchedules = requestedVehicleCount > 1
    && existingReservationItems.length === requestedVehicleCount
    && existingReservationItems.every((item) => item?.startDate && item?.endDate
      && item?.startTime && item?.endTime);
  if (!clarification && requestedVehicleCount > 1 && !hasCompletePerVehicleSchedules
    && (!effectiveStartTime || !effectiveEndTime)) {
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

function mergeParsedBookings(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const changes = { ...(primary.changes || {}) };
  for (const [field, value] of Object.entries(secondary.changes || {})) {
    const empty = changes[field] === undefined || changes[field] === '' || changes[field] === 0
      || (Array.isArray(changes[field]) && changes[field].length === 0);
    if (empty && value !== '' && value !== 0) changes[field] = value;
  }
  const plates = [...new Set([
    ...(Array.isArray(primary.changes?.licensePlates) ? primary.changes.licensePlates : []),
    ...(Array.isArray(secondary.changes?.licensePlates) ? secondary.changes.licensePlates : []),
  ])];
  if (plates.length) {
    changes.licensePlates = plates;
    if (!changes.licensePlate) changes.licensePlate = plates[0];
  }
  return {
    ...secondary,
    ...primary,
    changes,
    clarification: primary.clarification || secondary.clarification || '',
    clearTimes: Boolean(primary.clearTimes || secondary.clearTimes),
    clearDates: Boolean(primary.clearDates || secondary.clearDates),
    clearVehicle: Boolean(primary.clearVehicle || secondary.clearVehicle),
  };
}

function parseBookingUtterance(prompt, today, previous = {}, currentTime = '', language) {
  const detected = language || detectBookingLanguage(prompt, previous.language).language;
  const englishSignals = /\b(?:book|reserve|parking|spot|space|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|arrive|leave|until|license plate|plate number|vehicle|car|hours?|am|pm)\b/i.test(prompt);
  if (detected === 'en') {
    return parseEnglishBookingUtterance(prompt, today, previous, currentTime, 'en')
      || parseVietnameseBookingUtterance(prompt, today, previous, currentTime);
  }
  const vietnamese = parseVietnameseBookingUtterance(prompt, today, previous, currentTime);
  if (!englishSignals) return vietnamese;
  const english = parseEnglishBookingUtterance(prompt, today, previous, currentTime, 'vi');
  return mergeParsedBookings(vietnamese, english);
}

module.exports = {
  parseBookingUtterance,
  parseEnglishBookingUtterance,
  parseVietnameseBookingUtterance,
  specialBookingRequest,
};

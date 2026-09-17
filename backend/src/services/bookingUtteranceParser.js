const simplify = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const manualOnlyPattern = /\b(hang ngay|moi ngay|lap lai|sac|vip|dich vu|gan|khu|zone|cong|loi ra|uu tien|co mai|ngoai troi)\b/;

function specialBookingRequest(prompt, previous = {}) {
  const message = simplify(prompt);
  if (/\bxe may\b/.test(message)) return 'VALO hiện chỉ hỗ trợ đặt chỗ cho ô tô.';
  const bookingCue = /\b(dat|giu cho|book|do xe|gui xe|mai|hom nay|ngay kia)\b/.test(message)
    || /\b\d{1,2}\s*(?:h|gio|:)/.test(message)
    || previous.__intent === 'CREATE_BOOKING';
  if (bookingCue && (manualOnlyPattern.test(message) || /\b(?:\d+|hai|ba)\s*(?:xe|cho|o do)\b/.test(message))) {
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

function parseDateToken(token, today) {
  if (/^(?:hom nay|nay|toi nay)$/.test(token)) return today;
  if (/^(?:ngay mai|mai)$/.test(token)) return addDays(today, 1);
  if (/^(?:ngay kia|ngay mot)$/.test(token)) return addDays(today, 2);
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
  const result = `${year}-${pad(month)}-${pad(day)}`;
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
  const compact = message.match(/\b(\d{1,2})\s*(?:-|den)\s*(\d{1,2})\s*(?:h|gio)\s*(sang|chieu|toi|trua)\b/);
  if (compact) return [
    { hour: compact[1], minute: '', period: compact[3] },
    { hour: compact[2], minute: '', period: compact[3] },
  ];
  return [...message.matchAll(/\b(\d{1,2})\s*(?:h|gio|:)\s*(\d{1,2}|ruoi)?\s*(?:phut|p)?\s*(sang|chieu|toi|trua)?\b/g)]
    .map((match) => ({ hour: match[1], minute: match[2], period: match[3] || '' }));
}

// Only common, explicit CREATE_BOOKING language is handled locally. Unknown constraints go to Gemini.
function parseBookingUtterance(prompt, today, previous = {}) {
  if (!validDate(today)) return null;
  const words = { 'muoi mot': 11, 'muoi hai': 12, mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10 };
  const message = simplify(String(prompt || '').replace(/\btôi\b/giu, 'nguoi_dung').replace(/\btới\b/giu, 'đến').replace(/\bmốt\b/giu, 'ngày mốt'))
    .replace(/\btoi\s+(?=muon|xin|can|se|dat|co)\b/g, 'nguoi_dung ')
    .replace(/(\d{1,2}\s*(?:h|gio|:\d{2})?)\s+toi\s+(?=\d{1,2})/g, '$1 den ')
    .replace(/\b(muoi mot|muoi hai|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s+gio\b/g,
      (match, word) => `${words[word]} gio`)
    .replace(/\b(\d{1,2})\s+ruoi\s+(sang|chieu|toi|trua)\b/g, '$1 gio ruoi $2');
  const continuing = previous.__intent === 'CREATE_BOOKING';
  const periodAnswer = message.match(/^(?:buoi\s+)?(sang|chieu|toi|trua)$/);
  if (continuing && periodAnswer && previous.pendingStartTime) {
    const convert = (value) => {
      if (!/^\d{2}:\d{2}$/.test(value || '')) return '';
      const [hour, minute] = value.split(':');
      return parseHour(hour, minute, periodAnswer[1]) || '';
    };
    const startTime = convert(previous.pendingStartTime);
    const endTime = previous.pendingEndTime ? convert(previous.pendingEndTime) : '';
    if (!startTime || (previous.pendingEndTime && !endTime)) return null;
    return { changes: { startTime, endTime }, clearPending: true, clarification: '' };
  }
  if (/\b(huy|huy bo|xem|kiem tra|con cho|con trong|co cho khong|co o trong|gia bao nhieu|bao gia)\b/.test(message)) return null;
  if (/\b(khong|dung|thoi)\s+(?:muon\s+)?(?:dat|giu cho|book)\b/.test(message)) return null;
  if (/\b(sua|doi|gia han)\s*(?:booking|dat cho|lich dat)\b/.test(message)) return null;
  const createCue = /\b(dat|giu cho|book|do xe|gui xe)\b/.test(message);
  if (!createCue && previous.__intent && !['UNKNOWN', 'CREATE_BOOKING'].includes(previous.__intent)) return null;
  if (/\b(thang|cuoi tuan|xe may|toi da|toi thieu)\b/.test(message) || manualOnlyPattern.test(message)) return null;
  if (/\b\d+\s*(?:xe|cho|o do)\b/.test(message)) return null;

  const datePattern = /\b(?:hom nay|toi nay|ngay mai|ngay kia|ngay mot|thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)(?:\s+tuan\s+(?:sau|nay))?|chu nhat(?:\s+tuan\s+(?:sau|nay))?|mai|nay|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g;
  const dateMatches = [...message.matchAll(datePattern)];
  const dateTokens = dateMatches.map((match) => match[0]);
  if (dateTokens.length > 2) return null;
  const withoutDateWords = message.replace(datePattern, '');
  if (/\b(thu\s*(?:2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)|chu nhat|tuan)\b/.test(withoutDateWords)) return null;
  if (dateTokens.length > 1 && dateTokens.some((token) => /^(thu|chu nhat)/.test(token))) return null;
  const dates = dateTokens.map((token) => parseDateToken(token, today));
  if (dates.some((date) => !date)) return null;
  const startDate = dates[0] || '';
  const endDate = dates[1] || startDate;
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
  const durationMatch = withoutDates.match(/\b(?:trong|suot)\s*(\d{1,3})\s*(gio|tieng|phut)(?:\s*(ruoi))?\b/);
  const durationMinutes = durationMatch
    ? Number(durationMatch[1]) * (durationMatch[2] === 'phut' ? 1 : 60) + (durationMatch[3] ? 30 : 0)
    : 0;
  const times = extractTimes(durationMatch ? withoutDates.replace(durationMatch[0], '') : withoutDates);
  if (times.length > 2) return null;
  if (times.length === 2 && Number(times[0].hour) >= 13 && Number(times[1].hour) <= 12 && !times[1].period) {
    return { changes: { startDate, endDate, startTime: '', endTime: '' }, clearTimes: true, clarification: crossDateClarification };
  }
  const periodSource = message.replace(/\bsang\s+(?:tang|floor|o|ngay)\b/g, '');
  const periods = new Set([...periodSource.matchAll(/\b(sang|chieu|toi|trua)\b/g)].map((match) => match[1]));
  if (periods.size === 1) times.forEach((time) => { if (!time.period) time.period = [...periods][0]; });
  const ambiguous = times.some(({ hour, period }) => !period && Number(hour) > 0 && Number(hour) <= 12);
  const parsedTimes = times.map(({ hour, minute, period }) => parseHour(hour, minute, period));
  if (parsedTimes.includes(null)) return null;

  const plateMatch = message.match(/\b(?:bien so|bien|xe)\s*(?:la|:)?\s*([0-9]{2}[a-z]{1,2}\d?[\s.-]?[0-9]{3}[\s.-]?[0-9]{2,3})\b/);
  const licensePlate = plateMatch?.[1].replace(/[^a-z0-9]/g, '').toUpperCase() || '';
  const vehicleType = /\b(xe dien|oto dien|o to dien)\b/.test(message) ? 'electric_car'
    : /\b(xe xang|xe thuong|oto thuong|o to thuong)\b/.test(message) ? 'car' : '';
  const floorMatch = message.match(/\b(?:tang|floor)\s*([a-z]?\d+)\b/);
  const floorName = floorMatch ? `tầng ${floorMatch[1].toUpperCase()}` : '';
  const slotMatch = message.match(/\b(?:o do|o|slot)\s*(?:so|ma)?\s*([a-z][-_.]?\d+(?:[-_.]\d+)?)\b/);
  const slotCode = slotMatch?.[1].toUpperCase() || '';
  const mentionedPlate = /\b(bien so|bien|xe\s+[0-9]{2}[a-z0-9.-]+)\b/.test(message);
  const mentionedFloor = /\b(tang|floor)\b/.test(message);
  const mentionedSlot = /\b(o do|slot)\b/.test(message);

  if (!startDate && !times.length && !durationMatch && !licensePlate && !vehicleType && !floorName && !slotCode && !createCue) return null;
  const changes = { startDate, endDate, licensePlate, vehicleType, floorName, slotCode, startTime: '', endTime: '' };
  let clarification = '';
  let clearTimes = false;
  let pendingTimes = null;
  if (ambiguous) {
    clarification = 'Bạn muốn đỗ vào giờ sáng hay tối? Vui lòng ghi rõ theo 24 giờ, ví dụ 07:00–08:00 hoặc 19:00–20:00.';
    clearTimes = true;
    pendingTimes = { start: parsedTimes[0] || '', end: parsedTimes[1] || '' };
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
  if (mentionedPlate && !licensePlate) clarification = 'Bạn vui lòng gửi lại biển số đầy đủ, ví dụ 43A-123.45.';
  if (mentionedFloor && !floorName) clarification = 'Bạn muốn tầng nào? Hãy ghi rõ số hoặc tên tầng.';
  if (mentionedSlot && !slotCode) clarification = 'Bạn muốn ô đỗ nào? Hãy ghi rõ mã ô, ví dụ A-015.';
  if (!clarification && previous.pendingStartTime && !times.length) {
    clarification = 'Bạn muốn đỗ vào giờ sáng hay tối? Chỉ cần trả lời “sáng” hoặc “tối”.';
  }
  return { changes, clarification, clearTimes, pendingTimes, clearPending: times.length > 0 && !ambiguous };
}

module.exports = { parseBookingUtterance, specialBookingRequest };

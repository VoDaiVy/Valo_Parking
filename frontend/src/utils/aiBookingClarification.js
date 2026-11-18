const fold = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();

export function bookingClarification(prompt, draft = {}, language = 'vi') {
  const text = fold(prompt);
  const en = language === 'en';
  const guidance = /\b(?:nhap lai o dau|nhap o dau|noi lai phan nao|thieu gi|chua ro cho nao|where.*(?:type|enter)|which part|what is missing)\b/.test(text);
  const rowIndex = Number(draft.pendingReservationEditIndex);
  const row = Number.isInteger(rowIndex) && rowIndex >= 0 && draft.reservationItems?.[rowIndex];
  const pending = draft.pendingReservationEditField;
  let field = '';
  if (draft.pendingLicensePlate || /\b(?:bien so|license plate|plate number)\b/.test(text) || pending === 'biển số') field = 'licensePlate';
  else if (draft.__awaitingField) field = draft.__awaitingField;
  else if (['startDate', 'endDate', 'startTime', 'endTime', 'slotCode', 'floorName'].includes(pending)) field = pending;
  if (!field && guidance && draft.__intent === 'CREATE_BOOKING') {
    const source = row ? { ...draft, ...row } : draft;
    field = ['startDate', 'endDate', 'startTime', 'endTime'].find((key) => !source[key]) || '';
    const plates = new Set([draft.licensePlate, ...(draft.licensePlates || []), ...(draft.reservationItems || []).map((item) => item.licensePlate)].filter(Boolean));
    if (!field && Number(draft.requestedVehicleCount || 1) > plates.size) field = 'licensePlate';
  }
  const labels = {
    licensePlate: ['biển số', 'license plate'], startDate: ['ngày vào', 'arrival date'], endDate: ['ngày ra', 'departure date'],
    startTime: ['giờ vào', 'arrival time'], endTime: ['giờ ra', 'departure time'],
    slotCode: ['mã ô đỗ', 'parking space code'], floorName: ['tầng đỗ', 'parking floor'],
  };
  const examples = { licensePlate: '43A12345', startDate: '20/11/2026', endDate: '21/11/2026', startTime: '08:00', endTime: '09:00', slotCode: 'A1', floorName: '1' };
  const location = guidance ? (en ? ' Type in the message box at the bottom of this chat, or press the microphone to speak.'
    : ' Bạn nhập vào ô tin nhắn ở dưới khung chat này hoặc bấm micro để nói.') : '';
  if (labels[field]) {
    const label = labels[field][en ? 1 : 0];
    const vehicle = row ? (en ? ` for vehicle ${rowIndex + 1}` : ` của xe ${rowIndex + 1}`) : '';
    const value = draft.pendingLicensePlate ? ` “${draft.pendingLicensePlate}”` : '';
    return en ? `I could not understand the ${label}${vehicle}${value}. Please say or enter this part again more clearly, for example ${examples[field]}. I am keeping the other details.${location}`
      : `Mình chưa hiểu rõ ${label}${vehicle}${value}. Bạn chỉ cần nói hoặc nhập lại phần này, ví dụ ${examples[field]}; mình vẫn giữ các thông tin khác.${location}`;
  }
  return en ? `I could not understand which action you want. Please say or enter it again more clearly: book a space, change booking details, or ask a question?${location}`
    : `Mình chưa hiểu bạn muốn thực hiện việc gì. Bạn hãy nói hoặc nhập lại rõ hơn: đặt chỗ, thay đổi thông tin đặt chỗ hay tra cứu thông tin?${location}`;
}


const fold = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();

export const isBookingContextRecall = (text) => /^(?:(?:lam|tiep tuc|giu nguyen|xem lai|nhac lai)\s+)?(?:yeu cau|thong tin|booking|dat cho)(?:\s+(?:o tren|ben tren|truoc do|luc nay|vua roi|cu))$|^(?:nhu tren|nhu da noi|toi da noi roi|continue previous request|same as above|as i said|my previous request|what did i request)$/u.test(fold(text));
export const isSlotSuggestionAcceptance = (text) => /^(?:(?:ok|oke|okay|dong y|duoc|yes)\s+)?(?:doi|chuyen|chon|lay|dung)(?:\s+(?:sang|cac|nhung|o|goi y|de xuat|do|nay|di|luon))*$|^(?:ok\s+)?(?:change|switch|use|take)(?:\s+(?:it|them|those|the|suggested|slots|spaces|please))*$/u.test(fold(text));
export const bookingSlotSuggestions = (draft = {}) => Array.isArray(draft.pendingSlotSuggestions)
  ? draft.pendingSlotSuggestions : draft.pendingSlotSuggestion ? [draft.pendingSlotSuggestion] : [];

export const isInformationalAssistantTurn = (intent) => /^(?:CHECK_|GET_|VIEW_|LIST_)/.test(intent)
  || ['HELP', 'UNKNOWN'].includes(intent);

export function bookingHistoryBeforeTurn(messages, turnId) {
  const index = messages.findIndex((message) => message.id === turnId);
  return (index >= 0 ? messages.slice(0, index) : []).filter((message) => !message.pending
    && ['user', 'assistant'].includes(message.role))
    .slice(-20).map((message) => ({ role: message.role, text: String(message.text || message.content || '').slice(0, 1200) }));
}

export function bookingContextSummary(draft = {}, language = 'vi') {
  const en = language === 'en';
  const plates = draft.licensePlates?.length ? draft.licensePlates : draft.licensePlate ? [draft.licensePlate] : [];
  const count = Math.max(plates.length, draft.reservationItems?.length || 0, 1);
  const rows = Array.from({ length: count }, (_, index) => {
    const row = { ...draft, licensePlate: plates[index] || '', ...(draft.reservationItems?.[index] || {}) };
    return [row.licensePlate, row.startDate, row.startTime, (row.endDate || row.endTime) ? `${en ? 'until' : 'đến'} ${row.endDate || row.startDate || ''} ${row.endTime || ''}`.trim() : '',
      row.floorName, row.slotCode, row.serviceNames?.length ? `${en ? 'Services' : 'Dịch vụ'}: ${row.serviceNames.join(', ')}` : '', row.voucherName].filter(Boolean).join(' · ');
  }).filter(Boolean);
  const suggestions = bookingSlotSuggestions(draft);
  const pending = draft.assistantContext?.pendingServiceSelection;
  return [en ? 'I am keeping your current request:' : 'Mình vẫn giữ yêu cầu hiện tại của bạn:', ...rows,
    suggestions.length ? `${en ? 'Suggested spaces' : 'Các ô gợi ý'}: ${suggestions.map((item) => [item.licensePlate, item.floorName, item.slotCode].filter(Boolean).join(' · ')).join('; ')}. ${en ? 'Would you like to switch to these spaces?' : 'Bạn có muốn đổi sang các ô này không?'}` : '',
    pending?.serviceNames?.length ? `${en ? 'Still waiting for you to choose the vehicle for' : 'Mình đang chờ bạn chọn xe cho dịch vụ'} ${pending.serviceNames.join(', ')}.` : '',
    en ? 'No booking has been confirmed by this reminder.' : 'Việc nhắc lại này chưa xác nhận đặt chỗ.',
  ].filter(Boolean).join('\n');
}

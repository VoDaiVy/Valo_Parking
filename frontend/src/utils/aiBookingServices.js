const normalize = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

export function activeAiBookingServices(catalog = []) {
  const seen = new Set();
  return (Array.isArray(catalog) ? catalog : []).filter(service => {
    const id = String(service?._id || '');
    if (!id || !String(service.name || '').trim() || service.isActive === false
      || service.price == null || !Number.isFinite(Number(service.price)) || Number(service.price) < 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function hasAiBookingServices(preview, draft = {}) {
  return [draft, ...(Array.isArray(draft.reservationItems) ? draft.reservationItems : []), ...(preview?.items || [])]
    .some(item => item?.serviceIds?.length || item?.serviceNames?.length);
}

export function createAiBookingServiceOffer(preview, draft = {}, catalog, previewKey, { pendingVoucher = false } = {}) {
  if (!preview?.items?.length || !previewKey || pendingVoucher || hasAiBookingServices(preview, draft)) return null;
  const previous = draft.assistantContext?.serviceOffer;
  if (['declined', 'done'].includes(previous?.status)) return null;
  const available = activeAiBookingServices(catalog);
  if (!available.length) return null;
  return {
    status: previous?.status === 'selecting' ? 'selecting' : 'offered',
    previewKey,
    serviceIds: available.map(service => String(service._id)),
  };
}

export function isAiBookingServiceOfferCurrent(offer, preview, previewKey) {
  return Boolean(preview?.items?.length && previewKey && offer?.previewKey === previewKey
    && ['offered', 'selecting'].includes(offer.status) && offer.serviceIds?.length);
}

export function withAiBookingServiceOffer(draft, offer) {
  return { ...draft, assistantContext: { ...(draft.assistantContext || {}), serviceOffer: offer } };
}

export function routeAiBookingServiceOfferReply(message) {
  const text = normalize(message).replace(/^(?:da|vang)\s+/, '').replace(/\s+(?:nhe|nha|please)$/, '');
  if (/^(?:co|co them|co dung|co muon|co them dich vu|co dung dich vu|dong y|ok|oke|okay|duoc|yes|yes please|sure|show me|show services|them dich vu|dung dich vu|toi muon dung them dich vu)$/.test(text)) return 'accept';
  if (/^(?:khong|khong can|khong muon|khong them|khong dung|khong can them|khong them dich vu(?: nua)?|khong dung dich vu|khong can dich vu|khong can them dich vu|khong muon them dich vu|bo qua|bo qua dich vu|thoi|no|no thanks|skip|skip services|no services|no extra services|without services)$/.test(text)) return 'decline';
  // A booking confirmation, cancellation, edit or named service must keep its
  // own route. Consent to see services never applies a service or books a slot.
  return 'other';
}

export function resolveAiBookingServiceNameReply(message, offer, catalog) {
  if (!['offered', 'selecting'].includes(offer?.status)) return null;
  const matches = activeAiBookingServices(catalog).filter(service => offer.serviceIds?.includes(String(service._id))
    && normalize(service.name) === normalize(message));
  return matches.length === 1 ? matches[0] : null;
}

export function aiBookingServiceOfferMessage(language = 'vi', { selecting = false } = {}) {
  if (selecting) return language === 'en'
    ? 'Which service would you like? Choose below or say its name. For multiple vehicles, I will ask which vehicle should receive it. Nothing is added until you choose.'
    : 'Bạn muốn dùng dịch vụ nào? Hãy chọn bên dưới hoặc nói tên dịch vụ. Nếu có nhiều xe, mình sẽ hỏi dịch vụ dành cho xe nào. Chưa có dịch vụ nào được tự động thêm.';
  return language === 'en'
    ? 'Would you like to add any VALO vehicle-care services? Say “yes” to choose a service, or “no services” to continue without one. Services are optional; nothing is added automatically.'
    : 'Bạn có muốn dùng thêm dịch vụ chăm sóc xe của VALO không? Nói “có” để chọn dịch vụ hoặc “không thêm dịch vụ” để bỏ qua. Dịch vụ là tùy chọn; mình chưa tự động thêm dịch vụ nào.';
}

function calculateEarlyBookingPromotion({
  basePrice,
  priceType,
  leadTimeHours,
  durationMinutes,
  promotionConfig = {},
}) {
  const normalizedBasePrice = Math.max(0, Number(basePrice) || 0);
  const minimumLeadHours = Number(promotionConfig.minimumLeadHours || 72);
  const applies = priceType === 'hourly'
    && promotionConfig.isEnabled === true
    && Number.isFinite(leadTimeHours)
    && leadTimeHours >= minimumLeadHours
    && (!Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) >= 60);

  if (!applies) {
    return { multiplier: 1, adjustedPrice: normalizedBasePrice, promotion: null };
  }

  const discountPercent = Math.max(0, Math.min(30, Number(promotionConfig.discountPercent) || 0));
  const multiplier = Number((1 - discountPercent / 100).toFixed(4));
  return {
    multiplier,
    adjustedPrice: Math.ceil((normalizedBasePrice * multiplier) / 1000) * 1000,
    promotion: {
      type: 'EARLY_BOOKING_DISCOUNT',
      label: 'Early Booking Discount',
      discountPercent,
      minimumLeadHours,
    },
  };
}

module.exports = { calculateEarlyBookingPromotion };

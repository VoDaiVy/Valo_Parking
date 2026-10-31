export function activityStatus(item) {
  if (item.kind === 'notification') {
    if (item.isRead === true || item.status === 'read') return { label: 'Read', tone: 'info' };
    // Notification activities are sourced from persisted inbox deliveries.
    return { label: 'Sent', tone: 'warning' };
  }
  return {
    paid: { label: 'Paid', tone: 'success' },
    failed: { label: 'Failed', tone: 'failed' },
    pending: { label: 'Pending', tone: 'warning' },
    success: { label: 'Success', tone: 'success' },
    completed: { label: 'Success', tone: 'success' },
    cancelled: { label: 'Cancelled', tone: 'info' },
  }[item.status] || { label: 'Recorded', tone: 'info' };
}

export function activityPayment(item) {
  if (!['renewal', 'purchase', 'payment'].includes(item.kind)) return {};
  return {
    method: { wallet: 'VALO Wallet', payos: 'PayOS' }[item.paymentMethod],
    amount: Number.isFinite(item.amount) ? `${item.amount.toLocaleString('en-GB')} VND` : undefined,
  };
}

export function activityExpiries(item) {
  const validDate = (value) => value && !Number.isNaN(new Date(value).getTime());
  if (item.kind === 'renewal' && item.status === 'paid') {
    return [
      { label: 'Previous expiry', value: item.oldExpireAt, renewed: false },
      { label: 'New expiry', value: item.newExpireAt, renewed: true },
    ].filter((field) => validDate(field.value));
  }
  if (item.kind === 'notification' && validDate(item.expireAt)) {
    return [{ label: 'Expiry', value: item.expireAt, renewed: false }];
  }
  return [];
}

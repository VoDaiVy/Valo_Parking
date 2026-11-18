// Translate recognized system events only; leave user-authored messages intact.
export function notificationPresentation(message, t) {
  const titles = {
    'Service requested': 'requested',
    'Service started': 'started',
    'Service completed': 'completed',
    'Service cancelled': 'cancelled',
    'Membership service requested': 'membershipRequested',
    'Membership service updated': 'membershipUpdated',
  };
  const key = titles[message?.title];
  if (!key || !['MEMBERSHIP_SERVICE_STATUS_CHANGED', 'MEMBERSHIP_SERVICE_REQUESTED'].includes(message.metadata?.eventType)) {
    return { title: message?.title, content: message?.content };
  }
  let content = message.content || '';
  const usage = {
    '1 included use has been reserved.': 'reserved',
    '1 included use has been applied.': 'applied',
    '1 included use has been returned to its original service period.': 'returned',
    'No additional included use has been deducted.': 'noExtra',
  };
  const services = {
    'Car Wash & Interior Vacuuming': 'wash',
    'Glass Water Spot Removal & Coating': 'glass',
    'Paint Polishing & Scratch Removal': 'polish',
  };
  for (const [name, service] of Object.entries(services)) {
    if (content.startsWith(name + ' · ')) content = t('notificationUi.services.' + service) + content.slice(name.length);
  }
  content = content.replace(/ · Space ([^.:]+)([.:])/, (_, slot, punctuation) => ' · ' + t('notificationUi.space', { slot }) + punctuation);
  for (const [text, usageKey] of Object.entries(usage)) content = content.replace(text, t('notificationUi.usage.' + usageKey));
  content = content.replace(/: (pending|in_progress|done|cancelled)$/, (_, status) => ': ' + t('notificationUi.serviceStatus.' + status));
  content = content.replace(' Reason: ', ' ' + t('notificationUi.reason') + ' ');
  return { title: t('notificationUi.events.' + key), content };
}

export function notificationLabel(group, value, t) {
  return t('notificationUi.' + group + '.' + value, { defaultValue: value });
}

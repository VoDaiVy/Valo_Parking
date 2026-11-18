const catalog = {
  'paint polishing & scratch removal': 'paintPolishing',
  'glass water spot removal & coating': 'glassCoating',
  'car wash & interior vacuuming': 'carWash',
  'tire balancing & rotation': 'tireCare',
  'oil & filter change': 'oilChange',
  'a/c system cleaning & odor removal': 'airConditioning',
  'engine bay detailing': 'engineDetailing',
};

export function serviceName(service, t) {
  const key = catalog[service?.name?.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ and /g, ' & ')];
  return key ? t('servicesPage.catalog.' + key + '.name', { defaultValue: service.name }) : service?.name || '';
}

export function serviceDescription(service, t) {
  const key = catalog[service?.name?.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ and /g, ' & ')];
  if (!key) return service?.description || '';
  const translationKey = 'servicesPage.catalog.' + key + '.description';
  // Only substitute descriptions matching the built-in English catalog.
  const original = t(translationKey, { lng: 'en', defaultValue: '' });
  return original && service.description?.trim() === original.trim()
    ? t(translationKey)
    : service?.description || '';
}

export const normalizeLicensePlate = (plate = '') =>
  String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

export const formatLicensePlateDisplay = (plate = '') => {
  const clean = normalizeLicensePlate(plate);
  if (!clean) return '';

  if (/^\d{2}[A-Z]\d{5}$/.test(clean)) {
    return `${clean.slice(0, 2)}${clean.slice(2, 3)}-${clean.slice(3, 6)}.${clean.slice(6)}`;
  }

  if (/^\d{2}[A-Z]\d{4}$/.test(clean)) {
    return `${clean.slice(0, 2)}${clean.slice(2, 3)}-${clean.slice(3)}`;
  }

  if (/^\d{2}[A-Z]{2}\d{4}$/.test(clean)) {
    return `${clean.slice(0, 2)}${clean.slice(2, 4)}-${clean.slice(4, 6)}.${clean.slice(6)}`;
  }

  if (/^\d{2}[A-Z]{2}\d{5}$/.test(clean)) {
    return `${clean.slice(0, 2)}${clean.slice(2, 4)}-${clean.slice(4, 7)}.${clean.slice(7)}`;
  }

  if (/^\d{2}[A-Z]{1}\d{6}$/.test(clean)) {
    return `${clean.slice(0, 2)}${clean.slice(2, 3)}-${clean.slice(3, 6)}.${clean.slice(6)}`;
  }

  return clean;
};

export const isValidLicensePlate = (plate = '') => {
  const clean = normalizeLicensePlate(plate);
  return /^[1-9]\d[A-Z]{1,2}\d{4,5}$/.test(clean);
};

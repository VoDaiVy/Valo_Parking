const normalizeLicensePlate = (plate = '') =>
  String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

// VALO currently serves cars only. Motorcycle series such as 81A1-234.56
// compact to one letter followed by six digits and must not enter car booking.
const isValidCarLicensePlate = (plate = '') =>
  /^[1-9]\d[A-Z]{1,2}\d{4,5}$/.test(normalizeLicensePlate(plate));

const formatLicensePlateDisplay = (plate = '') => {
  const clean = normalizeLicensePlate(plate);
  if (!clean) return '';

  let province;
  let series;
  let numbers;

  if (clean.length === 9) {
    if (/^\d{2}[A-Z]\d\d{5}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 4);
      numbers = clean.slice(4);
    } else if (/^\d{2}[A-Z]{2}\d{5}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 4);
      numbers = clean.slice(4);
    }
  } else if (clean.length === 8) {
    if (/^\d{2}[A-Z]\d{5}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 3);
      numbers = clean.slice(3);
    } else if (/^\d{2}[A-Z]\d\d{4}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 4);
      numbers = clean.slice(4);
    } else if (/^\d{2}[A-Z]{2}\d{4}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 4);
      numbers = clean.slice(4);
    }
  } else if (clean.length === 7) {
    if (/^\d{2}[A-Z]\d{4}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 3);
      numbers = clean.slice(3);
    }
  }

  if (province && series && numbers) {
    let formattedNumbers = numbers;
    if (numbers.length === 5) {
      formattedNumbers = `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
    }
    const isMotorbike = /\d/.test(series);
    return isMotorbike
      ? `${province}-${series} ${formattedNumbers}`
      : `${province}${series} - ${formattedNumbers}`;
  }

  return clean;
};

module.exports = {
  normalizeLicensePlate,
  formatLicensePlateDisplay,
  isValidCarLicensePlate,
};

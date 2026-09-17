const normalizeLicensePlate = (plate = '') =>
  String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

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

const levenshteinDistance = (a = '', b = '') => {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
};

const arePlatesMatching = (plateA = '', plateB = '') => {
  const cleanA = normalizeLicensePlate(plateA);
  const cleanB = normalizeLicensePlate(plateB);
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  if (cleanA.length >= 6 && cleanB.length >= 6 && Math.abs(cleanA.length - cleanB.length) <= 1) {
    return levenshteinDistance(cleanA, cleanB) <= 1;
  }
  return false;
};

module.exports = {
  normalizeLicensePlate,
  formatLicensePlateDisplay,
  levenshteinDistance,
  arePlatesMatching,
};


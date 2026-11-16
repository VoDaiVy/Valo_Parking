// Keep booking input formatting consistent with the web booking flow.
const formatVietnamesePlate = (plate: string): string | null => {
  if (!plate) return null;
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let province, series, numbers;
  if (clean.length === 9) {
    if (/^\d{2}[A-Z]\d\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
    else if (/^\d{2}[A-Z]{2}\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
  } else if (clean.length === 8) {
    if (/^\d{2}[A-Z]\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 3); numbers = clean.slice(3); }
    else if (/^\d{2}[A-Z]\d\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
    else if (/^\d{2}[A-Z]{2}\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
  } else if (clean.length === 7) {
    if (/^\d{2}[A-Z]\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 3); numbers = clean.slice(3); }
  }
  if (province && series && numbers) {
    let formattedNumbers = numbers;
    if (numbers.length === 5) { formattedNumbers = `${numbers.slice(0, 3)}.${numbers.slice(3)}`; }
    const isMotorbike = /\d/.test(series);
    if (isMotorbike) return `${province}-${series} ${formattedNumbers}`;
    else return `${province}${series} - ${formattedNumbers}`;
  }
  return null;
};

export function formatLicensePlateInput(value: string): string {
    const raw = value.toUpperCase();
    const clean = raw.replace(/[^A-Z0-9]/g, '');
    let formatted = formatVietnamesePlate(clean);
    
    if (!formatted) {
       if (clean.length >= 3) {
          const seriesMatch = clean.substring(2).match(/^[A-Z][A-Z0-9]?/);
          if (seriesMatch) {
             const series = seriesMatch[0];
             const numbers = clean.substring(2 + series.length);
             if (numbers.length > 0) {
               formatted = `${clean.substring(0, 2)}${series}-${numbers}`;
               if (numbers.length > 3) {
                 formatted = `${clean.substring(0, 2)}${series}-${numbers.substring(0,3)}.${numbers.substring(3)}`;
               }
             } else {
               formatted = clean;
             }
          } else {
             formatted = clean;
          }
       } else {
          formatted = clean;
       }
    }
    return formatted || '';
}

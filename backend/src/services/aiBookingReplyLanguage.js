const vietnameseMarker = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu;

const replacements = [
  [/Mình đã ghi ([A-Z0-9]+)\. Hãy đọc 2 số đầu của biển số\.?/gi,
    'I recorded $1. Please provide the first two digits of the plate.'],
  [/Mình đã ghi ([A-Z0-9]+)\. Hãy đọc chữ cái và dãy số cuối\.?/gi,
    'I recorded $1. Please provide the letters and final digits.'],
  [/Mình đã ghi ([A-Z0-9]+)\. Hãy đọc tiếp phần còn lại của biển số\.?/gi,
    'I recorded $1. Please provide the rest of the license plate.'],
  [/Biển số chưa hợp lệ\.[^.!?]*(?:\.[^.!?]*)*/gi,
    'The license plate is invalid. Please provide the full car plate, for example 43A12345.'],
  [/Bạn muốn đổi giờ vào và giờ ra thành mấy giờ\?/gi,
    'What arrival and departure times would you like instead?'],
  [/Bạn muốn đổi sang ngày nào\?/gi, 'What date would you like instead?'],
  [/Biển số đúng là gì\?/gi, 'What is the correct license plate?'],
  [/Bạn muốn ngày đó trong tháng nào\?/gi, 'Which month do you mean?'],
  [/Bạn muốn chính xác mấy giờ\?/gi, 'What exact time would you like to use?'],
  [/Giờ ra cần sau giờ vào(?: trong cùng ngày)?\.[^.!?]*/gi,
    'The departure time must be after the arrival time. What times would you like?'],
  [/Bạn đọc lại đầy đủ biển số giúp mình nhé\.?/gi, 'Could you confirm the full license plate?'],
  [/Bạn muốn đặt (\d+) xe\.[^.!?]*/gi,
    'You are booking for $1 vehicles. Please provide every license plate.'],
  [/Bạn muốn đặt bao nhiêu xe\?[^.!?]*/gi,
    'How many vehicles would you like to book? Please provide every license plate.'],
  [/Bạn muốn đỗ từ mấy giờ đến mấy giờ[^?]*\?/gi,
    'What arrival and departure times would you like?'],
  [/Bạn muốn đỗ vào giờ sáng hay tối\?[^.!?]*/gi,
    'Would you like the morning or evening time?'],
  [/Bạn muốn tầng nào\?[^.!?]*/gi, 'Which floor would you like? Please provide its number or name.'],
  [/Bạn muốn ô đỗ nào\?[^.!?]*/gi, 'Which parking slot would you like? Please provide a code such as A-015.'],
  [/Xe (\d+) đỗ ngày nào\?/gi, 'What date should vehicle $1 be parked?'],
  [/Xe (\d+) đỗ từ mấy giờ đến mấy giờ\?/gi, 'What arrival and departure times should vehicle $1 use?'],
  [/Ngày ([0-9/]+) đã qua\.[^.!?]*/gi, 'Date $1 has already passed. Please choose today or a future date.'],
  [/Giờ ([0-9:]+) hôm nay đã qua\.[^.!?]*/gi, 'Time $1 today has already passed. Please choose a later start time.'],
  [/Thời lượng đặt chỗ phải tối thiểu 30 phút\.?/gi,
    'The booking duration must be at least 30 minutes.'],
  [/Khoảng giờ vào\/ra và thời lượng[^.!?]*\.[^.!?]*/gi,
    'The stated time range and duration do not match. Please confirm the arrival and departure times.'],
  [/VALO chỉ hỗ trợ một khoảng giữ chỗ liên tục\.[^.!?]*/gi,
    'VALO supports one continuous booking interval. Please provide its start and end.'],
];

function toEnglishBookingMessage(value, fallback = 'I need more booking information. Please review the details and try again.') {
  let text = String(value || '').trim();
  if (!text) return '';
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return vietnameseMarker.test(text) ? fallback : text;
}

module.exports = { toEnglishBookingMessage, vietnameseMarker };

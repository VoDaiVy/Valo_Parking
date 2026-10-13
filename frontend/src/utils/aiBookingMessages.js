const englishMarker = /\b(?:the|this|that|what|which|would|could|like|vehicle|booking|parking|slot|space|time|date|arrival|departure|invalid|not|found|cannot|only|please|failed|error|hold|payment|wallet|start|end|already|another|during|selected|current|maximum|permission|release|available|overlapping|too|late|cancel|confirm|restriction|network|gateway|unexpected|recorded|digits|floor|more|information|review|again|is|are|was|were|be|been|has|have|your|you|new|status|successfully|cancellable|modified|occupied|insufficient|balance|provide|license|plate|changed|while|updated|retry|service|request)\b/i;
const vietnameseMarker = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu;

const vietnameseToEnglish = (value) => {
  let text = String(value || '').trim();
  const translations = [
    [/Vui lòng cấp quyền micro cho trang web\.?/gi, 'Please allow microphone access for this website.'],
    [/Không tìm thấy micro\.[^.!?]*/gi, 'No microphone was found. Please check your device.'],
    [/Trình duyệt không hỗ trợ nhận giọng nói tiếng Việt\.[^.!?]*/gi,
      'Your browser does not support the selected speech-recognition language. Please type your request.'],
    [/Micro tạm gián đoạn\.[^.!?]*/gi, 'The microphone was interrupted. The assistant will listen again.'],
    [/Không thể mở micro\.[^.!?]*/gi, 'Unable to start the microphone. Please try again or type your request.'],
    [/Mình đã ghi ([A-Z0-9]+)\. Hãy đọc 2 số đầu của biển số\.?/gi,
      'I recorded $1. Please provide the first two digits of the plate.'],
    [/Mình đã ghi ([A-Z0-9]+)\. Hãy đọc chữ cái và dãy số cuối\.?/gi,
      'I recorded $1. Please provide the letters and final digits.'],
    [/Mình đã ghi ([A-Z0-9]+)\. Hãy đọc tiếp phần còn lại của biển số\.?/gi,
      'I recorded $1. Please provide the rest of the license plate.'],
    [/Mình đã nhận (\d+)\/(\d+) biển số\.[^.!?]*/gi,
      'I have received $1 of $2 license plates. Please provide the next plate.'],
    [/Biển số chưa hợp lệ\.[^.!?]*(?:\.[^.!?]*)*/gi,
      'The license plate is invalid. Please provide the full car plate, for example 43A12345.'],
    [/Đã hủy bản xem trước\.[^.!?]*/gi, 'The booking preview has been canceled. No booking was created.'],
    [/Đã dừng yêu cầu đặt chỗ này\.[^.!?]*/gi, 'This booking request has been stopped. You can start a new request when ready.'],
    [/Chưa có bản xem trước để xác nhận\.[^.!?]*/gi, 'There is no booking preview to confirm. Please provide the date, time, and vehicle.'],
    [/Hãy nói [“"]Đặt[”"], [“"]Nạp thêm[”"], [“"]Hủy[”"], hoặc thông tin muốn đổi\.?/gi,
      'Say “confirm”, “top up”, “cancel”, or tell me what you want to change.'],
    [/Ví chưa đủ tiền\.[^.!?]*/gi, 'Your wallet balance is insufficient. Say “top up” to display the payment QR code.'],
    [/Số dư ví hiện đã đủ[^.!?]*\.?/gi, 'Your wallet balance is sufficient. Say “confirm” to complete the booking.'],
    [/Mình không tìm thấy booking phù hợp[^.!?]*\.?/gi, 'I could not find a matching booking in your account. Please check the date or license plate.'],
    [/Booking đã được hủy\.?/gi, 'The booking has been canceled.'],
    [/Booking đã được cập nhật\.?/gi, 'The booking has been updated.'],
    [/Đặt chỗ thành công\.?/gi, 'Booking completed successfully.'],
    [/Không thể tải bản đồ chỗ trống\.?/gi, 'Unable to load the live parking map.'],
    [/Bạn muốn bắt đầu đỗ ngày nào\?/gi, 'What date would you like to start parking?'],
    [/Bạn muốn kết thúc đỗ ngày nào\?/gi, 'What date would you like to stop parking?'],
    [/Bạn muốn bắt đầu lúc mấy giờ(?: ngày ([0-9/]+))?\?/gi,
      (_, date) => `What arrival time would you like${date ? ` on ${date}` : ''}?`],
    [/Bạn muốn kết thúc lúc mấy giờ(?: ngày ([0-9/]+))?\?/gi,
      (_, date) => `What departure time would you like${date ? ` on ${date}` : ''}?`],
    [/Bạn muốn dùng xe nào\?[^.!?]*/gi, 'Which vehicle would you like to use? Please select one or provide its license plate.'],
    [/Bạn chưa có xe (?:điện|ô tô) đã duyệt\.[^.!?]*/gi,
      'You do not have an approved matching vehicle. Please register one before booking.'],
    [/Xe (\d+) đỗ ngày nào\?/gi, 'What date should vehicle $1 be parked?'],
    [/Xe (\d+) bắt đầu đỗ lúc mấy giờ\?/gi, 'What arrival time should vehicle $1 use?'],
    [/Xe (\d+) muốn đỗ đến mấy giờ\?/gi, 'What departure time should vehicle $1 use?'],
    [/Bạn muốn đặt (\d+) xe\.[^.!?]*/gi, 'You want to book $1 vehicles. Please provide the remaining license plates.'],
    [/Biển số ([A-Z0-9, ]+) không hợp lệ\.[^.!?]*/gi, 'License plate $1 is invalid. Please use a valid car plate such as 43A12345.'],
    [/(\d{2}\/\d{2}\/\d{4})\s+([0-9:]+)\s+đến\s+(\d{2}\/\d{2}\/\d{4})\s+([0-9:]+)/gi, '$1 $2 to $3 $4'],
    [/Không có chỗ phù hợp cho toàn bộ khoảng\s+([^.]+)\./gi,
      'No suitable space is available for the full period $1.'],
    [/Xe\s+([A-Z0-9]+)\s+không thể dùng ô\s+([A-Z0-9_.-]+)\s+vì ô không còn trống hoặc không phù hợp với loại xe\./gi,
      'Vehicle $1 cannot use slot $2 because it is unavailable or incompatible with the vehicle.'],
    [/Xe\s+([A-Z0-9]+)\s+không có ô phù hợp hoặc không còn trống\./gi,
      'No suitable space remains for vehicle $1.'],
    [/Xe\s+([A-Z0-9]+)\s+không còn ô phù hợp tại khu\s+([A-Z0-9_.-]+)\./gi,
      'No suitable space remains for vehicle $1 in zone $2.'],
    [/Ô\s+([A-Z0-9_.-]+)\s+tồn tại ở nhiều tầng(?:\s+\(([^)]+)\))?\.\s*Hãy chọn tầng cụ thể\./gi,
      (_, slotCode, floors) => `Slot ${slotCode} exists on multiple floors${floors ? ` (${floors})` : ''}. Please choose a specific floor.`],
    [/Gợi ý:\s*([^.]+)\./gi, 'Suggested alternative: $1.'],
    [/Hiện chỉ còn (\d+) chỗ trống trong toàn bộ khoảng ([^,]+), nên chưa thể đặt đủ (\d+) xe\.[^?]*\?/gi,
      'Only $1 spaces remain for the full period $2, so $3 vehicles cannot be booked. Would you like fewer vehicles or a different time?'],
    [/Xe ([A-Z0-9]+) đã có booking trùng thời gian trong khoảng ([^.]+)\.[^.!?]*/gi,
      'Vehicle $1 already has an overlapping booking during $2. Please choose another time.'],
    [/Không có ô đỗ phù hợp[^.!?]*\.?/gi, 'No suitable parking slot is available for the selected time.'],
    [/Khoảng thời gian chưa hợp lệ\.?/gi, 'The parking time range is invalid.'],
    [/Giờ bắt đầu[^.!?]*đã qua\.?/gi, 'The selected start time has already passed.'],
    [/(?:Xe (\d+): )?(?:giờ ([0-9:]+) hôm nay|ngày ([0-9/]+)) đã qua\.[^.!?]*/gi,
      (_, vehicle, time, date) => `${vehicle ? `Vehicle ${vehicle}: ` : ''}${time ? `time ${time} today` : `date ${date}`} has already passed. Please choose a future time.`],
    [/Biển số ([A-Z0-9]+) của xe đã đăng ký không hợp lệ\.[^.!?]*/gi,
      'The registered vehicle plate $1 is invalid. Please update the vehicle information.'],
    [/Vui lòng chọn xe (?:điện|ô tô) đã được duyệt[^.!?]*\.?/gi,
      'Please select an approved matching vehicle or change the requested vehicle type.'],
    [/Vui lòng chọn xe đã duyệt[^.!?]*\.?/gi,
      'Please select an approved vehicle or enter a valid car plate such as 43A12345.'],
    [/Thời gian sửa booking chưa hợp lệ\.?/gi, 'The updated booking time is invalid.'],
    [/Thao tác booking không hợp lệ\.?/gi, 'The booking action is invalid.'],
    [/Thao tác xe không hợp lệ\.?/gi, 'The vehicle action is invalid.'],
    [/Không thể cập nhật xe\.?/gi, 'Unable to update the vehicle.'],
    [/Mỗi lần xác nhận tối đa (\d+) chỗ\.[^.!?]*/gi,
      'You can confirm at most $1 spaces at once. Please reduce the number of vehicles.'],
    [/Thời gian của xe ([A-Z0-9]+) chưa hợp lệ\.?/gi, 'The time for vehicle $1 is invalid.'],
    [/Giờ kết thúc của xe ([A-Z0-9]+) phải sau giờ bắt đầu\.?/gi,
      'The departure time for vehicle $1 must be after its arrival time.'],
    [/Xe ([A-Z0-9]+) cần đặt tối thiểu 30 phút\.?/gi,
      'Vehicle $1 must be booked for at least 30 minutes.'],
    [/Ngày ([0-9/]+) đã qua hoặc giờ bắt đầu không còn hợp lệ\.?/gi,
      'Date $1 has passed or its start time is no longer valid.'],
    [/Báo giá chưa đầy đủ cho tất cả chỗ\.?/gi, 'The quote does not cover every requested space.'],
    [/Báo giá không hợp lệ\.?/gi, 'The quote is invalid.'],
    [/Số dư ví chưa đủ\. Cần thêm ([0-9.,]+) VND\.?/gi,
      'Your wallet balance is insufficient. You need $1 VND more.'],
    [/Đây là số chỗ còn trống theo từng ngày\.?/gi, 'Here is the number of available spaces for each date.'],
    [/Thông tin chỗ hoặc giá đã thay đổi\.?/gi, 'The parking slot or price has changed.'],
    [/Hãy xác nhận lại nếu bạn đồng ý\.?/gi, 'Please confirm again if you agree.'],
    [/Chỗ đã thay đổi\.[^.!?]*/gi, 'The parking availability has changed. Please review it again.'],
    [/Đã hủy thao tác\.[^.!?]*/gi, 'The action has been canceled. No data was changed.'],
    [/Đã chấp nhận chính sách\.[^.!?]*/gi, 'The policies have been accepted. Please confirm the booking again.'],
    [/Mình hỗ trợ đặt chỗ, kiểm tra chỗ trống, xem, sửa hoặc hủy booking\.[^.!?]*/gi,
      'I can book a parking space, check availability, or view, change, and cancel a booking. What would you like to do?'],
    [/Vui lòng thử lại/gi, 'Please try again'],
    [/Đã xảy ra lỗi\.?/gi, 'Something went wrong.'],
  ];
  for (const [pattern, replacement] of translations) text = text.replace(pattern, replacement);
  return vietnameseMarker.test(text)
    ? 'I could not complete the booking request. Please review the information and try again.'
    : text;
};

export function localizeAiBookingMessage(value, language = 'vi') {
  let text = String(value || '').trim();
  if (!text) return '';
  if (language === 'en') return vietnameseToEnglish(text);

  text = text
    .replace(/VIP restriction/gi, 'Hạn chế đối với xe có gói ưu tiên')
    .replace(/Network error/gi, 'Lỗi kết nối mạng. Vui lòng thử lại')
    .replace(/Slot already booked/gi, 'Ô đỗ đã có người đặt')
    .replace(/Too late to cancel/gi, 'Đã quá thời hạn hủy lượt đặt chỗ')
    .replace(/Booking is no longer cancellable/gi, 'Lượt đặt chỗ không còn đủ điều kiện hủy')
    .replace(/Bookings can only be canceled when status is PAID/gi, 'Chỉ có thể hủy lượt đặt chỗ đã thanh toán')
    .replace(/Cannot cancel after the booking start time/gi, 'Không thể hủy sau giờ bắt đầu')
    .replace(/Vehicle\s+([A-Z0-9.-]+)\s+already has another booking overlapping with this time(?: period)?/gi,
      'Xe $1 đã có lượt đặt chỗ trùng khung giờ này')
    .replace(/Vehicle\s+([A-Z0-9.-]+)\s+has overlapping bookings within the same cart/gi,
      'Xe $1 có nhiều lượt đặt chỗ trùng giờ trong cùng yêu cầu')
    .replace(/Vehicle\s+([A-Z0-9.-]+)\s+is currently parked and has not checked out\.[^.!?]*/gi,
      'Xe $1 đang đỗ trong bãi và chưa ra. Chưa thể tạo lượt đặt chỗ mới trong khung giờ này')
    .replace(/Parking slot\s+([A-Z0-9-]+)\s+is already booked during your selected time/gi,
      'Ô đỗ $1 đã có người đặt trong khung giờ đã chọn')
    .replace(/Parking slot\s+([A-Z0-9-]+)\s+has overlapping bookings within the same cart/gi,
      'Ô đỗ $1 bị chọn trùng giờ trong cùng yêu cầu')
    .replace(/Parking slot\s+([A-Z0-9-]+)\s+is registered under a fixed subscription/gi,
      'Ô đỗ $1 thuộc gói thuê cố định')
    .replace(/No valid vehicle found for parking slot\s+([A-Z0-9-]+)/gi,
      'Không tìm thấy xe hợp lệ cho ô đỗ $1')
    .replace(/Booking duration must be at least 30 minutes/gi, 'Thời gian đặt chỗ phải tối thiểu 30 phút')
    .replace(/Booking not found|Booking information not found|Corresponding booking not found/gi, 'Không tìm thấy lượt đặt chỗ')
    .replace(/Start time must be in the future|New time must be in the future/gi, 'Giờ bắt đầu phải ở tương lai')
    .replace(/End time must be after start time|Invalid new end time/gi, 'Giờ kết thúc phải sau giờ bắt đầu')
    .replace(/Invalid booking time/gi, 'Thời gian đặt chỗ không hợp lệ')
    .replace(/Invalid payment method/gi, 'Phương thức thanh toán không hợp lệ')
    .replace(/This slot is already booked(?: for your selected time)?/gi, 'Ô đỗ này đã có người đặt')
    .replace(/Temporary hold not found/gi, 'Không tìm thấy phiên giữ chỗ tạm thời')
    .replace(/My\s+Bookings/gi, 'trang đặt chỗ của bạn')
    .replace(/AI\s+Booking/gi, 'trợ lý đặt chỗ')
    .replace(/\bFloor\b/gi, 'Tầng')
    .replace(/\bbookings\b/gi, 'các lượt đặt chỗ')
    .replace(/\bbooking\b/gi, 'lượt đặt chỗ')
    .replace(/\bslots\b/gi, 'các ô đỗ')
    .replace(/\bslot\b/gi, 'ô đỗ')
    .replace(/\bVIP\b/gi, 'gói ưu tiên')
    .replace(/\bQR\b/gi, 'mã xác nhận')
    .replace(/\bPAID\b/g, 'đã thanh toán')
    .replace(/\bCOMPLETED\b/g, 'đã hoàn tất')
    .replace(/\bVND\b/gi, 'đồng')
    .replace(/\bOK\b/g, 'đồng ý')
    .replace(/check-in/gi, 'nhận chỗ')
    .replace(/backend/gi, 'máy chủ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .trim();

  if (englishMarker.test(text) || /\bI(?:'\w+)?\b/.test(text)) {
    return 'Không thể hoàn tất yêu cầu đặt chỗ. Vui lòng kiểm tra thông tin và thử lại.';
  }
  return text;
}

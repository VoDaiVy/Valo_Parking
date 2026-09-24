const englishMarker = /\b(?:the|this|that|vehicle|booking|parking|slot|time|invalid|not|found|cannot|only|please|failed|error|hold|payment|wallet|start|end|already|another|during|selected|current|maximum|permission|release|available|overlapping|too|late|cancel|restriction|network|gateway|unexpected|is|are|was|were|be|been|has|have|your|you|new|status|successfully|cancellable|modified|occupied|insufficient|balance|provide|license|plate|changed|while|updated|retry|service|request)\b/i;

export function localizeAiBookingMessage(value) {
  let text = String(value || '').trim();
  if (!text) return '';

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

  if (englishMarker.test(text)) {
    return 'Không thể hoàn tất yêu cầu đặt chỗ. Vui lòng kiểm tra thông tin và thử lại.';
  }
  return text;
}

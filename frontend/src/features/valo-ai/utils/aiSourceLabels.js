export const sourceLabels = {
  check_system_health: 'Trạng thái hệ thống',
  get_active_sessions: 'Phiên xe đang hoạt động',
  search_sessions: 'Lịch sử phiên xe',
  get_session_detail: 'Chi tiết phiên xe',
  search_users: 'Tài khoản người dùng',
  get_user_detail: 'Thông tin người dùng',
  search_notification_recipients: 'Người nhận thông báo',
  search_vehicles: 'Thông tin phương tiện',
  search_bookings: 'Danh sách đặt chỗ',
  get_booking_detail: 'Chi tiết đặt chỗ',
  get_parking_floors: 'Thông tin tầng đỗ xe',
  get_parking_slots: 'Thông tin vị trí đỗ xe',
  search_transactions: 'Lịch sử giao dịch',
  get_subscription_members: 'Thông tin gói vé',
  get_revenue_metrics: 'Dữ liệu doanh thu',
  get_session_statistics: 'Thống kê lượt xe',
  get_parking_occupancy: 'Tình trạng bãi đỗ',
  get_user_summary: 'Thống kê người dùng',
  get_pricing_config: 'Bảng giá',
  get_package_list: 'Danh sách gói vé',
  get_subscription_stats: 'Thống kê gói vé',
  get_service_catalog: 'Danh sách dịch vụ',
  get_policy_summary: 'Chính sách bãi đỗ',
  get_ai_notifications: 'Cảnh báo AI',
};

export const sourceLabel = (entry) => sourceLabels[entry.tool] || sourceLabels[entry.source] || 'Nguồn dữ liệu khác';

export const sourceUpdatedAt = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `Cập nhật lúc ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(date)} ngày ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)}`;
};

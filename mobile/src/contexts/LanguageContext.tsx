import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'vi';
type Dictionary = Record<string, string>;

const STORAGE_KEY = '@valo/language';
const copy: Record<Language, Dictionary> = {
  en: {
    home: 'Home', bookings: 'Bookings', wallet: 'Wallet', alerts: 'Alerts', account: 'Account',
    notifications: 'Notifications', rewards: 'Vouchers & rewards', quickAccess: 'Quick access',
    myBookings: 'My bookings', myVehicles: 'My vehicles', history: 'History', membership: 'Membership',
    parkingHistory: 'Parking history', personalProfile: 'Personal profile', settings: 'Settings',
    signOut: 'Sign out', viewProfile: 'View profile', all: 'All', available: 'Available', used: 'Used',
    expired: 'Expired', revoked: 'Revoked', language: 'Language', english: 'English', vietnamese: 'Vietnamese',
    overview: 'Overview', parking: 'Parking', sessions: 'Sessions', manage: 'Manage', profile: 'Profile',
    management: 'Management', operationsTools: 'Operations tools', staffWorkflows: 'Staff workflows', tools: 'Tools',
    access: 'Access', modules: 'Modules', mode: 'Mode', live: 'Live', ops: 'Ops',
    staffProfile: 'Staff profile', workShortcuts: 'Work shortcuts', bookingScanner: 'Booking scanner',
    liveParkingGrid: 'Live parking grid', parkingSessions: 'Parking sessions', operationalNotices: 'Operational notices',
    editProfile: 'Edit profile', changePassword: 'Change password', secure: 'Secure', signOutQuestion: 'Sign out?',
    signOutMessage: 'This will end the current staff session on this device.', today: 'Today',
    recentActivity: 'Recent activity', noCompletedSessions: 'No completed sessions', parkingAlmostFull: 'Parking almost full',
    capacityTightening: 'Capacity tightening', capacityStable: 'Capacity stable', minAverage: 'min avg',
    staff: 'Staff', operationsStaff: 'Operations staff', fast: 'Fast',
    staffParkingOps: 'Monitoring & maintenance', staffParkingOpsDesc: 'Violations, maintenance and parking history',
    staffInbox: 'My inbox', staffInboxDesc: 'Staff notifications', staffCommunication: 'Internal communications',
    staffCommunicationDesc: 'Reports and coordination with admin', staffBookings: 'Booking management',
    staffBookingsDesc: 'Review and update customer reservations', staffCustomers: 'Customers',
    staffCustomersDesc: 'Profiles and account access', staffScanner: 'Booking QR scanner',
    staffScannerDesc: 'Scan and inspect reservations', critical: 'Priority', operations: 'Operations',
    support: 'Support', inbox: 'Inbox', internal: 'Internal',
    commandCenter: 'Command center', readyForShift: 'Ready for your shift', liveLabel: 'Live', vehicles: 'Vehicles',
    active: 'Active', capacity: 'Capacity', primaryActions: 'Primary actions', scanQr: 'Scan QR', liveParking: 'Live parking',
    liveStatus: 'Live status', spaces: 'spaces', availableSpaces: 'available', reserved: 'Reserved', maintenance: 'Maintenance',
    blockedBookings: 'blocked bookings', reviewRequired: 'Review required',
  },
  vi: {
    home: 'Trang chủ', bookings: 'Đặt chỗ', wallet: 'Ví', alerts: 'Thông báo', account: 'Tài khoản',
    notifications: 'Thông báo', rewards: 'Voucher & ưu đãi', quickAccess: 'Truy cập nhanh',
    myBookings: 'Đặt chỗ của tôi', myVehicles: 'Xe của tôi', history: 'Lịch sử', membership: 'Gói thành viên',
    parkingHistory: 'Lịch sử đỗ xe', personalProfile: 'Thông tin cá nhân', settings: 'Cài đặt',
    signOut: 'Đăng xuất', viewProfile: 'Xem hồ sơ', all: 'Tất cả', available: 'Có thể dùng', used: 'Đã dùng',
    expired: 'Hết hạn', revoked: 'Đã thu hồi', language: 'Ngôn ngữ', english: 'English', vietnamese: 'Tiếng Việt',
    overview: 'Tổng quan', parking: 'Bãi đỗ', sessions: 'Phiên đỗ', manage: 'Quản lý', profile: 'Hồ sơ',
    management: 'Quản lý', operationsTools: 'Công cụ vận hành', staffWorkflows: 'Quy trình nhân viên', tools: 'Công cụ',
    access: 'Quyền truy cập', modules: 'Mô-đun', mode: 'Chế độ', live: 'Trực tiếp', ops: 'Vận hành',
    staffProfile: 'Hồ sơ nhân viên', workShortcuts: 'Lối tắt công việc', bookingScanner: 'Quét mã đặt chỗ',
    liveParkingGrid: 'Sơ đồ bãi đỗ', parkingSessions: 'Phiên đỗ xe', operationalNotices: 'Thông báo vận hành',
    editProfile: 'Chỉnh sửa hồ sơ', changePassword: 'Đổi mật khẩu', secure: 'Bảo mật', signOutQuestion: 'Đăng xuất?',
    signOutMessage: 'Thao tác này sẽ kết thúc phiên nhân viên trên thiết bị.', today: 'Hôm nay',
    recentActivity: 'Hoạt động gần đây', noCompletedSessions: 'Chưa có phiên hoàn tất', parkingAlmostFull: 'Bãi đỗ sắp đầy',
    capacityTightening: 'Công suất sắp tăng', capacityStable: 'Công suất ổn định', minAverage: 'phút trung bình',
    staff: 'Nhân viên', operationsStaff: 'Nhân viên vận hành', fast: 'Nhanh',
    staffParkingOps: 'Giám sát & bảo trì', staffParkingOpsDesc: 'Vi phạm, bảo trì và lịch sử bãi đỗ',
    staffInbox: 'Hộp thư của tôi', staffInboxDesc: 'Thông báo dành cho nhân viên', staffCommunication: 'Trao đổi nội bộ',
    staffCommunicationDesc: 'Báo cáo và phối hợp với quản trị viên', staffBookings: 'Quản lý đặt chỗ',
    staffBookingsDesc: 'Kiểm tra và cập nhật đặt chỗ của khách', staffCustomers: 'Khách hàng',
    staffCustomersDesc: 'Hồ sơ và quyền truy cập tài khoản', staffScanner: 'Quét mã đặt chỗ',
    staffScannerDesc: 'Quét và kiểm tra đặt chỗ', critical: 'Ưu tiên', operations: 'Vận hành',
    support: 'Hỗ trợ', inbox: 'Hộp thư', internal: 'Nội bộ',
    commandCenter: 'Trung tâm vận hành', readyForShift: 'Sẵn sàng cho ca làm', liveLabel: 'Trực tiếp', vehicles: 'Xe',
    active: 'Đang hoạt động', capacity: 'Công suất', primaryActions: 'Thao tác chính', scanQr: 'Quét QR', liveParking: 'Bãi đỗ trực tiếp',
    liveStatus: 'Trạng thái trực tiếp', spaces: 'ô đỗ', availableSpaces: 'còn trống', reserved: 'Đã đặt', maintenance: 'Bảo trì',
    blockedBookings: 'đặt chỗ bị chặn', reviewRequired: 'Cần kiểm tra',
  },
};

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; toggleLanguage: () => void; t: (key: string) => string };
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  useEffect(() => { void AsyncStorage.getItem(STORAGE_KEY).then((value) => { if (value === 'en' || value === 'vi') setLanguageState(value); }); }, []);
  const setLanguage = (next: Language) => { setLanguageState(next); void AsyncStorage.setItem(STORAGE_KEY, next); };
  const value = useMemo(() => ({ language, setLanguage, toggleLanguage: () => setLanguage(language === 'en' ? 'vi' : 'en'), t: (key: string) => copy[language][key] || copy.en[key] || key }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}

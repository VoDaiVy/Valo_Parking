# Rà soát EN / VI

Ngày: 04/11/2026.

## Nguyên nhân

LanguageContext trước đây chỉ bao phủ tab/header và một số màn hình. Nhiều label, mô tả, button, default state và validation message vẫn hiển thị source tiếng Anh.

## Đã xử lý

- Thêm nguồn dịch tập trung src/i18n/vi.json và hàm translateMessage hỗ trợ placeholder, fallback và UTF-8.
- Nối copy hiển thị của Auth, Booking, Profile, Wallet, Notifications, Staff và shared components với language context.
- Profile trong ảnh: My account, Settings, View profile, Annual/Monthly member, menu, mô tả, số dư và xác nhận đăng xuất.
- Dịch label/status/button tại lớp presentation; không đổi giá trị enum, route, payload hay chuỗi dùng để so sánh validation.
- Giữ tên, email, biển số và nội dung không thuộc từ điển. Nội dung do server/người dùng/AI tạo không được tự động dịch.
- Đưa LanguageProvider lên App để loading, alert, toast và navigator cùng nhận một ngôn ngữ.
- Ngăn kết quả đọc AsyncStorage đến muộn ghi đè lựa chọn mới; cập nhật nhanh bằng ref và tuần tự hóa ghi storage.
- Timestamp thông báo chọn locale vi/enGB; số dư Profile chọn vi-VN/en-US.
- Bổ sung kiểm tra dữ liệu mất dấu, placeholder và raw JSX copy bị bỏ sót; cập nhật mocks của các test dùng component đã nối language context.

## Kiểm tra

- 11 tests pass: 7 ca i18n/coverage và 4 ca QR.
- Android và iOS bundle HTTP 200.
- Lint 0 errors, giữ nguyên 6 warnings cũ tại MembershipScreen.
- TypeScript giữ nguyên 3 lỗi cũ: StatusBar của LoginScreen và route types Subscriptions/TicketPackages ở hai màn Staff cũ.
- Chưa xác minh tương tác trực quan trên emulator/thiết bị thật. Các UI suites dùng react-test-renderer vẫn có giới hạn môi trường đã ghi trong UI_UPGRADE_REPORT.md.

## Kiểm tra thủ công

1. Chọn VI ở Tài khoản: kiểm tra menu, mô tả, badge thành viên và dialog đăng xuất.
2. Chọn EN: nội dung trở về English ngay, không làm mất dữ liệu đang nhập.
3. Đổi nhanh nhiều lần, mở lại app và kiểm tra lựa chọn được lưu.
4. Mở Booking, Wallet, Notifications và Staff; thử empty/loading/error và timestamp.
5. Kiểm tra chữ Việt dài trên màn hình nhỏ/font lớn; nội dung người dùng và biển số phải giữ nguyên.

## Files thuộc đợt sửa i18n

- mobile/App.tsx
- mobile/src/components/PrimaryButton.tsx
- mobile/src/components/auth/RegistrationOtpModal.tsx
- mobile/src/components/booking/BookingActionModal.tsx
- mobile/src/components/booking/BookingCard.tsx
- mobile/src/components/booking/OccupancyForecast.tsx
- mobile/src/components/booking/ParkingMap2D.tsx
- mobile/src/components/booking/PriceBreakdown.tsx
- mobile/src/components/booking/QRCodeDisplay.tsx
- mobile/src/components/booking/ServiceCard.tsx
- mobile/src/components/booking/StatusBadge.tsx
- mobile/src/components/booking/TimeRangePicker.tsx
- mobile/src/components/booking/__tests__/QRCodeDisplay.test.ts
- mobile/src/components/common/Button.tsx
- mobile/src/components/common/EmptyState.tsx
- mobile/src/components/common/ErrorBoundary.tsx
- mobile/src/components/common/ErrorState.tsx
- mobile/src/components/common/IconButton.tsx
- mobile/src/components/common/Input.tsx
- mobile/src/components/common/LanguageToggle.tsx
- mobile/src/components/common/LoadingSpinner.tsx
- mobile/src/components/common/ScreenHeader.tsx
- mobile/src/components/common/SectionTitle.tsx
- mobile/src/components/common/WorkflowUI.tsx
- mobile/src/components/notifications/InAppNotificationBanner.tsx
- mobile/src/components/notifications/NotificationCard.tsx
- mobile/src/components/profile/MembershipBadge.tsx
- mobile/src/components/profile/MenuItem.tsx
- mobile/src/components/profile/ProfileInfoCard.tsx
- mobile/src/components/profile/ProfileUI.tsx
- mobile/src/components/staff/SessionActionsPanel.tsx
- mobile/src/components/staff/StaffAssistantPopup.tsx
- mobile/src/components/staff/__tests__/StaffAssistantPopup.test.tsx
- mobile/src/components/staff/dashboard/GateControlPanel.tsx
- mobile/src/components/staff/dashboard/index.tsx
- mobile/src/components/staff/index.tsx
- mobile/src/contexts/LanguageContext.tsx
- mobile/src/contexts/__tests__/AppAlertContext.test.tsx
- mobile/src/hooks/useToast.ts
- mobile/src/i18n/__tests__/copyCoverage.test.ts
- mobile/src/i18n/__tests__/translate.test.ts
- mobile/src/i18n/translate.ts
- mobile/src/i18n/vi.json
- mobile/src/navigation/AppNavigator.tsx
- mobile/src/screens/ApiTestScreen.tsx
- mobile/src/screens/auth/AuthScreen.tsx
- mobile/src/screens/auth/ForgotPasswordScreen.tsx
- mobile/src/screens/auth/LoginScreen.tsx
- mobile/src/screens/auth/RegisterScreen.tsx
- mobile/src/screens/auth/ResetPasswordScreen.tsx
- mobile/src/screens/auth/VerifyOTPScreen.tsx
- mobile/src/screens/booking/BookingAssistantScreen.tsx
- mobile/src/screens/booking/BookingBrowseScreen.tsx
- mobile/src/screens/booking/BookingCartScreen.tsx
- mobile/src/screens/booking/BookingConfirmationScreen.tsx
- mobile/src/screens/booking/BookingDetailScreen.tsx
- mobile/src/screens/booking/BookingDetailsScreen.tsx
- mobile/src/screens/booking/BookingListScreen.tsx
- mobile/src/screens/booking/CreateBookingScreen.tsx
- mobile/src/screens/booking/FindParkingScreen.tsx
- mobile/src/screens/booking/MyBookingsScreen.tsx
- mobile/src/screens/booking/ParkingMapScreen.tsx
- mobile/src/screens/booking/QRScannerScreen.tsx
- mobile/src/screens/booking/__tests__/BookingCartScreen.test.tsx
- mobile/src/screens/bookings/BookingsScreen.tsx
- mobile/src/screens/customer/HomeScreen.tsx
- mobile/src/screens/customer/ParkingHistoryScreen.tsx
- mobile/src/screens/customer/ProfileScreen.tsx
- mobile/src/screens/home/HomeScreen.tsx
- mobile/src/screens/notifications/NotificationsScreen.tsx
- mobile/src/screens/profile/AddVehicleScreen.tsx
- mobile/src/screens/profile/ChangePasswordScreen.tsx
- mobile/src/screens/profile/EditProfileScreen.tsx
- mobile/src/screens/profile/EditVehicleScreen.tsx
- mobile/src/screens/profile/PersonalProfileScreen.tsx
- mobile/src/screens/profile/PoliciesListScreen.tsx
- mobile/src/screens/profile/PolicyDetailScreen.tsx
- mobile/src/screens/profile/ProfileScreen.tsx
- mobile/src/screens/profile/ServiceListScreen.tsx
- mobile/src/screens/profile/VehicleListScreen.tsx
- mobile/src/screens/shared/ComingSoonScreen.tsx
- mobile/src/screens/shared/UnsupportedRoleScreen.tsx
- mobile/src/screens/staff/CustomerManagementScreen.tsx
- mobile/src/screens/staff/LiveGridScreen.tsx
- mobile/src/screens/staff/SessionDetailScreen.tsx
- mobile/src/screens/staff/SessionListScreen.tsx
- mobile/src/screens/staff/StaffBookingManagementScreen.tsx
- mobile/src/screens/staff/StaffBookingQrScreen.tsx
- mobile/src/screens/staff/StaffCommunicationScreen.tsx
- mobile/src/screens/staff/StaffDashboardScreen.tsx
- mobile/src/screens/staff/StaffNotificationManagementScreen.tsx
- mobile/src/screens/staff/StaffParkingOperationsScreen.tsx
- mobile/src/screens/staff/StaffProfileScreen.tsx
- mobile/src/screens/staff/StaffSubscriptionManagementScreen.tsx
- mobile/src/screens/staff/StaffTicketPackagesScreen.tsx
- mobile/src/screens/wallet/MembershipHubScreen.tsx
- mobile/src/screens/wallet/MembershipScreen.tsx
- mobile/src/screens/wallet/MembershipTransferMarketplaceDetailScreen.tsx
- mobile/src/screens/wallet/MembershipTransferMarketplaceScreen.tsx
- mobile/src/screens/wallet/RewardsScreen.tsx
- mobile/src/screens/wallet/SubscriptionCheckoutScreen.tsx
- mobile/src/screens/wallet/SubscriptionPackagesScreen.tsx
- mobile/src/screens/wallet/SubscriptionPaymentStatusScreen.tsx
- mobile/src/screens/wallet/TopUpScreen.tsx
- mobile/src/screens/wallet/TransactionHistoryScreen.tsx
- mobile/src/screens/wallet/WalletScreen.tsx
- mobile/src/utils/notifications.ts

# ValoParking — báo cáo nâng cấp UI

Ngày: 04/11/2026 (Asia/Bangkok).

## Phạm vi

- Giữ system font, concept dark–gold và bố cục Customer Home hiện tại.
- Completed/Done/Paid và kết quả success dùng semantic green; CTA chính dùng gold.
- Cập nhật 61 file screen, 36 file shared component, 5 file theme/token và 2 navigator (chỉ presentation của tab bar).
- Không thêm dependency; không đổi routes/params, API, data model hoặc logic nghiệp vụ.
- LoginScreen.tsx được bỏ qua theo yêu cầu. StaffAssistantScreen.tsx là route wrapper không có UI riêng; popup mà route mở đã được nâng cấp.
- Các chỉnh sửa backend/.env.example/README từ công việc kết nối API trước đó không thuộc báo cáo UI này.

## Các lô triển khai tiếp trong lượt này

| Lô | Files/nhóm | Kết quả chính |
|---|---|---|
| 14 | FindParking, ParkingMap, QRScanner, ParkingMap2D, ParkingSlot | Contrast slot, selected state, floor tab, scanner thích ứng |
| 15 | Wallet, TopUp, TransactionHistory, SubscriptionPackages, SubscriptionCheckout | Số tiền, success state, filter và button |
| 16 | MembershipHub, Membership, Marketplace, MarketplaceDetail, Rewards | Typography, vùng chạm, hàng giá co giãn |
| 17 | PaymentStatus, StaffDashboard, SessionList, SessionDetail, ManagementHub | Paid/Completed/Done xanh lá, phân cấp thông tin |
| 18 | CustomerManagement, StaffBookingManagement, StaffBookingQr, StaffNotificationManagement, StaffProfile | Typography, form, vùng chạm và Completed |
| 19 | LiveGrid, StaffCommunication, StaffParkingOperations, StaffAssistantPopup | Keyboard avoidance, chữ phụ, bubble và ref popup |
| 20 | StaffSubscriptionManagement, StaffTicketPackages, Home phụ, Profile phụ | Đồng bộ giao diện các màn cũ |
| 21 | Staff UI, Dashboard UI, GateControlPanel, SessionActionsPanel, BookingActionModal | Typography chung, modal cuộn được, success button xanh |
| 22 | Customer Home, BookingList, Notifications, QRCodeDisplay, OccupancyForecast | Ref/list typing, contrast QR brightness, vùng chạm forecast |

## Kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| Expo/Metro | Khởi động thành công, status trả packager-status:running |
| Android bundle | HTTP 200; Metro bundle thành công 2.721 modules |
| iOS bundle | HTTP 200; bundle thành công |
| Lint toàn mobile | 0 errors; giữ nguyên 6 warnings có sẵn tại MembershipScreen.tsx |
| TypeScript toàn mobile | Còn 3 lỗi có sẵn; các lỗi ref, StatusBar và list liên quan trong phạm vi UI đã được xử lý |
| QRCodeDisplay tests | 4/4 pass |
| BookingCartScreen, StaffAssistantPopup tests | Hai suite không chạy được do mismatch dependency đang cài: React 19.3.0 / react-test-renderer 19.3.1 |
| git diff --check | Không có lỗi whitespace; Git có thông báo chuẩn hóa LF/CRLF |
| Thiết bị thật | Chưa kiểm chứng; bundle thành công không thay thế runtime/visual QA |

Ba lỗi TypeScript còn lại:

- src/screens/auth/LoginScreen.tsx:136 — StatusBar.backgroundColor; file được yêu cầu bỏ qua.
- src/screens/staff/StaffSubscriptionManagementScreen.tsx:25 — route type Subscriptions không có trong StaffManagementStackParamList.
- src/screens/staff/StaffTicketPackagesScreen.tsx:20 — route type TicketPackages không có trong StaffManagementStackParamList.

Không đổi route types để che lỗi ở hai màn Staff cũ. Không thay dependency để vượt qua lỗi môi trường test.

## Cần kiểm tra trên thiết bị thật

- iPhone có notch/home indicator và Android gesture navigation: safe area, tab bar, sticky footer.
- Font scaling 100%, 130%, 160%; màn hình nhỏ và xoay ngang: title, giá, status pill, nút nhiều chữ.
- Auth/OTP: mở keyboard, chuyển focus, paste OTP, resend/loading, modal khi keyboard mở.
- Booking: chọn floor/slot/service, giỏ hàng, confirmation, Completed xanh lá và các trạng thái empty/error/loading.
- QR scanner và QR brightness: camera permission, khung quét, khả năng đọc QR và contrast reference/share.
- Wallet/Membership: số tiền dài, payment success, pending/failed, marketplace và transfer status.
- Staff: LiveGrid, camera, gate controls, session action sheet, notification form và assistant popup khi keyboard mở.
- Thử với dữ liệu dài bằng tiếng Việt; kiểm tra TalkBack/VoiceOver, vùng chạm và press feedback.
- Xác nhận console trên iOS/Android không có warning mới; chưa có bằng chứng runtime để khẳng định điều này.

## Chưa làm / đề xuất tiếp theo

- Xử lý riêng 3 lỗi TypeScript cũ khi phạm vi route/Login được cho phép.
- Đồng bộ react-test-renderer đang cài với React 19.3.0 rồi chạy lại hai UI suites.
- Review trực quan trên thiết bị và đo contrast của từng tổ hợp màu thực tế; chưa khẳng định toàn app đạt WCAG AA.
- 6 warnings unused component cũ của MembershipScreen được giữ nguyên.

## Danh sách đầy đủ file source đã đổi trong toàn bộ đợt UI

- mobile/src/components/CustomInput.tsx
- mobile/src/components/PrimaryButton.tsx
- mobile/src/components/auth/RegistrationOtpModal.tsx
- mobile/src/components/booking/BookingActionModal.tsx
- mobile/src/components/booking/BookingCard.tsx
- mobile/src/components/booking/OccupancyForecast.tsx
- mobile/src/components/booking/ParkingMap2D.tsx
- mobile/src/components/booking/ParkingSlot.tsx
- mobile/src/components/booking/PriceBreakdown.tsx
- mobile/src/components/booking/QRCodeDisplay.tsx
- mobile/src/components/booking/ServiceCard.tsx
- mobile/src/components/booking/StatusBadge.tsx
- mobile/src/components/booking/TimeRangePicker.tsx
- mobile/src/components/common/Button.tsx
- mobile/src/components/common/Card.tsx
- mobile/src/components/common/EmptyState.tsx
- mobile/src/components/common/ErrorState.tsx
- mobile/src/components/common/IconButton.tsx
- mobile/src/components/common/Input.tsx
- mobile/src/components/common/LoadingSpinner.tsx
- mobile/src/components/common/ScreenHeader.tsx
- mobile/src/components/common/SectionTitle.tsx
- mobile/src/components/common/WorkflowUI.tsx
- mobile/src/components/layout/Screen.tsx
- mobile/src/components/notifications/InAppNotificationBanner.tsx
- mobile/src/components/notifications/NotificationCard.tsx
- mobile/src/components/profile/MembershipBadge.tsx
- mobile/src/components/profile/MenuItem.tsx
- mobile/src/components/profile/ProfileAvatar.tsx
- mobile/src/components/profile/ProfileInfoCard.tsx
- mobile/src/components/profile/ProfileUI.tsx
- mobile/src/components/staff/SessionActionsPanel.tsx
- mobile/src/components/staff/StaffAssistantPopup.tsx
- mobile/src/components/staff/dashboard/GateControlPanel.tsx
- mobile/src/components/staff/dashboard/index.tsx
- mobile/src/components/staff/index.tsx
- mobile/src/constants/theme.ts
- mobile/src/navigation/CustomerNavigator.tsx
- mobile/src/navigation/StaffNavigator.tsx
- mobile/src/screens/ApiTestScreen.tsx
- mobile/src/screens/auth/AuthScreen.tsx
- mobile/src/screens/auth/ForgotPasswordScreen.tsx
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
- mobile/src/screens/staff/ManagementHubScreen.tsx
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
- mobile/src/theme/borderRadius.ts
- mobile/src/theme/colors.ts
- mobile/src/theme/shadows.ts
- mobile/src/theme/typography.ts

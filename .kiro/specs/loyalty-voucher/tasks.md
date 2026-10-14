# Implementation Plan: Loyalty Points & Vouchers

## Overview

Triển khai tính năng Loyalty Points & Vouchers theo kiến trúc đã thiết kế: 4 model mới, 2 service, 2 controller, tích hợp vào booking/subscription flow hiện có, và mount routes trong server.js.

## Tasks

- [ ] 1. Tạo 4 data models mới
  - [ ] 1.1 Tạo `backend/src/models/LoyaltyAccount.js`
    - Schema: `userId` (ObjectId, ref User, unique, required), `balance` (Number, default 0, min 0)
    - Index unique trên `userId`
    - Timestamps: true
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 1.2 Tạo `backend/src/models/PointTransaction.js`
    - Schema: `loyaltyAccountId`, `userId` (denormalized), `type` (EARN/REVOKE/REDEEM), `amount` (min 0), `balanceBefore`, `balanceAfter`, `refSource` (booking/subscription/voucher), `refSourceId`
    - Compound index: `{ loyaltyAccountId: 1, createdAt: -1 }` và `{ userId: 1, type: 1, refSourceId: 1 }`
    - Timestamps: true
    - _Requirements: 1.3, 2.3, 3.3, 4.2, 6.7_

  - [ ] 1.3 Tạo `backend/src/models/VoucherTemplate.js`
    - Schema: `name`, `type` (PERCENT_DISCOUNT/FREE_SERVICE), `pointCost` (min 1), `discountPercent` (min 1, max 100, nullable), `serviceId` (ref Service, nullable), `isActive` (default true)
    - Custom validator: nếu type=PERCENT_DISCOUNT thì discountPercent required; nếu type=FREE_SERVICE thì serviceId required
    - Timestamps: true
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 1.4 Tạo `backend/src/models/UserVoucher.js`
    - Schema: `userId` (ref User), `templateId` (ref VoucherTemplate), `status` (available/used/expired, default available), `redeemedAt` (default Date.now), `expiresAt` (required), `usedAt` (nullable), `bookingId` (ref Booking, nullable)
    - pre-save hook: nếu `isNew` thì set `expiresAt = redeemedAt + 30*24*60*60*1000`
    - Index: `{ userId: 1, status: 1 }`, `{ bookingId: 1 }` (sparse)
    - Timestamps: true
    - _Requirements: 6.5, 6.6_

- [ ] 2. Mở rộng `Booking.js` — thêm voucher fields vào paymentBreakdownSnapshot
  - Thêm vào sub-document `paymentBreakdownSnapshot` trong `backend/src/models/Booking.js`:
    - `voucherId: { type: ObjectId, ref: 'UserVoucher', default: null }`
    - `voucherDiscount: { type: Number, min: 0, default: null }`
    - `discountedTotal: { type: Number, min: 0, default: null }`
  - _Requirements: 7.6_

- [ ] 3. Implement `loyaltyService.js`
  - [ ] 3.1 Tạo `backend/src/services/loyaltyService.js` với hàm `earnPoints`
    - Tính `points = Math.floor(amount / 1000)`; nếu points = 0 thì return void (không tạo transaction)
    - Upsert LoyaltyAccount theo userId (tạo nếu chưa tồn tại)
    - Tạo PointTransaction type=EARN với balanceBefore/balanceAfter
    - Cộng points vào balance
    - Hỗ trợ optional `session` param cho Mongoose transactions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1_

  - [ ]* 3.2 Viết property test cho earnPoints
    - **Property 1: Points calculation uses floor division**
    - **Validates: Requirements 1.1, 1.5, 3.1, 3.5, 9.1**
    - **Property 2: Earning points increases balance by the calculated amount**
    - **Validates: Requirements 1.2, 3.2**

  - [ ] 3.3 Thêm hàm `revokePoints` vào `loyaltyService.js`
    - Tìm PointTransaction EARN theo `{ refSource, refSourceId }` — nếu không có thì return void (no-op)
    - Tính `revokeAmount = min(earnTransaction.amount, account.balance)` để đảm bảo balance >= 0
    - Tạo PointTransaction type=REVOKE, trừ balance
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 3.4 Viết property test cho revokePoints
    - **Property 4: Balance non-negative invariant**
    - **Validates: Requirements 4.3, 2.5, 9.3**
    - **Property 5: Revoke is clamped to earned amount and current balance**
    - **Validates: Requirements 2.1, 2.4, 9.4**

  - [ ] 3.5 Thêm hàm `redeemPoints` vào `loyaltyService.js` (atomic với Mongoose session)
    - Validate: template tồn tại, isActive=true, balance >= pointCost
    - Mở Mongoose session, startTransaction
    - Trừ pointCost khỏi balance, tạo PointTransaction type=REDEEM
    - Tạo UserVoucher (expiresAt set bởi pre-save hook)
    - commitTransaction; nếu lỗi thì abortTransaction và throw AppError
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ]* 3.6 Viết property test cho redeemPoints
    - **Property 6: Redemption is atomic**
    - **Validates: Requirements 6.4, 6.8, 9.5**
    - **Property 7: UserVoucher expires exactly 30 days after redemption**
    - **Validates: Requirements 6.5**
    - **Property 8: Insufficient balance rejects redemption**
    - **Validates: Requirements 6.1, 6.2**

- [ ] 4. Checkpoint — Kiểm tra loyaltyService
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement `voucherService.js`
  - [ ] 5.1 Tạo `backend/src/services/voucherService.js` với hàm `validateAndApplyVoucher`
    - Validate UserVoucher: status=available, chưa hết hạn (currentTime < expiresAt), populate templateId
    - Nếu type=PERCENT_DISCOUNT: tính `discountedAmount = Math.floor(prepaidAmount * (1 - discountPercent/100))`, cập nhật `booking.paymentBreakdownSnapshot`
    - Nếu type=FREE_SERVICE: kiểm tra Service.isActive=true, tạo BookingService với price=0
    - Ghi `booking.paymentBreakdownSnapshot.voucherId`, `voucherDiscount`, `discountedTotal`
    - Hỗ trợ param `session` cho transactional context
    - Throw AppError theo bảng Error Handling trong design
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 5.2 Viết property test cho validateAndApplyVoucher
    - **Property 10: Used voucher cannot be applied again**
    - **Validates: Requirements 7.9, 8.6, 9.6**
    - **Property 11: Expired voucher is always rejected regardless of status**
    - **Validates: Requirements 7.3, 7.4, 8.1, 9.7**
    - **Property 12: Percent discount calculation uses floor division**
    - **Validates: Requirements 7.5**

  - [ ] 5.3 Thêm hàm `markVoucherUsed` vào `voucherService.js`
    - Tìm UserVoucher theo bookingId (từ `paymentBreakdownSnapshot.voucherId`)
    - Set `status = used`, `usedAt = new Date()`, `bookingId = bookingId`
    - Hỗ trợ param `session`
    - _Requirements: 7.7, 8.5_

  - [ ]* 5.4 Viết property test cho markVoucherUsed
    - **Property 9: Voucher becomes used when booking is paid**
    - **Validates: Requirements 7.7, 8.5**

- [ ] 6. Tạo `loyaltyController.js` và `loyaltyRoutes.js`
  - [ ] 6.1 Tạo `backend/src/controllers/loyaltyController.js`
    - `getAccount`: upsert LoyaltyAccount, trả về balance + paginated PointTransactions (sorted createdAt desc, query params: page, limit)
    - `redeemVoucher`: gọi `loyaltyService.redeemPoints({ userId, templateId })`; trả về userVoucher mới tạo
    - `getVouchers`: danh sách UserVoucher của user (filter theo status nếu có, populate templateId)
    - _Requirements: 4.4, 6.1–6.8_

  - [ ]* 6.2 Viết unit tests cho loyaltyController
    - Test `getAccount` trả về balance + transactions sorted desc
    - Test `redeemVoucher` với balance đủ và không đủ
    - _Requirements: 4.4, 6.2_

  - [ ] 6.3 Tạo `backend/src/routes/loyaltyRoutes.js`
    - `GET /account` → `loyaltyController.getAccount` (auth: customer)
    - `POST /redeem` → `loyaltyController.redeemVoucher` (auth: customer)
    - `GET /vouchers` → `loyaltyController.getVouchers` (auth: customer)
    - Dùng middleware `authMiddleware` hiện có
    - _Requirements: 4.4_

  - [ ]* 6.4 Viết property test cho transaction ordering
    - **Property 13: Transaction history is ordered descending by creation time**
    - **Validates: Requirements 4.4**

- [ ] 7. Tạo `voucherTemplateController.js` và route admin
  - [ ] 7.1 Tạo `backend/src/controllers/voucherTemplateController.js`
    - `listTemplates`: GET all (admin)
    - `createTemplate`: validate body, tạo VoucherTemplate; reject nếu type không hợp lệ
    - `updateTemplate`: cập nhật template, không ảnh hưởng UserVoucher hiện có
    - `deactivateTemplate`: set isActive=false
    - `deleteTemplate`: kiểm tra không có UserVoucher với status=available trước khi xóa; throw AppError 400 nếu có
    - _Requirements: 5.1–5.8_

  - [ ]* 7.2 Viết unit tests cho voucherTemplateController
    - Test xóa template có available voucher → 400
    - Test discountPercent ngoài [1,100] → rejected
    - _Requirements: 5.8, 5.2_

  - [ ] 7.3 Thêm routes admin vào `backend/src/routes/adminRoutes.js` hoặc tạo file mới
    - `GET /api/admin/voucher-templates`
    - `POST /api/admin/voucher-templates`
    - `PUT /api/admin/voucher-templates/:id`
    - `PATCH /api/admin/voucher-templates/:id/deactivate`
    - `DELETE /api/admin/voucher-templates/:id`
    - Dùng middleware admin auth hiện có
    - _Requirements: 5.1–5.8_

  - [ ]* 7.4 Viết property test cho VoucherTemplate discountPercent validation
    - **Property 14: VoucherTemplate discountPercent is in [1, 100]**
    - **Validates: Requirements 5.2**

- [ ] 8. Tích hợp loyalty hooks vào `bookingController.js`
  - [ ] 8.1 Thêm `earnPoints` hook sau khi booking chuyển sang `COMPLETED`
    - Import `loyaltyService` vào `bookingController.js`
    - Sau khi save/update booking thành COMPLETED, gọi `loyaltyService.earnPoints({ userId: booking.userId, amount: booking.prepaidAmount, refSource: 'booking', refSourceId: booking._id }).catch(err => console.error('[Loyalty] earnPoints failed:', err))`
    - Pattern fire-and-log: không throw, không await block response
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 8.2 Thêm `revokePoints` hook sau khi booking chuyển sang `CANCELLED`
    - Sau khi save/update booking thành CANCELLED, gọi `loyaltyService.revokePoints({ userId: booking.userId, refSource: 'booking', refSourceId: booking._id }).catch(err => console.error('[Loyalty] revokePoints failed:', err))`
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 8.3 Tích hợp `validateAndApplyVoucher` vào `createBooking`
    - Nếu `req.body.voucherId` tồn tại, gọi `voucherService.validateAndApplyVoucher({ voucherId, booking, session })` trong cùng payment session
    - Cập nhật `prepaidAmount` = `discountedTotal` nếu PERCENT_DISCOUNT
    - Gọi `markVoucherUsed` khi booking chuyển sang PAID (trong payment flow)
    - _Requirements: 7.1–7.9, 8.1–8.7_

- [ ] 9. Tích hợp `earnPoints` hook vào `subscriptionController.js`
  - Tìm vị trí trong `subscriptionController.js` nơi `paymentStatus` chuyển sang `paid` (webhook handler hoặc confirm payment)
  - Import `loyaltyService`, gọi `loyaltyService.earnPoints({ userId: subscription.user, amount: subscription.amount, refSource: 'subscription', refSourceId: subscription._id }).catch(err => console.error('[Loyalty] earnPoints (sub) failed:', err))`
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 10. Mount routes trong `server.js`
  - Thêm vào `backend/src/server.js`:
    - `app.use("/api/loyalty", require("./routes/loyaltyRoutes"))`
  - VoucherTemplate admin routes đã được mount qua `adminRoutes` hoặc file route mới (tuỳ cách triển khai ở task 7.3)
  - _Requirements: 4.4, 5.1–5.8, 6.1–6.8_

- [ ] 11. Cài đặt fast-check và viết property-based tests
  - [ ] 11.1 Cài dev dependency: `npm install --save-dev fast-check` trong `backend/`
    - Verify package.json đã có `fast-check` trong devDependencies

  - [ ]* 11.2 Tạo `backend/src/tests/loyalty.property.test.js` với tất cả 14 properties
    - Mỗi test có comment `// Feature: loyalty-voucher, Property N: <property text>`
    - Mỗi test chạy tối thiểu 100 iterations (`{ numRuns: 100 }`)
    - P1, P2: test `earnPoints` logic với `fc.integer({min:0, max:10_000_000})`
    - P3, P4: test balance invariant với arbitrary sequence EARN/REVOKE/REDEEM
    - P5: earn N points, spend some, cancel → revoke = min(N, currentBalance)
    - P6: simulate DB fail mid-redeem → balance unchanged, no voucher
    - P7: `expiresAt = redeemedAt + 30 * 24 * 60 * 60 * 1000`
    - P8: balance < pointCost → redeemPoints throws
    - P9–P11: voucher status/expiry enforcement
    - P12: PERCENT_DISCOUNT floor division
    - P13: transaction list sorted by createdAt desc
    - P14: discountPercent outside [1,100] rejected
    - _Requirements: 9.1–9.7_

  - [ ]* 11.3 Tạo `backend/src/tests/loyalty.unit.test.js` với 7 edge cases
    - `earnPoints` với amount < 1000 → không tạo PointTransaction
    - `revokePoints` khi không có EARN transaction → no-op
    - Admin xóa VoucherTemplate có available voucher → lỗi 400
    - Subscription cancelled → không revoke điểm (chỉ booking mới revoke)
    - FREE_SERVICE voucher tạo BookingService với price=0
    - Áp dụng 2 FREE_SERVICE voucher vào cùng booking → lỗi
    - PERCENT_DISCOUNT voucher không apply được vào subscription
    - _Requirements: 1.4, 2.2, 5.8, 3.4, 8.3, 8.7, 7.8_

- [ ] 12. Final checkpoint — Đảm bảo tất cả tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks đánh dấu `*` là optional, có thể bỏ qua khi cần MVP nhanh
- Property tests (fast-check) và unit tests (Jest) bổ sung cho nhau — không thay thế
- Hook `earnPoints`/`revokePoints` dùng pattern fire-and-log: lỗi tích điểm không làm fail request chính
- `redeemPoints` dùng Mongoose session để đảm bảo atomicity (Property 6)
- Tất cả AppError phải có `statusCode` để đi qua `errorHandler` middleware hiện có

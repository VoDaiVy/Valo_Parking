# Requirements Document

## Introduction

Tính năng **Loyalty Points & Vouchers** cho phép khách hàng của hệ thống VALO PARKING tích lũy điểm thưởng từ các giao dịch đặt chỗ theo giờ và đăng ký gói thuê bao, sau đó đổi điểm lấy voucher để được giảm giá hoặc miễn phí dịch vụ kèm theo khi đặt chỗ. Admin quản lý danh mục voucher template. Toàn bộ luồng đổi điểm phải đảm bảo tính nguyên tử (atomic) để tránh mất điểm hoặc tạo voucher trùng lặp.

---

## Glossary

- **LoyaltyAccount**: Tài khoản điểm của một User — lưu số dư điểm hiện tại (`balance`) và tham chiếu lịch sử giao dịch điểm.
- **PointTransaction**: Một bản ghi thay đổi điểm (earn/revoke/redeem) của một LoyaltyAccount.
- **VoucherTemplate**: Template do Admin tạo ra, định nghĩa loại voucher, giá trị, số điểm cần đổi.
- **UserVoucher**: Voucher cụ thể thuộc về một User sau khi đổi điểm, có thời hạn 30 ngày.
- **Booking**: Đặt chỗ theo giờ trong hệ thống VALO PARKING (`Booking.js`).
- **Subscription**: Đăng ký gói thuê bao tháng/năm (`Subscription.js`).
- **BookingService**: Extra service đi kèm booking (ví dụ: car wash) (`BookingService.js`).
- **Service**: Dịch vụ thêm có thể attach vào booking (`Service.js`).
- **LoyaltySystem**: Toàn bộ hệ thống tích điểm và voucher (dùng khi cần chỉ đến hệ thống tổng thể).
- **Admin**: Người dùng có `role = admin`.
- **Customer**: Người dùng có `role = customer`.

---

## Requirements

### Requirement 1: Tích điểm từ Booking hoàn thành

**User Story:** As a Customer, I want to earn loyalty points when my hourly parking booking is completed, so that I can accumulate points for rewards.

#### Acceptance Criteria

1. WHEN a Booking transitions to `status = COMPLETED`, THE LoyaltySystem SHALL calculate earned points as `floor(Booking.prepaidAmount / 1000)`.
2. WHEN a Booking transitions to `status = COMPLETED`, THE LoyaltySystem SHALL credit the calculated points to the Customer's LoyaltyAccount balance.
3. WHEN a Booking transitions to `status = COMPLETED`, THE LoyaltySystem SHALL create a PointTransaction of type `EARN` referencing the Booking's `_id`.
4. WHEN a Booking transitions to `status = COMPLETED` and `Booking.prepaidAmount < 1000`, THE LoyaltySystem SHALL credit 0 points and SHALL NOT create a PointTransaction.
5. THE LoyaltySystem SHALL calculate earned points using integer floor division, never rounding up.

---

### Requirement 2: Thu hồi điểm khi Booking bị huỷ

**User Story:** As an Admin, I want loyalty points to be revoked when a booking is cancelled, so that points are only kept for completed transactions.

#### Acceptance Criteria

1. WHEN a Booking transitions to `status = CANCELLED` and a PointTransaction of type `EARN` referencing that Booking exists, THE LoyaltySystem SHALL revoke exactly the number of points recorded in that PointTransaction.
2. WHEN a Booking transitions to `status = CANCELLED` and no PointTransaction of type `EARN` referencing that Booking exists, THE LoyaltySystem SHALL NOT modify the Customer's LoyaltyAccount balance.
3. WHEN a Booking is cancelled, THE LoyaltySystem SHALL create a PointTransaction of type `REVOKE` referencing the Booking's `_id`.
4. IF revoking points would cause the LoyaltyAccount balance to fall below 0, THEN THE LoyaltySystem SHALL revoke only the available balance and SHALL record the actual revoked amount in the PointTransaction.
5. THE LoyaltySystem SHALL ensure the LoyaltyAccount balance is greater than or equal to 0 after any revocation.

---

### Requirement 3: Tích điểm từ Subscription thanh toán

**User Story:** As a Customer, I want to earn loyalty points when I successfully pay for a subscription package, so that I am rewarded for long-term commitments.

#### Acceptance Criteria

1. WHEN a Subscription transitions to `paymentStatus = paid`, THE LoyaltySystem SHALL calculate earned points as `floor(Subscription.amount / 1000)`.
2. WHEN a Subscription transitions to `paymentStatus = paid`, THE LoyaltySystem SHALL credit the calculated points to the Customer's LoyaltyAccount balance.
3. WHEN a Subscription transitions to `paymentStatus = paid`, THE LoyaltySystem SHALL create a PointTransaction of type `EARN` referencing the Subscription's `_id`.
4. WHEN a Subscription expires or is cancelled, THE LoyaltySystem SHALL NOT revoke points previously earned from that Subscription.
5. THE LoyaltySystem SHALL calculate earned points using integer floor division, never rounding up.

---

### Requirement 4: Quản lý LoyaltyAccount

**User Story:** As a Customer, I want to view my current points balance and transaction history, so that I know how many points I have and how they were earned or spent.

#### Acceptance Criteria

1. THE LoyaltySystem SHALL create a LoyaltyAccount for a Customer when the Customer's first PointTransaction is created.
2. THE LoyaltySystem SHALL maintain a LoyaltyAccount balance that equals the sum of all `EARN` PointTransactions minus the sum of all `REVOKE` and `REDEEM` PointTransactions for that account.
3. THE LoyaltySystem SHALL ensure the LoyaltyAccount balance is greater than or equal to 0 at all times.
4. WHEN a Customer requests their LoyaltyAccount, THE LoyaltySystem SHALL return the current balance and a paginated list of PointTransactions ordered by creation time descending.
5. THE LoyaltySystem SHALL NOT apply an expiry date to loyalty points.

---

### Requirement 5: Admin quản lý VoucherTemplate

**User Story:** As an Admin, I want to create and manage voucher templates, so that I can define the rewards available for point redemption.

#### Acceptance Criteria

1. THE LoyaltySystem SHALL support two VoucherTemplate types: `PERCENT_DISCOUNT` and `FREE_SERVICE`.
2. WHEN an Admin creates a VoucherTemplate of type `PERCENT_DISCOUNT`, THE LoyaltySystem SHALL require `discountPercent` as an integer in the range [1, 100].
3. WHEN an Admin creates a VoucherTemplate of type `FREE_SERVICE`, THE LoyaltySystem SHALL require `serviceId` referencing an active Service document.
4. THE LoyaltySystem SHALL require `pointCost` (integer > 0) and `name` for every VoucherTemplate.
5. WHEN an Admin creates a VoucherTemplate, THE LoyaltySystem SHALL set `isActive = true` by default.
6. WHEN an Admin updates a VoucherTemplate, THE LoyaltySystem SHALL apply changes only to the VoucherTemplate document and SHALL NOT retroactively affect existing UserVouchers.
7. WHEN an Admin deactivates a VoucherTemplate (`isActive = false`), THE LoyaltySystem SHALL prevent new redemptions against that template.
8. THE LoyaltySystem SHALL allow an Admin to delete a VoucherTemplate only when no UserVoucher with `status = available` references that template.

---

### Requirement 6: Customer đổi điểm lấy Voucher

**User Story:** As a Customer, I want to redeem my loyalty points for a voucher, so that I can receive discounts or free services on future bookings.

#### Acceptance Criteria

1. WHEN a Customer submits a redemption request for a VoucherTemplate, THE LoyaltySystem SHALL verify the Customer's LoyaltyAccount balance is greater than or equal to `VoucherTemplate.pointCost`.
2. IF the Customer's LoyaltyAccount balance is less than `VoucherTemplate.pointCost`, THEN THE LoyaltySystem SHALL reject the redemption request with an error indicating insufficient points.
3. IF the VoucherTemplate has `isActive = false`, THEN THE LoyaltySystem SHALL reject the redemption request with an error indicating the template is unavailable.
4. WHEN a redemption request is approved, THE LoyaltySystem SHALL atomically deduct `VoucherTemplate.pointCost` points from the LoyaltyAccount AND create a UserVoucher in a single database transaction.
5. WHEN a UserVoucher is created, THE LoyaltySystem SHALL set `expiresAt = redeemedAt + 30 days`.
6. WHEN a UserVoucher is created, THE LoyaltySystem SHALL set `status = available`.
7. WHEN a redemption request is approved, THE LoyaltySystem SHALL create a PointTransaction of type `REDEEM` referencing the VoucherTemplate's `_id`.
8. IF the atomic transaction in criterion 4 fails, THEN THE LoyaltySystem SHALL rollback both the point deduction and the UserVoucher creation, leaving the LoyaltyAccount balance unchanged.

---

### Requirement 7: Áp dụng Voucher giảm giá % vào Booking

**User Story:** As a Customer, I want to apply a percentage discount voucher when creating a booking, so that I pay less for hourly parking.

#### Acceptance Criteria

1. WHEN a Customer applies a UserVoucher of type `PERCENT_DISCOUNT` to a Booking, THE LoyaltySystem SHALL verify the UserVoucher has `status = available`.
2. IF the UserVoucher has `status != available`, THEN THE LoyaltySystem SHALL reject the application with an error indicating the voucher has been used or does not exist.
3. WHEN a Customer applies a UserVoucher of type `PERCENT_DISCOUNT` to a Booking, THE LoyaltySystem SHALL verify the current time is before `UserVoucher.expiresAt`.
4. IF the current time is on or after `UserVoucher.expiresAt`, THEN THE LoyaltySystem SHALL reject the application with an error indicating the voucher has expired.
5. WHEN a valid UserVoucher of type `PERCENT_DISCOUNT` is applied to a Booking, THE LoyaltySystem SHALL calculate the discounted amount as `floor(Booking.prepaidAmount * (1 - discountPercent / 100))`.
6. WHEN a valid UserVoucher of type `PERCENT_DISCOUNT` is applied, THE LoyaltySystem SHALL record the discount details in `Booking.paymentBreakdownSnapshot`.
7. WHEN a Booking with an applied UserVoucher reaches `status = PAID`, THE LoyaltySystem SHALL set the UserVoucher `status = used` and record `usedAt` timestamp.
8. THE LoyaltySystem SHALL NOT allow a UserVoucher of type `PERCENT_DISCOUNT` to be applied to a Subscription payment.
9. THE LoyaltySystem SHALL NOT allow the same UserVoucher to be applied to more than one Booking.

---

### Requirement 8: Áp dụng Voucher miễn phí dịch vụ vào Booking

**User Story:** As a Customer, I want to apply a free service voucher when creating a booking, so that I receive an extra service at no cost.

#### Acceptance Criteria

1. WHEN a Customer applies a UserVoucher of type `FREE_SERVICE` to a Booking, THE LoyaltySystem SHALL verify the UserVoucher has `status = available` and current time is before `UserVoucher.expiresAt`.
2. IF the UserVoucher has `status != available` or current time is on or after `UserVoucher.expiresAt`, THEN THE LoyaltySystem SHALL reject the application with an appropriate error.
3. WHEN a valid UserVoucher of type `FREE_SERVICE` is applied to a Booking, THE LoyaltySystem SHALL add the corresponding Service to the Booking as a BookingService with `price = 0`.
4. WHEN a valid UserVoucher of type `FREE_SERVICE` is applied to a Booking and the Service specified in the VoucherTemplate has `isActive = false`, THEN THE LoyaltySystem SHALL reject the application with an error indicating the service is unavailable.
5. WHEN a Booking with an applied free-service UserVoucher reaches `status = PAID`, THE LoyaltySystem SHALL set the UserVoucher `status = used` and record `usedAt` timestamp.
6. THE LoyaltySystem SHALL NOT allow the same UserVoucher to be applied to more than one Booking.
7. THE LoyaltySystem SHALL NOT allow a Customer to apply more than one `FREE_SERVICE` UserVoucher to the same Booking.

---

### Requirement 9: Tính đúng đắn của phép tính điểm (Correctness Properties)

**User Story:** As a System, I want point calculations and balance mutations to be provably correct, so that Customers never lose points unfairly and balances are always consistent.

#### Acceptance Criteria

1. FOR ALL payment amounts `A` (in VND), THE LoyaltySystem SHALL calculate earned points as `Math.floor(A / 1000)`, such that `Math.floor(1999 / 1000) = 1` and `Math.floor(999 / 1000) = 0`.
2. FOR ALL sequences of EARN, REVOKE, and REDEEM operations on a LoyaltyAccount, THE LoyaltySystem SHALL maintain `balance = sum(EARN amounts) - sum(REVOKE amounts) - sum(REDEEM amounts)`.
3. FOR ALL states of a LoyaltyAccount, THE LoyaltySystem SHALL maintain `balance >= 0`.
4. WHEN a Booking earns N points and is subsequently cancelled, THE LoyaltySystem SHALL revoke exactly min(N, current balance) points — never more than N points earned from that Booking.
5. WHEN a redemption operation debits P points and creates one UserVoucher, IF any part of the operation fails, THEN THE LoyaltySystem SHALL ensure both the debit and the UserVoucher creation are rolled back (atomicity invariant).
6. WHEN a UserVoucher has `status = used`, THE LoyaltySystem SHALL reject any subsequent attempt to apply that UserVoucher with an idempotent error response.
7. WHEN a UserVoucher has `expiresAt` in the past, THE LoyaltySystem SHALL reject any attempt to apply that UserVoucher regardless of its `status`.

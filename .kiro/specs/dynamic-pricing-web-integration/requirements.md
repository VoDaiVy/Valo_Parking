# Requirements Document

## Introduction

Tích hợp Dynamic Pricing vào web frontend VALO PARKING. Hiện tại, toàn bộ giá hiển thị trên frontend
được tính từ `bookingPricing.js` (timeBlocks cố định) hoặc lấy cứng từ `pkg.price`, hoàn toàn bỏ qua
multiplier động từ backend. Tính năng này bổ sung ba khu vực:

1. **/booking (CreateBookingPage)** — Hiển thị giá có nhân multiplier khi user chọn thời gian đặt chỗ.
2. **/membership (Membership)** — Hiển thị `adjustedPrice` cho từng gói, submit payment với giá đã điều chỉnh.
3. **/admin/pricing (PricingManagement)** — Mở rộng trang hiện tại với bốn tab Dynamic Pricing: cấu hình, rules, suggestions, history & stats.

`bookingPricing.js` **không thay đổi**. Multiplier chỉ được nhân ở tầng UI sau khi `calculateBookingPrice` trả về `usageAmount`.

---

## Glossary

- **PricingService**: Module frontend (`pricingService.js`) bao gồm tất cả các hàm gọi API `/api/pricing/*`.
- **DynamicPricingAPI**: Tập hợp các endpoint backend: `GET /api/pricing/current`, `GET|PUT /api/pricing/config`, `CRUD /api/pricing/rules`, `CRUD /api/pricing/suggestions`, `GET /api/pricing/history`, `GET /api/pricing/stats`.
- **CurrentPricingResponse**: Đối tượng trả về bởi `GET /api/pricing/current`, có dạng `{ data: { hourly: { multiplier, busynessScore, level, adjustedPrice, basePrice, priceLabel }, packages: [...] } }`.
- **Multiplier**: Hệ số giá động (`number`) từ `CurrentPricingResponse.data.hourly.multiplier`. Bằng `1.0` khi dynamic pricing không hoạt động.
- **AdjustedTotal**: Giá sau khi nhân multiplier, làm tròn xuống bội số 1.000 VND gần nhất: `Math.floor(baseTotal * multiplier / 1000) * 1000`.
- **AdjustedPrice**: Giá gói membership sau điều chỉnh, lấy trực tiếp từ `CurrentPricingResponse.data.packages[n].adjustedPrice`.
- **PricingRule**: Một bản ghi định nghĩa multiplier áp dụng khi điểm bận (`busynessScore`) nằm trong `[minScore, maxScore]`, có các trường: `label`, `minScore`, `maxScore`, `multiplier`, `priceType` (`hourly | package | all`), `packageId`, `isActive`.
- **PricingSuggestion**: Đề xuất điều chỉnh giá tự động từ engine, có trạng thái `pending | approved | rejected | expired`.
- **PricingConfig**: Cấu hình Dynamic Pricing với các trường: `isEnabled`, `pricingMode` (`manual | semi-auto | auto`), `triggerThreshold`, `rejectionCooldownMinutes`, `suggestionExpiryMinutes`.
- **PriceHistory**: Lịch sử thay đổi multiplier/giá, có `priceType`, `oldPrice`, `newPrice`, `busynessScore`, `level`, `adjustmentType`, `performedBy`.
- **PricingStats**: Thống kê tổng hợp: `adjustmentCount`, `averageAdjustmentPercent`, `distributionByLevel`.
- **apiFetch**: Hàm fetch wrapper hiện có, luôn resolve, trả về `{ ok, status, data }`.
- **BookingCart**: Giỏ hàng đặt chỗ trong `CreateBookingPage`, chứa các items với thời gian và slot đã chọn.
- **PriceBadge**: Badge hiển thị trạng thái giá — "Giá cao điểm" (cam/đỏ) khi `multiplier > 1.0`, "Giá ưu đãi" (xanh lá) khi `multiplier < 1.0`.

---

## Requirements

### Requirement 1: Tạo PricingService

**User Story:** As a frontend developer, I want a centralized pricing service module, so that all components can call Dynamic Pricing API in a consistent, reusable way.

#### Acceptance Criteria

1. THE `PricingService` SHALL export hàm `getCurrentPricing(options?)` gọi `GET /api/pricing/current` qua `apiFetch` và trả về `{ ok, data }`.
2. THE `PricingService` SHALL export hàm `getPricingConfig()` gọi `GET /api/pricing/config` và trả về `{ ok, data }`.
3. THE `PricingService` SHALL export hàm `updatePricingConfig(payload)` gọi `PUT /api/pricing/config` với body là `payload` và trả về `{ ok, data }`.
4. THE `PricingService` SHALL export hàm `getPricingRules(filters?)` gọi `GET /api/pricing/rules` với optional query params và trả về `{ ok, data }`.
5. THE `PricingService` SHALL export hàm `createPricingRule(payload)` gọi `POST /api/pricing/rules` và trả về `{ ok, data }`.
6. THE `PricingService` SHALL export hàm `updatePricingRule(id, payload)` gọi `PUT /api/pricing/rules/:id` và trả về `{ ok, data }`.
7. THE `PricingService` SHALL export hàm `deletePricingRule(id)` gọi `DELETE /api/pricing/rules/:id` và trả về `{ ok, data }`.
8. THE `PricingService` SHALL export hàm `getSuggestions(filters?)` gọi `GET /api/pricing/suggestions` và trả về `{ ok, data }`.
9. THE `PricingService` SHALL export hàm `approveSuggestion(id)` gọi `POST /api/pricing/suggestions/:id/approve` và trả về `{ ok, data }`.
10. THE `PricingService` SHALL export hàm `rejectSuggestion(id)` gọi `POST /api/pricing/suggestions/:id/reject` và trả về `{ ok, data }`.
11. THE `PricingService` SHALL export hàm `getPricingHistory(filters?)` gọi `GET /api/pricing/history` với optional query params và trả về `{ ok, data }`.
12. THE `PricingService` SHALL export hàm `getPricingStats(filters?)` gọi `GET /api/pricing/stats` với optional query params và trả về `{ ok, data }`.
13. WHEN `apiFetch` trả về `ok: false`, THE `PricingService` SHALL truyền nguyên vẹn `{ ok: false, data }` về phía gọi hàm mà không throw exception.

---

### Requirement 2: Hiển thị Dynamic Pricing tại trang /booking

**User Story:** As a customer, I want to see the adjusted price based on current demand when selecting my parking time, so that I can make an informed decision before confirming my booking.

#### Acceptance Criteria

1. WHEN user hoàn tất chọn `startTime` và `endTime`, THE `CreateBookingPage` SHALL gọi `getCurrentPricing()` để lấy `Multiplier` hiện tại.
2. WHILE `CreateBookingPage` đang chờ phản hồi từ `getCurrentPricing()`, THE `CreateBookingPage` SHALL hiển thị trạng thái loading cho phần giá mà không block tương tác người dùng.
3. WHEN `getCurrentPricing()` trả về thành công và `Multiplier ≠ 1.0`, THE `CreateBookingPage` SHALL hiển thị `PriceBadge` bên cạnh tổng giá.
4. WHEN `Multiplier > 1.0`, THE `PriceBadge` SHALL hiển thị nhãn "Giá cao điểm" với màu cam hoặc đỏ.
5. WHEN `Multiplier < 1.0`, THE `PriceBadge` SHALL hiển thị nhãn "Giá ưu đãi" với màu xanh lá.
6. THE `CreateBookingPage` SHALL tính `AdjustedTotal` bằng công thức `Math.floor(usageAmount * multiplier / 1000) * 1000`, trong đó `usageAmount` lấy từ `calculateBookingPrice()` hiện có, không thay đổi `bookingPricing.js`.
7. WHEN `Multiplier ≠ 1.0`, THE `CreateBookingPage` SHALL hiển thị `usageAmount` gốc bị gạch ngang (strikethrough) và `AdjustedTotal` nổi bật bên cạnh trong phần tóm tắt giá (cart/quote).
8. WHEN user mở confirmation modal trước khi submit, THE confirmation modal SHALL hiển thị `AdjustedTotal` thay vì `usageAmount` gốc.
9. IF `getCurrentPricing()` trả về `ok: false` hoặc timeout sau 5 giây, THEN THE `CreateBookingPage` SHALL fallback về hiển thị `usageAmount` gốc và không block luồng đặt chỗ.
10. WHEN `getCurrentPricing()` thất bại, THE `CreateBookingPage` SHALL KHÔNG hiển thị `PriceBadge`.
11. WHEN user thay đổi `startTime` hoặc `endTime` sau khi đã lấy multiplier, THE `CreateBookingPage` SHALL gọi lại `getCurrentPricing()` để cập nhật `Multiplier` mới.

---

### Requirement 3: Round-trip price display (booking)

**User Story:** As a developer, I want the price display to remain consistent from selection through confirmation, so that the customer always sees the same price they agreed to.

#### Acceptance Criteria

1. THE `AdjustedTotal` hiển thị ở cart summary SHALL bằng `AdjustedTotal` hiển thị trong confirmation modal với cùng `startTime`, `endTime`, và `Multiplier`.
2. WHEN `Multiplier = 1.0`, THE `AdjustedTotal` SHALL bằng `usageAmount` (không có sự chênh lệch do làm tròn nếu `usageAmount` đã là bội số 1.000 VND).
3. THE `CreateBookingPage` SHALL làm tròn `AdjustedTotal` bằng `Math.floor(x / 1000) * 1000` một lần duy nhất tại điểm tính toán, không làm tròn nhiều lần.

---

### Requirement 4: Hiển thị Dynamic Pricing tại trang /membership

**User Story:** As a customer, I want to see if membership package prices have been adjusted by dynamic pricing, so that I can benefit from discounted prices or be aware of peak-time surcharges.

#### Acceptance Criteria

1. WHEN `Membership` component được mount, THE `Membership` SHALL gọi `getCurrentPricing()` đồng thời với các lần fetch dữ liệu hiện có (parallel).
2. WHEN `getCurrentPricing()` trả về thành công, THE `Membership` SHALL hiển thị `adjustedPrice` từ `CurrentPricingResponse.data.packages` tương ứng với từng `pkg._id`.
3. WHEN `adjustedPrice ≠ pkg.price` (giá gốc), THE `Membership` SHALL hiển thị `pkg.price` bị gạch ngang (strikethrough) và `adjustedPrice` nổi bật.
4. WHEN `adjustedPrice < pkg.price`, THE `Membership` SHALL hiển thị nhãn "Giá ưu đãi" màu xanh lá trên card gói tương ứng.
5. WHEN `adjustedPrice > pkg.price`, THE `Membership` SHALL hiển thị nhãn "Giá cao điểm" màu cam hoặc đỏ trên card gói tương ứng.
6. WHEN user xác nhận mua gói và `getCurrentPricing()` đã thành công, THE `Membership` SHALL gửi `adjustedPrice` thay vì `pkg.price` cứng trong payload payment.
7. IF `getCurrentPricing()` trả về `ok: false`, THEN THE `Membership` SHALL hiển thị `pkg.price` gốc và submit payment với `pkg.price` gốc (graceful fallback).
8. WHEN `adjustedPrice = pkg.price`, THE `Membership` SHALL hiển thị giá bình thường, không hiển thị label hay strikethrough.

---

### Requirement 5: Trang /admin/pricing — Tab Dynamic Pricing (cấu hình)

**User Story:** As an admin, I want to enable/disable dynamic pricing and configure its operating mode, so that I can control when and how prices are adjusted automatically.

#### Acceptance Criteria

1. THE `PricingManagement` SHALL thêm hệ thống tab, giữ nguyên nội dung tab hiện tại (Time Blocks) làm tab đầu tiên, và thêm bốn tab mới: "Dynamic Pricing", "Pricing Rules", "Suggestions", "History & Stats".
2. WHEN admin chọn tab "Dynamic Pricing", THE `PricingManagement` SHALL gọi `getPricingConfig()` để lấy `PricingConfig` hiện tại.
3. THE tab "Dynamic Pricing" SHALL hiển thị toggle bật/tắt (`isEnabled`) với trạng thái hiện tại từ `PricingConfig`.
4. THE tab "Dynamic Pricing" SHALL hiển thị selector chọn `pricingMode` với ba lựa chọn: "Manual", "Semi-auto", "Auto".
5. THE tab "Dynamic Pricing" SHALL hiển thị các trường số: `triggerThreshold` (1–50), `rejectionCooldownMinutes` (≥1), `suggestionExpiryMinutes` (≥1).
6. WHEN admin thay đổi bất kỳ trường nào và nhấn Save, THE tab "Dynamic Pricing" SHALL gọi `updatePricingConfig(payload)` với các giá trị đã thay đổi.
7. WHEN `updatePricingConfig()` trả về thành công, THE tab "Dynamic Pricing" SHALL hiển thị thông báo thành công và cập nhật trạng thái hiển thị.
8. IF `updatePricingConfig()` trả về `ok: false`, THEN THE tab "Dynamic Pricing" SHALL hiển thị thông báo lỗi từ `data.message` mà không mất dữ liệu form.

---

### Requirement 6: Trang /admin/pricing — Tab Pricing Rules (CRUD)

**User Story:** As an admin, I want to create, edit, and delete pricing rules that define multipliers for different demand levels, so that I can fine-tune the pricing strategy.

#### Acceptance Criteria

1. WHEN admin chọn tab "Pricing Rules", THE `PricingManagement` SHALL gọi `getPricingRules()` và hiển thị danh sách các `PricingRule` hiện có.
2. THE tab "Pricing Rules" SHALL hiển thị mỗi rule với các thông tin: `label`, `minScore`–`maxScore`, `multiplier`, `priceType`, `isActive`.
3. WHEN admin nhấn nút "Add Rule", THE tab "Pricing Rules" SHALL mở form tạo rule mới với các trường: `label` (required), `minScore` (0–99), `maxScore` (1–100, phải > `minScore`), `multiplier` (0.5–3.0), `priceType`, `packageId` (hiển thị khi `priceType = package`).
4. WHEN admin submit form tạo rule hợp lệ, THE tab "Pricing Rules" SHALL gọi `createPricingRule(payload)` và refresh danh sách sau khi thành công.
5. WHEN admin nhấn nút Edit trên một rule, THE tab "Pricing Rules" SHALL mở form chỉnh sửa với dữ liệu hiện tại của rule đó.
6. WHEN admin submit form chỉnh sửa hợp lệ, THE tab "Pricing Rules" SHALL gọi `updatePricingRule(id, payload)` và refresh danh sách sau khi thành công.
7. WHEN admin nhấn nút Delete trên một rule, THE tab "Pricing Rules" SHALL hiển thị dialog xác nhận trước khi gọi `deletePricingRule(id)`.
8. WHEN admin xác nhận xóa, THE tab "Pricing Rules" SHALL gọi `deletePricingRule(id)` và xóa rule khỏi danh sách hiển thị sau khi thành công.
9. IF bất kỳ thao tác CRUD nào trả về `ok: false`, THEN THE tab "Pricing Rules" SHALL hiển thị thông báo lỗi từ `data.message` mà không đóng form.

---

### Requirement 7: Trang /admin/pricing — Tab Suggestions

**User Story:** As an admin, I want to review and approve or reject pricing suggestions generated by the system, so that I can maintain control over automatic price adjustments in semi-auto mode.

#### Acceptance Criteria

1. WHEN admin chọn tab "Suggestions", THE `PricingManagement` SHALL gọi `getSuggestions()` và hiển thị danh sách các `PricingSuggestion`.
2. THE tab "Suggestions" SHALL hiển thị mỗi suggestion với: `priceType`, `suggestedPrice`, `basePrice`, `busynessScore`, `level`, `status`, `validUntil`.
3. THE tab "Suggestions" SHALL hỗ trợ lọc danh sách theo `status` (`pending`, `approved`, `rejected`, `expired`).
4. WHEN admin nhấn "Approve" trên một `pending` suggestion, THE tab "Suggestions" SHALL gọi `approveSuggestion(id)` và cập nhật trạng thái suggestion trong danh sách.
5. WHEN admin nhấn "Reject" trên một `pending` suggestion, THE tab "Suggestions" SHALL gọi `rejectSuggestion(id)` và cập nhật trạng thái suggestion trong danh sách.
6. IF `approveSuggestion()` hoặc `rejectSuggestion()` trả về `ok: false`, THEN THE tab "Suggestions" SHALL hiển thị thông báo lỗi từ `data.message` mà không thay đổi trạng thái hiển thị của suggestion.
7. WHEN suggestion có `status ≠ pending`, THE tab "Suggestions" SHALL vô hiệu hóa (disable) các nút "Approve" và "Reject" tương ứng.

---

### Requirement 8: Trang /admin/pricing — Tab History & Stats

**User Story:** As an admin, I want to view the history of price changes and aggregated statistics, so that I can audit and understand pricing trends over time.

#### Acceptance Criteria

1. WHEN admin chọn tab "History & Stats", THE `PricingManagement` SHALL gọi đồng thời `getPricingHistory()` và `getPricingStats()`.
2. THE tab "History & Stats" SHALL hiển thị danh sách `PriceHistory` với các thông tin: `priceType`, `oldPrice`, `newPrice`, `busynessScore`, `level`, `adjustmentType`, `createdAt`.
3. THE tab "History & Stats" SHALL hiển thị phần thống kê từ `PricingStats`: `adjustmentCount`, `averageAdjustmentPercent`, `distributionByLevel`.
4. THE tab "History & Stats" SHALL hỗ trợ lọc `PriceHistory` theo khoảng thời gian (`from`, `to`) và gọi lại `getPricingHistory({ from, to })` khi filter thay đổi.
5. IF `getPricingHistory()` hoặc `getPricingStats()` trả về `ok: false`, THEN THE tab "History & Stats" SHALL hiển thị thông báo lỗi phù hợp cho từng phần, phần kia vẫn hiển thị bình thường nếu thành công.

---

### Requirement 9: Graceful fallback toàn hệ thống

**User Story:** As a customer, I want the booking and membership flows to work normally even when the dynamic pricing API is unavailable, so that I can still complete my transaction without interruption.

#### Acceptance Criteria

1. IF `getCurrentPricing()` không phản hồi trong vòng 5 giây, THEN THE `PricingService` SHALL resolve với `{ ok: false, data: null }` thay vì để request treo.
2. WHEN `getCurrentPricing()` trả về `ok: false` tại `/booking`, THE `CreateBookingPage` SHALL sử dụng `multiplier = 1.0` và hiển thị `usageAmount` gốc mà không báo lỗi cho người dùng.
3. WHEN `getCurrentPricing()` trả về `ok: false` tại `/membership`, THE `Membership` SHALL sử dụng `pkg.price` gốc cho tất cả các gói mà không báo lỗi cho người dùng.
4. THE `PricingService` SHALL không throw exception trong bất kỳ trường hợp nào; mọi lỗi đều được bắt và trả về `{ ok: false, data: null }`.
5. WHEN `PricingService` gặp lỗi network (status 0 từ `apiFetch`), THE `PricingService` SHALL log lỗi vào console và trả về `{ ok: false, data: null }`.

---

### Requirement 10: Không cài thêm thư viện

**User Story:** As a developer, I want the integration to use only existing project dependencies, so that the bundle size and dependency surface remain unchanged.

#### Acceptance Criteria

1. THE `PricingService` SHALL chỉ sử dụng `apiFetch` từ `frontend/src/services/api.js` để gọi API, không import axios, react-query, swr, hoặc bất kỳ HTTP client nào khác.
2. THE `CreateBookingPage`, THE `Membership`, và THE `PricingManagement` SHALL không import thêm bất kỳ package nào ngoài các package đã có trong `package.json` của frontend.
3. THE `PricingService` SHALL sử dụng `AbortController` và `setTimeout` có sẵn trong browser để implement timeout 5 giây, không dùng thư viện nào.

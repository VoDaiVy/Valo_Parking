# Implementation Plan: Dynamic Pricing Web Integration

## Overview

Tích hợp Dynamic Pricing vào ba khu vực frontend: trang `/booking`, trang `/membership`, và trang `/admin/pricing`. Thực hiện theo thứ tự: service layer → hook → UI components.

## Tasks

- [ ] 1. Tạo `pricingService.js`
  - [ ] 1.1 Tạo file `frontend/src/services/pricingService.js` với 12 hàm export
    - Theo pattern của `bookingService.js` và `subscriptionService.js`
    - `getCurrentPricing(options?)`: `GET /api/pricing/current`, tự quản lý `AbortController` + `setTimeout(5000)` khi không có `signal` truyền vào, wrap toàn bộ trong try/catch, trả về `{ ok: false, data: null }` khi có lỗi hoặc timeout
    - `getPricingConfig()`: `GET /api/pricing/config`
    - `updatePricingConfig(payload)`: `PUT /api/pricing/config`
    - `getPricingRules(filters?)`: `GET /api/pricing/rules` với optional query params
    - `createPricingRule(payload)`: `POST /api/pricing/rules`
    - `updatePricingRule(id, payload)`: `PUT /api/pricing/rules/:id`
    - `deletePricingRule(id)`: `DELETE /api/pricing/rules/:id`
    - `getSuggestions(filters?)`: `GET /api/pricing/suggestions` với optional query params
    - `approveSuggestion(id)`: `POST /api/pricing/suggestions/:id/approve`
    - `rejectSuggestion(id)`: `POST /api/pricing/suggestions/:id/reject`
    - `getPricingHistory(filters?)`: `GET /api/pricing/history` với optional query params
    - `getPricingStats(filters?)`: `GET /api/pricing/stats` với optional query params
    - Mọi hàm không bao giờ throw; tất cả lỗi được bắt và trả về `{ ok: false, data: null }`
    - _Requirements: 1.1–1.13, 9.4, 9.5, 10.1, 10.3_

  - [ ]* 1.2 Viết unit tests cho `pricingService.js`
    - File: `frontend/src/services/__tests__/pricingService.test.js`
    - Mock `apiFetch`, kiểm tra tất cả 12 hàm gọi đúng endpoint và method
    - Kiểm tra `ok: false` pass-through không throw
    - Test timeout: mock fetch delay > 5s → resolve `{ ok: false, data: null }`
    - _Requirements: 1.1–1.13_

  - [ ]* 1.3 Viết property test cho `pricingService.js`
    - File: `frontend/src/services/__tests__/pricingService.property.test.js`
    - **Property 4: pricingService luôn resolve, không bao giờ throw**
    - **Validates: Requirements 1.13, 9.4**
    - **Property 10: getCurrentPricing timeout 5 giây**
    - **Validates: Requirements 9.1, 10.3**
    - _Requirements: 1.13, 9.1, 9.4, 10.3_

- [ ] 2. Tạo `useDynamicPricing` hook và `computeAdjustedTotal`
  - [ ] 2.1 Tạo file `frontend/src/hooks/useDynamicPricing.js`
    - Interface: `useDynamicPricing(startTime, endTime)` → `{ multiplier, busynessScore, level, priceLabel, loading, error, computeAdjustedTotal }`
    - State mặc định: `multiplier = 1.0`, `loading = false`, `error = false`
    - Debounce 300ms dùng `useRef` + `setTimeout` khi `startTime` hoặc `endTime` thay đổi
    - Mỗi lần fetch mới: cancel `AbortController` cũ, tạo `AbortController` mới
    - `computeAdjustedTotal(usageAmount)` = `Math.floor(usageAmount * multiplier / 1000) * 1000`
    - Khi `ok: false`: set `multiplier = 1.0`, `error = true`, `loading = false`
    - Cleanup `AbortController` khi unmount
    - Không gọi API khi `startTime` hoặc `endTime` là null/falsy
    - _Requirements: 2.1, 2.2, 2.6, 2.9, 2.11, 9.1, 9.2, 10.3_

  - [ ]* 2.2 Viết property tests cho `computeAdjustedTotal`
    - File: `frontend/src/hooks/__tests__/computeAdjustedTotal.property.test.js`
    - **Property 1: AdjustedTotal formula correctness** — 100 iterations với random `(usageAmount, multiplier)`
    - **Validates: Requirements 2.6, 3.3**
    - **Property 2: AdjustedTotal rounding idempotence** — `computeAdjustedTotal(computeAdjustedTotal(x)) === computeAdjustedTotal(x)`
    - **Validates: Requirements 3.3**
    - **Property 3: Multiplier = 1.0 khi API thất bại** — khi error, `computeAdjustedTotal(x) = Math.floor(x/1000)*1000`
    - **Validates: Requirements 2.9, 9.1, 9.2**
    - _Requirements: 2.6, 3.3, 9.2_

  - [ ]* 2.3 Viết unit tests cho `useDynamicPricing` hook
    - File: `frontend/src/hooks/__tests__/useDynamicPricing.test.js`
    - `startTime`/`endTime` null → `loading=false`, `multiplier=1.0`, không gọi API
    - API success với `multiplier=1.5` → state cập nhật đúng
    - API failure → `multiplier=1.0`, `error=true`
    - Debounce: thay đổi nhanh → chỉ 1 request thực sự được gửi
    - _Requirements: 2.1, 2.9, 2.11_

- [ ] 3. Checkpoint — Đảm bảo tất cả tests pass
  - Chạy `vitest --run` để kiểm tra service và hook tests
  - Hỏi user nếu có vấn đề phát sinh.

- [ ] 4. Tích hợp Dynamic Pricing vào `CreateBookingPage.jsx`
  - [ ] 4.1 Thêm `PriceBadge` component và tích hợp `useDynamicPricing` vào `CreateBookingPage`
    - Import `useDynamicPricing` từ `../../hooks/useDynamicPricing`
    - Gọi hook với `startTime`, `endTime` từ state hiện có của trang
    - Tạo `PriceBadge` component inline (hoặc tách file nhỏ `PriceBadge.jsx`):
      - `multiplier > 1.0`: label "Giá cao điểm", class màu cam/đỏ (Tailwind: `bg-orange-100 text-orange-700` hoặc tương tự)
      - `multiplier < 1.0`: label "Giá ưu đãi", class màu xanh lá (`bg-green-100 text-green-700`)
      - `multiplier === 1.0`: render null
    - _Requirements: 2.3, 2.4, 2.5, 10.2_

  - [ ] 4.2 Cập nhật cart summary để hiển thị `AdjustedTotal`
    - Tính `adjustedTotal = computeAdjustedTotal(usageAmount)` từ hook
    - Khi `multiplier !== 1.0`: hiển thị `usageAmount` gốc với strikethrough + `adjustedTotal` nổi bật + `PriceBadge`
    - Khi `loading = true`: hiển thị skeleton/spinner chỉ cho phần giá, không block form
    - Khi `error = true` hoặc `multiplier === 1.0`: hiển thị `usageAmount` gốc bình thường, ẩn PriceBadge
    - _Requirements: 2.2, 2.7, 2.9, 2.10, 3.1, 3.3_

  - [ ] 4.3 Cập nhật confirmation modal để dùng `adjustedTotal`
    - Trong modal xác nhận trước khi submit: hiển thị `adjustedTotal` thay vì `usageAmount` gốc
    - `adjustedTotal` phải nhất quán với giá trị đã hiển thị ở cart summary (cùng `computeAdjustedTotal` call)
    - _Requirements: 2.8, 3.1_

  - [ ]* 4.4 Viết property test cho `PriceBadge`
    - File: `frontend/src/components/__tests__/priceBadge.property.test.js` (hoặc nơi phù hợp)
    - **Property 5: PriceBadge hiển thị đúng theo multiplier** — 100 iterations với random multiplier trong [0.5, 3.0]
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.7**
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ]* 4.5 Viết property test cho AdjustedTotal nhất quán giữa cart và modal
    - File: `frontend/src/pages/Customer/__tests__/createBookingPage.property.test.js`
    - **Property 6: AdjustedTotal nhất quán giữa cart và modal** — với cùng `(startTime, endTime, multiplier)`, giá trị trong cart === giá trị trong modal
    - **Validates: Requirements 2.8, 3.1**
    - _Requirements: 2.8, 3.1_

- [ ] 5. Tích hợp Dynamic Pricing vào `Membership.jsx`
  - [ ] 5.1 Thêm parallel fetch `getCurrentPricing()` trong `Membership`
    - Import `getCurrentPricing` từ `../../services/pricingService`
    - Thay `getTicketPackages()` đơn lẻ bằng `Promise.all([getTicketPackages(), getCurrentPricing()])`
    - Build `packagePriceMap = new Map(packages.map(p => [p._id.toString(), { adjustedPrice: p.adjustedPrice, priceLabel: p.priceLabel }]))` từ `CurrentPricingResponse.data.packages`
    - Khi `getCurrentPricing()` trả về `ok: false`: `packagePriceMap` là `Map` rỗng (fallback về `pkg.price`)
    - _Requirements: 4.1, 4.7, 9.3, 10.2_

  - [ ] 5.2 Cập nhật render card gói membership với `adjustedPrice`
    - Với mỗi `pkg`: lấy `{ adjustedPrice, priceLabel } = packagePriceMap.get(pkg._id.toString()) ?? {}`
    - `adjustedPrice < pkg.price`: strikethrough `pkg.price` + `adjustedPrice` nổi bật + badge "Giá ưu đãi" (xanh)
    - `adjustedPrice > pkg.price`: strikethrough `pkg.price` + `adjustedPrice` nổi bật + badge "Giá cao điểm" (cam/đỏ)
    - `adjustedPrice === pkg.price` hoặc không có `adjustedPrice`: hiển thị bình thường
    - Payment payload: `packagePriceMap.get(pkg._id.toString())?.adjustedPrice ?? pkg.price`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]* 5.3 Viết property test cho membership price display
    - File: `frontend/src/pages/Customer/__tests__/membershipPriceDisplay.property.test.js`
    - **Property 7: Payment price selection cho membership** — nếu API success thì payload dùng `adjustedPrice`; nếu API fail thì payload dùng `pkg.price`
    - **Validates: Requirements 4.6, 4.7, 9.3**
    - **Property 8: Membership price display theo adjustedPrice** — 100 iterations với random `(basePrice, adjustedPrice)`
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.8**
    - _Requirements: 4.2–4.8, 9.3_

- [ ] 6. Mở rộng `PricingManagement.jsx` — Tab system và Tab Dynamic Pricing
  - [ ] 6.1 Thêm tab navigation vào `PricingManagement`
    - Giữ nguyên toàn bộ nội dung hiện tại làm tab "Time Blocks" (tab đầu tiên)
    - Thêm 4 tab mới: "Dynamic Pricing", "Pricing Rules", "Suggestions", "History & Stats"
    - State `activeTab` quản lý tab đang hiển thị, mặc định là "Time Blocks"
    - _Requirements: 5.1_

  - [ ] 6.2 Implement tab "Dynamic Pricing" (config)
    - Khi tab được chọn: gọi `getPricingConfig()` để lấy config hiện tại
    - Hiển thị: toggle `isEnabled`, selector `pricingMode` (Manual/Semi-auto/Auto), số `triggerThreshold` (1–50), `rejectionCooldownMinutes` (≥1), `suggestionExpiryMinutes` (≥1)
    - Nút Save: gọi `updatePricingConfig(payload)`, hiển thị success toast hoặc inline error từ `data.message`
    - Khi `getPricingConfig()` fail: hiển thị inline error alert, form không load
    - _Requirements: 5.2–5.8_

- [ ] 7. Implement tab "Pricing Rules" trong `PricingManagement`
  - [ ] 7.1 Implement danh sách Pricing Rules
    - Khi tab được chọn: gọi `getPricingRules()`, hiển thị bảng với các cột: `label`, `minScore`–`maxScore`, `multiplier`, `priceType`, `isActive`
    - _Requirements: 6.1, 6.2_

  - [ ] 7.2 Implement form Add/Edit Rule
    - Nút "Add Rule": mở modal/form với các trường: `label` (required), `minScore` (0–99), `maxScore` (1–100, > `minScore`), `multiplier` (0.5–3.0), `priceType`, `packageId` (chỉ hiện khi `priceType === "package"`)
    - Submit tạo mới: gọi `createPricingRule(payload)`, refresh danh sách sau khi thành công
    - Nút Edit: mở form với dữ liệu hiện tại, submit gọi `updatePricingRule(id, payload)`, refresh sau thành công
    - CRUD errors: hiển thị `data.message` trong modal, không đóng modal
    - _Requirements: 6.3–6.6, 6.9_

  - [ ] 7.3 Implement Delete Rule với confirmation
    - Nút Delete: hiển thị dialog xác nhận trước khi gọi `deletePricingRule(id)`
    - Sau khi xác nhận và thành công: xóa rule khỏi danh sách
    - _Requirements: 6.7, 6.8, 6.9_

- [ ] 8. Implement tab "Suggestions" trong `PricingManagement`
  - [ ] 8.1 Implement danh sách Suggestions với filter
    - Khi tab được chọn: gọi `getSuggestions()`, hiển thị bảng với: `priceType`, `suggestedPrice`, `basePrice`, `busynessScore`, `level`, `status`, `validUntil`
    - Filter theo `status` (pending/approved/rejected/expired): gọi lại `getSuggestions({ status })` khi filter thay đổi
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ] 8.2 Implement Approve/Reject actions
    - Nút "Approve" (chỉ enable khi `status === "pending"`): gọi `approveSuggestion(id)`, cập nhật trạng thái suggestion trong danh sách
    - Nút "Reject" (chỉ enable khi `status === "pending"`): gọi `rejectSuggestion(id)`, cập nhật trạng thái suggestion
    - Khi thất bại: hiển thị `data.message` inline, không thay đổi trạng thái hiển thị
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

- [ ] 9. Implement tab "History & Stats" trong `PricingManagement`
  - [ ] 9.1 Implement History & Stats với parallel fetch
    - Khi tab được chọn: gọi đồng thời `getPricingHistory()` và `getPricingStats()`
    - Bảng history: `priceType`, `oldPrice`, `newPrice`, `busynessScore`, `level`, `adjustmentType`, `createdAt`
    - Stats cards: `adjustmentCount`, `averageAdjustmentPercent`, `distributionByLevel`
    - Hai phần hiển thị lỗi độc lập (phần kia vẫn render nếu thành công)
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [ ] 9.2 Implement date range filter cho History
    - Thêm input `from` và `to` (date) để lọc history
    - Khi filter thay đổi: gọi lại `getPricingHistory({ from, to })`
    - _Requirements: 8.4_

  - [ ]* 9.3 Viết property test cho History date range filter
    - File: `frontend/src/pages/Admin/__tests__/historyFilter.property.test.js`
    - **Property 9: History date range filter** — tất cả bản ghi trong kết quả phải có `createdAt` trong `[from, to]`
    - **Validates: Requirements 8.4**
    - _Requirements: 8.4_

- [ ] 10. Final checkpoint — Đảm bảo tất cả tests pass
  - Chạy `vitest --run` để kiểm tra toàn bộ test suite
  - Hỏi user nếu có vấn đề phát sinh.

## Notes

- Tasks có `*` là optional, có thể bỏ qua cho MVP nhanh hơn
- Mỗi property test chạy tối thiểu 100 iterations với random inputs
- Property tests không dùng thư viện ngoài, implement thủ công với `Array.from({ length: 100 }, ...)`
- `bookingPricing.js` không được thay đổi; multiplier chỉ được áp dụng tại tầng UI
- Tất cả API calls qua `apiFetch` từ `frontend/src/services/api.js`

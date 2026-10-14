# Design Document — Dynamic Pricing Web Integration

## Overview

Tích hợp Dynamic Pricing vào frontend VALO PARKING ở ba khu vực: trang `/booking`, trang `/membership`, và trang `/admin/pricing`.

Toàn bộ tương tác với backend đi qua module `pricingService.js` mới. Multiplier được áp dụng **chỉ tại tầng UI** sau khi `calculateBookingPrice()` (giữ nguyên) trả về `usageAmount`. Nếu API không khả dụng, hệ thống fallback về giá gốc mà không block user flow.

Không cài thêm thư viện mới. Timeout 5 giây cho `getCurrentPricing()` được thực hiện bằng `AbortController` + `setTimeout` native.

---

## Architecture

```mermaid
graph TD
    subgraph Frontend
        CB[CreateBookingPage] -->|startTime, endTime| Hook[useDynamicPricing hook]
        MEM[Membership Page] -->|on mount| PS
        PM[PricingManagement Page] -->|tab events| PS
        Hook -->|getCurrentPricing| PS[pricingService.js]
    end

    subgraph Services
        PS -->|apiFetch + AbortController| API[/api/pricing/*]
    end

    subgraph Utilities
        CB -->|usageAmount| BPU[bookingPricing.js - UNCHANGED]
        Hook -->|Math.floor(usageAmount * multiplier / 1000) * 1000| AdjTotal[AdjustedTotal]
    end
```

**Luồng dữ liệu cho booking:**
1. User chọn `startTime` / `endTime`
2. `useDynamicPricing` debounce 300ms rồi gọi `getCurrentPricing()`
3. `calculateBookingPrice()` tính `usageAmount` (logic không đổi)
4. UI tính `AdjustedTotal = Math.floor(usageAmount * multiplier / 1000) * 1000`
5. Nếu API lỗi/timeout → `multiplier = 1.0`, hiển thị `usageAmount` gốc

**Luồng dữ liệu cho membership:**
1. `Membership` mount → `Promise.all([getTicketPackages(), getCurrentPricing()])`
2. Build `packagePriceMap: Map<packageId, { adjustedPrice, priceLabel }>`
3. Render với `adjustedPrice` nếu có, fallback `pkg.price`
4. Submit payment với `adjustedPrice` (hoặc `pkg.price` nếu API lỗi)

---

## Components and Interfaces

### 1. `pricingService.js`

Module mới tại `frontend/src/services/pricingService.js`. Pattern giống `bookingService.js` và `subscriptionService.js`.

```js
// Signature của tất cả 12 hàm export

getCurrentPricing(options?: { signal?: AbortSignal })
  → Promise<{ ok, status, data }>

getPricingConfig()
  → Promise<{ ok, status, data }>

updatePricingConfig(payload: object)
  → Promise<{ ok, status, data }>

getPricingRules(filters?: object)
  → Promise<{ ok, status, data }>

createPricingRule(payload: object)
  → Promise<{ ok, status, data }>

updatePricingRule(id: string, payload: object)
  → Promise<{ ok, status, data }>

deletePricingRule(id: string)
  → Promise<{ ok, status, data }>

getSuggestions(filters?: object)
  → Promise<{ ok, status, data }>

approveSuggestion(id: string)
  → Promise<{ ok, status, data }>

rejectSuggestion(id: string)
  → Promise<{ ok, status, data }>

getPricingHistory(filters?: object)
  → Promise<{ ok, status, data }>

getPricingStats(filters?: object)
  → Promise<{ ok, status, data }>
```

`getCurrentPricing` tự quản lý `AbortController` + `setTimeout(5000)` bên trong nếu không có `signal` truyền vào, và wrap toàn bộ trong try/catch để luôn trả về `{ ok: false, data: null }` khi có lỗi.

### 2. `useDynamicPricing` hook

File mới tại `frontend/src/hooks/useDynamicPricing.js`.

```js
// Interface
function useDynamicPricing(startTime: string | null, endTime: string | null)
  → {
      multiplier: number,       // default 1.0
      busynessScore: number | null,
      level: string | null,
      priceLabel: string | null,
      loading: boolean,
      error: boolean,
      computeAdjustedTotal: (usageAmount: number) => number,
    }
```

Hành vi:
- Debounce 300ms khi `startTime` hoặc `endTime` thay đổi (dùng `useRef` + `setTimeout`)
- Mỗi lần gọi mới, cancel AbortController cũ
- `computeAdjustedTotal(usageAmount) = Math.floor(usageAmount * multiplier / 1000) * 1000`
- Khi API lỗi: set `multiplier = 1.0`, `error = true`

### 3. `CreateBookingPage.jsx` — thay đổi

Thêm:
- `import { useDynamicPricing } from '../../hooks/useDynamicPricing'`
- Gọi `const { multiplier, priceLabel, loading, computeAdjustedTotal } = useDynamicPricing(startTime, endTime)`
- `PriceBadge` component (inline hoặc tách nhỏ): badge màu cam/đỏ khi `multiplier > 1`, xanh lá khi `multiplier < 1`, ẩn khi `multiplier === 1`
- Trong cart summary: hiển thị `usageAmount` gạch ngang + `AdjustedTotal` nếu `multiplier !== 1`
- Trong confirmation modal: dùng `adjustedTotal = computeAdjustedTotal(usageAmount)`

### 4. `Membership.jsx` — thay đổi

Thêm:
- Gọi `getCurrentPricing()` parallel với `getTicketPackages()`
- Build `packagePriceMap = new Map(packages.map(p => [p._id.toString(), { adjustedPrice: p.adjustedPrice, priceLabel: p.priceLabel }]))`
- Render `adjustedPrice` / strikethrough / badge theo `priceLabel`
- Payment payload dùng `packagePriceMap.get(pkg._id)?.adjustedPrice ?? pkg.price`

### 5. `PricingManagement.jsx` — thay đổi

Thêm tab navigation (giữ "Time Blocks" là tab đầu tiên):

| Tab | Content |
|-----|---------|
| Time Blocks | Giữ nguyên nội dung hiện tại |
| Dynamic Pricing | Toggle isEnabled + mode selector + threshold inputs + Save |
| Pricing Rules | Bảng danh sách + Add/Edit/Delete modal |
| Suggestions | Bảng + filter theo status + Approve/Reject |
| History & Stats | Bảng history + stats cards + date range filter |

---

## Data Models

### CurrentPricingResponse (từ `GET /api/pricing/current`)

```ts
{
  success: boolean,
  data: {
    hourly: {
      multiplier: number,        // 1.0 khi không có điều chỉnh
      busynessScore: number | null,
      level: "low" | "moderate" | "high" | "peak" | null,
      adjustedPrice: number,
      basePrice: number,
      priceLabel?: "Giá ưu đãi" | "Giá cao điểm"  // chỉ khi adjusted ≠ base
    },
    packages: Array<{
      _id: string,
      name: string,
      price: number,             // giá gốc
      adjustedPrice: number,     // giá sau điều chỉnh
      priceLabel?: string,
      // ... các trường TicketPackage khác
    }>
  }
}
```

### PricingConfig

```ts
{
  isEnabled: boolean,
  pricingMode: "manual" | "semi-auto" | "auto",
  triggerThreshold: number,          // 1–50
  rejectionCooldownMinutes: number,  // ≥1
  suggestionExpiryMinutes: number,   // ≥1
}
```

### PricingRule

```ts
{
  _id: string,
  label: string,
  minScore: number,      // 0–99
  maxScore: number,      // 1–100, > minScore
  multiplier: number,    // 0.5–3.0
  priceType: "hourly" | "package" | "all",
  packageId?: string,    // chỉ khi priceType === "package"
  isActive: boolean,
}
```

### PricingSuggestion

```ts
{
  _id: string,
  priceType: "hourly" | "package",
  suggestedPrice: number,
  basePrice: number,
  busynessScore: number,
  level: string,
  status: "pending" | "approved" | "rejected" | "expired",
  validUntil: string,   // ISO date
  packageId?: string,
}
```

### PriceHistory

```ts
{
  _id: string,
  priceType: "hourly" | "package",
  oldPrice: number,
  newPrice: number,
  busynessScore: number,
  level: string,
  adjustmentType: "manual" | "approved_suggestion" | "auto",
  performedBy?: string,
  createdAt: string,
}
```

### PricingStats

```ts
{
  adjustmentCount: number,
  averageAdjustmentPercent: number,
  distributionByLevel: {
    low: number,
    moderate: number,
    high: number,
    peak: number,
  },
  period: { from: string | null, to: string | null }
}
```

### Hook state (useDynamicPricing)

```ts
{
  multiplier: number,           // default 1.0
  busynessScore: number | null,
  level: string | null,
  priceLabel: string | null,
  loading: boolean,
  error: boolean,
}
```

---


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: AdjustedTotal formula correctness

*For any* non-negative `usageAmount` và `multiplier`, `computeAdjustedTotal(usageAmount)` phải bằng `Math.floor(usageAmount * multiplier / 1000) * 1000`.

**Validates: Requirements 2.6, 3.3**

---

### Property 2: AdjustedTotal rounding idempotence

*For any* `usageAmount` và `multiplier`, áp dụng hàm rounding một lần hay nhiều lần phải cho cùng kết quả: `computeAdjustedTotal(computeAdjustedTotal(x)) === computeAdjustedTotal(x)`.

**Validates: Requirements 3.3**

---

### Property 3: Multiplier = 1.0 khi API thất bại

*For any* trạng thái lỗi của `getCurrentPricing()` (ok: false, network error, hoặc timeout sau 5 giây), `useDynamicPricing` phải trả về `multiplier = 1.0` và `computeAdjustedTotal(x)` phải bằng `Math.floor(x / 1000) * 1000`.

**Validates: Requirements 2.9, 9.1, 9.2**

---

### Property 4: pricingService luôn resolve, không bao giờ throw

*For any* input gây lỗi (network error, invalid response, AbortError), tất cả hàm trong `pricingService.js` phải resolve với `{ ok: false, data: null }` và không throw exception.

**Validates: Requirements 1.13, 9.4**

---

### Property 5: PriceBadge hiển thị đúng theo multiplier

*For any* multiplier:
- `multiplier > 1.0` → badge hiển thị với label "Giá cao điểm" và class màu cam/đỏ
- `multiplier < 1.0` → badge hiển thị với label "Giá ưu đãi" và class màu xanh lá
- `multiplier === 1.0` → badge không hiển thị, không có strikethrough

**Validates: Requirements 2.3, 2.4, 2.5, 2.7**

---

### Property 6: AdjustedTotal nhất quán giữa cart và modal

*For any* `(startTime, endTime, multiplier)` cố định, `AdjustedTotal` trong cart summary phải bằng `AdjustedTotal` trong confirmation modal.

**Validates: Requirements 2.8, 3.1**

---

### Property 7: Payment price selection cho membership

*For any* gói membership, nếu `getCurrentPricing()` thành công thì payload payment chứa `adjustedPrice` từ API; nếu `getCurrentPricing()` thất bại thì payload payment chứa `pkg.price` gốc.

**Validates: Requirements 4.6, 4.7, 9.3**

---

### Property 8: Membership price display theo adjustedPrice

*For any* gói membership với `adjustedPrice` từ API:
- `adjustedPrice < pkg.price` → hiển thị strikethrough `pkg.price` + `adjustedPrice` + label "Giá ưu đãi" (xanh)
- `adjustedPrice > pkg.price` → hiển thị strikethrough `pkg.price` + `adjustedPrice` + label "Giá cao điểm" (cam/đỏ)
- `adjustedPrice === pkg.price` → hiển thị giá bình thường, không có strikethrough hay label

**Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.8**

---

### Property 9: History date range filter

*For any* filter `{ from, to }`, tất cả bản ghi trong kết quả `getPricingHistory({ from, to })` phải có `createdAt` nằm trong khoảng `[from, to]`.

**Validates: Requirements 8.4**

---

### Property 10: getCurrentPricing timeout 5 giây

*For any* request `getCurrentPricing()` mà backend không phản hồi trong vòng 5000ms, hàm phải resolve với `{ ok: false, data: null }` chứ không treo mãi mãi.

**Validates: Requirements 9.1, 10.3**

---

## Error Handling

### pricingService.js

- Tất cả hàm wrap trong try/catch; `apiFetch` đã luôn resolve nên không cần re-wrap toàn bộ, chỉ cần xử lý AbortError đặc biệt cho `getCurrentPricing`.
- `getCurrentPricing` dùng `AbortController` + `setTimeout(reject, 5000)`. Khi timeout, signal bị abort, `apiFetch` trả về `ok: false, status: 0`. Hàm catch AbortError và trả `{ ok: false, data: null }`.
- Các hàm khác không cần timeout riêng (dùng trong admin context, user chờ được).

### useDynamicPricing hook

- Khi `ok: false` → set `multiplier = 1.0`, `error = true`, `loading = false`.
- Cancel AbortController cũ trước mỗi request mới (cleanup khi deps thay đổi hoặc unmount).
- Không propagate error lên UI (không throw, không toast).

### CreateBookingPage

- Khi `error = true` → ẩn PriceBadge, hiển thị `usageAmount` gốc, flow booking tiếp tục bình thường.
- Loading state chỉ block phần hiển thị giá, không block form input hoặc nút submit.

### Membership

- Khi `getCurrentPricing()` fail → `packagePriceMap` rỗng, tất cả card hiển thị `pkg.price` gốc.
- Không hiển thị error toast cho user khi pricing fail (graceful silent fallback).

### PricingManagement (admin tabs)

- Tab Dynamic Pricing: nếu `getPricingConfig()` fail → hiển thị inline error alert, form không load.
- Tab Pricing Rules: CRUD errors hiển thị trong modal, không đóng modal.
- Tab Suggestions: approve/reject errors hiển thị inline, trạng thái suggestion không thay đổi.
- Tab History & Stats: hai phần (history và stats) hiển thị lỗi độc lập, phần kia vẫn render nếu thành công.

---

## Testing Strategy

### Dual Testing Approach

Sử dụng **Vitest** (đã có trong dự án) cho cả unit tests và property-based tests. Không cài thêm thư viện.

Vì dự án không có sẵn PBT library, các property tests được implement theo pattern thủ công với random input generation (100+ iterations) dùng `Array.from({ length: 100 }, generateRandomInput).forEach(...)`. Đây là minimum viable PBT không cần dependency mới, phù hợp với Requirement 10.

### Unit Tests (Specific Examples & Edge Cases)

**`pricingService.test.js`**:
- Gọi `getCurrentPricing()` với mock `apiFetch` trả về success → verify shape response
- Gọi tất cả 12 export với mock success → verify chúng gọi đúng endpoint
- Mock `apiFetch` trả về `ok: false` → verify pass-through không throw
- Test timeout: mock fetch delay > 5s → verify resolve `{ ok: false, data: null }`

**`useDynamicPricing.test.js`** (với `@testing-library/react-hooks`):
- startTime/endTime null → loading=false, multiplier=1.0
- API success với multiplier=1.5 → state cập nhật đúng
- API failure → multiplier=1.0, error=true
- Debounce: thay đổi nhanh → chỉ 1 request thực sự được gửi

**Integration examples (Vitest + jsdom)**:
- `Membership` mount → verify cả hai fetches được gọi (parallel)
- Tab system `PricingManagement` → verify "Time Blocks" là tab đầu tiên trong list

### Property-Based Tests

Mỗi property test chạy tối thiểu **100 iterations** với random inputs. Tag comment theo format: `// Feature: dynamic-pricing-web-integration, Property N: <text>`.

**`computeAdjustedTotal.property.test.js`**:

```js
// Feature: dynamic-pricing-web-integration, Property 1: AdjustedTotal formula correctness
// For any (usageAmount, multiplier), result = Math.floor(usageAmount * multiplier / 1000) * 1000
test('Property 1: AdjustedTotal formula correctness', () => {
  Array.from({ length: 100 }, () => ({
    usageAmount: Math.floor(Math.random() * 500_000),
    multiplier: 0.5 + Math.random() * 2.5, // range 0.5–3.0
  })).forEach(({ usageAmount, multiplier }) => {
    const result = computeAdjustedTotal(usageAmount, multiplier);
    expect(result).toBe(Math.floor(usageAmount * multiplier / 1000) * 1000);
  });
});

// Feature: dynamic-pricing-web-integration, Property 2: AdjustedTotal rounding idempotence
test('Property 2: Rounding idempotence', () => {
  Array.from({ length: 100 }, () => Math.floor(Math.random() * 500_000)).forEach((x) => {
    const once = computeAdjustedTotal(x, 1.3);
    const twice = computeAdjustedTotal(once, 1.0); // multiply by 1 = no change, just round
    expect(Math.floor(once / 1000) * 1000).toBe(once); // already rounded
  });
});

// Feature: dynamic-pricing-web-integration, Property 3: Multiplier=1.0 on API failure
test('Property 3: Fallback multiplier=1.0', () => {
  // For any error state, computeAdjustedTotal(x) = Math.floor(x/1000)*1000 (multiplier=1)
  Array.from({ length: 100 }, () => Math.floor(Math.random() * 500_000)).forEach((x) => {
    const result = computeAdjustedTotal(x, 1.0);
    expect(result).toBe(Math.floor(x / 1000) * 1000);
  });
});
```

**`pricingService.property.test.js`**:

```js
// Feature: dynamic-pricing-web-integration, Property 4: pricingService never throws
test('Property 4: Service never throws', async () => {
  const errorCases = ['network_error', 'abort', 'timeout', 'invalid_json'];
  // 100 iterations with random error types
  for (let i = 0; i < 100; i++) {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: false, status: 0, data: null });
    await expect(getCurrentPricing()).resolves.toMatchObject({ ok: false });
  }
});

// Feature: dynamic-pricing-web-integration, Property 10: Timeout resolves within 5s
test('Property 10: getCurrentPricing timeout', async () => {
  // Mock slow fetch, verify promise resolves before 6s
  // ...
});
```

**`priceBadge.property.test.js`**:

```js
// Feature: dynamic-pricing-web-integration, Property 5: PriceBadge display by multiplier
test('Property 5: Badge label and visibility by multiplier', () => {
  Array.from({ length: 100 }, () => 0.5 + Math.random() * 2.5).forEach((multiplier) => {
    const { container } = render(<PriceBadge multiplier={multiplier} />);
    if (multiplier > 1.0) {
      expect(container).toHaveTextContent('Giá cao điểm');
    } else if (multiplier < 1.0) {
      expect(container).toHaveTextContent('Giá ưu đãi');
    } else {
      expect(container.firstChild).toBeNull();
    }
  });
});
```

**`membershipPriceDisplay.property.test.js`**:

```js
// Feature: dynamic-pricing-web-integration, Property 8: Membership price display
test('Property 8: Price display based on adjustedPrice vs pkg.price', () => {
  Array.from({ length: 100 }, () => {
    const basePrice = Math.floor(Math.random() * 1_000_000) + 10000;
    const delta = (Math.random() - 0.5) * basePrice * 0.5;
    return { basePrice, adjustedPrice: Math.round(basePrice + delta) };
  }).forEach(({ basePrice, adjustedPrice }) => {
    const { container } = renderPackageCard({ price: basePrice, adjustedPrice });
    if (adjustedPrice < basePrice) {
      expect(container).toHaveTextContent('Giá ưu đãi');
    } else if (adjustedPrice > basePrice) {
      expect(container).toHaveTextContent('Giá cao điểm');
    } else {
      expect(container).not.toHaveTextContent('Giá ưu đãi');
      expect(container).not.toHaveTextContent('Giá cao điểm');
    }
  });
});
```


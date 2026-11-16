const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatMembership, formatViolation, formatVoucher } = require('../services/telegramEventTemplates');
const when = new Date('2026-11-13T00:00:00Z');
const benefit = { name: 'Voucher <script>', type: 'FIXED_DISCOUNT', discountAmount: 50000, minimumAmount: 100000 };

test('membership template escapes user-controlled markup and remains readable within a photo caption', () => {
  const text = formatMembership({ _id: 'membership-1', validFrom: when, expireAt: when, amount: 500000 },
    { name: '<b>gói & mới</b>' }, Array.from({ length: 10 }, (_, i) => ({ floorId: { name: `Tầng ${i} <script>` }, slotCode: 'A'.repeat(100) })));
  assert.match(text, /&lt;b&gt;gói &amp; mới&lt;\/b&gt;/);
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /500[.,]000/);
  const visible = text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt);/g, 'x');
  assert.ok(visible.length < 1024);
});

test('violation template uses Vietnamese local time and never invents missing parking locations', () => {
  const text = formatViolation({ _id: 'violation-1', title: '<script>alert()</script>', description: '& move', fineAmount: 50000, createdAt: when });
  assert.match(text, /&lt;script&gt;/);
  assert.match(text, /&amp; move/);
  assert.match(text, /07:00/);
  assert.doesNotMatch(text, /undefined|Invalid Date|Vị trí được phép|Vị trí ghi nhận/);
});

test('voucher templates describe fixed, percentage and service benefits with their actual conditions', () => {
  const fixed = formatVoucher({ benefitSnapshot: benefit, expiresAt: when, source: 'manual' });
  assert.match(fixed, /50[.,]000/);
  assert.match(fixed, /100[.,]000/);
  assert.match(fixed, /Quà tặng từ VALO/);
  assert.match(fixed, /&lt;script&gt;/);
  const percent = formatVoucher({ benefitSnapshot: { ...benefit, type: 'PERCENT_DISCOUNT', discountPercent: 15 }, expiresAt: when, source: 'spending' });
  assert.match(percent, /Giảm 15%/);
  assert.match(percent, /Thưởng chi tiêu/);
  const free = formatVoucher({ benefitSnapshot: { ...benefit, type: 'FREE_SERVICE', serviceId: { name: 'Rửa xe & hút bụi' } }, expiresAt: when });
  assert.match(free, /Miễn phí dịch vụ: Rửa xe &amp; hút bụi/);
});

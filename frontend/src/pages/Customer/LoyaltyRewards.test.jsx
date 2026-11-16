import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoyaltyRewards from './LoyaltyRewards';
vi.mock('../../services/loyaltyService', () => ({
  getMyVouchers: async () => ({ ok: true, data: { data: [
    { _id: '1', source: 'manual', status: 'available', expiresAt: '2026-10-08T10:00:00Z', benefitSnapshot: { name: 'Gift voucher', type: 'FIXED_DISCOUNT', discountAmount: 20000, minimumAmount: 100000 } },
    { _id: '2', source: 'spending', status: 'revoked', expiresAt: '2026-10-08T10:00:00Z', benefitSnapshot: { name: 'Refunded reward', type: 'FIXED_DISCOUNT', discountAmount: 20000, minimumAmount: 100000 } },
  ] } }),
  getSpendingProgress: async () => ({ ok: true, data: { data: { month: '2026-10', total: 200000, highestAwardedThreshold: 0, enabled: true, tiers: [{ threshold: 300000, discountAmount: 20000, minimumAmount: 100000 }] } } }),
}));
afterEach(cleanup);
test('customer sees spending, conditions and vouchers; status filter excludes revoked rewards', async () => {
  const user = userEvent.setup(); render(<LoyaltyRewards />);
  await screen.findByText('Gift voucher');
  expect(screen.getByText('Refunded reward')).toBeTruthy();
  expect(screen.getByText(/Còn 100.000đ để nhận voucher 20.000đ/)).toBeTruthy();
  expect(screen.getByText('Chi tiêu trong tháng đạt')).toBeTruthy();
  expect(screen.getByText('Nhận voucher')).toBeTruthy();
  expect(screen.getByText('Voucher dùng cho đơn mới từ 100.000đ')).toBeTruthy();
  expect(screen.getByText('Còn 100.000đ để đạt mốc')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đổi voucher' })).toBeNull();
  expect(screen.queryByText('Bảng xếp hạng chi tiêu')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Có thể dùng' }));
  expect(screen.queryByText('Refunded reward')).toBeNull();
  expect(screen.getByText('Đơn từ 100.000đ · Một lần sử dụng')).toBeTruthy();
});

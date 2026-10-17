import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherManagement from './VoucherManagement';
import * as api from '../../services/loyaltyService';

vi.mock('../../services/loyaltyService', () => ({
  getVoucherTemplatesAdmin: vi.fn(), createVoucherTemplate: vi.fn(), updateVoucherTemplate: vi.fn(),
  getSpendingProgram: vi.fn(), saveSpendingProgram: vi.fn(), searchVoucherRecipients: vi.fn(), distributeVouchers: vi.fn(),
  getQuarterlyLeaderboardAdmin: vi.fn(),
}));
vi.mock('../../services/extraServiceApi', () => ({ getServices: async () => ({ ok: true, data: { data: [] } }) }));
const ok = (data) => ({ ok: true, data: { data } });
const template = { _id: 'voucher-template-1', name: 'Welcome gift', type: 'FIXED_DISCOUNT', discountAmount: 20000, minimumAmount: 100000, redeemedCount: 0, isActive: true };
const program = { enabled: false, revision: 0, tiers: [{ threshold: 300000, discountAmount: 20000, minimumAmount: 100000 }] };
beforeEach(() => {
  vi.clearAllMocks();
  api.getSpendingProgram.mockResolvedValue(ok({ program, stats: { issued: 0, used: 0 } }));
  api.getVoucherTemplatesAdmin.mockResolvedValue(ok([template]));
  api.getQuarterlyLeaderboardAdmin.mockResolvedValue(ok({ quarter: '2026-Q4', availableQuarters: ['2026-Q4'], leaders: [{ userId: 'customer-1', username: 'Customer One', total: 400000, rank: 1 }] }));
});
afterEach(cleanup);
test('admin configures automatic thresholds and saves explicit enable state', async () => {
  const user = userEvent.setup();
  api.saveSpendingProgram.mockResolvedValue(ok({ ...program, enabled: true, revision: 1 }));
  render(<VoucherManagement />);
  await screen.findByText('Mốc thưởng hàng tháng');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Lưu chương trình' }));
  await waitFor(() => expect(api.saveSpendingProgram).toHaveBeenCalledWith({ ...program, enabled: true }));
  await screen.findByText('Đã lưu chương trình thưởng.');
});
test('manual send selects one or multiple customers and retries with the same idempotency key', async () => {
  const user = userEvent.setup();
  const first = { _id: 'customer-1', username: 'Customer One', email: 'one@example.test', role: 'customer' };
  const second = { _id: 'customer-2', username: 'Customer Two', email: 'two@example.test', role: 'customer' };
  api.searchVoucherRecipients.mockResolvedValue(ok([first, second]));
  api.distributeVouchers.mockResolvedValueOnce({ ok: false, data: { message: 'Network interrupted' } }).mockResolvedValueOnce(ok({ userIds: [first._id, second._id] }));
  render(<VoucherManagement />);
  await screen.findByText('Mốc thưởng hàng tháng');
  await user.click(screen.getByRole('button', { name: 'Gửi trực tiếp' }));
  await user.click(screen.getByRole('button', { name: 'Gửi', exact: true }));
  expect(screen.getByRole('button', { name: 'Gửi cho 0 người' }).disabled).toBe(true);
  await user.type(screen.getByLabelText('Tìm khách hàng theo tên hoặc email'), 'customer');
  await user.click(await screen.findByRole('button', { name: /Customer One/ }));
  await user.click(await screen.findByRole('button', { name: /Customer Two/ }));
  await user.click(screen.getByRole('button', { name: 'Gửi cho 2 người' }));
  await screen.findAllByText('Network interrupted');
  await user.click(screen.getByRole('button', { name: 'Gửi cho 2 người' }));
  await waitFor(() => expect(api.distributeVouchers).toHaveBeenCalledTimes(2));
  const [id, payload] = api.distributeVouchers.mock.calls[0];
  expect(id).toBe(template._id);
  expect(payload.userIds).toEqual([first._id, second._id]);
  expect(api.distributeVouchers.mock.calls[1][1].requestId).toBe(payload.requestId);
  await screen.findByText(/Đã cấp voucher cho 2 khách hàng/);
});
test('create fixed voucher requires name and sends no point cost', async () => {
  const user = userEvent.setup();
  api.createVoucherTemplate.mockResolvedValue(ok(template));
  render(<VoucherManagement />);
  await screen.findByText('Mốc thưởng hàng tháng');
  await user.click(screen.getByRole('button', { name: 'Gửi trực tiếp' }));
  await user.click(screen.getByRole('button', { name: 'Tạo voucher' }));
  await user.click(screen.getByRole('button', { name: 'Lưu mẫu voucher' }));
  expect(api.createVoucherTemplate).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Tên voucher'), 'Welcome gift');
  await user.click(screen.getByRole('button', { name: 'Lưu mẫu voucher' }));
  await waitFor(() => expect(api.createVoucherTemplate).toHaveBeenCalled());
  expect(api.createVoucherTemplate.mock.calls[0][0]).toMatchObject({ type: 'FIXED_DISCOUNT', discountAmount: 20000, minimumAmount: 100000 });
  expect(api.createVoucherTemplate.mock.calls[0][0]).not.toHaveProperty('pointCost');
});
test('leaderboard is admin-only UI and sends selected name into voucher recipient search', async () => {
  const user = userEvent.setup();
  api.searchVoucherRecipients.mockResolvedValue(ok([{ _id: 'customer-1', username: 'Customer One', email: 'one@example.test', role: 'customer' }]));
  render(<VoucherManagement />);
  await screen.findByText('Mốc thưởng hàng tháng');
  await user.click(screen.getByRole('button', { name: 'Xếp hạng theo quý' }));
  await screen.findByText('Customer One');
  await user.click(screen.getByRole('button', { name: 'Chọn để gửi voucher' }));
  await user.click(screen.getByRole('button', { name: 'Gửi', exact: true }));
  expect(screen.getByLabelText('Tìm khách hàng theo tên hoặc email').value).toBe('Customer One');
  expect(await screen.findByRole('button', { name: /Customer One/ })).toBeTruthy();
});
test('admin sees a warning when voucher emails are retrying', async () => {
  api.getSpendingProgram.mockResolvedValue(ok({ program, stats: { issued: 3, used: 0, pendingEmails: 3, retryingEmails: 2 } }));
  render(<VoucherManagement />);
  expect(await screen.findByText(/Có 2 email voucher gửi chưa thành công/)).toBeTruthy();
});

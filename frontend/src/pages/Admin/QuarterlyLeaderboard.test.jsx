import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuarterlyLeaderboard from './QuarterlyLeaderboard';

vi.mock('../../services/loyaltyService', () => ({
  getQuarterlyLeaderboardAdmin: vi.fn(async (quarter) => ({ ok: true, data: { data: {
    quarter: quarter || '2027-Q1', currentQuarter: '2027-Q1', availableQuarters: ['2027-Q1', '2026-Q4'],
    leaders: quarter === '2026-Q4' ? [{ userId: 'u1', username: 'Previous winner', total: 500000, rank: 1 }] : [{ userId: 'u2', username: 'Current winner', total: 700000, rank: 1 }],
  } } })),
}));
afterEach(cleanup);
test('admin can switch from current quarter to historical ranking', async () => {
  const user = userEvent.setup();
  render(<QuarterlyLeaderboard />);
  expect(await screen.findByText('Current winner')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Chọn quý' }), '2026-Q4');
  expect(await screen.findByText('Previous winner')).toBeTruthy();
  expect(screen.queryByText('Current winner')).toBeNull();
});
test('admin can choose a ranked customer for voucher sending', async () => {
  const choose = vi.fn();
  const user = userEvent.setup();
  render(<QuarterlyLeaderboard onChooseRecipient={choose} />);
  await screen.findByText('Current winner');
  await user.click(screen.getByRole('button', { name: 'Chọn để gửi voucher' }));
  expect(choose).toHaveBeenCalledWith({ userId: 'u2', username: 'Current winner', total: 700000, rank: 1 });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminNotificationFeed from './AdminNotificationFeed';
import { getAdminHistory } from '../../services/notificationService';

vi.mock('../../services/notificationService', () => ({ getAdminHistory: vi.fn() }));
const t = (key, options) => options?.defaultValue || key;
const source = [];
const notification = { _id: 'notice-1', title: 'Gate update', content: 'Full message reserved for modal', priority: 'WARNING', type: 'SYSTEM', status: 'SENT', targetType: 'ALL_USERS', createdAt: '2026-11-28T00:00:00Z' };
const response = (items = [notification], total = 64) => ({ ok: true, data: { success: true, data: items, pagination: { total, totalPages: Math.ceil(total / 4) } } });
const open = () => render(<MemoryRouter><AdminNotificationFeed source={source} onRefresh={vi.fn()} t={t} language="en" /></MemoryRouter>);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  getAdminHistory.mockReset().mockResolvedValue(response());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('requests four-row server pages beyond the original 50 records', async () => {
  open();
  await screen.findByText('Gate update');
  expect(getAdminHistory).toHaveBeenLastCalledWith({ page: 1, limit: 4, priority: undefined, search: undefined });
  fireEvent.click(screen.getByRole('button', { name: '16', exact: true }));
  await waitFor(() => expect(getAdminHistory).toHaveBeenLastCalledWith({ page: 16, limit: 4, priority: undefined, search: undefined }));
  await screen.findByText('Gate update');
});

it('sends raw priority filters and resets server pagination when searching', async () => {
  open();
  await screen.findByText('Gate update');
  fireEvent.click(screen.getByRole('button', { name: '16', exact: true }));
  await screen.findByText('Gate update');
  fireEvent.change(screen.getByRole('textbox', { name: 'staffNotifications.filters.searchHistory' }), { target: { value: 'older gate' } });
  await waitFor(() => expect(getAdminHistory).toHaveBeenLastCalledWith({ page: 1, limit: 4, priority: undefined, search: 'older gate' }));
  await screen.findByText('Gate update');
  fireEvent.click(screen.getByRole('button', { name: 'Type', exact: true }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'WARNING' }));
  await waitFor(() => expect(getAdminHistory).toHaveBeenLastCalledWith({ page: 1, limit: 4, priority: 'WARNING', search: 'older gate' }));
});

it('keeps message content outside the table and opens it in a detail modal', async () => {
  open();
  await screen.findByText('Gate update');
  const table = screen.getByRole('table');
  expect(within(table).queryByText(notification.content)).toBeNull();
  fireEvent.click(within(table).getByRole('button', { name: 'Gate update' }));
  const modal = await screen.findByRole('dialog');
  expect(within(modal).getByText(notification.content)).toBeTruthy();
  expect(within(modal).getByText('staffNotifications.drawer.allUsers')).toBeTruthy();
  fireEvent.click(within(modal).getByRole('button', { name: 'common.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

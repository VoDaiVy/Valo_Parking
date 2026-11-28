import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationManagement from './NotificationManagement';
import { createNotification, getAdminHistory, getInternalReports, getInternalReport, updateInternalReport } from '../../services/notificationService';

vi.mock('../../hooks/useSocket', () => ({ useSocket: () => null }));
vi.mock('../../i18n/hooks/useLanguage', () => ({ useLanguage: () => ({ t: key => key, language: 'vi' }) }));
vi.mock('../../services/notificationService', () => ({
  getAdminHistory: vi.fn(), createNotification: vi.fn(), getInternalReports: vi.fn(),
  getInternalReport: vi.fn(), updateInternalReport: vi.fn(),
}));
vi.mock('../../services/userService', () => ({ searchUsers: vi.fn(async () => ({ ok: true, data: { data: [] } })) }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  sessionStorage.clear();
  getAdminHistory.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 }, stats: { totalSent: 0, success: 0, errors: 0 } } });
  getInternalReports.mockResolvedValue({ ok: true, data: { data: [], hasMore: false } });
  createNotification.mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = (role, path = '/') => render(<MemoryRouter initialEntries={[path]}><NotificationManagement role={role} /></MemoryRouter>);

it('limits the Admin workspace presentation to Send and Issue Reports, preserving Live Feed', async () => {
  const { container } = open('admin');
  expect(container.querySelector('.admin-notification-page')).not.toBeNull();
  expect(screen.getAllByRole('button', { name: 'common.refresh' })).toHaveLength(1);
  expect(container.querySelector('.admin-notification-workspace')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.tabs.compose' }));
  expect(container.querySelector('.admin-notification-workspace')).not.toBeNull();
  expect(container.querySelector('.snm-compose').dataset.compactComposer).toBe('true');
  expect(screen.getByRole('button', { name: 'staffNotifications.compose.audienceLabel' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.tabs.issues' }));
  await screen.findByText('staffNotifications.issues.noReports');
  expect(container.querySelector('.snm-issue-reports')).not.toBeNull();
  expect(screen.getAllByRole('button', { name: 'common.refresh' })).toHaveLength(1);
  const callsBeforeRefresh = getInternalReports.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
  await waitFor(() => expect(getInternalReports.mock.calls.length).toBeGreaterThan(callsBeforeRefresh));
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.tabs.liveFeed' }));
  expect(container.querySelector('.admin-notification-workspace')).toBeNull();
});

it('keeps Staff audience labels and presentation unchanged', () => {
  sessionStorage.setItem('valo_user', JSON.stringify({ role: 'staff' }));
  const { container } = open('staff');
  expect(container.querySelector('.admin-notification-page')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.tabs.compose' }));
  expect(container.querySelector('.admin-notification-workspace')).toBeNull();
  expect(container.querySelector('.snm-compose').dataset.compactComposer).toBe('true');
  expect(screen.getByRole('button', { name: 'Audience mode' })).toBeTruthy();
});

it('preserves Admin broadcast payload and raw priority enums with translated labels', async () => {
  open('admin');
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.tabs.compose' }));
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.compose.audienceLabel' }));
  fireEvent.click(await screen.findByRole('option', { name: 'staffNotifications.compose.audience.all' }));
  fireEvent.change(screen.getByPlaceholderText('staffNotifications.compose.titlePlaceholder'), { target: { value: 'Test title' } });
  fireEvent.change(screen.getByPlaceholderText('staffNotifications.compose.contentPlaceholder'), { target: { value: 'Test message' } });
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.compose.priority' }));
  const warning = await screen.findByRole('option', { name: /warning/i });
  fireEvent.click(warning);
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.compose.send' }));
  await waitFor(() => expect(createNotification).toHaveBeenCalledWith({
    title: 'Test title', content: 'Test message', type: 'SYSTEM', priority: 'WARNING', targetType: 'ALL_USERS', targetUsers: [],
  }));
});

it('preserves Admin report instructions and revision payload without exposing Staff closure action', async () => {
  const report = { _id: 'report-1', revision: 3, status: 'OPEN', priority: 'ERROR', content: 'Gate issue', reporterName: 'Staff', createdAt: '2026-11-28T00:00:00Z', updatedAt: '2026-11-28T00:00:00Z', messages: [] };
  getInternalReport.mockResolvedValue({ ok: true, data: { data: report } });
  updateInternalReport.mockResolvedValue({ ok: true, data: { data: { ...report, revision: 4, status: 'IN_PROGRESS' } } });
  open('admin', '/?incident=report-1');
  const reply = await screen.findByRole('textbox', { name: 'staffNotifications.issues.instructions' });
  expect(screen.queryByRole('button', { name: 'staffNotifications.issues.confirmResolved' })).toBeNull();
  fireEvent.change(reply, { target: { value: 'Please inspect gate' } });
  fireEvent.click(screen.getByRole('button', { name: 'staffNotifications.issues.sendInstructions' }));
  await waitFor(() => expect(updateInternalReport).toHaveBeenCalledWith('report-1', { action: 'reply', content: 'Please inspect gate', revision: 3 }));
});

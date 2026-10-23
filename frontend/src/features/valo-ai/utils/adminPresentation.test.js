import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { adminNotification, adminDate, adminValue, adminSuggestions, adminFilters } from './adminPresentation.js';

let server; let AdminView; let StaffView;
const originalWindow = globalThis.window;
before(async () => {
  globalThis.window = { innerWidth: 1280, innerHeight: 900 };
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  AdminView = (await server.ssrLoadModule('/src/features/valo-ai/components/AdminValoAICopilotView.jsx')).default;
  StaffView = (await server.ssrLoadModule('/src/features/valo-ai/components/ValoAICopilotView.jsx')).default;
});
after(async () => { await server?.close(); globalThis.window = originalWindow; });
const noop = () => {};
const props = {
  position: { x: 1100, y: 750 }, open: true, setOpen: noop, tab: 'chat', setTab: noop, messages: [],
  busy: false, noticeBusy: false, input: '', setInput: noop, submit: noop, decide: noop, notifications: [],
  unreadCount: 0, notificationError: '', filter: 'all', setFilter: noop, selected: null, setSelected: noop,
  preview: null, openNotice: noop, onNotificationClick: noop, refresh: noop, dismissNotice: noop,
  onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onTriggerClick: noop, bottomRef: { current: null },
  suggestions: adminSuggestions, filters: adminFilters, dragging: false, notificationLoading: false,
  hasMore: false, loadMore: noop,
};
const render = (Component, overrides = {}) => renderToStaticMarkup(React.createElement(Component, { ...props, ...overrides }));

test('Admin renders English welcome, tabs, prompts, accessibility labels and no fake attachment or emoji', () => {
  const html = render(AdminView);
  for (const text of ['Admin operations assistant', 'Chat', 'Notifications', 'How can I help?', 'Ask about VALO operations', 'Send question']) assert.ok(html.includes(text));
  assert.ok(!html.includes('Trò chuyện'));
  assert.ok(!html.includes('paperclip'));
  assert.ok(!html.includes('👋'));
  assert.ok(html.includes('lang="en"'));
});

test('old Vietnamese notifications render English without modifying stored fields or operational names', () => {
  const item = { _id: 'notice', title: 'Phiên đỗ xe mới', summary: 'Nội dung cũ', notificationType: 'NEW_SESSION', severity: 'NOTICE', evidence: { licensePlate: '11A12345', slot: 'F10' } };
  const snapshot = JSON.stringify(item);
  const html = render(AdminView, { tab: 'notifications', notifications: [item], hasMore: true });
  assert.ok(html.includes('New parking session'));
  assert.ok(html.includes('11A12345'));
  assert.ok(html.includes('F10'));
  assert.ok(html.includes('Load more notifications'));
  assert.ok(!html.includes('Phiên đỗ xe mới'));
  assert.equal(JSON.stringify(item), snapshot);
});

test('Admin detail hides raw evidence under Technical details and uses English draft controls', () => {
  const item = { title: 'Đăng ký gói VIP mới', notificationType: 'NEW_SUBSCRIPTION', severity: 'NOTICE', evidence: { subscriptionId: 'id' } };
  const detail = render(AdminView, { tab: 'notifications', selected: item });
  assert.match(detail, /<details[^>]*><summary>Technical details<\/summary><pre>/);
  assert.ok(detail.includes('Operational evidence'));
  const draft = render(AdminView, { messages: [{ role: 'ai', message: 'Review the proposal.', draft: { type: 'CREATE_SERVICE', reason: 'Requested by Admin', current: { name: 'Old service' }, payload: { name: 'Tên gốc', price: 1000 } } }] });
  for (const text of ['Proposed change', 'Current values', 'Approve and apply', 'Reject']) assert.ok(draft.includes(text));
  assert.ok(draft.includes('Tên gốc'));
});

test('Staff view retains Vietnamese labels and stored notification text', () => {
  const html = render(StaffView, { userRole: 'staff', suggestions: [], filters: [] });
  assert.ok(html.includes('Trợ lý AI cho nhân viên'));
  assert.ok(html.includes('Trò chuyện'));
  assert.ok(html.includes('Nhập câu hỏi cho VALO AI'));
  const notice = render(StaffView, { userRole: 'staff', tab: 'notifications', notifications: [{ _id: 'n', title: 'Phiên đỗ xe mới', summary: 'Nội dung cũ', notificationType: 'NEW_SESSION' }] });
  assert.ok(notice.includes('Phiên đỗ xe mới'));
});

test('all supported event titles are English; formatters preserve names and use English numbers/dates', () => {
  for (const type of ['NEW_BOOKING', 'BOOKING_CANCELLED', 'NEW_SUBSCRIPTION', 'NEW_USER_REGISTERED', 'NEW_SESSION', 'VEHICLE_PENDING_VERIFICATION', 'FLOOR_FULL', 'FLOOR_AVAILABLE_AGAIN', 'OCCUPANCY_HIGH', 'SESSION_OVERDUE', 'REFUND_COMPLETED', 'REVENUE_ANOMALY', 'SESSION_CHANGE']) {
    const value = adminNotification({ notificationType: type, title: 'Tiêu đề cũ', summary: 'Tóm tắt cũ' });
    assert.ok(!value.title.includes('cũ'));
    assert.ok(!value.summary.includes('cũ'));
  }
  assert.equal(adminValue('Nguyễn Văn A'), 'Nguyễn Văn A');
  assert.equal(adminValue(1234), '1,234');
  assert.match(adminDate('2026-10-23T00:00:00Z'), /23 Oct 2026/);
  assert.equal(adminDate('invalid'), 'Not available');
});

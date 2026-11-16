const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('Admin and Staff filters keep global unread counts and individual reads remain role-scoped', async () => {
  const Notification = require('../models/AINotification');
  const original = { find: Notification.find, countDocuments: Notification.countDocuments, findOneAndUpdate: Notification.findOneAndUpdate };
  const router = require('../routes/aiCopilotRoutes');
  const centers = router.stack.filter(layer => layer.handle?.stack?.some(entry => entry.route?.path === '/notifications')).map(layer => layer.handle);
  try {
    for (const [index, center] of centers.entries()) {
      const role = index === 0 ? 'staff' : 'admin';
      const rows = [{ _id: '6aebe56ea4ec3a25a06971bf', severity: 'WARNING', readBy: [] }, { _id: '6aebe56ea4ec3a25a06971be', severity: 'CRITICAL', readBy: ['reader'] }];
      const selected = filter => rows.filter(row => (!filter.severity || row.severity === filter.severity) && (!filter.readBy || !row.readBy.includes(filter.readBy.$ne)));
      const assertRole = filter => role === 'staff' ? assert.equal(filter.targetRoles, 'staff') : assert.ok(filter.$or.some(part => part.targetRoles === 'admin'));
      Notification.find = filter => { assertRole(filter); const query = { sort: () => query, skip: () => query, limit: () => query, populate: () => query, lean: async () => selected(filter) }; return query; };
      Notification.countDocuments = async filter => { assertRole(filter); return selected(filter).length; };
      Notification.findOneAndUpdate = async (filter, update) => { assertRole(filter); const row = rows.find(row => row._id === filter._id); const id = update.$addToSet.readBy; if (!row.readBy.includes(id)) row.readBy.push(id); return row; };
      const handler = (route, method) => center.stack.find(layer => layer.route?.path === route && layer.route.methods[method]).route.stack[0].handle;
      let body;
      const res = { json: value => { body = value; }, status: () => res };
      const request = { user: { _id: 'reader' }, query: {}, params: { id: rows[0]._id } };
      for (const [filter, expected] of [['all', 2], ['unread', 1], ['warning', 1], ['critical', 1]]) {
        request.query.filter = filter;
        await handler('/notifications', 'get')(request, res);
        assert.equal(body.data.notifications.length, expected); assert.equal(body.data.unreadCount, 1, `${role} ${filter}`);
      }
      await handler('/notifications/:id/read', 'patch')(request, res);
      await handler('/notifications/:id/read', 'patch')(request, res);
      assert.deepEqual(rows[0].readBy, ['reader']);
      request.query.filter = 'unread'; await handler('/notifications', 'get')(request, res);
      assert.equal(body.data.unreadCount, 0); assert.equal(body.data.notifications.length, 0);
    }
  } finally { Object.assign(Notification, original); }
});

test('Admin and Staff render compact shared English controls, read states, severity, individual actions and empty/loading states', async t => {
  const frontend = path.resolve(__dirname, '../../../frontend');
  const fe = require('node:module').createRequire(path.join(frontend, 'package.json'));
  const React = fe('react');
  const { renderToStaticMarkup } = fe('react-dom/server');
  const router = fe('react-router-dom');
  const { transformWithOxc } = await import(pathToFileURL(fe.resolve('vite')));
  const presentation = await import(pathToFileURL(path.join(frontend, 'src/features/valo-ai/utils/adminPresentation.js')));
  const targets = await import(pathToFileURL(path.join(frontend, 'src/features/valo-ai/utils/notificationTarget.js')));
  const deps = { ...React, ...router, ...fe('lucide-react'), ...fe('date-fns'), ...presentation, ...targets,
    ValoAIMascot: () => null, AdminDraft: () => null, AdminChatAnswer: () => null, AIMessageMarkdown: () => null,
  };
  async function compile(name, expression) {
    const file = path.join(frontend, `src/features/valo-ai/components/${name}.jsx`);
    const source = require('node:fs').readFileSync(file, 'utf8').replace(/^import .*;$/gm, '').replace(/export default function/g, 'function').replace(/export function/g, 'function');
    const { code } = await transformWithOxc(source, file, { jsx: { runtime: 'classic' } });
    return new Function('React', 'deps', `const { ${Object.keys(deps).filter(key => key !== name).join(',')} } = deps; ${code}; return ${expression};`)(React, deps);
  }
  Object.assign(deps, await compile('NotificationCenterControls', '{ NotificationFilterBar, NotificationSummary }'));
  deps.ValoAIMascot = await compile('ValoAIMascot', 'ValoAIMascot');
  deps.ValoAILauncher = await compile('ValoAILauncher', 'ValoAILauncher');
  deps.searchAICustomers = async () => ({ ok: true, data: { success: true, data: { items: [], page: 2, pages: 3, total: 24 } } });
  deps.StaffCustomerCards = await compile('StaffCustomerCards', 'StaffCustomerCards');
  const admin = await compile('AdminValoAICopilotView', 'AdminValoAICopilotView');
  const staff = await compile('ValoAICopilotView', 'ValoAICopilotView');
  const oldWindow = global.window;
  global.window = { innerWidth: 390, innerHeight: 800 };
  t.after(() => { global.window = oldWindow; });
  const base = { position: { x: 290, y: 650 }, open: true, tab: 'notifications', messages: [], suggestions: [], notifications: [], unreadCount: 0, readingIds: [], filter: 'all', setFilter() {}, setSelected() {}, markRead() {}, markAllRead() {} };
  const render = (Component, props) => renderToStaticMarkup(React.createElement(router.MemoryRouter, null, React.createElement(Component, { ...base, ...props })));
  for (const [role, Component] of [['admin', admin], ['staff', staff]]) {
    for (const filter of ['all', 'unread', 'warning', 'critical']) {
      const html = render(Component, { userRole: role, filter });
      for (const label of ['All', 'Unread', 'Warning', 'Critical', 'Mark as read']) assert.ok(html.includes(`>${label}<`), `${role}: ${label}`);
      assert.ok(html.includes('No notifications match this filter.'));
      assert.ok(html.includes('class="valo-ai-mark-all-read" disabled=""'));
    }
    const notifications = [{ _id: 'one', notificationType: 'SESSION_OVERDUE', title: 'Parking overdue', summary: 'Vehicle 43A11111 exceeded parking time.', evidence: { licensePlate: '43A11111' }, severity: 'CRITICAL', isRead: false }, { _id: 'two', title: 'Floor full', severity: 'WARNING', isRead: true }];
    const html = render(Component, { userRole: role, notifications, unreadCount: 1 });
    assert.ok(html.includes('severity-critical')); assert.ok(html.includes('severity-warning'));
    assert.ok(html.includes('is-unread')); assert.ok(html.includes('is-read'));
    assert.ok(html.includes('<b>43A11111</b>'));
    assert.equal((html.match(/>Mark as read</g) || []).length, 2); // Toolbar and individual action.
    const loading = render(Component, { userRole: role, notificationLoading: true });
    assert.ok(!loading.includes('No notifications match this filter.'));
  }
  let selected, marked = 0;
  const bar = deps.NotificationFilterBar({ filter: 'all', unreadCount: 2, onFilter: value => { selected = value; }, onMarkAllRead: () => { marked += 1; } });
  for (const button of bar.props.children[0].props.children) { button.props.onClick(); assert.equal(selected, button.key); }
  bar.props.children[1].props.onClick(); assert.equal(marked, 1);
  assert.equal(deps.NotificationFilterBar({ unreadCount: 0 }).props.children[1].props.disabled, true);
  assert.equal(deps.NotificationFilterBar({ unreadCount: 2, marking: true }).props.children[1].props.disabled, true);

  for (const Component of [admin, staff]) {
    const chat = render(Component, { tab: 'chat', userRole: Component === staff ? 'staff' : 'admin', input: '', suggestions: ['Show available parking spaces'] });
    for (const label of ['>Chat<', 'Hello', 'Enter a question for VALO AI...', 'Show available parking spaces', 'confirmation']) assert.ok(chat.includes(label), label);
    assert.ok(!/Trò chuyện|Xin chào|Nhập câu hỏi|Thông báo/.test(chat));
  }
  const legacy = { _id: 'legacy', notificationType: 'NEW_BOOKING', title: 'Có booking mới', summary: 'Booking xe 43A11111 tại vị trí A-09 đã được thanh toán.', evidence: {}, severity: 'NOTICE' };
  const original = JSON.stringify(legacy);
  const translated = presentation.adminNotification(legacy);
  assert.equal(translated.summary, 'Booking for vehicle 43A11111 at space A-09 has been paid.');
  assert.equal(JSON.stringify(legacy), original);
  for (const Component of [admin, staff]) {
    const english = render(Component, { notifications: [legacy] });
    assert.ok(english.includes(translated.summary)); assert.ok(!english.includes(legacy.title));
  }
  const language = require('../services/aiCopilot/adminLanguage');
  assert.ok(language.adminLanguageInstruction('staff').includes('Respond exclusively in English'));
  assert.equal(language.roleMessage('staff', 'Unknown internal error'), 'Unable to complete this request. Please try again.');
  const customer = { _id: '6a17bf45f57436ad72e17852', role: 'customer', status: false, email: 'customer@example.test', profile: { firstName: 'Linh', lastName: 'Nguyen', phone: '0901234567' } };
  const customerResult = { items: [customer], total: 24, page: 1, pages: 3, limit: 10, filters: { query: 'Linh', role: 'customer' } };
  const customerHtml = render(staff, { tab: 'chat', userRole: 'staff', input: '', messages: [{ role: 'ai', message: 'Source: internal\nTimestamp: internal', accountResult: customerResult, evidence: [{ tool: 'search_users', data: customerResult, timestamp: 'internal' }] }] });
  for (const value of ['Linh Nguyen', '0901234567', 'View Customer', 'Page 1 of 3', 'Status: Blocked', '/staff/accounts?userId=6a17bf45f57436ad72e17852']) assert.ok(customerHtml.includes(value), value);
  for (const value of ['View source data', 'Source:', 'Timestamp:', 'internal']) assert.ok(!customerHtml.includes(value), value);

  // Same viewport, artwork, launcher geometry and live-count badge for both role views.
  const launchers = [admin, staff].map(Component => render(Component, { unreadCount: 7 }));
  const extract = html => html.match(/<div class="valo-ai-anchor"[\s\S]*?<\/button><\/div>/)[0].replace(/ aria-controls="admin-valo-ai"/, '');
  assert.equal(extract(launchers[0]), extract(launchers[1]));
  assert.ok(launchers[0].includes('aria-label="7 unread notifications"'));
  assert.ok(extract(launchers[0]).includes('width="82" height="62.32"'));
  assert.ok(!extract(render(admin, { unreadCount: 0 })).includes('valo-ai-badge'));
  assert.ok(extract(render(staff, { unreadCount: 125 })).includes('>125</span>'));

  // The shared component must forward capture/drag/click callbacks unchanged.
  deps.useState = value => [value, () => {}];
  const Launcher = await compile('ValoAILauncher', 'ValoAILauncher');
  const calls = [];
  const pointer = { currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 92, height: 100 }) }, clientX: 30, clientY: 40 };
  const launcher = Launcher({ position: { x: 100, y: 200 }, dragging: true, onPointerDown: event => calls.push(['down', event]), onPointerMove: event => calls.push(['move', event]), onPointerUp: event => calls.push(['up', event]), onTriggerClick: event => calls.push(['click', event]) });
  const button = launcher.props.children[1];
  for (const event of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel', 'onClick']) button.props[event](pointer);
  assert.deepEqual(calls.map(([name]) => name), ['down', 'move', 'up', 'up', 'click']);
  assert.ok(calls.every(([, event]) => event === pointer));
});

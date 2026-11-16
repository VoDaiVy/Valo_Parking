const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { entityLinks } = require('../services/aiCopilot/entityLinks');
const actualDraftService = require('../services/aiCopilot/draftService');
const actualRegistry = require('../services/aiCopilot/toolRegistry');
const id = '6aebe56ea4ec3a25a06971bf';
const otherId = '6aebe56ea4ec3a25a06971be';
let queue, requests, drafts, toolError, auditError, executions = [];
const replace = (name, exports) => { require.cache[require.resolve(name)] = { id: require.resolve(name), filename: require.resolve(name), loaded: true, exports }; };
replace('@google/generative-ai', { GoogleGenerativeAI: class {
  getGenerativeModel() { return { generateContent: async (request, options) => {
    requests.push({ request, options });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { response: next };
  } }; }
} });
replace('../services/aiCopilot/toolRegistry', {
  tools: ['search_users', 'get_current_user', 'search_sessions', 'get_subscription_members', 'get_subscription_detail', 'get_subscription_stats', 'search_ticket_packages', 'get_ticket_package_detail', 'get_ticket_package_stats', 'search_services', 'get_service_detail', 'get_service_stats'].map(name => ({ name })),
  getToolsForRole: () => ['search_users', 'get_current_user', 'search_sessions', 'get_subscription_members', 'get_subscription_detail', 'get_subscription_stats', 'search_ticket_packages', 'get_ticket_package_detail', 'get_ticket_package_stats', 'search_services', 'get_service_detail', 'get_service_stats'].map(name => ({ name, description: 'Read records', parameters: { type: 'object', properties: {} } })),
  execute: async (name, args, role, context) => {
    executions.push({ name, args, role, context });
    if (toolError) throw toolError;
    const packageRecord = args?.name === 'VIP Yearly'
      ? { _id: otherId, name: 'VIP Yearly', description: 'Yearly coverage', type: 'yearly', price: 1500000, isActive: true, updatedAt: '2026-11-09T00:00:00.000Z' }
      : { _id: id, name: args?.name === 'Premium Monthly' || args?.query === 'Premium Monthly' ? 'Premium Monthly' : 'Gold_Pass', description: 'Daily coverage', type: 'daily', price: 0, isActive: false, updatedAt: '2026-11-08T00:00:00.000Z' };
    const serviceRecord = { _id: id, name: 'Car wash', description: 'Stored wash', price: 45000, timeCost: 30, isActive: true, updatedAt: '2026-11-09T00:00:00Z' };
    const data = name === 'search_services' ? { items: [serviceRecord], total: 1, returned: 1 }
      : name === 'get_service_detail' ? serviceRecord
      : name === 'get_service_stats' ? { summary: { total: 24, active: 16, inactive: 8, averagePrice: 28750 } }
      : name === 'get_ticket_package_detail' ? packageRecord
      : name === 'search_ticket_packages' ? { items: [packageRecord], total: 1, returned: 1 }
      : name === 'get_ticket_package_stats' ? { summary: { total: 4, active: 2, inactive: 2, latestUpdated: packageRecord.updatedAt }, byType: [] }
      : name === 'get_subscription_stats'
      ? { summary: { sold: 2, total: 12, active: 1, expiringSoon: 2, pendingTransfers: 3 }, financialCoverage: 'partial' }
      : name === 'get_subscription_members'
      ? { items: [{ _id: id, user: { email: 'member_user@example.test' }, ticketPackage: { name: 'Monthly VIP' }, status: 'active', amount: 150000 }], total: 1, returned: 1 }
      : name === 'search_sessions'
      ? { items: [{ _id: id, licensePlate: '43A11111', phone: args.phone, status: 'completed', imageAvailability: { entry: true, exit: false } }], total: 1, returned: 1 }
      : name === 'get_current_user'
      ? { _id: otherId, username: 'admin_self', email: 'self_admin@example.test', role: 'admin', status: true }
      : { items: [{ _id: id, email: args?.query?.includes('@') ? args.query : 'isolated@example.test', role: 'customer', createdAt: '2020-01-01T00:00:00Z' }], total: 1, returned: 1 };
    return { tool: name, source: name, timestamp: new Date().toISOString(), parameters: args || {}, data };
  },
});
replace('../services/aiCopilot/draftService', { createDraft: async input => { drafts++; return { _id: otherId, type: input.type, payload: JSON.parse(JSON.stringify(input.payload)), current: { price: 45000 }, status: 'PENDING' }; } });
replace('../models/AIAuditLog', { create: async () => { if (auditError) throw new Error('audit unavailable'); } });
const { chat, prohibitsDraft, classifyError, isIdentityRequest, isMembershipRequest, isTicketPackageRequest, explicitPackageName } = require('../services/aiCopilot/chatService');
const call = (name, args = {}) => ({ functionCalls: () => [{ name, args }], candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] });
const text = message => ({ text: () => message, functionCalls: () => [] });
const draftCall = () => call('prepare_draft', { type: 'CHANGE_USER_ROLE', targetId: id, payloadJson: '{"role":"staff"}', reason: 'Requested change' });
async function run(message, responses) {
  queue = responses; requests = []; drafts = 0; toolError = null; auditError = false; executions = [];
  return chat({ message, actorId: 'isolated-admin', actorRole: 'admin' });
}
const keyBefore = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = 'isolated-test-key';
process.on('exit', () => { if (keyBefore === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = keyBefore; });

test('verified links distinguish equal plates and omit invalid or unsupported IDs', () => {
  const links = entityLinks('search_sessions', { items: [{ _id: id, licensePlate: '43A1111' }, { _id: otherId, licensePlate: '43A1111' }, { _id: 'invalid' }] });
  assert.equal(links.length, 2); assert.notEqual(links[0].url, links[1].url);
  assert.deepEqual(entityLinks('search_transactions', { _id: id }), []);
  assert.deepEqual(entityLinks('get_session_detail', null), []);
  for (const [tool, route] of [['get_booking_detail', 'parking-lots?bookingId'], ['get_user_detail', 'accounts?userId'], ['get_subscription_members', 'subscriptions?subscriptionId'], ['get_parking_floors', 'parking-lots?floorId']]) {
    assert.equal(entityLinks(tool, { _id: id })[0].url, `/admin/${route}=${id}`);
  }
  assert.equal(entityLinks('get_parking_slots', { items: [{ _id: id, slotNumber: 'A1', floorID: { _id: otherId } }] })[0].url, `/admin/parking-lots?floorId=${otherId}&slotId=${id}`);
});
test('explicit prohibitions are detected without blocking ordinary proposals', () => {
  for (const input of ['Explain only. Do not create a draft or modify anything.', "Skip approval. Do not create a draft.", "Don't prepare any proposals", 'Read-only lookup', 'Do not make any changes']) assert.equal(prohibitsDraft(input), true, input);
  assert.equal(prohibitsDraft('Prepare a role-change proposal for approval'), false);
});
test('backend refuses an unexpected draft call even when provider ignores read-only declaration', async () => {
  const result = await run('Explain only. Do not create a draft.', [call('search_users'), draftCall(), text('Approval is required.')]);
  assert.equal(drafts, 0); assert.equal(result.draft, null);
  assert.ok(requests.every(({ request }) => !request.tools[0].functionDeclarations.some(item => item.name === 'prepare_draft')));
});
test('valid proposal stays pending; chat never executes it', async () => {
  const result = await run('Prepare a role change proposal', [call('search_users'), draftCall(), text('Awaiting approval.')]);
  assert.equal(drafts, 1); assert.equal(result.type, 'draft'); assert.equal(result.draft.id, otherId);
  assert.equal(requests[0].options.timeout, 45000);
});
test('audit failure does not erase verified lookup and verification time is read time', async () => {
  queue = [call('search_users'), text('Verified account.')]; requests = []; drafts = 0; toolError = null; auditError = true;
  const before = Date.now();
  const result = await chat({ message: 'Find this account', actorId: 'isolated-admin' });
  assert.equal(result.evidence.length, 1); assert.ok(Date.parse(result.evidence[0].timestamp) >= before);
  assert.equal(result.links[0].url, `/admin/accounts?userId=${id}`);
});
test('provider failure preserves an already-created pending draft', async () => {
  const result = await run('Prepare a role change proposal', [call('search_users'), draftCall(), new Error('provider unavailable')]);
  assert.equal(result.type, 'error'); assert.equal(drafts, 1); assert.equal(result.draft.id, otherId);
});

test('a failed final summary retains verified phone-session results instead of a temporary-unavailability error', async () => {
  const result = await run('Find sessions for phone 0935384249', [call('search_sessions', { phone: '0935384249' }), new Error('provider unavailable')]);
  assert.equal(result.type, 'analysis'); assert.equal(result.draft, null);
  assert.equal(result.accountResult, null);
  assert.equal(result.evidence[0].data.items[0].phone, '0935384249');
  assert.equal(result.evidence[0].data.items[0].licensePlate, '43A11111');
  assert.equal(result.links[0].url, `/admin/sessions?sessionId=${id}`);
  assert.ok(!result.message.includes('unavailable'));
});

test('membership intent bypasses the account shortcut, resolves the owner, and rejects account-only answers', async () => {
  assert.equal(isIdentityRequest('Show my account membership details'), false);
  assert.equal(isIdentityRequest('Show my VIP membership'), false);
  assert.equal(isIdentityRequest('Show my account'), true);
  assert.equal(isMembershipRequest('List VIP accounts'), false);
  assert.equal(isMembershipRequest('Find account membership@example.test'), false);
  const result = await run('Show my account membership details', [call('get_current_user'), text('Your account is Admin.'), call('get_subscription_members', { userId: otherId, status: 'all' }), text('Membership verified.')]);
  assert.equal(result.accountResult, null); assert.equal(result.type, 'analysis');
  assert.deepEqual(executions.map(entry => entry.name), ['get_current_user', 'get_subscription_members']);
  assert.equal(result.links.find(link => link.url.startsWith('/admin/subscriptions')).url, `/admin/subscriptions?subscriptionId=${id}`);
  assert.equal(drafts, 0);
  assert.ok(requests.every(({ request }) => !request.tools[0].functionDeclarations.some(tool => tool.name === 'prepare_draft')));
});

test('verified membership records and statistics survive final-summary failure', async () => {
  for (const name of ['get_subscription_members', 'get_subscription_stats']) {
    const result = await run('Show VIP membership statistics and records', [call(name), new Error('provider unavailable')]);
    assert.equal(result.type, 'analysis'); assert.equal(result.accountResult, null);
    assert.equal(result.evidence[0].tool, name); assert.equal(result.draft, null);
    assert.equal(result.message, '');
  }
});

test('requested membership KPI and vehicle fields override incorrect provider arguments and survive summary failure', async () => {
  const stats = await run('VIP statistics: Expiring Soon and Pending Transfers only', [call('get_subscription_stats', { kpis: ['expiringWithin7Days', 'pending'] }), new Error('provider unavailable')]);
  assert.deepEqual(executions[0].args.kpis, ['expiringSoon', 'pendingTransfers']);
  assert.deepEqual(stats.membershipPresentation.kpis, ['expiringSoon', 'pendingTransfers']);
  const search = await run('Find cancelled memberships with expiry date and linked vehicle plates', [call('get_subscription_members', { status: 'cancelled' }), text('Verified membership records.')]);
  assert.equal(executions[0].args.includeVehicles, true);
  assert.equal(executions[0].args.status, 'cancelled');
  assert.equal(search.membershipPresentation.includeExpiry, true);
  assert.equal(search.membershipPresentation.includeVehicles, true);
});

test('exact four-VIP-KPI prompt returns all dashboard KPIs in one read without the narrow-question loop', async () => {
  const prompt = 'Show only these four VIP membership KPIs: Total VIP, Active, Expiring Soon within 30 days, and Pending Transfers.';
  const result = await run(prompt, Array.from({ length: 5 }, () => call('search_users')));
  assert.equal(isMembershipRequest(prompt), true);
  assert.equal(isIdentityRequest(prompt), false);
  assert.equal(result.type, 'analysis', result.message);
  assert.deepEqual([...result.membershipPresentation.kpis].sort(), ['total', 'active', 'expiringSoon', 'pendingTransfers'].sort());
  assert.deepEqual(executions.map(entry => entry.name), ['get_subscription_stats']);
  assert.deepEqual([...executions[0].args.kpis].sort(), ['total', 'active', 'expiringSoon', 'pendingTransfers'].sort());
  assert.equal(requests.length, 0);
  assert.equal(result.evidence[0].tool, 'get_subscription_stats');
  for (const [key, value] of Object.entries({ total: 12, active: 1, expiringSoon: 2, pendingTransfers: 3 })) assert.equal(result.evidence[0].data.summary[key], value);
  assert.equal(executions[0].role, 'admin');
  assert.equal(result.accountResult, null); assert.equal(result.draft, null); assert.equal(drafts, 0);
  assert.ok(!result.message.includes('narrow'));
});

test('the four-KPI read reports a source failure instead of fabricated counts or a narrowing rejection', async () => {
  queue = []; requests = []; executions = []; toolError = new Error('source unavailable');
  try {
    const result = await chat({ message: 'Show only these four VIP membership KPIs: Total VIP, Active, Expiring Soon within 30 days, and Pending Transfers.', actorId: 'isolated-admin', actorRole: 'admin' });
    assert.equal(result.type, 'error'); assert.equal(result.evidence.length, 0);
    assert.equal(result.message, 'Unable to load the requested membership KPIs. Please try again.');
    assert.equal(requests.length, 0); assert.equal(result.draft, null);
  } finally { toolError = null; }
});

test('a missing membership returns the verified error instead of an account card or fabricated detail', async () => {
  queue = [call('get_subscription_detail', { subscriptionId: id }), text('An account exists.')]; requests = []; executions = [];
  toolError = Object.assign(new Error('Membership not found.'), { code: 'MEMBERSHIP_NOT_FOUND', publicMessage: 'Membership not found.' });
  try {
    const result = await chat({ message: 'Show membership details', actorId: 'isolated-admin', actorRole: 'admin' });
    assert.equal(result.type, 'error'); assert.equal(result.message, 'Membership not found.');
    assert.equal(result.accountResult, null); assert.equal(result.links.length, 0);
  } finally { toolError = null; }
});

test('Ticket Package queries expose only catalog reads, preserve verified data on summary failure, and block proposals', async () => {
  assert.equal(isTicketPackageRequest('Find inactive daily ticket packages'), true);
  assert.equal(isTicketPackageRequest('Show memberships for ticket package Monthly'), false);
  assert.equal(isTicketPackageRequest('Show session details with its ticket package'), false);
  assert.equal(isTicketPackageRequest('Find account with username package'), false);
  assert.equal(isMembershipRequest('VIP statistics by package'), true);
  const result = await run('Find inactive daily ticket packages', [call('search_ticket_packages', { type: 'daily', status: 'inactive' }), new Error('provider unavailable')]);
  assert.equal(result.type, 'analysis'); assert.equal(result.accountResult, null);
  assert.equal(result.evidence[0].data.items[0].name, 'Gold_Pass');
  assert.equal(result.links[0].url, `/admin/tickets?packageId=${id}`);
  assert.ok(requests.every(({ request }) => request.tools[0].functionDeclarations.every(tool => ['search_ticket_packages', 'get_ticket_package_detail', 'get_ticket_package_stats'].includes(tool.name))));
  const blocked = await run('Create a ticket package', [call('prepare_draft', { type: 'CREATE_TICKET_PACKAGE', payloadJson: '{}' }), text('A package was created.')]);
  assert.equal(blocked.type, 'error'); assert.equal(blocked.draft, null); assert.equal(drafts, 0);
  assert.equal(blocked.message, 'Ticket Package support is read-only. No changes were made.');
});

test('an explicit package name replaces the previous turn identity even if the provider selects the stale ID', async () => {
  const first = await run('Find Premium Monthly ticket package', [call('search_ticket_packages', { query: 'Premium Monthly' }), text('Premium Monthly')]);
  assert.equal(first.evidence[0].data.name, 'Premium Monthly');
  queue = [call('get_ticket_package_detail', { packageId: id }), text('Premium Monthly')];
  executions = [];
  const second = await chat({ message: 'Show full details of the VIP Yearly ticket package, including description, price, type, status, and last updated time.', conversationId: first.conversationId, actorId: 'isolated-admin', actorRole: 'admin' });
  assert.equal(second.conversationId, first.conversationId);
  assert.equal(second.evidence[0].data.name, 'VIP Yearly');
  assert.deepEqual(executions, [{ name: 'get_ticket_package_detail', args: { name: 'VIP Yearly' }, role: 'admin', context: { actorId: 'isolated-admin' } }]);
  assert.equal(second.links[0].url, `/admin/tickets?packageId=${otherId}`);
  assert.ok(!JSON.stringify(second).includes('Premium Monthly'));
  assert.equal(queue.length, 2); // Provider history cannot override explicit identity.
});

test('explicit package identity extraction leaves filters, pronouns, and other entities unchanged', () => {
  assert.equal(explicitPackageName('Show full details of the VIP Yearly ticket package, including description.'), 'VIP Yearly');
  assert.equal(explicitPackageName('Show ticket package named "VIP Yearly".'), 'VIP Yearly');
  for (const message of ['Find inactive daily ticket packages', 'Show monthly ticket package', 'Show this ticket package', 'Show memberships for ticket package Monthly', 'Show session details with its ticket package', 'Create VIP Yearly ticket package']) assert.equal(explicitPackageName(message), null, message);
});

test('a failed explicitly named lookup never falls back to the previous package', async () => {
  const first = await run('Find Premium Monthly ticket package', []);
  toolError = Object.assign(new Error('missing'), { publicMessage: 'Ticket package not found.' });
  try {
    const result = await chat({ message: 'Show full details of the Missing Yearly ticket package', conversationId: first.conversationId, actorId: 'isolated-admin' });
    assert.equal(result.type, 'error'); assert.equal(result.message, 'Ticket package not found.');
    assert.deepEqual(result.evidence, []); assert.deepEqual(result.links, []);
  } finally { toolError = null; }
});

test('package mutations remain unavailable on indirect follow-ups without weakening other draft types', async () => {
  const blocked = await run('Change its price to 20000', [call('prepare_draft', { type: 'UPDATE_TICKET_PACKAGE', targetId: id, payloadJson: '{"price":20000}' }), text('Price updated.')]);
  assert.equal(blocked.type, 'error'); assert.equal(drafts, 0); assert.equal(blocked.draft, null);
  assert.equal(blocked.message, 'Ticket Package support is read-only. No changes were made.');
  for (const { request } of requests) {
    const proposal = request.tools[0].functionDeclarations.find(tool => tool.name === 'prepare_draft');
    assert.ok(proposal.parameters.properties.type.enum.includes('CHANGE_USER_ROLE'));
    assert.ok(proposal.parameters.properties.type.enum.every(type => !['CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE', 'ARCHIVE_TICKET_PACKAGE'].includes(type)));
  }
});
test('service sorting keeps verified results when final synthesis fails', async () => {
  const result = await run('Show services by price highest to lowest', [call('search_services', { sortBy: 'price', sortOrder: 'desc' }), new Error('provider unavailable')]);
  assert.equal(result.type, 'analysis'); assert.equal(result.message, '');
  assert.equal(result.evidence[0].data.items[0].name, 'Car wash');
  assert.deepEqual(executions[0].args, { sortBy: 'price', sortOrder: 'desc' });
  assert.equal(result.links[0].url, `/admin/services?serviceId=${id}`);
});

test('service dashboard statistics require the canonical aggregate instead of model arithmetic on a search page', async () => {
  const result = await run('Show service statistics and average price', [call('get_service_stats'), text('Estimated average: 1 VND')]);
  assert.equal(result.evidence[0].data.summary.averagePrice, 28750);
  assert.deepEqual(requests[0].request.toolConfig.functionCallingConfig.allowedFunctionNames, ['get_service_stats']);
});

test('service edit demo uses verified search evidence and returns a pending delta proposal without another model loop', async () => {
  const result = await run('Show a draft: prepare a demo service price change to 50000 VND', [call('search_services', { name: 'Car wash' }), call('prepare_draft', { type: 'UPDATE_SERVICE', targetId: id, payloadJson: '{"price":50000}', reason: 'Requested demo proposal' })]);
  assert.equal(result.type, 'draft'); assert.equal(result.draft.type, 'UPDATE_SERVICE');
  assert.equal(result.draft.status, 'PENDING'); assert.deepEqual(result.draft.payload, { price: 50000 });
  assert.equal(drafts, 1); assert.equal(requests.length, 2);
  assert.ok(requests[0].request.tools[0].functionDeclarations.some(tool => tool.name === 'prepare_draft'));
  const unverified = await run('Prepare a demo service price change', [call('search_services'), call('prepare_draft', { type: 'UPDATE_SERVICE', targetId: otherId, payloadJson: '{"price":50000}' }), text('Please identify the service.')]);
  assert.equal(unverified.draft, null); assert.equal(drafts, 0);
  const readOnly = await run('Read-only: prepare a demo service price change', [call('search_services'), call('prepare_draft', { type: 'UPDATE_SERVICE', targetId: id, payloadJson: '{"price":50000}' }), text('No changes made.')]);
  assert.equal(readOnly.draft, null); assert.equal(drafts, 0);
});

test('Staff active customer listing forces both backend filters and ignores stale model role/status arguments', async () => {
  queue = [call('search_users', { role: 'admin', status: false, limit: 10 }), text('Customers found.')]; requests = []; drafts = 0; toolError = null; auditError = false; executions = [];
  await chat({ message: 'Show all active customer accounts', actorId: 'isolated-staff', actorRole: 'staff' });
  assert.equal(executions[0].args.role, 'customer'); assert.equal(executions[0].args.status, true);
  assert.ok(requests.every(({ request }) => request.tools[0].functionDeclarations.every(tool => tool.name === 'search_users')));
});

test('provider and tool errors never produce fabricated successful data', async () => {
  let result = await run('Find account', [new Error('provider unavailable')]);
  assert.equal(result.type, 'error'); assert.equal(result.draft, null); assert.equal(result.evidence.length, 0);
  queue = [call('search_users'), text('Unable to retrieve account.')]; requests = []; toolError = new Error('invalid parameters');
  result = await chat({ message: 'Find account', actorId: 'isolated-admin' });
  assert.equal(result.evidence.length, 0); assert.equal(result.links.length, 0);
  assert.equal(classifyError({ status: 429 }, ''), 'GEMINI_RATE_LIMIT');
  assert.equal(classifyError({ name: 'AbortError' }, ''), 'GEMINI_TIMEOUT');
  assert.equal(classifyError(new Error('Request aborted when fetching provider'), 'GEMINI_FINAL_SYNTHESIS_START'), 'GEMINI_TIMEOUT');
  assert.equal(classifyError({ status: 404 }, 'GEMINI_FINAL_SYNTHESIS_START'), 'GEMINI_MODEL_ERROR');
});
test('registry rejects unauthorized roles and staff-only access to admin tools', async () => {
  assert.deepEqual(actualRegistry.getToolsForRole('customer'), []);
  await assert.rejects(actualRegistry.execute('get_pricing_config', {}, 'customer'));
  await assert.rejects(actualRegistry.execute('get_pricing_config', {}, 'staff'));
  assert.throws(() => actualRegistry.validateDates({ startDate: 'invalid' }));
});
test('existing session and subscription verification reject stale or unauthorized responses', async () => {
  const frontend = path.resolve(__dirname, '../../../frontend/src');
  const session = await import(pathToFileURL(path.join(frontend, 'pages/Staff/sessionDeepLink.js')));
  const subscription = await import(pathToFileURL(path.join(frontend, 'pages/Admin/subscriptionDeepLink.js')));
  const published = []; let finish;
  const verifier = session.createSessionVerification(() => new Promise(resolve => { finish = resolve; }), value => published.push(value));
  const pending = verifier.verify('admin', id, 'first'); verifier.cancel();
  finish({ ok: true, data: { success: true, data: [{ _id: id }] } }); await pending;
  assert.equal(published.at(-1).status, 'loading');
  const states = [];
  await subscription.createSubscriptionLookup(async () => ({ status: 403 }), value => states.push(value)).load(id);
  assert.equal(states.at(-1).status, 'unavailable');
  assert.equal(subscription.includeLinkedSubscription([{ _id: id }], [{ _id: id }], id).length, 1);
});
test('notification links resolve matching entities and reject mismatched session IDs', async () => {
  const frontend = path.resolve(__dirname, '../../../frontend/src');
  const { notificationClickTarget } = await import(pathToFileURL(path.join(frontend, 'features/valo-ai/utils/notificationTarget.js')));
  assert.equal(notificationClickTarget({ entityType: 'User', entityId: id, targetRoute: `/admin/accounts?userId=${id}` }, 'admin'), `/admin/accounts?userId=${id}`);
  assert.equal(notificationClickTarget({ entityType: 'session', entityId: id, targetRoute: `/admin/sessions?sessionId=${otherId}` }, 'admin'), null);
  assert.equal(notificationClickTarget({ entityType: 'session', entityId: id, targetRoute: '/admin/sessions', notificationType: 'SESSION_OVERDUE' }, 'admin'), `/admin/sessions?sessionId=${id}`);
});

test('role draft validation rejects unchanged roles and missing accounts before persistence', async () => {
  const User = require('../models/User'); const original = User.findById;
  try {
    User.findById = accountId => ({ select: () => ({ lean: async () => String(accountId) === otherId ? { role: 'admin', status: true } : { role: 'staff', status: true } }) });
    await assert.rejects(actualDraftService.createDraft({ adminUserId: otherId, type: 'CHANGE_USER_ROLE', targetId: id, payload: { role: 'staff' } }), error => error.statusCode === 409 && error.publicMessage === 'The account already has this role. No changes are needed.');
    await assert.rejects(actualDraftService.createDraft({ adminUserId: otherId, type: 'UPDATE_USER_STATUS', targetId: id, payload: { status: true } }), error => error.code === 'NO_CHANGE' && error.publicMessage === 'The account already has this status. No changes are needed.');
    await assert.rejects(actualDraftService.createDraft({ adminUserId: otherId, type: 'CHANGE_USER_ROLE', targetId: otherId, payload: { role: 'staff' } }), error => error.code === 'SELF_PRIVILEGE_CHANGE' && /administrative access/.test(error.publicMessage));
    User.findById = accountId => ({ select: () => ({ lean: async () => String(accountId) === otherId ? { role: 'admin', status: true } : null }) });
    await assert.rejects(actualDraftService.createDraft({ adminUserId: otherId, type: 'CHANGE_USER_ROLE', targetId: id, payload: { role: 'admin' } }), error => error.statusCode === 404 && error.publicMessage === 'Account not found. No changes were made.');
  } finally { User.findById = original; }
});
test('approval rejects already-processed, expired, and other-admin proposals before writes', async () => {
  const Draft = require('../models/AIDraft'); const original = Draft.findOne;
  const User = require('../models/User'); const originalUser = User.findById;
  User.findById = () => ({ select: () => ({ lean: async () => ({ role: 'admin', status: true }) }) });
  try {
    Draft.findOne = async filter => { assert.equal(filter.adminUserId, otherId); return null; };
    await assert.rejects(actualDraftService.approveDraft(id, otherId), error => error.statusCode === 404);
    Draft.findOne = async () => ({ status: 'REJECTED', type: 'CHANGE_USER_ROLE' });
    await assert.rejects(actualDraftService.approveDraft(id, otherId), error => error.statusCode === 409);
    Draft.findOne = async () => ({ status: 'PENDING', type: 'CHANGE_USER_ROLE', expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(actualDraftService.approveDraft(id, otherId), error => error.statusCode === 409);
  } finally { Draft.findOne = original; User.findById = originalUser; }
});
test('notification API persists a single read idempotently and filters unread counts', async () => {
  const Notification = require('../models/AINotification');
  const original = { findOneAndUpdate: Notification.findOneAndUpdate, find: Notification.find, countDocuments: Notification.countDocuments };
  const router = require('../routes/aiCopilotRoutes');
  const admin = router.stack.filter(layer => layer.handle?.stack?.some(entry => entry.route?.path === '/notifications')).at(-1).handle;
  const handler = (route, method) => admin.stack.find(layer => layer.route?.path === route && layer.route.methods[method]).route.stack[0].handle;
  const row = { _id: id, targetRoles: ['admin'], readBy: [], dismissedBy: [], severity: 'WARNING' };
  const eligible = filter => !filter.readBy || !row.readBy.includes(filter.readBy.$ne);
  try {
    Notification.findOneAndUpdate = async (filter, update) => {
      assert.equal(filter._id, id); assert.ok(filter.$or.some(condition => condition.targetRoles === 'admin'));
      const reader = update.$addToSet.readBy;
      if (!row.readBy.includes(reader)) row.readBy.push(reader);
      return row;
    };
    Notification.find = filter => { const query = { sort: () => query, skip: () => query, limit: () => query, populate: () => query, lean: async () => eligible(filter) ? [row] : [] }; return query; };
    Notification.countDocuments = async filter => eligible(filter) ? 1 : 0;
    let body, status = 200;
    const res = { status: value => { status = value; return res; }, json: value => { body = value; } };
    const request = { params: { id }, user: { _id: otherId }, query: { filter: 'unread' } };
    await handler('/notifications', 'get')(request, res); assert.equal(body.data.unreadCount, 1);
    await handler('/notifications/:id/read', 'patch')(request, res); assert.equal(body.success, true);
    await handler('/notifications/:id/read', 'patch')(request, res); assert.equal(row.readBy.length, 1);
    await handler('/notifications', 'get')(request, res); assert.equal(body.data.unreadCount, 0); assert.equal(body.data.notifications.length, 0);
    request.query.filter = 'all'; await handler('/notifications', 'get')(request, res); assert.equal(body.data.notifications[0].isRead, true);
    Notification.findOneAndUpdate = async () => { throw new Error('isolated database failure'); };
    await handler('/notifications/:id/read', 'patch')(request, res); assert.equal(status, 500); assert.equal(body.success, false);
  } finally { Object.assign(Notification, original); }
});

test('Markdown renders continuous ordered lists, verified links and escaped HTML', async () => {
  const frontend = path.resolve(__dirname, '../../../frontend');
  const frontendRequire = require('node:module').createRequire(path.join(frontend, 'package.json'));
  const React = frontendRequire('react');
  const { renderToStaticMarkup } = frontendRequire('react-dom/server');
  const { transformWithOxc } = await import(pathToFileURL(frontendRequire.resolve('vite')));
  const source = require('node:fs').readFileSync(path.join(frontend, 'src/features/valo-ai/components/AIMessageMarkdown.jsx'), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default function', 'function');
  const compiled = await transformWithOxc(source, 'AIMessageMarkdown.jsx', { jsx: { runtime: 'classic' } });
  const Component = new Function('React', 'Fragment', 'Link', `${compiled.code}; return AIMessageMarkdown;`)(React, React.Fragment, ({ to, children }) => React.createElement('a', { href: to }, children));
  const url = `/admin/sessions?sessionId=${id}`;
  const markup = renderToStaticMarkup(React.createElement(Component, {
    text: `1. Session A\n\n1. Session B\n\n[Verified](${url}) [Unsafe](javascript:alert) <script>alert(1)</script>`, links: [{ url }],
  }));
  assert.equal((markup.match(/<ol/g) || []).length, 1);
  assert.equal((markup.match(/<li/g) || []).length, 2);
  assert.ok(markup.includes(`href="${url}"`));
  assert.ok(!markup.includes('javascript:')); assert.ok(!markup.includes('<script>'));
  const continued = renderToStaticMarkup(React.createElement(Component, { text: '3. Third item' }));
  assert.ok(continued.includes('start="3"'));
  for (const value of ['valo_staff_test', 'valo_staff_test@example.test', 'my_account_test@example.test', 'valo\\_staff\\_test', 'valo\\_staff\\_test@example.test']) {
    const literal = renderToStaticMarkup(React.createElement(Component, { text: value }));
    assert.ok(literal.includes(value.replace(/\\_/g, '_')), literal);
    assert.ok(!literal.includes('<em>'), literal);
  }
  const emphasis = renderToStaticMarkup(React.createElement(Component, { text: '_Active_ **valo\\_staff\\_test** __Inactive__ `valo_staff_test`' }));
  assert.ok(emphasis.includes('<em>Active</em>'));
  assert.ok(emphasis.includes('<strong>valo_staff_test</strong>'));
  assert.ok(emphasis.includes('<strong>Inactive</strong>'));
  assert.ok(emphasis.includes('<code>valo_staff_test</code>'));
});

test('information requests suppress proposal tools without weakening factual grounding', async () => {
  const result = await run('Find this account', [draftCall(), text('Unverified account information')]);
  assert.equal(drafts, 0); assert.equal(result.draft, null); assert.equal(result.evidence.length, 0);
  assert.notEqual(result.message, 'Unverified account information');
  assert.equal(requests[0].request.toolConfig.functionCallingConfig.mode, 'ANY');
});

test('Admin account responses retain action explanations, deduplicate links, and retire stale reads', async (t) => {
  const frontend = path.resolve(__dirname, '../../../frontend');
  const fe = require('node:module').createRequire(path.join(frontend, 'package.json'));
  const React = fe('react'); const { renderToStaticMarkup } = fe('react-dom/server');
  const { Link, MemoryRouter } = fe('react-router-dom');
  const { ArrowRight, ArrowUpRight, Clock3 } = fe('lucide-react');
  const { adminDate, adminValue, readableLabel } = await import(pathToFileURL(path.join(frontend, 'src/features/valo-ai/utils/adminPresentation.js')));
  const { transformWithOxc } = await import(pathToFileURL(fe.resolve('vite')));
  async function compile(relative, names, values, result) {
    const file = path.join(frontend, relative);
    const source = require('node:fs').readFileSync(file, 'utf8').replace(/^import .*;$/gm, '').replace(/export default function/g, 'function').replace(/export function/g, 'function');
    const { code } = await transformWithOxc(source, file, { jsx: { runtime: 'classic' } });
    return new Function('React', ...names, `${code}; return ${result};`)(React, ...values);
  }
  const Markdown = await compile('src/features/valo-ai/components/AIMessageMarkdown.jsx', ['Fragment', 'Link'], [React.Fragment, Link], 'AIMessageMarkdown');
  const { AdminChatAnswer, AdminDraft } = await compile('src/features/valo-ai/components/AdminChatContent.jsx', ['Link','ArrowRight','ArrowUpRight','Clock3','AIMessageMarkdown','adminDate','adminValue','readableLabel'], [Link,ArrowRight,ArrowUpRight,Clock3,Markdown,adminDate,adminValue,readableLabel], '{ AdminChatAnswer, AdminDraft }');
  const render = (Component, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Component, props)));
  const account = { _id: id, email: 'account@example.test', role: 'admin', status: true };
  const links = entityLinks('get_user_detail', account);
  const row = { type: 'analysis', links, evidence: [{ tool: 'get_user_detail', data: account }] };
  for (const [type, message] of [
    ['error', 'You cannot change your own role or account status because this could remove your administrative access. No changes were made.'],
    ['no_op', 'The account already has this role. No changes are needed.'],
    ['no_op', 'The account already has this status. No changes are needed.'],
    ['error', 'Account not found. No changes were made.'],
  ]) {
    const html = render(AdminChatAnswer, { row: { ...row, type, message, accountResult: { items: [account], total: 1 } } });
    assert.ok(html.includes(message)); assert.ok(!html.includes('admin-ai-result-row'));
  }
  const explained = render(AdminChatAnswer, { row: { ...row, message: 'This action is forbidden. No changes were made.', accountResult: { items: [account], total: 1 } } });
  assert.ok(explained.includes('This action is forbidden.'));
  const empty = render(AdminChatAnswer, { row: { type: 'analysis', message: '0 accounts found.\n**Source**: accounts\n**Timestamp**: internal\n**Account ID**: internal', accountResult: { items: [], total: 0 } } });
  assert.equal((empty.match(/0 accounts found/g) || []).length, 1);
  assert.ok(!empty.includes('internal')); assert.ok(!empty.includes('Source'));
  for (const message of ['I found 0 accounts for missing_user@example.test.', 'No accounts found for missing_user@example.test.']) {
    const html = render(AdminChatAnswer, { row: { type: 'analysis', message, accountResult: { items: [], total: 0 } } });
    assert.equal((html.match(/0 accounts found/g) || []).length, 1);
    assert.ok(!html.includes(message));
  }
  const facts = render(AdminChatAnswer, { row: { ...row, message: 'You are signed in as account@example.test, Admin.\n**Email**: account@example.test\n**Status**: true\n1 account found.', accountResult: { items: [account], total: 1, authenticated: true } } });
  assert.equal((facts.match(/>account@example.test</g) || []).length, 1);
  assert.ok(!facts.includes('signed in as')); assert.ok(!facts.includes('Status: true'));
  assert.ok(facts.includes('Active'));
  for (const [value, label] of [['true', 'Active'], ['false', 'Inactive']]) {
    const normalized = render(AdminChatAnswer, { row: { type: 'analysis', message: `The account has **status**: ${value}.` } });
    assert.ok(normalized.includes(`Status: ${label}`), normalized);
    assert.ok(!normalized.includes(value), normalized);
  }
  const cleaned = render(AdminChatAnswer, { row: { ...row, message: `[Account Link](${links[0].url})\nAccount Link: ${id}\nUser ID: ${id}` } });
  assert.equal((cleaned.match(/>View Account</g) || []).length, 1);
  assert.ok(!cleaned.includes('Account Link')); assert.ok(!cleaned.includes('User ID'));
  const stale = render(AdminChatAnswer, { row: { ...row, accountStale: true, accountResult: { items: [account], total: 1 } } });
  assert.ok(stale.includes('Account information has changed.')); assert.ok(!stale.includes('admin-ai-result-row'));
  assert.ok(stale.includes(`href="${links[0].url}"`));
  const draft = { type: 'CHANGE_USER_ROLE', status: 'EXECUTED', current: account, payload: { role: 'staff' }, evidence: row.evidence };
  const applied = render(AdminDraft, { draft });
  assert.ok(applied.includes('Before')); assert.ok(applied.includes('After'));
  assert.ok(applied.includes('Admin')); assert.ok(applied.includes('Staff')); assert.ok(!applied.includes('<button'));

  await t.test('single account renders one literal card and action without generated summaries or metadata', () => {
    const literal = { ...account, username: 'valo_staff_test', email: 'valo_staff_test@example.test', membership: { isVip: false }, vipActive: false };
    const accountLinks = entityLinks('get_user_detail', literal);
    const message = `Here is the requested account: valo_staff_test@example.test.\nAccount Status: Active\nMembership Status: VIP\nSource: search_users\nVerified at: 2026-11-07T12:00:00Z\n[View Account](${accountLinks[0].url}))\nView Account)\n1 account found.`;
    for (const structured of [true, false]) {
      const html = render(AdminChatAnswer, { row: { type: 'analysis', message, links: [...accountLinks, ...accountLinks], evidence: [{ tool: 'get_user_detail', data: literal }], ...(structured ? { accountResult: { items: [literal], total: 1 } } : {}) } });
      assert.equal((html.match(/class="admin-ai-result-row"/g) || []).length, 1);
      assert.equal((html.match(/>View Account</g) || []).length, 1);
      assert.equal((html.match(/>valo_staff_test@example.test</g) || []).length, 1);
      assert.ok(html.includes('>valo_staff_test</strong>'));
      assert.ok(html.includes(`href="${accountLinks[0].url}"`));
      for (const redundant of ['Source', 'Verified', 'View Account)', '1 account found', 'Here is the requested', 'Membership Status: VIP']) assert.ok(!html.includes(redundant), redundant);
      assert.ok(html.includes('Membership Status: Standard'));
    }
    const refusal = render(AdminChatAnswer, { row: { type: 'error', message: 'You cannot change your own role. No changes were made. (Source: account read; verified at: 2026-11-07T12:00:00Z)\nView Account)' } });
    assert.ok(refusal.includes('You cannot change your own role. No changes were made.'));
    assert.ok(!refusal.includes('Source')); assert.ok(!refusal.includes('verified')); assert.ok(!refusal.includes('View Account)'));
  });

  await t.test('account and membership statuses remain separate and use only verified membership facts', () => {
    const verifiedAt = '2026-11-07T12:00:00Z';
    const cases = [
      [{ status: true, membership: { isVip: false }, vipActive: false }, 'Active', 'Standard'],
      [{ status: true, membership: { isVip: true, expireAt: '2026-11-06T12:00:00Z' }, vipActive: false }, 'Active', 'Expired'],
      [{ status: false, membership: { isVip: true, expireAt: '2026-11-08T12:00:00Z' }, vipActive: true }, 'Inactive', 'VIP'],
      [{ membership: { isVip: true, expireAt: '2026-11-07T12:00:00Z' } }, 'Active', 'Expired'],
      [{ membership: { isVip: true, expireAt: '2026-11-07T12:00:01Z' } }, 'Active', 'VIP'],
      [{ membership: { isVip: true, expireAt: null } }, 'Active', 'VIP'],
      [{ membership: undefined }, 'Active', 'Unavailable'],
      [{ membership: { expireAt: '2026-11-08T12:00:00Z' } }, 'Active', 'Unavailable'],
      [{ membership: { isVip: true, expireAt: 'invalid' } }, 'Active', 'Unavailable'],
      [{ status: undefined, membership: { isVip: false } }, 'Unavailable', 'Standard'],
    ];
    for (const [fields, status, membership] of cases) {
      const item = { ...account, ...fields };
      const html = render(AdminChatAnswer, { row: { type: 'analysis', message: 'Membership Status: Active', accountResult: { items: [item], total: 1 }, links, evidence: [{ tool: 'get_user_detail', data: item, timestamp: verifiedAt }, { tool: 'check_system_health', timestamp: '2026-11-09T12:00:00Z' }] } });
      assert.ok(html.includes(`Account Status: ${status}`), html);
      assert.ok(html.includes(`Membership Status: ${membership}`), html);
      assert.ok(!html.includes('Membership Status: Active'));
      assert.ok(!html.includes('2026-11-09'));
    }
    const item = { ...account, membership: { isVip: true, expireAt: '2026-11-08T12:00:00Z' } };
    const unverified = render(AdminChatAnswer, { row: { accountResult: { items: [item], total: 1 }, at: Date.parse(verifiedAt), links } });
    assert.ok(unverified.includes('Membership Status: Unavailable'));
  });

  await t.test('empty and list results show only their authoritative count', () => {
    for (const items of [[], [account, { ...account, _id: otherId, email: 'other_user@example.test' }]]) {
      const total = items.length;
      const html = render(AdminChatAnswer, { row: { type: 'analysis', message: `Here are ${total} accounts.\nSource: account search\nVerified: now\n${total} accounts found.`, accountResult: { items, total } } });
      assert.equal((html.match(new RegExp(`${total} accounts found`, 'g')) || []).length, 1);
      assert.ok(!html.includes('Here are')); assert.ok(!html.includes('Source')); assert.ok(!html.includes('Verified'));
    }
  });

  await t.test('session cards preserve exact facts, separate images, and render one action without summaries', () => {
    const session = { _id: id, licensePlate: '43A11111', phone: '0935384249', status: 'completed', paymentStatus: 'paid', totalPrice: 34000, checkInTime: '2026-11-06T17:00:00.000Z (00:00:00 07/11/2026 VN)', checkOutTime: '2026-11-06T18:00:00.000Z', imageAvailability: { entry: true, exit: false } };
    const sessionLinks = entityLinks('get_session_detail', session);
    const html = render(AdminChatAnswer, { row: { type: 'analysis', message: 'Session 43A1111 is active and both images are available.\nSource: session read\nVerified at: internal\nView Session)', links: [...sessionLinks, ...sessionLinks], evidence: [{ tool: 'get_session_detail', data: session }] } });
    assert.equal((html.match(/>View Session</g) || []).length, 1);
    assert.ok(html.includes(`href="/admin/sessions?sessionId=${id}"`));
    assert.ok(html.includes('>43A11111</strong>')); assert.ok(!html.includes('>43A1111<'));
    assert.ok(html.includes('Phone: 0935384249')); assert.ok(html.includes('Completed'));
    assert.ok(html.includes('34,000 VND')); assert.ok(html.includes('7 Nov 2026, 00:00'));
    assert.ok(html.includes('Entry image: Recorded')); assert.ok(html.includes('Exit image: Not recorded'));
    for (const extra of ['Source', 'Verified', 'internal', 'View Session)', 'both images are available', 'Additional information']) assert.ok(!html.includes(extra), extra);
    const unknown = render(AdminChatAnswer, { row: { links: sessionLinks, evidence: [{ tool: 'get_session_detail', data: { _id: id, licensePlate: '43A11111', status: 'completed' } }] } });
    assert.ok(unknown.includes('Entry image: Unverified')); assert.ok(unknown.includes('Exit image: Unverified'));
    const empty = render(AdminChatAnswer, { row: { message: 'No sessions found. Source: sessions', evidence: [{ tool: 'search_sessions', data: { items: [], total: 0 } }] } });
    assert.equal((empty.match(/No sessions found/g) || []).length, 1);
  });

  await t.test('membership cards prefer subscription evidence and use one View Membership link', () => {
    const membership = { _id: id, user: { username: 'original_user', email: 'original_user@example.test' }, currentOwners: [{ email: 'new_owner@example.test' }], ticketPackage: { name: 'Monthly VIP' }, status: 'active', effectiveStatus: 'expired', paymentStatus: 'paid', amount: 150000, expireAt: '2026-01-07T17:00:00.000Z', slots: [{ floorId: { name: 'Floor 1' }, slotCode: 'A1' }] };
    const membershipLinks = entityLinks('get_subscription_detail', membership);
    const html = render(AdminChatAnswer, { row: { accountResult: { items: [account], total: 1 }, message: 'Account summary. Source: internal', links: [...links, ...membershipLinks, ...membershipLinks], evidence: [{ tool: 'get_subscription_detail', data: membership }] } });
    assert.equal((html.match(/>View Membership</g) || []).length, 1);
    assert.ok(!html.includes('>View Account<'));
    assert.ok(html.includes(`href="/admin/subscriptions?subscriptionId=${id}"`));
    assert.ok(html.includes('Original purchaser: original_user / original_user@example.test'));
    assert.ok(html.includes('Current slot owners: new_owner@example.test'));
    assert.ok(html.includes('Membership Status: Expired')); assert.ok(html.includes('Stored status: Active'));
    assert.ok(html.includes('150,000 VND')); assert.ok(html.includes('Floor 1 / A1'));
    assert.ok(!html.includes('Source')); assert.ok(!html.includes('internal')); assert.ok(!html.includes('Account summary'));
    const stats = render(AdminChatAnswer, { row: { type: 'analysis', message: 'Unavailable provider summary', evidence: [{ tool: 'get_subscription_stats', data: { summary: { sold: 0, active: 4, activeReservedSlots: 2, grossAmount: 150000 }, byPackage: [{ packageName: 'Monthly VIP', sold: 1, amount: 150000, slots: 2 }], financialCoverage: 'partial' } }] } });
    assert.ok(stats.includes('Stored active records')); assert.ok(stats.includes('>4</dd>'));
    assert.ok(stats.includes('Subscriptions created in period')); assert.ok(stats.includes('>0</dd>'));
    assert.ok(stats.includes('Financial coverage is partial.')); assert.ok(stats.includes('Monthly VIP'));
    assert.ok(!stats.includes('Unavailable provider summary'));
    const empty = render(AdminChatAnswer, { row: { evidence: [{ tool: 'get_subscription_members', data: { items: [], total: 0 } }] } });
    assert.equal((empty.match(/No memberships found/g) || []).length, 1);
  });

  await t.test('membership KPI responses show only requested dashboard metrics without substitutes or extra sections', () => {
    const data = { summary: { active: 77, pending: 99, expiringWithin7Days: 88, expiringSoon: 3, pendingTransfers: 2, grossAmount: 123456 }, byPackage: [{ packageName: 'Unrequested package', sold: 1 }], timeline: { points: [{ period: '2026-11-08', packageSales: 100, renewalSales: 200 }] }, financialCoverage: 'partial' };
    const html = render(AdminChatAnswer, { row: { membershipPresentation: { kpis: ['expiringSoon', 'pendingTransfers'], byPackage: false, timeline: false }, evidence: [{ tool: 'get_subscription_stats', data }] } });
    assert.equal((html.match(/<dt>/g) || []).length, 2);
    assert.ok(html.includes('Expiring Soon (30 days)')); assert.ok(html.includes('Pending Transfers'));
    assert.ok(html.includes('>3</dd>')); assert.ok(html.includes('>2</dd>'));
    for (const extra of ['7 days', 'Pending subscriptions', '77', '99', '88', 'Unrequested package', 'Sales timeline', 'Financial coverage']) assert.ok(!html.includes(extra), extra);
    const unavailable = render(AdminChatAnswer, { row: { membershipPresentation: { kpis: ['pendingTransfers'] }, evidence: [{ tool: 'get_subscription_stats', data: { summary: { pending: 99 } } }] } });
    assert.ok(unavailable.includes('Pending Transfers')); assert.ok(unavailable.includes('Unavailable')); assert.ok(!unavailable.includes('99'));
  });

  await t.test('exact four-KPI prompt renders all four verified values and nothing from unrelated statistics', async () => {
    const prompt = 'Show only these four VIP membership KPIs: Total VIP, Active, Expiring Soon within 30 days, and Pending Transfers.';
    const result = await run(prompt, []);
    const html = render(AdminChatAnswer, { row: result });
    assert.equal((html.match(/<dt>/g) || []).length, 4);
    for (const [label, value] of [['Total Memberships', 12], ['Stored active records', 1], ['Expiring Soon (30 days)', 2], ['Pending Transfers', 3]]) assert.ok(html.includes(`<dt>${label}</dt><dd>${value}</dd>`), html);
    for (const extra of ['narrow your question', 'Subscriptions created in period', 'Pending subscriptions', 'Expiring within 7 days', 'Financial coverage', 'View Account']) assert.ok(!html.includes(extra), extra);
  });

  await t.test('requested expiry and exact linked plates are visible outside More information, even for cancelled memberships', () => {
    const membership = { _id: id, status: 'cancelled', effectiveStatus: 'cancelled', ticketPackage: { name: 'Monthly VIP' }, expireAt: '2026-01-07T17:00:00.000Z (00:00:00 08/01/2026 VN)', linkedVehicles: [{ ownerId: id, licensePlate: '43A11111' }, { ownerId: otherId, licensePlate: '43A1111' }] };
    const membershipLinks = entityLinks('get_subscription_detail', membership);
    const html = render(AdminChatAnswer, { row: { membershipPresentation: { includeExpiry: true, includeVehicles: true }, links: membershipLinks, evidence: [{ tool: 'get_subscription_detail', data: membership }] } });
    const visible = html.split('<details')[0];
    assert.ok(visible.includes('Expiry: 8 Jan 2026, 00:00'));
    assert.ok(visible.includes('Vehicles on file (purchaser/current owners): 43A11111, 43A1111'));
    assert.ok(visible.includes('Membership Status: Cancelled'));
    assert.equal((html.match(/>View Membership</g) || []).length, 1);
    assert.ok(html.includes(`href="/admin/subscriptions?subscriptionId=${id}"`));
  });

  await t.test('Service cards preserve verified order, values and exact links, and render dashboard statistics', () => {
    const service = { _id: id, name: 'Car wash', description: 'Stored <wash>', price: 0, timeCost: 45, isActive: false, updatedAt: '2026-11-09T00:00:00Z' };
    const data = { items: [service, { ...service, _id: otherId, name: 'Second wash' }], total: 2 };
    const html = render(AdminChatAnswer, { row: { message: 'Unverified prose', links: entityLinks('search_services', data), evidence: [{ tool: 'search_services', data }] } });
    for (const text of ['Stored &lt;wash&gt;', 'Price: 0 VND', 'Duration: 45 min', 'Status: Inactive', `href="/admin/services?serviceId=${id}"`]) assert.ok(html.includes(text), text);
    assert.equal((html.match(/>View Service</g) || []).length, 2);
    assert.ok(html.indexOf('Car wash') < html.indexOf('Second wash')); assert.ok(!html.includes('Unverified prose'));
    const stats = render(AdminChatAnswer, { row: { evidence: [{ tool: 'get_service_stats', data: { summary: { total: 24, active: 16, inactive: 8, averagePrice: 28750.4 } } }] } });
    assert.ok(stats.includes('28,750 VND')); assert.ok(stats.includes('<dt>Total</dt><dd>24</dd>'));
    const refined = render(AdminChatAnswer, { row: { links: entityLinks('search_services', data), evidence: [{ tool: 'search_services', data }, { tool: 'search_services', data: { items: [], total: 0 } }] } });
    assert.ok(refined.includes('No services found.')); assert.ok(!refined.includes('Car wash'));
    const proposal = render(AdminDraft, { draft: { type: 'UPDATE_SERVICE', payload: { price: 50000 }, current: { ...service, price: 45000 }, status: 'PENDING' }, busy: false, decide: () => {} });
    for (const text of ['45,000', '50,000', 'Pending Approval', 'Approve and apply']) assert.ok(proposal.includes(text), text);
  });

  await t.test('Ticket Package cards show exact stored fields and one View Package, without summaries or edit controls', () => {
    const pkg = { _id: id, name: 'Gold_Pass', description: 'Daily <b>literal</b> & coverage', type: 'daily', price: 0, isActive: false, updatedAt: '2026-11-08T00:00:00.000Z (07:00:00 08/11/2026 VN)' };
    const packageLinks = entityLinks('get_ticket_package_detail', pkg);
    const html = render(AdminChatAnswer, { row: { accountResult: { items: [account], total: 1 }, message: 'Created a package. Source: internal', links: [...packageLinks, ...packageLinks], evidence: [{ tool: 'search_ticket_packages', data: { items: [pkg, { ...pkg, _id: otherId }], total: 2 } }, { tool: 'get_ticket_package_detail', data: pkg }] } });
    assert.equal((html.match(/class="admin-ai-result-row"/g) || []).length, 1);
    assert.equal((html.match(/>View Package</g) || []).length, 1);
    assert.ok(html.includes(`href="/admin/tickets?packageId=${id}"`));
    for (const field of ['Gold_Pass', 'Type: Daily', 'Status: Inactive', 'Price: 0 VND', 'Updated: 8 Nov 2026, 07:00', 'Daily &lt;b&gt;literal&lt;/b&gt; &amp; coverage']) assert.ok(html.includes(field), field);
    for (const extra of ['Created a package', 'Source', 'internal', '>View Account<', '<button', '>Edit<', '>Delete<']) assert.ok(!html.includes(extra), extra);
    const unknown = render(AdminChatAnswer, { row: { links: packageLinks, evidence: [{ tool: 'get_ticket_package_detail', data: { _id: id, name: 'Legacy', createdAt: '2026-01-01T00:00:00Z' } }] } });
    assert.ok(unknown.includes('Updated: Not available')); assert.ok(unknown.includes('Status: Unavailable')); assert.ok(!unknown.includes('1 Jan 2026'));
    const empty = render(AdminChatAnswer, { row: { message: 'No packages found. Source: internal', evidence: [{ tool: 'search_ticket_packages', data: { items: [], total: 0 } }] } });
    assert.equal((empty.match(/No ticket packages found/g) || []).length, 1);
    const refined = render(AdminChatAnswer, { row: { links: packageLinks, evidence: [
      { tool: 'search_ticket_packages', data: { items: [pkg], total: 1 } },
      { tool: 'search_ticket_packages', data: { items: [], total: 0 } },
    ] } });
    assert.ok(refined.includes('No ticket packages found.'));
    assert.ok(!refined.includes('Gold_Pass'));
    assert.ok(!refined.includes('View Package'));
    const stats = render(AdminChatAnswer, { row: { message: 'Made-up statistics', evidence: [{ tool: 'get_ticket_package_stats', data: { summary: { total: 4, active: 2, inactive: 2, latestUpdated: pkg.updatedAt }, byType: [{ _id: 'daily', total: 1, active: 0, inactive: 1 }] } }] } });
    assert.ok(stats.includes('<dt>Total</dt><dd>4</dd>')); assert.ok(stats.includes('Daily')); assert.ok(!stats.includes('Made-up statistics'));
    for (const byType of [[], [{}], [{ _id: '', total: 1 }], [{ _id: 'yearly', total: 0 }]]) {
      const emptyTypes = render(AdminChatAnswer, { row: { evidence: [{ tool: 'get_ticket_package_stats', data: { summary: { total: 0 }, byType } }] } });
      assert.ok(!emptyTypes.includes('By type'));
    }
    assert.ok(html.includes('admin-ai-package-badges'));
    assert.ok(html.includes('</span> <span'));
  });
});


test('self status and role actions do not take the identity-only shortcut', () => {
  assert.equal(isIdentityRequest('Who am I?'), true);
  assert.equal(isIdentityRequest('Show my account'), true);
  for (const message of ['Deactivate my account', 'Make my account inactive', 'Promote my account to Admin', 'Demote my account', 'Enable my account', 'Suspend my account', 'Switch my account role to staff']) assert.equal(isIdentityRequest(message), false, message);
});

test('explicit email lookup resolves the target after a self-lookup and excludes the identity tool', async () => {
  const self = await run('Who am I?', []);
  assert.equal(self.accountResult.items[0]._id, otherId);
  assert.equal(self.accountResult.authenticated, true);
  assert.equal(executions[0].name, 'get_current_user');
  assert.deepEqual(executions[0].args, {});
  assert.equal(executions[0].context.actorId, 'isolated-admin');
  assert.equal(requests.length, 0);
  const target = 'my_account_test@example.test';
  queue = [call('get_current_user'), call('search_users', { query: target, matchMode: 'exact' }), text('Account found.')];
  requests = []; executions = [];
  const lookup = await chat({ message: `Show me the current account details for ${target}`, conversationId: self.conversationId, actorId: 'isolated-admin', actorRole: 'admin' });
  assert.equal(isIdentityRequest(`Show my account ${target}`), false);
  assert.equal(lookup.accountResult.items[0]._id, id);
  assert.equal(lookup.accountResult.items[0].email, target);
  assert.notEqual(lookup.accountResult.authenticated, true);
  assert.deepEqual(executions.map(entry => entry.name), ['search_users']);
  assert.equal(lookup.links[0].url, `/admin/accounts?userId=${id}`);
  assert.ok(requests.every(({ request }) => !request.tools[0].functionDeclarations.some(tool => tool.name === 'get_current_user')));
  assert.equal(drafts, 0);
});

test('lookup language does not mistake "show me" or a literal username for self identity', async () => {
  for (const message of ['Find account my_account_test', 'Show me account valo_staff_test', 'Look up me_test@example.test', 'Show current account for current_account@example.test']) assert.equal(isIdentityRequest(message), false, message);
  for (const message of ['Show my account', 'Show the current account', 'Tell me about me']) {
    const result = await run(message, []);
    assert.equal(result.accountResult.items[0]._id, otherId, message);
    assert.equal(result.accountResult.authenticated, true);
  }
});

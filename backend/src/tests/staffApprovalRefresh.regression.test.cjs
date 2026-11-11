const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../frontend/src');
const id = '6a17bf45f57436ad72e17852';

test('confirmed Staff approval refreshes the actual customer list and selected panel; unconfirmed HTTP success never announces success', async () => {
  const { approvalConfirmed } = await import(pathToFileURL(path.join(root, 'features/valo-ai/utils/approvalConfirmation.js')));
  const { getResponseAvailability } = await import(pathToFileURL(path.join(root, 'utils/staffOperationalAvailability.js')));
  const page = fs.readFileSync(path.join(root, 'pages/Staff/AccountManagement.jsx'), 'utf8');
  const copilot = fs.readFileSync(path.join(root, 'features/valo-ai/components/ValoAICopilot.jsx'), 'utf8');
  const draft = { id: '6af16cc9332d35fb91e70799', type: 'UPDATE_USER_STATUS', current: { _id: id, status: true }, payload: { status: false } };
  const confirmedResponse = { ok: true, data: { success: true, data: { id, type: draft.type, status: 'EXECUTED', accountStatus: false } } };
  const window = new EventTarget();
  let users = [], panel = { _id: id, role: 'customer', status: true }, messages = [{ draft }], reads = 0, pending;
  const customerRequest = { current: 0 };
  const fetchSource = page.slice(page.indexOf('  const fetchUsers = async'), page.indexOf('  const customerRequest = useRef'));
  const fetchUsers = new Function('deps', `const {customerRequest,apiFetch,authHeader,getResponseAvailability,setUsers,setPanelUser,setLoading,setLoadError}=deps; ${fetchSource}; return fetchUsers;`)({
    customerRequest, authHeader: {}, getResponseAvailability,
    apiFetch: async endpoint => { assert.equal(endpoint, '/staff/users'); reads += 1; return { ok: true, data: { success: true, data: [{ _id: id, role: 'customer', status: false }, { _id: 'staff', role: 'staff', status: true }] } }; },
    setUsers: value => { users = value; }, setPanelUser: value => { panel = typeof value === 'function' ? value(panel) : value; }, setLoading() {}, setLoadError() {},
  });
  const customerLoader = { current: () => { pending = fetchUsers(); } };
  const subscription = page.slice(page.indexOf('    const onChange = ({ detail })'), page.indexOf('    return () => { customerRequest.current'));
  const unsubscribe = new Function('window', 'customerLoader', `${subscription}; return () => window.removeEventListener('valo:staff-data-changed', onChange);`)(window, customerLoader);
  const decideSource = copilot.slice(copilot.indexOf('  const decide = async'), copilot.indexOf('  const onTriggerClick'));
  const decide = response => new Function('deps', `const {busy,noticeBusy,decisionInFlight,approveAIDraft,rejectAIDraft,approvalConfirmed,userRole,setMessages,setNoticeBusy,window,refresh}=deps; ${decideSource}; return decide;`)({
    busy: false, noticeBusy: false, decisionInFlight: { current: false }, userRole: 'staff', window, approvalConfirmed,
    approveAIDraft: async () => response, rejectAIDraft: async () => ({ ok: true, data: { success: true } }),
    setMessages: update => { messages = update(messages); }, setNoticeBusy() {}, refresh() {},
  });
  try {
    assert.equal(await decide(confirmedResponse)(draft, true), true);
    await pending;
    assert.equal(reads, 1); assert.equal(users.length, 1); assert.equal(users[0].status, false); assert.equal(panel.status, false);
    assert.equal(messages.at(-1).message, 'The proposed change was applied.');
    for (const response of [
      { ok: true, data: { success: true } },
      { ok: true, data: { success: false, data: confirmedResponse.data.data } },
      { ok: true, data: { success: true, data: { id, type: draft.type } } },
      { ok: false, data: { draftStatus: 'EXECUTED' } },
      { ok: true, data: { success: true, data: { ...confirmedResponse.data.data, id: '000000000000000000000000' } } },
    ]) {
      messages = [{ draft }];
      assert.equal(await decide(response)(draft, true), false);
      assert.equal(reads, 1); assert.equal(messages.at(-1).type, 'error');
      assert.ok(!messages.at(-1).message.includes('was applied'));
      assert.equal(messages[0].draft, draft);
    }
    // An older GET cannot overwrite the result of a newer status refresh.
    let releaseOld;
    const oldAPI = new Promise(resolve => { releaseOld = resolve; });
    let request = 0;
    const racingFetch = new Function('deps', `const {customerRequest,apiFetch,authHeader,getResponseAvailability,setUsers,setPanelUser,setLoading,setLoadError}=deps; ${fetchSource}; return fetchUsers;`)({
      customerRequest, authHeader: {}, getResponseAvailability,
      apiFetch: () => ++request === 1 ? oldAPI : Promise.resolve({ ok: true, data: { success: true, data: [{ _id: id, role: 'customer', status: false }] } }),
      setUsers: value => { users = value; }, setPanelUser: value => { panel = typeof value === 'function' ? value(panel) : value; }, setLoading() {}, setLoadError() {},
    });
    const old = racingFetch(); await racingFetch();
    releaseOld({ ok: true, data: { success: true, data: [{ _id: id, role: 'customer', status: true }] } }); await old;
    assert.equal(users[0].status, false); assert.equal(panel.status, false);
  } finally { unsubscribe(); }
});

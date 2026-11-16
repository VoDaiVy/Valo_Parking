const test = require('node:test');
const assert = require('node:assert/strict');
const { createCorsOptions } = require('../config/cors');

const allows = (env, origin) => {
  let allowed;
  createCorsOptions(env).origin(origin, (error, value) => {
    assert.equal(error, null);
    allowed = value;
  });
  return allowed;
};

test('development allows Expo browser origins and native requests', () => {
  for (const origin of [undefined, 'http://localhost:8081', 'http://192.168.1.21:8081', 'http://10.0.2.2:8081', 'http://172.16.0.2:8081']) {
    assert.equal(allows({}, origin), true);
  }
  for (const origin of ['https://untrusted.example', 'http://192.168.1.21.evil.example:8081', 'null']) {
    assert.equal(allows({}, origin), false);
  }
});

test('production only allows configured browser origins', () => {
  const env = { NODE_ENV: 'production', CLIENT_URL: 'https://parking.example, https://mobile.example' };
  assert.equal(allows(env, 'https://parking.example'), true);
  assert.equal(allows(env, 'https://mobile.example'), true);
  assert.equal(allows(env, 'http://localhost:8081'), false);
  assert.equal(allows(env, 'http://192.168.1.21:8081'), false);
  assert.equal(allows(env, undefined), true);
});

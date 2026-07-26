import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./LoginPage.jsx', import.meta.url), 'utf8');

test('Google OAuth button does not submit the email login form', () => {
  const googleButton = source.match(
    /<button(?:(?!<\/button>)[\s\S])*?id="btn-google-auth"(?:(?!<\/button>)[\s\S])*?>/,
  );

  assert.ok(googleButton, 'Google OAuth button must exist');
  assert.match(googleButton[0], /type="button"/);
});

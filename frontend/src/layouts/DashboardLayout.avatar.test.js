import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./DashboardLayout.jsx', import.meta.url), 'utf8');

test('profile sync clears stale avatar URLs when the backend avatar is empty', () => {
  const profileSync = source.match(
    /const freshAvatar[\s\S]*?sessionStorage\.setItem\("valo_user"/,
  );

  assert.ok(profileSync, 'profile sync block must exist');
  assert.doesNotMatch(profileSync[0], /avatar:\s*freshAvatar\s*\|\|/);
  assert.match(profileSync[0], /avatar:\s*freshAvatar/);
  assert.match(profileSync[0], /avatarUrl:\s*freshAvatar/);
});

test('dashboard avatar falls back to initials when its image fails', () => {
  const avatarMarkup = source.match(
    /<img(?:(?!\/>)[\s\S])*?alt="Avatar"(?:(?!\/>)[\s\S])*?\/>/,
  );

  assert.ok(avatarMarkup, 'dashboard avatar image must exist');
  assert.match(avatarMarkup[0], /onError=/);
});

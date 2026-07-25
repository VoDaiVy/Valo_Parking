import assert from 'node:assert/strict';
import test from 'node:test';

import { STAFF_THEME, STAFF_THEME_COLORS } from './staffTheme.js';

test('defines the shared dark and gold Staff color system', () => {
  assert.deepEqual(STAFF_THEME_COLORS, {
    page: '#080808',
    surface: '#111111',
    surfaceRaised: '#14120c',
    gold: '#ffd555',
    goldMuted: '#d7b94a',
  });

  assert.match(STAFF_THEME.page, /bg-\[#080808\]/);
  assert.match(STAFF_THEME.title, /text-\[#ffd555\]/);
  assert.match(STAFF_THEME.surface, /bg-\[#111111\]/);
});

test('uses gold for focus and primary actions while leaving semantic states separate', () => {
  assert.match(STAFF_THEME.input, /focus:border-\[#ffd555\]/);
  assert.match(STAFF_THEME.primaryButton, /bg-\[#ffd555\]/);
  assert.doesNotMatch(STAFF_THEME.primaryButton, /emerald|sky|violet/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/services/telegramProfileService.js', import.meta.url), 'utf8');
const instrumented = source.replace("import { apiFetch } from './api';", 'const apiFetch = (...args) => globalThis.__telegramProfileApiFetch(...args);');
const service = await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);

test('profile Telegram operations use authenticated account APIs without sending a typed recipient phone', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  globalThis.localStorage = { getItem: () => 'profile-token' };
  globalThis.__telegramProfileApiFetch = async (...args) => {
    calls.push(args);
    return { ok: true, data: { success: true, data: { linked: true } } };
  };
  try {
    assert.deepEqual(await service.getTelegramProfile(signal), { linked: true });
    await service.createTelegramProfileLink(signal);
    await service.setTelegramNotifications(false, signal);
    await service.unlinkTelegramProfile(signal);
    assert.deepEqual(calls.map(([path]) => path), ['/telegram/link', '/telegram/link-token', '/telegram/preferences', '/telegram/link']);
    assert.deepEqual(calls.map(([, options]) => options.method), [undefined, 'POST', 'PATCH', 'DELETE']);
    assert.deepEqual(JSON.parse(calls[1][1].body), {});
    assert.deepEqual(JSON.parse(calls[2][1].body), { notificationsEnabled: false });
    for (const [, options] of calls) {
      assert.equal(options.headers.Authorization, 'Bearer profile-token');
      assert.equal(options.signal, signal);
    }
  } finally {
    delete globalThis.localStorage;
    delete globalThis.__telegramProfileApiFetch;
  }
});

test('profile Telegram exposes required-phone and disabled errors without reporting success', async () => {
  globalThis.localStorage = { getItem: () => 'profile-token' };
  try {
    for (const [status, code, message] of [[400, 'PROFILE_PHONE_REQUIRED', 'Save a valid profile phone.'], [503, 'TELEGRAM_DISABLED', 'Telegram is unavailable.']]) {
      globalThis.__telegramProfileApiFetch = async () => ({ ok: false, status, data: { success: false, code, message } });
      await assert.rejects(service.createTelegramProfileLink(), error => error.code === code && error.status === status && error.message === message);
    }
  } finally {
    delete globalThis.localStorage;
    delete globalThis.__telegramProfileApiFetch;
  }
});

test('an aborted profile request discards a response even when apiFetch resolves instead of throwing', async () => {
  const controller = new AbortController();
  globalThis.localStorage = { getItem: () => 'profile-token' };
  globalThis.__telegramProfileApiFetch = async () => {
    controller.abort();
    return { ok: true, data: { success: true, data: { linked: true } } };
  };
  try {
    await assert.rejects(service.getTelegramProfile(controller.signal), { name: 'AbortError' });
  } finally {
    delete globalThis.localStorage;
    delete globalThis.__telegramProfileApiFetch;
  }
});

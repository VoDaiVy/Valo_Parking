import assert from 'node:assert/strict';
import test from 'node:test';
import * as availability from './staffOperationalAvailability.js';

const {
  getResponseAvailability,
  getRequiredSourcesAvailability,
} = availability;

const successful = (data = []) => ({ ok: true, data: { success: true, data } });

test('getResponseAvailability accepts only a successful API payload', () => {
  assert.deepEqual(getResponseAvailability(successful(['A']), 'Floors unavailable'), {
    isAvailable: true,
    data: ['A'],
    error: '',
  });

  assert.deepEqual(
    getResponseAvailability({ ok: true, data: { success: false, message: 'Floor service denied' } }, 'Floors unavailable'),
    {
      isAvailable: false,
      data: null,
      error: 'Floor service denied',
    },
  );
});

test('getRequiredSourcesAvailability invalidates the view when any required source fails', () => {
  const result = getRequiredSourcesAvailability([
    { name: 'Floors', response: successful() },
    { name: 'Floor slots', response: successful() },
    { name: 'Active sessions', response: { ok: false, data: { message: 'Sessions timed out' } } },
    { name: 'Available booking slots', response: successful() },
  ]);

  assert.deepEqual(result, {
    isAvailable: false,
    error: 'Active sessions: Sessions timed out',
    failedSources: ['Active sessions'],
  });
});

test('getOperationalViewState distinguishes loading, unavailable, and live data', () => {
  assert.equal(typeof availability.getOperationalViewState, 'function');
  const { getOperationalViewState } = availability;

  assert.deepEqual(getOperationalViewState({ loading: true }), {
    status: 'loading',
    isAvailable: false,
    error: '',
  });
  assert.deepEqual(getOperationalViewState({ error: 'History request failed' }), {
    status: 'unavailable',
    isAvailable: false,
    error: 'History request failed',
  });
  assert.deepEqual(getOperationalViewState(), {
    status: 'live',
    isAvailable: true,
    error: '',
  });
});

test('getOperationalValue suppresses believable values when a source is unavailable', () => {
  assert.equal(typeof availability.getOperationalViewState, 'function');
  assert.equal(typeof availability.getOperationalValue, 'function');
  const { getOperationalValue, getOperationalViewState } = availability;

  assert.equal(
    getOperationalValue(getOperationalViewState({ error: 'Request failed' }), 0),
    '—'
  );
  assert.equal(getOperationalValue(getOperationalViewState(), 0), 0);
});

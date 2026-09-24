import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_BOOKING_SESSION_TTL_MS,
  chooseNewestAiBookingSession,
  createAiBookingSnapshot,
  deriveAiBookingProgress,
  readLocalAiBookingSession,
  saveLocalAiBookingSession,
} from './aiBookingSession.js';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('local fallback restores the same account after refresh', () => {
  const storage = memoryStorage();
  const snapshot = createAiBookingSnapshot({
    sessionId: 's1', messages: [{ role: 'user', text: 'Ngày mai' }],
    bookingDraft: { startDate: '2026-09-25' }, updatedAt: '2026-09-24T08:00:00.000Z',
  });
  assert.equal(saveLocalAiBookingSession('user-a', snapshot, storage), true);
  assert.equal(readLocalAiBookingSession('user-a', storage, Date.parse('2026-09-24T08:05:00.000Z')).sessionId, 's1');
  assert.equal(readLocalAiBookingSession('user-b', storage, Date.parse('2026-09-24T08:05:00.000Z')), null);
});

test('local draft becomes expired after thirty minutes but keeps messages', () => {
  const storage = memoryStorage();
  const updatedAt = '2026-09-24T08:00:00.000Z';
  saveLocalAiBookingSession('user-a', {
    sessionId: 's1', status: 'ACTIVE', currentStep: 'SELECT_VEHICLE', updatedAt,
    messages: [{ role: 'user', content: 'Đặt ngày mai' }], bookingDraft: {},
  }, storage);
  const restored = readLocalAiBookingSession('user-a', storage, Date.parse(updatedAt) + AI_BOOKING_SESSION_TTL_MS);
  assert.equal(restored.status, 'EXPIRED');
  assert.equal(restored.messages[0].content, 'Đặt ngày mai');
});

test('multi-vehicle draft resumes at vehicle selection until all plates exist', () => {
  assert.deepEqual(deriveAiBookingProgress({ bookingDraft: {
    startDate: '2026-09-25', startTime: '08:00', endTime: '09:00',
    requestedVehicleCount: 2, licensePlates: ['43A12345'],
  } }), { currentStep: 'SELECT_VEHICLE', completionPercent: 50 });
  assert.deepEqual(deriveAiBookingProgress({ bookingDraft: {
    startDate: '2026-09-25', startTime: '08:00', endTime: '09:00',
    requestedVehicleCount: 2, licensePlates: ['43A12345', '43B54321'],
  } }), { currentStep: 'SELECT_SLOT', completionPercent: 70 });
});

test('newest session wins while a local completed marker prevents stale resume', () => {
  const backend = { sessionId: 's1', status: 'ACTIVE', updatedAt: '2026-09-24T08:00:00.000Z' };
  const local = { sessionId: 's1', status: 'COMPLETED', updatedAt: '2026-09-24T08:01:00.000Z' };
  assert.equal(chooseNewestAiBookingSession(backend, local).status, 'COMPLETED');
});

test('cancelled local marker is retained for backend discard retry and remains account-scoped', () => {
  const storage = memoryStorage();
  saveLocalAiBookingSession('user-a', {
    sessionId: 's1', status: 'CANCELLED', updatedAt: '2026-09-24T08:00:00.000Z',
    messages: [], bookingDraft: {},
  }, storage);
  assert.equal(readLocalAiBookingSession('user-a', storage, Date.parse('2026-09-25T08:00:00.000Z')).status, 'CANCELLED');
  assert.equal(readLocalAiBookingSession('user-b', storage, Date.parse('2026-09-25T08:00:00.000Z')), null);
});

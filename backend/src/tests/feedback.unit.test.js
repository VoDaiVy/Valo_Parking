const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateFeedback,
  validateReply,
} = require('../validators/feedbackValidator');

test('feedback validation normalizes comments and removes duplicate categories', () => {
  assert.deepEqual(
    validateFeedback({
      rating: 5,
      comment: '  Great parking experience  ',
      categories: ['parking', 'staff', 'parking'],
    }),
    {
      rating: 5,
      comment: 'Great parking experience',
      categories: ['parking', 'staff'],
    },
  );
});

test('feedback validation rejects invalid ratings and categories', () => {
  assert.throws(() => validateFeedback({ rating: 0 }), /Rating/);
  assert.throws(
    () => validateFeedback({ rating: 4, categories: ['unknown'] }),
    /categories/,
  );
});

test('reply validation requires content and a non-negative revision', () => {
  assert.deepEqual(
    validateReply({ content: '  Thank you for your feedback.  ', expectedRevision: 0 }),
    { content: 'Thank you for your feedback.', expectedRevision: 0 },
  );
  assert.throws(() => validateReply({ content: '', expectedRevision: 0 }), /Reply/);
  assert.throws(() => validateReply({ content: 'Thanks', expectedRevision: -1 }), /revision/);
});


test('public feedback filters and sorts before pagination while retaining global statistics and privacy', async t => {
  const Feedback = require('../models/BookingFeedback');
  const { listPublicFeedbacks } = require('../services/feedbackService');
  const calls = {};
  const chain = {};
  for (const method of ['sort', 'skip', 'limit', 'select', 'populate']) {
    chain[method] = (...args) => { calls[method] = args; return chain; };
  }
  chain.lean = async () => [{ _id: 'review', rating: 1, comment: '', createdAt: '2026-11-25', userId: { username: 'Driver', email: 'private@example.com' }, bookingId: 'private-booking' }];
  t.mock.method(Feedback, 'find', filter => { calls.filter = filter; return chain; });
  t.mock.method(Feedback, 'aggregate', async pipeline => {
    assert.deepEqual(pipeline, [{ $group: { _id: '$rating', count: { $sum: 1 } } }]);
    return [{ _id: 5, count: 12 }, { _id: 1, count: 4 }];
  });
  const result = await listPublicFeedbacks({ rating: '1', sort: 'lowest', page: '2', limit: '2' });
  assert.deepEqual(calls.filter, { rating: 1 });
  assert.deepEqual(calls.sort, [{ rating: 1, createdAt: -1, _id: -1 }]);
  assert.deepEqual(calls.skip, [2]);
  assert.deepEqual(calls.limit, [2]);
  assert.equal(result.total, 16);
  assert.equal(result.filteredTotal, 4);
  assert.equal(result.averageRating, 4);
  assert.deepEqual(result.distribution, { 1: 4, 2: 0, 3: 0, 4: 0, 5: 12 });
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['author', 'categories', 'comment', 'createdAt', 'id', 'rating']);
  assert.equal(result.items[0].author, 'Driver');
  await listPublicFeedbacks({ sort: 'highest' });
  assert.deepEqual(calls.sort, [{ rating: -1, createdAt: -1, _id: -1 }]);
  await listPublicFeedbacks({ rating: 'invalid', sort: 'invalid' });
  assert.deepEqual(calls.filter, {});
  assert.deepEqual(calls.sort, [{ createdAt: -1, _id: -1 }]);
});

test('public feedback returns a complete zero distribution when empty', async t => {
  const Feedback = require('../models/BookingFeedback');
  const { listPublicFeedbacks } = require('../services/feedbackService');
  const chain = {};
  for (const method of ['sort', 'skip', 'limit', 'select', 'populate']) chain[method] = () => chain;
  chain.lean = async () => [];
  t.mock.method(Feedback, 'find', () => chain);
  t.mock.method(Feedback, 'aggregate', async () => []);
  const result = await listPublicFeedbacks({ rating: '3' });
  assert.equal(result.total, 0);
  assert.equal(result.filteredTotal, 0);
  assert.equal(result.averageRating, null);
  assert.deepEqual(result.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
});

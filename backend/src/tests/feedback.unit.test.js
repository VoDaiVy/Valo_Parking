const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateFeedback,
  validateReply,
  validatePublication,
} = require('../validators/feedbackValidator');

test('publication requires an explicit boolean and strips unrelated fields', () => {
  for (const body of [undefined, null, [], {}, { isPublic: 'true' }, { isPublic: 1 }]) {
    assert.throws(() => validatePublication(body), /boolean/);
  }
  assert.deepEqual(validatePublication({ isPublic: true, rating: 5 }), { isPublic: true });
  assert.deepEqual(validatePublication({ isPublic: false }), { isPublic: false });
});

test('public feedback DTO shows the sender username without leaking private identifiers or admin data', () => {
  const { publicDTO } = require('../services/feedbackService');
  assert.deepEqual(publicDTO({
    _id: 'test-id', rating: 4, comment: 'Easy parking', userId: { _id: 'private-user', username: '  Minh Tran  ', email: 'private@example.com' },
    bookingId: 'private-booking', reply: { content: 'private-reply' },
  }), { id: 'test-id', rating: 4, comment: 'Easy parking', displayName: 'Minh Tran' });
});

test('public feedback uses a safe display name for deleted or missing senders', () => {
  const { publicDTO } = require('../services/feedbackService');
  for (const userId of [null, undefined, 'private-user', { username: '   ' }, {}]) {
    assert.equal(publicDTO({ _id: 'test-id', rating: 4, comment: 'Good', userId }).displayName, 'VALO customer');
  }
});

test('public feedback query only selects explicitly published comments and caps results', async () => {
  const Feedback = require('../models/BookingFeedback');
  const { listPublicFeedbacks } = require('../services/feedbackService');
  const originalFind = Feedback.find;
  const calls = {};
  Feedback.find = (filter) => {
    calls.filter = filter;
    return {
      select(value) { calls.select = value; return this; },
      populate(path, select) { calls.populate = { path, select }; return this; },
      sort(value) { calls.sort = value; return this; },
      limit(value) { calls.limit = value; return this; },
      async lean() { return [{ _id: 'public-id', rating: 5, comment: 'Good', userId: { username: 'Minh' } }]; },
    };
  };
  try {
    const result = await listPublicFeedbacks();
    assert.equal(calls.filter.isPublic, true);
    assert.equal(calls.filter.comment.$regex.test('   '), false);
    assert.equal(calls.select, '_id rating comment userId');
    assert.deepEqual(calls.populate, { path: 'userId', select: 'username' });
    assert.equal(calls.limit, 8);
    assert.equal(result.items[0].displayName, 'Minh');
  } finally { Feedback.find = originalFind; }
});

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

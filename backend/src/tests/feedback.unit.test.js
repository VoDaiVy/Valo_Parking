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

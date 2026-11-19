const CATEGORIES = ['parking', 'staff', 'payment', 'app', 'other'];
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function validateFeedback(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid feedback payload.');
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) fail('Rating must be an integer from 1 to 5.');
  const comment = body.comment === undefined ? '' : body.comment;
  if (typeof comment !== 'string' || comment.trim().length > 1000) fail('Comment must not exceed 1000 characters.');
  const categories = body.categories === undefined ? [] : body.categories;
  if (!Array.isArray(categories) || categories.length > 5 || categories.some(value => !CATEGORIES.includes(value))) fail('Invalid feedback categories.');
  return { rating: body.rating, comment: comment.trim(), categories: [...new Set(categories)] };
}
function validateReply(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid reply payload.');
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.trim().length > 2000) fail('Reply must contain 1 to 2000 characters.');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) fail('Expected revision must be a non-negative integer.');
  return { content: body.content.trim(), expectedRevision: body.expectedRevision };
}
function validatePublication(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.isPublic !== 'boolean') fail('isPublic must be a boolean.');
  return { isPublic: body.isPublic };
}
module.exports = { CATEGORIES, fail, validateFeedback, validateReply, validatePublication };

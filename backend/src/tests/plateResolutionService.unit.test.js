const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculatePlateSimilarity,
  calculateAlprDistance,
  areCharactersConfusable,
  resolveUnclearPlate,
} = require('../services/plateResolutionService');

test('areCharactersConfusable identifies standard optical OCR confusion pairs', () => {
  assert.equal(areCharactersConfusable('0', 'O'), true);
  assert.equal(areCharactersConfusable('8', 'B'), true);
  assert.equal(areCharactersConfusable('1', 'I'), true);
  assert.equal(areCharactersConfusable('5', 'S'), true);
  assert.equal(areCharactersConfusable('A', 'Z'), false);
});

test('calculateAlprDistance applies optical penalty for confusable OCR characters', () => {
  const distNormalDiff = calculateAlprDistance('51F88812', '51F99912');
  const distConfusableDiff = calculateAlprDistance('51F88812', '51F88B12'); // '8' vs 'B'

  assert.ok(distConfusableDiff < distNormalDiff, 'Confusable replacement should have lower distance than normal substitution');
});

test('calculatePlateSimilarity produces high percentage for optical OCR misreads', () => {
  const exactScore = calculatePlateSimilarity('51F88812', '51F88812');
  assert.equal(exactScore, 100);

  const minorMisreadScore = calculatePlateSimilarity('51F88B12', '51F88812'); // 'B' instead of '8'
  assert.ok(minorMisreadScore >= 85, `Similarity score should be >= 85%, got ${minorMisreadScore}%`);

  const veryDifferentScore = calculatePlateSimilarity('29A12345', '51F99999');
  assert.ok(veryDifferentScore < 50, `Unrelated plates should have low similarity, got ${veryDifferentScore}%`);
});

test('resolveUnclearPlate returns structured resolution response with suggestions', async () => {
  const result = await resolveUnclearPlate({
    rawPlate: '51F-88B12',
    confidence: 60,
  });

  assert.ok(result, 'Result should exist');
  assert.equal(result.cleanOriginalPlate, '51F88B12');
  assert.ok(Array.isArray(result.topSuggestions));
  assert.equal(typeof result.resolutionNotice, 'string');
});

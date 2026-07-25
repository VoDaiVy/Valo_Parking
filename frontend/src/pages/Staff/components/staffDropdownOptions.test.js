import assert from 'node:assert/strict';
import test from 'node:test';

import { getSelectedDropdownOption, normalizeDropdownOptions } from './staffDropdownOptions.js';

test('normalizes tuple and object options into a consistent dropdown shape', () => {
  assert.deepEqual(
    normalizeDropdownOptions([
      ['all', 'All statuses'],
      { value: 'active', label: 'Active', disabled: true },
    ]),
    [
      { value: 'all', label: 'All statuses', disabled: false },
      { value: 'active', label: 'Active', disabled: true },
    ],
  );
});

test('returns the selected option and falls back to the first option', () => {
  const options = normalizeDropdownOptions([
    ['newest', 'Newest first'],
    ['oldest', 'Oldest first'],
  ]);

  assert.deepEqual(getSelectedDropdownOption(options, 'oldest'), options[1]);
  assert.deepEqual(getSelectedDropdownOption(options, 'missing'), options[0]);
  assert.equal(getSelectedDropdownOption([], 'missing'), null);
});

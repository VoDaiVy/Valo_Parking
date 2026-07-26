import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./RefundRuleEditor.jsx', import.meta.url), 'utf8');

test('number field labels reserve two lines so adjacent inputs align', () => {
  const labelMarkup = source.match(
    /<span className="[^"]*uppercase[^"]*">\s*\{label\}\s*<\/span>/,
  );

  assert.ok(labelMarkup, 'NumberField label markup must exist');
  assert.match(labelMarkup[0], /min-h-8/);
});

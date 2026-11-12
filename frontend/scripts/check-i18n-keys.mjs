import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const localeDir = path.join(here, '..', 'src', 'i18n', 'locales');
const read = (name) => JSON.parse(fs.readFileSync(path.join(localeDir, name), 'utf8'));
const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
  const full = prefix ? `${prefix}.${key}` : key;
  return child && typeof child === 'object' && !Array.isArray(child)
    ? flatten(child, full)
    : [full];
});

const vi = new Set(flatten(read('vi.json')));
const en = new Set(flatten(read('en.json')));
const missingInVi = [...en].filter((key) => !vi.has(key));
const missingInEn = [...vi].filter((key) => !en.has(key));

if (missingInVi.length || missingInEn.length) {
  if (missingInVi.length) console.error(`Missing in vi.json:\n- ${missingInVi.join('\n- ')}`);
  if (missingInEn.length) console.error(`Missing in en.json:\n- ${missingInEn.join('\n- ')}`);
  process.exit(1);
}

console.log(`i18n locale keys are in sync (${en.size} keys).`);

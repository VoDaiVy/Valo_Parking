const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

test('all routes, controllers and services can be required without throwing MODULE_NOT_FOUND', () => {
  const dirs = ['routes', 'controllers', 'services'];
  const srcDir = path.join(__dirname, '..');
  
  for (const dir of dirs) {
    const fullPath = path.join(srcDir, dir);
    if (!fs.existsSync(fullPath)) continue;
    
    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        require(path.join(fullPath, file));
      } catch (err) {
        // We only care about MODULE_NOT_FOUND that indicates a broken require path
        if (err.code === 'MODULE_NOT_FOUND') {
          assert.fail(`File ${dir}/${file} failed to load due to missing module: ${err.message}`);
        }
      }
    }
  }
});

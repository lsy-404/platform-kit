import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

assert.match(workflow, /name: public-packages[\s\S]*?path:\s*\|[\s\S]*?release\/\*\*[\s\S]*?release\/SHA256SUMS/);
assert.match(workflow, /uses: actions\/download-artifact@v4[\s\S]*?name: public-packages[\s\S]*?path: release/);
assert.match(workflow, /find "release\/\$PACKAGE_DIR"/);
assert.match(workflow, /release\/SHA256SUMS/);

console.log('Package release workflow preserves the release directory.');

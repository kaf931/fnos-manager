import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { adaptNoVncBrowser } from '../scripts/novnc-compat.js';
test('mobile compatible noVNC module does not wait on optional WebCodecs detection', async () => {
  const source = await readFile('node_modules/@novnc/novnc/core/util/browser.js', 'utf8');
  await assert.rejects(
    () => transform(source, { format: 'cjs', target: 'es2020', logLevel: 'silent' }),
    /Top-level await/,
  );
  const adapted = adaptNoVncBrowser(source);
  await transform(adapted, { format: 'cjs', target: 'es2020', logLevel: 'silent' });
  assert.equal(adapted, await readFile('third-party/noVNC/core/util/browser.js', 'utf8'));
  assert.match(adapted, /supportsWebCodecsH264Decode = false;/);
  assert.throws(() => adaptNoVncBrowser('unexpected upstream source'), /noVNC/);
});

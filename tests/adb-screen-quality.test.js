import test from 'node:test';
import assert from 'node:assert/strict';
import { screenMaxSize } from '../server/adb/screencast-protocol.js';
test('screen resolution accepts only bounded presets and defaults to existing quality', () => {
  assert.equal(screenMaxSize(null), 1280);
  for (const size of [0, 720, 1280, 1920]) assert.equal(screenMaxSize(String(size)), size);
  for (const invalid of ['', '-1', '8192', '1280x720', 'NaN', '720.0'])
    assert.throws(() => screenMaxSize(invalid));
});

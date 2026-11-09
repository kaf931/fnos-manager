import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeVideoPacket, screenPoint, androidKey } from '../.web-test/adb-screen-protocol.js';

test('video packets validate envelope and retain timestamp without precision loss', () => {
  const b = new Uint8Array(13);
  b[0] = 1;
  b[1] = 1;
  new DataView(b.buffer).setBigUint64(2, 9007199254740993n);
  b.set([1, 2, 3], 10);
  const p = decodeVideoPacket(b.buffer);
  assert.equal(p.pts, 9007199254740993n);
  assert.equal(p.keyframe, true);
  assert.deepEqual([...p.data], [1, 2, 3]);
  for (const invalid of [new Uint8Array(9), new Uint8Array([9, ...new Array(10).fill(0)])])
    assert.throws(() => decodeVideoPacket(invalid.buffer));
});
test('touch coordinates use displayed canvas bounds and clamp outside drag', () => {
  assert.deepEqual(
    screenPoint(60, 220, { left: 10, top: 20, width: 100, height: 200 }, 1080, 1920),
    { x: 540, y: 1919 },
  );
  assert.deepEqual(
    screenPoint(-10, -10, { left: 10, top: 20, width: 100, height: 200 }, 1080, 1920),
    { x: 0, y: 0 },
  );
  assert.equal(screenPoint(1, 1, { left: 0, top: 0, width: 0, height: 0 }, 1080, 1920), null);
});
test('keyboard navigation resolves Android key codes and leaves characters for text injection', () => {
  assert.equal(androidKey('Backspace'), 67);
  assert.equal(androidKey('Enter'), 66);
  assert.equal(androidKey('a'), undefined);
});

test('screen canvas fit preserves aspect ratio within shared viewport', async () => {
  const { fitScreen } = await import('../.web-test/adb-screen-protocol.js');
  assert.deepEqual(fitScreen(1080, 1920, 800, 600), { width: 337.5, height: 600 });
  assert.deepEqual(fitScreen(1920, 1080, 800, 600), { width: 800, height: 450 });
  assert.deepEqual(fitScreen(1920, 1080, 0, 600), { width: 0, height: 0 });
});

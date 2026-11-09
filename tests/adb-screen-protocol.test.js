import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScreenControl, encodeVideoPacket } from '../server/adb/screencast-protocol.js';

test('screen controls reject coordinates, dimensions, keys and arbitrary text outside limits', () => {
  for (const message of [
    null,
    {},
    { type: 'touch', action: 0, x: -1, y: 0, width: 100, height: 100 },
    { type: 'touch', action: 2, x: 10, y: 10, width: 1e9, height: 100 },
    { type: 'key', keyCode: 99999 },
    { type: 'text', text: 'x'.repeat(1025) },
    { type: 'start', serial: 'other-device' },
  ])
    assert.throws(() => validateScreenControl(message));
});
test('screen controls only allow bounded touch, navigation and text messages', () => {
  assert.deepEqual(
    validateScreenControl({ type: 'touch', action: 0, x: 23, y: 40, width: 1080, height: 1920 }),
    { type: 'touch', action: 0, x: 23, y: 40, width: 1080, height: 1920 },
  );
  assert.deepEqual(validateScreenControl({ type: 'key', keyCode: 3 }), { type: 'key', keyCode: 3 });
  assert.deepEqual(validateScreenControl({ type: 'text', text: 'hello' }), {
    type: 'text',
    text: 'hello',
  });
});
test('framed media preserves configuration, keyframe, 64 bit timestamp and payload', () => {
  const packet = encodeVideoPacket({
    type: 'data',
    keyframe: true,
    pts: 1234567890123n,
    data: new Uint8Array([1, 2, 3]),
  });
  assert.equal(packet[0], 1);
  assert.equal(packet[1], 1);
  assert.equal(
    new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getBigUint64(2),
    1234567890123n,
  );
  assert.deepEqual([...packet.subarray(10)], [1, 2, 3]);
  assert.equal(encodeVideoPacket({ type: 'configuration', data: new Uint8Array([7]) })[0], 0);
});

test('screen power controls accept only dedicated wake and sleep numeric keycodes', () => {
  for (const keyCode of [223, 224])
    assert.deepEqual(validateScreenControl({ type: 'key', keyCode }), { type: 'key', keyCode });
  for (const keyCode of ['224', 223.5, -224, null])
    assert.throws(() => validateScreenControl({ type: 'key', keyCode }));
});

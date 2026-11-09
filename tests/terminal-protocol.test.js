import test from 'node:test';
import assert from 'node:assert/strict';
import { auxiliaryKey, normalizeSize, canSendInput } from '../.web-test/terminal-protocol.js';
test('terminal input is only allowed while connected', () => {
  for (const state of [
    'pending',
    'connecting',
    'host-key',
    'credentials',
    'authenticating',
    'disconnected',
  ])
    assert.equal(canSendInput(state), false);
  assert.equal(canSendInput('connected'), true);
});
test('auxiliary keys encode control, escape, tab and cursor sequences', () => {
  assert.equal(auxiliaryKey('Escape'), '\x1b');
  assert.equal(auxiliaryKey('Tab'), '\t');
  assert.equal(auxiliaryKey('ArrowUp'), '\x1b[A');
  assert.equal(auxiliaryKey('ArrowLeft'), '\x1b[D');
  assert.equal(auxiliaryKey('c', true), '\x03');
  assert.equal(auxiliaryKey('z', true), '\x1a');
  assert.equal(auxiliaryKey('a'), 'a');
  assert.equal(auxiliaryKey('Control'), '');
});
test('terminal dimensions stay inside server constraints', () => {
  assert.deepEqual(normalizeSize(600, 0), { cols: 500, rows: 1 });
  assert.deepEqual(normalizeSize(NaN, undefined), { cols: 80, rows: 24 });
  assert.deepEqual(normalizeSize(80.6, 24.8), { cols: 80, rows: 24 });
});

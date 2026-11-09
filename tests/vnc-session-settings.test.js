import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVncSettings } from '../.web-test/vnc-session-settings.js';
import { DEFAULT_VNC_SETTINGS } from '../server/domain/vnc.js';
test('VNC session settings apply supported options and only enable dragging for a clipped unscaled viewport', () => {
  const client = {
    setViewOnly(value) {
      this.viewOnly = value;
    },
  };
  applyVncSettings(
    client,
    {
      ...DEFAULT_VNC_SETTINGS,
      scaleMode: 'off',
      clipViewport: true,
      viewOnly: true,
      qualityLevel: 3,
      compressionLevel: 8,
    },
    true,
    true,
  );
  assert.equal(client.scaleViewport, false);
  assert.equal(client.clipViewport, true);
  assert.equal(client.dragViewport, true);
  assert.equal(client.viewOnly, true);
  assert.equal(client.qualityLevel, 3);
  assert.equal(client.compressionLevel, 8);
  applyVncSettings(client, DEFAULT_VNC_SETTINGS, false, true);
  assert.equal(client.scaleViewport, true);
  assert.equal(client.clipViewport, false);
  assert.equal(client.dragViewport, false);
  assert.equal(client.viewOnly, true);
  applyVncSettings(client, { ...DEFAULT_VNC_SETTINGS, scaleMode: 'remote' }, true, false);
  assert.equal(client.resizeSession, true);
  assert.equal(client.scaleViewport, false);
});

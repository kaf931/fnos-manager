import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampTerminalPanelWidth,
  DEFAULT_TERMINAL_PANEL_WIDTH,
} from '../.web-test/terminal-panel-resize.js';
test('shared terminal panels start wider and keep usable terminal space when resized', () => {
  assert.equal(DEFAULT_TERMINAL_PANEL_WIDTH, 360);
  assert.equal(clampTerminalPanelWidth(360, 1280), 360);
  assert.equal(clampTerminalPanelWidth(100, 1280), 240);
  assert.equal(clampTerminalPanelWidth(1000, 1280), 640);
  assert.equal(clampTerminalPanelWidth(600, 800), 428);
  assert.equal(clampTerminalPanelWidth(360, 621), 249);
  assert.equal(clampTerminalPanelWidth(NaN, 1280), 360);
});

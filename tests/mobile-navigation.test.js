import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardShrinksViewport } from '../.web-test/mobile-navigation.js';
test('navigation hides for keyboard-sized input viewport changes and restores without confusing zoom or desktop', () => {
  const state = { mobile: true, editable: true, wasOpen: false, baseline: 852, height: 460 };
  assert.equal(keyboardShrinksViewport(state), true);
  assert.equal(keyboardShrinksViewport({ ...state, editable: false, wasOpen: true }), true);
  assert.equal(keyboardShrinksViewport({ ...state, height: 852, wasOpen: true }), false);
  assert.equal(keyboardShrinksViewport({ ...state, height: 790 }), false);
  assert.equal(keyboardShrinksViewport({ ...state, mobile: false }), false);
  assert.equal(keyboardShrinksViewport({ ...state, scale: 2 }), false);
  assert.equal(keyboardShrinksViewport({ ...state, editable: false }), false);
});

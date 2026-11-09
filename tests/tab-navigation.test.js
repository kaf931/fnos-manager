import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { navigateTabs } from '../.web-test/ui/tab-navigation.js';

test('terminal tab keyboard navigation wraps and skips close and disabled buttons', () => {
  const browser = new JSDOM(
    '<div role="tablist"><button aria-label="关闭">×</button><button role="tab">A</button><button role="tab" disabled>B</button><button role="tab">C</button></div>',
  );
  const { document, KeyboardEvent } = browser.window;
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const clicks = [];
  tabs.forEach((tab) => {
    tab.onclick = () => clicks.push(tab.textContent);
    tab.onkeydown = (event) => navigateTabs(event, tab);
  });
  const press = (tab, key) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    tab.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(press(tabs[0], 'ArrowRight'), true);
  assert.equal(document.activeElement, tabs[2]);
  press(tabs[2], 'ArrowRight');
  assert.equal(document.activeElement, tabs[0]);
  press(tabs[0], 'ArrowLeft');
  assert.equal(document.activeElement, tabs[2]);
  press(tabs[2], 'Home');
  assert.equal(document.activeElement, tabs[0]);
  press(tabs[0], 'End');
  assert.equal(document.activeElement, tabs[2]);
  assert.equal(press(tabs[2], 'Tab'), false);
  assert.deepEqual(clicks, ['C', 'A', 'C', 'A', 'C']);
  browser.window.close();
});

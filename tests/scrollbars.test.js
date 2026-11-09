import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollActivity, setupSharedScrollbars } from '../.web-test/shared-scrollbars.js';
import { JSDOM } from 'jsdom';

test('scroll activity is isolated per surface, restarts on continued scrolling and clears on disposal', () => {
  const dom = new JSDOM('<div id="a"></div><div id="b"></div>');
  const tasks = new Map();
  let serial = 0;
  const activity = createScrollActivity({
    setTimer: (cb) => {
      tasks.set(++serial, cb);
      return serial;
    },
    clearTimer: (id) => tasks.delete(id),
  });
  const a = dom.window.document.querySelector('#a'),
    b = dom.window.document.querySelector('#b');
  activity.pulse(a);
  const old = serial;
  activity.pulse(a);
  activity.pulse(b);
  assert.equal(tasks.has(old), false);
  assert.ok(a.classList.contains('scrollbar-scrolling'));
  assert.ok(b.classList.contains('scrollbar-scrolling'));
  tasks.get(serial)();
  assert.equal(b.classList.contains('scrollbar-scrolling'), false);
  assert.ok(a.classList.contains('scrollbar-scrolling'));
  activity.dispose();
  assert.equal(a.classList.contains('scrollbar-scrolling'), false);
  dom.window.close();
});

test('delegated scroll capture handles dynamically created scrollers and ignores hover', () => {
  const dom = new JSDOM('<main></main>'),
    seen = [];
  const dispose = setupSharedScrollbars(dom.window.document, {
    pulse: (element) => seen.push(element),
  });
  const child = dom.window.document.createElement('div');
  dom.window.document.querySelector('main').append(child);
  child.dispatchEvent(new dom.window.Event('mouseover', { bubbles: true }));
  assert.equal(seen.length, 0);
  child.dispatchEvent(new dom.window.Event('scroll'));
  assert.deepEqual(seen, [child]);
  dispose();
  child.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(seen.length, 1);
  dom.window.close();
});

test('scroll inset measures only the real gutter, excluding borders and hidden surfaces', async () => {
  const { syncScrollInset } = await import('../.web-test/shared-scrollbars.js');
  const dom = new JSDOM('<div style="border:1px solid"></div>');
  const element = dom.window.document.querySelector('div');
  let outer = 390,
    inner = 382;
  Object.defineProperties(element, {
    offsetWidth: { get: () => outer },
    clientWidth: { get: () => inner },
  });
  syncScrollInset(element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-gutter'), '6px');
  inner = 388;
  syncScrollInset(element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-gutter'), '0px');
  outer = inner = 0;
  syncScrollInset(element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-gutter'), '0px');
  dom.window.close();
});

test('horizontal inset compensates real scrollbar height and resets when overflow disappears', async () => {
  const { syncScrollInset } = await import('../.web-test/shared-scrollbars.js');
  const dom = new JSDOM('<div style="border-top:1px solid;border-bottom:2px solid"></div>');
  const element = dom.window.document.querySelector('div');
  let outer = 49,
    inner = 40;
  Object.defineProperties(element, {
    offsetHeight: { get: () => outer },
    clientHeight: { get: () => inner },
  });
  syncScrollInset(element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-horizontal-gutter'), '6px');
  inner = 46;
  syncScrollInset(element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-horizontal-gutter'), '0px');
  outer = inner = 0;
  syncScrollInset(element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-horizontal-gutter'), '0px');
  dom.window.close();
});

test('mounted filter inset updates after resizing and releases its observer', async () => {
  const { observeScrollInsets } = await import('../.web-test/shared-scrollbars.js');
  const dom = new JSDOM('<div></div>');
  const element = dom.window.document.querySelector('div');
  let inner = 40,
    callback,
    watched,
    disconnected = false;
  Object.defineProperties(element, {
    offsetHeight: { value: 46 },
    clientHeight: { get: () => inner },
  });
  dom.window.ResizeObserver = class {
    constructor(update) {
      callback = update;
    }
    observe(target) {
      watched = target;
    }
    disconnect() {
      disconnected = true;
    }
  };
  const stop = observeScrollInsets([element]);
  assert.equal(watched, element);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-horizontal-gutter'), '6px');
  inner = 46;
  callback([{ target: element }]);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-horizontal-gutter'), '0px');
  stop();
  assert.equal(disconnected, true);
  dom.window.close();
});

test('shared scroll insets observe asynchronously mounted surfaces and release removed nodes', async () => {
  const dom = new JSDOM('<main/>');
  const watched = new Set();
  let disconnected = false;
  dom.window.ResizeObserver = class {
    observe(target) {
      watched.add(target);
    }
    unobserve(target) {
      watched.delete(target);
    }
    disconnect() {
      disconnected = true;
      watched.clear();
    }
  };
  const stop = setupSharedScrollbars(dom.window.document);
  const element = dom.window.document.createElement('div');
  element.setAttribute('data-scroll-inset', '');
  Object.defineProperties(element, { offsetWidth: { value: 100 }, clientWidth: { value: 94 } });
  dom.window.document.querySelector('main').append(element);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watched.has(element), true);
  assert.equal(element.style.getPropertyValue('--app-scrollbar-gutter'), '6px');
  element.remove();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watched.has(element), false);
  stop();
  assert.equal(disconnected, true);
  dom.window.close();
});

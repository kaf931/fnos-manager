import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PullRefresh } from '../.web-test/pull-refresh.js';
test('React pull refresh respects scroll position, gesture direction, threshold and in-flight lock', async (t) => {
  const dom = new JSDOM('<main/>');
  let mobile = true,
    refreshes = 0,
    finish;
  const values = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [k, value] of Object.entries(values))
    Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
  dom.window.matchMedia = () => ({ matches: mobile });
  const root = createRoot(document.querySelector('main'));
  let mounted = true;
  t.after(async () => {
    if (mounted) await act(() => root.unmount());
    dom.window.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  await act(async () =>
    root.render(
      React.createElement(
        PullRefresh,
        {
          onRefresh: () => {
            refreshes++;
            return new Promise((resolve) => (finish = resolve));
          },
        },
        React.createElement('section', null, React.createElement('input')),
      ),
    ),
  );
  const surface = document.querySelector('section'),
    indicator = document.querySelector('.pull-refresh-indicator'),
    wrapper = document.querySelector('.pull-refresh-surface');
  const fire = (type, x = 0, y = 0, count = 1, target = surface) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
    });
    target.dispatchEvent(event);
    return event;
  };
  const pull = async (x, y, target = surface) => {
    let move;
    await act(async () => {
      fire('touchstart', 0, 0, 1, target);
      move = fire('touchmove', x, y, 1, target);
      fire('touchend', 0, 0, 1, target);
    });
    return move;
  };
  await pull(0, 60);
  assert.equal(refreshes, 0);
  await pull(150, 20);
  assert.equal(refreshes, 0);
  surface.scrollTop = 10;
  await pull(0, 160);
  assert.equal(refreshes, 0);
  surface.scrollTop = 0;
  mobile = false;
  await pull(0, 160);
  assert.equal(refreshes, 0);
  mobile = true;
  await pull(0, 160, document.querySelector('input'));
  assert.equal(refreshes, 0, 'inputs never capture pull gestures');
  await act(async () => {
    fire('touchstart');
    fire('touchmove', 0, 160);
    fire('touchcancel');
    fire('touchend');
  });
  assert.equal(refreshes, 0);
  await act(async () => {
    fire('touchstart', 0, 0, 2);
    fire('touchmove', 0, 160, 2);
    fire('touchend');
  });
  assert.equal(refreshes, 0);
  const move = await pull(0, 160);
  assert.equal(move.defaultPrevented, true);
  assert.equal(refreshes, 1);
  assert.equal(indicator.getAttribute('aria-label'), '正在刷新');
  assert.ok(indicator.querySelector('svg'));
  await pull(0, 160);
  assert.equal(refreshes, 1);
  await act(async () => finish());
  assert.equal(wrapper.style.transform, '');
  assert.equal(indicator.style.height, '');
  await pull(0, 160);
  assert.equal(refreshes, 2);
  await act(async () => finish());
  await act(async () => root.unmount());
  mounted = false;
  assert.equal(indicator.isConnected, false);
  await pull(0, 160);
  assert.equal(refreshes, 2);
});

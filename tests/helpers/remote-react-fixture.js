import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
export function remoteFixture(t) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true, url: 'http://localhost/' }),
    previous = {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    innerWidth: 1000,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  dom.window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const root = createRoot(dom.window.document.querySelector('main'));
  let unmounted = false;
  const render = async (Component, props) => {
    await act(() => root.render(createElement(Component, props)));
  };
  const unmount = async () => {
    if (!unmounted) {
      unmounted = true;
      await act(() => root.unmount());
    }
  };
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const key in previous) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  });
  return { document: dom.window.document, root, render, unmount };
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

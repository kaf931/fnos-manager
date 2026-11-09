import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
// Test-only renderer: all application state remains in the production React components.
export function renderStorageComponent(Component, { host, ...props }, extra = {}) {
  const root = createRoot(host);
  let current = { ...props, ...extra };
  const update = (next = {}) => {
    current = { ...current, ...next };
    flushSync(() => root.render(React.createElement(Component, current)));
  };
  return { update, dispose: () => flushSync(() => root.unmount()) };
}
export function recordFixture(Component, options) {
  const control = { publish() {}, report() {} };
  let revision = 0;
  const view = renderStorageComponent(Component, options, {
    active: false,
    revision,
    batch: control,
  });
  return {
    ...view,
    setActive: (active) => view.update({ active }),
    refresh: () => view.update({ revision: ++revision }),
  };
}

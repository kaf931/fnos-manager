import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUi } from './fixtures/react-ui.js';
const stubs = {
  '@douyinfe/semi-ui/lib/es/space': `import React from 'react';export default p=>React.createElement('span',{'data-space':'inline'},p.children);`,
  '@douyinfe/semi-ui/lib/es/dropdown': `import React from 'react'; function D(p){return React.createElement('div',null,React.cloneElement(p.children,{onClick:()=>p.onVisibleChange(!p.visible)}),p.visible?p.render:null)};D.Menu=p=>React.createElement('div',{role:'menu'},p.children);D.Item=p=>React.createElement('button',{role:'menuitem',onClick:p.onClick},p.children);export default D;`,
  '@douyinfe/semi-ui/lib/es/badge': `import React from 'react';export default p=>React.createElement('span',{'data-badge':p.dot?'dot':'none'},p.children);`,
};
test('mobile more shows an update badge and opens update directly, then closes the menu', async (t) => {
  let updates = 0;
  const ui = await mountUi(
    t,
    'mobile-navigation-more',
    'MobileMore',
    {
      page: 'icons',
      updateAvailable: true,
      onUpdate: () => updates++,
      onChange: () => assert.fail('must use update action'),
      onOpenChange: () => {},
    },
    stubs,
  );
  assert.ok(ui.get('[data-badge="dot"]'));
  ui.click('button[aria-haspopup]');
  const entry = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent === '应用更新',
  );
  assert.ok(entry);
  const dot = entry.querySelector('[data-badge="dot"]');
  assert.ok(dot);
  assert.equal(dot.textContent, '');
  assert.equal(dot.previousElementSibling.textContent, '应用更新');
  ui.click('[role="menuitem"]:last-child');
  assert.equal(updates, 1);
  assert.equal(ui.get('[role="menu"]'), null);
});
test('mobile more has no update badge or update entry without a new version', async (t) => {
  const ui = await mountUi(
    t,
    'mobile-navigation-more',
    'MobileMore',
    {
      page: 'icons',
      onChange: () => {},
      onOpenChange: () => {},
    },
    stubs,
  );
  assert.equal(ui.get('[data-badge="dot"]'), null);
  ui.click('button[aria-haspopup]');
  assert.doesNotMatch(ui.get('[role="menu"]').textContent, /应用更新/);
});

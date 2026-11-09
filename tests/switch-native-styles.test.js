import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('shared checkbox skin never exposes the Semi switch native input during loading', async () => {
  const nativeCss = await readFile(
    'node_modules/@douyinfe/semi-foundation/lib/es/switch/switch.css',
    'utf8',
  );
  const applicationCss = await readFile('web/styles/dialogs.css', 'utf8');
  const dom = new JSDOM(
    '<style></style><div class="semi-switch"><input id="native" class="semi-switch-native-control" type="checkbox" role="switch"></div><input id="ordinary" type="checkbox" disabled>',
  );
  try {
    dom.window.document.querySelector('style').textContent = nativeCss + '\n' + applicationCss;
    const input = dom.window.document.getElementById('native');
    for (const disabled of [false, true])
      for (const checked of [false, true]) {
        input.disabled = disabled;
        input.checked = checked;
        assert.equal(
          dom.window.getComputedStyle(input).opacity,
          '0',
          `disabled=${disabled}, checked=${checked}`,
        );
      }
    assert.equal(
      dom.window.getComputedStyle(dom.window.document.getElementById('ordinary')).opacity,
      '0.5',
    );
  } finally {
    dom.window.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

test('browser and Node sources reject globals from the other runtime', async () => {
  const lint = new ESLint();
  for (const [filePath, source, forbidden] of [
    ['web/runtime-boundary-probe.js', 'process.exit(0);', 'process'],
    ['scripts/runtime-boundary-probe.js', 'document.title = "wrong runtime";', 'document'],
  ]) {
    const [result] = await lint.lintText(source, { filePath });
    assert.ok(
      result.messages.some((m) => m.ruleId === 'no-undef' && m.message.includes(forbidden)),
    );
  }
  const [browser] = await lint.lintText('document.title = navigator.language;', {
    filePath: 'web/runtime-boundary-probe.js',
  });
  const [node] = await lint.lintText('process.stdout.write("ok");', {
    filePath: 'scripts/runtime-boundary-probe.js',
  });
  assert.equal(browser.errorCount, 0);
  assert.equal(node.errorCount, 0);
});

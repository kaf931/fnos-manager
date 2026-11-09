import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
const css = postcss.parse(readFileSync('web/styles/modal-sizing.css', 'utf8'));
function declaration(selector, property) {
  const values = [];
  css.walkRules(selector, (r) => r.walkDecls(property, (d) => values.push(d.value)));
  return values;
}
test('public modal sizes follow Semi presets and constrain fixed content to the viewport', () => {
  assert.deepEqual(declaration('dialog[data-dialog-size]', '--dialog-width'), ['684px']);
  assert.deepEqual(declaration("dialog[data-dialog-size='small']", '--dialog-width'), ['448px']);
  assert.deepEqual(declaration("dialog[data-dialog-size='large']", '--dialog-width'), ['920px']);
  assert.deepEqual(declaration("dialog[data-dialog-size='full-width']", '--dialog-width'), [
    'calc(100vw - 64px)',
  ]);
  assert.deepEqual(declaration('dialog[data-dialog-size]', 'max-height'), ['calc(100svh - 160px)']);
  assert.deepEqual(
    declaration("dialog[data-dialog-layout='fixed'] > .task-form-body", 'overflow'),
    ['auto'],
  );
  assert.deepEqual(declaration("dialog[data-dialog-layout='fixed']", 'height'), [
    'min(560px, calc(100svh - 160px))',
  ]);
});
test('React dialog exposes typed size presets for every dialog including custom base classes', () => {
  const source = readFileSync('web/ui/react-dialog.tsx', 'utf8');
  assert.match(source, /size = 'medium'/);
  assert.match(source, /data-dialog-size=\{size\}/);
  assert.match(source, /data-dialog-layout=\{layout\}/);
  for (const filename of [
    'web/styles/terminal.css',
    'web/terminal-text-editor.css',
    'web/styles/storage-workspace.css',
    'web/styles/storage-duplicates.css',
    'web/config-backup.css',
  ]) {
    const root = postcss.parse(readFileSync(filename, 'utf8'));
    root.walkRules((r) => {
      if (
        /^\.(terminal-dialog|remote-text-dialog|storage-batch-dialog|storage-duplicate-dialog|config-backup-dialog)$/.test(
          r.selector,
        )
      )
        r.walkDecls((d) =>
          assert.ok(
            !/^(min-|max-)?(width|height)$/.test(d.prop),
            `${filename}: duplicate modal size ${d.prop}`,
          ),
        );
    });
  }
});

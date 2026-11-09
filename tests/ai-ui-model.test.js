import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiViewModel } from '../.web-test/terminal-ai-model.js';
test('AI view rejects stale responses across tabs reconnects and disconnects', () => {
  const m = createAiViewModel();
  m.select({ id: 'a', generation: 1, connected: true });
  const a = m.capture();
  assert.equal(m.beginAction(a), true);
  assert.equal(m.beginAction(a), false);
  m.select({ id: 'b', generation: 1, connected: true });
  assert.equal(m.isCurrent(a), false);
  assert.equal(m.finishAction(a), false);
  const b = m.capture();
  assert.equal(m.beginAction(b), true);
  m.select({ id: 'b', generation: 2, connected: true });
  assert.equal(m.isCurrent(b), false);
  const c = m.capture();
  m.select({ id: 'b', generation: 2, connected: false });
  assert.equal(m.isCurrent(c), false);
  assert.equal(m.beginAction(m.capture()), false);
});
test('returning to a session never revives an earlier selection capture', () => {
  const m = createAiViewModel();
  m.select({ id: 'a', generation: 1, connected: true });
  const old = m.capture();
  m.beginAction(old);
  m.select({ id: 'b', generation: 1, connected: true });
  m.select({ id: 'a', generation: 1, connected: true });
  const current = m.capture();
  assert.equal(m.beginAction(current), true);
  assert.equal(m.isCurrent(old), false);
  assert.equal(m.beginAction(old), false);
  assert.equal(m.finishAction(old), false);
  assert.equal(m.busy, true);
  m.select({ id: 'a', generation: 1, connected: true });
  assert.equal(m.isCurrent(current), true);
  assert.equal(m.finishAction(current), true);
});
test('SSH workspace renders a React-owned AI panel with explicit target and visibility', async () => {
  const workspace = ts.createSourceFile(
    'terminal-workspace.tsx',
    await readFile('web/terminal-workspace.tsx', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let panel;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(workspace) === 'TerminalAi')
      panel = node;
    ts.forEachChild(node, visit);
  }
  visit(workspace);
  assert.ok(panel, 'workspace must render the actual AI component');
  const props = new Set(
    panel.attributes.properties.filter(ts.isJsxAttribute).map((p) => p.name.text),
  );
  for (const name of ['api', 'toast', 'target', 'open', 'onClose'])
    assert.ok(props.has(name), name);
  const source = await readFile('web/terminal-ai.tsx', 'utf8');
  const component = ts.createSourceFile(
    'terminal-ai.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let aside;
  function inspect(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(component) === 'aside') aside = node;
    ts.forEachChild(node, inspect);
  }
  inspect(component);
  assert.ok(aside);
  const attributes = new Map(
    aside.attributes.properties
      .filter(ts.isJsxAttribute)
      .map((p) => [p.name.text, p.initializer?.getText(component)]),
  );
  assert.equal(attributes.get('id'), '"terminal-ai"');
  assert.match(attributes.get('className'), /terminal-assets terminal-ai/);
  assert.equal(attributes.get('hidden'), '{!open}');
  assert.doesNotMatch(source, /createSurface|SurfaceHost|querySelector/);
});
test('new or restored chat invalidates requests without changing the SSH target', () => {
  const m = createAiViewModel();
  m.select({ id: 'ssh', generation: 1, connected: true });
  const old = m.capture();
  m.beginAction(old);
  m.invalidate();
  assert.equal(m.isCurrent(old), false);
  assert.equal(m.busy, false);
  assert.equal(m.capture().sessionId, 'ssh');
});

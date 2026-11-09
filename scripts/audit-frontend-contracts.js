import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const htmlProperties = new Set(['innerHTML', 'outerHTML']);
const businessProperties = new Set([
  'textContent',
  'innerText',
  'hidden',
  'value',
  'checked',
  'disabled',
  'selected',
  'className',
]);
// Narrow browser integration exceptions: these files own platform metadata,
// accessibility state, measured geometry, downloads, and third-party transports.
// They do not authorize imperative creation of business UI or content writes.
const layoutClasses = new Set([
  'app-shell.tsx',
  'platform.ts',
  'shared-scrollbars.ts',
  'mobile-navigation.ts',
  'terminal-focus.ts',
  'terminal-file-resize.ts',
  'ui/react-dialog.tsx',
]);
const measuredStyles = new Set([
  'terminal-assets.tsx',
  'terminal-command-menu.tsx',
  'terminal-command-suggestions.tsx',
  'shared-scrollbars.ts',
  'app-shell.tsx',
  'clipboard.ts',
]);
const downloads = new Set([
  'terminal-transfers.tsx',
  'terminal-file-api.ts',
  'config-backup.tsx',
  'features/icons/page.tsx',
]);
const fileInputReset = new Set([
  'terminal-ai.tsx',
  'terminal-file-uploads.ts',
  'config-backup.tsx',
]);
function webPath(filename) {
  return filename.replaceAll('\\', '/').split('/web/').at(-1);
}
function integrationWrite(filename, node, source) {
  const file = webPath(filename),
    property = propertyName(node.left),
    target = node.left.getText(source),
    value = node.right;
  if (file === 'rdp-client.ts' && /^(display|keyboard|instance|reader)\.on[a-z]+$/.test(target))
    return true;
  if (file === 'clipboard.ts' && target === 'field.value') return true;
  if (
    fileInputReset.has(file) &&
    target === 'e.target.value' &&
    ts.isStringLiteral(value) &&
    value.text === ''
  )
    return true;
  if (property === 'indeterminate' && file === 'wake-batch.tsx' && target === 'el.indeterminate')
    return true; // checkbox tri-state DOM-only property
  if (/^on[a-z]+$/.test(property)) {
    if (file === 'terminal-view.tsx' && target.startsWith('ws.')) return true;
    if (file === 'terminal-file-api.ts' && target.startsWith('xhr.')) return true;
    if (file === 'features/icons/page.tsx' && target === 'reader.onload') return true;
  }
  if (target.includes('.style.') && measuredStyles.has(file)) return true;
  if (
    (file === 'app-shell.tsx' || file === 'platform.ts') &&
    target.startsWith('document.documentElement.dataset.')
  )
    return true;
  return false;
}
function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  )
    return node.argumentExpression.text;
  return '';
}
export function auditSourceText(filename, text) {
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const failures = [];
  function report(node, message) {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    failures.push(`${filename}:${line + 1}:${character + 1}: ${message}`);
  }
  if (/@ts-(?:ignore|nocheck|expect-error)\b/.test(text))
    failures.push(`${filename}: TypeScript suppression directive`);
  function visit(node) {
    const file = webPath(filename);
    if (
      ts.isIdentifier(node) &&
      ['createSurface', 'SurfaceHost', 'bodySurface', 'mountAppShell'].includes(node.text)
    )
      report(node, 'legacy React surface/controller bridge is forbidden');
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /render-surface|static-elements|ui\/query(?:\.js)?$/.test(node.moduleSpecifier.text)
    )
      report(node, 'legacy DOM ownership module is forbidden');
    if (ts.isIdentifier(node) && node.text === 'createRoot' && file !== 'main.tsx')
      report(node, 'React root must be created only by web/main.tsx');
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const property = propertyName(node.left),
        target = node.left.getText(source);
      if (
        (businessProperties.has(property) ||
          /^on[a-z]+$/.test(property) ||
          target.includes('.style.') ||
          target.includes('.dataset.')) &&
        !integrationWrite(filename, node, source)
      )
        report(node, 'business DOM/property writes must be expressed by React state and props');
    }
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression),
        expression = node.expression.getText(source);
      const receiver = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.expression.getText(source)
        : '';
      if (
        ['add', 'remove', 'toggle', 'replace'].includes(method) &&
        receiver.endsWith('.classList') &&
        !layoutClasses.has(file)
      )
        report(node, 'business CSS class mutations must be expressed by React props');
      if (
        ['setAttribute', 'removeAttribute', 'toggleAttribute'].includes(method) &&
        !(file === 'platform.ts' && expression === 'document.body.setAttribute') &&
        !(file === 'ai-markdown.ts' && method === 'removeAttribute')
      )
        report(node, 'business attributes must be expressed by React props');
      if (method === 'setProperty' && receiver.endsWith('.style') && !measuredStyles.has(file))
        report(node, 'imperative style mutation outside measured layout integration');
      if (
        ['createTextNode', 'createDocumentFragment', 'replaceWith', 'before', 'after'].includes(
          method,
        )
      )
        report(node, 'business DOM creation/replacement must be owned by React');
      if (
        method === 'remove' &&
        !receiver.endsWith('.classList') &&
        !(
          (file === 'clipboard.ts' && receiver === 'field') ||
          (file === 'config-backup.tsx' && receiver === 'a')
        )
      )
        report(node, 'business DOM removal must be owned by React');
      if (
        method === 'addEventListener' &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const event = node.arguments[0].text;
        if (
          ['click', 'submit', 'input', 'change'].includes(event) &&
          !(event === 'change' && ['media', 'query', 'systemMedia', 'motion'].includes(receiver))
        )
          report(node, 'business UI events must use React handlers');
      }
      if (method === 'createElement' && receiver !== 'React') {
        const tag = node.arguments[0];
        const allowed =
          tag &&
          ts.isStringLiteral(tag) &&
          ((downloads.has(file) && tag.text === 'a') ||
            (file === 'clipboard.ts' && tag.text === 'textarea') ||
            (file === 'ai-markdown.ts' && tag.text === 'template'));
        if (!allowed) report(node, 'business DOM creation must be owned by React');
      }
      if (
        ['append', 'appendChild', 'prepend', 'replaceChildren', 'insertBefore'].includes(method) &&
        !(
          file === 'clipboard.ts' ||
          file === 'config-backup.tsx' ||
          (file === 'rdp-client.ts' && method === 'replaceChildren' && receiver === 'target')
        )
      )
        report(node, 'business DOM insertion must be owned by React');
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword)
      report(node, 'explicit any weakens a frontend contract');
    if (
      ts.isAsExpression(node) &&
      ts.isAsExpression(node.expression) &&
      node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
    )
      report(node, 'double assertion bypasses a frontend contract');
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      htmlProperties.has(propertyName(node.left))
    ) {
      const isolatedSanitizer =
        filename.replaceAll('\\', '/').endsWith('/web/ai-markdown.ts') &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isIdentifier(node.left.expression) &&
        node.left.expression.text === 'template';
      if (!isolatedSanitizer) report(node, 'imperative HTML write must be owned by React');
    }
    if (ts.isCallExpression(node) && propertyName(node.expression) === 'insertAdjacentHTML')
      report(node, 'imperative HTML insertion must be owned by React');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}
export async function auditFrontendSources(root = projectRoot) {
  const failures = [];
  let count = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.name.endsWith('.js'))
        failures.push(`${filename}: legacy JavaScript frontend source`);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        count++;
        failures.push(...auditSourceText(filename, await readFile(filename, 'utf8')));
      }
    }
  }
  const entry = await readFile(path.join(root, 'web/index.html'), 'utf8');
  if (/<(?:aside|main|section|dialog|template)\b/i.test(entry))
    failures.push('web/index.html: business markup must be owned by React feature components');
  if (!/<div id="app"><\/div>/.test(entry))
    failures.push('web/index.html: single React app mount is required');
  await visit(path.join(root, 'web'));
  return { count, failures };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { count, failures } = await auditFrontendSources();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Frontend contract audit passed: ${count} TypeScript/TSX sources`);
}

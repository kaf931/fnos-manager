import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import { JSDOM } from 'jsdom';

const web = fileURLToPath(new URL('../web/', import.meta.url));
function stylesheet(filename) {
  const root = postcss.parse(readFileSync(filename, 'utf8'));
  root.walkAtRules('import', (rule) => {
    const relative = rule.params.match(/^['"]([^'"]+)['"]$/)?.[1];
    assert.ok(relative, `Expected a local stylesheet import: ${rule.params}`);
    rule.replaceWith(stylesheet(path.resolve(path.dirname(filename), relative)).nodes);
  });
  return root;
}
const styles = postcss.root();
for (const filename of [
  'terminal-workspace.css',
  'style.css',
  'fnos-theme.css',
  'native-ui.css',
  'storage.css',
  'shared-surfaces.css',
  'shared-scrollbars.css',
]) {
  styles.append(stylesheet(path.join(web, filename)).nodes);
}

// jsdom does not evaluate viewport media queries. Resolve those explicitly, then
// let its CSS cascade compute selector specificity, inheritance and shorthands.
function atWidth(width) {
  const root = styles.clone();
  root.walkAtRules('media', (rule) => {
    let matches = true;
    for (const [, kind, value] of rule.params.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
      matches &&= kind === 'min' ? width >= Number(value) : width <= Number(value);
    }
    if (/prefers-reduced-motion: reduce/.test(rule.params)) matches = false;
    if (/hover: none|pointer: coarse/.test(rule.params)) matches &&= width <= 620;
    if (/hover: hover/.test(rule.params)) matches &&= width > 620;
    if (matches) rule.replaceWith(rule.nodes);
    else rule.remove();
  });
  root.walkAtRules('supports', (rule) => rule.remove());
  return root;
}

function fixture(page, width, dark = false) {
  const dom =
    new JSDOM(`<html class="standalone-entry" data-page="${page}"><body class="${dark ? 'dark' : ''}">
    <aside class="sidebar"><nav></nav></aside><div class="layout"><main>
    <section id="${page}-page" class="tool-page"><div class="${page === 'terminal' ? 'terminal-list-view' : ''}">
    </div></section></main></div></body></html>`);
  const document = dom.window.document;
  const section = document.querySelector('.tool-page');
  const parent = page === 'terminal' ? section.firstElementChild : section;
  parent.insertAdjacentHTML(
    'beforeend',
    `<header class="toolbar task-toolbar"><h1 class="sr-only">Title</h1>
      <div class="task-toolbar-filters"><label class="search"><input></label>
      <div class="task-status-field"><span>Status</span><div>
      <div class="mobile-toolbar-filter"><button aria-pressed="true">All</button><button>Other</button></div>
      </div></div></div><div class="toolbar-actions"><button class="primary"><svg></svg></button>
      <button class="toolbar-refresh">Refresh</button></div></header>`,
  );
  const style = document.createElement('style');
  style.textContent = atWidth(width).toString();
  document.head.append(style);
  return {
    dom,
    value(selector, property) {
      const element = document.querySelector(selector);
      assert.ok(element, selector);
      return dom.window.getComputedStyle(element).getPropertyValue(property);
    },
  };
}

for (const width of [375, 620]) {
  test(`shared mobile toolbars preserve grid placement and 40px targets at ${width}px`, () => {
    for (const page of ['icons', 'tasks', 'terminal']) {
      const { dom, value } = fixture(page, width);
      try {
        assert.equal(value('.task-toolbar', 'display'), 'grid');
        assert.equal(value('.task-toolbar', 'gap'), '12px 8px');
        assert.equal(value('.search', 'grid-column'), '1/-1');
        assert.equal(value('.search', 'height'), '40px');
        assert.equal(value('.toolbar-actions', 'grid-column'), '2');
        assert.equal(value('.toolbar-actions', 'grid-row'), '2');
        assert.equal(value('.toolbar-actions .primary', 'width'), '40px');
        assert.equal(value('.toolbar-actions .primary', 'height'), '40px');
        assert.equal(value('.toolbar-refresh', 'display'), 'none');
        assert.equal(value('.mobile-toolbar-filter button', 'min-height'), '40px');
        assert.equal(value('.mobile-toolbar-filter', 'overflow-x'), 'auto');
        assert.equal(
          value('.mobile-toolbar-filter', 'margin-bottom'),
          'calc(0px - var(--app-scrollbar-horizontal-gutter, 0px))',
        );
      } finally {
        dom.window.close();
      }
    }
  });
}

for (const width of [621, 850, 1440]) {
  test(`desktop toolbar sizing stays independent of mobile filters at ${width}px`, () => {
    const { dom, value } = fixture('icons', width);
    try {
      assert.equal(value('.task-toolbar', 'display'), 'flex');
      assert.equal(value('.search', 'height'), '32px');
      assert.equal(value('.search', 'width'), '180px');
      assert.equal(value('.toolbar-actions .primary', 'height'), '32px');
      assert.equal(value('.mobile-toolbar-filter', 'display'), 'none');
      assert.equal(value('.task-toolbar', 'flex-wrap'), width >= 721 ? 'nowrap' : 'wrap');
    } finally {
      dom.window.close();
    }
  });
}

function declarations(selector, width) {
  const values = {};
  atWidth(width).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => {
        values[declaration.prop] = declaration.value;
      });
    }
  });
  return values;
}

test('mobile card grids preserve content-sized rows instead of fitting cards into list height', () => {
  for (const page of ['terminal', 'wake']) {
    for (const width of [375, 620, 621]) {
      const { dom, value } = fixture(page, width);
      const cards = dom.window.document.createElement('div');
      cards.className = 'cards';
      cards.id = page === 'terminal' ? 'terminal-connections' : 'wake-cards';
      dom.window.document.querySelector('.tool-page').append(cards);
      try {
        if (width <= 620) assert.equal(value('.cards', 'grid-auto-rows'), 'max-content');
        else assert.notEqual(value('.cards', 'grid-auto-rows'), 'max-content');
      } finally {
        dom.window.close();
      }
    }
  }
});

test('compact filter and action faces remain 32px inside 40px targets, using theme tokens', () => {
  // jsdom does not compute pseudo-elements; inspect their cascaded declarations.
  const face = declarations('.task-toolbar .mobile-toolbar-filter button::before', 375);
  assert.equal(face.inset, '4px 0');
  assert.equal(face['pointer-events'], 'none');
  assert.equal(face.background, 'var(--semi-color-fill-0)');
  const active = declarations(
    ".task-toolbar .mobile-toolbar-filter button[aria-pressed='true']::before",
    375,
  );
  assert.equal(active.background, 'var(--text)');
  const action = declarations(
    '.task-toolbar .toolbar-actions button:not(.toolbar-refresh)::before',
    375,
  );
  assert.equal(action.inset, '4px 0');
  assert.equal(action.background, 'var(--semi-color-fill-0)');
});

test('storage entry responsive rule is a valid media block rather than a dangling selector', () => {
  const entry = stylesheet(path.join(web, 'storage.css'));
  entry.walkRules((rule) => {
    assert.ok(!rule.selector.includes('@media'), `Invalid selector: ${rule.selector}`);
  });
  assert.equal(declarations('.storage-entry-status h2', 375)['font-size'], '18px');
  assert.equal(declarations('.storage-entry-status h2', 1440)['font-size'], '20px');
});

for (const width of [390, 1440])
  test(`storage and terminal rails share geometry and selected state at ${width}px`, () => {
    const dom = new JSDOM(`<style>${atWidth(width).toString()}</style>
      <nav class="workspace-rail terminal-workspace-rail"><button class="selected"><svg></svg><span class="workspace-rail-tooltip">Terminal</span></button></nav>
      <nav class="workspace-rail storage-workspace-nav"><button id="storage-back"></button><div class="workspace-rail-group storage-workspace-modes"><button></button><button></button><button></button><button aria-selected="true"><svg></svg><span class="workspace-rail-tooltip">Storage</span></button></div></nav>`);
    const { document } = dom.window;
    const compare = (left, right, properties) => {
      const a = dom.window.getComputedStyle(document.querySelector(left));
      const b = dom.window.getComputedStyle(document.querySelector(right));
      for (const property of properties)
        assert.equal(b.getPropertyValue(property), a.getPropertyValue(property), property);
    };
    try {
      compare('.terminal-workspace-rail', '.storage-workspace-nav', [
        'width',
        'padding',
        'gap',
        'align-items',
      ]);
      compare(
        '.terminal-workspace-rail button',
        '.storage-workspace-modes button[aria-selected="true"]',
        ['width', 'height', 'padding', 'margin-top', 'border-radius', 'background-color', 'color'],
      );
      compare('.terminal-workspace-rail svg', '.storage-workspace-modes svg', ['width', 'height']);
    } finally {
      dom.window.close();
    }
  });

for (const width of [390, 620])
  test(`storage mobile content meets the rail without an extra left gutter at ${width}px`, () => {
    const dom = new JSDOM(
      `<style>${atWidth(width).toString()}</style><div class="storage-workspace-content"><div class="history-compact-list"><div class="history-compact-row">Record</div></div></div>`,
    );
    try {
      const content = dom.window.getComputedStyle(
        dom.window.document.querySelector('.storage-workspace-content'),
      );
      const row = dom.window.getComputedStyle(
        dom.window.document.querySelector('.history-compact-row'),
      );
      assert.equal(content.paddingLeft, '0px');
      assert.equal(content.paddingRight, '16px');
      assert.equal(row.getPropertyValue('margin-inline'), '12px');
    } finally {
      dom.window.close();
    }
  });

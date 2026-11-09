import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSize,
  sortEntries,
  joinPath,
  parentPath,
  validName,
  isCurrentResponse,
} from '../.web-test/terminal-file-model.js';
test('file panel model handles unicode paths, directories first, sizes and stale sessions', () => {
  assert.equal(formatSize(1024), '1 KB');
  assert.equal(joinPath('/home', '中文.txt'), '/home/中文.txt');
  assert.equal(parentPath('/home/user'), '/home');
  assert.equal(parentPath('/'), '/');
  assert.ok(validName("中文 '<img>.txt"));
  assert.ok(!validName('../bad'));
  assert.equal(isCurrentResponse({ id: 'a', generation: 1 }, { id: 'a', generation: 2 }), false);
  assert.deepEqual(
    sortEntries(
      [
        { name: 'a', type: 'file', size: 8 },
        { name: 'z', type: 'directory', size: 0 },
      ],
      'size',
      true,
    ).map((e) => e.name),
    ['z', 'a'],
  );
});
import { recordPath } from '../.web-test/terminal-file-model.js';
test('file history supports back/forward, refresh and branching navigation', () => {
  let h = { paths: [], index: -1 };
  h = recordPath(h, '/');
  h = recordPath(h, '/a');
  h = recordPath(h, '/b');
  h = recordPath(h, '/a', 1);
  assert.deepEqual(h, { paths: ['/', '/a', '/b'], index: 1 });
  h = recordPath(h, '/a');
  assert.equal(h.paths.length, 3);
  h = recordPath(h, '/c');
  assert.deepEqual(h, { paths: ['/', '/a', '/c'], index: 2 });
});
test('history stays unchanged on refresh and back resolves canonical path', () => {
  const h = { paths: ['/', '/link'], index: 1 };
  assert.equal(recordPath(h, '/link'), h);
  assert.deepEqual(recordPath(h, '/actual', 1), { paths: ['/', '/actual'], index: 1 });
});
import { isFileContextCurrent } from '../.web-test/terminal-file-model.js';
test('context menu cannot outlive its session, path or directory request', () => {
  const session = { id: 'old', generation: 1, connected: true },
    context = { session: { ...session }, path: '/old', sequence: 3 };
  assert.ok(isFileContextCurrent(context, session, '/old', 3));
  assert.ok(
    !isFileContextCurrent(context, { id: 'new', generation: 2, connected: true }, '/old', 3),
  );
  assert.ok(!isFileContextCurrent(context, session, '/new', 3));
  assert.ok(!isFileContextCurrent(context, session, '/old', 4));
  assert.ok(!isFileContextCurrent(context, { ...session, connected: false }, '/old', 3));
});
import { shouldOpenEntry } from '../.web-test/terminal-file-model.js';
test('desktop opens directories by double click; touch and keyboard use single activation', () => {
  assert.equal(shouldOpenEntry('directory', 'click', 'mouse'), false);
  assert.equal(shouldOpenEntry('directory', 'double-click', 'mouse'), true);
  assert.equal(shouldOpenEntry('directory', 'click', 'touch'), true);
  assert.equal(shouldOpenEntry('directory', 'keyboard'), true);
  assert.equal(shouldOpenEntry('file', 'double-click', 'mouse'), false);
  assert.equal(shouldOpenEntry('link', 'double-click', 'mouse'), true);
});
import { clampFilePanelWidth } from '../.web-test/terminal-file-model.js';
test('file panel resize keeps both panes usable and clamps drag/keyboard widths', () => {
  assert.equal(clampFilePanelWidth(360, 1280), 360);
  assert.equal(clampFilePanelWidth(120, 1280), 120);
  assert.equal(clampFilePanelWidth(1100, 1280), 896);
  assert.equal(clampFilePanelWidth(1000, 700), 460);
  assert.equal(clampFilePanelWidth(360, 393), 153);
});
import { formatFileTime } from '../.web-test/terminal-file-model.js';
test('file modification time includes year and rejects invalid timestamps', () => {
  assert.match(formatFileTime(Date.UTC(2026, 5, 10, 12)), /2026/);
  assert.equal(formatFileTime(NaN), '—');
});

import { resolveFilePanelResize } from '../.web-test/terminal-file-model.js';
test('file panel shrinks below old minimum and collapses only at the edge', () => {
  assert.deepEqual(resolveFilePanelResize(120, 1280), { width: 120, collapsed: false });
  assert.deepEqual(resolveFilePanelResize(13, 1280), { width: 13, collapsed: false });
  assert.deepEqual(resolveFilePanelResize(12, 1280), { width: 0, collapsed: true });
  assert.deepEqual(resolveFilePanelResize(-100, 1280), { width: 0, collapsed: true });
  assert.equal(clampFilePanelWidth(0, 1280), 0);
  assert.deepEqual(resolveFilePanelResize(2000, 1280), { width: 896, collapsed: false });
});
import { fileContextPath } from '../.web-test/terminal-file-model.js';
test('copy path uses the current directory or the selected entry full path without shell escaping', () => {
  assert.equal(fileContextPath({ path: '/home/super' }), '/home/super');
  assert.equal(fileContextPath({ path: '/', entry: { name: '中文 文件.txt' } }), '/中文 文件.txt');
  assert.equal(
    fileContextPath({ path: '/home', entry: { name: "quote '$.txt" } }),
    "/home/quote '$.txt",
  );
});

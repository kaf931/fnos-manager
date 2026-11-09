import test from 'node:test';
import assert from 'node:assert/strict';
import { planFolderUpload, uploadFolder } from '../.web-test/terminal-folder-upload.js';
const file = (path, size = 3) => ({ name: path.split('/').at(-1), webkitRelativePath: path, size });
test('folder plan preserves unicode nested paths and can rename only the root', () => {
  const plan = planFolderUpload([file('项目/a.txt'), file('项目/目录/b.txt')], '备份');
  assert.equal(plan.name, '备份');
  assert.deepEqual(plan.directories, ['备份', '备份/目录']);
  assert.deepEqual(
    plan.files.map((f) => f.relativePath),
    ['备份/a.txt', '备份/目录/b.txt'],
  );
  assert.equal(plan.bytes, 6);
});
test('folder selection rejects traversal, mixed roots, duplicate names and oversized files before any writes', () => {
  for (const files of [
    [file('a/../x')],
    [file('a/x'), file('b/y')],
    [file('a/x'), file('a/x')],
    [file('a/x', 256 * 1024 * 1024 + 1)],
    [file('a/x'), file('a/x/y')],
  ])
    assert.throws(() => planFolderUpload(files));
});
test('folder upload creates ancestors before files and stops after cancellation', async () => {
  const plan = planFolderUpload([file('a/sub/x'), file('a/y')]),
    calls = [],
    controller = new AbortController();
  await assert.rejects(
    uploadFolder(plan, {
      path: '/remote',
      signal: controller.signal,
      isCurrent: () => true,
      mkdir: async (parent, name) => calls.push(['mkdir', parent, name]),
      upload: async (parent, name) => {
        calls.push(['upload', parent, name]);
        controller.abort();
      },
    }),
    /取消/,
  );
  assert.deepEqual(calls, [
    ['mkdir', '/remote', 'a'],
    ['mkdir', '/remote/a', 'sub'],
    ['upload', '/remote/a/sub', 'x'],
  ]);
});
test('existing root failure never merges or uploads into it', async () => {
  let uploaded = false;
  await assert.rejects(
    uploadFolder(planFolderUpload([file('a/x')]), {
      path: '/',
      isCurrent: () => true,
      mkdir: async () => {
        throw Error('同名文件夹已存在');
      },
      upload: async () => {
        uploaded = true;
      },
    }),
    /同名/,
  );
  assert.equal(uploaded, false);
});
test('late refresh after session change cannot clear the next session upload UI', async () => {
  const { finishFolderUpload } = await import('../.web-test/terminal-folder-upload.js');
  let current = true,
    finished = false,
    resolve;
  const wait = new Promise((r) => (resolve = r));
  const pending = finishFolderUpload({
    refresh: () => wait,
    isCurrent: () => current,
    finish: () => {
      finished = true;
    },
  });
  current = false;
  resolve();
  await pending;
  assert.equal(finished, false);
});

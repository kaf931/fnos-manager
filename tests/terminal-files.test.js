import { archiveExec } from './fixtures/archive-exec.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionFiles, validateName } from '../server/terminal/files.js';
test('file names reject path components and controls; paths are never shell commands', () => {
  for (const n of ['', '.', '..', 'a/b', 'a\0b', 'a\nb']) assert.throws(() => validateName(n));
  assert.equal(validateName("中文 '$<img>.txt"), "中文 '$<img>.txt");
});
test('files require connected session and close fails pending access', async () => {
  const f = new SessionFiles({}, { isConnected: () => false });
  await assert.rejects(f.list(), /连接/);
  f.close();
  await assert.rejects(f.list(), /连接|关闭/);
});
import { mkdtemp, writeFile, mkdir, symlink, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import ssh2 from 'ssh2';
import { Readable } from 'node:stream';
import { sshFixture } from './fixtures/ssh-server.js';
async function fixture() {
  const root = await mkdtemp(os.tmpdir() + '/sftp-');
  await mkdir(root + '/目录');
  await mkdir(root + '/denied');
  await writeFile(root + "/中文 '<img>.txt", 'hello');
  await symlink('目录', root + '/link');
  const ssh = await sshFixture({ sftpRoot: root, execHandler: archiveExec(root) }),
    client = new ssh2.Client();
  await new Promise((r, j) =>
    client.on('ready', r).on('error', j).connect({
      host: '127.0.0.1',
      port: ssh.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  const files = new SessionFiles(client, { isConnected: () => true });
  return {
    root,
    files,
    close: async () => {
      files.close();
      client.destroy();
      await ssh.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('real SFTP lists directory, unicode names, empty and denied directories', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const rows = await f.files.list();
  assert.equal(rows.path, '/');
  assert.ok(rows.entries.some((x) => x.name === "中文 '<img>.txt" && x.type === 'file'));
  assert.ok(rows.entries.some((x) => x.name === 'link' && x.type === 'link'));
  assert.equal((await f.files.list('/目录')).entries.length, 0);
  await assert.rejects(f.files.list('/denied'), /权限/);
  await assert.rejects(f.files.list('relative'), /绝对路径/);
});
test('real SFTP create, stream upload/download, collision, rename and nonrecursive delete', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.files.mkdir('/', 'new');
  await f.files.upload('/new', 'data.txt', Readable.from(['test data']), { size: 9 });
  assert.equal(await readFile(f.root + '/new/data.txt', 'utf8'), 'test data');
  const d = await f.files.download('/new/data.txt');
  const chunks = [];
  for await (const b of d.stream) chunks.push(b);
  assert.equal(Buffer.concat(chunks).toString(), 'test data');
  await assert.rejects(
    f.files.upload('/new', 'data.txt', Readable.from(['bad']), { size: 3 }),
    /同名/,
  );
  assert.equal(await readFile(f.root + '/new/data.txt', 'utf8'), 'test data');
  await f.files.rename('/new', 'data.txt', 'renamed.txt');
  await assert.rejects(f.files.remove('/', 'new'), /目录为空/);
  await f.files.remove('/new', 'renamed.txt');
  await f.files.remove('/', 'new');
  await f.files.remove('/', 'link');
  assert.ok((await f.files.list('/目录')).entries);
  await assert.rejects(f.files.download('/目录'), /普通文件/);
  await assert.rejects(
    f.files.upload('/', 'huge', Readable.from([]), { size: 256 * 1024 * 1024 + 1 }),
    /256/,
  );
});
test('failed upload removes temp file and write slot is released', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await assert.rejects(
    f.files.upload('/', 'bad', Readable.from(['too many']), { size: 1 }),
    /声明大小/,
  );
  assert.equal(
    (await f.files.list()).entries.filter((x) => x.name.startsWith('.toolbox-upload-')).length,
    0,
  );
  await f.files.mkdir('/', 'next');
});
import { EventEmitter } from 'node:events';
test('directory limit closes handles and timeout leaves terminal client intact', async () => {
  let closed = 0;
  const f = new SessionFiles({}, { isConnected: () => true });
  const attrs = {
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isFile: () => true,
    size: 0,
    mtime: 0,
  };
  f.channel = async () => ({});
  f.handleCall = (_, method, ...args) => f.call(method, ...args);
  f.call = async (method) => {
    if (method === 'realpath') return '/';
    if (method === 'opendir') return Buffer.from('h');
    if (method === 'close') {
      closed++;
      return;
    }
    return Array.from({ length: 10001 }, (_, i) => ({ filename: String(i), attrs }));
  };
  await assert.rejects(f.list(), /10000/);
  assert.equal(closed, 1);
  let ended = 0;
  const channel = new EventEmitter();
  channel.realpath = () => {};
  channel.end = () => ended++;
  const timeout = new SessionFiles(
    { sftp: (cb) => setImmediate(() => cb(null, channel)) },
    { isConnected: () => true, timeoutMs: 10 },
  );
  await assert.rejects(timeout.list(), /超时/);
  assert.equal(ended, 1);
});
test('cancelled and size mismatch uploads clean temp files and collision rename preserves originals', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    f.files.upload('/', 'cancel', Readable.from(['a']), { size: 1, signal: c.signal }),
    /取消/,
  );
  await assert.rejects(f.files.upload('/', 'short', Readable.from(['a']), { size: 2 }), /完整/);
  await writeFile(f.root + '/a', 'a');
  await writeFile(f.root + '/b', 'b');
  await assert.rejects(f.files.rename('/', 'a', 'b'), /同名/);
  assert.equal(await readFile(f.root + '/b', 'utf8'), 'b');
  assert.equal(
    (await f.files.list()).entries.filter((e) => e.name.startsWith('.toolbox-upload-')).length,
    0,
  );
});
test('late SFTP initialization cannot replace a new channel after timeout', async () => {
  const callbacks = [],
    a = new EventEmitter(),
    b = new EventEmitter();
  let aEnded = 0,
    bEnded = 0;
  a.end = () => aEnded++;
  b.end = () => bEnded++;
  const f = new SessionFiles(
    { sftp: (cb) => callbacks.push(cb) },
    { isConnected: () => true, timeoutMs: 10 },
  );
  const first = f.channel();
  await assert.rejects(first, /超时/);
  const second = f.channel();
  callbacks[1](null, b);
  assert.equal(await second, b);
  callbacks[0](null, a);
  assert.equal(f.sftp, b);
  assert.equal(aEnded, 1);
  assert.equal(bEnded, 0);
  f.close();
});
test('download slots, cancellation and session closure release streams', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await writeFile(f.root + '/large', Buffer.alloc(1024 * 1024, 42));
  const a = await f.files.download('/large'),
    b = await f.files.download('/large');
  a.stream.on('error', () => {});
  b.stream.on('error', () => {});
  await assert.rejects(f.files.download('/large'), /两个/);
  a.stream.destroy();
  await new Promise((r) => a.stream.once('close', r));
  const c = await f.files.download('/large');
  c.stream.on('error', () => {});
  f.files.close();
  await new Promise((r) => setImmediate(r));
  assert.ok(b.stream.destroyed && c.stream.destroyed);
  assert.equal(f.files.readers, 0);
});
import sftpModule from 'ssh2/lib/protocol/SFTP.js';
for (const phase of ['open', 'close'])
  test('stalled upload ' + phase + ' releases write slot within deadline', async () => {
    const s = new EventEmitter();
    s.end = () => {};
    s.lstat = (p, cb) => queueMicrotask(() => cb(Object.assign(Error(), { code: 2 })));
    s.open = (...args) => {
      if (phase !== 'open') queueMicrotask(() => args.at(-1)(null, Buffer.from('h')));
    };
    s.fchmod = (h, m, cb) => queueMicrotask(() => cb());
    s.write = (h, b, o, l, p, cb) => queueMicrotask(() => cb(null, l));
    s.close = () => {};
    s.unlink = (p, cb) => queueMicrotask(() => cb());
    s.rename = (a, b, cb) => queueMicrotask(() => cb());
    s.createWriteStream = sftpModule.SFTP.prototype.createWriteStream;
    const f = new SessionFiles(
      { sftp: (cb) => queueMicrotask(() => cb(null, s)) },
      { isConnected: () => true, idleMs: 20, timeoutMs: 20 },
    );
    let settled = false;
    f.upload('/', 'test', Readable.from(['a']), { size: 1 })
      .catch(() => {})
      .finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 130));
    assert.equal(settled, true);
    assert.equal(f.writing, false);
    assert.equal(f.streams.size, 0);
    f.close();
  });
test('cancelled download with stalled CLOSE does not leak slots or streams', async () => {
  const s = new EventEmitter();
  s.end = () => {};
  s.stat = (p, cb) => queueMicrotask(() => cb(null, { isFile: () => true, size: 1000000 }));
  s.open = (...args) => queueMicrotask(() => args.at(-1)(null, Buffer.from('h')));
  s.read = () => {};
  s.close = () => {};
  s.createReadStream = sftpModule.SFTP.prototype.createReadStream;
  const f = new SessionFiles(
    { sftp: (cb) => queueMicrotask(() => cb(null, s)) },
    { isConnected: () => true, idleMs: 20, timeoutMs: 20 },
  );
  for (let i = 0; i < 3; i++) {
    const d = await f.download('/test');
    d.stream.on('error', () => {});
    d.stream.destroy();
    await new Promise((r) => d.stream.once('close', r));
  }
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(f.readers, 0);
  assert.equal(f.streams.size, 0);
  f.close();
});
test('upload cancelled during close never commits the destination', async () => {
  const controller = new AbortController(),
    s = new EventEmitter();
  let renamed = false,
    unlinked = false;
  s.end = () => {};
  s.lstat = (p, cb) =>
    queueMicrotask(() =>
      p.includes('.toolbox-upload-') ? cb(null, {}) : cb(Object.assign(Error(), { code: 2 })),
    );
  s.open = (...args) => queueMicrotask(() => args.at(-1)(null, Buffer.from('h')));
  s.write = (h, b, o, l, p, cb) => queueMicrotask(() => cb(null, l));
  s.close = (h, cb) => {
    controller.abort();
    setTimeout(() => cb(), 5);
  };
  s.rename = (a, b, cb) => {
    renamed = true;
    cb();
  };
  s.unlink = (p, cb) => {
    unlinked = true;
    cb();
  };
  const f = new SessionFiles(
    { sftp: (cb) => queueMicrotask(() => cb(null, s)) },
    { isConnected: () => true, timeoutMs: 30 },
  );
  await assert.rejects(
    f.upload('/', 'target', Readable.from(['x']), { size: 1, signal: controller.signal }),
    /取消/,
  );
  assert.equal(renamed, false);
  assert.equal(unlinked, true);
  f.close();
});
test('manual folder size counts regular files recursively without following links', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await mkdir(f.root + '/measure');
  await mkdir(f.root + '/measure/sub');
  await writeFile(f.root + '/measure/a', Buffer.alloc(10));
  await writeFile(f.root + '/measure/sub/b', Buffer.alloc(3));
  await symlink('..', f.root + '/measure/sub/loop');
  await symlink('../measure', f.root + '/measure/link');
  const result = await f.files.calculateSize('/', 'measure');
  assert.equal(result.bytes, 13);
  assert.equal(result.files, 2);
  assert.equal(result.directories, 1);
  await assert.rejects(f.files.calculateSize('/', "中文 '<img>.txt"), /文件夹/);
  f.files.maxScanEntries = 2;
  await assert.rejects(f.files.calculateSize('/', 'measure'), /上限/);
  assert.equal(f.files.calculating, false);
});
test('folder size timeout releases scan state and closes its SFTP channel', async () => {
  const s = new EventEmitter();
  let ended = 0;
  s.end = () => ended++;
  s.lstat = (p, cb) =>
    queueMicrotask(() => cb(null, { isDirectory: () => true, isSymbolicLink: () => false }));
  s.opendir = () => {};
  const f = new SessionFiles(
    { sftp: (cb) => queueMicrotask(() => cb(null, s)) },
    { isConnected: () => true, timeoutMs: 100 },
  );
  f.scanTimeoutMs = 15;
  await assert.rejects(f.calculateSize('/', 'folder'), /超时|上限/);
  assert.equal(f.calculating, false);
  assert.equal(f.jobs.size, 0);
  assert.equal(ended, 1);
  f.close();
});
test('two concurrent directory requests reproduce the busy response on double click', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const perform = f.files.perform.bind(f.files);
  f.files.perform = (s, method, args, ...rest) =>
    method === 'readdir'
      ? new Promise((r) => setTimeout(r, 50)).then(() => perform(s, method, args, ...rest))
      : perform(s, method, args, ...rest);
  const first = f.files.list('/目录');
  await assert.rejects(
    f.files.list('/目录'),
    (e) => e.status === 409 && /正在读取目录/.test(e.message),
  );
  assert.equal((await first).path, '/目录');
});
import { planFolderUpload, uploadFolder } from '../.web-test/terminal-folder-upload.js';
test('folder upload streams a nested tree over real SFTP and preserves existing root on retry', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const plan = planFolderUpload([
    { name: 'a.txt', webkitRelativePath: '上传项目/a.txt', size: 5, content: 'hello' },
    { name: 'b.txt', webkitRelativePath: '上传项目/子目录/b.txt', size: 3, content: 'abc' },
  ]);
  const options = {
    path: '/',
    isCurrent: () => true,
    mkdir: (path, name) => f.files.mkdir(path, name),
    upload: (path, name, file, { signal }) =>
      f.files.upload(path, name, Readable.from([file.content]), { size: file.size, signal }),
  };
  await uploadFolder(plan, options);
  assert.equal(await readFile(f.root + '/上传项目/a.txt', 'utf8'), 'hello');
  assert.equal(await readFile(f.root + '/上传项目/子目录/b.txt', 'utf8'), 'abc');
  await assert.rejects(uploadFolder(plan, options), /同名/);
  assert.equal(await readFile(f.root + '/上传项目/a.txt', 'utf8'), 'hello');
});
test('visual permission updates change only selected file and reject links and invalid modes', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await writeFile(f.root + '/permissions.txt', 'same bytes');
  const before = await f.files.permissionInfo('/', 'permissions.txt');
  assert.equal(before.type, 'file');
  await f.files.chmod('/', 'permissions.txt', 0o640);
  assert.equal((await f.files.permissionInfo('/', 'permissions.txt')).mode, 0o640);
  assert.equal(await readFile(f.root + '/permissions.txt', 'utf8'), 'same bytes');
  await assert.rejects(f.files.chmod('/', 'link', 0o777), /符号链接/);
  await assert.rejects(f.files.chmod('/', 'permissions.txt', 0o10000), /权限/);
});

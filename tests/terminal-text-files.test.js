import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import { sshFixture } from './fixtures/ssh-server.js';
import { SessionFiles } from '../server/terminal/files.js';
import { readTextFile, saveTextFile } from '../server/terminal/text-files.js';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'text-edit-'));
  await fs.writeFile(root + '/config.txt', 'hello\r\n中文', { mode: 0o640 });
  await fs.symlink('config.txt', root + '/link');
  const ssh = await sshFixture({ sftpRoot: root });
  const client = new ssh2.Client();
  await new Promise((resolve, reject) =>
    client.on('ready', resolve).on('error', reject).connect({
      host: '127.0.0.1',
      port: ssh.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  const files = new SessionFiles(client);
  t.after(async () => {
    files.close();
    client.destroy();
    await ssh.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, files };
}
test('SFTP text reads reject links and detect stale revisions before writes', async (t) => {
  const { root, files } = await fixture(t);
  const file = await readTextFile(files, '/config.txt');
  assert.equal(file.content, 'hello\r\n中文');
  await assert.rejects(readTextFile(files, '/link'), /普通文件/);
  await fs.writeFile(root + '/config.txt', 'changed');
  await assert.rejects(
    saveTextFile(files, { ...file, path: '/config.txt', content: 'overwrite' }),
    /已被修改/,
  );
  assert.equal(await fs.readFile(root + '/config.txt', 'utf8'), 'changed');
});
test('unsupported atomic rename leaves original intact and removes temporary file', async (t) => {
  const { root, files } = await fixture(t);
  const file = await readTextFile(files, '/config.txt');
  await assert.rejects(
    saveTextFile(files, { ...file, path: '/config.txt', content: 'edited' }),
    /原子/,
  );
  assert.equal(await fs.readFile(root + '/config.txt', 'utf8'), file.content);
  assert.deepEqual((await fs.readdir(root)).sort(), ['config.txt', 'link']);
  assert.equal(files.writing, false);
});
test('atomic replacement adapter saves encoded content and preserves mode; second conflict check protects original', async (t) => {
  const { root, files } = await fixture(t);
  const call = files.handleCall.bind(files);
  files.handleCall = async (s, method, ...args) =>
    method === 'ext_openssh_rename'
      ? fs.rename(root + args[0], root + args[1])
      : call(s, method, ...args);
  let file = await readTextFile(files, '/config.txt');
  file = await saveTextFile(files, { ...file, path: '/config.txt', content: '新内容\r\n' });
  assert.equal(file.content, '新内容\r\n');
  assert.equal((await fs.stat(root + '/config.txt')).mode & 0o777, 0o640);
  let changed = false;
  files.handleCall = async (s, method, ...args) => {
    const result = await call(s, method, ...args);
    if (method === 'write' && !changed) {
      changed = true;
      await fs.writeFile(root + '/config.txt', 'external update');
    }
    return result;
  };
  await assert.rejects(
    saveTextFile(files, { ...file, path: '/config.txt', content: 'do not overwrite' }),
    /已被修改/,
  );
  assert.equal(await fs.readFile(root + '/config.txt', 'utf8'), 'external update');
  assert.deepEqual((await fs.readdir(root)).sort(), ['config.txt', 'link']);
});
test('requested original capture runs under write lock before any remote write, failure aborts save', async (t) => {
  const { root, files } = await fixture(t);
  const file = await readTextFile(files, '/config.txt');
  let captures = 0;
  files.textVersions = {
    capture: async (target, bytes, encoding) => {
      captures++;
      assert.equal(files.writing, true);
      assert.equal(target, '/config.txt');
      assert.deepEqual(bytes, await fs.readFile(root + '/config.txt'));
      assert.equal(encoding, 'utf8');
      throw new Error('backup unavailable');
    },
  };
  await assert.rejects(
    saveTextFile(files, { ...file, path: '/config.txt', content: 'edited' }),
    /backup unavailable/,
  );
  assert.equal(captures, 1);
  assert.equal(await fs.readFile(root + '/config.txt', 'utf8'), file.content);
  assert.deepEqual((await fs.readdir(root)).sort(), ['config.txt', 'link']);
  await assert.rejects(
    saveTextFile(files, {
      ...file,
      path: '/config.txt',
      content: 'edited',
      revision: '0'.repeat(64),
    }),
    /已被修改/,
  );
  assert.equal(captures, 1);
  await assert.rejects(
    saveTextFile(files, { ...file, path: '/config.txt', content: 'edited', backup: false }),
    /原子/,
  );
  assert.equal(captures, 1);
});
test('restored draft encoding never changes the codec attached to captured baseline bytes', async (t) => {
  const { root, files } = await fixture(t);
  const file = await readTextFile(files, '/config.txt', 'utf8');
  const original = await fs.readFile(root + '/config.txt');
  let captured;
  files.textVersions = {
    capture: (target, data, encoding) => {
      captured = { target, data, encoding };
    },
  };
  const call = files.handleCall.bind(files);
  files.handleCall = async (s, method, ...args) =>
    method === 'ext_openssh_rename'
      ? fs.rename(root + args[0], root + args[1])
      : call(s, method, ...args);
  const saved = await saveTextFile(files, {
    ...file,
    path: '/config.txt',
    content: 'restored\r\n',
    encoding: 'utf16le',
    bom: true,
  });
  assert.deepEqual(captured, { target: '/config.txt', data: original, encoding: 'utf8' });
  assert.equal(saved.encoding, 'utf16le');
  assert.equal(saved.bom, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TransferService } from '../server/terminal/transfers.js';
test('transfer records isolate accounts and sessions and are cleared without resurrection', () => {
  const service = new TransferService();
  const task = service.begin({
    owner: '1000',
    sessionId: 'first',
    connectionName: 'NAS',
    direction: 'upload',
    path: '/tmp/a',
    size: 10,
  });
  task.progress(5);
  assert.equal(service.list('1000', 'first').active, 1);
  assert.equal(service.list('1000', 'first').items[0].transferred, 5);
  assert.equal(service.list('1001', 'first').items.length, 0);
  assert.equal(service.list('1000', 'other').items.length, 0);
  service.clearSession('first');
  task.progress(10);
  task.finish('completed');
  assert.deepEqual(service.list('1000', 'first'), { active: 0, items: [] });
  assert.deepEqual(new TransferService().list('1000', 'first'), { active: 0, items: [] });
});
import ssh2 from 'ssh2';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture } from './fixtures/ssh-server.js';
import { SessionFiles } from '../server/terminal/files.js';
import { TerminalService } from '../server/app/terminal/terminal.service.js';
test('HTTP upload and download over real SFTP record bytes, failures and owner isolation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nas-transfer-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ssh = await sshFixture({ sftpRoot: root });
  t.after(() => ssh.close());
  const client = new ssh2.Client();
  t.after(() => client.destroy());
  await new Promise((resolve, reject) =>
    client.once('ready', resolve).once('error', reject).connect({
      host: '127.0.0.1',
      port: ssh.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  const files = new SessionFiles(client, { isConnected: () => true });
  t.after(() => files.close());
  const f = await appFixture();
  t.after(f.close);
  const terminal = f.app.get(TerminalService);
  terminal.service.connectedOwned = (owner, id) => {
    if (owner !== '1000' || id !== 'fixture')
      throw Object.assign(new Error('会话不存在'), { status: 404 });
    return { connection: { name: 'Fixture' }, files: () => files };
  };
  const content = Buffer.alloc(9000, 97);
  const response = await fetch(
    f.base +
      '/terminal/sessions/fixture/files/upload?path=%2F&name=file.txt&size=' +
      content.length,
    {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      body: content,
    },
  );
  assert.equal(response.status, 201, await response.text());
  const download = await fetch(
    f.base + '/terminal/sessions/fixture/files/download?path=%2Ffile.txt',
    { headers: f.headers },
  );
  assert.equal(download.status, 200);
  assert.equal((await download.arrayBuffer()).byteLength, content.length);
  const failed = await fetch(
    f.base + '/terminal/sessions/fixture/files/upload?path=%2F&name=file.txt&size=1',
    {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      body: Buffer.from('b'),
    },
  );
  assert.equal(failed.status, 409);
  const history = await (await f.call('/transfers?sessionId=fixture')).json();
  assert.equal(history.active, 0);
  assert.equal(history.items.length, 3);
  assert.deepEqual(
    history.items.filter((x) => x.status === 'completed').map((x) => x.transferred),
    [content.length, content.length],
  );
  assert.equal(history.items.filter((x) => x.status === 'failed').length, 1);
  assert.deepEqual(
    await (
      await f.call('/transfers?sessionId=fixture', 'GET', undefined, { 'x-trim-userid': '1001' })
    ).json(),
    { active: 0, items: [] },
  );
  assert.equal(
    (await f.call('/transfers?sessionId=fixture', 'GET', undefined, { 'x-trim-isadmin': 'false' }))
      .status,
    403,
  );
});

test('a delivered HTTP download completes its record before delayed source cleanup', async (t) => {
  const { Readable } = await import('node:stream');
  const f = await appFixture();
  t.after(f.close);
  let release;
  const stream = new Readable({
    read() {
      this.push(Buffer.from('abc'));
      this.push(null);
    },
    destroy(error, callback) {
      release = () => callback(error);
    },
  });
  const terminal = f.app.get(TerminalService);
  terminal.service.connectedOwned = () => ({
    connection: { name: 'Fixture' },
    files: () => ({ download: async () => ({ name: 'test.txt', size: 3, stream }) }),
  });
  try {
    const response = await fetch(
      f.base + '/terminal/sessions/fixture/files/download?path=%2Ftest.txt',
      { headers: f.headers },
    );
    assert.equal(await response.text(), 'abc');
    assert.equal(typeof release, 'function');
    const history = await (await f.call('/transfers?sessionId=fixture')).json();
    assert.equal(history.active, 0);
    assert.equal(history.items[0].status, 'completed');
    assert.equal(history.items[0].transferred, 3);
  } finally {
    release?.();
  }
});

for (const interruption of ['source failure', 'client abort']) {
  test(`an interrupted HTTP download records ${interruption === 'source failure' ? 'failed for a source error' : 'cancelled for a client abort'}`, async (t) => {
    const { Readable } = await import('node:stream');
    const { setTimeout: delay } = await import('node:timers/promises');
    const f = await appFixture();
    let sent = false;
    const stream = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push(Buffer.from('a'));
        }
      },
    });
    t.after(async () => {
      stream.destroy();
      await f.close();
    });
    const terminal = f.app.get(TerminalService);
    terminal.service.connectedOwned = () => ({
      connection: { name: 'Fixture' },
      files: () => ({ download: async () => ({ name: 'test.txt', size: 10, stream }) }),
    });
    const abort = new AbortController();
    const response = await fetch(
      f.base + '/terminal/sessions/fixture/files/download?path=%2Ftest.txt',
      { headers: f.headers, signal: abort.signal },
    );
    const reader = response.body.getReader();
    assert.equal((await reader.read()).value.byteLength, 1);
    if (interruption === 'source failure') stream.destroy(Error('SFTP read failed'));
    else abort.abort();
    await assert.rejects(reader.read());
    let history;
    for (let attempt = 0; attempt < 100; attempt++) {
      history = await (await f.call('/transfers?sessionId=fixture')).json();
      if (!history.active) break;
      await delay(10);
    }
    assert.equal(history.active, 0);
    assert.equal(
      history.items[0].status,
      interruption === 'source failure' ? 'failed' : 'cancelled',
    );
    assert.equal(history.items[0].transferred, 1);
    assert.equal(stream.destroyed, true);
  });
}

test('transfer history bounds completed records, preserves running transfers and supports summaries', () => {
  const service = new TransferService();
  const input = {
    owner: 'a',
    sessionId: 's',
    connectionName: 'test',
    direction: 'upload',
    path: '/test',
    size: 1,
  };
  for (let i = 0; i < 150; i++) service.begin(input).finish('completed');
  const active = service.begin(input);
  assert.equal(service.list('a', 's').items.length, 101);
  assert.equal(service.list('a', 's').active, 1);
  assert.deepEqual(service.list('a', 's', true), { active: 1, items: [] });
  active.finish('failed');
  assert.equal(service.list('a', 's').items.length, 100);
});

test('HTTP cancel of an actual SFTP upload removes its temporary file and releases the queue', async (t) => {
  const { Readable } = await import('node:stream');
  const { readdir } = await import('node:fs/promises');
  const { setTimeout: delay } = await import('node:timers/promises');
  const root = await mkdtemp(path.join(os.tmpdir(), 'nas-transfer-cancel-'));
  const ssh = await sshFixture({ sftpRoot: root });
  const client = new ssh2.Client();
  await new Promise((resolve, reject) =>
    client.once('ready', resolve).once('error', reject).connect({
      host: '127.0.0.1',
      port: ssh.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  const files = new SessionFiles(client, { isConnected: () => true });
  const f = await appFixture();
  let sent = false;
  const body = new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.from('a'));
      }
    },
  });
  t.after(async () => {
    body.destroy();
    files.close();
    client.destroy();
    await f.close();
    await ssh.close();
    await rm(root, { recursive: true, force: true });
  });
  f.app.get(TerminalService).service.connectedOwned = (owner, id) => {
    if (owner !== '1000' || id !== 'fixture')
      throw Object.assign(Error('会话不存在'), { status: 404 });
    return { connection: { name: 'Fixture' }, files: () => files };
  };
  const uploading = fetch(
    f.base + '/terminal/sessions/fixture/files/upload?path=%2F&name=partial.txt&size=10',
    {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/octet-stream', 'content-length': '10' },
      body,
      duplex: 'half',
    },
  ).then(
    (response) => response.status,
    () => 0,
  );
  let history;
  for (let i = 0; i < 100; i++) {
    history = await (await f.call('/transfers?sessionId=fixture')).json();
    if (history.items[0]?.transferred === 1) break;
    await delay(10);
  }
  assert.equal(history.items[0].transferred, 1);
  assert.equal(
    (await f.call('/sessions/fixture/transfers/' + history.items[0].id + '/cancel', 'POST')).status,
    204,
  );
  assert.ok((await uploading) < 200 || (await uploading) >= 400);
  for (let i = 0; i < 100; i++) {
    history = await (await f.call('/transfers?sessionId=fixture')).json();
    if (!history.active) break;
    await delay(10);
  }
  assert.equal(history.items[0].status, 'cancelled');
  assert.equal(history.active, 0);
  assert.deepEqual(await readdir(root), [], 'cancelled upload must remove its temporary file');
});

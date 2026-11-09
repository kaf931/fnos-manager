import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WebSocket } from 'ws';
import { appFixture } from './fixtures/terminal-app.js';
test('ADB routes enforce owner/CSRF, pair privately, operate files/APK and authenticate live shell tickets', async () => {
  const previous = process.env.DESKICONS_ADB_PATH;
  process.env.DESKICONS_ADB_PATH = path.resolve('tests/fixtures/adb-cli.js');
  const f = await appFixture();
  const call = (p, method = 'GET', body, headers = {}) =>
    fetch(f.base + '/adb' + p, {
      method,
      headers: { ...f.headers, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const input = { name: 'phone', protocol: 'adb', host: 'phone.local', port: 5555 };
    assert.equal(
      (await call('/connections', 'POST', input, { 'x-trim-isadmin': 'false' })).status,
      403,
    );
    assert.equal(
      (await call('/connections', 'POST', input, { 'x-deskicons-token': 'invalid' })).status,
      403,
    );
    assert.equal((await call('/connections', 'POST', { ...input, host: '--help' })).status, 400);
    assert.equal((await call('/connections', 'POST', { ...input, port: '5555' })).status, 400);
    const saved = await call('/connections', 'POST', input);
    assert.equal(saved.status, 201);
    const { id } = await saved.json();
    assert.deepEqual(
      await (await call('/connections', 'GET', undefined, { 'x-trim-userid': '1001' })).json(),
      [],
    );
    assert.equal(
      (await call('/sessions', 'POST', { connectionId: id }, { 'x-trim-userid': '1001' })).status,
      404,
    );
    const paired = await call('/pair', 'POST', {
      host: 'phone.local',
      port: 12345,
      code: '123456',
    });
    assert.equal(paired.status, 201);
    const badPair = await call('/pair', 'POST', {
      host: 'phone.local',
      port: 12345,
      code: '654321',
    });
    assert.equal(badPair.status, 400);
    assert.doesNotMatch(await badPair.text(), /654321/);
    const created = await call('/sessions', 'POST', { connectionId: id });
    assert.equal(created.status, 201);
    const session = await created.json();
    assert.equal((await call('/connections/' + id, 'PUT', input)).status, 409);
    assert.equal(
      (
        await call('/sessions/' + session.id + '/info', 'GET', undefined, {
          'x-trim-userid': '1001',
        })
      ).status,
      404,
    );
    const info = await (await call('/sessions/' + session.id + '/info')).json();
    assert.equal(info.properties['ro.product.model'], 'Fixture Phone');
    const files = await (await call('/sessions/' + session.id + '/files?path=/sdcard')).json();
    assert.equal(files.items[1].type, 'directory');
    assert.equal(files.items[0].mtime, 1700000000000);
    const download = await call(
      '/sessions/' + session.id + '/files/download?path=/sdcard/file.txt',
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'hello');
    const collision = await call('/sessions/' + session.id + '/files', 'PUT', {
      path: '/sdcard/file.txt',
      target: '/sdcard/existing.txt',
    });
    assert.equal(collision.status, 409);
    const renamed = await call('/sessions/' + session.id + '/files', 'PUT', {
      path: '/sdcard/file.txt',
      target: '/sdcard/renamed.txt',
    });
    assert.equal(renamed.status, 200);
    const blockedUpload = await fetch(
      f.base + '/adb/sessions/' + session.id + '/files/upload?path=/sdcard/existing.txt',
      {
        method: 'POST',
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        body: 'hello',
      },
    );
    assert.equal(blockedUpload.status, 409);
    const symlinkUpload = await fetch(
      f.base + '/adb/sessions/' + session.id + '/files/upload?path=/sdcard/dangling-link',
      {
        method: 'POST',
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        body: 'hello',
      },
    );
    assert.equal(symlinkUpload.status, 409);
    const upload = await fetch(
      f.base + '/adb/sessions/' + session.id + '/files/upload?path=/sdcard/test.txt',
      {
        method: 'POST',
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        body: 'hello',
      },
    );
    assert.equal(upload.status, 201);
    const invalid = await fetch(f.base + '/adb/sessions/' + session.id + '/install', {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      body: 'invalid',
    });
    assert.equal(invalid.status, 400);
    const install = await fetch(f.base + '/adb/sessions/' + session.id + '/install', {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      body: 'fixture apk',
    });
    assert.equal(install.status, 201);
    const { ticket } = await (
      await call('/sessions/' + session.id + '/terminal', 'POST', {})
    ).json();
    const socketUrl = f.origin.replace('http:', 'ws:') + '/app/deskicons/adb/ws?ticket=' + ticket;
    async function rejectedSocket(headers) {
      const socket = new WebSocket(socketUrl, { headers });
      await new Promise((resolve, reject) => {
        socket.once('open', () => {
          socket.terminate();
          reject(Error('unauthorized websocket opened'));
        });
        socket.once('error', (error) => {
          assert.match(error.message, /403/);
          resolve();
        });
      });
    }
    await rejectedSocket({ ...f.headers, 'x-trim-userid': '1001' });
    await rejectedSocket({ ...f.headers, Origin: 'http://other-origin' });
    const ws = new WebSocket(
      f.origin.replace('http:', 'ws:') + '/app/deskicons/adb/ws?ticket=' + ticket,
      { headers: f.headers },
    );
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    // Spawn is asynchronous; buffer input in websocket transport before runtime child is ready.
    const output = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('terminal output timeout')), 2000);
      ws.once('message', (b) => {
        clearTimeout(timer);
        resolve(b.toString());
      });
    });
    ws.send(Buffer.from('hello terminal\n'));
    assert.equal(await output, 'hello terminal\n');
    const resized = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('resize timeout')), 2000);
      ws.once('message', (b) => {
        clearTimeout(timer);
        resolve(b.toString());
      });
    });
    ws.send(JSON.stringify({ type: 'resize', rows: 40, cols: 120 }));
    assert.equal(await resized, 'RESIZE:40x120,0x0');
    ws.close();
    await rejectedSocket(f.headers);
    assert.equal((await call('/sessions/' + session.id, 'DELETE')).status, 204);
    assert.equal((await call('/sessions/' + session.id + '/info')).status, 404);
    const logs = await (await call('/sessions/' + session.id + '/logs')).json();
    assert.ok(logs.items.some((x) => x.stage === 'disconnect'));
    assert.doesNotMatch(JSON.stringify(logs), /123456|654321/);
  } finally {
    await f.close();
    if (previous === undefined) delete process.env.DESKICONS_ADB_PATH;
    else process.env.DESKICONS_ADB_PATH = previous;
  }
});

import { archiveExec } from './fixtures/archive-exec.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import WebSocket from 'ws';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
test('SFTP routes enforce session ownership/CSRF and transfer actual bytes', async () => {
  const root = await mkdtemp(os.tmpdir() + '/sftp-http-'),
    f = await appFixture(),
    ssh = await sshFixture({ sftpRoot: root, execHandler: archiveExec(root) });
  let ws;
  try {
    await writeFile(root + '/中文.txt', 'hello');
    const c = await (
      await f.call('/connections', 'POST', {
        name: 'files',
        kind: 'remote',
        host: '127.0.0.1',
        port: ssh.port,
        username: 'tester',
        authMethod: 'password',
        credentials: { password: 'fixture-password' },
      })
    ).json();
    const session = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json(),
      url = '/sessions/' + session.id + '/files';
    assert.equal((await f.call(url)).status, 409);
    const e = events();
    ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws', {
      headers: f.headers,
    });
    ws.on('message', (d) => e.emit(JSON.parse(d)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'authenticate', id: session.id, ticket: session.ticket }));
    const key = await e.wait((x) => x.type === 'host-key');
    ws.send(JSON.stringify({ type: 'trust-host', fingerprint: key.fingerprint }));
    await e.wait((x) => x.type === 'state' && x.state === 'connected');
    assert.equal((await f.call(url, 'GET', null, { 'x-trim-userid': '1001' })).status, 404);
    assert.equal((await f.call(url, 'GET', null, { 'x-trim-isadmin': 'false' })).status, 403);
    assert.equal(
      (
        await f.call(
          url + '/mkdir',
          'POST',
          { path: '/', name: 'new' },
          { 'x-deskicons-token': 'bad' },
        )
      ).status,
      403,
    );
    assert.equal((await f.call(url + '/mkdir', 'POST', { path: '/', name: 'new' })).status, 204);
    const list = await (await f.call(url)).json();
    assert.equal(list.path, '/');
    assert.ok(list.entries.some((x) => x.name === '中文.txt'));
    const permissionUrl = '/sessions/' + session.id + '/files/permissions';
    assert.equal(
      (
        await f.call(
          permissionUrl + '?path=%2F&name=' + encodeURIComponent('中文.txt'),
          'GET',
          null,
          { 'x-trim-userid': '1001' },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.call(
          permissionUrl,
          'POST',
          { path: '/', name: '中文.txt', mode: 0o640 },
          { 'x-deskicons-token': 'bad' },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call(permissionUrl, 'POST', { path: '/', name: '中文.txt', mode: 0o640 })).status,
      204,
    );
    assert.equal(
      (
        await (
          await f.call(permissionUrl + '?path=%2F&name=' + encodeURIComponent('中文.txt'))
        ).json()
      ).mode,
      0o640,
    );
    const compression = url + '/compress';
    assert.equal(
      (
        await f.call(
          compression,
          'POST',
          { path: '/', name: '中文.txt', outputName: 'packed.zip', format: 'zip' },
          { 'x-deskicons-token': 'bad' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(compression, 'POST', {
          path: '/',
          name: '中文.txt',
          outputName: 'packed.zip',
          format: 'zip',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call(url + '/extract', 'POST', {
          path: '/',
          name: 'packed.zip',
          outputName: 'unpacked',
        })
      ).status,
      200,
    );
    assert.equal(
      (await await f.call(url + '/download?path=' + encodeURIComponent('/unpacked/中文.txt')))
        .status,
      200,
    );
    const upload = await fetch(
      f.base + '/terminal' + url + '/upload?path=%2Fnew&name=data&size=3',
      {
        method: 'POST',
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        body: Buffer.from('abc'),
      },
    );
    assert.equal(upload.status, 201);
    assert.equal(
      (
        await f.call(
          url + '/size',
          'POST',
          { path: '/', name: 'new' },
          { 'x-deskicons-token': 'bad' },
        )
      ).status,
      403,
    );
    const size = await (await f.call(url + '/size', 'POST', { path: '/', name: 'new' })).json();
    assert.equal(size.bytes, 3);
    assert.equal(size.files, 1);
    const download = await f.call(url + '/download?path=%2Fnew%2Fdata');
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'abc');
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(
      (await f.call(url + '/rename', 'POST', { path: '/new', name: 'data', newName: 'renamed' }))
        .status,
      204,
    );
    assert.equal(
      (await f.call(url + '/delete', 'POST', { path: '/new', name: 'renamed' })).status,
      204,
    );
    assert.equal((await f.call(url + '/delete', 'POST', { path: '/', name: 'new' })).status, 204);
    await f.call('/sessions/' + session.id, 'DELETE');
    assert.equal((await f.call(url)).status, 404);
  } finally {
    ws?.terminate();
    await f.close();
    await ssh.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { TerminalService as NestTerminalService } from '../server/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
test('workspace HTTP enforces owner/CSRF and validates asset folder references', async () => {
  const f = await appFixture();
  try {
    const body = { kind: 'folder', scope: 'assets', name: 'NAS' };
    assert.equal(
      (await f.call('/workspace', 'POST', body, { 'x-deskicons-token': 'bad' })).status,
      403,
    );
    const r = await f.call('/workspace', 'POST', body);
    assert.equal(r.status, 201);
    const a = await r.json();
    assert.equal(
      (
        await (
          await f.call('/workspace?scope=assets', 'GET', null, { 'x-trim-userid': '1001' })
        ).json()
      ).length,
      0,
    );
    assert.equal(
      (await f.call('/workspace/' + a.id, 'DELETE', null, { 'x-trim-userid': '1001' })).status,
      404,
    );
    const c = await f.call('/connections', 'POST', {
      name: 'c',
      kind: 'local',
      username: 'tester',
      folderId: a.id,
    });
    assert.equal(c.status, 201);
    assert.equal((await f.call('/workspace/' + a.id, 'DELETE')).status, 409);
  } finally {
    await f.close();
  }
});
test('folder-only move preserves credentials and active sessions, enforces owner and valid parent', async () => {
  const f = await appFixture();
  try {
    const folder = await (
        await f.call('/workspace', 'POST', { kind: 'folder', scope: 'assets', name: 'A' })
      ).json(),
      c = await (
        await f.call('/connections', 'POST', {
          name: 'c',
          kind: 'local',
          username: 'tester',
          authMethod: 'password',
          credentials: { password: 'fixture-password' },
        })
      ).json(),
      service = f.app.get(NestTerminalService).service,
      before = service.store.connections.find((x) => x.id === c.id).credentials;
    const session = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json();
    const r = await f.call('/connections/' + c.id + '/folder', 'PUT', {
      folderId: folder.id,
      host: 'evil',
      username: 'evil',
      credentials: { password: 'evil' },
    });
    assert.equal(r.status, 400);
    const validMove = await f.call('/connections/' + c.id + '/folder', 'PUT', {
      folderId: folder.id,
    });
    assert.equal(validMove.status, 200);
    const moved = await validMove.json();
    assert.equal(moved.folderId, folder.id);
    assert.equal(moved.host, '127.0.0.1');
    assert.equal(moved.username, 'tester');
    assert.deepEqual(service.store.connections.find((x) => x.id === c.id).credentials, before);
    assert.ok(service.sessions.has(session.id));
    assert.equal(
      (
        await f.call(
          '/connections/' + c.id + '/folder',
          'PUT',
          { folderId: null },
          { 'x-trim-userid': '1001' },
        )
      ).status,
      404,
    );
    assert.equal(
      (await f.call('/connections/' + c.id + '/folder', 'PUT', { folderId: 'missing' })).status,
      400,
    );
    assert.equal(
      (await f.call('/connections/' + c.id + '/folder', 'PUT', {}, { 'x-deskicons-token': 'bad' }))
        .status,
      403,
    );
    assert.equal((await f.call('/workspace/' + folder.id, 'DELETE')).status, 409);
    assert.equal(
      (await f.call('/connections/' + c.id + '/folder', 'PUT', { folderId: null })).status,
      200,
    );
  } finally {
    await f.close();
  }
});
test('workspace parent-only update retains current name, type and command bytes', async () => {
  const f = await appFixture();
  try {
    const folder = await (
        await f.call('/workspace', 'POST', { kind: 'folder', scope: 'commands', name: 'A' })
      ).json(),
      c = await (
        await f.call('/workspace', 'POST', {
          kind: 'command',
          scope: 'commands',
          name: 'q',
          content: 'pwd\r\nwhoami',
        })
      ).json();
    const r = await f.call('/workspace/' + c.id, 'PUT', { parentId: folder.id });
    assert.equal(r.status, 200);
    const moved = await r.json();
    assert.equal(moved.name, 'q');
    assert.equal(moved.content, 'pwd\r\nwhoami');
    assert.equal(moved.parentId, folder.id);
    const renamed = await (await f.call('/workspace/' + c.id, 'PUT', { name: 'renamed' })).json();
    assert.equal(renamed.parentId, folder.id);
    assert.equal(renamed.content, 'pwd\r\nwhoami');
    assert.equal((await f.call('/workspace/' + folder.id, 'PUT', { parentId: c.id })).status, 400);
  } finally {
    await f.close();
  }
});

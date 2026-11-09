import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appFixture } from './fixtures/terminal-app.js';
const pkg = () => ({
  format: 'fnos-manager-config',
  version: 1,
  exportedAt: new Date().toISOString(),
  appVersion: 'test',
  includeCredentials: false,
  items: [
    {
      kind: 'tasks',
      id: 'a'.repeat(16),
      data: {
        name: 'restored script',
        type: 'script',
        script: 'true',
        schedule: { kind: 'daily', time: '10:00' },
        timeoutSeconds: 300,
      },
    },
  ],
});
test('backup HTTP enforces admin, CSRF, DTO and account; imported task cannot run until edited', async () => {
  const f = await appFixture();
  try {
    const send = (route, body, headers = f.headers, method = 'POST') =>
      fetch(f.base + route, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await send(
          '/backup/export',
          { modules: ['ssh'], includeCredentials: false },
          { ...f.headers, 'x-trim-isadmin': 'false' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await send(
          '/backup/export',
          { modules: ['ssh'], includeCredentials: false },
          { ...f.headers, 'x-deskicons-token': 'wrong' },
        )
      ).status,
      403,
    );
    assert.equal(
      (await send('/backup/export', { modules: ['ssh'], includeCredentials: 'false' })).status,
      400,
    );
    assert.equal(
      (
        await send('/backup/export', {
          modules: ['ssh'],
          includeCredentials: false,
          ownerUid: '1001',
        })
      ).status,
      400,
    );
    const exported = await send('/backup/export', { modules: ['ssh'], includeCredentials: false });
    assert.equal(exported.status, 200);
    assert.equal((await exported.json()).format, 'fnos-manager-config');
    const preview = await send('/backup/preview', { backup: pkg() });
    assert.equal(preview.status, 200);
    const p = await preview.json();
    const restore = { token: p.token, requestId: randomUUID(), decisions: [] };
    assert.equal(
      (await send('/backup/restore', restore, { ...f.headers, 'x-trim-userid': '1001' })).status,
      409,
    );
    const restored = await send('/backup/restore', restore);
    assert.equal(restored.status, 200);
    const result = await restored.json();
    assert.equal(result.imported, 1);
    assert.deepEqual(await (await send('/backup/restore', restore)).json(), result);
    const tasks = await (await fetch(f.base + '/tasks', { headers: f.headers })).json();
    const task = tasks.find((t) => t.name === 'restored script');
    assert.ok(task.pendingReason);
    assert.equal((await send(`/tasks/${task.id}/run`, { confirmed: true })).status, 409);
    assert.equal(
      (await send(`/tasks/${task.id}`, { ...task, enabled: true }, f.headers, 'PUT')).status,
      409,
    );
    const edited = await send(
      `/tasks/${task.id}`,
      { ...task, enabled: false, reviewedAfterRestore: true },
      f.headers,
      'PUT',
    );
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).pendingReason, undefined);
  } finally {
    await f.close();
  }
});
test('backup invalid credentials return a client error without leaking the supplied secret', async () => {
  const f = await appFixture();
  try {
    const backup = {
      ...pkg(),
      includeCredentials: true,
      items: [
        {
          kind: 'connections',
          id: 'a'.repeat(24),
          data: {
            name: 'ssh',
            kind: 'remote',
            host: '192.168.1.2',
            port: 22,
            username: 'root',
            authMethod: 'password',
            credentials: { method: 'password', password: '' },
          },
        },
      ],
    };
    const response = await fetch(f.base + '/backup/preview', {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ backup }),
    });
    assert.equal(response.status, 400);
  } finally {
    await f.close();
  }
});

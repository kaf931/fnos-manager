import { TasksService as NestTasksService } from '../server/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
const mod = await import('../server/index.js').catch(() => ({}));
test('CRUD persists, rejects malformed input and serves no secrets', async () => {
  assert.equal(typeof mod.createApplication, 'function');
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-api-');
  const app = await mod.createApplication({ dataDir: dir });
  const server = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`;
  const call = (p, method = 'GET', data) =>
    fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  try {
    assert.equal(
      (await call('/entries', 'POST', { name: 'bad', url: 'javascript:1' })).status,
      400,
    );
    const response = await call('/entries', 'POST', {
      name: 'Jellyfin',
      url: 'http://nas:8096',
      mode: 'iframe',
    });
    assert.equal(response.status, 201);
    const entry = await response.json();
    assert.equal((await (await call('/entries')).json()).length, 1);
    assert.equal(
      (await call('/entries/' + entry.id, 'PUT', { name: '影视', url: 'http://nas:8096' })).status,
      200,
    );
    assert.equal((await call('/entries/' + entry.id, 'DELETE')).status, 204);
    assert.deepEqual(await (await call('/entries')).json(), []);
    assert.equal((await fetch(base + '/../../server/index.js')).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test('native gateway denies a non-admin', async () => {
  assert.equal(typeof mod.createApplication, 'function');
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-auth-');
  const app = await mod.createApplication({ dataDir: dir, gateway: true });
  const server = await app.listen(0, '127.0.0.1');
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/app/deskicons/api/entries`);
    assert.equal(r.status, 403);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test('gateway permits authenticated mutations with anti-CSRF token despite rewritten Host', async () => {
  assert.equal(typeof mod.createApplication, 'function');
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-csrf-');
  const app = await mod.createApplication({ dataDir: dir, gateway: true });
  const server = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${server.address().port}/app/deskicons/api`;
  try {
    const headers = {
      'x-trim-isadmin': 'true',
      'content-type': 'application/json',
      Origin: 'http://nas:5666',
    };
    const state = await (await fetch(url + '/state', { headers })).json();
    assert.equal(typeof state.csrfToken, 'string');
    assert.equal(
      (
        await fetch(url + '/entries', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: '测试', url: 'http://nas:80' }),
        })
      ).status,
      403,
    );
    headers['x-deskicons-token'] = state.csrfToken;
    assert.equal(
      (
        await fetch(url + '/entries', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: '测试', url: 'http://nas:80' }),
        })
      ).status,
      201,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test('stored entries survive application recreation', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-persist-');
  let server;
  try {
    const app = await mod.createApplication({ dataDir: dir });
    server = await app.listen(0, '127.0.0.1');
    let base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`;
    const created = await (
      await fetch(base + '/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '重启保留', url: 'http://nas:8080/' }),
      })
    ).json();
    await new Promise((r) => server.close(r));
    const second = await mod.createApplication({ dataDir: dir });
    server = await second.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`;
    const entries = await (await fetch(base + '/entries')).json();
    assert.equal(entries[0].id, created.id);
    assert.equal(entries[0].name, '重启保留');
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test('task API creates paused scripts, executes with history and rejects unavailable built-ins', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-task-api-');
  let server;
  try {
    const app = await mod.createApplication({ dataDir: dir });
    server = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`;
    const call = (p, method = 'GET', body) =>
      fetch(base + p, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    const body = {
      name: '测试脚本',
      type: 'script',
      script: 'printf api-task-ok',
      schedule: { kind: 'daily', time: '03:00' },
    };
    const response = await call('/tasks', 'POST', body);
    assert.equal(response.status, 201);
    const task = await response.json();
    assert.equal(task.enabled, false);
    assert.equal((await call('/tasks', 'POST', { ...body, type: 'snapshot' })).status, 400);
    assert.equal((await call('/tasks/' + task.id + '/run', 'POST', {})).status, 202);
    await app.get(NestTasksService).engine.idle();
    const runs = await (await call('/tasks/' + task.id + '/runs')).json();
    assert.equal(runs[0].status, 'success');
    assert.equal(runs[0].stdout, 'api-task-ok');
    assert.equal((await call('/tasks/' + task.id, 'DELETE')).status, 204);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

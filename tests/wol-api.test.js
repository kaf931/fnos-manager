import {
  TerminalService as NestTerminalService,
  StorageService as NestStorageService,
  WakeService as NestWakeService,
  TasksService as NestTasksService,
} from '../server/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index.js';
test('wake API requires admin, owner and CSRF and persists sent timestamp without leaking devices', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wake-api-'));
  const app = await createApplication({ dataDir: dir, gateway: true }),
    server = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`,
    headers = {
      'x-trim-isadmin': 'true',
      'x-trim-userid': '1000',
      'content-type': 'application/json',
    };
  try {
    assert.equal((await fetch(base + '/wake/devices')).status, 403);
    const state = await (await fetch(base + '/state', { headers })).json();
    const body = JSON.stringify({
      name: 'Test',
      mac: '02:11:22:33:44:55',
      address: '192.168.1.255',
      port: 9,
    });
    assert.equal(
      (await fetch(base + '/wake/devices', { method: 'POST', headers, body })).status,
      403,
    );
    headers['x-deskicons-token'] = state.csrfToken;
    const response = await fetch(base + '/wake/devices', { method: 'POST', headers, body });
    assert.equal(response.status, 201);
    const row = await response.json();
    assert.equal(row.owner, undefined);
    const other = { ...headers, 'x-trim-userid': '1001' };
    assert.deepEqual(await (await fetch(base + '/wake/devices', { headers: other })).json(), []);
    assert.equal(
      (
        await fetch(base + '/wake/devices/' + row.id + '/wake', {
          method: 'POST',
          headers: other,
          body: '{}',
        })
      ).status,
      404,
    );
    let sent = 0;
    app.get(NestWakeService).service.send = async () => {
      sent++;
    };
    assert.equal(
      (
        await fetch(base + '/wake/devices/' + row.id + '/wake', {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      200,
    );
    assert.equal(sent, 1);
    assert.ok((await (await fetch(base + '/wake/devices', { headers })).json())[0].lastSentAt);
    const connection = await app.get(NestTerminalService).service.store.save('1000', {
      name: 'remote-test',
      kind: 'remote',
      host: '192.168.1.20',
      port: 22,
      username: 'root',
      authMethod: 'password',
      credentials: { password: 'test-only-password' },
    });
    assert.equal(
      (
        await fetch(base + '/wake/devices/' + row.id, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            ...JSON.parse(body),
            connectionId: connection.id,
            system: 'linux',
          }),
        })
      ).status,
      200,
    );
    let controls = 0;
    app.get(NestWakeService).service.power = {
      prepare: () => ({}),
      execute: async () => {
        controls++;
      },
      close() {},
    };
    app.get(NestWakeService).service.now = () => Date.now() + 3000;
    const powerBody = { ids: [row.id], action: 'reboot' };
    assert.equal(
      (
        await fetch(base + '/wake/control', {
          method: 'POST',
          headers,
          body: JSON.stringify(powerBody),
        })
      ).status,
      400,
    );
    assert.equal(controls, 0);
    assert.equal(
      (
        await fetch(base + '/wake/control', {
          method: 'POST',
          headers: other,
          body: JSON.stringify({ ...powerBody, confirmed: true }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + '/wake/control', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...powerBody, confirmed: true }),
        })
      ).status,
      200,
    );
    assert.equal(controls, 1);
    assert.equal(
      (await fetch(base + '/wake/devices/' + row.id, { method: 'DELETE', headers })).status,
      204,
    );
  } finally {
    await app.get(NestStorageService).service.close();
    await app.get(NestTerminalService).service.close();
    await app.get(NestTasksService).engine.close();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

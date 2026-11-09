import { seedPowerConnections } from './fixtures/power-connections.js';
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
import { WakeService } from '../server/wol.js';
import { validateTask } from '../server/tasks/model.js';
import { TaskEngine } from '../server/tasks/engine.js';
import { createRunner } from '../server/tasks/runner.js';
import { resolveTaskTargets, runDeviceTask } from '../server/tasks/network.js';
import { createApplication } from '../server/index.js';
const device = { name: '电脑', mac: '02:11:22:33:44:55', address: '192.168.1.255', port: 9 },
  schedule = { kind: 'interval', minutes: 1 };
test('device task model requires owner, bounded IDs and power acknowledgment', () => {
  const body = {
    name: '唤醒',
    type: 'device-wake',
    ownerUid: '1000',
    deviceIds: ['a'.repeat(24)],
    schedule,
  };
  assert.deepEqual(
    validateTask({ ...body, deviceIds: [...body.deviceIds, ...body.deviceIds] }).deviceIds,
    body.deviceIds,
  );
  assert.throws(() => validateTask({ ...body, ownerUid: undefined }));
  assert.throws(() => validateTask({ ...body, deviceIds: [] }));
  assert.throws(() => validateTask({ ...body, deviceIds: Array(51).fill('a'.repeat(24)) }));
  assert.throws(() => validateTask({ ...body, type: 'device-shutdown' }), /确认/);
});
test('scheduled batch uses latest device configuration, continues after missing or failed device, and persists each result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'device-schedule-'));
  let engine;
  try {
    const sent = [],
      wake = await new WakeService({
        dataDir: dir,
        send: async (row) => {
          sent.push(row);
          if (row.name === 'bad') throw Error('network failed');
        },
      }).init(),
      a = await wake.save('1000', device),
      b = await wake.save('1000', { ...device, name: 'bad' }),
      c = await wake.save('1000', { ...device, name: 'removed' });
    engine = await new TaskEngine(dir, { runner: createRunner({ wake }) }).init();
    const now = new Date(),
      task = await engine.create(
        {
          name: '批量唤醒',
          type: 'device-wake',
          ownerUid: '1000',
          deviceIds: [a.id, b.id, c.id],
          enabled: true,
          schedule,
        },
        now,
      );
    await wake.save('1000', { ...a, address: '192.168.2.255' }, a.id);
    await wake.remove('1000', c.id);
    await engine.tick(new Date(+now + 61000));
    await engine.idle();
    const run = engine.history(task.id)[0];
    assert.equal(run.status, 'failed');
    assert.deepEqual(
      run.deviceResults.map((r) => r.success),
      [true, false, false],
    );
    assert.equal(sent[0].address, '192.168.2.255');
    assert.equal(sent.length, 2);
    assert.match(run.stdout, /network failed/);
    const reopened = await new TaskEngine(dir, { runner: createRunner({ wake }) }).init();
    assert.equal(reopened.find(task.id).ownerUid, '1000');
    assert.equal(reopened.history(task.id)[0].deviceResults.length, 3);
    await reopened.close();
  } finally {
    await engine?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('power schedule refuses changed SSH target and continues with other confirmed targets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'device-power-'));
  try {
    const connections = {
        ['1'.repeat(24)]: {
          kind: 'remote',
          host: '192.168.1.20',
          port: 22,
          username: 'root',
          hasCredentials: true,
        },
        ['2'.repeat(24)]: {
          kind: 'remote',
          host: '192.168.1.21',
          port: 22,
          username: 'root',
          hasCredentials: true,
        },
      },
      store = { get: (_owner, id) => connections[id] },
      executed = [];
    seedPowerConnections(dir, connections, '1000');
    const wake = await new WakeService({
        dataDir: dir,
        terminalStore: store,
        power: {
          prepare: (_owner, row) => ({ connection: store.get('1000', row.connectionId) }),
          execute: async (_owner, row) => executed.push(row.id),
          close() {},
        },
      }).init(),
      a = await wake.save('1000', { ...device, connectionId: '1'.repeat(24) }),
      b = await wake.save('1000', { ...device, name: 'other', connectionId: '2'.repeat(24) }),
      targets = resolveTaskTargets(wake, '1000', [a.id, b.id], 'device-reboot').map(
        (row) => row.target,
      );
    connections['1'.repeat(24)].host = '192.168.1.22';
    const result = await runDeviceTask(
      {
        type: 'device-reboot',
        ownerUid: '1000',
        deviceIds: [a.id, b.id],
        deviceTargets: targets,
        timeoutSeconds: 5,
      },
      { wake },
    );
    assert.deepEqual(executed, [b.id]);
    assert.deepEqual(
      result.deviceResults.map((r) => r.success),
      [false, true],
    );
    assert.match(result.stderr, /目标已变化/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('scheduled timeout aborts current send and never starts later devices', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'device-abort-'));
  try {
    let calls = 0;
    const wake = await new WakeService({
        dataDir: dir,
        send: async (_row, { signal }) => {
          calls++;
          await new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
          );
        },
      }).init(),
      a = await wake.save('1000', device),
      b = await wake.save('1000', { ...device, name: 'other' }),
      result = await runDeviceTask(
        { type: 'device-wake', ownerUid: '1000', deviceIds: [a.id, b.id], timeoutSeconds: 0.01 },
        { wake },
      );
    assert.equal(result.timedOut, true);
    assert.equal(calls, 1);
    assert.equal(result.deviceResults.length, 2);
    assert.match(result.deviceResults[1].error, /未继续/);
    assert.equal(wake.active.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('device task API owns tasks, ignores forged owner, and hides task logs from other admins', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'device-task-api-'));
  const app = await createApplication({ dataDir: dir, gateway: true }),
    server = await app.listen(0, '127.0.0.1');
  try {
    const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`,
      headers = {
        'x-trim-isadmin': 'true',
        'x-trim-userid': '1000',
        'content-type': 'application/json',
      },
      state = await (await fetch(base + '/state', { headers })).json();
    headers['x-deskicons-token'] = state.csrfToken;
    const call = (route, method = 'GET', body, uid = '1000') =>
      fetch(base + route, {
        method,
        headers: { ...headers, 'x-trim-userid': uid },
        body: body ? JSON.stringify(body) : undefined,
      });
    const row = await app.get(NestWakeService).service.save('1000', device);
    app.get(NestWakeService).service.send = async () => {};
    const body = {
      name: '设备任务',
      type: 'device-wake',
      deviceIds: [row.id],
      ownerUid: '9999',
      schedule,
    };
    const response = await call('/tasks', 'POST', body);
    assert.equal(response.status, 201);
    const task = await response.json();
    assert.equal(task.ownerUid, '1000');
    assert.equal((await (await call('/tasks', 'GET', null, '1001')).json()).length, 0);
    assert.equal((await call('/tasks/' + task.id, 'PUT', body, '1001')).status, 404);
    assert.equal((await call('/tasks/' + task.id + '/runs', 'GET', null, '1001')).status, 404);
    assert.equal((await call('/tasks/' + task.id + '/run', 'POST', {})).status, 202);
    await app.get(NestTasksService).engine.idle();
    const history = await (await call('/tasks/' + task.id + '/runs')).json();
    assert.equal(history[0].status, 'success');
    assert.equal(history[0].deviceResults[0].id, row.id);
    assert.equal((await (await call('/task-runs', 'GET', null, '1001')).json()).length, 0);
    const c = await app.get(NestTerminalService).service.store.save('1000', {
      name: 'scheduled-ssh',
      kind: 'remote',
      host: '192.168.1.20',
      port: 22,
      username: 'root',
      authMethod: 'password',
      credentials: { password: 'test-only' },
    });
    await app
      .get(NestWakeService)
      .service.save('1000', { ...row, connectionId: c.id, system: 'linux' }, row.id);
    const options = await (await call('/task-device-options?type=device-shutdown')).json(),
      powerBody = { ...body, type: 'device-shutdown', deviceTargets: options.map((r) => r.target) };
    assert.equal((await call('/tasks', 'POST', powerBody)).status, 400);
    const pResponse = await call('/tasks', 'POST', { ...powerBody, acknowledged: true });
    assert.equal(pResponse.status, 201);
    const powerTask = await pResponse.json();
    await app.get(NestTerminalService).service.store.save(
      '1000',
      {
        name: 'scheduled-ssh',
        kind: 'remote',
        host: '192.168.1.21',
        port: 22,
        username: 'root',
        authMethod: 'password',
        credentials: { password: 'test-only' },
      },
      c.id,
    );
    assert.equal(
      (await call('/tasks/' + powerTask.id, 'PUT', { ...powerTask, enabled: true })).status,
      400,
    );
    let executed = 0;
    app.get(NestWakeService).service.power.execute = async () => {
      executed++;
    };
    assert.equal(
      (await call('/tasks/' + powerTask.id + '/run', 'POST', { confirmed: true })).status,
      202,
    );
    await app.get(NestTasksService).engine.idle();
    assert.equal(executed, 0);
    assert.match(app.get(NestTasksService).engine.history(powerTask.id)[0].stderr, /目标已变化/);
    await app.get(NestWakeService).service.remove('1000', row.id);
    assert.equal((await call('/tasks/' + task.id, 'PUT', { ...task, enabled: false })).status, 200);
  } finally {
    await app.get(NestTasksService).engine.close();
    await app.get(NestWakeService).service.close();
    await app.get(NestStorageService).service.close();
    await app.get(NestTerminalService).service.close();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

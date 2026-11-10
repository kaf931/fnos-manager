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
import { createApplication } from '../server/index.js';
test('Nest owns the Express application, module providers and API controller routes', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/nest-framework-');
  let app;
  try {
    app = await createApplication({ dataDir: dir, gateway: true });
    assert.equal(app.getHttpAdapter().getType(), 'express');
    assert.ok(app.getHttpServer());
    assert.ok(app.get(NestTasksService).engine);
    assert.ok(app.get(NestStorageService).service);
    assert.ok(app.get(NestTerminalService).service);
    assert.ok(app.get(NestWakeService).service);
    await app.close();
    assert.equal(app.get(NestStorageService).service.closed, true);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('all API endpoints are explicit Nest controller handlers', async () => {
  const { PATH_METADATA } = await import('@nestjs/common/constants.js');
  const controllers = await Promise.all(
    ['icons', 'terminal', 'storage', 'wake', 'tasks', 'backup', 'notifications', 'operations'].map(
      (name) => import(`../server/app/${name}/${name}.controller.js`),
    ),
  );
  controllers.push(await import('../server/app/terminal/ai.controller.js'));
  controllers.push(await import('../server/app/terminal/ai-skills.controller.js'));
  controllers.push(await import('../server/app/common/preferences.controller.js'));
  let routes = 0;
  for (const module of controllers) {
    const Controller = Object.values(module)[0];
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, Controller),
      Controller.name === 'PreferencesController'
        ? 'app/deskicons/api/preferences'
        : Controller.name === 'BackupController'
          ? 'app/deskicons/api/backup'
          : Controller.name === 'NotificationsController'
            ? 'app/deskicons/api/notifications'
            : Controller.name === 'OperationsController'
              ? 'app/deskicons/api/operations'
              : 'app/deskicons/api',
    );
    routes += Object.getOwnPropertyNames(Controller.prototype).filter(
      (key) =>
        key !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, Controller.prototype[key]),
    ).length;
  }
  assert.equal(routes, 154);
});
test('framework errors preserve JSON, auth precedes parsing, and non-API assets stay protected', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/nest-security-'),
    app = await createApplication({ dataDir: dir, gateway: true }),
    server = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`,
    headers = { 'x-trim-isadmin': 'true', 'x-trim-userid': '1000' };
  try {
    const unauthorized = await fetch(base + '/app/deskicons/', {
      headers: { 'x-trim-isadmin': 'false' },
    });
    assert.equal(unauthorized.status, 403);
    assert.equal((await unauthorized.json()).error, '仅管理员可以使用 NAS 管家');
    const csrf = await fetch(base + '/app/deskicons/api/tasks', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{bad',
    });
    assert.equal(csrf.status, 403);
    const missing = await fetch(base + '/app/deskicons/api/not-found', { headers });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-powered-by'), null);
    assert.ok((await missing.json()).error);
    const state = await (await fetch(base + '/app/deskicons/api/state', { headers })).json();
    const invalid = await fetch(base + '/app/deskicons/api/tasks', {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-deskicons-token': state.csrfToken,
      },
      body: '{bad',
    });
    assert.equal(invalid.status, 400);
    assert.ok((await invalid.json()).error);
  } finally {
    await app.close();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test('Nest lifecycle starts a single scheduler and disposes it on close', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/nest-scheduler-');
  let app;
  try {
    app = await createApplication({ dataDir: dir, startScheduler: true });
    const timer = app.get(NestTasksService).engine.timer;
    assert.ok(timer);
    await app.init();
    assert.equal(app.get(NestTasksService).engine.timer, timer);
    await app.close();
    assert.equal(timer._destroyed, true);
    assert.equal(app.get(NestStorageService).service.closed, true);
    const { Resources } = await import('../server/app/common/resources.js');
    assert.equal(app.get(Resources).shuttingDown, true);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('providers share explicit audit dependencies and close the database once after workers drain', async () => {
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { OperationService } = await import('../server/operations/service.js');
  const dir = await mkdtemp(os.tmpdir() + '/nest-dependencies-');
  let app;
  try {
    app = await createApplication({ dataDir: dir });
    const database = app.get(DatabaseService);
    const operations = app.get(OperationService);
    const storage = app.get(NestStorageService);
    assert.equal(storage.rename.audit, operations);
    assert.equal(app.get(NestWakeService).service.audit, operations);
    const order = [];
    const closeStorage = storage.close.bind(storage);
    storage.close = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      // A pending worker still needs its shared database during shutdown.
      assert.equal(operations.list('1000').total, 0);
      order.push('storage');
      await closeStorage();
    };
    const closeDatabase = database.close.bind(database);
    database.close = () => {
      order.push('database');
      closeDatabase();
    };
    await app.close();
    await app.close();
    assert.deepEqual(order, ['storage', 'database']);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('operation and delivery query DTOs reject malformed shapes and preserve pagination defaults', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/nest-page-dto-');
  const app = await createApplication({ dataDir: dir, gateway: true });
  const server = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`;
  const headers = { 'x-trim-isadmin': 'true', 'x-trim-userid': '1000' };
  try {
    for (const route of ['/operations', '/notifications/deliveries']) {
      const page = await (await fetch(base + route, { headers })).json();
      assert.equal(page.page, 1);
      assert.equal(page.pageSize, 10);
      const custom = await (await fetch(base + route + '?page=2&pageSize=100', { headers })).json();
      assert.equal(custom.page, 2);
      assert.equal(custom.pageSize, 100);
      for (const query of [
        'page=0',
        'page=1.5',
        'page=NaN',
        'page=1&page=2',
        'pageSize=101',
        'pageSize=',
        'pageSize=Infinity',
        'page=9007199254740992',
        'page=9007199254740991&pageSize=100',
        'unknown=value',
      ]) {
        const response = await fetch(base + route + '?' + query, { headers });
        assert.equal(response.status, 400, route + '?' + query);
        assert.equal(typeof (await response.json()).error, 'string');
      }
    }
    for (const query of [
      'action=unknown',
      'status=unknown',
      'action=ai.command&action=ssh.delete',
    ]) {
      assert.equal((await fetch(base + '/operations?' + query, { headers })).status, 400);
    }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('bootstrap failure closes registered transports and database without starting schedulers', async () => {
  const { WorkspaceStore } = await import('../server/terminal/workspace-store.js');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { TerminalService } = await import('../server/terminal/transport.js');
  const { TaskEngine } = await import('../server/tasks/engine.js');
  const dir = await mkdtemp(os.tmpdir() + '/nest-bootstrap-failure-');
  const originalInit = WorkspaceStore.prototype.init;
  const originalDatabaseClose = DatabaseService.prototype.close;
  const originalTransportClose = TerminalService.prototype.close;
  const originalStart = TaskEngine.prototype.start;
  const failure = new Error('workspace initialization failed');
  const calls = [];
  WorkspaceStore.prototype.init = async function () {
    throw failure;
  };
  DatabaseService.prototype.close = function () {
    calls.push('database');
    return originalDatabaseClose.call(this);
  };
  TerminalService.prototype.close = function () {
    calls.push('transport');
    return originalTransportClose.call(this);
  };
  TaskEngine.prototype.start = function () {
    calls.push('scheduler');
    return originalStart.call(this);
  };
  try {
    await assert.rejects(createApplication({ dataDir: dir, startScheduler: true }), failure);
    assert.deepEqual(calls, ['transport', 'database']);
  } finally {
    WorkspaceStore.prototype.init = originalInit;
    DatabaseService.prototype.close = originalDatabaseClose;
    TerminalService.prototype.close = originalTransportClose;
    TaskEngine.prototype.start = originalStart;
    await rm(dir, { recursive: true, force: true });
  }
});

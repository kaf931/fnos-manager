import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { UpdatePolicyRepository } from '../server/persistence/update-policy.repository.js';
import { Resources } from '../server/app/common/resources.js';
import { UpdatesService } from '../server/app/common/updates.service.js';
import { waitForIdle, AutomaticUpdateCancelled } from '../server/updates/idle.js';
test('update mode defaults to manual, persists globally and throttles automatic retries', async (t) => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'update-mode-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  let db = new DatabaseService(d);
  let policy = new UpdatePolicyRepository(db);
  assert.equal(policy.get().mode, 'manual');
  policy.save('auto');
  policy.attempted('0.3.5');
  assert.equal(policy.canAttempt('0.3.5'), false);
  assert.equal(policy.canAttempt('0.3.6'), true);
  db.close();
  db = new DatabaseService(d);
  t.after(() => db.close());
  policy = new UpdatePolicyRepository(db);
  assert.equal(policy.get().mode, 'auto');
  policy.save('manual');
  assert.equal(policy.get().mode, 'manual');
  assert.throws(() => db.connection.exec("UPDATE update_settings SET mode='invalid'"));
});
test('automatic updates wait for busy work and stop if the mode is changed to manual', async () => {
  const phases = [],
    spec = { dataDir: os.tmpdir() };
  let count = 0;
  await waitForIdle(
    spec,
    async (p) => phases.push(p),
    async () => ({ mode: 'auto', idle: ++count > 1 }),
    async () => {},
  );
  assert.deepEqual(phases, ['waiting', 'installing']);
  await assert.rejects(
    waitForIdle(
      spec,
      async () => {},
      async () => ({ mode: 'manual', idle: true }),
      async () => {},
    ),
    AutomaticUpdateCancelled,
  );
});
test('automatic scheduler only launches when idle and explicit automatic mode is enabled', async () => {
  const resources = new Resources();
  let attempts = 0,
    mode = 'manual',
    started = 0;
  const policy = {
    get: () => ({ mode, downloadRoute: 'mirror' }),
    canAttempt: () => true,
    attempted: () => attempts++,
  };
  const service = new UpdatesService(
    { root: '/', dataDir: '/', version: '0.3.4', gateway: false },
    policy,
    resources,
  );
  service.cached = {
    info: { latest: '0.3.5', hasUpdate: true, asset: { sha256: 'a'.repeat(64) } },
  };
  service.manager = {
    status: async () => null,
    start: async (_, __, automatic, route) => {
      assert.equal(route, 'mirror');
      assert.equal(automatic, true);
      started++;
    },
  };
  await service.tryAutomatic();
  assert.equal(started, 0);
  mode = 'auto';
  resources.add('terminalService', { sessions: new Map([['live', {}]]) });
  await service.tryAutomatic();
  assert.equal(started, 0);
  resources.add('terminalService', { sessions: new Map() });
  await service.tryAutomatic();
  assert.equal(started, 1);
  assert.equal(attempts, 1);
});

test('download preference migrates from schema27 and persists without resetting update mode', async (t) => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'update-route-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  let db = new DatabaseService(d);
  let policy = new UpdatePolicyRepository(db);
  policy.save('auto');
  // Before this feature, the setting is absent; build an actual old table fixture.
  if (
    db.connection
      .prepare('PRAGMA table_info(update_settings)')
      .all()
      .some((x) => x.name === 'download_route')
  )
    db.connection.exec('ALTER TABLE update_settings DROP COLUMN download_route');
  db.connection.exec(
    legacyNotificationReset + 'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE adb_connections; DELETE FROM schema_migrations WHERE version=29; DELETE FROM schema_migrations WHERE version=28; PRAGMA user_version=27',
  );
  db.close();
  db = new DatabaseService(d);
  policy = new UpdatePolicyRepository(db);
  assert.deepEqual(policy.get(), { mode: 'auto', downloadRoute: 'direct' });
  policy.save(undefined, 'mirror');
  db.close();
  db = new DatabaseService(d);
  t.after(() => db.close());
  policy = new UpdatePolicyRepository(db);
  assert.deepEqual(policy.get(), { mode: 'auto', downloadRoute: 'mirror' });
  policy.save('manual');
  assert.equal(policy.get().downloadRoute, 'mirror');
  assert.throws(() => db.connection.exec("UPDATE update_settings SET download_route='evil'"));
});

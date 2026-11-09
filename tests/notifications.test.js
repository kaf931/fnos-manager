import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
const settings = {
  enabled: true,
  url: 'http://127.0.0.1/hook',
  token: 'secret',
  condition: 'all',
  scanFailures: true,
};
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notify-'));
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, repo: new NotificationRepository(db) };
}
test('notifications default disabled, account isolated, revision cancels pending', (t) => {
  const { repo } = fixture(t);
  assert.equal(repo.getSettings('a').enabled, false);
  assert.throws(() => repo.deliveries('a', Number.MAX_SAFE_INTEGER, 100));
  repo.saveSettings('a', settings);
  const item = repo.enqueueTest('a');
  assert.equal(item.status, 'pending');
  assert.equal(repo.deliveries('b', 1, 10).total, 0);
  repo.saveSettings('a', { ...settings, token: 'new' });
  assert.equal(repo.deliveries('a', 1, 10).items[0].status, 'cancelled');
});
test('URL validation and safe task payload', (t) => {
  const { repo, db } = fixture(t);
  for (const url of ['file:///etc/passwd', 'http://user:pass@host', 'http://host/#a'])
    assert.throws(() => repo.saveSettings('a', { ...settings, url }));
  repo.saveSettings('a', settings);
  repo.taskResult(
    { id: 'task', name: 'task', type: 'script', ownerUid: 'a' },
    {
      id: 'run',
      status: 'failed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: 'password',
      stderr: 'secret',
      script: '/private/path',
    },
  );
  const row = db.connection.prepare('SELECT payload FROM notification_deliveries').get();
  assert.ok(row);
  assert.doesNotMatch(row.payload, /password|secret|private/);
  assert.equal(repo.claim().attempts, 1);
  assert.equal(repo.claim(), undefined);
});

test('retry delays, bounded attempts, restart recovery and in-flight revision', (t) => {
  const { repo, db } = fixture(t);
  repo.saveSettings('a', settings);
  repo.enqueueTest('a');
  let job = repo.claim();
  repo.finish(job, 503, true, 100);
  let row = repo.deliveries('a').items[0];
  assert.equal(row.nextAttemptAt, new Date(30100).toISOString());
  assert.equal(repo.claim(30099), undefined);
  job = repo.claim(30100);
  repo.finish(job, 429, true, 30100);
  assert.equal(repo.claim(150099), undefined);
  job = repo.claim(150100);
  repo.finish(job, null, true, 150100);
  assert.equal(repo.deliveries('a').items[0].status, 'failed');
  assert.equal(repo.claim(Infinity), undefined);
  repo.enqueueTest('a');
  job = repo.claim();
  repo.saveSettings('a', { ...settings, url: 'http://localhost/new' });
  repo.finish(job, 503, true);
  assert.equal(
    db.connection.prepare('SELECT status FROM notification_deliveries WHERE id=?').get(job.id)
      .status,
    'cancelled',
  );
  repo.enqueueTest('a');
  repo.claim();
  repo.recover();
  assert.equal(repo.claim().attempts, 2);
});
test('task completion and scan failure enqueue atomically and once', async (t) => {
  const { repo, db } = fixture(t);
  const { TaskRepository } = await import('../server/persistence/task.repository.js');
  const { ScanRepository } = await import('../server/persistence/scan.repository.js');
  const tasks = new TaskRepository(db);
  repo.saveSettings('a', settings);
  const task = {
    id: 'task',
    name: 'name',
    ownerUid: 'a',
    type: 'script',
    enabled: false,
    schedule: { kind: 'interval', minutes: 60 },
    timeoutSeconds: 30,
    nextRunAt: null,
  };
  tasks.save(task);
  const run = {
    id: 'run',
    taskId: 'task',
    taskName: 'name',
    status: 'running',
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    stdout: '',
    stderr: '',
  };
  tasks.saveRun(run);
  assert.throws(() =>
    db.transaction(() => {
      tasks.saveRun({ ...run, status: 'failed' });
      throw Error('rollback');
    }),
  );
  assert.equal(repo.deliveries('a').total, 0);
  tasks.saveRun({ ...run, status: 'failed' });
  tasks.saveRun({ ...run, status: 'failed' });
  assert.equal(repo.deliveries('a').total, 1);
  const scans = new ScanRepository(db);
  await scans.save({
    id: 'scan',
    owner: 'a',
    mode: 'space',
    path: '/private/secret',
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  await scans.save({
    id: 'scan',
    owner: 'a',
    mode: 'space',
    path: '/private/secret',
    status: 'failed',
    error: 'sensitive error',
  });
  assert.equal(repo.deliveries('a').total, 2);
  assert.doesNotMatch(JSON.stringify(repo.deliveries('a')), /private|sensitive/);
});
test('worker does not overlap sends and aborts on close', async (t) => {
  const { repo } = fixture(t);
  const { NotificationService } = await import('../server/notifications/service.js');
  repo.saveSettings('a', settings);
  repo.enqueueTest('a');
  let started = 0;
  const worker = new NotificationService(
    repo,
    (_job, signal) =>
      new Promise((resolve, reject) => {
        started++;
        signal.addEventListener('abort', () => reject(Error('secret')));
      }),
  );
  const pending = worker.tick();
  worker.tick();
  assert.equal(started, 1);
  await worker.close();
  await pending;
  assert.equal(repo.deliveries('a').items[0].attempts, 1);
  assert.doesNotMatch(JSON.stringify(repo.deliveries('a')), /secret/);
});
test('bounded queue and terminal retention', (t) => {
  const { repo } = fixture(t);
  repo.saveSettings('a', settings);
  for (let i = 0; i < 705; i++) repo.enqueueTest('a');
  assert.equal(repo.deliveries('a').total, 700);
  repo.saveSettings('a', { ...settings, enabled: false });
  assert.equal(repo.deliveries('a').total, 200);
});

test('HTTP transport POSTs safe JSON with bearer and never follows redirect', async (t) => {
  const { createServer } = await import('node:http');
  const { sendNotification } = await import('../server/notifications/service.js');
  let received;
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received = { method: req.method, token: req.headers.authorization, body };
      res.writeHead(302, { Location: '/redirect' });
      res.end('sensitive response');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const status = await sendNotification(
    {
      url: `http://127.0.0.1:${server.address().port}/hook`,
      token: 'secret',
      payload: '{"eventId":"one"}',
    },
    new AbortController().signal,
  );
  assert.equal(status, 302);
  assert.equal(requests, 1);
  assert.deepEqual(received, { method: 'POST', token: 'Bearer secret', body: '{"eventId":"one"}' });
});

test('shared results target enabled admins; private results and scan opt-out remain isolated', (t) => {
  const { repo } = fixture(t);
  repo.saveSettings('a', { ...settings, condition: 'errors', scanFailures: false });
  repo.saveSettings('b', settings);
  const run = { id: 'success', status: 'success', startedAt: new Date().toISOString() };
  repo.taskResult({ id: 'shared', name: 'shared', type: 'script' }, run);
  assert.equal(repo.deliveries('a').total, 0);
  assert.equal(repo.deliveries('b').total, 1);
  repo.taskResult(
    { id: 'private', name: 'private', type: 'script', ownerUid: 'a' },
    { ...run, id: 'interrupted', status: 'interrupted' },
  );
  assert.equal(repo.deliveries('a').total, 1);
  assert.equal(repo.deliveries('b').total, 1);
  repo.scanResult({ id: 'scan', owner: 'a', mode: 'space', status: 'failed' });
  assert.equal(repo.deliveries('a').total, 1);
});

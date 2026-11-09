import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { MaintenanceRecordRepository } from '../server/persistence/maintenance-record.repository.js';
import { ServiceLog } from '../server/maintenance/service-log.js';
test('maintenance detail lists isolate owners and bound task outputs without exposing receipt secrets', (t) => {
  const dir = mkdtempSync(tmpdir() + '/maintenance-records-'),
    db = new DatabaseService(dir),
    c = db.connection,
    repo = new MaintenanceRecordRepository(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const owner of ['a', 'b']) {
    c.prepare(
      "INSERT INTO tasks(id,owner_uid,name,type,enabled,schedule,options,timeout) VALUES(?,?,?,'script',0,'{}','{}',1)",
    ).run(owner, owner, 'Task ' + owner);
    c.prepare(
      "INSERT INTO task_runs(id,task_id,task_name,trigger,status,started_at,stdout,stderr) VALUES(?,?,?,'manual','success',1,?,'failure')",
    ).run(owner, owner, 'Task ' + owner, 'hello' + owner + 'x'.repeat(100000));
    c.prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?,?,?)').run(
      owner,
      'receipt',
      'secret-request',
      'a'.repeat(64),
      'b'.repeat(64),
      JSON.stringify({ imported: 1, skipped: 2, mapped: 3, apiKey: 'secret' }),
      Date.now(),
    );
  }
  const page = repo.page('taskRuns', 'a', 1, 10);
  assert.equal(page.total, 1);
  assert.equal(page.items[0].name, 'Task a');
  assert.ok(!JSON.stringify(page).includes('hello'));
  const detail = repo.detail('taskRuns', 'a', 'a');
  assert.ok(detail.text.includes('helloa'));
  assert.ok(detail.text.includes('failure'));
  assert.ok(detail.truncated);
  assert.ok(Buffer.byteLength(detail.text) <= 65539);
  assert.throws(() => repo.detail('taskRuns', 'a', 'b'), /不存在/);
  const receipt = repo.detail('restoreReceipts', 'a', 'receipt');
  assert.ok(receipt.text.includes('导入 1'));
  assert.ok(!JSON.stringify(receipt).includes('secret'));
  assert.equal(receipt.record.status, 'protected');
  assert.equal(repo.page('restoreReceipts', 'missing', 1, 10).total, 0);
});
test('service log detail reads only a bounded tail and rejects arbitrary filenames', (t) => {
  const dir = mkdtempSync(tmpdir() + '/maintenance-log-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(dir + '/service.log', 'first\n' + 'line\n'.repeat(40000) + 'last line');
  const log = new ServiceLog(dir);
  assert.equal(log.files().length, 1);
  const detail = log.detail('current');
  assert.ok(detail.truncated);
  assert.ok(detail.text.endsWith('last line'));
  assert.ok(!detail.text.startsWith('first'));
  assert.ok(Buffer.byteLength(detail.text) <= 65536);
  assert.throws(() => log.detail('../service.log'));
  assert.throws(() => log.detail('previous'));
});

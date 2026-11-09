import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
import { defaultHistoryLimits } from '../server/domain/maintenance.js';
test('cleanup settings and actions validate, persist and enforce admin/CSRF boundaries', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const call = (path = '', method = 'GET', body, headers = {}) =>
    fetch(f.base + '/storage/cleanup' + path, {
      method,
      headers: { ...f.headers, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  assert.deepEqual(await (await call('/settings')).json(), defaultHistoryLimits);
  const limits = { ...defaultHistoryLimits, scans: 3, taskRuns: 4 };
  assert.equal((await call('/settings', 'PUT', limits)).status, 200);
  assert.deepEqual(await (await call('/settings')).json(), limits);
  for (const input of [
    { ...limits, scans: 0 },
    { ...limits, deliveries: '4' },
    { ...limits, unknown: 1 },
    { scans: 3 },
  ])
    assert.equal((await call('/settings', 'PUT', input)).status, 400);
  assert.equal(
    (await call('/settings', 'PUT', limits, { 'x-deskicons-token': 'wrong' })).status,
    403,
  );
  assert.equal((await call('', 'GET', undefined, { 'x-trim-isadmin': 'false' })).status, 403);
  assert.equal((await call('', 'POST', { kinds: ['operations'], confirmed: false })).status, 400);
  assert.equal((await call('', 'POST', { kinds: ['tasks'], confirmed: true })).status, 400);
  assert.equal(
    (await call('', 'POST', { kinds: ['operations', 'operations'], confirmed: true })).status,
    400,
  );
  assert.equal((await call('', 'POST', { kinds: ['operations'], confirmed: true })).status, 200);
  const summary = await (await call()).json();
  assert.equal(summary.items.length, 10);
});

test('cleanup detail routes paginate empty records, bound parameters and enforce admin access', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  for (const kind of ['taskRuns', 'restoreReceipts', 'serviceLog', 'updateCache']) {
    const response = await fetch(
      f.base + '/storage/cleanup/records/' + kind + '?page=1&pageSize=10',
      { headers: f.headers },
    );
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(Array.isArray(page.items));
    assert.equal(page.page, 1);
    assert.equal(page.pageSize, 10);
    assert.equal(
      (
        await fetch(f.base + '/storage/cleanup/records/' + kind + '/missing', {
          headers: f.headers,
        })
      ).status,
      404,
    );
  }
  for (const path of [
    'unknown',
    'taskRuns?page=0',
    'taskRuns?pageSize=101',
    'taskRuns?unknown=x',
    'taskRuns?page=1.5',
  ])
    assert.equal(
      (await fetch(f.base + '/storage/cleanup/records/' + path, { headers: f.headers })).status,
      400,
    );
  assert.equal(
    (
      await fetch(f.base + '/storage/cleanup/records/serviceLog', {
        headers: { ...f.headers, 'x-trim-isadmin': 'false' },
      })
    ).status,
    403,
  );
});

test('AI cleanup overview is read-only, and cleanup preserves active chats, their attachments and other owners', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const { AiApplicationService } = await import('../server/app/terminal/ai.service.js');
  const { prepareAiAttachments } = await import('../server/terminal/ai/attachments.js');
  const ai = f.app.get(AiApplicationService);
  for (const [owner, id] of [
    ['1000', 'keep'],
    ['1000', 'old'],
    ['1001', 'private'],
  ]) {
    const files = await prepareAiAttachments([
      { name: 'note.txt', kind: 'text', mimeType: 'text/plain', data: 'attachment content' },
    ]);
    ai.history.save({
      id,
      owner,
      connectionId: 'asset',
      connectionName: 'Host',
      title: 'Chat ' + id,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'm',
          role: 'user',
          content: '**hello**',
          attachments: files.map(({ data, ...a }) => a),
        },
      ],
      proposals: [],
      history: [
        { role: 'system', content: 'PRIVATE_SYSTEM' },
        { role: 'user', content: '**hello**', attachments: files },
      ],
    });
  }
  ai.conversations.openChatIds = (owner) => (owner === '1000' ? ['keep'] : []);
  ai.conversations.protectedAttachmentChats = (owner) => (owner === '1000' ? ['keep'] : []);
  const get = (path) => fetch(f.base + path, { headers: f.headers });
  const summary = await (await get('/storage/cleanup')).json();
  assert.equal(summary.items.find((r) => r.kind === 'aiHistory').count, 2);
  assert.equal(summary.items.find((r) => r.kind === 'aiHistory').protected, 1);
  assert.equal(summary.items.find((r) => r.kind === 'attachments').count, 2);
  assert.equal(summary.items.find((r) => r.kind === 'attachments').protected, 1);
  assert.equal(ai.history.list('1000').length, 2);
  const page = await (await get('/storage/cleanup/records/aiHistory?page=1&pageSize=1')).json();
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  const detail = await (await get('/storage/cleanup/records/aiHistory/keep')).json();
  assert.equal(detail.format, 'markdown');
  assert.ok(detail.text.includes('**hello**'));
  assert.ok(!detail.text.includes('PRIVATE_SYSTEM'));
  assert.equal((await get('/storage/cleanup/records/aiHistory/private')).status, 404);
  const clean = await fetch(f.base + '/storage/cleanup', {
    method: 'POST',
    headers: f.headers,
    body: JSON.stringify({ kinds: ['aiHistory', 'attachments'], confirmed: true }),
  });
  assert.equal(clean.status, 200);
  const result = await clean.json();
  assert.equal(result.deleted.aiHistory, 1);
  assert.equal(result.cleanupPending, false);
  assert.equal(ai.history.list('1000').length, 1);
  assert.equal(ai.history.list('1001').length, 1);
  assert.equal(ai.attachments.list('1000', {}).total, 1);
  assert.equal(ai.attachments.list('1001', {}).total, 1);
  const still = await (await get('/storage/cleanup')).json();
  assert.equal(still.items.find((r) => r.kind === 'aiHistory').count, 1);
});

test('selected record deletion is scoped, atomic, confirmation-gated and protects active data', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { AiApplicationService } = await import('../server/app/terminal/ai.service.js');
  const { writeFileSync, readFileSync, openSync, writeSync, closeSync } = await import('node:fs');
  const db = f.app.get(DatabaseService),
    c = db.connection,
    ai = f.app.get(AiApplicationService),
    now = Date.now();
  const call = (kind, ids, confirmed = true, headers = {}) =>
    fetch(f.base + '/storage/cleanup/records/' + kind + '/delete', {
      method: 'POST',
      headers: { ...f.headers, ...headers },
      body: JSON.stringify({ ids, confirmed }),
    });
  for (const owner of ['1000', '1001']) {
    c.prepare(
      "INSERT INTO tasks(id,owner_uid,name,type,enabled,schedule,options,timeout) VALUES(?,?,?,'script',0,'{}','{}',1)",
    ).run('task' + owner, owner, 'Fixture');
    c.prepare(
      "INSERT INTO task_runs(id,task_id,task_name,trigger,status,started_at) VALUES(?,?,?,'manual','success',1)",
    ).run('run' + owner, 'task' + owner, 'Fixture');
    c.prepare(
      "INSERT INTO operation_records VALUES(?,?, 'ssh.delete','file','success',1,2,'done')",
    ).run('op' + owner, owner);
    c.prepare(
      "INSERT INTO notification_deliveries(id,owner_uid,event_id,event_type,name,payload,revision,status,created_at) VALUES(?,?,'event','test','Fixture','{}',1,'success',1)",
    ).run('delivery' + owner, owner);
    c.prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?,?,?)').run(
      owner,
      'receipt' + owner,
      'digest',
      'a'.repeat(64),
      'b'.repeat(64),
      '{}',
      now - 8 * 86400000,
    );
    ai.history.save({
      id: 'chat' + owner,
      owner,
      connectionId: 'asset',
      connectionName: 'Host',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'm', role: 'user', content: 'Fixture' }],
      proposals: [],
      history: [],
    });
  }
  for (const [kind, prefix, table, key] of [
    ['taskRuns', 'run', 'task_runs', 'id'],
    ['operations', 'op', 'operation_records', 'id'],
    ['deliveries', 'delivery', 'notification_deliveries', 'id'],
    ['restoreReceipts', 'receipt', 'backup_receipts', 'request_id'],
    ['aiHistory', 'chat', 'ai_chats', 'id'],
  ]) {
    assert.equal(
      (await call(kind, [prefix + '1000', prefix + '1001'])).status,
      kind === 'aiHistory' ? 404 : 409,
    );
    assert.equal(
      c.prepare('SELECT count(*) n FROM ' + table + ' WHERE ' + key + '=?').get(prefix + '1000').n,
      1,
      kind,
    );
    assert.equal((await call(kind, [prefix + '1000'], false)).status, 400);
    assert.equal(
      (await call(kind, [prefix + '1000'], true, { 'x-deskicons-token': 'bad' })).status,
      403,
    );
    assert.equal((await call(kind, [prefix + '1000'])).status, 200);
    assert.equal(
      c.prepare('SELECT count(*) n FROM ' + table + ' WHERE ' + key + '=?').get(prefix + '1000').n,
      0,
    );
    assert.equal(
      c.prepare('SELECT count(*) n FROM ' + table + ' WHERE ' + key + '=?').get(prefix + '1001').n,
      1,
    );
  }
  c.prepare(
    "INSERT INTO operation_records VALUES('active','1000','ai.command','file','running',1,NULL,'')",
  ).run();
  assert.equal((await call('operations', ['active'])).status, 409);
  c.prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?,?,?)').run(
    '1000',
    'fresh',
    'digest',
    'a'.repeat(64),
    'b'.repeat(64),
    '{}',
    now,
  );
  assert.equal((await call('restoreReceipts', ['fresh'])).status, 409);
  ai.history.save({
    id: 'active-chat',
    owner: '1000',
    connectionId: 'asset',
    connectionName: 'Host',
    title: 'Chat',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'm', role: 'user', content: 'Fixture' }],
    proposals: [],
    history: [],
  });
  ai.conversations.openChatIds = () => ['active-chat'];
  assert.equal((await call('aiHistory', ['active-chat'])).status, 409);
  for (const input of [[], ['x', 'x'], Array.from({ length: 201 }, (_, i) => String(i))])
    assert.equal((await call('operations', input)).status, 400);
  assert.equal((await call('unknown', ['x'])).status, 400);
  writeFileSync(db.dataDir + '/service.log', 'current');
  writeFileSync(db.dataDir + '/service.log.1', 'previous');
  const fd = openSync(db.dataDir + '/service.log', 'a');
  try {
    assert.equal((await call('serviceLog', ['current'])).status, 200);
    writeSync(fd, 'after');
    assert.equal(readFileSync(db.dataDir + '/service.log', 'utf8'), 'after');
    assert.equal(readFileSync(db.dataDir + '/service.log.1', 'utf8'), 'previous');
    assert.equal((await call('serviceLog', ['../../secret'])).status, 404);
  } finally {
    closeSync(fd);
  }
});

import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiHistoryRepository } from '../server/persistence/ai-history.repository.js';
import { AiConversationService } from '../server/terminal/ai/conversation.js';
async function idle(s, session = 's') {
  for (let i = 0; i < 100; i++) {
    if (!s.snapshot('a', session).busy) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.fail('timeout');
}
test('history persists latest 50 chats, restores only matching asset and never replays commands', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-history-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  let repo = new AiHistoryRepository(db);
  let execs = 0;
  const deps = {
    settings: {
      privateSettings: () => ({ baseUrl: 'http://mock', model: 'x', apiKey: '', updatedAt: 0 }),
    },
    provider: {
      complete: async () => ({
        content: '检查',
        toolCalls: [{ id: 'call', command: 'pwd', explanation: '目录' }],
      }),
    },
    getSession: (owner, id) => {
      if (owner !== 'a') throw Error('owner');
      return {
        client: null,
        state: 'connected',
        closed: false,
        connection: { id: id === 's' ? 'asset' : 'other', name: 'Test' },
      };
    },
    execute: async () => {
      execs++;
      return { stdout: 'ok', stderr: '', exitCode: 0, status: 'success', truncated: false };
    },
    history: repo,
  };
  let s = new AiConversationService(deps);
  s.message('a', 's', 'first');
  await idle(s);
  const first = s.snapshot('a', 's').chatId;
  s.newChat('a', 's');
  assert.equal(repo.list('a').length, 1);
  assert.equal(repo.list('b').length, 0);
  await s.close();
  db.close();
  db = new DatabaseService(dir);
  repo = new AiHistoryRepository(db);
  s = new AiConversationService({ ...deps, history: repo });
  assert.throws(() => s.restore('b', 's', first));
  assert.throws(() => s.restore('a', 'other', first), /资产/);
  s.restore('a', 's', first);
  assert.equal(s.snapshot('a', 's').messages[0].content, 'first');
  assert.equal(s.snapshot('a', 's').proposals[0].status, 'expired');
  assert.equal(s.snapshot('a', 's').executionMode, 'review');
  assert.equal(execs, 0);
  for (let i = 0; i < 51; i++) {
    s.newChat('a', 's');
    s.message('a', 's', 'chat ' + i);
    await idle(s);
  }
  s.message('a', 'other', 'protected-active');
  await idle(s, 'other');
  for (let i = 0; i < 51; i++) {
    s.newChat('a', 's');
    s.message('a', 's', 'later ' + i);
    await idle(s);
  }
  assert.equal(repo.list('a').length, 50);
  assert.ok(repo.list('a').some((chat) => chat.title === 'protected-active'));
  assert.equal(repo.list('a')[0].title, 'later 50');
  assert.equal(db.connection.prepare('pragma foreign_key_check').all().length, 0);
  await s.close();
  db.close();
});
test('a persisted conversation has only one live SSH binding and cleanup survives write failures', async () => {
  const records = new Map();
  let failSave = false,
    aborted = false;
  const history = {
    get: (owner, id) => records.get(owner + id) || null,
    save: (chat) => {
      if (failSave) throw Error('SQLITE_FULL');
      records.set(chat.owner + chat.id, structuredClone(chat));
    },
  };
  const s = new AiConversationService({
    settings: {
      privateSettings: () => ({ baseUrl: 'http://mock', model: 'm', apiKey: '', updatedAt: 0 }),
    },
    history,
    getSession: () => ({
      client: null,
      state: 'connected',
      closed: false,
      connection: { id: 'same-asset', name: 'Same' },
    }),
    provider: { complete: async () => ({ content: '完成', toolCalls: [] }) },
  });
  s.message('a', 's', 'first');
  await idle(s);
  const id = s.snapshot('a', 's').chatId;
  assert.throws(() => s.restore('a', 'second', id), /其他终端/);
  s.clearSession('s');
  assert.doesNotThrow(() => s.restore('a', 'second', id));
  failSave = true;
  assert.doesNotThrow(() => s.clearSession('second'));
  await assert.doesNotReject(s.close());
  const running = new AiConversationService({
    settings: {
      privateSettings: () => ({ baseUrl: 'http://mock', model: 'm', apiKey: '', updatedAt: 0 }),
    },
    history: {
      get: () => null,
      save: () => {
        if (failSave) throw Error('SQLITE_FULL');
      },
    },
    getSession: () => ({ client: null, state: 'connected', closed: false }),
    provider: {
      complete: (_c, _m, { signal }) =>
        new Promise((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve({ content: '', toolCalls: [] });
            },
            { once: true },
          ),
        ),
    },
  });
  failSave = false;
  running.message('a', 's', 'running');
  failSave = true;
  assert.doesNotThrow(() => running.clearSession('s'));
  assert.equal(aborted, true);
  await running.close();
});

test('schema v4 upgrade preserves hidden protocol reasoning independently of visible chat', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/reasoning-history-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  db.connection.exec(
    legacyNotificationReset + 'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; ALTER TABLE ai_chat_protocol DROP COLUMN reasoning; DELETE FROM schema_migrations WHERE version>=5; DROP TABLE icon_images; DROP TABLE command_catalog; DROP TABLE user_preferences; ALTER TABLE icons DROP COLUMN menu_page; DELETE FROM schema_migrations WHERE version=8; DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11; DROP TABLE ai_chat_attachments; DELETE FROM schema_migrations WHERE version>=9; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=4',
  );
  db.close();
  db = new DatabaseService(dir);
  const repo = new AiHistoryRepository(db);
  const record = {
    id: 'test-chat',
    owner: 'a',
    connectionId: 'asset',
    connectionName: 'test',
    title: 'test',
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'm', role: 'assistant', content: '公开回答' }],
    proposals: [],
    history: [
      {
        role: 'assistant',
        content: '<think>private</think>公开回答',
        reasoning_content: 'hidden',
        provider_content: {
          protocol: 'gemini',
          content: { role: 'model', parts: [{ thoughtSignature: 'opaque' }] },
        },
        reasoning_details: [{ type: 'reasoning.text', text: 'hidden' }],
      },
    ],
  };
  repo.save(record);
  db.close();
  db = new DatabaseService(dir);
  const restored = new AiHistoryRepository(db).get('a', 'test-chat');
  assert.deepEqual(restored.history, record.history);
  assert.equal(restored.messages[0].content, '公开回答');
  assert.equal(new AiHistoryRepository(db).get('b', 'test-chat'), null);
  assert.equal(db.connection.prepare('pragma user_version').get().user_version, 33);
  db.close();
});

function fixedTimeChat(id, owner = 'a', timestamp = 1000) {
  return {
    id,
    owner,
    connectionId: 'asset',
    connectionName: 'Fixture',
    title: id,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [{ id: 'message', role: 'user', content: id }],
    proposals: [],
    history: [{ role: 'user', content: id }],
  };
}

test('same-millisecond history saves follow write order, promote updates, and persist per owner', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-history-order-');
  let db = new DatabaseService(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  let repo = new AiHistoryRepository(db);
  repo.save(fixedTimeChat('other-owner', 'b', 900000));
  repo.save(fixedTimeChat('z-first'));
  repo.save(fixedTimeChat('y-second'));
  repo.save(fixedTimeChat('x-third'));
  assert.deepEqual(
    repo.list('a').map((chat) => chat.id),
    ['x-third', 'y-second', 'z-first'],
  );
  assert.deepEqual(
    repo.list('a').map((chat) => chat.updatedAt),
    [1002, 1001, 1000],
  );
  repo.save(fixedTimeChat('z-first'));
  assert.deepEqual(
    repo.list('a').map((chat) => chat.id),
    ['z-first', 'x-third', 'y-second'],
  );
  assert.equal(repo.get('a', 'z-first').updatedAt, 1003);
  assert.equal(repo.get('a', 'z-first').createdAt, 1000);
  assert.equal(repo.list('b')[0].updatedAt, 900000);
  assert.equal(repo.get('b', 'z-first'), null);
  db.close();
  db = new DatabaseService(dir);
  repo = new AiHistoryRepository(db);
  assert.deepEqual(
    repo.list('a').map((chat) => chat.id),
    ['z-first', 'x-third', 'y-second'],
  );
  repo.save(fixedTimeChat('a-after-reopen'));
  assert.equal(repo.list('a')[0].id, 'a-after-reopen');
  assert.equal(repo.list('a')[0].updatedAt, 1004);
  repo.save(fixedTimeChat('forward-clock', 'a', 5000));
  assert.equal(repo.list('a')[0].updatedAt, 5000);
  repo.save(fixedTimeChat('backward-clock'));
  assert.equal(repo.list('a')[0].id, 'backward-clock');
  assert.equal(repo.list('a')[0].updatedAt, 5001);
  assert.deepEqual(
    repo.list('b').map((chat) => chat.id),
    ['other-owner'],
  );
});

test('same-millisecond history retention keeps the latest fifty actual saves', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-history-retention-');
  let db = new DatabaseService(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  let repo = new AiHistoryRepository(db);
  repo.save(fixedTimeChat('other-owner', 'b'));
  const saved = [];
  for (let index = 0; index < 55; index++) {
    const id = 'chat-' + String(99 - index).padStart(3, '0');
    saved.push(id);
    repo.save(fixedTimeChat(id));
  }
  assert.deepEqual(
    repo.list('a').map((chat) => chat.id),
    saved.slice(-50).reverse(),
  );
  assert.equal(repo.get('a', 'chat-099'), null);
  assert.equal(repo.get('a', 'chat-095'), null);
  assert.ok(repo.get('a', 'chat-094'));
  assert.equal(repo.list('a')[0].updatedAt, 1054);
  assert.deepEqual(
    repo.list('b').map((chat) => chat.id),
    ['other-owner'],
  );
  assert.equal(db.connection.prepare('pragma foreign_key_check').all().length, 0);
  db.close();
  db = new DatabaseService(dir);
  repo = new AiHistoryRepository(db);
  assert.deepEqual(
    repo.list('a').map((chat) => chat.id),
    saved.slice(-50).reverse(),
  );
  assert.equal(repo.get('a', 'chat-099'), null);
  assert.deepEqual(
    repo.list('b').map((chat) => chat.id),
    ['other-owner'],
  );
});

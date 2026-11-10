import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiHistoryRepository } from '../server/persistence/ai-history.repository.js';
import { AiAttachmentRepository } from '../server/persistence/ai-attachment.repository.js';
import { prepareAiAttachments } from '../server/terminal/ai/attachments.js';
const input = { name: 'test.log', kind: 'text', mimeType: 'text/plain', data: 'test content' };
async function fixture(t) {
  const dir = await mkdtemp(tmpdir() + '/ai-cleanup-');
  const db = new DatabaseService(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const history = new AiHistoryRepository(db),
    repo = new AiAttachmentRepository(db);
  const make = async (owner, id, name = input.name) => {
    const files = await prepareAiAttachments([{ ...input, name }]);
    const chat = {
      id,
      owner,
      connectionId: 'asset',
      connectionName: 'Fixture',
      title: 'Fixture chat',
      createdAt: 1,
      updatedAt: 1,
      proposals: [],
      messages: [
        { id: 'm', role: 'user', content: 'check', attachments: files.map(({ data, ...a }) => a) },
      ],
      history: [{ role: 'user', content: 'check', attachments: files }],
    };
    history.save(chat);
    return chat;
  };
  return { dir, db, history, repo, make };
}
test('attachment cleanup is owner-scoped, blocks busy chats, keeps tombstones and never resurrects deleted files', async (t) => {
  const { dir, db, history, repo, make } = await fixture(t);
  const a = await make('a', 'a'),
    b = await make('b', 'b');
  const id = a.history[0].attachments[0].id;
  assert.equal(repo.list('a', {}).summary.count, 1);
  assert.equal(repo.list('a', { search: 'test' }).total, 1);
  assert.equal(repo.list('a', { kind: 'image' }).total, 0);
  assert.throws(() => repo.remove('a', [id, b.history[0].attachments[0].id], []), /不存在/);
  assert.throws(() => repo.remove('a', [id], ['a']), /处理/);
  const result = repo.remove('a', [id], []);
  assert.equal(result.count, 1);
  assert.equal(result.cleanupPending, false);
  assert.equal(repo.list('a', {}).total, 0);
  assert.equal(repo.list('b', {}).total, 1);
  const saved = history.get('a', 'a');
  assert.equal(saved.messages[0].attachments[0].removed, true);
  assert.equal(saved.history[0].attachments, undefined);
  assert.equal(saved.messages[0].content, 'check');
  history.save(a);
  assert.equal(history.get('a', 'a').history[0].attachments, undefined);
  assert.equal((await readdir(dir + '/ai/attachments')).length, 1);
  assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('cleanup strips active idle conversation context and marks visible attachments before the next turn', async (t) => {
  const { history, repo } = await fixture(t);
  const { AiConversationService } = await import('../server/terminal/ai/conversation.js');
  let received, release;
  const files = await prepareAiAttachments([input]);
  const service = new AiConversationService({
    history,
    settings: {
      privateSettings: () => ({
        protocol: 'openai',
        model: 'test',
        baseUrl: 'http://fixture',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({
      client: null,
      state: 'connected',
      closed: false,
      connection: { id: 'asset', name: 'Test' },
    }),
    provider: {
      complete: async (_config, messages) => {
        received = structuredClone(messages);
        await new Promise((r) => {
          release = r;
        });
        return { content: 'ok', toolCalls: [] };
      },
    },
  });
  service.message('a', 'ssh', 'first', { attachments: files });
  const chatId = service.snapshot('a', 'ssh').chatId;
  assert.deepEqual(service.protectedAttachmentChats('a'), [chatId]);
  assert.throws(
    () => repo.remove('a', [files[0].id], service.protectedAttachmentChats('a')),
    /处理/,
  );
  release();
  for (let i = 0; i < 50 && service.snapshot('a', 'ssh').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  repo.remove('a', [files[0].id], service.protectedAttachmentChats('a'));
  service.forgetAttachments('a', [files[0].id]);
  assert.equal(service.snapshot('a', 'ssh').messages[0].attachments[0].removed, true);
  service.message('a', 'ssh', 'continue');
  assert.equal(
    received.some((m) => m.attachments?.length),
    false,
  );
  release();
  await service.close();
  assert.equal(
    history.get('a', chatId).history.some((m) => m.attachments?.length),
    false,
  );
});

test('attachment management API enforces owner, confirmation, DTO and CSRF', async (t) => {
  const { appFixture } = await import('./fixtures/terminal-app.js');
  const { AiApplicationService } = await import('../server/app/terminal/ai.service.js');
  const f = await appFixture();
  t.after(f.close);
  const ai = f.app.get(AiApplicationService);
  const files = await prepareAiAttachments([input]);
  ai.history.save({
    id: 'chat',
    owner: '1000',
    connectionId: 'asset',
    connectionName: 'Test',
    title: 'Test',
    createdAt: 1,
    updatedAt: 1,
    proposals: [],
    messages: [
      { id: 'm', role: 'user', content: 'check', attachments: files.map(({ data, ...a }) => a) },
    ],
    history: [{ role: 'user', content: 'check', attachments: files }],
  });
  const call = (path, method = 'GET', body, headers = {}) =>
    fetch(f.base + '/storage/attachments' + path, {
      method,
      headers: { ...f.headers, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  const listed = await (await call('')).json();
  assert.equal(listed.total, 1);
  assert.equal((await (await call('', 'GET', null, { 'x-trim-userid': '1001' })).json()).total, 0);
  assert.equal((await call('?kind=bad')).status, 400);
  assert.equal(
    (
      await call(
        '/delete',
        'POST',
        { ids: [files[0].id], confirmed: true },
        { 'x-deskicons-token': 'bad' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call('/delete', 'POST', { ids: [files[0].id], confirmed: false })).status,
    400,
  );
  assert.equal(
    (
      await call(
        '/delete',
        'POST',
        { ids: [files[0].id], confirmed: true },
        { 'x-trim-userid': '1001' },
      )
    ).status,
    404,
  );
  assert.equal((await call('/orphans', 'POST', {})).status, 400);
  assert.equal(
    (await call('/delete', 'POST', { ids: [files[0].id], confirmed: true })).status,
    200,
  );
  assert.equal((await (await call('')).json()).total, 0);
  assert.equal(ai.readHistory('1000', 'chat').messages[0].attachments[0].removed, true);
});

test('cleaning one chat never detaches a different chat streaming reply', async () => {
  const { AiConversationService } = await import('../server/terminal/ai/conversation.js');
  let emit, finish;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        protocol: 'openai',
        model: 'test',
        baseUrl: 'http://fixture',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({ client: null, state: 'connected', closed: false }),
    provider: {
      complete: async (_config, _messages, options) => {
        emit = options.onText;
        return await new Promise((r) => {
          finish = r;
        });
      },
    },
  });
  service.message('a', 'streaming', 'question');
  emit('partial');
  service.forgetAttachments('a', ['unrelated-file']);
  emit(' more');
  finish({ content: 'full answer', toolCalls: [] });
  for (let i = 0; i < 50 && service.snapshot('a', 'streaming').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  assert.equal(service.snapshot('a', 'streaming').messages.at(-1).content, 'full answer');
  await service.close();
});

test('schema 9 upgrades preserve attachment files, metadata and history', async (t) => {
  const dir = await mkdtemp(tmpdir() + '/ai-attachment-migrate-');
  let db = new DatabaseService(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const files = await prepareAiAttachments([input]);
  new AiHistoryRepository(db).save({
    id: 'chat',
    owner: 'a',
    connectionId: 'asset',
    connectionName: 'Fixture',
    title: 'Fixture',
    createdAt: 1,
    updatedAt: 1234,
    proposals: [],
    messages: [
      { id: 'm', role: 'user', content: 'check', attachments: files.map(({ data, ...a }) => a) },
    ],
    history: [{ role: 'user', content: 'check', attachments: files }],
  });
  db.connection.exec(
    legacyNotificationReset + 'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11; DROP INDEX ai_chat_attachments_owner_live; ALTER TABLE ai_chat_attachments DROP COLUMN created_at; ALTER TABLE ai_chat_attachments DROP COLUMN deleted_at; DELETE FROM schema_migrations WHERE version=10; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=9;',
  );
  db.close();
  db = new DatabaseService(dir);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 34);
  const metadata = db.connection
    .prepare('SELECT created_at,deleted_at FROM ai_chat_attachments')
    .get();
  assert.equal(metadata.created_at, 1234);
  assert.equal(metadata.deleted_at, null);
  assert.equal(
    new AiHistoryRepository(db).get('a', 'chat').history[0].attachments[0].data,
    input.data,
  );
  assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('age filtering and orphan cleanup only remove files without live references', async (t) => {
  const { dir, db, history, repo, make } = await fixture(t);
  await make('a', 'live');
  await make('b', 'other');
  db.connection
    .prepare('UPDATE ai_chat_attachments SET created_at=? WHERE owner_uid=?')
    .run(Date.now() - 8 * 86400000, 'a');
  assert.equal(repo.list('a', { olderThanDays: 7 }).total, 1);
  assert.equal(repo.list('a', { olderThanDays: 30 }).total, 0);
  const { AiAttachmentFiles } = await import('../server/persistence/ai-attachment-files.js');
  new AiAttachmentFiles(dir).write(crypto.randomUUID(), Buffer.from('orphan'));
  const result = repo.cleanOrphans();
  assert.equal(result.count, 1);
  assert.equal(result.bytes, 6);
  assert.equal((await readdir(dir + '/ai/attachments')).length, 2);
  assert.equal(history.get('a', 'live').history[0].attachments[0].data, input.data);
  assert.equal(history.get('b', 'other').history[0].attachments[0].data, input.data);
});

test('bulk attachment cleanup skips protected chats, preserves other owners and marks removed metadata', async (t) => {
  const { history, repo, make } = await fixture(t);
  await make('a', 'keep');
  await make('a', 'remove');
  await make('b', 'private');
  const result = repo.removeAvailable('a', ['keep']);
  assert.equal(result.count, 1);
  assert.equal(result.cleanupPending, false);
  assert.equal(repo.list('a', {}).total, 1);
  assert.equal(repo.list('b', {}).total, 1);
  assert.equal(history.get('a', 'remove').messages[0].attachments[0].removed, true);
  assert.equal(history.get('a', 'keep').messages[0].attachments[0].removed, undefined);
});

test('history reloads accepted ZIP attachments above 2 MiB through the 4 MiB limit', async (t) => {
  const { db, history } = await fixture(t);
  for (const size of [2097153, 4194304]) {
    const bytes = Buffer.alloc(size, 65);
    bytes.writeUInt32LE(0x04034b50, 0);
    const files = await prepareAiAttachments([
      {
        name: 'skills.zip',
        kind: 'archive',
        mimeType: 'application/zip',
        data: bytes.toString('base64'),
      },
    ]);
    const id = 'archive-' + size;
    history.save({
      id,
      owner: 'a',
      connectionId: 'asset',
      connectionName: 'Fixture',
      title: 'Archive',
      createdAt: 1,
      updatedAt: 1,
      proposals: [],
      messages: [
        { id: 'm', role: 'user', content: 'check', attachments: files.map(({ data, ...a }) => a) },
      ],
      history: [{ role: 'user', content: 'check', attachments: files }],
    });
    const reopened = new AiHistoryRepository(db).get('a', id);
    assert.equal(reopened.history[0].attachments[0].data, files[0].data);
    assert.equal(reopened.messages[0].attachments[0].size, size);
  }
  await assert.rejects(
    prepareAiAttachments([
      {
        name: 'too-large.zip',
        kind: 'archive',
        mimeType: 'application/zip',
        data: Buffer.alloc(4194305).toString('base64'),
      },
    ]),
  );
});

test('ZIP base64 validation still rejects malformed and noncanonical input', async () => {
  for (const data of ['UEsDBA=', 'UEsDBA===', 'UEsDBB==', 'UEsD BA==', 'UEsDBA==x']) {
    await assert.rejects(
      prepareAiAttachments([
        {
          name: 'skills.zip',
          kind: 'archive',
          mimeType: 'application/zip',
          data,
        },
      ]),
    );
  }
});

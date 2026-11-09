import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm, readFile, readdir, writeFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiHistoryRepository } from '../server/persistence/ai-history.repository.js';
import { AiConversationService } from '../server/terminal/ai/conversation.js';

const text = { name: 'debug.log', kind: 'text', mimeType: 'text/plain', data: 'error: test' };
const idle = async (service) => {
  for (let i = 0; i < 100; i++) {
    if (!service.snapshot('a', 'ssh').busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('conversation did not settle');
};

test('attachments validate types and byte limits and refuse forged or oversized files', async () => {
  const { prepareAiAttachments } = await import('../server/terminal/ai/attachments.js');
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const items = await prepareAiAttachments([
    text,
    { name: 'screen.png', kind: 'image', mimeType: 'image/png', data: image.toString('base64') },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].size, Buffer.byteLength(text.data));
  assert.equal(items[1].data, image.toString('base64'));
  assert.ok(items.every((item) => item.id));
  for (const bad of [
    [{ ...text, name: '../secret.log' }],
    [{ ...text, name: 'binary.exe' }],
    [{ ...text, data: 'a'.repeat(262145) }],
    Array(5).fill(text),
    [
      {
        name: 'screen.png',
        kind: 'image',
        mimeType: 'image/png',
        data: Buffer.from('not an image').toString('base64'),
      },
    ],
    [{ name: 'screen.png', kind: 'image', mimeType: 'image/png', data: 'not-base64!' }],
  ])
    await assert.rejects(prepareAiAttachments(bad));
});

test('attachment-only chats persist files with SQLite metadata and restore full provider context without polluting visible text', async (t) => {
  const { prepareAiAttachments } = await import('../server/terminal/ai/attachments.js');
  const dir = await mkdtemp(tmpdir() + '/nas-ai-files-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  let repo = new AiHistoryRepository(db);
  const files = await prepareAiAttachments([text]);
  let received;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        protocol: 'openai',
        baseUrl: 'http://fixture',
        model: 'fixture',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({
      state: 'connected',
      closed: false,
      client: null,
      connection: { id: 'asset', name: 'Fixture' },
    }),
    provider: {
      complete: async (_config, messages) => {
        received = structuredClone(messages);
        return { content: '分析完成', toolCalls: [] };
      },
    },
    history: repo,
  });
  service.message('a', 'ssh', '', { attachments: files });
  await idle(service);
  const view = service.snapshot('a', 'ssh');
  assert.equal(view.messages[0].attachments[0].name, text.name);
  assert.equal(view.messages[0].attachments[0].data, undefined);
  assert.equal(received.find((m) => m.role === 'user').attachments[0].data, text.data);
  const metadata = db.connection
    .prepare('SELECT storage_key,sha256 FROM ai_chat_attachments')
    .get();
  assert.equal(
    (await readFile(dir + '/ai/attachments/' + metadata.storage_key)).toString(),
    text.data,
  );
  assert.equal(metadata.sha256.length, 64);
  assert.equal(
    db.connection
      .prepare('PRAGMA table_info(ai_chat_attachments)')
      .all()
      .some((c) => c.name === 'data'),
    false,
  );
  await service.close();
  db.close();
  db = new DatabaseService(dir);
  repo = new AiHistoryRepository(db);
  const saved = repo.get('a', view.chatId);
  assert.equal(saved.history.find((m) => m.role === 'user').attachments[0].data, text.data);
  assert.equal(saved.messages[0].attachments[0].name, text.name);
  assert.equal(repo.get('other', view.chatId), null);
  db.connection.prepare('DELETE FROM ai_chats WHERE id=?').run(view.chatId);
  assert.equal(db.connection.prepare('SELECT count(*) n FROM ai_chat_attachments').get().n, 0);
  db.close();
});

test('protocol adapters transmit text and images in provider-specific formats without leaking storage paths', async (t) => {
  const { AiProvider } = await import('../server/terminal/ai/provider.js');
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const image = {
    id: crypto.randomUUID(),
    name: 'screen.png',
    kind: 'image',
    mimeType: 'image/png',
    data: 'AQID',
    size: 3,
  };
  const messages = [
    { role: 'system', content: 'untrusted attachments' },
    {
      role: 'user',
      content: 'check',
      attachments: [{ ...text, id: crypto.randomUUID(), size: text.data.length }, image],
    },
  ];
  for (const protocol of ['openai', 'glm', 'minimax', 'mimo', 'claude', 'gemini', 'ollama']) {
    let body;
    const responses = {
      claude: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
      gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] },
      ollama: { done: true, message: { content: 'ok' } },
    };
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(
        JSON.stringify(
          responses[protocol] || {
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          },
        ),
        { headers: { 'content-type': 'application/json' } },
      );
    };
    const result = await new AiProvider().complete(
      { protocol, baseUrl: 'http://fixture/v1', apiKey: '', model: 'vision-fixture', updatedAt: 0 },
      messages,
      { signal: new AbortController().signal, onText: () => {} },
    );
    assert.equal(result.content, 'ok');
    assert.ok(JSON.stringify(body).includes(text.data), protocol + ' text');
    if (protocol === 'claude')
      assert.deepEqual(body.messages[0].content.at(-1), {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: image.data },
      });
    else if (protocol === 'gemini')
      assert.deepEqual(body.contents[0].parts.at(-1), {
        inlineData: { mimeType: 'image/png', data: image.data },
      });
    else if (protocol === 'ollama') assert.deepEqual(body.messages[1].images, [image.data]);
    else
      assert.deepEqual(body.messages[1].content.at(-1), {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AQID' },
      });
  }
  globalThis.fetch = () => assert.fail('unsupported model must not send image');
  for (const [protocol, model] of [
    ['deepseek', 'deepseek-chat'],
    ['minimax', 'MiniMax-M2.5'],
  ])
    await assert.rejects(
      new AiProvider().complete(
        { protocol, baseUrl: 'http://fixture', apiKey: '', model, updatedAt: 0 },
        messages,
        { signal: new AbortController().signal, onText: () => {} },
      ),
      /图片/,
    );
});

test('attachment files use private permissions, reject redirection and detect altered content', async (t) => {
  const { AiAttachmentFiles } = await import('../server/persistence/ai-attachment-files.js');
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(tmpdir() + '/nas-ai-files-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = new AiAttachmentFiles(dir),
    id = crypto.randomUUID(),
    bytes = Buffer.from('test');
  files.write(id, bytes);
  const path = dir + '/ai/attachments/' + id;
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(dir + '/ai/attachments')).mode & 0o777, 0o700);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(files.read(id, 4, hash).toString(), 'test');
  assert.throws(() => files.write(id, Buffer.from('evil')), /EEXIST/);
  assert.equal(files.read(id, 4, hash).toString(), 'test');
  await writeFile(path, 'evil');
  assert.throws(() => files.read(id, 4, hash), /校验/);
  files.cleanUnreferenced(new Set());
  assert.deepEqual(await readdir(dir + '/ai/attachments'), []);
  await symlink(tmpdir(), dir + '/redirect');
  await symlink(tmpdir(), dir + '/ai-bad');
  const other = await mkdtemp(tmpdir() + '/nas-ai-link-');
  t.after(() => rm(other, { recursive: true, force: true }));
  await symlink(tmpdir(), other + '/ai');
  assert.throws(() => new AiAttachmentFiles(other), /重定向/);
});

test('chat pruning cleans unreferenced attachment files and failed SQL inserts roll back newly written files', async (t) => {
  const { prepareAiAttachments } = await import('../server/terminal/ai/attachments.js');
  const dir = await mkdtemp(tmpdir() + '/nas-ai-prune-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseService(dir),
    repo = new AiHistoryRepository(db);
  t.after(() => db.close());
  const attachment = (await prepareAiAttachments([text]))[0];
  const chat = (id, a = attachment) => ({
    id,
    owner: 'a',
    connectionId: 'asset',
    connectionName: 'Test',
    title: 'test',
    createdAt: 1,
    updatedAt: Date.now(),
    proposals: [],
    messages: [{ id: 'm', role: 'user', content: 'check', attachments: [a] }],
    history: [{ role: 'user', content: 'check', attachments: [a] }],
  });
  repo.save(chat('first'));
  for (let i = 0; i < 50; i++) {
    const entry = chat('later-' + i);
    entry.messages[0].attachments = [];
    entry.history[0].attachments = [];
    repo.save(entry);
  }
  assert.equal(repo.get('a', 'first'), null);
  assert.deepEqual(await readdir(dir + '/ai/attachments'), []);
  const bad = chat('rollback', { ...attachment, id: crypto.randomUUID(), size: 0 });
  assert.throws(() => repo.save(bad));
  assert.equal(repo.get('a', 'rollback'), null);
  assert.deepEqual(await readdir(dir + '/ai/attachments'), []);
  assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('failed attachment persistence cannot leak a rejected draft into the next provider turn', async () => {
  const { prepareAiAttachments } = await import('../server/terminal/ai/attachments.js');
  let fails = true,
    received;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        protocol: 'openai',
        baseUrl: 'http://fixture',
        model: 'fixture',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({ state: 'connected', closed: false, client: null }),
    history: {
      save: () => {
        if (fails) throw Error('disk full');
      },
      get: () => null,
    },
    provider: {
      complete: async (_config, messages) => {
        received = structuredClone(messages);
        return { content: 'ok', toolCalls: [] };
      },
    },
  });
  const files = await prepareAiAttachments([text]);
  assert.throws(() => service.message('a', 'ssh', 'first', { attachments: files }), /disk full/);
  assert.equal(service.snapshot('a', 'ssh').messages.length, 0);
  fails = false;
  service.message('a', 'ssh', 'retry without files');
  await idle(service);
  assert.equal(received.filter((m) => m.role === 'user').length, 1);
  assert.equal(
    received.some((m) => m.attachments?.length),
    false,
  );
  await service.close();
});

test('image preview API returns verified owner images and refuses other owners, text and cleaned files', async (t) => {
  const { appFixture } = await import('./fixtures/terminal-app.js');
  const { AiApplicationService } = await import('../server/app/terminal/ai.service.js');
  const { prepareAiAttachments } = await import('../server/terminal/ai/attachments.js');
  const f = await appFixture();
  t.after(f.close);
  const ai = f.app.get(AiApplicationService);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const files = await prepareAiAttachments([
    text,
    { name: 'preview.png', kind: 'image', mimeType: 'image/png', data: image.toString('base64') },
  ]);
  ai.history.save({
    id: 'preview-chat',
    owner: '1000',
    connectionId: 'asset',
    connectionName: 'Test',
    title: 'Preview',
    createdAt: 1,
    updatedAt: 1,
    proposals: [],
    messages: [
      { id: 'm', role: 'user', content: 'check', attachments: files.map(({ data, ...a }) => a) },
    ],
    history: [{ role: 'user', content: 'check', attachments: files }],
  });
  const path = '/ai/attachments/' + files[1].id + '/preview';
  const result = await f.call(path);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { mimeType: 'image/png', data: image.toString('base64') });
  assert.equal((await f.call(path, 'GET', null, { 'x-trim-userid': '1001' })).status, 404);
  assert.equal((await f.call(path, 'GET', null, { 'x-trim-isadmin': 'false' })).status, 403);
  assert.equal((await f.call('/ai/attachments/' + files[0].id + '/preview')).status, 404);
  ai.cleanAttachments('1000', [files[1].id]);
  assert.equal((await f.call(path)).status, 404);
});

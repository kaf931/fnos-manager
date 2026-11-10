import { legacyNotificationReset } from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiSkillRepository } from '../server/persistence/ai-skill.repository.js';
import { parseSkillDocument } from '../server/terminal/ai/skills.js';
const document =
  '---\nname: docker-check\ndescription: 检查 Docker 容器运行状态\n---\n先使用 docker ps 检查运行状态，不直接修改配置。';
test('SKILL.md validates standard frontmatter and refuses ambiguous or oversized input', () => {
  const skill = parseSkillDocument(document);
  assert.equal(skill.name, 'docker-check');
  assert.ok(skill.instructions.includes('docker ps'));
  assert.equal(
    parseSkillDocument(
      '---\nname: test-skill\ndescription: >-\n  Multiline description\n  for this skill.\nmetadata:\n  author: kaf\n---\nInstructions',
    ).description,
    'Multiline description for this skill.',
  );
  for (const bad of [
    'missing frontmatter',
    document.replace('docker-check', 'Bad_Name'),
    document.replace('docker-check', 'docker--check'),
    document.replace('description:', 'name: duplicated\ndescription:'),
    document.replace('检查 Docker 容器运行状态', '[not, a, string]'),
    document + 'x'.repeat(65536),
    '---\nname: alias-test\ndescription: &test Alias\nlicense: *test\n---\nbody',
  ])
    assert.throws(() => parseSkillDocument(bad));
});
test('skills persist owner-scoped with explicit enablement, edits, uniqueness and deletion', async (t) => {
  const dir = await mkdtemp(tmpdir() + '/nas-skills-');
  let db = new DatabaseService(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  let repo = new AiSkillRepository(db);
  const skill = repo.save('a', { document, enabled: false });
  assert.equal(repo.catalog('a').length, 0);
  assert.equal(repo.list('b').length, 0);
  assert.throws(() => repo.get('b', skill.id), /不存在/);
  repo.save('a', { document, enabled: true }, skill.id);
  assert.equal(repo.catalog('a')[0].name, 'docker-check');
  assert.throws(() => repo.save('a', { document, enabled: true }), /名称/);
  db.close();
  db = new DatabaseService(dir);
  repo = new AiSkillRepository(db);
  assert.ok(repo.readEnabled('a', 'docker-check').includes('docker ps'));
  assert.throws(() => repo.readEnabled('b', 'docker-check'), /不可用/);
  repo.save('a', { document, enabled: false }, skill.id);
  assert.throws(() => repo.readEnabled('a', 'docker-check'), /不可用/);
  repo.remove('a', skill.id);
  assert.equal(repo.list('a').length, 0);
});

test('AI progressively reads enabled skill bodies and still waits for SSH command approval', async () => {
  const { AiConversationService } = await import('../server/terminal/ai/conversation.js');
  let turns = 0,
    execs = 0,
    reads = 0,
    seen;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        baseUrl: 'http://fixture',
        model: 'test',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({ client: null, state: 'connected', closed: false }),
    skills: {
      catalog: () => [{ name: 'docker-check', description: 'Docker troubleshooting' }],
      readEnabled: () => {
        reads++;
        return 'ONLY BODY: inspect docker ps';
      },
    },
    provider: {
      complete: async (_config, messages) => {
        seen = structuredClone(messages);
        turns++;
        if (turns === 1) {
          assert.ok(messages[0].content.includes('docker-check'));
          assert.equal(messages[0].content.includes('ONLY BODY'), false);
          return {
            content: '',
            toolCalls: [],
            skillCalls: [{ id: 'read1', skillName: 'docker-check' }],
          };
        }
        assert.ok(messages.some((m) => m.role === 'tool' && m.content.includes('ONLY BODY')));
        return {
          content: '检查容器',
          toolCalls: [{ id: 'cmd', command: 'docker ps', explanation: '检查容器' }],
        };
      },
    },
    execute: async () => {
      execs++;
      return { stdout: 'ok', stderr: '', exitCode: 0, status: 'success', truncated: false };
    },
  });
  service.message('a', 'ssh', '按技能检查 Docker');
  for (let i = 0; i < 100 && service.snapshot('a', 'ssh').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  assert.equal(turns, 2);
  assert.equal(reads, 1);
  assert.equal(execs, 0);
  const view = service.snapshot('a', 'ssh');
  assert.equal(view.proposals[0].status, 'pending');
  assert.equal(seen.find((m) => m.role === 'assistant').tool_calls[0].function.name, 'read_skill');
  await service.close();
});

test('restoring a mixed skill and SSH call fills only missing tool results', async () => {
  const { AiConversationService } = await import('../server/terminal/ai/conversation.js');
  let saved, seen;
  const base = {
    settings: {
      privateSettings: () => ({
        baseUrl: 'http://fixture',
        model: 'test',
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
    skills: {
      catalog: () => [{ name: 'docker-check', description: 'Docker' }],
      readEnabled: () => 'instructions',
    },
  };
  const first = new AiConversationService({
    ...base,
    history: {
      get: () => null,
      save: (chat) => {
        saved = structuredClone(chat);
      },
    },
    provider: {
      complete: async () => ({
        content: 'inspect',
        toolCalls: [{ id: 'ssh-call', command: 'pwd', explanation: 'check' }],
        skillCalls: [{ id: 'read-call', skillName: 'docker-check' }],
      }),
    },
  });
  first.message('a', 'ssh', 'check');
  for (let i = 0; i < 100 && first.snapshot('a', 'ssh').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  const interrupted = structuredClone(saved);
  await first.close();
  const next = new AiConversationService({
    ...base,
    history: { get: () => structuredClone(interrupted), save: () => {} },
    provider: {
      complete: async (_config, messages) => {
        seen = structuredClone(messages);
        return { content: 'ok', toolCalls: [] };
      },
    },
  });
  next.restore('a', 'new', interrupted.id);
  next.message('a', 'new', 'continue');
  for (let i = 0; i < 100 && next.snapshot('a', 'new').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  const results = seen.filter((m) => m.role === 'tool');
  assert.equal(results.filter((m) => m.tool_call_id === 'read-call').length, 1);
  assert.equal(results.filter((m) => m.tool_call_id === 'ssh-call').length, 1);
  assert.match(results.find((m) => m.tool_call_id === 'ssh-call').content, /恢复历史/);
  await next.close();
});

for (const protocol of ['openai', 'claude', 'gemini', 'ollama'])
  test(protocol + ' transports skill reads and correctly pairs skill tool results', async (t) => {
    const { AiProvider } = await import('../server/terminal/ai/provider.js');
    const original = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = original;
    });
    const bodies = [];
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      const response =
        protocol === 'claude'
          ? {
              content: [
                {
                  type: 'tool_use',
                  id: 'read1',
                  name: 'read_skill',
                  input: { name: 'docker-check' },
                },
              ],
              stop_reason: 'tool_use',
            }
          : protocol === 'gemini'
            ? {
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: {
                      parts: [
                        {
                          functionCall: {
                            id: 'read1',
                            name: 'read_skill',
                            args: { name: 'docker-check' },
                          },
                        },
                      ],
                    },
                  },
                ],
              }
            : protocol === 'ollama'
              ? {
                  done: true,
                  message: {
                    content: '',
                    tool_calls: [
                      { function: { name: 'read_skill', arguments: { name: 'docker-check' } } },
                    ],
                  },
                }
              : {
                  choices: [
                    {
                      message: {
                        content: '',
                        tool_calls: [
                          {
                            id: 'read1',
                            type: 'function',
                            function: { name: 'read_skill', arguments: '{"name":"docker-check"}' },
                          },
                        ],
                      },
                      finish_reason: 'tool_calls',
                    },
                  ],
                };
      return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const provider = new AiProvider(),
      config = { protocol, baseUrl: 'http://fixture', model: 'test', apiKey: '', updatedAt: 0 },
      messages = [
        { role: 'system', content: 'catalog' },
        { role: 'user', content: 'check' },
      ];
    const turn = await provider.complete(config, messages, {
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal(turn.toolCalls.length, 0);
    assert.equal(turn.skillCalls[0].skillName, 'docker-check');
    const id = turn.skillCalls[0].id;
    messages.push(turn.protocolMessage, { role: 'tool', tool_call_id: id, content: 'skill body' });
    await provider.complete(config, messages, {
      signal: new AbortController().signal,
      onText: () => {},
    });
    const body = bodies.at(-1);
    if (protocol === 'claude') {
      assert.equal(body.tools[1].name, 'read_skill');
      assert.equal(body.messages.at(-1).content[0].tool_use_id, id);
    } else if (protocol === 'gemini') {
      assert.equal(body.tools[0].functionDeclarations[1].name, 'read_skill');
      assert.equal(body.contents.at(-1).parts[0].functionResponse.name, 'read_skill');
    } else if (protocol === 'ollama') {
      assert.equal(body.messages.at(-1).tool_name, 'read_skill');
    } else assert.equal(body.messages.at(-1).tool_call_id, id);
  });

test('skills APIs enforce owner CSRF format and boolean status', async (t) => {
  const { appFixture } = await import('./fixtures/terminal-app.js');
  const f = await appFixture();
  t.after(f.close);
  const added = await f.call('/ai/skills', 'POST', { document, enabled: false });
  assert.equal(added.status, 201);
  const skill = await added.json();
  assert.equal((await (await f.call('/ai/skills')).json()).length, 1);
  assert.equal(
    (await (await f.call('/ai/skills', 'GET', null, { 'x-trim-userid': '1001' })).json()).length,
    0,
  );
  assert.equal(
    (await f.call('/ai/skills/' + skill.id, 'GET', null, { 'x-trim-userid': '1001' })).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        '/ai/skills/' + skill.id + '/enabled',
        'PUT',
        { enabled: true },
        { 'x-deskicons-token': 'bad' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call('/ai/skills/' + skill.id + '/enabled', 'PUT', { enabled: 'yes' })).status,
    400,
  );
  assert.equal(
    (await f.call('/ai/skills/' + skill.id + '/enabled', 'PUT', { enabled: true })).status,
    200,
  );
  assert.equal(
    (await f.call('/ai/skills', 'POST', { document: 'not frontmatter', enabled: false })).status,
    400,
  );
  assert.equal(
    (await f.call('/ai/skills/' + skill.id, 'DELETE', null, { 'x-trim-userid': '1001' })).status,
    404,
  );
  assert.equal((await f.call('/ai/skills/' + skill.id, 'DELETE')).status, 200);
});

test('disabling a skill refreshes catalog and removes old skill instructions from the next user turn', async () => {
  const { AiConversationService } = await import('../server/terminal/ai/conversation.js');
  let enabled = true,
    turns = 0,
    seen;
  const service = new AiConversationService({
    settings: {
      privateSettings: () => ({
        baseUrl: 'http://fixture',
        model: 'test',
        apiKey: '',
        updatedAt: 0,
      }),
    },
    getSession: () => ({ client: null, state: 'connected', closed: false }),
    skills: {
      catalog: () => (enabled ? [{ name: 'docker-check', description: 'Docker' }] : []),
      readEnabled: () => {
        if (!enabled) throw Error();
        return 'PRIVATE SKILL INSTRUCTIONS';
      },
    },
    provider: {
      complete: async (_settings, messages) => {
        seen = structuredClone(messages);
        if (turns++ === 0)
          return {
            content: '',
            toolCalls: [],
            skillCalls: [{ id: 'read1', skillName: 'docker-check' }],
          };
        return { content: 'done', toolCalls: [] };
      },
    },
  });
  service.message('a', 'ssh', 'first');
  for (let i = 0; i < 100 && service.snapshot('a', 'ssh').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  assert.ok(JSON.stringify(seen).includes('PRIVATE SKILL INSTRUCTIONS'));
  enabled = false;
  service.message('a', 'ssh', 'next');
  for (let i = 0; i < 100 && service.snapshot('a', 'ssh').busy; i++)
    await new Promise((r) => setTimeout(r, 2));
  assert.equal(seen[0].content.includes('docker-check'), false);
  assert.equal(JSON.stringify(seen).includes('PRIVATE SKILL INSTRUCTIONS'), false);
  await service.close();
});

test('schema 10 to 11 adds skills without replacing business or attachment records', async (t) => {
  const dir = await mkdtemp(tmpdir() + '/nas-skill-migration-');
  let db = new DatabaseService(dir);
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  db.connection.exec(
    legacyNotificationReset +
      "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; INSERT INTO icons(id,name,url,mode)VALUES('keep01','Keep','http://fixture','url');DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11;DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=10;",
  );
  db.close();
  db = new DatabaseService(dir);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(
    db.connection.prepare('SELECT name FROM icons WHERE id=?').get('keep01').name,
    'Keep',
  );
  assert.equal(new AiSkillRepository(db).list('a').length, 0);
  assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('skill reads preserve explicit silent execution and bounded repeated activation', async () => {
  const { AiConversationService } = await import('../server/terminal/ai/conversation.js');
  for (const repeat of [false, true]) {
    let turns = 0,
      reads = 0,
      execs = 0;
    const service = new AiConversationService({
      settings: {
        privateSettings: () => ({
          baseUrl: 'http://fixture',
          model: 'test',
          apiKey: '',
          updatedAt: 0,
        }),
      },
      getSession: () => ({ client: null, state: 'connected', closed: false }),
      skills: {
        catalog: () => [{ name: 'test-skill', description: 'test' }],
        readEnabled: () => {
          reads++;
          return 'body';
        },
      },
      execute: async () => {
        execs++;
        return { stdout: 'ok', stderr: '', exitCode: 0, status: 'success', truncated: false };
      },
      provider: {
        complete: async () => {
          turns++;
          if (repeat || turns === 1)
            return {
              content: '',
              toolCalls: [],
              skillCalls: [{ id: 'read-' + turns, skillName: 'test-skill' }],
            };
          if (turns === 2)
            return {
              content: 'inspect',
              toolCalls: [{ id: 'cmd', command: 'pwd', explanation: 'check' }],
            };
          return { content: 'done', toolCalls: [] };
        },
      },
    });
    service.message('a', 'ssh', 'use skill', { executionMode: 'silent' });
    for (let i = 0; i < 100 && service.snapshot('a', 'ssh').busy; i++)
      await new Promise((r) => setTimeout(r, 2));
    assert.equal(reads, 1);
    assert.equal(execs, repeat ? 0 : 1);
    assert.equal(turns, repeat ? 11 : 3);
    if (repeat)
      assert.ok(service.snapshot('a', 'ssh').messages.some((m) => m.content.includes('10 次')));
    await service.close();
  }
});

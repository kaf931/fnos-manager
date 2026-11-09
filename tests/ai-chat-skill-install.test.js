import {legacyNotificationSchema} from './fixtures/notification-schema.js';
import {
  rdpSchema,
  vncSchema,
  vncPreferencesSchema,
  retentionSchema,
  vncCursorSchema,
} from '../server/persistence/schema.js';
import { appearanceSchema } from '../server/persistence/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { SkillPackageService } from '../server/terminal/ai/skill-packages/service.js';
import { SkillActions } from '../server/terminal/ai/skill-actions.js';
import { AiSkillRepository } from '../server/persistence/ai-skill.repository.js';
import { prepareAiAttachments } from '../server/terminal/ai/attachments.js';
import { attachmentText } from '../server/terminal/ai/attachment-content.js';
import { AiHistoryRepository } from '../server/persistence/ai-history.repository.js';
import { AiConversationService } from '../server/terminal/ai/conversation.js';
import { parseAiCall, splitAiCalls } from '../server/terminal/ai/tools.js';
import { skillZip, skillDocument } from './fixtures/skill-zip.js';
const wait = async (s) => {
  while (s.snapshot('owner', 'ssh').busy) await new Promise((r) => setTimeout(r, 2));
};
for (const mode of ['review', 'silent'])
  test(`chat ZIP inspection and installation respects ${mode} mode`, async (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chat-skills-'));
    const db = new DatabaseService(dir);
    const packages = new SkillPackageService(db);
    const skills = new AiSkillRepository(db);
    t.after(async () => {
      await s.close();
      packages.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const zip = skillZip([
      ['SKILL.md', skillDocument],
      ['scripts/check.sh', 'echo hi'],
    ]);
    const attachments = await prepareAiAttachments([
      {
        name: 'skill.zip',
        kind: 'archive',
        mimeType: 'application/zip',
        data: zip.toString('base64'),
      },
    ]);
    assert.equal(attachments[0].size, zip.length);
    assert.ok(
      !attachmentText({ role: 'user', content: 'install', attachments }).includes(
        zip.toString('base64'),
      ),
    );
    let turn = 0,
      previewId;
    const session = () => ({ client: null, state: 'connected', closed: false });
    const actions = new SkillActions(packages, session);
    const s = new AiConversationService({
      settings: {
        privateSettings: () => ({
          baseUrl: 'http://fixture',
          model: 'test',
          apiKey: '',
          updatedAt: 0,
        }),
      },
      getSession: session,
      history: new AiHistoryRepository(db),
      skills: {
        catalog: (o) => skills.catalog(o),
        readEnabled: (o, n) => skills.readEnabled(o, n),
      },
      skillActions: actions,
      provider: {
        complete: async (_c, m) => {
          turn++;
          if (turn === 1)
            return {
              content: '',
              ...splitAiCalls([
                parseAiCall('inspect', 'inspect_skill_package', {
                  attachmentId: attachments[0].id,
                }),
              ]),
            };
          if (turn === 2) {
            const tool = m.filter((x) => x.role === 'tool').at(-1);
            const info = JSON.parse(tool.content);
            previewId = info.previewId;
            assert.equal(info.name, 'package-example');
            return {
              content: '安装此技能',
              ...splitAiCalls([
                parseAiCall('install', 'install_skill_package', {
                  previewId,
                  explanation: '安装用户提供的技能',
                }),
              ]),
            };
          }
          assert.ok(m.some((x) => x.role === 'tool' && x.content.includes('"enabled":true')));
          return { content: 'installed', toolCalls: [] };
        },
      },
    });
    s.message('owner', 'ssh', '安装附件技能', { executionMode: mode, attachments });
    await wait(s);
    if (mode === 'review') {
      assert.equal(skills.list('owner').length, 0);
      const p = s.snapshot('owner', 'ssh').proposals[0];
      assert.equal(p.kind, 'install_skill_package');
      assert.match(p.command, /example/);
      s.execute('owner', 'ssh', p.proposalId);
      await wait(s);
    }
    assert.equal(skills.list('owner')[0].enabled, true);
    assert.equal(skills.list('owner')[0].kind, 'package');
    const restored = new AiHistoryRepository(db).get('owner', s.snapshot('owner', 'ssh').chatId);
    assert.equal(
      restored.history.find((m) => m.role === 'user').attachments[0].data,
      zip.toString('base64'),
    );
    assert.equal(restored.proposals[0].kind, 'install_skill_package');
    await assert.rejects(() => packages.commit('other', previewId));
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  });
test('installation parsing rejects forged sources and requires an inspection token', () => {
  assert.throws(() =>
    parseAiCall('x', 'inspect_skill_package', { url: 'http://host/a.zip', attachmentId: 'a' }),
  );
  assert.throws(() =>
    parseAiCall('x', 'install_skill_package', { previewId: '', explanation: 'install' }),
  );
});
test('schema12 attachment migration preserves files and accepts ZIP metadata after reopening', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const {
    schema,
    reachabilitySchema,
    operationSchema,
    notificationSchema,
    backupSchema,
    aiArchiveAttachmentsSchema,
  } = await import('../server/persistence/schema.js');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chat-skills-v12-'));
  const raw = new DatabaseSync(path.join(dir, 'nas-manager.sqlite'));
  raw.exec(
    legacyNotificationSchema(schema)
      .replace(
        /CREATE TABLE text_file_versions[\s\S]*?CREATE INDEX text_file_versions_scope[^;]*;/,
        '',
      )
      .replace(/INSERT INTO schema_migrations VALUES\(18[^;]*;/, '')
      .replace(reachabilitySchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(17[^;]*;/, '')
      .replace(operationSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(16[^;]*;/, '')
      .replace(notificationSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(15[^;]*;/, '')
      .replace(backupSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(14[^;]*;/, '')
      .replace(aiArchiveAttachmentsSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(13[^;]*;/, '')
      .replace(rdpSchema, '')
      .replace(vncSchema, '')
      .replace(vncPreferencesSchema, '')
      .replace(retentionSchema, '')
      .replace(vncCursorSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\((19|20|21|22|23)[^;]*;/g, '')
      .replace(appearanceSchema, '')
      .replace(/CREATE TABLE update_settings[\s\S]*?\) STRICT;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(26[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(25[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(24[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(27[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(28[^;]*;/, '')
        .replace(/CREATE TABLE adb_connections[\s\S]*?CREATE INDEX adb_connections_owner[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(29[^;]*;/, '')
        .replace(/CREATE TABLE IF NOT EXISTS notification_options[\s\S]*?\) STRICT;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(30[^;]*;/, '')
        .replace('PRAGMA user_version=30', 'PRAGMA user_version=12'),
  );
  const history = new AiHistoryRepository({
    connection: raw,
    dataDir: dir,
    transaction: (fn) => fn(),
  });
  const attachments = await prepareAiAttachments([
    { name: 'keep.md', kind: 'text', mimeType: 'text/plain', data: 'keep this' },
  ]);
  const chat = {
    id: 'chat',
    owner: 'owner',
    connectionId: 'host',
    connectionName: 'host',
    title: 'keep',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: 'm',
        role: 'user',
        content: 'keep',
        attachments: attachments.map(({ data, ...s }) => s),
      },
    ],
    proposals: [],
    history: [{ role: 'user', content: 'keep', attachments }],
  };
  history.save(chat);
  raw.close();
  const db = new DatabaseService(dir);
  try {
    const restored = new AiHistoryRepository(db).get('owner', 'chat');
    assert.equal(restored.history[0].attachments[0].data, 'keep this');
    assert.equal(restored.messages[0].attachments[0].name, 'keep.md');
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 32);
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('package inspection refuses attachments outside the current chat and cancellation installs nothing', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chat-skill-isolation-'));
  const db = new DatabaseService(dir);
  const packages = new SkillPackageService(db);
  t.after(() => {
    packages.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const actions = new SkillActions(packages, () => ({
    state: 'connected',
    closed: false,
    client: null,
  }));
  await assert.rejects(
    () =>
      actions.read(
        'a',
        {
          action: 'inspect_skill_package',
          skillName: '',
          id: 'x',
          source: { attachmentId: 'other' },
        },
        'ssh',
        { attachments: [], signal: new AbortController().signal },
      ),
    /当前聊天/,
  );
  const p = await packages.preview(
    'a',
    { zip: skillZip([['SKILL.md', skillDocument]]) },
    new AbortController().signal,
  );
  const result = await actions.execute(
    'a',
    'ssh',
    { kind: 'install_skill_package', previewId: p.previewId },
    AbortSignal.abort(),
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(new AiSkillRepository(db).list('a').length, 0);
  assert.throws(() => actions.bindImport('b', p.previewId));
});

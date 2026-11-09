import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import ssh2 from 'ssh2';
import { sshFixture } from './fixtures/ssh-server.js';
import { skillZip, skillDocument } from './fixtures/skill-zip.js';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiSkillRepository } from '../server/persistence/ai-skill.repository.js';
import { SkillPackageService } from '../server/terminal/ai/skill-packages/service.js';
test('runtime prepares complete immutable package on actual SFTP without executing arbitrary scripts', async (t) => {
  const { prepareSkillRuntime } = await import('../server/terminal/ai/skill-packages/runtime.js');
  const dir = mkdtempSync(tmpdir() + '/skill-runtime-');
  mkdirSync(dir + '/home/tester', { recursive: true });
  const db = new DatabaseService(dir + '/data');
  const service = new SkillPackageService(db),
    p = await service.preview(
      'a',
      {
        zip: skillZip([
          ['SKILL.md', skillDocument],
          ['scripts/check.sh', '#!/bin/sh\necho hello'],
        ]),
      },
      new AbortController().signal,
    ),
    skill = await service.commit('a', p.previewId);
  new AiSkillRepository(db).setEnabled('a', skill.id, true);
  let calls = 0;
  const fixture = await sshFixture({
      sftpRoot: dir,
      execHandler: (_cmd, s) => {
        calls++;
        s.write('/home/tester\nLinux\nx86_64\n');
        s.exit(0);
        s.end();
      },
    }),
    client = new ssh2.Client();
  t.after(async () => {
    client.destroy();
    await fixture.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((r, j) =>
    client.once('ready', r).once('error', j).connect({
      host: '127.0.0.1',
      port: fixture.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  const manifest = service.manifest('a', skill.id),
    session = { client, state: 'connected', closed: false };
  const result = await prepareSkillRuntime(
    session,
    'a',
    manifest,
    service.store,
    new AbortController().signal,
  );
  assert.equal(
    readFileSync(dir + result.root + '/scripts/check.sh', 'utf8'),
    '#!/bin/sh\necho hello',
  );
  assert.equal(calls, 1);
  const again = await prepareSkillRuntime(
    session,
    'a',
    manifest,
    service.store,
    new AbortController().signal,
  );
  assert.equal(again.root, result.root);
  const cancelled = new AbortController(),
    originalSftp = client.sftp.bind(client);
  let ended = false;
  client.sftp = (callback) =>
    originalSftp((error, channel) => {
      const end = channel.end.bind(channel);
      channel.end = () => {
        ended = true;
        return end();
      };
      cancelled.abort();
      callback(error, channel);
    });
  await assert.rejects(
    prepareSkillRuntime(session, 'a', manifest, service.store, cancelled.signal),
  );
  assert.equal(ended, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { SkillPackageService } from '../server/terminal/ai/skill-packages/service.js';
test('official authorization refuses untrusted packages and never accepts cross-owner IDs', async () => {
  const { FnOsSkillAuth } = await import('../server/terminal/ai/skill-packages/fnos-auth.js');
  const dir = mkdtempSync(tmpdir() + '/skill-auth-'),
    db = new DatabaseService(dir);
  try {
    const auth = new FnOsSkillAuth(new SkillPackageService(db), () => ({
      client: null,
      state: 'connected',
      closed: false,
      connection: { id: 'conn' },
    }));
    await assert.rejects(auth.begin('a', 'ssh', { skillId: 'missing' }, 'http://nas:5666', true));
    assert.throws(() => auth.status('b', 'ssh', 'missing'));
    auth.close();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same-host OAuth persists profile and retries verification without exchanging code twice', async (t) => {
  const { FnOsSkillAuth } = await import('../server/terminal/ai/skill-packages/fnos-auth.js');
  const { skillZip, skillDocument } = await import('./fixtures/skill-zip.js');
  const { AiSkillRepository } = await import('../server/persistence/ai-skill.repository.js');
  const { sshFixture } = await import('./fixtures/ssh-server.js');
  const { default: ssh2 } = await import('ssh2');
  const { mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(tmpdir() + '/skill-oauth-');
  mkdirSync(dir + '/home/tester', { recursive: true });
  const db = new DatabaseService(dir + '/data'),
    packages = new SkillPackageService(db);
  const p = await packages.preview(
    'owner',
    {
      zip: skillZip([
        ['SKILL.md', skillDocument],
        ['scripts/fnos-cli', '#!/bin/sh\nexit 0'],
      ]),
    },
    new AbortController().signal,
  );
  const skill = await packages.commit('owner', p.previewId);
  new AiSkillRepository(db).setEnabled('owner', skill.id, true);
  db.connection.prepare('UPDATE ai_skill_packages SET official=1 WHERE id=?').run(skill.packageId);
  let exchanges = 0,
    probes = 0;
  const cmds = [];
  const fixture = await sshFixture({
    sftpRoot: dir,
    execHandler: (cmd, s) => {
      cmds.push(cmd);
      if (cmd.includes('uname -s')) s.write('/home/tester\nLinux\nx86_64\n');
      else if (cmd.includes('authorize-only'))
        s.write(JSON.stringify({ authorization_url: 'http://nas:5666/oauth?code_challenge=x' }));
      else if (cmd.includes("'--code'")) {
        exchanges++;
        s.write(JSON.stringify({ token_persisted: true, refresh_token_persisted: true }));
      } else if (cmd.includes("'system' 'info'")) {
        probes++;
        if (probes === 1) {
          s.exit(1);
          s.end();
          return;
        }
        s.write('{}');
      } else s.write('fnos-cli 0.5.1');
      s.exit(0);
      s.end();
    },
  });
  const client = new ssh2.Client();
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
  const auth = new FnOsSkillAuth(packages, () => ({
    client,
    state: 'connected',
    closed: false,
    connection: { id: 'conn' },
  }));
  const start = await auth.begin(
    'owner',
    'ssh',
    packages.manifest('owner', skill.id).ref,
    'http://nas:5666',
    true,
  );
  assert.ok(start.url.includes('code_challenge'));
  await assert.rejects(
    auth.exchange('owner', 'ssh', start.authorizationId, "secret'code"),
    /验证失败/,
  );
  const resumed = await auth.begin(
    'owner',
    'ssh',
    packages.manifest('owner', skill.id).ref,
    'http://nas:5666',
    true,
  );
  assert.equal(resumed.authorizationId, start.authorizationId);
  assert.equal(resumed.tokenSaved, true);
  assert.equal(cmds.filter((c) => c.includes('authorize-only')).length, 1);
  assert.deepEqual(await auth.exchange('owner', 'ssh', start.authorizationId, ''), {
    connected: true,
  });
  assert.equal(exchanges, 1);
  assert.equal(probes, 2);
  assert.equal(
    JSON.stringify(auth.status('owner', 'ssh', start.authorizationId)).includes('secret'),
    false,
  );
  assert.ok(
    cmds.filter((c) => c.includes('FNOS_CLI_CONFIG_DIR')).every((c) => c.includes('--profile')),
  );
  await auth.close();
});

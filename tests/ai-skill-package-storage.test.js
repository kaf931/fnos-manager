import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { skillZip, skillDocument } from './fixtures/skill-zip.js';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiSkillRepository } from '../server/persistence/ai-skill.repository.js';
test('package preview commits disabled, isolates owners, preserves original resources and rejects stale replacement', async () => {
  const { SkillPackageService } = await import('../server/terminal/ai/skill-packages/service.js');
  const dir = mkdtempSync(tmpdir() + '/skill-storage-'),
    db = new DatabaseService(dir);
  try {
    const service = new SkillPackageService(db),
      zip = skillZip([
        ['test/SKILL.md', skillDocument],
        ['test/reference/info.md', '中文 '.repeat(30000)],
      ]);
    const preview = await service.preview('a', { zip }, new AbortController().signal);
    await assert.rejects(service.commit('b', preview.previewId));
    const item = await service.commit('a', preview.previewId);
    assert.equal(item.kind, 'package');
    assert.equal(item.enabled, false);
    const repo = new AiSkillRepository(db);
    repo.setEnabled('a', item.id, true);
    const ref = service.manifest('a', item.id).ref;
    assert.throws(() => service.manifest('b', item.id));
    const page = await service.read('a', ref, 'reference/info.md', 0);
    assert.ok(page.nextOffset > 0);
    assert.ok(Buffer.byteLength(page.text) <= 65536);
    assert.ok(!page.text.includes('�'));
    await assert.rejects(service.read('a', ref, '../nas-manager.sqlite', 0));
    const replacement = await service.preview('a', { zip }, new AbortController().signal);
    await service.commit('a', replacement.previewId, { skillId: item.id, expectedRevision: 1 });
    await assert.rejects(service.read('a', ref, 'reference/info.md', 0));
    const stale = await service.preview('a', { zip }, new AbortController().signal);
    await assert.rejects(
      service.commit('a', stale.previewId, { skillId: item.id, expectedRevision: 1 }),
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('post-commit cleanup failure cannot remove the newly published package', async () => {
  const { SkillPackageService } = await import('../server/terminal/ai/skill-packages/service.js');
  const dir = mkdtempSync(tmpdir() + '/skill-commit-'),
    db = new DatabaseService(dir);
  try {
    const s = new SkillPackageService(db),
      p = await s.preview(
        'a',
        { zip: skillZip([['SKILL.md', skillDocument]]) },
        new AbortController().signal,
      );
    s.sweep = () => {
      throw Error('cleanup unavailable');
    };
    const item = await s.commit('a', p.previewId);
    new AiSkillRepository(db).setEnabled('a', item.id, true);
    assert.ok(
      (await s.read('a', s.manifest('a', item.id).ref, 'SKILL.md', 0)).text.includes(
        'Complete package',
      ),
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('uploaded original official ZIP is recognized by pinned digest, independent of download entry', async () => {
  const { SkillPackageService } = await import('../server/terminal/ai/skill-packages/service.js');
  const { readFileSync } = await import('node:fs');
  const dir = mkdtempSync(tmpdir() + '/skill-official-'),
    db = new DatabaseService(dir);
  try {
    const s = new SkillPackageService(db),
      p = await s.preview(
        'a',
        { zip: readFileSync(new URL('./fixtures/fnos-skill-0.5.1.zip', import.meta.url)) },
        new AbortController().signal,
      );
    assert.equal(p.official, true);
    assert.equal(p.name, 'fnos-cli');
    assert.ok(p.fileCount > 30);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('closing package service cancels in-flight preview and rejects future imports', async () => {
  const { SkillPackageService } = await import('../server/terminal/ai/skill-packages/service.js');
  const dir = mkdtempSync(tmpdir() + '/skill-close-'),
    db = new DatabaseService(dir);
  try {
    const s = new SkillPackageService(db),
      input = { zip: skillZip([['SKILL.md', skillDocument]]) };
    const pending = s.preview('a', input, new AbortController().signal);
    s.close();
    await assert.rejects(pending);
    await assert.rejects(s.preview('a', input, new AbortController().signal));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

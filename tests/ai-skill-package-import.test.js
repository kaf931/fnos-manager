import test from 'node:test';
import assert from 'node:assert/strict';
import { skillZip, skillDocument } from './fixtures/skill-zip.js';
test('complete ZIP preserves scripts and refuses unsafe/ambiguous/oversized members', async () => {
  const { readSkillArchive } = await import('../server/terminal/ai/skill-packages/archive.js');
  const script = '#!/bin/sh\nprintf "hello"\n';
  const result = await readSkillArchive(
    skillZip([
      ['fnos/SKILL.md', skillDocument],
      ['fnos/scripts/check.sh', script],
    ]),
    new AbortController().signal,
  );
  assert.equal(result.files.find((x) => x.path === 'scripts/check.sh').bytes.toString(), script);
  assert.equal(result.definition.name, 'package-example');
  for (const extra of [
    [['fnos/../bad', 'x']],
    [['fnos/ref', 'x', 0o120777]],
    [['second/SKILL.md', skillDocument]],
    [
      ['fnos/scripts/x', 'x'],
      ['fnos/scripts/x', 'y'],
    ],
    [['fnos/huge', 'x'.repeat(4194305)]],
  ])
    await assert.rejects(
      readSkillArchive(
        skillZip([['fnos/SKILL.md', skillDocument], ...extra]),
        new AbortController().signal,
      ),
    );
});
test('skill download rejects private and mapped-private addresses before connecting', async () => {
  const { downloadSkillZip } = await import('../server/terminal/ai/skill-packages/download.js');
  for (const url of [
    'http://example.com/a.zip',
    'https://127.0.0.1/a.zip',
    'https://[::ffff:127.0.0.1]/a.zip',
    'https://169.254.169.254/a.zip',
    'https://user:password@example.com/a.zip',
  ])
    await assert.rejects(downloadSkillZip(url, new AbortController().signal));
});
test('ZIP enforces entry limits, CRC integrity and compressed input bounds', async () => {
  const { readSkillArchive } = await import('../server/terminal/ai/skill-packages/archive.js');
  const signal = new AbortController().signal;
  const zip = skillZip([['SKILL.md', skillDocument]]);
  zip[30 + 8] ^= 1;
  await assert.rejects(readSkillArchive(zip, signal));
  await assert.rejects(readSkillArchive(Buffer.alloc(10485761), signal));
  await assert.rejects(
    readSkillArchive(
      skillZip([
        ['SKILL.md', skillDocument],
        ...Array.from({ length: 512 }, (_, i) => ['files/' + i, 'x']),
      ]),
      signal,
    ),
  );
});

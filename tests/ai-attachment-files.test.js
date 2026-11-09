import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function reader() {
  const result = await build({
    entryPoints: ['web/ai-attachments.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}
test('file selection reads UTF-8 text and image bytes but rejects binary, oversize and too many files', async () => {
  const { readAiFiles } = await reader();
  const files = await readAiFiles([
    new File(['日志内容'], 'debug.log', { type: 'text/plain' }),
    new File([Uint8Array.of(1, 2, 3)], 'screen.png', { type: 'image/png' }),
  ]);
  assert.equal(files[0].data, '日志内容');
  assert.equal(files[1].data, 'AQID');
  assert.notEqual(files[0].id, files[1].id);
  await assert.rejects(readAiFiles([new File(['bad'], 'program.exe')]));
  await assert.rejects(readAiFiles([new File([Uint8Array.of(255, 0)], 'binary.txt')]));
  await assert.rejects(readAiFiles([new File(['a'.repeat(262145)], 'big.log')]));
  await assert.rejects(readAiFiles(Array.from({ length: 5 }, () => new File(['x'], 'a.txt'))));
});

test('attachment draft IDs work on NAS HTTP origins without crypto.randomUUID', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  const { readAiFiles } = await reader();
  const first = await readAiFiles([new File(['text'], 'test.txt')]);
  const second = await readAiFiles([
    new File([Uint8Array.of(1, 2, 3)], 'screen.png', { type: 'image/png' }),
  ]);
  assert.ok(first[0].id);
  assert.notEqual(first[0].id, second[0].id);
});

test('chat file picker reads ZIP as an archive without converting binary into text', async () => {
  const { readAiFiles } = await reader();
  const files = await readAiFiles([
    new File([Uint8Array.of(80, 75, 3, 4)], 'skill.zip', { type: 'application/octet-stream' }),
  ]);
  assert.equal(files[0].kind, 'archive');
  assert.equal(files[0].mimeType, 'application/zip');
  assert.equal(files[0].data, 'UEsDBA==');
  await assert.rejects(readAiFiles([new File([new Uint8Array(4194305)], 'big.zip')]));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, encodeText, MAX_TEXT_BYTES } from '../server/terminal/text-codec.js';
test('text editor preserves supported encodings and BOM', () => {
  for (const encoding of ['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'gbk', 'gb18030']) {
    const content = '中文配置\r\nhello\n';
    const data = encodeText(content, encoding, encoding.startsWith('utf16'));
    const result = decodeText(data, encoding);
    assert.equal(result.content, content);
    assert.deepEqual(encodeText(result.content, result.encoding, result.bom), data);
  }
});
test('text editor rejects binary, oversized, invalid UTF8 and lossy encoding', () => {
  assert.throws(() => decodeText(Buffer.from([0, 1, 2])), /文本/);
  assert.throws(() => decodeText(Buffer.from([255, 254, 0])), /编码/);
  assert.throws(() => decodeText(Buffer.alloc(MAX_TEXT_BYTES + 1)), /10 MiB/);
  assert.throws(() => encodeText('🐱', 'gbk'), /编码/);
});

import iconv from 'iconv-lite';
import { fail } from './model.js';
export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const TEXT_ENCODINGS = ['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'gbk', 'gb18030'] as const;
export type TextEncoding = (typeof TEXT_ENCODINGS)[number];
export function textEncoding(value: unknown): TextEncoding {
  if (!TEXT_ENCODINGS.includes(value as TextEncoding)) throw fail('不支持的文本编码');
  return value as TextEncoding;
}
function assertText(text: string) {
  if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) throw fail('此文件不是可编辑的文本，请下载处理');
}
export function encodeText(text: string, encoding: TextEncoding, bom = false) {
  assertText(text);
  const codec = encoding === 'utf8-bom' ? 'utf8' : encoding;
  const data = iconv.encode(text, codec, { addBOM: bom || encoding === 'utf8-bom' });
  if (data.length > MAX_TEXT_BYTES) throw fail('在线编辑文件不能超过 10 MiB', 413);
  if (iconv.decode(data, codec) !== text) throw fail('当前编码无法保存部分字符，请更换编码');
  return data;
}
export function decodeText(data: Buffer, requested?: unknown) {
  if (data.length > MAX_TEXT_BYTES) throw fail('在线编辑文件不能超过 10 MiB', 413);
  const detected = data.subarray(0, 3).equals(Buffer.from([239, 187, 191]))
    ? 'utf8-bom'
    : data.subarray(0, 2).equals(Buffer.from([255, 254]))
      ? 'utf16le'
      : data.subarray(0, 2).equals(Buffer.from([254, 255]))
        ? 'utf16be'
        : 'utf8';
  const encoding: TextEncoding =
    requested && requested !== 'auto' ? textEncoding(requested) : detected;
  const bom =
    encoding === 'utf8-bom' ||
    ((encoding === 'utf16le' || encoding === 'utf16be') && detected === encoding);
  const codec = encoding === 'utf8-bom' ? 'utf8' : encoding;
  const content = iconv.decode(data, codec);
  assertText(content);
  const encoded = iconv.encode(content, codec, { addBOM: bom });
  if (!encoded.equals(data)) throw fail('无法按当前编码读取，请选择正确的编码后重新读取');
  return { content, encoding, bom };
}

import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { inputRecord } from '../../errors.js';
import { fail } from '../model.js';
import {
  AI_ATTACHMENT_LIMITS as limits,
  AI_IMAGE_TYPES,
  isAiTextFile,
  type AiAttachment,
} from '../../domain/ai-attachments.js';

export async function prepareAiAttachments(value: unknown): Promise<AiAttachment[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limits.count) throw fail('最多添加 4 个附件');
  const result: AiAttachment[] = [];
  let total = 0;
  for (const item of value) {
    const raw = inputRecord(item);
    if (
      Object.keys(raw).some((key) => !['name', 'kind', 'mimeType', 'data'].includes(key)) ||
      typeof raw.name !== 'string' ||
      !raw.name.trim() ||
      raw.name.length > 180 ||
      /[\\/\x00-\x1f\x7f]/.test(raw.name) ||
      typeof raw.data !== 'string' ||
      !raw.data.length ||
      typeof raw.mimeType !== 'string'
    )
      throw fail('附件名称或内容无效');
    let bytes: Buffer;
    if (raw.kind === 'text') {
      bytes = Buffer.from(raw.data, 'utf8');
      if (!isAiTextFile(raw.name) || raw.mimeType !== 'text/plain' || raw.data.includes('\0'))
        throw fail('请选择文本、代码或日志文件');
      if (bytes.length > limits.text) throw fail('单个文本附件不能超过 256 KiB');
    } else if (raw.kind === 'image') {
      if (
        !(AI_IMAGE_TYPES as readonly string[]).includes(raw.mimeType) ||
        raw.data.length > Math.ceil(limits.image / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data)
      )
        throw fail('请选择不超过 2 MiB 的 PNG、JPEG 或 WebP 图片');
      bytes = Buffer.from(raw.data, 'base64');
      if (bytes.length > limits.image || bytes.toString('base64') !== raw.data)
        throw fail('图片编码或大小无效');
      try {
        const meta = await sharp(bytes, { limitInputPixels: 20000000 }).metadata();
        const mime =
          meta.format === 'png'
            ? 'image/png'
            : meta.format === 'jpeg'
              ? 'image/jpeg'
              : meta.format === 'webp'
                ? 'image/webp'
                : '';
        if (
          !mime ||
          mime !== raw.mimeType ||
          !meta.width ||
          !meta.height ||
          meta.width * meta.height > 20000000 ||
          (meta.pages || 1) > 1
        )
          throw Error();
      } catch {
        throw fail('图片格式无效或尺寸过大，请使用静态 PNG、JPEG 或 WebP 图片');
      }
    } else if (raw.kind === 'archive') {
      if (
        !/\.zip$/i.test(raw.name) ||
        raw.mimeType !== 'application/zip' ||
        raw.data.length > Math.ceil(limits.archive / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data)
      )
        throw fail('请选择不超过 4 MiB 的 ZIP 技能包');
      bytes = Buffer.from(raw.data, 'base64');
      if (
        bytes.length < 4 ||
        bytes.length > limits.archive ||
        bytes.toString('base64') !== raw.data ||
        bytes.readUInt16LE(0) !== 0x4b50
      )
        throw fail('ZIP 编码或格式无效');
    } else throw fail('附件类型无效');
    total += bytes.length;
    if (total > limits.total) throw fail('附件总大小不能超过 4 MiB');
    result.push({
      id: randomUUID(),
      name: raw.name,
      kind: raw.kind,
      mimeType: raw.mimeType,
      data: raw.data,
      size: bytes.length,
    });
  }
  return result;
}

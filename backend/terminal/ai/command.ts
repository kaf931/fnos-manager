import { fail } from '../model.js';
export function validateAiCommand(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value) > 16384 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)
  )
    throw fail('AI 命令格式无效或超过 16 KiB', 502);
  return value;
}

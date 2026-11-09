import type { AiProtocol } from './ai.js';
export const AI_ATTACHMENT_LIMITS = {
  count: 4,
  text: 262144,
  image: 2097152,
  archive: 4194304,
  total: 4194304,
  history: 16777216,
} as const;
export const AI_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export interface AiAttachmentInput {
  name: string;
  kind: 'text' | 'image' | 'archive';
  mimeType: string;
  data: string;
}
export interface AiAttachmentSummary {
  removed?: boolean;
  id: string;
  name: string;
  kind: 'text' | 'image' | 'archive';
  mimeType: string;
  size: number;
}
export interface AiAttachment extends AiAttachmentInput, AiAttachmentSummary {}
export function isAiTextFile(name: string): boolean {
  return (
    /\.(txt|md|markdown|log|sh|bash|zsh|ps1|bat|cmd|json|jsonl|yaml|yml|toml|ini|conf|cfg|env|csv|tsv|xml|html|css|js|mjs|cjs|ts|tsx|jsx|py|go|rs|c|cpp|h|java|sql)$/i.test(
      name,
    ) || /^(Dockerfile|Makefile|\.env(?:\.[\w-]+)?|\.gitignore)$/i.test(name)
  );
}
export function imageInputError(protocol: AiProtocol | undefined, model: string): string {
  if (protocol === 'deepseek')
    return '当前 DeepSeek 协议仅支持文本附件，请切换支持图片的供应商和模型';
  if (protocol === 'minimax' && /^minimax-m2(?:[.\-]|$)/i.test(model))
    return 'MiniMax M2 系列不支持直接输入图片，请切换支持图片的模型';
  return '';
}

export interface AiAttachmentListItem extends AiAttachmentSummary {
  chatId: string;
  chatTitle: string;
  createdAt: number;
  inUse?: boolean;
}
export interface AiAttachmentQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  kind?: 'all' | 'text' | 'image' | 'archive';
  olderThanDays?: number;
}
export interface AiAttachmentPage {
  items: AiAttachmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: { count: number; bytes: number };
}
export interface AiAttachmentCleanup {
  count: number;
  bytes: number;
  cleanupPending: boolean;
}

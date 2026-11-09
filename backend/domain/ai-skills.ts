export const AI_SKILL_LIMITS = { count: 50, document: 65536, frontmatter: 8192 } as const;
export interface AiSkillInput {
  document: string;
  enabled: boolean;
}
export interface AiSkillCatalogEntry {
  name: string;
  description: string;
}
export interface AiSkillSummary extends AiSkillCatalogEntry {
  id: string;
  kind: 'document' | 'package';
  revision: number;
  packageId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface AiSkillDefinition extends AiSkillCatalogEntry {
  instructions: string;
  license?: string;
  compatibility?: string;
  metadata: Record<string, string>;
  allowedTools?: string;
}
export interface AiSkill extends AiSkillSummary, AiSkillDefinition {
  document: string;
}
export interface AiSkillCall {
  action?: 'read_skill' | 'list_skill_resources' | 'read_skill_resource' | 'inspect_skill_package';
  source?: { attachmentId?: string; url?: string; official?: true };
  revision?: number;
  path?: string;
  offset?: number;
  id: string;
  skillName: string;
}

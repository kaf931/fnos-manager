import type { AiSkillDefinition } from './ai-skills.js';
export const SKILL_PACKAGE_LIMITS = {
  zip: 10 * 1024 * 1024,
  entries: 512,
  total: 32 * 1024 * 1024,
  file: 4 * 1024 * 1024,
  page: 65536,
  round: 262144,
} as const;
export const OFFICIAL_SKILL = {
  url: 'https://github.com/fnnas-labs/fnos-cli-skill/releases/download/v0.5.1/fnos-skill.zip',
  sha256: '318038b6e50599297dc83dc23550cc405a31dd3c062c7037c90b98383170cb2a',
  version: '0.5.1',
} as const;
export interface SkillPackageRef {
  skillId: string;
  packageId: string;
  revision: number;
  sha256: string;
}
export interface SkillPackageFile {
  path: string;
  size: number;
  sha256: string;
  text: boolean;
}
export interface SkillPackageManifest {
  ref: SkillPackageRef;
  files: SkillPackageFile[];
  sourceUrl?: string;
  official: boolean;
}
export interface SkillArchive {
  definition: AiSkillDefinition;
  files: Array<SkillPackageFile & { bytes: Buffer }>;
  sha256: string;
}
export interface SkillResourcePage {
  text: string;
  nextOffset: number | null;
  totalBytes: number;
}

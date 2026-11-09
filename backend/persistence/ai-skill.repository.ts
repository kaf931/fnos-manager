import { randomUUID } from 'node:crypto';
import {
  AI_SKILL_LIMITS,
  type AiSkill,
  type AiSkillInput,
  type AiSkillSummary,
  type AiSkillDefinition,
} from '../domain/ai-skills.js';
import { DomainError, errorInfo } from '../errors.js';
import { parseSkillDocument, formatSkillDocument } from '../terminal/ai/skills.js';
import type { DatabaseService } from './database.service.js';
import { text, integer, optionalText, type RecordValue } from './records.js';
const summary = (r: RecordValue): AiSkillSummary => ({
  id: text(r.id),
  kind: r.kind === 'package' ? 'package' : 'document',
  revision: integer(r.revision),
  packageId: optionalText(r.package_id) ?? undefined,
  name: text(r.name),
  description: text(r.description),
  enabled: !!r.enabled,
  createdAt: integer(r.created_at),
  updatedAt: integer(r.updated_at),
});
export class AiSkillRepository {
  constructor(private readonly database: DatabaseService) {}
  list(owner: string): AiSkillSummary[] {
    return this.database.connection
      .prepare('SELECT * FROM ai_skills WHERE owner_uid=? ORDER BY name,id')
      .all(owner)
      .map(summary);
  }
  catalog(owner: string) {
    return this.database.connection
      .prepare(
        'SELECT name,description FROM ai_skills WHERE owner_uid=? AND enabled=1 ORDER BY name,id',
      )
      .all(owner)
      .map((r) => ({ name: text(r.name), description: text(r.description) }));
  }
  get(owner: string, id: string): AiSkill {
    const row = this.database.connection
      .prepare('SELECT * FROM ai_skills WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!row) throw new DomainError('技能不存在', 404);
    const definition: AiSkillDefinition = {
      name: text(row.name),
      description: text(row.description),
      instructions: text(row.instructions),
      metadata: JSON.parse(text(row.metadata)),
      license: optionalText(row.license) ?? undefined,
      compatibility: optionalText(row.compatibility) ?? undefined,
      allowedTools: optionalText(row.allowed_tools) ?? undefined,
    };
    return { ...summary(row), ...definition, document: formatSkillDocument(definition) };
  }
  save(owner: string, input: AiSkillInput, id?: string): AiSkill {
    const skill = parseSkillDocument(input.document);
    if (Buffer.byteLength(formatSkillDocument(skill)) > AI_SKILL_LIMITS.document)
      throw new DomainError('规范化后的 SKILL.md 不能超过 64 KiB');
    if (typeof input.enabled !== 'boolean') throw new DomainError('启用状态无效');
    const key = id || randomUUID(),
      now = Date.now();
    try {
      this.database.transaction(() => {
        if (id && this.get(owner, id).kind === 'package')
          throw new DomainError('包技能请使用重新导入替换', 409);
        else if (this.list(owner).length >= AI_SKILL_LIMITS.count)
          throw new DomainError('每个账号最多保存 50 个技能');
        this.database.connection
          .prepare(
            `INSERT INTO ai_skills(id,owner_uid,name,description,instructions,license,compatibility,metadata,allowed_tools,enabled,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id)DO UPDATE SET name=excluded.name,description=excluded.description,instructions=excluded.instructions,license=excluded.license,compatibility=excluded.compatibility,metadata=excluded.metadata,allowed_tools=excluded.allowed_tools,enabled=excluded.enabled,revision=ai_skills.revision+1,updated_at=excluded.updated_at WHERE ai_skills.owner_uid=excluded.owner_uid`,
          )
          .run(
            key,
            owner,
            skill.name,
            skill.description,
            skill.instructions,
            skill.license ?? null,
            skill.compatibility ?? null,
            JSON.stringify(skill.metadata),
            skill.allowedTools ?? null,
            Number(input.enabled),
            now,
            now,
          );
      });
    } catch (e) {
      if (
        errorInfo(e).message.includes(
          'UNIQUE constraint failed: ai_skills.owner_uid, ai_skills.name',
        )
      )
        throw new DomainError('技能名称已存在', 409);
      throw e;
    }
    return this.get(owner, key);
  }
  setEnabled(owner: string, id: string, enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new DomainError('启用状态无效');
    this.get(owner, id);
    this.database.connection
      .prepare('UPDATE ai_skills SET enabled=?,updated_at=? WHERE owner_uid=? AND id=?')
      .run(Number(enabled), Date.now(), owner, id);
    return this.get(owner, id);
  }
  remove(owner: string, id: string) {
    this.get(owner, id);
    this.database.connection
      .prepare('DELETE FROM ai_skills WHERE owner_uid=? AND id=?')
      .run(owner, id);
    return { deleted: true };
  }
  readEnabled(owner: string, name: string) {
    const row = this.database.connection
      .prepare('SELECT id FROM ai_skills WHERE owner_uid=? AND name=? AND enabled=1')
      .get(owner, name);
    if (!row) throw new DomainError('技能不可用，请确认已启用', 404);
    return this.get(owner, text(row.id)).document;
  }
}

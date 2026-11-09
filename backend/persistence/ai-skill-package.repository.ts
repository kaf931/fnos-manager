import { randomUUID } from 'node:crypto';
import type { DatabaseService } from './database.service.js';
import { AiSkillRepository } from './ai-skill.repository.js';
import type { SkillPackageManifest, SkillArchive } from '../domain/ai-skill-packages.js';
import { DomainError } from '../errors.js';
export class AiSkillPackageRepository {
  constructor(readonly database: DatabaseService) {}
  manifest(owner: string, id: string): SkillPackageManifest {
    const skill = new AiSkillRepository(this.database).get(owner, id);
    if (skill.kind !== 'package' || !skill.packageId)
      throw new DomainError('该技能没有资源包', 404);
    const p = this.database.connection
      .prepare(
        'SELECT * FROM ai_skill_packages WHERE id=? AND owner_uid=? AND skill_id=? AND revision=?',
      )
      .get(skill.packageId, owner, id, skill.revision);
    if (!p) throw new DomainError('技能包不可用', 404);
    return {
      ref: {
        skillId: id,
        packageId: skill.packageId,
        revision: skill.revision,
        sha256: String(p.sha256),
      },
      official: !!p.official,
      sourceUrl: p.source_url ? String(p.source_url) : undefined,
      files: this.database.connection
        .prepare(
          'SELECT path,size,sha256,text FROM ai_skill_package_files WHERE package_id=? ORDER BY path',
        )
        .all(skill.packageId)
        .map((f) => ({
          path: String(f.path),
          size: Number(f.size),
          sha256: String(f.sha256),
          text: !!f.text,
        })),
    };
  }
  publish(
    owner: string,
    archive: SkillArchive,
    packageId: string,
    sourceUrl: string | undefined,
    official: boolean,
    replacement?: { skillId: string; expectedRevision: number },
  ) {
    const repo = new AiSkillRepository(this.database);
    let id = replacement?.skillId || randomUUID();
    this.database.transaction(() => {
      if (replacement) {
        const old = repo.get(owner, id);
        if (old.revision !== replacement.expectedRevision)
          throw new DomainError('技能已变更，请重新加载', 409);
      } else {
        id = repo.save(owner, {
          document:
            '---\nname: ' +
            archive.definition.name +
            '\ndescription: ' +
            JSON.stringify(archive.definition.description) +
            '\n---\n' +
            archive.definition.instructions,
          enabled: false,
        }).id;
      }
      const revision = replacement ? replacement.expectedRevision + 1 : 1,
        d = archive.definition;
      this.database.connection
        .prepare(
          'INSERT INTO ai_skill_packages(id,owner_uid,skill_id,revision,sha256,source_url,official,created_at)VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          packageId,
          owner,
          id,
          revision,
          archive.sha256,
          sourceUrl ?? null,
          Number(official),
          Date.now(),
        );
      const insert = this.database.connection.prepare(
        'INSERT INTO ai_skill_package_files(package_id,path,size,sha256,text)VALUES(?,?,?,?,?)',
      );
      for (const f of archive.files)
        insert.run(packageId, f.path, f.size, f.sha256, Number(f.text));
      this.database.connection
        .prepare(
          "UPDATE ai_skills SET name=?,description=?,instructions=?,license=?,compatibility=?,metadata=?,allowed_tools=?,kind='package',package_id=?,revision=?,enabled=0,updated_at=? WHERE owner_uid=? AND id=?",
        )
        .run(
          d.name,
          d.description,
          d.instructions,
          d.license ?? null,
          d.compatibility ?? null,
          JSON.stringify(d.metadata),
          d.allowedTools ?? null,
          packageId,
          revision,
          Date.now(),
          owner,
          id,
        );
    });
    return repo.get(owner, id);
  }
}

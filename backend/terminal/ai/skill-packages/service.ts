import { randomUUID } from 'node:crypto';
import type { DatabaseService } from '../../../persistence/database.service.js';
import { AiSkillRepository } from '../../../persistence/ai-skill.repository.js';
import { AiSkillPackageRepository } from '../../../persistence/ai-skill-package.repository.js';
import {
  OFFICIAL_SKILL,
  SKILL_PACKAGE_LIMITS as L,
  type SkillArchive,
  type SkillPackageRef,
  type SkillResourcePage,
} from '../../../domain/ai-skill-packages.js';
import { DomainError } from '../../../errors.js';
import { readSkillArchive, skillResourcePath } from './archive.js';
import { downloadSkillZip } from './download.js';
import { SkillPackageStore } from './store.js';
interface Preview {
  owner: string;
  expires: number;
  archive: SkillArchive;
  sourceUrl?: string;
  official: boolean;
}
export class SkillPackageService {
  readonly store: SkillPackageStore;
  readonly repository: AiSkillPackageRepository;
  private previews = new Map<string, Preview>();
  private imports = new Set<string>();
  private lifetime = new AbortController();
  constructor(readonly database: DatabaseService) {
    this.store = new SkillPackageStore(database.dataDir);
    this.repository = new AiSkillPackageRepository(database);
    this.sweep();
  }
  sweep() {
    const live = new Set(
      this.database.connection
        .prepare('SELECT package_id FROM ai_skills WHERE package_id IS NOT NULL')
        .all()
        .map((p) => String(p.package_id)),
    );
    this.store.sweep(live);
    this.database.connection
      .prepare(
        'DELETE FROM ai_skill_packages WHERE id NOT IN(SELECT package_id FROM ai_skills WHERE package_id IS NOT NULL) AND id NOT IN(SELECT package_id FROM ai_skill_authorizations)',
      )
      .run();
  }
  async preview(
    owner: string,
    input: { zip?: Buffer; url?: string; official?: true },
    signal: AbortSignal,
  ) {
    signal = AbortSignal.any([signal, this.lifetime.signal]);
    signal.throwIfAborted();
    if (this.imports.has(owner)) throw new DomainError('已有技能正在导入', 409);
    this.imports.add(owner);
    try {
      for (const [id, p] of this.previews) if (p.expires < Date.now()) this.previews.delete(id);
      if ([...this.previews.values()].filter((p) => p.owner === owner).length >= 8)
        throw new DomainError('待处理技能包过多，请先处理已有安装提案', 429);
      const sourceUrl = input.official ? OFFICIAL_SKILL.url : input.url;
      if (Number(!!input.zip) + Number(!!sourceUrl) !== 1)
        throw new DomainError('请选择 ZIP 或下载地址');
      const archive = await readSkillArchive(
        input.zip || (await downloadSkillZip(sourceUrl!, signal)),
        signal,
      );
      signal.throwIfAborted();
      const official = archive.sha256 === OFFICIAL_SKILL.sha256;
      if (input.official && !official) throw new DomainError('官方技能包摘要不匹配');
      const held = [...this.previews.values()].reduce(
        (n, p) => n + p.archive.files.reduce((m, f) => m + f.size, 0),
        0,
      );
      if (held + archive.files.reduce((n, f) => n + f.size, 0) > 64 * 1024 * 1024)
        throw new DomainError('待确认的技能包过多，请稍后重试', 429);
      const previewId = randomUUID();
      this.previews.set(previewId, {
        owner,
        expires: Date.now() + 600000,
        archive,
        sourceUrl,
        official,
      });
      return {
        previewId,
        name: archive.definition.name,
        description: archive.definition.description,
        sha256: archive.sha256,
        fileCount: archive.files.length,
        size: archive.files.reduce((n, f) => n + f.size, 0),
        hasScripts: archive.files.some((f) => f.path.startsWith('scripts/')),
        official,
        sourceUrl,
      };
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError(e instanceof Error ? e.message.slice(0, 200) : '技能包导入失败');
    } finally {
      this.imports.delete(owner);
    }
  }
  inspect(owner: string, id: string) {
    const p = this.previews.get(id);
    if (!p || p.owner !== owner || p.expires < Date.now())
      throw new DomainError('技能包检查已过期，请重新检查', 404);
    return {
      name: p.archive.definition.name,
      description: p.archive.definition.description,
      sha256: p.archive.sha256,
    };
  }
  async commit(
    owner: string,
    id: string,
    replacement?: { skillId: string; expectedRevision: number },
  ) {
    const p = this.previews.get(id);
    if (!p || p.owner !== owner || p.expires < Date.now())
      throw new DomainError('导入预览已失效', 404);
    const packageId = randomUUID();
    this.store.write(packageId, p.archive);
    let item;
    try {
      item = this.repository.publish(
        owner,
        p.archive,
        packageId,
        p.sourceUrl,
        p.official,
        replacement,
      );
    } catch (e) {
      this.store.remove(packageId);
      throw e;
    }
    this.previews.delete(id);
    try {
      this.sweep();
    } catch {
      /* Cleanup is retried on the next mutation/start; publication already committed. */
    }
    return item;
  }
  manifest(owner: string, id: string) {
    return this.repository.manifest(owner, id);
  }
  enabled(owner: string, ref: SkillPackageRef) {
    const s = new AiSkillRepository(this.database).get(owner, ref.skillId),
      m = this.manifest(owner, ref.skillId);
    if (
      !s.enabled ||
      m.ref.packageId !== ref.packageId ||
      m.ref.revision !== ref.revision ||
      m.ref.sha256 !== ref.sha256
    )
      throw new DomainError('技能未启用或修订已变更', 409);
    return m;
  }
  download(owner: string, ref: SkillPackageRef, file: string) {
    const m = this.enabled(owner, ref),
      f = m.files.find((f) => f.path === skillResourcePath(file));
    if (!f) throw new DomainError('资源不存在', 404);
    return { bytes: this.store.read(ref.packageId, file, f.sha256), name: file.split('/').at(-1)! };
  }
  async read(
    owner: string,
    ref: SkillPackageRef,
    file: string,
    offset: number,
  ): Promise<SkillResourcePage> {
    const m = this.enabled(owner, ref),
      f = m.files.find((f) => f.path === skillResourcePath(file));
    if (!f || !f.text) throw new DomainError('文本资源不存在', 404);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > f.size)
      throw new DomainError('资源偏移无效');
    const bytes = this.store.read(ref.packageId, file, f.sha256);
    if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)
      throw new DomainError('偏移不能截断 UTF-8 字符');
    let end = Math.min(bytes.length, offset + L.page);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    return {
      text: bytes.subarray(offset, end).toString('utf8'),
      nextOffset: end < bytes.length ? end : null,
      totalBytes: bytes.length,
    };
  }
  close() {
    this.lifetime.abort();
    this.previews.clear();
  }
}

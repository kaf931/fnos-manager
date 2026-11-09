import type { FnOsSkillAuth } from './skill-packages/fnos-auth.js';
import type { AiAttachment } from '../../domain/ai-attachments.js';
import type { AiSkillCall } from '../../domain/ai-skills.js';
import type { AiRuntimeCall, AiInstallSkillCall, AiExecutionResult } from '../../domain/ai.js';
import type { SkillPackageRef } from '../../domain/ai-skill-packages.js';
import { AiSkillRepository } from '../../persistence/ai-skill.repository.js';
import type { SkillPackageService } from './skill-packages/service.js';
import { prepareSkillRuntime } from './skill-packages/runtime.js';
import type { AiExecSession } from './executor.js';
export interface SkillActionsContract {
  capture?(owner: string): SkillPackageRef[];
  validate?(owner: string, refs: SkillPackageRef[]): void;
  bindImport?(
    owner: string,
    previewId: string,
  ): { name: string; description: string; sha256: string };
  bind(owner: string, name: string, revision: number): SkillPackageRef;
  read(
    owner: string,
    call: AiSkillCall,
    sessionId?: string,
    context?: { attachments: AiAttachment[]; signal: AbortSignal },
  ): Promise<unknown>;
  execute(
    owner: string,
    sessionId: string,
    call: AiRuntimeCall | AiInstallSkillCall,
    signal: AbortSignal,
  ): Promise<AiExecutionResult>;
}
export class SkillActions implements SkillActionsContract {
  constructor(
    readonly packages: SkillPackageService,
    private session: (owner: string, id: string) => AiExecSession & { connection?: { id: string } },
    private auth?: FnOsSkillAuth,
  ) {}
  capture(owner: string) {
    return new AiSkillRepository(this.packages.database)
      .list(owner)
      .filter((s) => s.enabled && s.kind === 'package')
      .map((s) => this.packages.manifest(owner, s.id).ref);
  }
  validate(owner: string, refs: SkillPackageRef[]) {
    for (const ref of refs) this.packages.enabled(owner, ref);
  }
  bind(owner: string, name: string, revision: number) {
    const skill = new AiSkillRepository(this.packages.database)
      .list(owner)
      .find((s) => s.name === name);
    if (!skill || !skill.enabled || skill.revision !== revision)
      throw Error('技能不可用或修订已变化');
    const m = this.packages.manifest(owner, skill.id);
    this.packages.enabled(owner, m.ref);
    return m.ref;
  }
  bindImport(owner: string, previewId: string) {
    return this.packages.inspect(owner, previewId);
  }
  async read(
    owner: string,
    call: AiSkillCall,
    sessionId?: string,
    context?: { attachments: AiAttachment[]; signal: AbortSignal },
  ) {
    if (call.action === 'inspect_skill_package') {
      if (!context || !call.source) throw Error('技能包来源不可用');
      const source = call.source;
      const attachment = source.attachmentId
        ? context.attachments.find((a) => a.id === source.attachmentId && a.kind === 'archive')
        : undefined;
      if (source.attachmentId && !attachment) throw Error('只能读取当前聊天中未清理的 ZIP 附件');
      return this.packages.preview(
        owner,
        attachment ? { zip: Buffer.from(attachment.data, 'base64') } : source,
        AbortSignal.any([context.signal, AbortSignal.timeout(20000)]),
      );
    }
    const ref = this.bind(owner, call.skillName, call.revision!);
    if (call.action === 'list_skill_resources')
      return {
        ...this.packages.enabled(owner, ref),
        authorizations: sessionId
          ? this.auth?.context(owner, this.session(owner, sessionId).connection?.id || '')
          : [],
      };
    return this.packages.read(owner, ref, call.path!, call.offset!);
  }
  async execute(
    owner: string,
    id: string,
    call: AiRuntimeCall | AiInstallSkillCall,
    signal: AbortSignal,
  ) {
    try {
      signal.throwIfAborted();
      this.session(owner, id);
      if (call.kind === 'install_skill_package') {
        const saved = await this.packages.commit(owner, call.previewId);
        const skill = new AiSkillRepository(this.packages.database).setEnabled(
          owner,
          saved.id,
          true,
        );
        return {
          stdout: JSON.stringify({ name: skill.name, revision: skill.revision, enabled: true }),
          stderr: '',
          exitCode: 0,
          status: 'success' as const,
          truncated: false,
        };
      }
      const ref = call.packageRef;
      if (!ref) throw Error('技能提案已失效');
      const m = this.packages.enabled(owner, ref);
      const result = await prepareSkillRuntime(
        this.session(owner, id),
        owner,
        m,
        this.packages.store,
        signal,
      );
      return {
        stdout: JSON.stringify(result),
        stderr: '',
        exitCode: 0,
        status: 'success' as const,
        truncated: false,
      };
    } catch (e) {
      return {
        stdout: '',
        stderr: e instanceof Error ? e.message : '技能准备失败',
        exitCode: null,
        status: signal.aborted ? ('cancelled' as const) : ('failed' as const),
        truncated: false,
      };
    }
  }
}

import { DatabaseService } from '../../persistence/database.service.js';
import { OperationService } from '../../operations/service.js';
import { SkillPackageService } from '../../terminal/ai/skill-packages/service.js';
import { SkillActions } from '../../terminal/ai/skill-actions.js';
import { FnOsSkillAuth } from '../../terminal/ai/skill-packages/fnos-auth.js';
import { AiSkillRepository } from '../../persistence/ai-skill.repository.js';
import { AiAttachmentRepository } from '../../persistence/ai-attachment.repository.js';
import type { AiAttachmentQuery } from '../../domain/ai-attachments.js';
import { prepareAiAttachments } from '../../terminal/ai/attachments.js';
import { Injectable } from '@nestjs/common';
import type { AiSettingsInput } from '../../domain/ai.js';
import { AiSettingsRepository } from '../../persistence/ai.repository.js';
import { AiHistoryRepository } from '../../persistence/ai-history.repository.js';
import { fail } from '../../terminal/model.js';
import type { AiConnectionTestDto, AiMessageDto } from './ai.dto.js';
import { normalizeAiUrl } from '../../terminal/ai/settings.js';
import { AiSettingsService } from '../../terminal/ai/settings.js';
import { AiProvider } from '../../terminal/ai/provider.js';
import { AiConversationService } from '../../terminal/ai/conversation.js';
import type { Resources } from '../common/resources.js';
import type { TerminalService } from './terminal.service.js';
@Injectable()
export class AiApplicationService {
  constructor(
    readonly settings: AiSettingsService,
    readonly conversations: AiConversationService,
    private readonly terminal: TerminalService,
    readonly history: AiHistoryRepository,
    readonly attachments: AiAttachmentRepository,
    readonly skills: AiSkillRepository,
    readonly packages: SkillPackageService,
    readonly skillAuth: FnOsSkillAuth,
  ) {}
  invalidateSkill(owner: string, id: string) {
    this.conversations.invalidateSkill(owner, id);
    this.skillAuth.cancelOwner(owner);
  }
  async message(owner: string, id: string, input: AiMessageDto) {
    const before = this.conversations.snapshot(owner, id);
    if (
      before.busy ||
      before.proposals.some((p) => p.status === 'pending' || p.status === 'running')
    )
      throw fail('请先处理当前命令或取消本轮操作', 409);
    const attachments = await prepareAiAttachments(input.attachments);
    this.conversations.message(owner, id, input.text, {
      model: input.model,
      providerId: input.providerId,
      executionMode: input.executionMode,
      attachments,
      expectedChatId: before.chatId,
    });
  }
  listAttachments(owner: string, query: AiAttachmentQuery) {
    const result = this.attachments.list(owner, query),
      protectedIds = new Set(this.conversations.protectedAttachmentChats(owner));
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, inUse: protectedIds.has(item.chatId) })),
    };
  }
  cleanAttachments(owner: string, ids: string[]) {
    const result = this.attachments.remove(
      owner,
      ids,
      this.conversations.protectedAttachmentChats(owner),
    );
    this.conversations.forgetAttachments(owner, ids);
    return result;
  }
  cleanAllHistory(owner: string) {
    return this.history.removeAvailable(owner, this.conversations.openChatIds(owner));
  }
  cleanAllAttachments(owner: string) {
    const result = this.attachments.removeAvailable(
      owner,
      this.conversations.protectedAttachmentChats(owner),
    );
    this.conversations.forgetAttachments(owner, result.ids);
    return { count: result.count, cleanupPending: result.cleanupPending };
  }
  readSettings(owner: string) {
    return this.settings.read(owner);
  }
  models(owner: string, providerId?: string) {
    return new AiProvider().models(this.settings.privateSettings(owner, providerId));
  }
  async testConnection(input: AiConnectionTestDto) {
    const apiKey = input.apiKey?.trim() || '';
    if (/[\r\n]/.test(apiKey)) throw fail('API Key 格式无效');
    const models = await new AiProvider().models({
      protocol: input.protocol,
      baseUrl: normalizeAiUrl(input.baseUrl.trim()),
      apiKey,
      model: '',
      updatedAt: 0,
    });
    return { models };
  }
  readHistory(owner: string, id: string) {
    const chat = this.history.get(owner, id);
    if (!chat) throw fail('对话记录不存在', 404);
    return {
      id: chat.id,
      title: chat.title,
      connectionId: chat.connectionId,
      connectionName: chat.connectionName,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: chat.messages,
      proposals: chat.proposals,
    };
  }
  saveSettings(owner: string, input: AiSettingsInput) {
    return this.settings.save(owner, input);
  }
  cancel(owner: string, session: string) {
    this.terminal.service.connectedOwned(owner, session);
    this.conversations.cancel(owner, session);
  }
  static create(
    terminal: TerminalService,
    resources: Resources,
    database: DatabaseService,
    operations: OperationService,
  ) {
    const settings = new AiSettingsService(new AiSettingsRepository(database));
    const history = new AiHistoryRepository(database);
    const skills = new AiSkillRepository(database);
    const packages = resources.add('skillPackages', new SkillPackageService(database));
    const skillAuth = resources.add(
      'skillAuth',
      new FnOsSkillAuth(packages, (owner, id) => terminal.service.connectedOwned(owner, id)),
    );
    const skillActions = new SkillActions(
      packages,
      (owner, id) => terminal.service.connectedOwned(owner, id),
      skillAuth,
    );
    const conversations = resources.add(
      'aiService',
      new AiConversationService({
        operations: operations,
        settings,
        provider: new AiProvider(),
        getSession: (owner, id) => terminal.service.connectedOwned(owner, id),
        history,
        skills: {
          catalog: (owner) => skills.catalog(owner),
          readEnabled: (owner, name) => {
            const body = skills.readEnabled(owner, name),
              skill = skills.list(owner).find((s) => s.name === name);
            if (skill?.kind !== 'package') return body;
            const m = packages.manifest(owner, skill.id);
            return (
              body +
              '\n\n包修订：' +
              m.ref.revision +
              '。请按需调用 list_skill_resources/read_skill_resource；执行脚本前调用 prepare_skill_runtime，使用返回的绝对路径。官方操作需先通过技能管理完成授权，不将授权码或 session 文件发送给模型。\n文件目录：' +
              m.files.map((f) => f.path).join('\n')
            );
          },
        },
        skillActions,
      }),
    );
    terminal.service.subscribeSessionRemoved((id) => conversations.clearSession(id));
    return new AiApplicationService(
      settings,
      conversations,
      terminal,
      history,
      new AiAttachmentRepository(database),
      skills,
      packages,
      skillAuth,
    );
  }
}

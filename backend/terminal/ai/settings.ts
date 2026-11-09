import { CONFIG_LIMITS } from '../../domain/config-limits.js';
import { AI_PROTOCOLS } from '../../domain/ai.js';
import type {
  AiSettingsInput,
  AiPublicSettings,
  AiProviderInput,
  AiPublicProvider,
} from '../../domain/ai.js';
import type { AiSettingsRepository } from '../../persistence/ai.repository.js';
import { fail } from '../model.js';
export function normalizeAiUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      value.length > 2048
    )
      throw 0;
    return url.href.replace(/\/+$/, '');
  } catch {
    throw fail('请输入有效的 HTTP/HTTPS API 根地址，不包含账号、查询参数或片段');
  }
}
export class AiSettingsService {
  constructor(private readonly repository: AiSettingsRepository) {}
  read(owner: string): AiPublicSettings {
    const s = this.repository.get(owner);
    return {
      baseUrl: s?.baseUrl || '',
      model: s?.model || '',
      hasKey: !!s?.apiKey,
      apiKey: s?.apiKey || '',
    };
  }
  privateSettings(owner: string, id?: string) {
    const s = this.repository.get(owner, id);
    if (!s) throw fail('请先配置 AI 接口和模型', 409);
    return s;
  }
  save(owner: string, input: AiSettingsInput): AiPublicSettings {
    const previous = this.repository.get(owner);
    this.saveProvider(
      owner,
      { name: previous?.name || '默认供应商', protocol: previous?.protocol || 'openai', ...input },
      previous?.id,
    );
    return this.read(owner);
  }
  listProviders(owner: string): AiPublicProvider[] {
    return this.repository.list(owner).map((s) => ({
      id: s.id!,
      name: s.name!,
      protocol: s.protocol!,
      baseUrl: s.baseUrl,
      model: s.model,
      hasKey: !!s.apiKey,
    }));
  }
  readProvider(owner: string, id: string): AiPublicProvider {
    const provider = this.listProviders(owner).find((p) => p.id === id);
    if (!provider) throw fail('供应商不存在', 404);
    return { ...provider, apiKey: this.privateSettings(owner, id).apiKey };
  }
  deleteProvider(owner: string, id: string) {
    if (!this.repository.delete(owner, id)) throw fail('供应商不存在', 404);
    return { deleted: true };
  }
  saveProvider(owner: string, input: AiProviderInput, id?: string): AiPublicProvider {
    const previous = id ? this.repository.get(owner, id) : null;
    if (id && !previous) throw fail('供应商不存在', 404);
    const name = input.name.trim();
    if (!name || name.length > 80 || !AI_PROTOCOLS.includes(input.protocol))
      throw fail('请输入有效供应商名称和协议');
    if (!id && this.repository.list(owner).length >= CONFIG_LIMITS.providers)
      throw fail('最多保存 20 个供应商');
    const model = input.model.trim();
    if (!model || model.length > 200) throw fail('请输入有效模型名称');
    const baseUrl = normalizeAiUrl(input.baseUrl.trim());
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string')
      throw fail('API Key 格式无效');
    const apiKey =
      input.apiKey !== undefined
        ? input.apiKey.trim()
        : previous?.baseUrl === baseUrl
          ? previous.apiKey
          : '';
    if (apiKey.length > 8192 || /[\r\n]/.test(apiKey)) throw fail('API Key 格式无效');
    const key = this.repository.save(
      owner,
      {
        name,
        protocol: input.protocol,
        baseUrl,
        model,
        apiKey,
        updatedAt: Date.now(),
      },
      id,
    );
    return this.readProvider(owner, key);
  }
}

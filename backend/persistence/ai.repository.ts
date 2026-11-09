import { randomUUID } from 'node:crypto';
import type { AiSettings, AiProtocol } from '../domain/ai.js';
import type { DatabaseService } from './database.service.js';
import { text, integer } from './records.js';
export class AiSettingsRepository {
  constructor(private readonly database: DatabaseService) {}
  list(owner: string): AiSettings[] {
    return this.database.connection
      .prepare('SELECT * FROM ai_providers WHERE owner_uid=? ORDER BY created_at,id')
      .all(owner)
      .map((row) => ({
        id: text(row.id),
        name: text(row.name),
        protocol: text(row.protocol) as AiProtocol,
        baseUrl: text(row.base_url),
        model: text(row.model),
        apiKey: text(row.api_key),
        updatedAt: integer(row.updated_at),
      }));
  }
  get(owner: string, id?: string): AiSettings | null {
    return this.list(owner).find((s) => !id || s.id === id) ?? null;
  }
  save(owner: string, settings: AiSettings, id?: string): string {
    const key = id || settings.id || randomUUID();
    this.database.connection
      .prepare(
        `INSERT INTO ai_providers(id,owner_uid,name,protocol,base_url,model,api_key,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,protocol=excluded.protocol,base_url=excluded.base_url,model=excluded.model,api_key=excluded.api_key,updated_at=excluded.updated_at WHERE ai_providers.owner_uid=excluded.owner_uid`,
      )
      .run(
        key,
        owner,
        settings.name || '默认供应商',
        settings.protocol || 'openai',
        settings.baseUrl,
        settings.model,
        settings.apiKey,
        Date.now(),
        settings.updatedAt,
      );
    return key;
  }
  delete(owner: string, id: string): boolean {
    return (
      this.database.connection
        .prepare('DELETE FROM ai_providers WHERE owner_uid=? AND id=?')
        .run(owner, id).changes > 0
    );
  }
}

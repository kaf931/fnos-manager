import { randomUUID } from 'node:crypto';
import type { DatabaseService } from './database.service.js';
import type { SkillPackageRef } from '../domain/ai-skill-packages.js';
import { DomainError } from '../errors.js';
export interface SkillAuthorization {
  id: string;
  owner: string;
  skillId: string;
  packageId: string;
  connectionId: string;
  origin: string;
  profile: string;
  status: 'disconnected' | 'pending' | 'connected';
  pendingAt: number | null;
  authorizationUrl: string | null;
  fileStorage: boolean;
  tokenSaved: boolean;
  updatedAt: number;
}
export class AiSkillAuthorizationRepository {
  constructor(readonly db: DatabaseService) {}
  private map(r: Record<string, unknown>): SkillAuthorization {
    return {
      id: String(r.id),
      owner: String(r.owner_uid),
      skillId: String(r.skill_id),
      packageId: String(r.package_id),
      connectionId: String(r.connection_id),
      origin: String(r.origin),
      profile: String(r.profile),
      status: r.status as SkillAuthorization['status'],
      pendingAt: r.pending_at === null ? null : Number(r.pending_at),
      authorizationUrl: r.authorization_url === null ? null : String(r.authorization_url),
      fileStorage: !!r.file_storage,
      tokenSaved: !!r.token_saved,
      updatedAt: Number(r.updated_at),
    };
  }
  get(owner: string, id: string) {
    const r = this.db.connection
      .prepare('SELECT * FROM ai_skill_authorizations WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!r) throw new DomainError('授权记录不存在', 404);
    return this.map(r);
  }
  list(owner: string, connectionId: string) {
    return this.db.connection
      .prepare('SELECT * FROM ai_skill_authorizations WHERE owner_uid=? AND connection_id=?')
      .all(owner, connectionId)
      .map((r) => this.map(r));
  }
  create(
    owner: string,
    connectionId: string,
    ref: SkillPackageRef,
    origin: string,
    fileStorage: boolean,
  ) {
    const existing = this.list(owner, connectionId).find(
      (r) => r.packageId === ref.packageId && r.origin === origin,
    );
    if (existing) return existing;
    const id = randomUUID();
    this.db.connection
      .prepare(
        "INSERT INTO ai_skill_authorizations(id,owner_uid,skill_id,package_id,connection_id,origin,profile,status,pending_at,file_storage,updated_at)VALUES(?,?,?,?,?,?,?,'disconnected',NULL,?,?)",
      )
      .run(
        id,
        owner,
        ref.skillId,
        ref.packageId,
        connectionId,
        origin,
        'skill-' + id,
        Number(fileStorage),
        Date.now(),
      );
    return this.get(owner, id);
  }
  update(r: SkillAuthorization) {
    this.db.connection
      .prepare(
        'UPDATE ai_skill_authorizations SET status=?,pending_at=?,authorization_url=?,file_storage=?,token_saved=?,updated_at=? WHERE owner_uid=? AND id=?',
      )
      .run(
        r.status,
        r.pendingAt,
        r.authorizationUrl,
        Number(r.fileStorage),
        Number(r.tokenSaved),
        Date.now(),
        r.owner,
        r.id,
      );
  }
}

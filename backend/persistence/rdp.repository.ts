import { inputRecord } from '../errors.js';
import { randomUUID } from 'node:crypto';
import type { RdpSecurity, RdpCertificatePolicy, RdpConnection } from '../domain/rdp.js';
import type { DatabaseService } from './database.service.js';
import { validateRdpConnection } from '../rdp/model.js';
import { fail } from '../terminal/model.js';
import { text, integer, optionalText } from './records.js';
import type { RecordValue } from '../domain/record.js';
export class RdpRepository {
  constructor(private readonly database: DatabaseService) {}
  private decode(r: RecordValue): RdpConnection {
    return {
      id: text(r.id),
      ownerUid: text(r.owner_uid),
      name: text(r.name),
      protocol: 'rdp',
      host: text(r.host),
      port: integer(r.port),
      username: text(r.username),
      password: text(r.password),
      domain: text(r.domain),
      security: text(r.security) as RdpSecurity,
      certificatePolicy: text(r.certificate_policy) as RdpCertificatePolicy,
      folderId: optionalText(r.folder_id),
    };
  }
  list(owner: string) {
    return this.database.connection
      .prepare('SELECT * FROM rdp_connections WHERE owner_uid=? ORDER BY created_at,id')
      .all(owner)
      .map((r) => this.decode(r));
  }
  get(owner: string, id: string) {
    const r = this.database.connection
      .prepare('SELECT * FROM rdp_connections WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!r) throw fail('连接不存在', 404);
    return this.decode(r);
  }
  save(owner: string, input: unknown, id?: string) {
    const v = validateRdpConnection(input),
      old = id ? this.get(owner, id) : null;
    if (old && inputRecord(input).security === undefined) v.security = old.security;
    if (old && inputRecord(input).certificatePolicy === undefined)
      v.certificatePolicy = old.certificatePolicy;
    if (old && inputRecord(input).folderId === undefined) v.folderId = old.folderId;
    if (
      v.folderId &&
      !this.database.connection
        .prepare("SELECT id FROM ssh_folders WHERE owner_uid=? AND scope='assets' AND id=?")
        .get(owner, v.folderId)
    )
      throw fail('资产目录不存在');
    const key = id ?? 'rdp-' + randomUUID();
    if (!old && this.list(owner).length >= 200) throw fail('RDP 连接最多 200 个');
    this.database.connection
      .prepare(
        `INSERT INTO rdp_connections(id,owner_uid,name,host,port,username,password,domain,security,certificate_policy,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,password=excluded.password,domain=excluded.domain,security=excluded.security,certificate_policy=excluded.certificate_policy,folder_id=excluded.folder_id,updated_at=excluded.updated_at WHERE rdp_connections.owner_uid=excluded.owner_uid`,
      )
      .run(
        key,
        owner,
        v.name,
        v.host,
        v.port,
        v.username,
        v.password || old?.password || '',
        v.domain,
        v.security,
        v.certificatePolicy,
        v.folderId,
        Date.now(),
        Date.now(),
      );
    return this.get(owner, key);
  }
  insertRestored(owner: string, id: string, input: unknown) {
    const v = validateRdpConnection(input);
    this.database.connection
      .prepare(
        'INSERT INTO rdp_connections(id,owner_uid,name,host,port,username,password,domain,security,certificate_policy,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        owner,
        v.name,
        v.host,
        v.port,
        v.username,
        v.password,
        v.domain,
        v.security,
        v.certificatePolicy,
        v.folderId,
        Date.now(),
        Date.now(),
      );
  }
  remove(owner: string, id: string) {
    this.database.connection
      .prepare('DELETE FROM rdp_connections WHERE owner_uid=? AND id=?')
      .run(owner, id);
  }
  move(owner: string, id: string, folderId: string | null) {
    const row = this.get(owner, id);
    return this.save(owner, { ...row, folderId }, id);
  }
}

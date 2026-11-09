import { decodeStoredCredentials } from '../domain/terminal.js';
import type { HostKey, TerminalConnection } from '../domain/terminal.js';
import type { DatabaseService } from './database.service.js';
import { connectionValues, hostValues, integer, text, type RecordValue } from './records.js';
import { iso, position, upsert } from './sql.js';

export class TerminalRepository {
  constructor(private readonly database: DatabaseService) {}
  private decode(row: RecordValue): TerminalConnection {
    return {
      id: text(row.id),
      ownerUid: text(row.owner_uid),
      name: text(row.name),
      kind: text(row.kind) as TerminalConnection['kind'],
      host: text(row.host),
      port: integer(row.port),
      username: text(row.username),
      folderId: row.folder_id == null ? null : text(row.folder_id),
      ...(row.auth_method == null
        ? {}
        : { authMethod: text(row.auth_method) as TerminalConnection['authMethod'] }),
      ...(row.credentials == null
        ? {}
        : {
            credentials: decodeStoredCredentials(
              row.auth_method,
              JSON.parse(text(row.credentials)),
            ),
          }),
      ...(row.created_at == null ? {} : { createdAt: iso(row.created_at) }),
      ...(row.updated_at == null ? {} : { updatedAt: iso(row.updated_at) }),
    };
  }
  list(owner?: string): TerminalConnection[] {
    const db = this.database.connection;
    const rows =
      owner === undefined
        ? db.prepare('SELECT * FROM ssh_connections ORDER BY position,id').all()
        : db
            .prepare('SELECT * FROM ssh_connections WHERE owner_uid=? ORDER BY position,id')
            .all(owner);
    return rows.map((row) => this.decode(row));
  }
  find(owner: string, id: string): TerminalConnection | undefined {
    const row = this.database.connection
      .prepare('SELECT * FROM ssh_connections WHERE owner_uid=? AND id=?')
      .get(owner, id);
    return row ? this.decode(row) : undefined;
  }
  save(connection: TerminalConnection): void {
    const db = this.database.connection;
    this.database.transaction(() => {
      const existing = db
        .prepare('SELECT owner_uid FROM ssh_connections WHERE id=?')
        .get(connection.id);
      if (existing && existing.owner_uid !== connection.ownerUid)
        throw new Error('连接所属用户不能修改');
      upsert(
        db,
        'ssh_connections',
        connectionValues({ ...connection }, position(db, 'ssh_connections', connection.id)),
      );
    });
  }
  remove(owner: string, id: string): void {
    this.database.transaction(() => {
      this.database.connection
        .prepare('UPDATE wake_devices SET connection_id=NULL WHERE owner_uid=? AND connection_id=?')
        .run(owner, id);
      this.database.connection
        .prepare('DELETE FROM ssh_connections WHERE owner_uid=? AND id=?')
        .run(owner, id);
    });
  }
  hostKeys(owner: string, host: string, port: number): HostKey[] {
    return this.database.connection
      .prepare(
        'SELECT * FROM ssh_known_hosts WHERE owner_uid=? AND host=? AND port=? ORDER BY algorithm',
      )
      .all(owner, host, port)
      .map((row) => ({
        ownerUid: text(row.owner_uid),
        host: text(row.host),
        port: integer(row.port),
        algorithm: text(row.algorithm),
        key: text(row.public_key),
        fingerprint: text(row.fingerprint),
      }));
  }
  trust(key: HostKey): void {
    upsert(this.database.connection, 'ssh_known_hosts', hostValues({ ...key }), [
      'owner_uid',
      'host',
      'port',
      'algorithm',
    ]);
  }
  hasCredentials(): boolean {
    return !!this.database.connection
      .prepare('SELECT 1 FROM ssh_connections WHERE credentials IS NOT NULL LIMIT 1')
      .get();
  }
}

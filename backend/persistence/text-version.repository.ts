import type { DatabaseService } from './database.service.js';
import type { TextFileVersion } from '../domain/terminal-files.js';
export interface VersionRecord extends TextFileVersion {
  owner: string;
  connectionId: string;
  identity: string;
  hash: string;
}
export class TextVersionRepository {
  constructor(readonly database: DatabaseService) {}
  all(): VersionRecord[] {
    return this.database.connection
      .prepare('SELECT * FROM text_file_versions ORDER BY created_at ASC,rowid ASC')
      .all()
      .map((row) => ({
        id: String(row.id),
        owner: String(row.owner_uid),
        connectionId: String(row.connection_id),
        identity: String(row.identity_hash),
        createdAt: new Date(Number(row.created_at)).toISOString(),
        size: Number(row.size),
        encoding: String(row.encoding),
        bom: row.bom === 1,
        hash: String(row.content_hash),
      }));
  }
  insert(row: VersionRecord) {
    // Check the owner as well as the FK: connection IDs alone are not an authorization boundary.
    if (
      !this.database.connection
        .prepare('SELECT id FROM ssh_connections WHERE id=? AND owner_uid=?')
        .get(row.connectionId, row.owner)
    )
      throw new Error('版本所属连接不存在');
    this.database.connection
      .prepare(
        'INSERT INTO text_file_versions(id,owner_uid,connection_id,identity_hash,created_at,size,encoding,bom,content_hash) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        row.id,
        row.owner,
        row.connectionId,
        row.identity,
        Date.parse(row.createdAt),
        row.size,
        row.encoding,
        Number(row.bom),
        row.hash,
      );
  }
  remove(id: string) {
    this.database.connection.prepare('DELETE FROM text_file_versions WHERE id=?').run(id);
  }
}

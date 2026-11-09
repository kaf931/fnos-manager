import type { OfficialConnection } from '../domain/icons.js';
import type { DatabaseService } from './database.service.js';
import { insertOfficial, integer, text } from './records.js';

export class OfficialRepository {
  constructor(private readonly database: DatabaseService) {}
  get(): OfficialConnection {
    const row = this.database.connection
      .prepare('SELECT * FROM official_connection WHERE id=1')
      .get();
    if (!row) return { connected: false };
    return {
      connected: row.connected === 1,
      ...(row.origin == null ? {} : { origin: text(row.origin) }),
      fileStorage: row.file_storage === 1,
      ...(row.pending_at == null ? {} : { pending: integer(row.pending_at) }),
      ...(row.authorization_url == null ? {} : { authorizationUrl: text(row.authorization_url) }),
    };
  }
  save(connection: OfficialConnection): void {
    this.database.transaction(() => {
      this.database.connection.exec('DELETE FROM official_connection WHERE id=1');
      insertOfficial(this.database.connection, { ...connection });
    });
  }
}

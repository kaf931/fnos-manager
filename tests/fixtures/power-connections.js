import { DatabaseService } from '../../server/persistence/database.service.js';
import { TerminalRepository } from '../../server/persistence/terminal.repository.js';
export function seedPowerConnections(dir, connections, owner) {
  const db = new DatabaseService(dir);
  try {
    const repo = new TerminalRepository(db);
    for (const [id, row] of Object.entries(connections))
      repo.save({
        id,
        ownerUid: owner,
        name: id,
        kind: 'remote',
        host: '192.168.1.20',
        port: 22,
        username: 'root',
        ...row,
      });
  } finally {
    db.close();
  }
}

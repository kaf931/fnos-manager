import type { WakeDevice } from '../domain/wake.js';
import type { DatabaseService } from './database.service.js';
import { integer, text, time, type RecordValue } from './records.js';
import { iso, position, upsert } from './sql.js';
export class WakeRepository {
  constructor(private readonly database: DatabaseService) {}
  private decode(row: RecordValue): WakeDevice {
    return {
      ...(row.ip ? { ip: text(row.ip) } : {}),
      id: text(row.id),
      owner: text(row.owner_uid),
      name: text(row.name),
      mac: text(row.mac),
      address: text(row.address),
      port: integer(row.port),
      system: text(row.system) as WakeDevice['system'],
      connectionId: row.connection_id == null ? null : text(row.connection_id),
      ...(row.created_at == null ? {} : { createdAt: iso(row.created_at) }),
      ...(row.updated_at == null ? {} : { updatedAt: iso(row.updated_at) }),
      ...(row.last_wake_at == null ? {} : { lastSentAt: iso(row.last_wake_at) }),
      ...(row.last_power_at == null
        ? {}
        : {
            lastControl: {
              action: text(row.last_power_action) as 'shutdown' | 'reboot',
              sentAt: iso(row.last_power_at)!,
            },
          }),
    };
  }
  list(owner?: string): WakeDevice[] {
    const db = this.database.connection;
    return (
      owner === undefined
        ? db.prepare('SELECT * FROM wake_devices ORDER BY position,id').all()
        : db.prepare('SELECT * FROM wake_devices WHERE owner_uid=? ORDER BY position,id').all(owner)
    ).map((row) => this.decode(row));
  }
  find(owner: string, id: string): WakeDevice | undefined {
    const row = this.database.connection
      .prepare('SELECT * FROM wake_devices WHERE owner_uid=? AND id=?')
      .get(owner, id);
    return row ? this.decode(row) : undefined;
  }
  save(item: WakeDevice): void {
    const db = this.database.connection;
    this.database.transaction(() => {
      const old = db.prepare('SELECT owner_uid FROM wake_devices WHERE id=?').get(item.id);
      if (old && old.owner_uid !== item.owner) throw new Error('设备所属用户不能修改');
      upsert(db, 'wake_devices', {
        id: item.id,
        owner_uid: item.owner,
        name: item.name,
        mac: item.mac,
        address: item.address,
        ip: item.ip || null,
        port: item.port,
        system: item.system,
        connection_id: item.connectionId ?? null,
        position: position(db, 'wake_devices', item.id),
        created_at: time(item.createdAt),
        updated_at: time(item.updatedAt),
        last_wake_at: time(item.lastSentAt),
        last_power_at: time(item.lastControl?.sentAt),
        last_power_action: item.lastControl?.action ?? null,
      });
    });
  }
  remove(owner: string, id: string): void {
    this.database.transaction(() => {
      this.database.connection
        .prepare('UPDATE task_devices SET device_id=NULL WHERE owner_uid=? AND device_id=?')
        .run(owner, id);
      this.database.connection
        .prepare('DELETE FROM wake_devices WHERE owner_uid=? AND id=?')
        .run(owner, id);
    });
  }
}

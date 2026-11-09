import { randomUUID } from 'node:crypto';
import type { DatabaseService } from './database.service.js';
import type { AdbConnection } from '../domain/adb.js';
import { validateAdbConnection } from '../adb/model.js';
import { fail } from '../terminal/model.js';
export class AdbRepository {
  constructor(private readonly db: DatabaseService) {}
  private decode(r: Record<string, unknown>): AdbConnection {
    return {
      id: String(r.id),
      ownerUid: String(r.owner_uid),
      name: String(r.name),
      protocol: 'adb',
      host: String(r.host),
      port: Number(r.port),
      folderId: r.folder_id ? String(r.folder_id) : null,
      deviceType: r.device_type as 'network' | 'usb',
      serial: String(r.serial),
    };
  }
  list(owner: string) {
    return this.db.connection
      .prepare('SELECT * FROM adb_connections WHERE owner_uid=? ORDER BY created_at,id')
      .all(owner)
      .map((r) => this.decode(r));
  }
  get(owner: string, id: string) {
    const r = this.db.connection
      .prepare('SELECT * FROM adb_connections WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!r) throw fail('ADB 连接不存在', 404);
    return this.decode(r);
  }
  save(owner: string, input: unknown, id?: string) {
    const v = validateAdbConnection(input),
      old = id ? this.get(owner, id) : null;
    if (old && (input as Record<string, unknown>).folderId === undefined) v.folderId = old.folderId;
    if (
      v.folderId &&
      !this.db.connection
        .prepare("SELECT id FROM ssh_folders WHERE owner_uid=? AND scope='assets' AND id=?")
        .get(owner, v.folderId)
    )
      throw fail('资产目录不存在');
    if (!old && this.list(owner).length >= 200) throw fail('ADB 连接最多 200 个');
    const key = id ?? 'adb-' + randomUUID();
    this.db.connection
      .prepare(
        `INSERT INTO adb_connections(id,owner_uid,name,host,port,folder_id,device_type,serial,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,folder_id=excluded.folder_id,device_type=excluded.device_type,serial=excluded.serial,updated_at=excluded.updated_at WHERE adb_connections.owner_uid=excluded.owner_uid`,
      )
      .run(
        key,
        owner,
        v.name,
        v.host,
        v.port,
        v.folderId,
        v.deviceType,
        v.serial,
        Date.now(),
        Date.now(),
      );
    return this.get(owner, key);
  }
  remove(owner: string, id: string) {
    this.db.connection
      .prepare('DELETE FROM adb_connections WHERE owner_uid=? AND id=?')
      .run(owner, id);
  }
  move(owner: string, id: string, folderId: string | null) {
    return this.save(owner, { ...this.get(owner, id), folderId }, id);
  }
  insertRestored(owner: string, id: string, input: unknown) {
    const v = validateAdbConnection(input);
    this.db.connection
      .prepare(
        'INSERT INTO adb_connections(id,owner_uid,name,host,port,folder_id,device_type,serial,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        owner,
        v.name,
        v.host,
        v.port,
        v.folderId,
        v.deviceType,
        v.serial,
        Date.now(),
        Date.now(),
      );
    return this.get(owner, id);
  }
}

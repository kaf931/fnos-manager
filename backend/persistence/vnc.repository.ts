import { inputRecord } from '../errors.js';
import { randomUUID } from 'node:crypto';
import { DEFAULT_VNC_SETTINGS, type VncConnection, type VncSettings } from '../domain/vnc.js';
import type { DatabaseService } from './database.service.js';
import { validateVncConnection } from '../vnc/model.js';
import { fail } from '../terminal/model.js';
import { text, integer, optionalText } from './records.js';
import type { RecordValue } from '../domain/record.js';
export class VncRepository {
  constructor(private readonly database: DatabaseService) {}
  getSettings(owner: string): VncSettings {
    const row = this.database.connection
      .prepare('SELECT * FROM vnc_preferences WHERE owner_uid=?')
      .get(owner);
    if (!row) return { ...DEFAULT_VNC_SETTINGS };
    return {
      shared: integer(row.shared) === 1,
      viewOnly: integer(row.view_only) === 1,
      clipViewport: integer(row.clip_viewport) === 1,
      scaleMode: text(row.scale_mode) as VncSettings['scaleMode'],
      qualityLevel: integer(row.quality_level),
      compressionLevel: integer(row.compression_level),
      cursorMode: text(row.cursor_mode) as VncSettings['cursorMode'],
      showDotCursor: integer(row.show_dot_cursor) === 1,
      autoReconnect: integer(row.auto_reconnect) === 1,
      reconnectDelay: integer(row.reconnect_delay),
      repeaterId: text(row.repeater_id),
      logging: text(row.logging) as VncSettings['logging'],
    };
  }
  saveSettings(owner: string, settings: VncSettings): VncSettings {
    this.database.connection
      .prepare(
        `
      INSERT INTO vnc_preferences(owner_uid,shared,view_only,clip_viewport,scale_mode,quality_level,compression_level,show_dot_cursor,auto_reconnect,reconnect_delay,repeater_id,logging,updated_at,cursor_mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_uid) DO UPDATE SET shared=excluded.shared,view_only=excluded.view_only,clip_viewport=excluded.clip_viewport,scale_mode=excluded.scale_mode,quality_level=excluded.quality_level,compression_level=excluded.compression_level,show_dot_cursor=excluded.show_dot_cursor,auto_reconnect=excluded.auto_reconnect,reconnect_delay=excluded.reconnect_delay,repeater_id=excluded.repeater_id,logging=excluded.logging,updated_at=excluded.updated_at,cursor_mode=excluded.cursor_mode
    `,
      )
      .run(
        owner,
        Number(settings.shared),
        Number(settings.viewOnly),
        Number(settings.clipViewport),
        settings.scaleMode,
        settings.qualityLevel,
        settings.compressionLevel,
        Number(settings.showDotCursor),
        Number(settings.autoReconnect),
        settings.reconnectDelay,
        settings.repeaterId,
        settings.logging,
        Date.now(),
        settings.cursorMode,
      );
    return this.getSettings(owner);
  }
  private decode(r: RecordValue): VncConnection {
    return {
      id: text(r.id),
      ownerUid: text(r.owner_uid),
      name: text(r.name),
      protocol: 'vnc',
      host: text(r.host),
      port: integer(r.port),
      username: text(r.username),
      password: text(r.password),
      folderId: optionalText(r.folder_id),
    };
  }
  list(owner: string) {
    return this.database.connection
      .prepare('SELECT * FROM vnc_connections WHERE owner_uid=? ORDER BY created_at,id')
      .all(owner)
      .map((r) => this.decode(r));
  }
  get(owner: string, id: string) {
    const r = this.database.connection
      .prepare('SELECT * FROM vnc_connections WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!r) throw fail('连接不存在', 404);
    return this.decode(r);
  }
  save(owner: string, input: unknown, id?: string) {
    const v = validateVncConnection(input),
      old = id ? this.get(owner, id) : null;
    if (old && inputRecord(input).folderId === undefined) v.folderId = old.folderId;
    if (
      v.folderId &&
      !this.database.connection
        .prepare("SELECT id FROM ssh_folders WHERE owner_uid=? AND scope='assets' AND id=?")
        .get(owner, v.folderId)
    )
      throw fail('资产目录不存在');
    const key = id ?? 'vnc-' + randomUUID();
    if (!old && this.list(owner).length >= 200) throw fail('VNC 连接最多 200 个');
    this.database.connection
      .prepare(
        `INSERT INTO vnc_connections(id,owner_uid,name,host,port,username,password,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,password=excluded.password,folder_id=excluded.folder_id,updated_at=excluded.updated_at WHERE vnc_connections.owner_uid=excluded.owner_uid`,
      )
      .run(
        key,
        owner,
        v.name,
        v.host,
        v.port,
        v.username,
        v.password || old?.password || '',
        v.folderId,
        Date.now(),
        Date.now(),
      );
    return this.get(owner, key);
  }
  insertRestored(owner: string, id: string, input: unknown) {
    const v = validateVncConnection(input);
    this.database.connection
      .prepare(
        'INSERT INTO vnc_connections(id,owner_uid,name,host,port,username,password,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        owner,
        v.name,
        v.host,
        v.port,
        v.username,
        v.password,
        v.folderId,
        Date.now(),
        Date.now(),
      );
  }
  remove(owner: string, id: string) {
    this.database.connection
      .prepare('DELETE FROM vnc_connections WHERE owner_uid=? AND id=?')
      .run(owner, id);
  }
  move(owner: string, id: string, folderId: string | null) {
    const row = this.get(owner, id);
    return this.save(owner, { ...row, folderId }, id);
  }
}

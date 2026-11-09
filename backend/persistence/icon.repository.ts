import type { IconEntry } from '../domain/icons.js';
import type { DatabaseService } from './database.service.js';
import { iconValues, integer, text, type RecordValue } from './records.js';

export class IconRepository {
  constructor(private readonly database: DatabaseService) {}
  private decode(row: RecordValue): IconEntry {
    return {
      id: text(row.id),
      name: text(row.name),
      url: text(row.url),
      mode: text(row.mode) as IconEntry['mode'],
      containerId: row.container_id == null ? null : text(row.container_id),
      menuPage: row.menu_page == null ? null : (text(row.menu_page) as IconEntry['menuPage']),
      iconSource: text(row.icon_source),
      revision: integer(row.revision),
      appliedRevision: integer(row.applied_revision),
      ...(row.updated_at == null
        ? {}
        : { updatedAt: new Date(integer(row.updated_at)).toISOString() }),
    };
  }
  list(): IconEntry[] {
    return this.database.connection
      .prepare('SELECT * FROM icons ORDER BY position,id')
      .all()
      .map((row) => this.decode(row));
  }
  find(id: string): IconEntry | undefined {
    const row = this.database.connection.prepare('SELECT * FROM icons WHERE id=?').get(id);
    return row ? this.decode(row) : undefined;
  }
  save(entry: IconEntry, image?: Buffer): void {
    const db = this.database.connection;
    this.database.transaction(() => {
      const previous = db.prepare('SELECT position FROM icons WHERE id=?').get(entry.id);
      const next = db.prepare('SELECT COALESCE(MAX(position)+1,0) n FROM icons').get();
      const values = iconValues({ ...entry }, integer(previous?.position ?? next?.n));
      const columns = Object.keys(values);
      db.prepare(
        `INSERT INTO icons(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns
          .filter((column) => column !== 'id')
          .map((column) => `${column}=excluded.${column}`)
          .join(',')}`,
      ).run(...Object.values(values));
      if (image)
        db.prepare(
          'INSERT INTO icon_images(icon_id,image) VALUES(?,?) ON CONFLICT(icon_id) DO UPDATE SET image=excluded.image',
        ).run(entry.id, image);
    });
  }
  image(id: string): Buffer {
    const row = this.database.connection
      .prepare('SELECT image FROM icon_images WHERE icon_id=?')
      .get(id);
    if (!row) throw Object.assign(new Error('图标图片不存在'), { status: 404 });
    return Buffer.from(row.image as Uint8Array);
  }
  remove(id: string): void {
    this.database.connection.prepare('DELETE FROM icons WHERE id=?').run(id);
  }
}

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  schema,
  updatePolicySchema,
  appearanceSchema,
  rdpBaseSchema,
  rdpSecuritySchema,
  retentionSchema,
  vncCursorSchema,
  vncSchema,
  adbSchema,
  vncPreferencesSchema,
  textVersionsSchema,
  reachabilitySchema,
  operationSchema,
  notificationSchema,
  notificationOptionsSchema,
  notificationTemplatesSchema,
  reminderSchema,
  notificationInboxSchema,
  backupSchema,
  SCHEMA_VERSION,
  aiSchema,
  aiProfilesSchema,
  aiReasoningSchema,
  catalogSchema,
  settingsSchema,
  menuEntrySchema,
  aiAttachmentsSchema,
  aiAttachmentCleanupSchema,
  aiSkillsSchema,
  aiSkillPackagesSchema,
  aiArchiveAttachmentsSchema,
} from './schema.js';

/** Owns a single SQLite connection. Long-running I/O must stay outside transactions. */
export class DatabaseService {
  readonly connection: DatabaseSync;
  private closed = false;
  private depth = 0;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, 'nas-manager.sqlite');
    this.connection = new DatabaseSync(file);
    try {
      const version = Number(this.connection.prepare('PRAGMA user_version').get()?.user_version);
      if (
        version !== 0 &&
        version !== 2 &&
        version !== 3 &&
        version !== 4 &&
        version !== 5 &&
        version !== 6 &&
        version !== 7 &&
        version !== 8 &&
        version !== 9 &&
        version !== 10 &&
        version !== 11 &&
        version !== 12 &&
        version !== 13 &&
        version !== 14 &&
        version !== 15 &&
        version !== 16 &&
        version !== 17 &&
        version !== 18 &&
        version !== 19 &&
        version !== 20 &&
        version !== 21 &&
        version !== 22 &&
        version !== 23 &&
        version !== 24 &&
        version !== 25 &&
        version !== 26 &&
        version !== 27 &&
        version !== 28 &&
        version !== 29 &&
        version !== 30 &&
        version !== 31 &&
        version !== 32 &&
        version !== SCHEMA_VERSION
      )
        throw new Error(
          version < SCHEMA_VERSION ? '数据库需要先运行独立升级工具' : '数据库版本高于当前应用版本',
        );
      if (
        version === 0 &&
        this.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length
      )
        throw new Error('未标记版本的数据库不能自动升级');
      if (
        version === 0 &&
        [
          'entries.json',
          'tasks.json',
          'terminal/connections.json',
          'storage/scan-history.json',
        ].some((file) => existsSync(path.join(dataDir, file)))
      )
        throw new Error('检测到旧数据，必须先完成独立升级，不能创建空数据库');
      chmodSync(file, 0o600);
      this.connection.exec(
        'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON',
      );
      if (version === 0) this.transaction(() => this.connection.exec(schema));
      if (version === 2)
        this.transaction(() => {
          this.connection.exec(aiSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(3,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=3');
        });
      if (version === 2 || version === 3)
        this.transaction(() => {
          this.connection.exec(aiProfilesSchema);
          this.connection
            .exec(`INSERT INTO ai_providers(id,owner_uid,name,protocol,base_url,model,api_key,created_at,updated_at)
            SELECT 'migrated-' || lower(hex(randomblob(12))),owner_uid,'默认供应商','openai',base_url,model,api_key,updated_at,updated_at FROM ai_settings;
            DROP TABLE ai_settings;`);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(4,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=4');
        });
      if ([2, 3, 4].includes(version))
        this.transaction(() => {
          this.connection.exec(aiReasoningSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(5,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=5');
        });
      if (version !== 0 && version < 6)
        this.transaction(() => {
          this.connection.exec(catalogSchema);
          for (const row of this.connection.prepare('SELECT id FROM icons').all()) {
            const id = String(row.id);
            if (!/^[a-z0-9]{6,32}$/.test(id)) continue;
            const file = path.join(dataDir, 'icons', id + '.png');
            if (existsSync(file))
              this.connection
                .prepare('INSERT OR IGNORE INTO icon_images(icon_id,image)VALUES(?,?)')
                .run(id, readFileSync(file));
          }
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(6,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=6');
        });
      if (version !== 0 && version < 7)
        this.transaction(() => {
          this.connection.exec(settingsSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(7,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=7');
        });
      if (version !== 0 && version < 8)
        this.transaction(() => {
          this.connection.exec(menuEntrySchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(8,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=8');
        });
      if (version !== 0 && version < 9)
        this.transaction(() => {
          this.connection.exec(aiAttachmentsSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(9,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=9');
        });
      if (version !== 0 && version < 10)
        this.transaction(() => {
          this.connection.exec(aiAttachmentCleanupSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(10,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=10');
        });
      if (version !== 0 && version < 11)
        this.transaction(() => {
          this.connection.exec(aiSkillsSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(11,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=11');
        });
      if (version !== 0 && version < 12)
        this.transaction(() => {
          this.connection.exec(aiSkillPackagesSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(12,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=12');
        });
      if (version !== 0 && version < 13)
        this.transaction(() => {
          this.connection.exec(aiArchiveAttachmentsSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(13,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=13');
        });
      if (version !== 0 && version < 14)
        this.transaction(() => {
          this.connection.exec(backupSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(14,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=14');
        });
      if (version !== 0 && version < 15)
        this.transaction(() => {
          this.connection.exec(notificationSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(15,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=15');
        });
      if (version !== 0 && version < 16)
        this.transaction(() => {
          this.connection.exec(operationSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(16,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=16');
        });
      if (version !== 0 && version < 17)
        this.transaction(() => {
          this.connection.exec(reachabilitySchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(17,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=17');
        });
      if (version !== 0 && version < 18)
        this.transaction(() => {
          this.connection.exec(textVersionsSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(18,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=18');
        });
      if (version !== 0 && version < 19)
        this.transaction(() => {
          this.connection.exec(vncSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(19,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=19');
        });
      if (version !== 0 && version < 20)
        this.transaction(() => {
          this.connection.exec(vncPreferencesSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(20,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=20');
        });
      if (version !== 0 && version < 21)
        this.transaction(() => {
          this.connection.exec(retentionSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(21,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=21');
        });
      if (version !== 0 && version < 22)
        this.transaction(() => {
          this.connection.exec(vncCursorSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(22,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=22');
        });
      if (version !== 0 && version < 23)
        this.transaction(() => {
          this.connection.exec(rdpBaseSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(23,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=23');
        });
      if (version !== 0 && version < 24)
        this.transaction(() => {
          this.connection.exec(appearanceSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(24,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=24');
        });
      if (version !== 0 && version < 25) {
        // Preserve catalog children while expanding the parent table CHECK constraint.
        this.connection.exec('PRAGMA foreign_keys=OFF');
        try {
          this.transaction(() => {
            const source = String(
              this.connection
                .prepare(
                  "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_preferences'",
                )
                .get()?.sql || '',
            );
            if (!source.includes('palette')) throw new Error('偏好表结构无效');
            const expanded = source
              .replace(/palette IN \([^)]+\)/, "palette IN ('classic','mist','teal','default')")
              .replace(
                /CREATE TABLE (?:IF NOT EXISTS )?"?user_preferences"?/,
                'CREATE TABLE user_preferences_new',
              );
            this.connection.exec(expanded);
            this.connection.exec(
              'INSERT INTO user_preferences_new SELECT * FROM user_preferences; DROP TABLE user_preferences; ALTER TABLE user_preferences_new RENAME TO user_preferences',
            );
            if (this.connection.prepare('PRAGMA foreign_key_check').all().length)
              throw new Error('偏好迁移外键检查失败');
            this.connection
              .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(25,?)')
              .run(Date.now());
            this.connection.exec('PRAGMA user_version=25');
          });
        } finally {
          this.connection.exec('PRAGMA foreign_keys=ON');
        }
      }
      if (version !== 0 && version < 26)
        this.transaction(() => {
          this.connection.exec(updatePolicySchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(26,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=26');
        });
      if (version !== 0 && version < 27)
        this.transaction(() => {
          this.connection.exec(rdpSecuritySchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(27,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=27');
        });
      if (version !== 0 && version < 28)
        this.transaction(() => {
          if (version >= 26)
            this.connection.exec(
              "ALTER TABLE update_settings ADD COLUMN download_route TEXT NOT NULL DEFAULT 'direct' CHECK(download_route IN ('direct','mirror'))",
            );
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(28,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=28');
        });
      if (version !== 0 && version < 29)
        this.transaction(() => {
          this.connection.exec(adbSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(29,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=29');
        });
      if (version !== 0 && version < 30)
        this.transaction(() => {
          this.connection.exec(notificationOptionsSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(30,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=30');
        });
      if (version !== 0 && version < 31)
        this.transaction(() => {
          this.connection.exec(notificationTemplatesSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(31,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=31');
        });
      if (version !== 0 && version < 32)
        this.transaction(() => {
          this.connection.exec(reminderSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(32,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=32');
        });
      if (version !== 0 && version < 33)
        this.transaction(() => {
          this.connection.exec(notificationInboxSchema);
          this.connection
            .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(33,?)')
            .run(Date.now());
          this.connection.exec('PRAGMA user_version=33');
        });
      // Remove old files only after the committed BLOB equals the original bytes.
      for (const row of this.connection.prepare('SELECT icon_id,image FROM icon_images').all()) {
        const id = String(row.icon_id);
        if (!/^[a-z0-9]{6,32}$/.test(id)) continue;
        const file = path.join(dataDir, 'icons', id + '.png');
        try {
          if (Buffer.from(row.image as Uint8Array).equals(readFileSync(file))) unlinkSync(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      try {
        rmdirSync(path.join(dataDir, 'icons'));
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || ''))
          throw error;
      }
    } catch (error) {
      this.connection.close();
      this.closed = true;
      throw error;
    }
  }

  transaction<T>(work: () => T): T {
    // Reject async functions before their body can mutate state after a rollback.
    if (work.constructor.name === 'AsyncFunction') throw new Error('数据库事务必须使用同步回调');
    const nested = this.depth > 0;
    const point = `nested_${this.depth}`;
    this.connection.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = work();
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw new Error('数据库事务必须使用同步回调');
      this.connection.exec(nested ? `RELEASE ${point}` : 'COMMIT');
      return result;
    } catch (error) {
      this.connection.exec(nested ? `ROLLBACK TO ${point}; RELEASE ${point}` : 'ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }
}

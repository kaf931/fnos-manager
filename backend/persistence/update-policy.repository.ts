import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import type { UpdateMode, UpdateDownloadRoute, UpdateSettings } from '../domain/updates.js';
export type { UpdateMode } from '../domain/updates.js';
@Injectable()
export class UpdatePolicyRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  get(): UpdateSettings {
    const row = this.database.connection
      .prepare('SELECT mode,download_route FROM update_settings WHERE id=1')
      .get();
    return {
      mode: row?.mode === 'auto' ? 'auto' : 'manual',
      downloadRoute: row?.download_route === 'mirror' ? 'mirror' : 'direct',
    };
  }
  save(mode?: UpdateMode, downloadRoute?: UpdateDownloadRoute) {
    const previous = this.get();
    this.database.connection
      .prepare(
        "INSERT INTO update_settings(id,mode,download_route,last_version,last_attempt) VALUES(1,?,?,'',0) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,download_route=excluded.download_route,last_version='',last_attempt=0",
      )
      .run(mode ?? previous.mode, downloadRoute ?? previous.downloadRoute);
    return this.get();
  }
  canAttempt(version: string, now = Date.now()): boolean {
    const row = this.database.connection
      .prepare('SELECT last_version,last_attempt FROM update_settings WHERE id=1')
      .get();
    return (
      !row || row.last_version !== version || now - Number(row.last_attempt) >= 6 * 60 * 60 * 1000
    );
  }
  attempted(version: string) {
    this.database.connection
      .prepare('UPDATE update_settings SET last_version=?,last_attempt=? WHERE id=1')
      .run(version, Date.now());
  }
}

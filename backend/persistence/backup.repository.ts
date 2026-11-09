import { RetentionRepository } from './retention.repository.js';
import { AdbRepository } from './adb.repository.js';
import { RdpRepository } from './rdp.repository.js';
import { VncRepository } from './vnc.repository.js';
import { randomBytes } from 'node:crypto';
import type { BackupItem, RestoreResult } from '../domain/backup.js';
import type { TaskRecord } from '../domain/tasks.js';
import type { TerminalConnection, WorkspaceItem } from '../domain/terminal.js';
import type { WakeDevice } from '../domain/wake.js';
import type { IconEntry } from '../domain/icons.js';
import type { AiProtocol } from '../domain/ai.js';
import { pendingReason } from '../backup/validation.js';
import type { DatabaseService } from './database.service.js';
import { TerminalRepository } from './terminal.repository.js';
import { WorkspaceRepository } from './workspace.repository.js';
import { TaskRepository } from './task.repository.js';
import { WakeRepository } from './wake.repository.js';
import { IconRepository } from './icon.repository.js';
import { AiSettingsRepository } from './ai.repository.js';
import { PreferencesRepository, type UserPreferences } from './preferences.repository.js';
import { insert, text } from './records.js';
import { DEVICE_TASK_ACTIONS } from '../tasks/model.js';
const select = (row: object, fields: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)));
/** All reads/writes in this repository are synchronous, including transaction callbacks. */
export class BackupRepository {
  constructor(readonly database: DatabaseService) {}
  transaction<T>(work: () => T): T {
    return this.database.transaction(work);
  }
  snapshot(owner: string): BackupItem[] {
    const items: BackupItem[] = [];
    const add = (kind: BackupItem['kind'], id: string, data: Record<string, unknown>) =>
      items.push({ kind, id, data });
    const icons = new IconRepository(this.database);
    for (const row of icons.list()) {
      const data = select(row, ['name', 'url', 'mode', 'containerId', 'menuPage', 'iconSource']);
      const image = this.database.connection
        .prepare('SELECT image FROM icon_images WHERE icon_id=?')
        .get(row.id)?.image;
      if (image instanceof Uint8Array) data.image = Buffer.from(image).toString('base64');
      add('icons', row.id, data);
    }
    for (const row of new WorkspaceRepository(this.database).list(owner))
      add(
        row.kind === 'folder' ? 'folders' : 'shortcuts',
        row.id,
        select(
          row,
          row.kind === 'folder' ? ['name', 'scope', 'parentId'] : ['name', 'content', 'parentId'],
        ),
      );
    for (const row of new TerminalRepository(this.database).list(owner))
      add(
        'connections',
        row.id,
        select(row, [
          'name',
          'kind',
          'host',
          'port',
          'username',
          'folderId',
          'authMethod',
          'credentials',
        ]),
      );
    for (const row of new VncRepository(this.database).list(owner))
      add(
        'vnc',
        row.id,
        select(row, ['name', 'protocol', 'host', 'port', 'username', 'password', 'folderId']),
      );
    for (const row of new AdbRepository(this.database).list(owner))
      add(
        'adb',
        row.id,
        select(row, ['name', 'protocol', 'host', 'port', 'folderId', 'deviceType', 'serial']),
      );
    for (const row of new RdpRepository(this.database).list(owner))
      add(
        'rdp',
        row.id,
        select(row, [
          'name',
          'protocol',
          'host',
          'port',
          'username',
          'password',
          'domain',
          'security',
          'certificatePolicy',
          'folderId',
        ]),
      );
    for (const row of new WakeRepository(this.database).list(owner))
      add(
        'devices',
        row.id,
        select(row, ['name', 'mac', 'address', 'ip', 'port', 'system', 'connectionId']),
      );
    for (const row of new TaskRepository(this.database).list())
      if (!DEVICE_TASK_ACTIONS[row.type] || row.ownerUid === owner)
        add(
          'tasks',
          row.id,
          select(row, [
            'name',
            'type',
            'schedule',
            'timeoutSeconds',
            'retryCount',
            'missedPolicy',
            'action',
            'target',
            'script',
            'level',
            'module',
            'deviceIds',
          ]),
        );
    for (const row of new AiSettingsRepository(this.database).list(owner))
      add('providers', row.id!, select(row, ['name', 'protocol', 'baseUrl', 'model', 'apiKey']));
    for (const row of this.database.connection
      .prepare(
        'SELECT id,command,description,category FROM command_catalog WHERE owner_uid=? ORDER BY position,id',
      )
      .all(owner))
      add('commands', text(row.id), select(row, ['command', 'description', 'category']));
    add('preferences', 'singleton', { ...new PreferencesRepository(this.database).get(owner) });
    return items;
  }
  configurationState(owner: string) {
    return {
      items: this.snapshot(owner),
      tasks: this.database.connection
        .prepare(
          'SELECT id,enabled,pending_reason FROM tasks WHERE owner_uid IS NULL OR owner_uid=? ORDER BY id',
        )
        .all(owner),
      totalTasks: Number(this.database.connection.prepare('SELECT COUNT(*) n FROM tasks').get()?.n),
      totalDevices: Number(
        this.database.connection.prepare('SELECT COUNT(*) n FROM wake_devices').get()?.n,
      ),
    };
  }
  receipt(owner: string, requestId: string): { digest: string; result: RestoreResult } | undefined {
    const row = this.database.connection
      .prepare(
        'SELECT request_digest,result FROM backup_receipts WHERE owner_uid=? AND request_id=?',
      )
      .get(owner, requestId);
    return row
      ? { digest: text(row.request_digest), result: JSON.parse(text(row.result)) as RestoreResult }
      : undefined;
  }
  saveReceipt(
    owner: string,
    requestId: string,
    digest: string,
    packageDigest: string,
    selectionDigest: string,
    result: RestoreResult,
  ) {
    this.database.connection
      .prepare(
        'INSERT INTO backup_receipts(owner_uid,request_id,request_digest,package_digest,selection_digest,result,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        owner,
        requestId,
        digest,
        packageDigest,
        selectionDigest,
        JSON.stringify(result),
        Date.now(),
      );
    const retention = new RetentionRepository(this.database);
    retention.trim('restoreReceipts', retention.limits().restoreReceipts);
  }
  newId(kind: BackupItem['kind']) {
    return randomBytes(kind === 'tasks' || kind === 'icons' ? 8 : 12).toString('hex');
  }
  write(owner: string, item: BackupItem): void {
    const d = item.data,
      id = item.id,
      now = new Date().toISOString();
    switch (item.kind) {
      case 'folders':
      case 'shortcuts':
        new WorkspaceRepository(this.database).save({
          ...d,
          id,
          ownerUid: owner,
          kind: item.kind === 'folders' ? 'folder' : 'command',
          ...(item.kind === 'shortcuts' ? { scope: 'commands' } : {}),
        } as unknown as WorkspaceItem);
        break;
      case 'adb':
        new AdbRepository(this.database).insertRestored(owner, id, d);
        break;
      case 'rdp':
        new RdpRepository(this.database).insertRestored(owner, id, d);
        break;
      case 'vnc':
        new VncRepository(this.database).insertRestored(owner, id, d);
        break;
      case 'connections':
        new TerminalRepository(this.database).save({
          ...d,
          id,
          ownerUid: owner,
          createdAt: now,
          updatedAt: now,
        } as unknown as TerminalConnection);
        break;
      case 'devices':
        new WakeRepository(this.database).save({
          ...d,
          id,
          owner,
          createdAt: now,
          updatedAt: now,
        } as unknown as WakeDevice);
        break;
      case 'tasks':
        new TaskRepository(this.database).save({
          ...d,
          id,
          ...(DEVICE_TASK_ACTIONS[String(d.type)] ? { ownerUid: owner } : {}),
          enabled: false,
          acknowledged: false,
          nextRunAt: null,
          pendingReason: pendingReason(item),
          createdAt: now,
          updatedAt: now,
        } as unknown as TaskRecord);
        break;
      case 'icons':
        new IconRepository(this.database).save(
          { ...d, id, revision: 1, appliedRevision: 0, updatedAt: now } as unknown as IconEntry,
          d.image ? Buffer.from(String(d.image), 'base64') : undefined,
        );
        break;
      case 'providers':
        new AiSettingsRepository(this.database).save(
          owner,
          {
            name: String(d.name),
            protocol: d.protocol as AiProtocol,
            baseUrl: String(d.baseUrl),
            model: String(d.model),
            apiKey: String(d.apiKey ?? ''),
            updatedAt: Date.now(),
          },
          id,
        );
        break;
      case 'preferences':
        new PreferencesRepository(this.database).save(owner, d as unknown as UserPreferences);
        break;
      case 'commands': {
        const db = this.database.connection;
        db.prepare('INSERT OR IGNORE INTO user_preferences(owner_uid,updated_at) VALUES(?,?)').run(
          owner,
          Date.now(),
        );
        db.prepare('UPDATE user_preferences SET catalog_initialized=1 WHERE owner_uid=?').run(
          owner,
        );
        insert(db, 'command_catalog', {
          id,
          owner_uid: owner,
          command: String(d.command),
          description: String(d.description),
          category: String(d.category),
          position: Number(
            db
              .prepare(
                'SELECT COALESCE(MAX(position)+1,0) n FROM command_catalog WHERE owner_uid=?',
              )
              .get(owner)?.n,
          ),
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        break;
      }
    }
  }
}

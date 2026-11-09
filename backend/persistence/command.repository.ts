import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseService } from './database.service.js';
import { DomainError } from '../errors.js';
import { commandSeed } from './command-seed.js';
export interface CommandEntry {
  id: string;
  command: string;
  description: string;
  category: string;
}
export type CommandInput = Omit<CommandEntry, 'id'>;
export class CommandRepository {
  constructor(private readonly database: DatabaseService) {}
  private initialize(owner: string) {
    this.database.transaction(() => {
      const db = this.database.connection;
      db.prepare('INSERT OR IGNORE INTO user_preferences(owner_uid,updated_at) VALUES(?,?)').run(
        owner,
        Date.now(),
      );
      if (
        db.prepare('SELECT catalog_initialized FROM user_preferences WHERE owner_uid=?').get(owner)
          ?.catalog_initialized === 1
      )
        return;
      const insert = db.prepare(
        'INSERT INTO command_catalog(id,owner_uid,command,description,category,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      );
      const now = Date.now();
      commandSeed.forEach((entry, position) =>
        insert.run(
          createHash('sha256')
            .update(owner + '\0' + entry.command)
            .digest('hex')
            .slice(0, 32),
          owner,
          entry.command,
          entry.description,
          entry.category,
          position,
          now,
          now,
        ),
      );
      db.prepare('UPDATE user_preferences SET catalog_initialized=1 WHERE owner_uid=?').run(owner);
    });
  }
  list(owner: string): CommandEntry[] {
    this.initialize(owner);
    return this.database.connection
      .prepare(
        'SELECT id,command,description,category FROM command_catalog WHERE owner_uid=? ORDER BY position,command',
      )
      .all(owner) as unknown as CommandEntry[];
  }
  save(owner: string, input: CommandInput, id?: string): CommandEntry {
    this.initialize(owner);
    const entry = {
      id: id || randomBytes(16).toString('hex'),
      command: input.command.trim(),
      description: input.description.trim(),
      category: input.category.trim(),
    };
    if (!entry.command || !entry.description || !entry.category)
      throw new DomainError('请填写命令、说明和分类');
    return this.database.transaction(() => {
      const db = this.database.connection;
      const old = id
        ? db
            .prepare('SELECT position FROM command_catalog WHERE owner_uid=? AND id=?')
            .get(owner, id)
        : undefined;
      if (id && !old) throw new DomainError('命令不存在', 404);
      if (
        db
          .prepare('SELECT 1 FROM command_catalog WHERE owner_uid=? AND command=? AND id<>?')
          .get(owner, entry.command, entry.id)
      )
        throw new DomainError('该命令已存在', 409);
      const now = Date.now();
      if (id)
        db.prepare(
          'UPDATE command_catalog SET command=?,description=?,category=?,updated_at=? WHERE owner_uid=? AND id=?',
        ).run(entry.command, entry.description, entry.category, now, owner, id);
      else
        db.prepare(
          'INSERT INTO command_catalog(id,owner_uid,command,description,category,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          entry.id,
          owner,
          entry.command,
          entry.description,
          entry.category,
          Number(
            db
              .prepare(
                'SELECT COALESCE(MAX(position)+1,0) n FROM command_catalog WHERE owner_uid=?',
              )
              .get(owner)?.n,
          ),
          now,
          now,
        );
      return entry;
    });
  }
  remove(owner: string, id: string): void {
    if (
      !this.database.connection
        .prepare('DELETE FROM command_catalog WHERE owner_uid=? AND id=?')
        .run(owner, id).changes
    )
      throw new DomainError('命令不存在', 404);
  }
}

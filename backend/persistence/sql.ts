import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { integer } from './records.js';
export function upsert(
  db: DatabaseSync,
  table: string,
  values: Record<string, SQLInputValue>,
  keys: string[] = ['id'],
): void {
  const columns = Object.keys(values);
  db.prepare(
    `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(${keys.join(',')}) DO UPDATE SET ${columns
      .filter((c) => !keys.includes(c))
      .map((c) => `${c}=excluded.${c}`)
      .join(',')}`,
  ).run(...Object.values(values));
}
export function position(db: DatabaseSync, table: string, id: string): number {
  const old = db.prepare(`SELECT position FROM ${table} WHERE id=?`).get(id);
  return integer(
    old?.position ?? db.prepare(`SELECT COALESCE(MAX(position)+1,0) n FROM ${table}`).get()?.n,
  );
}
export function iso(value: unknown): string | undefined {
  return value == null ? undefined : new Date(integer(value)).toISOString();
}

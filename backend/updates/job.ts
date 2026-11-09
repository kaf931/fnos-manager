import { readFile, rename, writeFile } from 'node:fs/promises';
export type UpdatePhase =
  | 'waiting'
  | 'cancelled'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'rolled-back';
export interface UpdateJob {
  id: string;
  version: string;
  phase: UpdatePhase;
  received: number;
  total: number;
  message: string;
  pid: number;
  updatedAt: number;
}
export interface UpdateSpec {
  automatic?: boolean;
  downloadRoute?: import('../domain/updates.js').UpdateDownloadRoute;
  jobDir: string;
  root: string;
  dataDir: string;
  serviceScript: string;
  version: string;
  architecture: string;
  previousVersion: string;
  asset: { url: string; size: number; sha256: string };
}
export const terminalPhase = (phase: UpdatePhase) =>
  ['completed', 'failed', 'rolled-back', 'cancelled'].includes(phase);
export async function writeJob(file: string, state: UpdateJob): Promise<void> {
  state.updatedAt = Date.now();
  await writeFile(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
  await rename(file + '.tmp', file);
}
export async function readJob(file: string): Promise<UpdateJob | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as UpdateJob;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

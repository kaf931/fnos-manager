import {
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import type { SkillArchive, SkillPackageRef } from '../../../domain/ai-skill-packages.js';
import { skillResourcePath, digest } from './archive.js';
export class SkillPackageStore {
  readonly root: string;
  private refs = new Map<string, number>();
  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'ai-skill-packages');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(this.root);
  }
  directory(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('技能包标识无效');
    return path.join(this.root, id);
  }
  write(id: string, archive: SkillArchive) {
    const target = this.directory(id),
      temp = target + '.tmp';
    mkdirSync(temp, { mode: 0o700 });
    try {
      for (const f of archive.files) {
        const dest = path.join(temp, skillResourcePath(f.path));
        mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, f.bytes, { mode: 0o600, flag: 'wx' });
      }
      renameSync(temp, target);
    } catch (e) {
      rmSync(temp, { recursive: true, force: true });
      throw e;
    }
  }
  read(id: string, file: string, sha: string) {
    const root = this.directory(id),
      target = path.join(root, skillResourcePath(file));
    if (
      lstatSync(root).isSymbolicLink() ||
      realpathSync(target) !== target ||
      !lstatSync(target).isFile()
    )
      throw Error('技能资源路径或类型无效');
    const bytes = readFileSync(target);
    if (digest(bytes) !== sha) throw Error('技能文件摘要不匹配');
    return bytes;
  }
  acquire(ref: SkillPackageRef) {
    this.refs.set(ref.packageId, (this.refs.get(ref.packageId) || 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const n = (this.refs.get(ref.packageId) || 1) - 1;
        if (n) this.refs.set(ref.packageId, n);
        else this.refs.delete(ref.packageId);
      },
    };
  }
  remove(id: string) {
    if (!this.refs.has(id)) rmSync(this.directory(id), { recursive: true, force: true });
  }
  sweep(live: Set<string>) {
    for (const d of readdirSync(this.root)) {
      if (d.endsWith('.tmp') || (!live.has(d) && !this.refs.has(d))) {
        if (/^[a-f0-9-]{36}(\.tmp)?$/.test(d))
          rmSync(path.join(this.root, d), { recursive: true, force: true });
      }
    }
  }
}

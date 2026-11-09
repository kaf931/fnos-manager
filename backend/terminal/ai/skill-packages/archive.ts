import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { SKILL_PACKAGE_LIMITS as L, type SkillArchive } from '../../../domain/ai-skill-packages.js';
import { parseSkillDocument } from '../skills.js';
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function skillResourcePath(value: string): string {
  if (
    !value ||
    value.length > 512 ||
    /[\\\x00-\x1f\x7f:]/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw Error('技能资源路径无效');
  return value;
}
export async function readSkillArchive(bytes: Buffer, signal: AbortSignal): Promise<SkillArchive> {
  signal.throwIfAborted();
  if (bytes.length > L.zip) throw Error('ZIP 不能超过 10 MiB');
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true },
      (e, z) => (e || !z ? reject(e || Error('ZIP 无效')) : resolve(z)),
    ),
  );
  return new Promise((resolve, reject) => {
    let count = 0,
      total = 0,
      ended = false;
    const paths = new Set<string>();
    const files: Array<{
      path: string;
      bytes: Buffer;
      sha256: string;
      size: number;
      text: boolean;
    }> = [];
    const fail = (error: unknown) => {
      if (ended) return;
      ended = true;
      signal.removeEventListener('abort', abort);
      zip.close();
      reject(error);
    };
    const abort = () => fail(signal.reason || Error('已取消导入'));
    signal.addEventListener('abort', abort, { once: true });
    zip.on('error', fail);
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        signal.throwIfAborted();
        if (++count > L.entries) throw Error('ZIP 最多 512 个条目');
        const dir = entry.fileName.endsWith('/'),
          name = skillResourcePath(dir ? entry.fileName.slice(0, -1) : entry.fileName),
          mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (
          paths.has(name) ||
          entry.generalPurposeBitFlag & 1 ||
          mode === 0xa000 ||
          (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)
        )
          throw Error('ZIP 包含重复、加密或非普通文件');
        for (const old of files)
          if (
            old.path === name ||
            name.startsWith(old.path + '/') ||
            (!dir && old.path.startsWith(name + '/'))
          )
            throw Error('ZIP 文件目录冲突');
        paths.add(name);
        if (dir) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > L.file || total + entry.uncompressedSize > L.total)
          throw Error('技能包展开大小超限');
        const data = await new Promise<Buffer>((ok, no) =>
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) {
              no(e || Error('无法读取 ZIP'));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', no);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (signal.aborted || size > L.file || total + size > L.total)
                stream.destroy(Error('技能包展开大小超限或已取消'));
              else chunks.push(chunk);
            });
            stream.on('end', () => ok(Buffer.concat(chunks)));
          }),
        );
        if (crc32(data) !== entry.crc32) throw Error('ZIP 校验失败');
        total += data.length;
        let text = true;
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(data);
          if (data.includes(0)) text = false;
        } catch {
          text = false;
        }
        files.push({ path: name, bytes: data, size: data.length, sha256: digest(data), text });
        zip.readEntry();
      })().catch(fail);
    });
    zip.on('end', () => {
      if (ended) return;
      try {
        signal.throwIfAborted();
        const roots = files.filter((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
        if (roots.length !== 1) throw Error('ZIP 必须包含唯一 SKILL.md');
        const root = roots[0]!,
          prefix = root.path.slice(0, -8);
        if (
          prefix.split('/').filter(Boolean).length > 1 ||
          files.some((f) => !f.path.startsWith(prefix))
        )
          throw Error('技能包根目录无效');
        if (files.some((f) => f.path === prefix + '.nas-manager-skill-complete'))
          throw Error('技能包使用了保留文件名');
        if (!root.text) throw Error('SKILL.md 必须是 UTF-8 文本');
        const definition = parseSkillDocument(root.bytes.toString('utf8'));
        ended = true;
        signal.removeEventListener('abort', abort);
        resolve({
          definition,
          sha256: digest(bytes),
          files: files.map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
        });
      } catch (e) {
        fail(e);
      }
    });
    zip.readEntry();
  });
}

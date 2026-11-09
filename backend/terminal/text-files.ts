import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Stats, SFTPWrapper } from 'ssh2';
import { SessionFiles, validPath } from './files.js';
import { fail } from './model.js';
import { decodeText, encodeText, MAX_TEXT_BYTES, textEncoding } from './text-codec.js';
const metadata = (s: Stats) => [s.size, s.mtime, s.mode, s.uid, s.gid];
const version = (data: Buffer, s: Stats) =>
  createHash('sha256')
    .update(data)
    .update(JSON.stringify(metadata(s)))
    .digest('hex');
async function snapshot(files: SessionFiles, channel: SFTPWrapper, target: string) {
  const before = await files.handleCall(channel, 'lstat', target);
  if (!before.isFile()) throw fail('仅支持编辑普通文件，不支持目录或符号链接');
  if (before.size > MAX_TEXT_BYTES) throw fail('在线编辑文件不能超过 10 MiB', 413);
  let handle: Buffer | undefined;
  try {
    handle = await files.handleCall(channel, 'open', target, 'r');
    const info = await files.handleCall(channel, 'fstat', handle);
    if (!info.isFile() || JSON.stringify(metadata(info)) !== JSON.stringify(metadata(before)))
      throw fail('文件已变化，请重新读取', 409);
    const chunks: Buffer[] = [];
    let offset = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_TEXT_BYTES + 1 - offset));
      const count = await files.handleCall(
        channel,
        'read',
        handle,
        buffer,
        0,
        buffer.length,
        offset,
      );
      if (!count) break;
      offset += count;
      if (offset > MAX_TEXT_BYTES) throw fail('在线编辑文件不能超过 10 MiB', 413);
      chunks.push(buffer.subarray(0, count));
    }
    const after = await files.handleCall(channel, 'fstat', handle);
    const current = await files.handleCall(channel, 'lstat', target);
    if (
      offset !== info.size ||
      JSON.stringify(metadata(after)) !== JSON.stringify(metadata(info)) ||
      !current.isFile() ||
      JSON.stringify(metadata(current)) !== JSON.stringify(metadata(info))
    )
      throw fail('文件读取期间已变化，请重新读取', 409);
    const data = Buffer.concat(chunks);
    return { data, info, revision: version(data, info) };
  } finally {
    if (handle) await files.handleCall(channel, 'close', handle).catch(() => {});
  }
}
export async function checkTextFileAccess(files: SessionFiles, p: unknown) {
  const target = validPath(p);
  files.check();
  if (files.readers >= 2) throw fail('已有文件正在读取，请稍后重试', 409);
  files.readers++;
  try {
    await snapshot(files, await files.channel(), target);
    files.check();
  } finally {
    files.readers--;
  }
}
export async function readTextFile(files: SessionFiles, p: unknown, encoding?: unknown) {
  const target = validPath(p);
  files.check();
  if (files.readers >= 2) throw fail('已有文件正在读取，请稍后重试', 409);
  files.readers++;
  try {
    const result = await snapshot(files, await files.channel(), target);
    const decoded = decodeText(result.data, encoding);
    files.textEncodings.set(result.revision, decoded.encoding);
    if (files.textEncodings.size > 64)
      files.textEncodings.delete(files.textEncodings.keys().next().value!);
    return {
      ...decoded,
      revision: result.revision,
      size: result.data.length,
    };
  } finally {
    files.readers--;
  }
}
export async function saveTextFile(
  files: SessionFiles,
  input: {
    path: string;
    content: string;
    encoding: string;
    bom: boolean;
    revision: string;
    backup?: boolean;
  },
) {
  const target = validPath(input.path);
  const data = encodeText(input.content, textEncoding(input.encoding), input.bom);
  return files.write(async () => {
    const channel = await files.channel();
    const original = await snapshot(files, channel, target);
    if (original.revision !== input.revision)
      throw fail('远端文件已被修改，请重新读取后再保存；当前编辑内容未丢失', 409);
    // Verify write permission without truncating the original file.
    const writable = await files.handleCall(channel, 'open', target, 'r+');
    await files.handleCall(channel, 'close', writable);
    if (input.backup !== false)
      await files.textVersions?.capture(
        target,
        original.data,
        files.textEncodings.get(input.revision) ?? input.encoding,
      );
    files.check();
    const temp = path.posix.join(
      path.posix.dirname(target),
      '.nas-manager-edit-' + randomBytes(16).toString('hex'),
    );
    let handle: Buffer | undefined;
    let created = false;
    try {
      handle = await files.handleCall(channel, 'open', temp, 'wx', { mode: 0o600 });
      created = true;
      for (let offset = 0; offset < data.length; offset += 65536) {
        const length = Math.min(65536, data.length - offset);
        await files.handleCall(channel, 'write', handle, data, offset, length, offset);
      }
      await files.handleCall(channel, 'fsetstat', handle, {
        uid: original.info.uid,
        gid: original.info.gid,
      });
      await files.handleCall(channel, 'fsetstat', handle, { mode: original.info.mode & 0o7777 });
      await files.handleCall(channel, 'close', handle);
      handle = undefined;
      const check = await snapshot(files, channel, target);
      if (check.revision !== input.revision)
        throw fail('远端文件已被修改，请重新读取后再保存；当前编辑内容未丢失', 409);
      try {
        await files.handleCall(channel, 'ext_openssh_rename', temp, target);
      } catch {
        throw fail(
          '原子替换未确认成功，请重新读取检查；当前编辑内容已保留。目标需支持 OpenSSH SFTP 原子重命名',
        );
      }
      created = false;
      const updated = await snapshot(files, channel, target);
      if (!updated.data.equals(data))
        throw fail('文件已写入，但随后被其他程序修改，请重新读取确认', 409);
      return {
        ...decodeText(updated.data, input.encoding),
        revision: updated.revision,
        size: updated.data.length,
      };
    } finally {
      if (handle) await files.handleCall(channel, 'close', handle).catch(() => {});
      if (created) await files.handleCall(channel, 'unlink', temp).catch(() => {});
    }
  });
}

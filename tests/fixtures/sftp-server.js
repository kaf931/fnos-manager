import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import ssh2 from 'ssh2';
const S = ssh2.utils.sftp.STATUS_CODE;
export function attachSftp(session, root) {
  root = realpathSync(root);
  session.on('sftp', (accept) => {
    const stream = accept(),
      handles = new Map();
    let next = 0;
    const local = (p) => {
      const resolved = path.resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
      if (resolved !== root && !resolved.startsWith(root + path.sep)) throw Error('escape');
      return resolved;
    };
    const attrs = (a) => ({
      mode: a.mode,
      uid: a.uid,
      gid: a.gid,
      size: a.size,
      atime: Math.floor(a.atimeMs / 1000),
      mtime: Math.floor(a.mtimeMs / 1000),
    });
    const wrap = (event, fn) =>
      stream.on(event, async (id, ...args) => {
        try {
          await fn(id, ...args);
        } catch (e) {
          stream.status(
            id,
            e.code === 'ENOENT'
              ? S.NO_SUCH_FILE
              : e.code === 'EACCES'
                ? S.PERMISSION_DENIED
                : S.FAILURE,
            e.code || 'failure',
          );
        }
      });
    const put = (h) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(++next);
      handles.set(next, h);
      return b;
    };
    const get = (h) => handles.get(h.readUInt32BE());
    wrap('REALPATH', async (id, p) => {
      const f = await fs.realpath(local(p === '.' ? '/' : p));
      stream.name(id, [{ filename: '/' + path.relative(root, f), longname: '', attrs: {} }]);
    });
    for (const method of ['STAT', 'LSTAT'])
      wrap(method, async (id, p) =>
        stream.attrs(id, attrs(await fs[method === 'STAT' ? 'stat' : 'lstat'](local(p)))),
      );
    wrap('OPENDIR', async (id, p) => {
      if (p === '/denied') {
        const e = Error();
        e.code = 'EACCES';
        throw e;
      }
      const list = await fs.readdir(local(p));
      stream.handle(id, put({ dir: local(p), names: list, index: 0 }));
    });
    wrap('READDIR', async (id, h) => {
      const v = get(h);
      if (v.index >= v.names.length) return stream.status(id, S.EOF);
      const batch = v.names.slice(v.index, v.index + 64);
      v.index += batch.length;
      stream.name(
        id,
        await Promise.all(
          batch.map(async (name) => ({
            filename: name,
            longname: name,
            attrs: attrs(await fs.lstat(path.join(v.dir, name))),
          })),
        ),
      );
    });
    wrap('CLOSE', async (id, h) => {
      const v = get(h);
      handles.delete(h.readUInt32BE());
      await v?.file?.close();
      stream.status(id, S.OK);
    });
    wrap('OPEN', async (id, p, flags, a) => {
      const file = await fs.open(local(p), ssh2.utils.sftp.flagsToString(flags), a.mode);
      stream.handle(id, put({ file }));
    });
    wrap('FSTAT', async (id, h) => stream.attrs(id, attrs(await get(h).file.stat())));
    wrap('FSETSTAT', async (id, h, a) => {
      if (a.uid !== undefined && a.gid !== undefined) await get(h).file.chown(a.uid, a.gid);
      if (a.mode !== undefined) await get(h).file.chmod(a.mode);
      stream.status(id, S.OK);
    });
    wrap('READ', async (id, h, offset, len) => {
      const b = Buffer.alloc(Math.min(len, 32768));
      const { bytesRead } = await get(h).file.read(b, 0, b.length, offset);
      bytesRead ? stream.data(id, b.subarray(0, bytesRead)) : stream.status(id, S.EOF);
    });
    wrap('WRITE', async (id, h, offset, b) => {
      await get(h).file.write(b, 0, b.length, offset);
      stream.status(id, S.OK);
    });
    wrap('SETSTAT', async (id, p, a) => {
      if (a.mode !== undefined) await fs.chmod(local(p), a.mode);
      stream.status(id, S.OK);
    });
    wrap('MKDIR', async (id, p, a) => {
      await fs.mkdir(local(p), { mode: a.mode });
      stream.status(id, S.OK);
    });
    wrap('RENAME', async (id, a, b) => {
      try {
        await fs.lstat(local(b));
        throw Object.assign(Error(), { code: 'EEXIST' });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      await fs.rename(local(a), local(b));
      stream.status(id, S.OK);
    });
    wrap('REMOVE', async (id, p) => {
      await fs.unlink(local(p));
      stream.status(id, S.OK);
    });
    wrap('RMDIR', async (id, p) => {
      await fs.rmdir(local(p));
      stream.status(id, S.OK);
    });
    stream.on('close', () => {
      for (const v of handles.values()) v.file?.close().catch(() => {});
      handles.clear();
    });
  });
}

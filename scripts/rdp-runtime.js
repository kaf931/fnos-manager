import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertTargetElf } from './package-target.js';
/** Fail closed when an incomplete or wrong-architecture native bundle is packaged. */
export async function verifyRdpRuntime(root, arch) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.arch !== arch || manifest.version !== '1.6.0')
    throw new Error('RDP 运行组件版本或架构不匹配');
  for (const required of ['bin/guacd', 'bin/guacd.bin', 'lib/libguac-client-rdp.so'])
    if (!manifest.files?.[required]) throw new Error(`RDP 运行组件缺失: ${required}`);
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (path.isAbsolute(name) || name.split('/').includes('..'))
      throw new Error('RDP 清单路径无效');
    const bytes = await readFile(path.join(root, name));
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error(`RDP 运行组件校验失败: ${name}`);
    if (bytes.subarray(0, 4).toString('hex') === '7f454c46') assertTargetElf(bytes, arch, name);
  }
}

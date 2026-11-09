import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertTargetElf } from './package-target.js';
export async function verifyAdbRuntime(root, arch) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.arch !== arch || manifest.version !== '1:34.0.5-12')
    throw Error('ADB 运行组件版本或架构不匹配');
  for (const name of ['bin/adb', 'bin/adb.bin'])
    if (!manifest.files?.[name]) throw Error('ADB 运行组件缺失: ' + name);
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (path.isAbsolute(name) || name.split('/').includes('..')) throw Error('ADB 清单路径无效');
    const bytes = await readFile(path.join(root, name));
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw Error('ADB 运行组件校验失败: ' + name);
    if (bytes.subarray(0, 4).toString('hex') === '7f454c46') assertTargetElf(bytes, arch, name);
  }
}

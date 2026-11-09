/** Target binaries stay separate from the host fnpack used to produce the FPK. */
const targets = Object.freeze({
  x64: {
    platform: 'x86',
    machine: 62,
    fnpackVersion: '1.2.3',
    fnpackSha256: '54b97fa7b70968c4d05c79840f5daeff508957d0bb2062fdb0376d00d9615c93',
    cliArchive: '67a5c9059d06a2870783ecfbaf4f75c8229ddf0bfee39aec3e16e63982c823f1',
    cliBinary: '9acad5f7bde4b4b836696d56607058fbf42a58b79a8f45fe0df2f664ab8d2df9',
  },
  arm64: {
    platform: 'arm',
    machine: 183,
    fnpackVersion: '1.2.1',
    fnpackSha256: 'aad9e16b101267d30017f39ab969e3c085fbce209716f8bd3b1e167eaf15e0cf',
    cliArchive: '209889e20c240fe0a917fdc66b63d358ebf46460fba83b7804b9f5ad08eab524',
    cliBinary: 'ffdd184be462975bffca493f4dca5dda789810b1f3ecded890961a5dd1409fc1',
  },
});
export function packageTarget(arch) {
  if (!Object.hasOwn(targets, arch)) throw new Error('仅支持 x64 或 arm64 打包架构');
  return targets[arch];
}
export function assertTargetElf(bytes, arch, name) {
  const target = packageTarget(arch);
  if (
    bytes.length < 20 ||
    bytes.toString('hex', 0, 4) !== '7f454c46' ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== target.machine
  )
    throw new Error(`目标二进制架构不匹配: ${name} (${arch})`);
}

"""Extract only trusted runtime payload after SHA-256 verification, without executing package hooks."""
import json, os, pathlib, shutil, sys, tarfile

def unpack(archive, destination, version, architecture):
    destination = pathlib.Path(destination)
    destination.mkdir(mode=0o700)
    manifest = None
    inner = destination.parent / 'payload.tgz'
    with tarfile.open(archive, 'r:*') as outer:
        manifests = [m for m in outer.getmembers() if m.name.lstrip('./') == 'manifest']
        payloads = [m for m in outer.getmembers() if m.name.lstrip('./') == 'app.tgz']
        if len(manifests) != 1 or len(payloads) != 1:
            raise ValueError('安装包结构无效')
        m, payload = manifests[0], payloads[0]
        if not m.isfile() or m.size > 65536 or not payload.isfile() or payload.size > 512*1024*1024:
            raise ValueError('安装包结构无效')
        manifest = dict(line.split('=', 1) for line in outer.extractfile(m).read().decode().splitlines() if '=' in line)
        manifest = {k.strip(): v.strip() for k,v in manifest.items()}
        if manifest.get('appname') != 'deskicons' or manifest.get('version') != version:
            raise ValueError('安装包应用或版本不匹配')
        if manifest.get('platform') != {'x64':'x86', 'arm64':'arm'}.get(architecture):
            raise ValueError('安装包架构不匹配')
        with open(inner, 'xb') as target:
            shutil.copyfileobj(outer.extractfile(payload), target)
    links, seen, total = [], set(), 0
    root = destination.resolve()
    def inside(p):
        return p.resolve().is_relative_to(root)
    with tarfile.open(inner, 'r:gz') as tar:
        for i, member in enumerate(tar):
            if i > 150000:
                raise ValueError('安装包文件数量过多')
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts:
                raise ValueError('安装包包含越界路径')
            if str(name) == '.':
                continue
            if str(name) in seen:
                raise ValueError('安装包包含重复路径')
            seen.add(str(name))
            target = root / str(name)
            if not inside(target):
                raise ValueError('安装包包含越界路径')
            total += max(0, member.size)
            if total > 2*1024*1024*1024:
                raise ValueError('安装包解压体积过大')
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with open(target, 'xb') as output:
                    shutil.copyfileobj(tar.extractfile(member), output)
                os.chmod(target, 0o755 if member.mode & 0o111 else 0o644)
            elif member.issym():
                if pathlib.PurePosixPath(member.linkname).is_absolute():
                    raise ValueError('安装包包含越界链接')
                links.append((target, member.linkname))
            else:
                raise ValueError('安装包包含不支持的文件类型')
    for target, link in links:
        if not inside(target.parent) or not inside(target.parent / link):
            raise ValueError('安装包包含越界链接')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(link)
    for target, _ in links:
        if not inside(target):
            raise ValueError('安装包包含越界链接')
    package = json.loads((root / 'package.json').read_text())
    if package.get('version') != version:
        raise ValueError('运行版本与发布版本不一致')
    for name in ['dist/index.html', 'server/index.js', 'node_modules', 'tools']:
        if not (root / name).exists():
            raise ValueError('安装包缺少运行文件')
    inner.unlink()

if __name__ == '__main__':
    try:
        unpack(*sys.argv[1:])
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

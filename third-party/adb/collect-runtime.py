"""Collect the native dependency closure without executing target-architecture binaries."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess

arch = os.environ.get('TARGET_ARCH', 'x64')
triplet = 'aarch64-linux-gnu' if arch == 'arm64' else 'x86_64-linux-gnu'
output = pathlib.Path('/export')
for name in ['bin', 'lib', 'licenses']:
    (output / name).mkdir(parents=True, exist_ok=True)
search = [pathlib.Path('/usr/lib') / triplet / 'android', pathlib.Path('/lib') / triplet / 'android', pathlib.Path('/lib') / triplet, pathlib.Path('/usr/lib') / triplet, pathlib.Path('/usr/lib') / triplet / 'pulseaudio']
pending = [pathlib.Path('/usr/bin/adb')]
seen = set()
while pending:
    source = pending.pop()
    if source.name in seen:
        continue
    seen.add(source.name)
    target = output / ('bin/adb.bin' if source.name == 'adb' else 'lib/' + source.name)
    shutil.copyfile(source.resolve(), target)
    target.chmod(0o755)
    data = subprocess.check_output(['readelf', '-d', str(source)], text=True)
    for library in re.findall(r'\(NEEDED\).*?\[(.*?)\]', data):
        found = next((p / library for p in search if (p / library).exists()), None)
        if found is None:
            raise RuntimeError('Missing dependency: ' + library)
        pending.append(found)
loader = 'ld-linux-aarch64.so.1' if arch == 'arm64' else 'ld-linux-x86-64.so.2'
source = next(p / loader for p in search if (p / loader).exists())
shutil.copyfile(source.resolve(), output / 'lib' / loader)
(output / 'lib' / loader).chmod(0o755)
launcher = output / 'bin/adb'
launcher.write_text('#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport LD_LIBRARY_PATH="$root/lib"\nexec "$root/lib/' + loader + '" --library-path "$root/lib" "$root/bin/adb.bin" "$@"\n')
launcher.chmod(0o755)
strip = 'aarch64-linux-gnu-strip' if arch == 'arm64' else 'strip'
for file in [output / 'bin/adb.bin', *(output / 'lib').iterdir()]:
    subprocess.run([strip, '--strip-unneeded', str(file)], check=True)
for copyright in pathlib.Path('/usr/share/doc').glob('*/copyright'):
    if copyright.is_file():
        destination = output / 'licenses/debian' / copyright.parent.name
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(copyright.resolve(), destination / 'copyright')
shutil.copytree('/usr/share/common-licenses', output / 'licenses/common', dirs_exist_ok=True)
files = {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
(output / 'manifest.json').write_text(json.dumps({'version': subprocess.check_output(['dpkg-query','-W','-f=${Version}','adb'],text=True).strip(), 'arch': arch, 'files': files}, indent=2))

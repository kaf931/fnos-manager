import os, sys, json, ctypes, stat

def fingerprint(s):
    return {k:str(v) for k,v in dict(dev=s.st_dev,ino=s.st_ino,size=s.st_size,mtime=s.st_mtime_ns,ctime=s.st_ctime_ns).items()}
def check_name(n):
    return isinstance(n,str) and n not in ('','.','..') and '/' not in n and '\\' not in n and len(n.encode('utf-8'))<=255 and not any(ord(c)<32 or ord(c)==127 for c in n)
def same(s, expected):
    return stat.S_ISREG(s.st_mode) and fingerprint(s)==expected

def main():
    data=json.load(sys.stdin); entries=data['entries']; root=os.fstat(3)
    if str(root.st_dev)+':'+str(root.st_ino)!=data['directoryIdentity']:raise ValueError('目录已变化')
    libc=ctypes.CDLL(None,use_errno=True)
    if sys.platform=='linux':
        rename=libc.renameat2; flags=1
    elif sys.platform=='darwin':
        rename=libc.renameatx_np;flags=4
    else:raise ValueError('当前系统不支持无覆盖改名')
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
    for e in entries:
        if not check_name(e['from']) or not check_name(e['to']):raise ValueError('文件名称无效')
        if not same(os.stat(e['from'],dir_fd=3,follow_symlinks=False),e['before']):raise ValueError('文件已变化，请重新预览')
        try:os.stat(e['to'],dir_fd=3,follow_symlinks=False)
        except FileNotFoundError:pass
        else:raise ValueError('目标名称已存在，请重新预览')
    for e in entries:
        if not same(os.stat(e['from'],dir_fd=3,follow_symlinks=False),e['before']):raise ValueError('文件已变化，剩余操作已停止')
        if rename(3,os.fsencode(e['from']),3,os.fsencode(e['to']),flags)!=0:
            err=ctypes.get_errno();raise OSError(err,os.strerror(err))
    print(json.dumps({'ok':True}))
try:main()
except Exception as e:
    print(json.dumps({'error':str(e)}));sys.exit(1)

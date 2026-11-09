import os,sys,json,stat,hashlib,ctypes,secrets,time,signal
start=time.monotonic(); total=0; interrupted=False

def stop(*_):
    global interrupted
    interrupted=True
signal.signal(signal.SIGTERM,stop)
def guard():
    if interrupted or time.monotonic()-start>110:raise ValueError('处理超时或已中断')
def fingerprint(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def mount_id(fd):
    if sys.platform!='linux':return os.fstat(fd).st_dev
    with open('/proc/self/fdinfo/'+str(fd)) as f:
        for line in f:
            if line.startswith('mnt_id:'):return int(line.split(':')[1])
    raise ValueError('无法确认存储边界')
def parent(root,full,base):
    relative=os.path.relpath(full,base)
    if relative=='..' or relative.startswith('../') or relative=='.':raise ValueError('文件路径越界')
    pieces=relative.split('/'); current=os.dup(root)
    try:
        for name in pieces[:-1]:
            nxt=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current);os.close(current);current=nxt
            if mount_id(current)!=mount_id(root):raise ValueError('不支持跨挂载目录')
        return current,pieces[-1]
    except:os.close(current);raise

def digest(fd):
    global total
    before=os.fstat(fd)
    if not stat.S_ISREG(before.st_mode):raise ValueError('仅支持普通文件')
    h=hashlib.sha256();os.lseek(fd,0,0)
    while True:
        guard();chunk=os.read(fd,262144)
        if not chunk:break
        total+=len(chunk)
        if total>20*1024**3:raise ValueError('内容校验超过20GiB，请分批处理')
        h.update(chunk)
    if fingerprint(os.fstat(fd))!=fingerprint(before):raise ValueError('文件校验期间变化')
    return h.digest(),before

def regular_file(parent,name):
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):raise ValueError('仅支持普通文件')
        return fd
    except:
        os.close(fd);raise

def main():
    data=json.load(sys.stdin);root=3;target=4;libc=ctypes.CDLL(None,use_errno=True)
    rename=libc.renameat2 if sys.platform=='linux' else libc.renameatx_np;flag=1 if sys.platform=='linux' else 4
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
    def move(a,n,b,m):
        if rename(a,n.encode(),b,m.encode(),flag):
            error=ctypes.get_errno()
            if error==17:raise ValueError('目标已存在，不会覆盖')
            if error==18:raise ValueError('暂不支持跨存储空间移动')
            raise OSError(error,os.strerror(error))
    base=os.readlink('/proc/self/fd/3') if sys.platform=='linux' else data['rootPath']
    results=[]
    for item in data['items']:
        p=k=None;source=keeper=None;staged=None;name=None
        try:
            guard();p,name=parent(root,item['path'],base);k,kname=parent(root,item['keep'],base)
            if data['action']=='move' and (os.fstat(p).st_dev,os.fstat(p).st_ino)==(os.fstat(target).st_dev,os.fstat(target).st_ino):raise ValueError('目标目录与原目录相同')
            source=regular_file(p,name);keeper=regular_file(k,kname)
            sh,ss=digest(source);kh,ks=digest(keeper)
            if sh!=kh or ss.st_size!=item['size']:raise ValueError('文件内容已变化，请重新扫描')
            if (ss.st_dev,ss.st_ino)==(ks.st_dev,ks.st_ino):raise ValueError('同一文件的硬链接无需处理')
            if fingerprint(os.stat(name,dir_fd=p,follow_symlinks=False))!=fingerprint(ss):raise ValueError('副本已变化')
            stage_name='.deskicons-'+secrets.token_hex(16);move(p,name,p,stage_name);staged=stage_name
            moved=os.stat(staged,dir_fd=p,follow_symlinks=False)
            # Rename updates ctime; all other fingerprint fields must match the open file.
            if (moved.st_dev,moved.st_ino,moved.st_size,moved.st_mtime_ns)!=(ss.st_dev,ss.st_ino,ss.st_size,ss.st_mtime_ns):raise ValueError('副本已变化')
            if fingerprint(os.stat(kname,dir_fd=k,follow_symlinks=False))!=fingerprint(ks):raise ValueError('保留文件已变化')
            if data['action']=='move':
                if os.fstat(target).st_dev==moved.st_dev:move(p,staged,target,name)
                else:
                    temp='.deskicons-copy-'+secrets.token_hex(16);out=None;published=False
                    try:
                        out=os.open(temp,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,ss.st_mode&0o777,dir_fd=target);os.lseek(source,0,0);copied=hashlib.sha256()
                        while True:
                            guard();chunk=os.read(source,262144)
                            if not chunk:break
                            copied.update(chunk);offset=0
                            while offset<len(chunk):offset+=os.write(out,chunk[offset:])
                        os.fsync(out)
                        if copied.digest()!=kh:raise ValueError('复制期间文件内容变化')
                        if fingerprint(os.stat(kname,dir_fd=k,follow_symlinks=False))!=fingerprint(ks):raise ValueError('保留文件已变化')
                        move(target,temp,target,name);published=True;os.unlink(staged,dir_fd=p)
                    finally:
                        if out is not None:os.close(out)
                        if not published:
                            try:os.unlink(temp,dir_fd=target)
                            except FileNotFoundError:pass
                dest=(os.readlink('/proc/self/fd/4') if sys.platform=='linux' else data['destination'])+'/'+name
            else:os.unlink(staged,dir_fd=p);dest=None
            staged=None;results.append({'path':item['path'],'keep':item['keep'],'success':True,'destination':dest})
        except Exception as e:
            error=str(e)
            if staged:
                try:move(p,staged,p,name)
                except Exception:error+='；未能恢复原路径，文件保留在 '+os.path.dirname(item['path'])+'/'+staged
            results.append({'path':item['path'],'keep':item['keep'],'success':False,'error':error})
        finally:
            for fd in (source,keeper,p,k):
                if fd is not None:os.close(fd)
    return {'results':results}
try:print(json.dumps(main(),ensure_ascii=False))
except Exception as e:print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(1)

import os, sys, json, base64, stat, tarfile, zipfile, tempfile, shutil, time, signal
MAX_ENTRIES=10000
MAX_BYTES=1024*1024*1024
if sys.platform.startswith('linux'):
    import resource
    resource.setrlimit(resource.RLIMIT_AS,(256*1024*1024,256*1024*1024))
start=time.monotonic()
copied=0
def check():
    if time.monotonic()-start>110: raise ValueError('压缩操作超过时间上限')
def stopped(*args): raise ValueError('压缩操作已中断')
signal.signal(signal.SIGTERM,stopped)
signal.signal(signal.SIGHUP,stopped)
signal.signal(signal.SIGALRM,stopped)
signal.alarm(110)
def name_ok(name):
    return isinstance(name,str) and 0<len(name)<=255 and name not in ('.','..') and not any(c in name for c in '/\\') and not any(ord(c)<32 or ord(c)==127 for c in name)
def entry_path(name):
    if not isinstance(name,str) or name.startswith('/') or '\\' in name: raise ValueError('压缩包包含不安全路径')
    parts=name.rstrip('/').split('/')
    while parts and parts[0]=='.': parts.pop(0)
    if not parts: return None
    if len(parts)>64 or not all(name_ok(p) for p in parts): raise ValueError('压缩包路径无效或层级过深')
    return '/'.join(parts)
def account(chunk):
    global copied
    check();copied+=len(chunk)
    if copied>MAX_BYTES: raise ValueError('内容超过 1 GiB 大小上限')
class Metered:
    def __init__(self,source): self.source=source
    def read(self,size=-1):
        chunk=self.source.read(size);account(chunk);return chunk
def copy(source,target):
    count=0
    while True:
        check();chunk=source.read(1024*1024)
        if not chunk: break
        account(chunk);count+=len(chunk)
        if count>MAX_BYTES: raise ValueError('文件超过解压大小上限')
        target.write(chunk)
    return count
def source_file(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd);raise ValueError('仅支持普通文件及目录')
    return os.fdopen(fd,'rb')
def open_relative(rootfd,relative,flags=os.O_RDONLY):
    parts=relative.split('/');parent=os.dup(rootfd)
    try:
        for part in parts[:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);os.close(parent);parent=child
        return os.open(parts[-1],flags|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    finally: os.close(parent)
def compress(parent,source,name,output,format):
    if format not in ('zip','tar.gz'): raise ValueError('不支持该压缩格式')
    dest=os.path.join(parent,output)
    if os.path.lexists(dest): raise FileExistsError()
    rootfd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY);temp=None
    try:
        pending=[(name,0)];entries=[];total=0
        while pending:
            check();relative,depth=pending.pop();fd=open_relative(rootfd,relative)
            try:
                info=os.fstat(fd)
                if depth>=64 or len(entries)>=MAX_ENTRIES: raise ValueError('目录超过 10000 项或 64 层限制')
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)): raise ValueError('压缩暂不支持符号链接或特殊文件')
                total+=info.st_size if stat.S_ISREG(info.st_mode) else 0
                if total>MAX_BYTES: raise ValueError('待压缩内容超过 1 GiB 上限')
                entries.append((relative,info))
                if stat.S_ISDIR(info.st_mode):
                    with os.scandir(fd) as children:
                        for child in children:
                            if len(pending)+len(entries)>=MAX_ENTRIES: raise ValueError('目录超过 10000 项限制')
                            if not name_ok(child.name): raise ValueError('文件名包含不支持的字符')
                            pending.append((relative+'/'+child.name,depth+1))
            finally: os.close(fd)
        fd,temp=tempfile.mkstemp(prefix='.toolbox-archive-',dir=parent);os.close(fd)
        if format=='zip':
            with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                for relative,info in entries:
                    check();directory=stat.S_ISDIR(info.st_mode);entry=zipfile.ZipInfo(relative+('/' if directory else ''));entry.create_system=3;entry.external_attr=(stat.S_IMODE(info.st_mode)| (stat.S_IFDIR if directory else stat.S_IFREG))<<16;entry.compress_type=zipfile.ZIP_DEFLATED
                    if directory: archive.writestr(entry,b'')
                    else:
                        with os.fdopen(open_relative(rootfd,relative),'rb') as src,archive.open(entry,'w') as dst:
                            if not stat.S_ISREG(os.fstat(src.fileno()).st_mode): raise ValueError('源文件已变化，请重试')
                            copy(src,dst)
        else:
            with tarfile.open(temp,'w:gz') as archive:
                for relative,info in entries:
                    check();entry=tarfile.TarInfo(relative);entry.mode=stat.S_IMODE(info.st_mode)&0o777;entry.mtime=int(info.st_mtime)
                    if stat.S_ISDIR(info.st_mode): entry.type=tarfile.DIRTYPE;archive.addfile(entry)
                    else:
                        with os.fdopen(open_relative(rootfd,relative),'rb') as src:
                            actual=os.fstat(src.fileno())
                            if not stat.S_ISREG(actual.st_mode): raise ValueError('源文件已变化，请重试')
                            entry.size=actual.st_size;archive.addfile(entry,Metered(src))
        os.link(temp,dest)
        return {'name':output,'entries':len(entries)}
    finally:
        os.close(rootfd)
        if temp and os.path.lexists(temp): os.unlink(temp)
def chmod_entry(parent,name,mode):
    if not isinstance(mode,int) or isinstance(mode,bool) or not 0<=mode<=0o7777: raise ValueError('权限值无效')
    rootfd=os.open(parent,getattr(os,'O_PATH',os.O_RDONLY)|os.O_DIRECTORY)
    try:
        fd=os.open(name,getattr(os,'O_PATH',os.O_RDONLY)|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=rootfd)
        try:
            info=os.fstat(fd)
            if stat.S_ISLNK(info.st_mode): raise ValueError('暂不修改符号链接的权限')
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)): raise ValueError('仅支持普通文件和目录的权限')
            if hasattr(os,'O_PATH'): os.chmod('/proc/self/fd/'+str(fd),mode)
            else: os.fchmod(fd,mode)
        finally: os.close(fd)
    finally: os.close(rootfd)
    return {'mode':mode}
def extract(parent,source,output):
    if not stat.S_ISREG(os.lstat(source).st_mode): raise ValueError('仅支持解压普通压缩文件')
    if os.path.getsize(source)>MAX_BYTES: raise ValueError('压缩文件超过 1 GiB 上限')
    archive=None;dest=os.path.join(parent,output);created=False
    try:
        with source_file(source) as src:
            is_zip=zipfile.is_zipfile(src);src.seek(0);archive=zipfile.ZipFile(src) if is_zip else tarfile.open(fileobj=src,mode='r:*');entries=[];files=set();dirs=set();total=0
            for member in (archive.infolist() if is_zip else archive):
                check()
                if len(entries)>=MAX_ENTRIES: raise ValueError('压缩包超过 10000 项限制')
                relative=entry_path(member.filename if is_zip else member.name)
                if relative is None: continue
                directory=member.is_dir() if is_zip else member.isdir();size=member.file_size if is_zip else member.size
                mode=(member.external_attr>>16) if is_zip else member.mode
                kind=stat.S_IFMT(mode)
                if (is_zip and kind not in (0,stat.S_IFREG,stat.S_IFDIR)) or (not is_zip and not (member.isfile() or directory)): raise ValueError('压缩包包含符号链接或特殊文件，已停止解压')
                if size<0: raise ValueError('压缩包大小无效')
                total+=0 if directory else size
                if total>MAX_BYTES: raise ValueError('解压内容超过 1 GiB 上限')
                if directory: dirs.add(relative)
                else:
                    if relative in files: raise ValueError('压缩包包含重复文件路径')
                    files.add(relative)
                parts=relative.split('/')
                for i in range(1,len(parts)): dirs.add('/'.join(parts[:i]))
                entries.append((relative,directory,member,mode))
            if len(dirs)+len(files)>MAX_ENTRIES: raise ValueError('解压条目超过 10000 项限制')
            if dirs&files: raise ValueError('压缩包包含文件与目录路径冲突')
            os.mkdir(dest,0o700);created=True
            for relative in sorted(dirs,key=lambda p:p.count('/')): check();os.makedirs(os.path.join(dest,relative),mode=0o755,exist_ok=True)
            for relative,directory,member,mode in entries:
                if directory: continue
                target=os.path.join(dest,relative)
                if len(target)>4096: raise ValueError('解压路径超过长度上限')
                with (archive.open(member) if is_zip else archive.extractfile(member)) as source_stream,open(target,'xb') as dst:
                    written=copy(source_stream,dst)
                    if written!=(member.file_size if is_zip else member.size): raise ValueError('压缩内容不完整')
                os.chmod(target,(mode&0o777) if mode&0o777 else 0o600)
            os.chmod(dest,0o755)
            return {'name':output,'entries':len(entries)}
    except BaseException:
        if created: shutil.rmtree(dest,ignore_errors=True)
        raise
    finally:
        if archive: archive.close()
try:
    request=json.loads(base64.b64decode(sys.argv[1]));parent=request['path'];name=request['name'];output=request.get('outputName','unused')
    if not name_ok(name) or not name_ok(output) or not isinstance(parent,str) or not parent.startswith('/') or len(parent)>4096: raise ValueError('路径或名称无效')
    parent=os.path.realpath(parent);source=os.path.join(parent,name)
    if request['action']=='chmod': result=chmod_entry(parent,name,request.get('mode'))
    elif request['action']=='compress': result=compress(parent,source,name,output,request['format'])
    elif request['action']=='extract': result=extract(parent,source,output)
    else: raise ValueError('无效压缩操作')
    print(json.dumps(result,ensure_ascii=True))
except BaseException as error:
    if isinstance(error,FileExistsError): message='同名文件或文件夹已存在，请修改输出名称'
    elif isinstance(error,PermissionError): message='没有操作该文件或目录的权限'
    elif isinstance(error,FileNotFoundError): message='文件或目录不存在'
    elif isinstance(error,ValueError): message=str(error)
    else: message='压缩操作失败，压缩文件可能损坏或格式不支持'
    print(json.dumps({'error':message},ensure_ascii=True));sys.exit(1)

// Initial SQLite seed only; runtime queries read command_catalog.
export const commandSeed = [
  {
    command: 'ls -lah',
    description: '列出全部文件，显示权限、大小与隐藏文件',
    category: '文件与目录',
  },
  {
    command: 'ls -lh',
    description: '以易读的大小格式列出文件',
    category: '文件与目录',
  },
  {
    command: 'pwd',
    description: '显示当前目录',
    category: '文件与目录',
  },
  {
    command: 'cd ..',
    description: '返回上一级目录',
    category: '文件与目录',
  },
  {
    command: 'cd /',
    description: '切换到根目录',
    category: '文件与目录',
  },
  {
    command: 'df -h',
    description: '查看磁盘容量与剩余空间',
    category: '文件与目录',
  },
  {
    command: 'du -sh .',
    description: '统计当前目录的总大小',
    category: '文件与目录',
  },
  {
    command: 'du -h --max-depth=1',
    description: '统计当前目录下一级目录的大小（GNU 工具）',
    category: '文件与目录',
  },
  {
    command: 'free -h',
    description: '查看内存与交换空间',
    category: '系统与进程',
  },
  {
    command: 'top',
    description: '实时查看进程和资源占用，按 q 退出',
    category: '系统与进程',
  },
  {
    command: 'htop',
    description: '交互查看进程，需要主机已安装 htop',
    category: '系统与进程',
  },
  {
    command: 'ps aux',
    description: '列出进程及 CPU、内存用量',
    category: '系统与进程',
  },
  {
    command: 'ps -ef',
    description: '查看完整进程列表',
    category: '系统与进程',
  },
  {
    command: 'uptime',
    description: '查看运行时长与系统负载',
    category: '系统与进程',
  },
  {
    command: 'uname -a',
    description: '显示系统与内核信息',
    category: '系统与进程',
  },
  {
    command: 'whoami',
    description: '显示当前登录用户',
    category: '系统与进程',
  },
  {
    command: 'id',
    description: '显示当前用户和用户组',
    category: '系统与进程',
  },
  {
    command: 'ip addr',
    description: '查看网卡及 IP 地址',
    category: '网络与连接',
  },
  {
    command: 'ip route',
    description: '查看路由与默认网关',
    category: '网络与连接',
  },
  {
    command: 'ss -lntup',
    description: '查看监听端口及进程',
    category: '网络与连接',
  },
  {
    command: 'ping -c 4 ',
    description: '测试网络连通性，后接 IP 或域名',
    category: '网络与连接',
  },
  {
    command: 'curl -I ',
    description: '查看 HTTP 响应头，后接网址',
    category: '网络与连接',
  },
  {
    command: 'cat ',
    description: '显示文件内容，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'less ',
    description: '分页查看文件，按 q 退出',
    category: '文件与目录',
  },
  {
    command: 'head -n 20 ',
    description: '查看文件前 20 行，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'tail -n 100 ',
    description: '查看文件末尾 100 行，后接文件路径',
    category: '服务与日志',
  },
  {
    command: 'tail -f ',
    description: '持续查看新增日志，按 Ctrl+C 结束',
    category: '服务与日志',
  },
  {
    command: 'find . -maxdepth 2 -type f',
    description: '查找当前目录两层以内的普通文件',
    category: '文件与目录',
  },
  {
    command: 'grep -n ',
    description: '搜索文本并显示行号，后接关键词和文件路径',
    category: '文件与目录',
  },
  {
    command: 'mkdir ',
    description: '创建目录，后接新目录名称',
    category: '文件与目录',
  },
  {
    command: 'cp ',
    description: '复制文件，后接源路径和目标路径',
    category: '文件与目录',
  },
  {
    command: 'mv ',
    description: '移动或改名，后接源路径和目标路径',
    category: '文件与目录',
  },
  {
    command: 'docker ps',
    description: '查看运行中的 Docker 容器',
    category: 'Docker',
  },
  {
    command: 'docker ps -a',
    description: '查看全部 Docker 容器，包括已停止的',
    category: 'Docker',
  },
  {
    command: 'docker stats --no-stream',
    description: '查看一次容器资源使用情况',
    category: 'Docker',
  },
  {
    command: 'docker logs --tail 100 ',
    description: '查看最近 100 行容器日志，后接容器名称',
    category: 'Docker',
  },
  {
    command: 'docker images',
    description: '查看本机 Docker 镜像',
    category: 'Docker',
  },
  {
    command: 'docker compose ps',
    description: '查看当前 Compose 项目的容器',
    category: 'Docker',
  },
  {
    command: 'docker compose logs --tail 100',
    description: '查看当前 Compose 项目的最近日志',
    category: 'Docker',
  },
  {
    command: 'systemctl status ',
    description: '查看服务状态，后接服务名称',
    category: '服务与日志',
  },
  {
    command: 'systemctl list-units --type=service',
    description: '列出系统服务，要求 systemd',
    category: '服务与日志',
  },
  {
    command: 'journalctl -n 100 --no-pager',
    description: '查看最近 100 条系统日志',
    category: '服务与日志',
  },
  {
    command: 'journalctl -u ',
    description: '查看指定服务日志，后接服务名称',
    category: '服务与日志',
  },
  {
    command: 'git status',
    description: '查看 Git 工作区状态',
    category: 'Git',
  },
  {
    command: 'git log --oneline -10',
    description: '查看最近 10 次提交',
    category: 'Git',
  },
  {
    command: 'git diff',
    description: '查看尚未暂存的代码变更',
    category: 'Git',
  },
  {
    command: 'git branch',
    description: '查看本地分支',
    category: 'Git',
  },
  {
    command: 'git remote -v',
    description: '查看远程仓库地址',
    category: 'Git',
  },
  {
    command: 'tar -tf ',
    description: '查看归档中的文件列表，后接归档路径',
    category: '压缩与校验',
  },
  {
    command: 'unzip -l ',
    description: '查看 ZIP 内容，不解压，后接文件路径',
    category: '压缩与校验',
  },
  {
    command: 'which ',
    description: '查找命令的安装位置，后接命令名',
    category: '系统与进程',
  },
  {
    command: 'sudo -l',
    description: '查看当前用户获准执行的 sudo 命令',
    category: '系统与进程',
  },
  {
    command: 'ls -lat',
    description: '按修改时间列出全部文件，最新的在前',
    category: '文件与目录',
  },
  {
    command: 'ls -lhS',
    description: '按文件大小排序，最大的在前',
    category: '文件与目录',
  },
  {
    command: 'ls -ld ',
    description: '只查看目录自身的信息，后接目录路径',
    category: '文件与目录',
  },
  {
    command: 'du -sh ',
    description: '查看指定文件或目录大小，后接路径',
    category: '文件与目录',
  },
  {
    command: 'du -h --max-depth=1 .',
    description: '显示当前目录各子目录占用，GNU 工具',
    category: '文件与目录',
  },
  {
    command: 'df -ih',
    description: '查看 inode 使用率，排查有空间但无法创建文件',
    category: '文件与目录',
  },
  {
    command: 'lsblk -f',
    description: '查看块设备、文件系统与挂载点',
    category: '文件与目录',
  },
  {
    command: 'findmnt',
    description: '查看已挂载的文件系统',
    category: '文件与目录',
  },
  {
    command: 'stat ',
    description: '显示文件大小、权限和时间，后接路径',
    category: '文件与目录',
  },
  {
    command: 'find . -type d',
    description: '递归查找当前目录下的文件夹',
    category: '文件与目录',
  },
  {
    command: 'find . -type f -name ',
    description: '按名称查找文件，后接带引号的名称或通配符',
    category: '文件与目录',
  },
  {
    command: 'find . -type f -size +1G',
    description: '查找大于 1 GiB 的普通文件',
    category: '文件与目录',
  },
  {
    command: 'find . -type f -mtime -7',
    description: '查找最近 7 天修改过的文件',
    category: '文件与目录',
  },
  {
    command: 'find . -type f -empty',
    description: '查找空文件，不删除',
    category: '文件与目录',
  },
  {
    command: 'readlink -f ',
    description: '显示路径最终指向的位置，后接路径',
    category: '文件与目录',
  },
  {
    command: 'grep -rn ',
    description: '递归搜索并显示行号，后接关键词和目录',
    category: '文件与目录',
  },
  {
    command: 'grep -in ',
    description: '忽略大小写搜索并显示行号，后接关键词和文件',
    category: '文件与目录',
  },
  {
    command: 'grep -n -C 3 ',
    description: '显示匹配行及前后各 3 行，后接关键词和文件',
    category: '文件与目录',
  },
  {
    command: 'wc -l ',
    description: '统计行数，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'file ',
    description: '识别文件类型，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'sort -h ',
    description: '按易读容量排序，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'sort -nr ',
    description: '按数值从大到小排序，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'uniq -c ',
    description: '统计相邻重复行次数，通常先排序，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'diff -u ',
    description: '比较两个文本文件，后接两个路径',
    category: '文件与目录',
  },
  {
    command: 'mkdir -p ',
    description: '创建多层目录，后接目录路径',
    category: '文件与目录',
  },
  {
    command: 'cp -av ',
    description: '复制并保留文件属性，显示过程，后接源和目标',
    category: '文件与目录',
  },
  {
    command: 'cp -iv ',
    description: '逐个确认是否覆盖，后接源和目标',
    category: '文件与目录',
  },
  {
    command: 'mv -iv ',
    description: '移动或改名，覆盖前确认，后接源和目标',
    category: '文件与目录',
  },
  {
    command: 'touch ',
    description: '创建空文件或更新时间，后接文件路径',
    category: '文件与目录',
  },
  {
    command: 'ln -s ',
    description: '创建符号链接，后接目标和链接名称',
    category: '文件与目录',
  },
  {
    command: 'chmod ',
    description: '修改权限，后接权限值和路径',
    category: '文件与目录',
  },
  {
    command: 'chown ',
    description: '修改所有者，后接用户或用户组及路径',
    category: '文件与目录',
  },
  {
    command: 'tar -tvf ',
    description: '列出归档内容与详情，后接归档路径',
    category: '压缩与校验',
  },
  {
    command: 'tar -czvf ',
    description: '创建 gzip 归档，后接归档名和源路径',
    category: '压缩与校验',
  },
  {
    command: 'tar -xzvf ',
    description: '解压 gzip 归档到当前目录，后接归档路径',
    category: '压缩与校验',
  },
  {
    command: 'tar -xvf ',
    description: '解压归档到当前目录，后接归档路径',
    category: '压缩与校验',
  },
  {
    command: 'gzip -l ',
    description: '查看 gzip 压缩文件信息，后接路径',
    category: '压缩与校验',
  },
  {
    command: 'unzip ',
    description: '解压 ZIP 到当前目录，后接归档路径',
    category: '压缩与校验',
  },
  {
    command: 'zip -r ',
    description: '递归压缩目录，后接 ZIP 名和源路径',
    category: '压缩与校验',
  },
  {
    command: 'ps -eo pid,comm,%cpu,%mem --sort=-%cpu',
    description: '按 CPU 占用降序列出进程，GNU ps',
    category: '系统与进程',
  },
  {
    command: 'ps -eo pid,comm,%cpu,%mem --sort=-%mem',
    description: '按内存占用降序列出进程，GNU ps',
    category: '系统与进程',
  },
  {
    command: 'pgrep -a ',
    description: '按名称查找进程及命令行，后接进程名称',
    category: '系统与进程',
  },
  {
    command: 'kill -TERM ',
    description: '请求进程正常退出，后接 PID',
    category: '系统与进程',
  },
  {
    command: 'lsof -i -P -n',
    description: '查看使用网络端口的进程，需要 lsof',
    category: '系统与进程',
  },
  {
    command: 'lsof ',
    description: '查看占用文件的进程，后接文件路径，需要 lsof',
    category: '系统与进程',
  },
  {
    command: 'vmstat 1 5',
    description: '每秒采样一次系统状态，共 5 次',
    category: '系统与进程',
  },
  {
    command: 'iostat -xz 1 5',
    description: '每秒采样磁盘 I/O，共 5 次，需要 sysstat',
    category: '系统与进程',
  },
  {
    command: 'dmesg -T',
    description: '查看内核消息并显示易读时间，可能需要提权',
    category: '服务与日志',
  },
  {
    command: 'date',
    description: '显示当前日期、时间和时区',
    category: '系统与进程',
  },
  {
    command: 'hostname',
    description: '显示主机名称',
    category: '系统与进程',
  },
  {
    command: 'hostname -I',
    description: '列出主机 IP 地址',
    category: '系统与进程',
  },
  {
    command: 'cat /etc/os-release',
    description: '查看发行版名称与版本',
    category: '文件与目录',
  },
  {
    command: 'getconf LONG_BIT',
    description: '查看系统用户空间位数',
    category: '系统与进程',
  },
  {
    command: 'who',
    description: '查看当前登录用户',
    category: '系统与进程',
  },
  {
    command: 'last -n 10',
    description: '查看最近 10 条登录记录',
    category: '系统与进程',
  },
  {
    command: 'env',
    description: '查看当前 Shell 的环境变量',
    category: '系统与进程',
  },
  {
    command: 'ip -br addr',
    description: '以简洁格式查看网卡与 IP 地址',
    category: '网络与连接',
  },
  {
    command: 'ip -s link',
    description: '查看网卡收发包和错误统计',
    category: '网络与连接',
  },
  {
    command: 'ip neigh',
    description: '查看局域网邻居及 MAC 地址',
    category: '网络与连接',
  },
  {
    command: 'ip route get ',
    description: '查看到目标地址的路由，后接 IP',
    category: '网络与连接',
  },
  {
    command: 'ss -lntp',
    description: '查看 TCP 监听端口和进程',
    category: '网络与连接',
  },
  {
    command: 'ss -lnup',
    description: '查看 UDP 监听端口和进程',
    category: '网络与连接',
  },
  {
    command: 'ss -s',
    description: '查看套接字连接统计',
    category: '网络与连接',
  },
  {
    command: 'curl -IL ',
    description: '跟随重定向并查看响应头，后接网址',
    category: '网络与连接',
  },
  {
    command: 'curl -o ',
    description: '将响应保存到文件，后接文件名和网址',
    category: '网络与连接',
  },
  {
    command: 'wget -c ',
    description: '断点续传下载，后接网址',
    category: '网络与连接',
  },
  {
    command: 'getent hosts ',
    description: '使用系统解析器查询地址，后接域名',
    category: '网络与连接',
  },
  {
    command: 'nslookup ',
    description: '查询 DNS，后接域名，需要 nslookup',
    category: '网络与连接',
  },
  {
    command: 'dig +short ',
    description: '简洁查询 DNS，后接域名，需要 dig',
    category: '网络与连接',
  },
  {
    command: 'traceroute ',
    description: '查看到目标的路由路径，后接 IP 或域名',
    category: '网络与连接',
  },
  {
    command: 'nc -vz ',
    description: '测试 TCP 端口，后接主机和端口，需要 netcat',
    category: '网络与连接',
  },
  {
    command: 'docker version',
    description: '查看 Docker 客户端与服务端版本',
    category: 'Docker',
  },
  {
    command: 'docker info',
    description: '查看 Docker 引擎信息',
    category: 'Docker',
  },
  {
    command: 'docker system df',
    description: '查看 Docker 镜像、容器和卷占用',
    category: 'Docker',
  },
  {
    command: 'docker system df -v',
    description: '查看 Docker 各资源的详细占用',
    category: 'Docker',
  },
  {
    command: 'docker inspect ',
    description: '查看容器或其他对象详情，后接名称或 ID',
    category: 'Docker',
  },
  {
    command: 'docker logs -f --tail 100 ',
    description: '跟踪容器最新日志，后接容器名称，Ctrl+C 退出',
    category: 'Docker',
  },
  {
    command: 'docker top ',
    description: '查看容器内进程，后接容器名称',
    category: 'Docker',
  },
  {
    command: 'docker port ',
    description: '查看容器端口映射，后接容器名称',
    category: 'Docker',
  },
  {
    command: 'docker start ',
    description: '启动已有容器，后接容器名称',
    category: 'Docker',
  },
  {
    command: 'docker stop ',
    description: '停止容器，后接容器名称',
    category: 'Docker',
  },
  {
    command: 'docker restart ',
    description: '重启容器，后接容器名称',
    category: 'Docker',
  },
  {
    command: 'docker exec -it ',
    description: '进入容器交互进程，后接容器名和 Shell，例如 sh',
    category: 'Docker',
  },
  {
    command: 'docker network ls',
    description: '列出 Docker 网络',
    category: 'Docker',
  },
  {
    command: 'docker volume ls',
    description: '列出 Docker 数据卷',
    category: 'Docker',
  },
  {
    command: 'docker compose config',
    description: '检查并展开当前目录的 Compose 配置',
    category: 'Docker',
  },
  {
    command: 'docker compose ls',
    description: '列出 Compose 项目',
    category: 'Docker',
  },
  {
    command: 'docker compose pull',
    description: '拉取当前 Compose 项目的镜像',
    category: 'Docker',
  },
  {
    command: 'docker compose up -d',
    description: '在后台创建或更新当前 Compose 项目',
    category: 'Docker',
  },
  {
    command: 'docker compose stop',
    description: '停止当前 Compose 项目的容器',
    category: 'Docker',
  },
  {
    command: 'docker compose restart',
    description: '重启当前 Compose 项目的容器',
    category: 'Docker',
  },
  {
    command: 'systemctl --failed',
    description: '列出失败的 systemd 单元',
    category: '服务与日志',
  },
  {
    command: 'systemctl list-timers --all',
    description: '查看全部 systemd 定时器',
    category: '服务与日志',
  },
  {
    command: 'systemctl list-unit-files --type=service',
    description: '查看已安装的服务及启用状态',
    category: '服务与日志',
  },
  {
    command: 'systemctl start ',
    description: '启动服务，后接服务名称',
    category: '服务与日志',
  },
  {
    command: 'systemctl stop ',
    description: '停止服务，后接服务名称',
    category: '服务与日志',
  },
  {
    command: 'systemctl restart ',
    description: '重启服务，后接服务名称',
    category: '服务与日志',
  },
  {
    command: 'systemctl is-active ',
    description: '检查服务是否运行，后接服务名称',
    category: '服务与日志',
  },
  {
    command: 'journalctl -f',
    description: '持续查看系统日志，Ctrl+C 退出',
    category: '服务与日志',
  },
  {
    command: 'journalctl -b --no-pager',
    description: '查看本次启动以来的日志',
    category: '服务与日志',
  },
  {
    command: 'journalctl -p err -n 100 --no-pager',
    description: '查看最近 100 条错误级别及更严重的日志',
    category: '服务与日志',
  },
  {
    command: 'journalctl --disk-usage',
    description: '查看系统日志占用空间',
    category: '服务与日志',
  },
  {
    command: 'git log --oneline --graph -20',
    description: '以图形显示最近 20 次提交',
    category: 'Git',
  },
  {
    command: 'git diff --stat',
    description: '查看未暂存变更的文件统计',
    category: 'Git',
  },
  {
    command: 'git diff --cached',
    description: '查看已暂存的代码变更',
    category: 'Git',
  },
  {
    command: 'git branch -a',
    description: '列出本地与远程分支',
    category: 'Git',
  },
  {
    command: 'git fetch --all',
    description: '拉取所有远程仓库的信息，不合并代码',
    category: 'Git',
  },
  {
    command: 'git pull --ff-only',
    description: '仅在可以快进时更新当前分支',
    category: 'Git',
  },
  {
    command: 'git add ',
    description: '暂存文件，后接路径',
    category: 'Git',
  },
  {
    command: 'git show --stat',
    description: '查看最新提交的文件变更统计',
    category: 'Git',
  },
  {
    command: 'rsync -av --dry-run ',
    description: '预演同步，不写入，后接源和目标路径',
    category: '网络与连接',
  },
  {
    command: 'rsync -av --progress ',
    description: '同步并保留属性及显示进度，后接源和目标路径',
    category: '网络与连接',
  },
  {
    command: 'scp -P ',
    description: '通过 SSH 复制，后接端口、源和目标',
    category: '网络与连接',
  },
  {
    command: 'ssh -p ',
    description: '连接 SSH，后接端口和用户@主机',
    category: '网络与连接',
  },
  {
    command: 'ssh-keygen -lf ',
    description: '查看公钥指纹，后接公钥文件路径',
    category: '网络与连接',
  },
  {
    command: 'sha256sum ',
    description: '计算 SHA-256，后接文件路径',
    category: '压缩与校验',
  },
  {
    command: 'md5sum ',
    description: '计算 MD5 校验值，后接文件路径',
    category: '压缩与校验',
  },
  {
    command: 'type ',
    description: '显示命令类型或位置，后接命令名',
    category: '系统与进程',
  },
  {
    command: 'command -v ',
    description: '查看命令解析位置，后接命令名',
    category: '系统与进程',
  },
  {
    command: 'history',
    description: '查看当前 Shell 的命令历史',
    category: '系统与进程',
  },
  {
    command: 'clear',
    description: '清空终端可视区域',
    category: '系统与进程',
  },
];

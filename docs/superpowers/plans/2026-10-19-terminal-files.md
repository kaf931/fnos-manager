# SSH 终端文件面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在全屏 SSH 终端右侧加入可收起的 SFTP 文件面板，支持浏览、上传下载、新建文件夹、重命名和删除。

**Architecture:** 文件操作复用 TerminalSession 当前 ssh2 Client 的 SFTP 子通道，通过绑定用户和会话的 HTTP 接口访问。前端文件面板独立管理目录、操作与传输，终端仅提供会话和连接代次；关闭文件面板不关闭终端。

**Tech Stack:** 当前 Node.js/Express、ssh2、原生流、现有 React/Semi UI、CSS 和 node:test。不增加依赖或网络监听端口。

**Spec:** `docs/superpowers/specs/2026-10-19-terminal-files-design.md`

## Global Constraints

- 默认收起，按钮在右侧边缘垂直居中；展开后桌面右侧360px面板，移动端覆盖终端内容区域。
- 保留现有全屏、灰白交替终端、导航隐藏、保存认证和主机信任流程。
- 文件权限完全由当前远端 SSH 账号决定；不以本地应用 root 权限执行文件操作，不拼接 Shell 命令。
- 单文件上传上限256MiB，流式传输；新建、重命名、上传不覆盖重名目标。删除仅支持文件、链接、空目录，确认后执行，不递归删除。
- 每会话最多一个写操作、两个下载；目录最多10000条，超限明确失败。操作超时30秒，传输无进展60秒取消，正常有数据进展的长传输不按总时长中止。
- 所有 HTTP 接口检查管理员和会话所有者，写操作保留现有 CSRF 保护；传输不走终端输出队列。
- 仓库当前没有 Git，原地备份后实施，不创建仓库或假报提交。NAS 更新前备份 target 与 appdata，更新服务会断开当前工具箱终端会话。

## Review Focus

- 文件名含中文、引号、HTML、换行或路径分隔符：只以文本渲染，非法名称拒绝，不拼命令。
- 切换连接后的迟到目录响应：不能显示上一台设备文件，旧操作不能借用新连接。
- 上传中断或重名竞态：已有文件不被覆盖，临时文件尽力清理且清理失败可见。
- 链接指向目录、设备或不存在目标：允许浏览有效目录，拒绝下载特殊文件，删除仅处理链接本身。
- SFTP 不可用、请求超时或权限拒绝：面板可重试，终端仍可操作，资源上限和断线释放生效。

---

### Task 1: 会话内 SFTP 与文件元数据

**Files:** Create `server/terminal/files.js`; Modify `server/terminal/session.js`; Create `tests/terminal-files.test.js`; Create `tests/fixtures/sftp-server.js`.

**Interfaces:**
- `SessionFiles(client, {isConnected, timeoutMs=30000})` 持有一个延迟初始化 SFTP 通道。
- `list(path?:string) -> Promise<{path:string,entries:Array<{name,type,size,mtime}>,files:number,directories:number}>`，type 为 directory/file/link/other，mtime 为毫秒数。
- `close() -> void` 关闭通道、取消待处理操作和句柄。
- `TerminalSession.files()` 仅已连接时返回同一 SessionFiles，session.close() 级联 close。

- [ ] **Step 1:** 编写隔离 SFTP 服务夹具：使用临时目录，按服务器句柄映射远端文件到临时目录，覆盖 REALPATH、OPENDIR、READDIR、CLOSE、STAT/LSTAT；夹具禁止逃出测试根目录。
- [ ] **Step 2:** 编写失败测试：初始 realpath('.')、目录优先排序、中文/HTML名称原样返回、空目录、链接元数据、权限错误、10001条触发超限并关闭句柄、延迟请求超时、关闭后不能继续调用。
- [ ] **Step 3:** 运行 `node --test tests/terminal-files.test.js`，确认新增接口未实现导致失败。
- [ ] **Step 4:** 实现 SessionFiles 延迟 SFTP、共享初始化 Promise、分批 READDIR、条目计数、超时和资源清理；TerminalSession 连接/关闭接入不改变认证流程。错误映射中文说明，原始远端错误不泄漏到通用日志。
- [ ] **Step 5:** 同一测试命令全部通过，并运行 `node --test tests/terminal-session.test.js tests/terminal-auto-auth.test.js` 确认会话回归。

### Task 2: 文件读写与流式传输

**Files:** Modify `server/terminal/files.js`, `tests/terminal-files.test.js`, `tests/fixtures/sftp-server.js`.

**Interfaces:**
- `mkdir(parent:string,name:string)`, `rename(parent:string,name:string,newName:string)`, `remove(parent:string,name:string) -> Promise<void>`。
- `upload(parent:string,name:string,readable,{size:number,onProgress?,signal?}) -> Promise<void>`。
- `download(path:string) -> Promise<{name:string,size:number,stream:Readable}>`，流关闭后释放下载槽位。
- `validateName(name)` 拒绝空、.、..、斜杠、NUL、控制字符；路径接口仅接受长度不超过4096的有效绝对路径（初始目录除外）。

- [ ] **Step 1:** 扩展夹具支持 OPEN/READ/WRITE、MKDIR、RENAME、UNLINK、RMDIR，实现目标存在即拒绝的 SFTP v3 rename；添加普通文件、链接、非空目录和权限受限目录。
- [ ] **Step 2:** 添加失败测试：上传下载字节一致、mkdir与rename成功、重名拒绝且原文件逐字节不变、删除文件/链接/空目录、非空目录拒删、链接指向特殊文件拒绝下载、恶意单分量名称拒绝。
- [ ] **Step 3:** 添加传输失败测试：超过256MiB在读取前拒绝；一个写/两个读上限；实际字节超出声明拒绝；取消和连接关闭销毁流；中途写失败清理临时文件；清理失败可见；上传提交前插入同名目标不能覆盖。
- [ ] **Step 4:** 运行测试确认失败后实现方法：upload 使用目标目录随机临时名、排他创建、背压 pipeline、字节计数及进展计时，完成后标准无覆盖 RENAME；不使用 posix-rename 覆盖扩展。无法确定无覆盖结果时失败，不提供覆盖回退。remove 使用 lstat 分辨链接和目录，目录仅 RMDIR，不递归。
- [ ] **Step 5:** 运行 `node --test tests/terminal-files.test.js` 全部通过；检查没有 exec、Shell 拼接、base64文件体或全文件内存缓冲。

### Task 3: 有归属校验的文件 HTTP 接口

**Files:** Create `server/terminal/file-routes.js`; Modify `server/terminal/routes.js`, `server/terminal/transport.js`; Create `tests/terminal-file-routes.test.js`.

**Interfaces:**
- `TerminalService.connectedOwned(owner,id) -> TerminalSession`：仅返回同用户、当前已连接的 session，否则404或409。
- `mountFileRoutes(router,service)` 挂在现有 terminal 管理员校验之后。
- `GET /terminal/sessions/:id/files?path=...` 返回 Task1 list 结果。
- `GET /terminal/sessions/:id/files/download?path=...` 返回 attachment 二进制流。
- `POST /terminal/sessions/:id/files/mkdir {path,name}`、`/rename {path,name,newName}`、`/delete {path,name}` 返回204。
- `POST /terminal/sessions/:id/files/upload?path=...&name=...&size=...`，Content-Type application/octet-stream，返回201。保持req原始流，现有 express.json 不处理该类型。

- [ ] **Step 1:** 写失败集成测试：正常登录并核验主机后访问列表；另一UID/非管理员/未知会话/未连接会话拒绝；缺少CSRF的写请求拒绝；下载文件名包含Unicode/引号也不能注入响应头。
- [ ] **Step 2:** 添加正常上传下载及所有写操作测试；请求中断取消远端流；断开后旧session ID拒绝；给请求附加其他连接目标或凭据不影响实际目标。
- [ ] **Step 3:** 运行 `node --test tests/terminal-file-routes.test.js` 确认失败，再按接口实现路由及所有权查询。下载使用安全Content-Disposition和Content-Length，错误在发送头前可转JSON、发送头后销毁流；禁止返回远端原始堆栈。
- [ ] **Step 4:** 同一命令全部通过，运行 `npm test` 确认当前51项及新增测试通过。

### Task 4: 终端右侧文件面板

**Files:** Create `web/terminal-files.js`, `web/terminal-file-api.js`, `web/terminal-file-model.js`; Modify `web/index.html`, `web/terminal-view.js`, `web/native-ui.css`; Create `tests/terminal-file-model.test.js`.

**Interfaces:**
- `createTerminalFiles({element,toggle,api,toast,confirm,getSession}) -> {setSession({id,generation,connected}),hide(),dispose()}`。
- `getSession()` 返回当前session ID、连接代次和connected，不返回凭据。
- `createFileApi({api,getSession,getCsrfToken})` 提供 list/mkdir/rename/remove/upload/download；每次请求固定所属session ID及generation。普通请求复用现有api，getCsrfToken()从现有state.csrfToken读取，上传XHR使用同源CSRF头、进度和abort，下载流由浏览器attachment接收。
- `file-model` 导出纯函数格式化大小、文件类别、排序、名称校验及 `isCurrentResponse(request,current)`，供 node:test 验证。

- [ ] **Step 1:** 写失败纯函数测试：中文和HTML文件名不改变、大小和时间显示、目录优先/名称时间大小排序、非法名称、会话代次不同拒绝应用响应。运行 `node --test tests/terminal-file-model.test.js` 看到失败后实现纯函数并复测。
- [ ] **Step 2:** 在terminal viewport外新增flex工作区、默认hidden文件面板、贴边居中箭头按钮，保留toolbar与移动辅助栏；展开/关闭更新aria-expanded，不重新连接终端。桌面面板360px，窄屏覆盖内容区，按钮与文件面板关闭入口始终可达。
- [ ] **Step 3:** 实现路径/上一级/刷新、文件计数和独立滚动表格，现有按钮/输入/菜单/弹窗/SVG样式；名称通过text节点或React渲染。空、错误、权限不足、SFTP不可用有可重试状态。
- [ ] **Step 4:** 实现新建和重命名输入弹窗、删除不可撤销确认、下载入口；上传选择按钮隐藏原生input，串行多文件、256MiB预检查、当前文件进度和取消；重名提示改名重试，不提供覆盖。
- [ ] **Step 5:** terminal-view接入真实session ID和state；断开清除数据，重连增加generation并重置目录；收起保留路径和传输；旧响应不能覆盖新数据。关闭/切换菜单不主动销毁有效SSH。
- [ ] **Step 6:** 启动隔离服务并通过CUA浏览器验证桌面分栏、贴边居中、展开收起后终端列数、深浅主题、移动覆盖布局、安全区、文件操作和进度取消，保存无敏感内容截图。通过完整 `npm test` 与 `npm run build`。

### Task 5: 复核、打包及 NAS 更新

**Files:** Modify `README.md`, `docs/verification.md`; Create `docs/screenshots/terminal-files-*.png`; native包版本从0.2.8更新为0.2.9（package.json、lock及由打包器生成的manifest同步）。

**Interfaces:** 使用以上稳定文件接口，不增加临时调试入口或鉴权降级。

- [ ] **Step 1:** 自查五项 Review Focus 与资源释放；按技能进行独立代码复核，仅将代码与测试交给复核者，不传递NAS凭据。修复发现后重跑对应测试。
- [ ] **Step 2:** README写入SFTP权限、独立目录、256MiB限制、不覆盖和非空目录拒删；记录实体手机键盘未实测。运行 `npm test && npm run build && npm run pack`，确认全部通过及包内不含用户凭据/应用认证密钥。
- [ ] **Step 3:** NAS备份当前target和appdata；提前告知重启终端会断开，通过官方管理器停止、更新、启动。若官方升级需新的责任声明则按实际提示处理，不推定新条款已同意。
- [ ] **Step 4:** 验证running、版本0.2.9、本地与NAS资源摘要；图标entries.json与tasks.json和备份逐字节比较。使用现有已授权本机连接验证自动认证、展开面板和只读列目录。
- [ ] **Step 5:** 若实测写入，先在当前SSH账号家目录创建独立随机测试文件夹，上传生成测试文件、下载比对、重命名、删除测试文件及空测试目录；不读取或删除用户既有文件内容。记录结果、备份路径、限制与截图，退出测试连接、清理临时浏览器标签页及本次测试服务。

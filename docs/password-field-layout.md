# 密码显示按钮定位修复

2026-10-23：SSH 新增/编辑连接的共享密码组件通过 React 宿主 span 渲染按钮，原 `.password-field > .password-visibility` 只匹配直接子元素，导致按钮未获得绝对定位。改为作用于容器内按钮的后代选择器，保留输入框右侧留白及按钮尺寸。AI API Key 使用直接子元素布局，仍匹配同一公共样式；检查其余密码/私钥口令输入，未发现其他使用该按钮但遗漏定位的入口。

回归验证先复现按钮 computed position=static，修复后为 absolute、宽28px；显示/隐藏及表单重置通过。全量460项测试通过，构建与打包成功，修改文件 ESLint/Prettier 通过。

通过 SSH 停止服务、仅替换 dist、启动更新 NAS，保留全部应用数据。服务 running，运行和应用中心登记版本均为0.2.52。数据库30表、schema13，所有表行数保持，integrity_check=ok、foreign_key_check=0。10个关键只读接口200、未授权403。已验证部署HTML与本地SHA256一致：4c0813347ffe9ab79f3db7a4ddd403d2a4315dd6c0394d2958019d4b978f7f7e。

安装包：build/deskicons/deskicons.fpk；SHA256：f8d59b24342d51f49dcae7448d1ceeabd27648d22133f57676edf8eba2fa081a。

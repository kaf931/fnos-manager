# NAS 管家图标与移动端入口

2026-10-20，版本 0.2.10。使用内置 image_gen 工具生成透明 PNG；原始图片与项目使用的缩小版本均保存在 `web/assets/brand/`。应用包名仍为 deskicons，已有配置不迁移、不改名。

- `nas-manager.png`：NAS 管家应用图标，512px；打包时生成 64px / 256px 应用中心、窗口及桌面图标。
- `storage-scan.png`：存储首页扫描状态与扫描进度图，256px。
- `storage-space.png`：空间分析入口图，256px。
- `storage-duplicates.png`：重复检查入口图，256px。

图片通过同一 storage-artwork 模块加载，通用尺寸规则在既有 storage.css 中维护。导航栏继续使用共用线性图标，避免插画混入导航控件。移动端两张扫描卡片纵向排列，下方长卡片保留原有工具与记录入口。

## 生成提示词

应用图标：

Create one production app icon for a NAS management app called NAS 管家, no letters or text. Inspired by polished Chinese NAS OS desktop icons: an almost full-canvas rounded-square blue gradient tile, subtle 3D beveled edges, luminous cyan top-left and royal blue bottom-right. Center a clear white and pale-cyan stylized compact NAS server with two horizontal drive bays and a subtle house-roof silhouette integrated into its top, conveys home NAS manager. Simple strong silhouette readable at 48px, refined soft dimensional shading, no shield, no tools, no floating particles, no background scene, no cast shadow outside tile. True transparent canvas outside the rounded square. Square composition with tile occupying 90 percent width and height, balanced optical padding. Output a single icon, not a sheet.

三张存储图共用提示词：

Generate one isolated production UI illustration icon: [subject]. Unified polished fnOS-inspired utility illustration style: simple softly dimensional 3D shapes, saturated royal blue base, icy white and pale cyan upper surfaces, subtle mint-green accents, delicate highlights, frontal three-quarter view. Clear bold readable silhouette at 80px, no text, no letters, no symbols unrelated to subject, no tile or enclosing circle, no background scenery, no floor, no long shadows. Real transparent background, centered with consistent 12 percent padding. Square image, one single icon only.

subject 分别为：

1. a compact blue scanning tray with a small stack of translucent documents, a soft cyan scanning beam and four tiny mint scan corner brackets
2. a blue file tray holding two pale translucent folders and one compact stacked NAS drive, a small cyan pie-chart disk in front clearly indicating storage capacity analysis
3. a blue file tray holding two identical pale translucent document sheets offset side by side, a small magnifying glass in front with two matching cyan squares indicating duplicate file detection

扫描运行时增加 CSS 光带，每 1.8 秒往返；生成图片本身保持稳定，完成或取消后不再使用运行态动画类。遵循 prefers-reduced-motion。

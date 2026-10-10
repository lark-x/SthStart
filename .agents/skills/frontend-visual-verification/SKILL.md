---
name: frontend-visual-verification
description: >-
  Use when validating frontend UI appearance, multi-viewport layout consistency, visual regressions,
  and interaction fidelity across desktop, tablet, and mobile in SthStart using Playwright and image analysis.
---

# SthStart 前端视觉一致性与回归验证准则 (Visual Verification)

确保每次前端界面重构、样式迭代或交互升级都能获得高保真、多视口且无视觉回归的客观证据支持。

---

## 一、 视觉验证核心维度

1. **多视口适配阶梯 (Viewport Ladder)**：
   - **大屏桌面 (Wide Desktop)**：`1920 x 1080`（工作台双栏或三栏完全展开，自适应内容画布）；
   - **标配笔记本 (Laptop)**：`1440 x 900`（主视口基准尺寸，检查紧凑模式下的溢出与呼吸感）；
   - **平板设备 (Tablet)**：`1024 x 768`（检查侧栏收起为图标栏或抽屉、网格多列降级）；
   - **移动端窄屏 (Mobile)**：`390 x 844`（检查文档流堆叠、抽屉导航可达性与触控热区）。
2. **滚动隔离与视口锁高 (Scroll Isolation)**：
   - 验证复杂工作台在长文本或大量卡片状态下，是否发生整个窗口出现外层滚动条的恶性回归；
   - 验证独立滚动区是否具有 `data-autohide-scroll` 或优雅的细滚动条。
3. **视觉零瑕疵检查点 (Zero-Defect Checklist)**：
   - **无文字溢出/硬截断**：长文件名、中文段落排版自然折行，无横向不可控滚动条；
   - **无莫名其妙的表情符号**：彻底杜绝任何 Emoji 字符，严格使用统一风格的矢量 SVG 图标；
   - **无状态空白或死锁**：加载态具备 Skeleton 骨架屏或优雅指示器，空状态具备明确指引与主要 CTA。

---

## 二、 自动化截图脚本规范

在执行视觉回归测试时，采用 Playwright 驱动生产构建或开发服务。遵循以下工程约定：

1. **环境准备**：
   - 启动生产服务器（如 `vinext start -p 4173`）与依赖服务，避免开发模式的热重载闪烁；
   - 写入统一管理员会话 Cookie：
     ```ts
     const sessionRes = await fetch(`${baseUrl}/api/auth/admin-session`, {
       method: 'POST',
       headers: { origin: baseUrl },
     });
     // 提取 sthstart_admin_session 并注入 browser context
     ```
2. **高分屏渲染 (Retina 2x)**：
   - 浏览器上下文必须配置 `deviceScaleFactor: 2`，以获得高保真高 DPI 截图，避免字型模糊影响评估。
3. **网络与动画就绪等待**：
   - 使用 `waitForLoadState('networkidle')` 结合适度延时（400~800ms），等待 CSS 渐变、图标挂载与动画淡入完毕后再截屏。

---

## 三、 截图分析与人工核验闭环

1. **落盘与证据归档**：
   - 所有验收截图必须保存至 Conversation Artifacts 目录或 `artifacts/visual-verification/` 下；
2. **工具自检机制**：
   - **严禁仅凭脚本 exit code 0 就判定视觉表现合格**。
   - 必须通过 `view_file` 工具查看实际生成的截屏图片，核对视觉间距、字号层级、对比度与组件对齐状态。
3. **环境安全边界**：
   - 视觉验收严禁篡改本地生产数据库核心业务数据；
   - 测试完毕后必须主动释放占用端口并优雅终止子进程。

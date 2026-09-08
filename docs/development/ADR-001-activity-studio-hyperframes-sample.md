# ADR-001: 活动工作室 HyperFrames 样片架构与离线工程规范

## 1. 状态
**已接受 (Accepted)** - 2026-09-07；2026-09-08 按实际修复与渲染验证更新。

## 2. 背景
活动工作室（Activity Studio）是 SthStart 仓库内的一个完全独立应用（`/apps/activities`），不以邻舍运行为前提。应用的核心价值是创作多阶段活动群聊记录与朋友圈，并支持以模拟手机视角回放和导出供外部通过 HyperFrames 渲染为 MP4 视频的工程包。

根据用户明确决策：
- 应用内负责导出合法的 HyperFrames HTML composition 自包含工程，MP4 视频由用户在外部环境调用 `hyperframes render` 生成。
- 第一版不在应用内常驻重型渲染服务，但研发过程中必须在本地真实运行 HyperFrames 渲染，证明工程导出的绝对成立与确定性。

## 3. 关键技术决策

### 3.1 工具链与版本锁定
- **HyperFrames 版本**：锁定为 `0.8.30`（npm `hyperframes@0.8.30`）。
- **运行环境依赖**：Node.js >= 22 (当前 v24.19.0)、FFmpeg 9.0.1、FFprobe 9.0.1、Chrome Headless Shell (v152.0.7977.30)。
- **动画库**：GSAP 3.14.2，本地内置在导出的工程 `assets/` 目录下，禁止外部未受控的 CDN 运行时强依赖。

### 3.2 布局与尺寸规范
- **默认模板**：`phone-v1`（通用智能手机竖屏模拟）。
- **画布尺寸**：导出为 1080×1920 (9:16 竖屏，30fps)，逻辑视口为 360×640 (逻辑倍率 3.0)。
- **排版防溢出**：聊天气泡采用 `word-break: break-word`、弹性容器与动态高度度量，长中文、emoji 和连续长 URL 不得撑破气泡。

### 3.3 动作编排与时间状态机
- **时间轴驱动**：将应用的动作序列（`PlaybackAction[]`）编译为挂载在 `window.__timelines["main"]` 的暂停 GSAP Timeline。
- **确定性回放**：正式预览与导出统一使用编译后的暂停时间轴，字体加载后测量 DOM 布局以计算滚动位置。浏览器测试覆盖直接 seek 与先前进再回退到同一时间点的状态一致性。旧 `stateAtTime` 辅助函数仅提供近似诊断，已弃用，不是正式渲染器。
- **阅读停留时长公式**：
  $$\text{durationMs} = \operatorname{clamp}\left(1200 + \frac{\text{graphemeCount}}{6} \times 1000,\, 1800,\, 12000\right)$$

### 3.4 视频与音频播放
- 每次视频展开编译为静态 `src` 的 `<video muted class="clip">`，设置 `data-start`、`data-duration` 和 `data-media-start`；对应音轨使用独立 `<audio>` 及音量属性。导出工程由 HyperFrames 管理媒体时钟，不在 GSAP 中修改视频 `currentTime` 或动态替换 `src`。打开其他媒体或关闭弹窗时截断原播放窗口。应用预览宿主按同一时间与窗口同步媒体。
- 视频缩略图使用静态封面图并叠加居中播放图标，避免在聊天列表中同时预加载多个未播放的视频流。

### 3.5 应用内预览与导出一致性
- 应用内的“回放预览”面板通过受控 `iframe` 嵌入由同一套编译器生成的 HTML，并通过同源 DOM 驱动 `window.__timelines["main"].seek(t)` 进行时间跳转，杜绝前端 React 界面与 HyperFrames 导出视频两套渲染逻辑导致的视觉偏差。

## 4. 样片验证结果
- 原创测试角色：岚 (actor_lan) 与 澄 (actor_cheng)
- 原创阶段剧本：布置营地沙滩 -> 晚餐与篝火合影
- 关键帧测试点：
  1. 聊天初始界面呈现 (t=0s - 4s)
  2. 聊天平滑滚动至照片消息 (t=4s - 5s)
  3. 全屏展开图片照片与淡出关闭 (t=5s - 9.4s)
  4. 平滑滚动至视频消息并全屏播放带音频视频片段 (t=9.4s - 15.4s)
  5. 滑动转场切换至朋友圈视图并定位到对应动态 (t=15.8s - 18s)
  6. 停留在朋友圈界面供观众阅读 (t=18s - 25s)
- 验证指令：`npx hyperframes check` / `npx hyperframes render -o sample.mp4`。
- 2026-09-08 修复后重新渲染：25 秒、750 帧，FFprobe 确认 H.264 视频与 AAC 音轨；check 为 0 错误，保留重复头像的媒体发现提示。
- 完整修复与验证边界见 [复核修复记录](logs/2026-09-08-activity-review-fixes.md)。

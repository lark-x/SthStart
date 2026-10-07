# 雪山回声：Remotion / Hyperframes 对比小样

这是隔离实验，不是正式发布链路的替换。主应用、数据库结构、活动草稿、DSH 和 ComfyUI 均未因本实验改变。

## 输入与演出约定

- 使用 2026-10-04 已完成的六张 ComfyUI 图片和六句 Step 配音，不再次调用模型。
- 同一组裁切副本、同一个混音文件、同一时间线：1080×1920、30 fps、2038 帧（约 67.93 秒）。
- 深蓝墨色背景、暖纸色字幕、角色色强调；开篇标题、六个独立画格、结尾。
- 图像小幅推近和横移、短画格入场、句级字幕卡出现、雪粒及第四镜的微光效果。
- 风声和蓝光提示音由本地程序生成，没有下载或使用第三方音乐。
- 字体使用项目已有 Noto Sans SC，并保留 OFL 许可。

裁切在副本上进行，不修改源图。尤其第四镜原图主体过小，裁切放大必然模糊；第六镜人物姿势仍不符合“写字”。视频框架不能修复这些图像语义问题。现有配音也没有分角色声线或语气设计。

字幕时间按句长在配音实际时长内分配，不是语音识别或逐字强制对齐；不做伪精确的逐字高亮。

## 重现

在项目根目录执行 `node experiments/publication-motion-comparison/prepare.mjs`。
该脚本以只读方式读取指定验收活动的素材，输出到 `artifacts/publication-motion-comparison-20261004`。
不要改成用户其他活动后直接运行；小样来源固定在脚本中的已知测试 fixture。

两个子项目独立安装依赖，不改主项目依赖：

```powershell
cd experiments/publication-motion-comparison/remotion
npm ci
npx remotion studio --no-open --port=3090
npx remotion render SnowEcho F:/Project/SthStart/artifacts/publication-motion-comparison-20261004/remotion.mp4 --concurrency=2 --crf=18 --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Hyperframes 使用独立 HTML/GSAP 时间线：

```powershell
cd experiments/publication-motion-comparison/hyperframes
npm ci
node build.mjs
npx hyperframes lint . --json
npx hyperframes render . --fps=30 --workers=2 --crf=18 --output=F:/Project/SthStart/artifacts/publication-motion-comparison-20261004/hyperframes.mp4
```

`composition.template` 是源码；`build.mjs` 将同一 manifest 编译成静态 `index.html`，并复制本地 GSAP。这里使用真实 Hyperframes CLI 的逐帧渲染，不以录屏或主项目 Canvas/FFmpeg 拼接冒充框架导出。模板不能使用 `.html` 扩展名，否则 CLI 会发现两个根入口并报错。

目前 lint 无错误，但有 9 条警告：8 条提示抽取可独立编辑的子 composition，1 条提示开篇和第一镜复用同一图片。单文件小样暂保留这些结构；只有一条音轨，并非将原素材或配音重复生成。正式接入时应按镜头拆分可编辑的子 composition，而不是直接把本实验文件塞入主应用。

两个 MP4 都输出后，从项目根目录执行：

```powershell
node experiments/publication-motion-comparison/serve.mjs
node experiments/publication-motion-comparison/verify.mjs
```

对比页：http://127.0.0.1:3092 。仅绑定回环地址，只暴露固定白名单文件；支持视频分段读取，不接收路径或凭据。两个视频一起播放时只放出一个声音。

## 验收范围

只检查本小样：两个 MP4 的尺寸、帧率、时长、音轨；六个关键帧；本地对比页播放、单音轨试听及桌面/窄屏溢出。没有部署主应用，没有迁移数据库，也不跑全站 CI。

产物和截图位于 `artifacts/publication-motion-comparison-20261004/`，检查结果见 `verification.json`。
框架和素材副本依赖只供实验；正式接入前仍需决定版式、配音、字幕对齐、运行环境、渲染资源与许可。不能由一条小样推断全部场景稳定性或某个引擎天然画得更好。

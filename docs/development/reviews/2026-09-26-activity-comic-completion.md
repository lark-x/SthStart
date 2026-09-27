# 活动漫画模式：修复与实机验收记录（2026-09-26）

## 结论

阶段 0–5 的实现和靶向验收已通过；阶段 6 已使用独立的“阿贝多与砂糖的雪山实验”样例完成两页六格、真实 ComfyUI 生图、选图、版本保存、PNG 和离线包导出，并在桌面及窄屏实际打开。用户原活动未被改写。样例活动：`20703630-0301-48bc-9319-234c74de36bf`。

仍需区分两个边界：实机样例使用 Anima Turbo、无 LoRA；本机 LoRA 清单为空，带 LoRA 的真实生图不能声称通过。样例中的最终六格是人工编排后逐格生图；同一活动另行验证了 AI 分镜生成、人工应用与撤回恢复，但最终展示版本保留人工编排。没有把这两条操作伪称为同一次连续生成。

## 阶段结果

| 阶段 | 结果与证据 |
| --- | --- |
| 0 基线 | 保留开始前大量未提交改动；未重置或清理用户文件。相关旧镜头测试通过。 |
| 1 契约、迁移、存储 | 迁移 43 `activity-comic-drafts-revisions-and-jobs` 已应用。CAS、非法引用、重复气泡 ID、不可变版本、图片引用均有靶向测试。迁移前备份：`data/backups/2026-09-26T07-42-21.885Z/`。最终主库和 narrative 库完整性均为 `ok`。 |
| 2 静态编辑 | 页面模板、画格顺序、来源镜头、角色、裁切、气泡、演出、窄屏逐格视图已可编辑；共用 Canvas 渲染器。桌面 1440×900、1920×1080、窄屏 390×844 均无全页横向溢出。 |
| 3 AI 分镜 | 真实模型第一次返回 `close_up`、`bottom_left` 等非法枚举，任务明确失败且未改草稿；补充精确枚举提示后，第二次生成 6 格、应用为两页，再恢复原两页样例。成功任务 `34471ac3-e73e-4d36-8120-2ecad3b1db7b`，调用 `f1b989e0-03cc-4639-9ded-2840d89144a1`。无自动宽松映射或静默删字段。 |
| 4 生图历史 | 六次真实 Anima Turbo 绘制均成功，六张图片文件可读并选入漫画；六条绘图日志和六条提示词优化日志均为成功。使用 `anima-activity` v2、`anima_turboV10.safetensors`、`anima_baseV10_txt.safetensors`、`qwen_image_vae.safetensors`，768×512、8 步，seed `2026092601`–`2026092606`。六个 ComfyUI 任务 ID 见下表。 |
| 5 阅读与导出 | 浏览器实际导出 `1920×1080` 的两页 PNG 及 PNG ZIP；服务端导出包含六张图片和本地字体的离线 ZIP。解压后以 `file://` 在 1440 和 390 视口打开，无外部网络请求、无页面异常。修复气泡尾巴从椭圆内部引出的黑色长线；编辑器、PNG、离线阅读均复用此渲染器。 |
| 6 实机总验收 | 独立活动保存为两页六格，实际截图可人工查看。项目 Docker 容器已同步最新构建并处于健康状态。验证结束后关闭本轮启动的 ComfyUI 进程，释放显存。 |

六个生图任务：

| 格 | ComfyUI 生成任务 | AI 调用日志 |
| --- | --- | --- |
| 1 | `f0856552-e1ca-463a-8265-7e161a05b7a1` | `6fb6faea-34a8-4fa6-a441-f3cfcc5a4ccf` |
| 2 | `f8ddd348-22e9-488a-bd34-1637db5a309d` | `6f2e8c9d-5955-421f-b5ec-0dbad698a203` |
| 3 | `66fda8bb-db75-42d0-99ac-67dad729d3c4` | `d19140de-0527-468f-8ec9-aa1fdeb722da` |
| 4 | `90179aea-28dd-493a-ac5c-b34cb3dd947c` | `1d461554-8581-46b0-9420-423b430d2ef9` |
| 5 | `18c385db-7f7e-4a6c-99f2-589a40910951` | `4aa62aa5-6a98-49c8-bad3-3e770a942079` |
| 6 | `8f20d424-558a-4004-a735-3125df319d0e` | `e504fc34-d771-42ee-ace2-490e8acc57ae` |

## 本轮主要改动

- `comic-workstation.tsx`、`use-comic-draft.ts`：始终使用漫画绑定的冻结剧情版本，避免当前活动的未保存文字悄悄改变漫画来源；完善页面与画格编辑。
- `comic-page-list.tsx`、`comic-canvas-editor.tsx`、`comic-reader.tsx`、`comic-panel-inspector.tsx`：页面模板与顺序、移动端逐格阅读、来源和气泡编辑。
- `comic-image-history.tsx`、`comic-render-dialog.tsx`：图片历史分页，提交超时后的稳定幂等键与 seed。
- `comic-store.ts`、`comic-renders.ts`、`comic-storyboard.ts`、`comic-validation.ts`：幂等恢复、非法结构拒绝、精确枚举提示。
- `text-layout.ts`、`renderer.ts`、`comic-exports.ts`、`comic-offline-reader.ts`：文字溢出校验、气泡尾巴、离线包及窄屏阅读。
- `scripts/verify-comic-layout.mjs`、`scripts/verify-comic-offline.mjs`、`scripts/verify-comic-live.mjs`、`scripts/verify-comic-storyboard-live.mjs`、`scripts/verify-comic-export-ui.mjs`：可重复的布局、离线与实机靶向验证；实机脚本需显式开关与管理员凭证。

## 最终验证与产物

- `npm run test:contracts`：17/17；`npm run test:portal`：13/13；漫画、镜头与回放靶向测试：22/22。
- `npm run typecheck`、`npm run build`、Docker 健康检查、`npm run db:integrity`：通过。
- 实机截图：`artifacts/activity-comic-screenshots/repair-2026-09-26T12-56-08-439Z/`。构建后 PNG 与离线核验：`artifacts/activity-comic-screenshots/live-sample-20703630-0301-48bc-9319-234c74de36bf/`。
- 交付文件：上述样例目录内的 `page-001.png`、`page-002.png`、`comic-pages.zip`、`comic-reader.zip`。其中 `offline-real-1440x900.png`、`offline-real-390x844.png` 记录了双击离线页的效果。

## 尚未声称完成的事项

- 真实 LoRA 绘制：目标实例未安装 LoRA 文件；仅完成逻辑和缺项阻断测试。安装兼容 LoRA 后再做一张实机样本。
- 图像语义与角色一致性：六张图已人工查看，但人物细节在不同画格中仍有变化；没有参考图或 LoRA，不能保证完全一致。
- `git diff --check` 报告的 `app/features/characters/mutations.ts` 末尾空行是既有无关改动，本轮未动它；大量现存未提交文件继续保留。

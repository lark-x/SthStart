# 出图简单与专业模式交付

日期：2026-10-13
关联：[开发计划](../plans/IMAGE_CONFIGURATION_SIMPLE_PROFESSIONAL_PLAN.md)、[配置评估](2026-10-13-image-configuration-simple-professional-review.md)、VAL-016。

## 已实施

- 共用模式名称统一为“简单模式 / 专业模式”，沿用已有浏览器偏好键，两种模式共享草稿和执行输入。收起的手动最终词、负面词、LoRA 覆盖和采样参数有具体摘要与恢复默认操作；简单画幅选择不误计专业修改，自动准备结果不误计用户覆盖。
- 图像工坊简单模式保留描述、情境画风、角色/世界观、参考图、方案与画幅；原始画师/质量字段只在专业模式出现。专业字段按类型和已知兼容键分组，工作流选择收进详情；模型与角色继承 LoRA 按实际允许能力展示。
- 头像固定当前角色，精简情境画风、补充要求和画幅展示，提醒未保存角色资料；精确参数在专业模式。负面词编辑不再隐式把正面词切换成手动最终模式，恢复继承独立操作。
- 当前 StudioShell 接回素材与批量面板、活动美术、分镜配置/历史/重绘/细化；分镜快出图先确认保存，防重复并刷新历史。移动端可进入素材、漫画与镜头绘制；桌面三栏保持独立滚动，平板顶栏采用紧凑视图选择。采纳媒体时保留等待响应期间的作者输入，不复活已删除镜头。
- 漫画与素材的参考图、导演设置和补充要求在简单模式可达；显式选方案时不再同时展示会被方案覆盖的档位选择。批量“生成方案”和“批次偏好”分开表达。
- 活动美术加入共用模式切换；简单选择画风卡、档位和画幅，专业修改原始风格文本、档位绑定及负面词。细化简单只展示原图与目标尺寸，专业展示重绘幅度和实际执行快照，继续继承原图配置。
- 生成配置中心的常用设置覆盖活动图片、工坊文生图、工坊图生图和头像；默认方案与尺寸按用途隔离，尺寸范围/步长使用工作流声明。专业配置继续管理工作流发布、连接、预设、策略和 LoRA。

## 验证

| 检查 | 结果 |
| --- | --- |
| 所有工作区类型检查 | 通过 |
| 核心修改模块定向 ESLint | 通过，无错误或警告 |
| 配置状态、场次媒体合并与草稿队列 | 13 项通过 |
| Portal 生产构建 | 通过 |
| 完整 ComfyUI 浏览器回归 | 生产构建下 14 项通过，无用例排除；包含原两项活动入口缺口、用途默认隔离、恢复继承、模式切换、对白保留、手机和四视口布局 |
| 视觉检查 | 390/1024/1440/1920 Retina 截图；实际查看四视口工作台、手机美术/头像/素材/漫画和工坊截图，无横向及外层视口溢出 |

生产验收命令：PowerShell 设置 `$env:STHSTART_COMFY_PORTAL_MODE = 'production'` 后执行 `npm run test:e2e:comfy`，先运行 `npm run build:portal`。服务 fixture 只使用临时数据库，并拒绝真实上游请求。截图证据在 `artifacts/visual-verification/image-configuration-2026-10-13/`。

开发服务器曾在末尾退出造成两项连接失败，随后生产构建完整回归通过；未放宽行为断言。旧开发模式 details hydration 警告仍属于既有运行环境问题，本次生产回归没有该警告。VAL-016 已完成；VAL-015 的真实 ComfyUI、模型/LoRA/向量及画质对照保持未验证。

## 边界

- 没有修改真实数据库、已有用途默认、邻舍代码或版本，没有部署、提交或推送。
- 专业模式仅编辑工作流已声明的字段；动态继承角色 LoRA 在通用面板中只读，角色配置入口负责维护，活动按图 LoRA 覆盖使用原有协议。不增加任意图/节点执行授权。
- 图像工坊继续使用既有情境画风，活动复用既有画风卡；跨用途画风卡与收藏库没有新增数据模型。完整语义字段分组仍兼容旧定义，尚未扩展共享契约。
- 本次验收证明配置交互与输入行为，没有验证 GPU 的实际图片质量。细化工作流能力与软件升级另见 VAL-015。

## 主要文件

- [image-settings.ts](../../../app/features/generation/image-settings.ts)：分组、隐藏覆盖与恢复继承。
- [image-generation-panel.tsx](../../../app/features/generation/components/image-generation-panel.tsx)：工坊/头像用途适配。
- [image-mode-switch.tsx](../../../app/features/generation/components/image-mode-switch.tsx)：共用模式与摘要。
- [studio-shell.tsx](../../../app/features/activities/components/studio/studio-shell.tsx)：活动能力接回与移动端。
- [activity-image-quick-settings.tsx](../../../app/features/generation/components/activity-image-quick-settings.tsx)：各用途默认配置。
- [comfy-business-contexts.spec.ts](../../../tests/e2e/comfy-business-contexts.spec.ts)：隔离服务与多视口验收。

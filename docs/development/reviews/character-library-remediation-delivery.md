# Character Library Remediation 交付审计

日期：2026-09-08

后续复查已发现并修复主流程问题，最终状态以[复查与修复报告](2026-09-08-character-remediation-review-fixes.md)为准。下文保留首次交付记录。

## 交付范围

已按实现规格落地角色库修复主链路：

- 角色简洁/详细编辑、草稿 CAS、发布冻结版本、版本来源与字段溯源。
- 本地 JSON/PNG、V1/V2/V3 卡片、普通图片、URL、粘贴资料和 Character Tavern 搜索导入。
- 导入会话的预览、字段映射、可编辑确认、取消、幂等提交、重复来源快照复用和过期清理。
- 卡片原文与不可变来源快照下载、兼容性提示、角色试演、外观候选提取和角色专用模型路由。
- 角色参考图用途、默认造型、角色专属 artifact，以及转入活动后的活动应用 artifact 和幂等转移。
- 活动创建时按服务端指定角色版本生成快照；图像提示词、输入能力和来源溯源支持角色/版本/参考图。
- 数据库迁移 v16/v17、前端角色编辑器/导入对话框/活动角色选择与参考图工作流。

主要入口：

- [角色服务](../../../apps/service/src/characters.ts)
- [导入会话](../../../apps/service/src/characters/import-sessions.ts)
- [卡片解析](../../../apps/service/src/characters/card-parser.ts)
- [Character Tavern provider](../../../apps/service/src/characters/source-providers/character-tavern.ts)
- [活动角色快照与参考图转移](../../../apps/service/src/activities/characters.ts)
- [前端导入对话框](../../../app/features/characters/components/character-import-dialog.tsx)
- [前端角色编辑器](../../../app/features/characters/components/character-editor.tsx)

## 自动化验证

- `npm run typecheck`：通过。
- `npm run build`：通过，portal 与 service 均完成构建。
- `npm run test:portal`：9/9 通过。
- 角色定向回归：14/14 通过，覆盖解析、来源 provider、导入会话、幂等、CAS、版本快照、artifact 转移、迁移和旧角色兼容。
- `npm test --workspace @sthstart/service`：117 项中 115 项通过；仅 2 项既有 runtime 测试因当前沙箱禁止监听 `127.0.0.1` 而失败，错误为 `listen EPERM`，与角色库实现无关。
- 新增角色测试与导入测试的定向 ESLint：通过；`git diff --check`：通过。
- 仓库全量 lint 仍受既有问题影响，不能作为本次改动的全绿证据；已对本次新增角色模块和测试做定向检查。

## 真实来源验证

Character Tavern 的真实搜索、详情读取和 PNG 下载已完成；记录见[来源 provider spike](./character-source-provider-spike.md)。Chub API 在当前环境返回区域不可用的 403，因此未将其伪造为通过。

## 仍需真实环境验收

以下项目需要用户可用的浏览器/模型/GPU环境，当前没有把离线 mock 结果冒充完成：

- 浏览器中的桌面/移动布局、人手确认/取消导入和完整角色编辑流程。
- 已配置多模态模型的真实外观提取、候选确认和角色试演。
- 已配置 ComfyUI 的真实文生图、单参考图图生图及最终活动导出/播放链路。
- 规格中的完整人工验收矩阵（M3/M4/M5 及对应 T 项）。

结论：代码、迁移、契约、离线自动化和真实 Character Tavern provider 验证已交付；依赖外部模型/GPU和人工浏览器操作的验收项明确保留为待验收状态。

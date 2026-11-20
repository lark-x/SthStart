# 文档、Skill 与 MCP 清理

2026-11-19，复核当前引用后，将旧方案与批次用法移入归档，收敛本机工具注册。

## 清理结果

| 项目 | 处理 |
| --- | --- |
| 三份 2026 年 10 月活动方案与实施记录 | 移至 `docs/archive/activity-studio-2026-10/`，归档导航保留入口 |
| `extract-character-persona` | 原规则与模板移至 `docs/archive/character-persona-extraction.md`，退出工作区 Skill 自动发现目录 |
| 根目录 `_CONTEXT_COMPRESSION.md` | 移至本机 `docs/archive/_CONTEXT_COMPRESSION.md`，人设卡批次说明改用归档路径 |
| DSH 桌面 bundle 的 `gamesmcp`、`story` | 删除旧目录和旧端口注册。桌面 bundle 保留 Aseprite；作品配对的 Story/Publication 由启动器加载 |
| 本机 `.codex/config.toml` | 与用户级 Akasha 配置完全相同，移入回收站。用户级注册仍可列出 |
| GamesMcp 旧测试与重复配置备份 | `_smoke-test.cjs` 和 `cordis.patch.yml.bak-20261016-212042` 移入回收站 |
| Docker 构建上下文 | 增加 `.codex`、DSH 本机 bundle 和本机批次交接笔记的排除项 |

根 README 增加[总导航](../../README.md)，剧情指南按实际脚本改为“五个源 Skill 合成一个套件”。状态页补录一幕故事首版，Creative Agent 接口页改为已接线的服务状态。

## 验证

- `node scripts/sync-story-skills.mjs --check` 通过。
- `node --test tests/system/story-skills.test.mjs scripts/story-dsh/generate-web-patch.test.mjs` 的 5 项测试通过。
- 已安装的 DSH CLI 可合并清理后的本机 bundle，生成配置中仅保留 Aseprite 注册。
- 移除重复项目配置后，`codex mcp list` 仍列出 Akasha。
- 检查变更文档的相对文件链接，均可定位。
- 本机清理明细记录在 `artifacts/docs-tooling-cleanup-20261119/removed-files.jsonl`，包含路径、字节数和回收方式。

## 本地发布

已将文档和归档路径同步到本地 `9320` 容器，并逐文件核对哈希。容器中的旧 Skill、失效本机配置和归档前路径一并清理。Portal 与容器内 Service 的健康请求均返回 200，资料源仍为 `zlb` 启用、虚空终端预设停用。

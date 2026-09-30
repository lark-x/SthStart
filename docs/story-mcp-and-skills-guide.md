# SthStart 剧情 MCP 与 Skills 使用指南

本文说明现有剧情 MCP 的读取与提案能力、创作 skill 的维护方式，以及按改动选择的检查。接口以 `apps/service/src/story/native-mcp-server.ts` 和 `mcp-server.ts` 的实际工具定义为准。

## 1. 资料、草稿与正式内容

MCP 提供项目资料读取和待审提案工具；skill 指导模型如何使用资料和组织产物，两者不会自动连接或互相代替。

常见链路为：用户指定任务 → 使用已提供文本或读取项目资料 → 生成分析或草稿 → 用户要求提交时生成提案 → 作者在 SthStart 审阅并接受或拒绝。

- 分析和预览不自动提交提案。用户已经明确要求生成并提交时，不重复询问相同授权。
- MCP 未连接时，仍可处理用户给出的文本，但不能声称已读取完整项目。
- 搜索结果通常是摘录；需要上下文时继续读取条目。列表按返回游标翻页，长正文按 offset 补读，区分已确认设定、推测与新增建议。
- 提交提案不会改变正式资料。只有作者接受后才能称为已采纳；版本冲突应重新读取资料并调整提案，不能伪造 revision 或自动覆盖。

## 2. 当前可用工具

原生桥接由 `native-mcp-server.ts` 提供六个工具，通过门户 Story bridge 调用服务：

| 工具 | 能力 |
| --- | --- |
| `get_project` | 读取当前项目标题、简介与版本 |
| `list_entries` | 按 kind 列出条目，支持 cursor 和 limit |
| `read_entry` | 按 kind、id 读取正文，支持 offset，返回截断信息 |
| `search_entries` | 按 query 搜索，返回摘录和可继续读取的定位信息 |
| `submit_proposal` | 提交新建或更新提案，等待作者审阅 |
| `get_proposal_status` | 查询已有提案状态 |

`kind` 支持 outline、world、scene、chapter、character。原生提案字段为 `operation`、`kind`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`：

- 更新：先读取现有目标，使用真实 ID 与读取时的 revision。
- 新建：targetId 和 baseRevision 为 null；不能新建 outline，大纲只能更新。
- 提案正文是准备写入的完整内容，分析和修改理由放在 reason 或回复中。

旧版 `mcp-server.ts` 提供 `story_get_project`、`story_get_outline`、`story_get_character`、`story_get_world`、`story_get_scene`、`story_search`，以及 outline、world、scene、character 对应的 `story_propose_<kind>_change`。旧版提案用于更新现有目标，不支持原生桥接的章节新建能力。以客户端实际发现的工具为准，不把两套名称和参数混用。

## 3. 连接外部 Agent

从剧情工作台的 MCP 配置入口获取当前项目配置和令牌，按客户端要求填写。服务与门户需要可访问；示例里的路径、地址、项目 ID 和令牌都要替换，不把示例配置当作已经建立的连接。

```json
{
  "mcpServers": {
    "sthstart-story": {
      "command": "node",
      "cwd": "<ABSOLUTE_PROJECT_PATH>",
      "args": [
        "--import",
        "tsx/esm",
        "<ABSOLUTE_PROJECT_PATH>/apps/service/src/story/native-mcp-server.ts"
      ],
      "env": {
        "STHSTART_STORY_PORTAL_URL": "http://127.0.0.1:4173",
        "STHSTART_STORY_PROJECT_ID": "<PROJECT_ID>",
        "STHSTART_STORY_BRIDGE_TOKEN": "<BRIDGE_TOKEN>"
      }
    }
  }
}
```

客户端的配置格式、cwd 支持和 Node 查找方式可能不同，优先使用工作台给出的配置，并确保 Node 与 tsx 能在项目依赖环境下解析。旧版运行会话配置由对应集成流程提供，不复制原生桥接的环境变量去启动旧版服务。

stdio 用于客户端与 MCP 子进程通信，子进程仍通过 HTTP 访问 SthStart；不能据此假定不需要后端、地址配置或有效令牌。

## 4. 创作 Skill 的维护与同步

写作 skill 的唯一编辑源为 `apps/service/src/story/skills/`。`.agents/skills/` 下对应文件是生成副本，不在两处分别修改。

| 源目录 | 工作区副本目录 | 职责 |
| --- | --- | --- |
| `character-design` | `story-character-design` | 人物目标、需求、关系和说话方式 |
| `continuity-check` | `story-continuity-check` | 剧情一致性、证据与最小修复 |
| `scene-writing` | `story-scene-writing` | 场景和对白创作、审查 |
| `story-outline` | `story-outline` | 大纲推进、转折和收束 |
| `story-scene-flow` | `story-scene-flow` | 符合当前编译器的剧本流 |

```bash
npm run skills:sync
npm run skills:sync -- --check
```

同步脚本只维护上述五个副本，调整 frontmatter 的 name 并添加来源说明；其他 frontmatter 字段和正文保留。副本相同时不重写。`--check` 不创建目录、不写文件，缺失或不一致时列出文件并以非零退出码结束。

当前 skill 均为自包含的 `SKILL.md`，脚本不复制 references、scripts 或 assets。未来若新增辅助资源，需要同时扩展同步与检查范围；新增写作 skill 需显式登记到脚本的 managedSkills，不能依靠脚本扫描覆盖其他工作区 skill。

skill 是否被发现和自动选择取决于客户端的发现机制、触发描述与任务上下文，不保证任何客户端自动加载，也不享有高于用户或系统指令的优先级。

维护 skill 时保留清楚的 name、description，正文只写会影响执行判断的项目知识。输入可以来自用户文本，也可以来自已连接 MCP；不要把工具连接或提交提案设为所有写作任务的前提。

剧本流的具体输出约定见源 skill `story-scene-flow/SKILL.md`。现有编译器把方括号起始行识别为场景标题，主要从对白提取角色，不能承诺自动识别纯动作中的全部人物。

## 5. 必要检查与可选调试

- 仅修改 skill 或本指南：检查 frontmatter、触发描述、路径、工具名和参数，再执行同步与 `--check`。不因此部署、启动模型或提交真实提案。
- 修改同步脚本：在临时目录检查同步、幂等、差异检测、只读行为，以及不会修改其他 skill。
- 修改 MCP 实现或契约：运行 `npm run test:mcp`；该命令覆盖 `native-mcp-server.test.ts` 和 `mcp-schema.test.ts`。其他类型检查和测试按实际改动选择。
- 需要检查现场连接或交互报文时，可运行 `npm run mcp:inspect`。脚本可能发现项目、申请桥接令牌并通过 npx 启动 Inspector，属于连接调试，不是只读格式检查，也不是日常 skill 修改的必备步骤。

没有可用服务或凭据时说明未验证的连接范围，不把语法检查通过当作真实创作链路已运行。不强制每次修改完成全部业务测试或实际 Agent 闭环。

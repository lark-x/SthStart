# 剧情工作室

入口：`/apps/story`。系统采用双工作台：**DSH 原生 Web 负责讨论，SthStart 负责正式资料与提案审阅**。在 DSH 中讨论剧情、提交修改建议；回到 SthStart 查看差异，人工接受后才写入正式内容。

正式文档类型为大纲、世界观、场景和章节；项目角色也有自己的修订记录。章节正文是 Markdown，章节排序独立于正文版本。每次保存、接受提案、恢复历史都会产生不可变修订。迁移生成的 v1 标记为“迁移时当前内容”，不会冒充真实历史。

## 正式编辑与版本

- Markdown 编辑器提供源码、预览和分屏；支持 GFM 表格、清单、删除线、引用和代码块，不允许原始 HTML。可使用标题、粗体、斜体、引用、列表和代码块工具。
- 编辑停顿 600ms 后通过条目修订号执行 CAS 自动保存。切换条目、接受提案、恢复版本前会先等待当前保存完成。
- 输入保存在浏览器 IndexedDB，按“项目＋资料类型＋条目”隔离。断网时会显示“仅保存在本机”；恢复连接后可以重试。
- 服务器返回 409 时不会自动覆盖两边。页面保留本地文本并展示服务器版本；用户可以复制本地内容、切回服务器版本，或在明确确认后以本地版本覆盖服务器当前版本。
- 提案可为 `update` 或 `create`。旧内置会话的提案保留 `legacy` 来源；原生 DSH 提案没有伪造的会话深链接。更新提案按 `baseRevision` 比较；过期提案保持待审，不能覆盖人工修改。接受和版本写入在同一事务中完成，重复接受不会重复创建版本。
- 版本恢复会创建新修订，不改写历史。搜索服务端按页返回标题和短摘录，不会把整份长章节一次带回。

## DSH 项目配对和手动启动

DSH 原生页面负责原生会话、流式 Markdown、模型选择和轨迹。每个剧情项目有独立的 Windows DSH 工作目录；同一时间使用本机固定端口 `3081`，因此一次只能启动一个项目的 DSH。项目切换前先退出当前 DSH。DSH 模型和凭据在 DSH 自己的设置中配置，不会从 SthStart 公共模型路由复制。

1. 在项目工作台点击“DSH 配对”，生成项目一次性 Token。Token 只显示一次，关闭页面或再次生成后不能重新读取。
2. 在运行 SthStart 的同一台 Windows 电脑用 PowerShell 执行页面显示的命令。首次运行需加 `-Pair`；启动器以 `Read-Host -AsSecureString` 接收 Token，并用当前 Windows 用户 DPAPI 保护到 `%LOCALAPPDATA%\SthStart\StoryBridge\<projectId>.cred`。
3. 启动器将解密后的 Token 仅置于本进程环境，然后启动项目隔离的 DSH Web profile。Token 不进入命令行、URL、DSH 配置文件、SthStart 页面或日志。
4. DSH 首次启动后，在 DSH 自己的设置界面配置模型与 API 凭据。模型供应商的额度或上下文限制仍由供应商决定。

### 在 DSH 使用 OpenCode Zen 免费模型

DSH 0.1.7 的原生“设置 → 模型 → 添加模型提供商”已有 `opencode`，无需为 SthStart 新增一套模型路由。先在 [OpenCode Zen](https://opencode.ai/docs/zen) 登录并获取自己的 API Key，再在 DSH 选择 `opencode`、填写密钥并保存；回到会话底部的模型菜单选择并实际试用模型。免费标记表示该模型目前按零单价提供，不保证永久可用，也不保证第三方客户端可调用。若返回“只能在 OpenCode 内使用”，应视为供应商限制，不尝试伪装 OpenCode 客户端绕过。DSH 的每个剧情项目使用独立配置，换项目后要在该项目的 DSH 设置中重新配置。

邻舍旧版“免费鸡蛋”直接访问 Zen 且不发送鉴权头，但它写死的 `deepseek-v4-flash-free` 已不可用；实测 `mimo-v2.5-free`、`mimo-v2.6-flash-free` 对外部调用返回“只能在 OpenCode 内使用”。不要把占位字符串当 API Key：Zen 对无效 Bearer Key 返回 401。个别模型可无 Key 直接响应也不构成 DSH 的稳定鉴权方案。优先用官方 Key 和 DSH 原生提供商配置；使用免费模型处理未公开剧情前，请先查看 [Zen 的隐私与免费模型说明](https://opencode.ai/docs/zen#privacy)。

工作目录与会话保存在 `%LOCALAPPDATA%\SthStart\StoryDsh\<projectId>\`。启动器还会把 DSH 的首次默认工作区放在该项目的 `workspace\deepseek-harness\default-workspace` 下；Windows 打包环境可能把这一目录显示为 `Packages\...\LocalCache\Local\SthStart\StoryDsh\<projectId>\workspace\...`。旧 DSH 数据若仍将默认工作区指向公共 Documents，启动器会拒绝启动；先保留旧目录的可恢复备份，再在新的项目专属工作区重建会话，不要直接删除旧数据。以后启动时去掉 `-Pair`；重新配对时重新生成 Token 并加 `-Pair`。撤销会立即使旧 Token 失效。启动器每 30 秒发送心跳；服务重启后会显示离线，DSH 不会因此自动恢复运行。

启动器验证 Portal 为本机回环地址、桥接权限可用、端口未占用后才启动 DSH。端口占用时只提示并退出，不会终止占用进程。DSH 仅绑定 `127.0.0.1:3081`；如果用户通过局域网地址打开 SthStart，页面不会显示一个会指向访问设备而非启动器电脑的错误链接。SthStart 不自动启动或托管 Windows DSH 进程。

启动器与 MCP 适配器位置：

```text
scripts/story-dsh/start.ps1
scripts/story-dsh/launcher.mjs
scripts/story-dsh/generate-web-patch.mjs
apps/service/src/story/native-mcp-server.ts
```

适配器基于安装的 `@deepseek-ai/dsh` Web 标准 profile 生成 patch，保留 DSH 原生标准插件并追加 MCP 客户端。安装包须支持 `--profile web`、`--patch` 和 `--dump-config`；启动前需能检查合并后的配置。升级 DSH 后重新验证 MCP 工具注册。

## 桥接权限边界

每个项目最多一个有效桥接凭据；数据库只存 SHA-256 哈希，状态接口不返回 Token。DSH 使用的六个 MCP 工具为 `get_project`、`list_entries`、`read_entry`、`search_entries`、`submit_proposal`、`get_proposal_status`。项目 ID 固定在启动器环境中，模型不能指定其他项目。

桥接只允许读取项目摘要与资料、分段读取正文、搜索、提交待审提案、查询本项目提案和发送心跳。长正文每次最多读取 20,000 字符；搜索最多 20 条短摘录；过大的提案会报错而不是静默截断。桥接没有正式内容写入路由，管理员 Token 也不能替代项目桥接 Token。Portal 仅代理明确白名单路径和方法，不转发管理员 Cookie。

这是一条**应用权限边界**，不是同一 Windows 用户下的操作系统级文件沙箱。具有同一用户文件权限的程序仍可能读取该用户的本地文件。

## 旧会话和备份

原 SthStart 内置会话、消息、运行数据和旧提案继续保存在服务数据库中；新工作台把它们作为只读归档展示，不提供续聊、压缩或伪造历史工具轨迹。旧 API 和受限运行时暂留兼容，不作为新工作台的对话路径。旧内容不会迁移成 DSH 原生会话。

数据库与 DSH 本地数据分开备份：

- 数据库备份包含正式剧情、旧内置会话、提案及修订。
- 本机 DSH 会话、项目工作目录和 DSH 模型凭据不会进入未加密的 SthStart 普通项目备份。需另行安全备份 `%LOCALAPPDATA%\SthStart\StoryDsh\`；桥接凭据可在恢复后重新配对，不建议复制凭据文件到另一 Windows 用户。
- 既有 `data\dsh\story` 和 `data\story-workspaces` 旧目录只保留为可恢复备份；数据库迁移不会删除它们。

## 数据库迁移

本轮追加服务数据库迁移 **45**：允许章节文档；扩展提案 operation/origin/目标字段；重建提案表并保留旧会话关联；为当前正式文档和角色建立迁移时基线；新增不可变资料修订表和项目桥接 Token 哈希表。

实际迁移之前必须按顺序运行：

```powershell
npm run db:check
npm run db:backup
npm run db:migrate
npm run db:integrity
```

迁移过程中不要同时让另一个 Service 实例使用同一数据库。记录备份目录，完整性或外键检查失败时停止服务写入并按数据库恢复流程处理，不要通过删除表或重置数据库规避错误。

## 测试与运维

Story 契约、服务存储、迁移、桥接权限、原生 DSH MCP stdio、Portal 白名单代理，以及旧 Story 运行时兼容测试：

```powershell
npm run test:contracts
node --import tsx/esm --test apps/service/src/story/*.test.ts
node --import tsx/esm --test app/api/story-bridge/route.test.ts
npm run test:portal
npm run typecheck
npm run build:portal
npm run build:service
```

自动化测试使用内存数据库和模拟 HTTP 服务验证权限与接口，不代表真实模型调用已通过。首次真实联调应使用新建的测试项目：验证本机配对、DSH Web 配置、六个工具读取、提交一个更新提案和一个新建提案；再在 SthStart 接受一项、拒绝一项并检查版本。模型供应商模型需在 DSH 中单独配置。日志或工具参数中不得出现桥接 Token、管理员凭据或模型密钥。

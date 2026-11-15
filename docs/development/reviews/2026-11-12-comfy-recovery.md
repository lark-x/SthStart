# ComfyUI验收恢复交接（2026-11-12）

关联[故事世界交付记录](2026-11-11-story-worlds-delivery.md)、VAL-017。本文记录已核实对象和恢复顺序，不表示清理、重启或生图已执行。用户已授权清理该测试项并兼容重启；自动审批此前仅返回`blocked by policy`。不得换工具、换端口或另起实例绕过拒绝；执行条件改变后沿原授权继续，不重复索取同一授权。

## 当前已核实状态

| 对象 | 值与证据 |
| --- | --- |
| 监听实例 | localhost:8188，原本次启动的PID26172，python.exe |
| Python | F:/ComfyUI_windows_portable_nvidia/ComfyUI_windows_portable/python_embeded/python.exe |
| 工作目录 | F:/ComfyUI_windows_portable_nvidia/ComfyUI_windows_portable |
| 当前启动参数 | -s ComfyUI/main.py --windows-standalone-build --fast fp16_accumulation --port 8188 --listen 127.0.0.1 |
| 故障 | comfy-live.stderr.log中CUDA unknown error，Thread-1(prompt_worker)在torch.cuda.synchronize退出；HTTP队列仍响应 |
| 当前队列 | running0、pending1，promptId62001702-c2f3-4f1c-ab2f-47759c493a2d；该项history为空 |
| 测试项标识 | SaveImage前缀sthstart/anima_activity_parity，9节点；不是任意用户排队项 |
| 对应本地任务 | 隔离库/tmp/sthstart-worlds-images-live-20261111/service.db，task37f4d955-62bc-46b6-96ae-66c8d05da6f4，app story-worlds |
| 保守占位 | status abandoned，upstream_may_continue1，queue_slot_held1；当前仍应保持 |
| GPU只读诊断 | RTX3080 12GiB，驱动610.88，Torch2.13.0+cu130；独立新进程一个小tensor运算、读回2.0及synchronize通过 |

小tensor不是Comfy模型加载或图片成功证明。当前证据不定位具体根因，不要求重装Torch/驱动、修改模型或全局环境。`--fast`在该版本参数说明中明确是实验优化，但这不证明它就是本次错误的原因。

## 恢复顺序（待执行条件解除）

1. 重新确认8188监听PID、可执行文件和启动参数仍是上表原实例；确认运行队列为空、唯一待排队promptId仍相同。出现其他任务或进程变化时先重新核对，不清空整个队列。
2. 仅删除上述唯一测试排队项，随后核对queue/history已无该prompt；保留原失败任务、日志和审计，不删除数据库或媒体。
3. 只停止该次启动的Comfy实例，在原目录以原Python和8188重启。后台启动隐藏窗口，输出写到新的日志，旧日志不覆盖。不能用项目comfy:restart不加核对地终止端口上所有进程。
4. 本版cli_args.py已确认支持的候选参数为：`-s ComfyUI/main.py --windows-standalone-build --port 8188 --listen 127.0.0.1 --disable-cuda-malloc --disable-async-offload --disable-dynamic-vram --disable-fast-disk --lowvram`。此候选去掉原--fast实验优化，改用静态保守加载；不是已经验证的修复方案。先检查启动日志、system_stats与空队列，再做单幅原工作流试验。
5. 上游确已删除/停止后，才通过现有confirmGenerationTaskUncertainOutcome对上述隔离任务确认取消，填写实际核对说明；保留原provider_task_id、失败记录和人工事件。不能直接SQL改upstream_may_continue或slot字段，更不能因超时自动释放。
6. 单幅Comfy实际成功并查看图片后，再进行故事/自由生成、Comfy/GPT混合队列验收。使用同一个隔离数据库和公共调度器；明确每类最多1、总数最多2，未知任务仍占位。记录任务ID、应用、实际派发/结束时间和队列采样，不以重新排了队作为成功。

若重启后仍出现CUDA错误，保留新日志和实际失败阶段，再诊断候选参数/模型兼容；不反复提交同一未知任务或通过CPU假图替代原GPU工作流验收。

## 可复核证据

本机artifacts/story-worlds-implementation/：comfy-current-queue.json、comfy-fresh-cuda-probe.log、comfy-live.stderr.log、live-images-comfy2.log。上表task与prompt的对应关系已从隔离库provider_task_id字段只读核对，正式库没有为本轮诊断写入任何故事或任务。上述路径和PID是采样时状态，真正执行前必须复核。

## 已准备的有限验证

[live-final-image-acceptance.ts](../../../artifacts/story-worlds-implementation/live-final-image-acceptance.ts)默认只读预检，只有明确执行开关才允许在全新隔离库写入并派发；脚本不会清理、重启或核销旧未知任务。单幅场景最多1个Comfy故事图；混合场景最多4项，分别是Comfy/GPT的故事图和自由图。重复运行遇开始标记或已有测试库即拒绝，不自动重试；观察上限20分钟，未知结果继续占位。成功任务终态只记录为待看图，不自动声明内容合格。

09:03（UTC+8）在已部署容器中未带执行开关运行，语法转换零诊断，真实只读预检按预期退出2：原队列0运行/1待处理、旧未知任务仍在、正式活动生图0。之后确认新测试库与开始标记均未创建，原任务未知/占位字段仍为1。见[预检日志](../../../artifacts/story-worlds-implementation/final-image-preflight.log)、[后置只读状态](../../../artifacts/story-worlds-implementation/final-image-preflight-state.log)。只验证了准备脚本的默认只读阻断路径，尚未执行单幅或混合付费/本地模型任务；不能把这一预检称为生图或队列验收成功。

## ComfyUI MCP实查（2026-11-12 10:05，UTC+8）

用户要求检查ComfyUI MCP并再次授权相关操作。现有comfy_mcp确实可调用，未新增安装：comfy-cli1.20.0，工作区仍为原便携版ComfyUI目录，目标http://127.0.0.1:8188，无远程目标。此授权不改变先前自动审批拒绝，以下仅做只读诊断，没有用MCP重试取消、停止或重启。

| 检查 | 本轮结果与边界 |
| --- | --- |
| server_info | running=true只说明HTTP可达；GPU为RTX3080、12GiB，符合本地图片路径。安装v0.37.2、报告最新v0.45.2；本次未更新，不根据版本差异推断CUDA根因。 |
| job queue/status | 原prompt62001702-c2f3-4f1c-ab2f-47759c493a2d仍pending、9节点、0输出。queue列表另含9条九月CLI历史记录；它们无当前queue_position，不能把列表count10说成10个真实等待任务。直接只读GET /queue确认当前0运行/1待处理。 |
| validate_workflow | 从原排队项只读导出原prompt，再校验原文件：valid=true、0错误/0警告、partner_nodes为空、spends_credits=false。仅证明当前节点/输入结构校验通过，不证明模型实际加载、出图或显存可用。 |
| system_stats | MCP返回isError=true、Error executing tool system_stats。原实例本轮stderr出现get_total_memory→torch.cuda.mem_get_info→CUDA unknown error，当前HTTP在线不是GPU工作线程健康证据。 |
| get_logs(port8188) | 返回ComfyUI/user/comfyui_8188.log，mtime为2026-09-26；其中CPU版Torch启动失败是旧日志，不是PID26172当前故障。当前实例日志仍是本项目comfy-live.stderr.log。 |
| MCP默认Python | server_info报告uv/tools/comfy-mcp/Scripts/python.exe，所装torch/version.py为2.14.0+cpu、cuda=None。已读该版resolve_workspace_python：只找VIRTUAL_ENV/CONDA_PREFIX、工作区.venv或venv，否则使用自身Python；没有识别兄弟目录python_embeded的分支。不能直接假定MCP默认launch/restart会使用原CUDA环境。 |
| 进程所有权 | 原PID26172仍为python_embeded/python.exe，原启动参数未变。MCP配置background=null，stop只管理comfy-cli自己记录的实例；当前不是它登记启动的服务。没有传confirm_kill_untracked终止原进程。 |
| 10:04预检 | 准备脚本仍按预期退出2：队列未空、旧未知未核销、正式活动生图0。未派发单幅或混合任务。 |

结论：MCP可用于读取任务、校验原工作流，以及恢复后观察实际生成结果；现阶段不是一个可安全直接采用的默认重启入口。实际恢复仍须保持原便携版CUDA Python与原8188，且不得用另一工具绕过先前清理/重启的自动拒绝。未下载模型、安装节点、升级Comfy/PyTorch、释放显存、清理任务或修改全局MCP配置。

本轮原始证据：[MCP探测完整结果](../../../artifacts/story-worlds-implementation/comfy-mcp-probe-20261112.json)、[原排队工作流副本](../../../artifacts/story-worlds-implementation/comfy-mcp-original-prompt.json)、[MCP检查后的只读预检](../../../artifacts/story-worlds-implementation/final-image-preflight-mcp.log)。

# 实验性媒体能力

## H3 FL2VA

当前只保留 H3 FL2VA 的真实就绪探测，不开放生成入口。默认关闭；只有配置 `STHSTART_H3_ENABLED=true` 和实际可访问的 `STHSTART_H3_WORKER_URL`，且该 Worker 的 `/health` 返回 `ready: true` 与 `h3-fl2va` 能力时，管理端状态才会显示为可用。

固定初始边界：最大 854×480（480p）、最长 4 秒、并发 1。这里的状态不是对显存能力的承诺；RTX 3080 12 GB 是否能稳定运行，必须以目标机器上的真实模型、依赖、显存和长时间测试为准。没有真实 Worker 就绪信号时，系统不会伪造成功任务、耗时或产物。

启用或再分发 H3 前，请先阅读 [H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)，自行确认所在地区、具体用途和再分发方式符合许可要求；SthStart 不替代许可证或法律审查。

管理端探测接口：

```text
GET /api/v1/admin/experiments/h3/status
```

媒体设置页还会通过 `GET /api/v1/admin/media/diagnostics` 检查 `ffmpeg` 与 `ffprobe`。缺少任意一个时，视频元数据、缩略图和播放预处理保持禁用，并只给出人工安装指引；不会自动修改 Mac，也不影响图片生成。

## 后续评估项

以下能力本轮明确延期，保持不可用：

| 能力 | 当前状态 | 开放条件 |
| --- | --- | --- |
| Ref2VA | deferred | 先完成真实输入/输出协议、资源占用与断点恢复测试 |
| 云端 H3 | deferred | 先完成供应商、计费、隐私和失败语义评估 |
| 2K 输出 | deferred | 先完成 480p 链路稳定性、清晰度与显存基线 |

延期项不会复用图片任务接口伪装成已支持能力，也不会在公共服务故障时静默切换到未验证的模型。

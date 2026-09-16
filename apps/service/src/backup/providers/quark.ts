import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * 夸克网盘能力核实报告。
 *
 * 公开资料只说明「有 OAuth / CLI / 存储能力，且没有删除命令、原生 Windows 不支持」，
 * 这不等于已经验证为本项目可用的稳定后台接口。因此这里只做能力核实，
 * 不提供看似可用的上传按钮：报告未通过的项目保持未完成状态。
 */
export interface QuarkCapabilityReport {
  status: 'verified_unavailable' | 'needs_commissioning';
  cliPath: string | null;
  cliVersion: string | null;
  platform: string;
  /** 文档明确说明没有删除命令，因此自动清理只能标记逻辑过期。 */
  deleteSupported: false;
  items: Array<{ key: string; question: string; result: 'unverified' | 'unsupported'; detail: string }>;
  notes: string[];
  checkedAt: string;
}

function runCli(path: string, args: string[]): string | null {
  try {
    // 以参数数组调用，不做 shell 拼接。
    return execFileSync(path, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 }).trim();
  } catch {
    return null;
  }
}

export function probeQuarkCapabilities(environment: Readonly<Record<string, string | undefined>> = process.env): QuarkCapabilityReport {
  const candidates = [environment.STHSTART_QUARK_CLI_PATH?.trim(), 'quark', 'quark-clouddrive'].filter((value): value is string => Boolean(value));
  let cliPath: string | null = null;
  let cliVersion: string | null = null;
  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    const version = runCli(candidate, ['--version']);
    if (version) {
      cliPath = candidate;
      cliVersion = version.split('\n')[0] ?? version;
      break;
    }
  }
  const notes = [
    '公开资料只描述 OAuth、CLI 与存储能力，未验证可被本项目非交互后端稳定复用。',
    '文档说明没有删除命令：自动清理只能标记逻辑过期，远端文件需要在网盘端手动清理。',
    '文档说明原生 Windows 不受支持（需要 WSL）；本机平台：' + process.platform + '。',
  ];
  return {
    status: 'needs_commissioning',
    cliPath,
    cliVersion,
    platform: process.platform,
    deleteSupported: false,
    items: [
      { key: 'auth', question: '授权能否被非交互后端复用、刷新并检测失效', result: 'unverified', detail: '需要真实账号与凭据才能确认刷新与失效检测行为。' },
      { key: 'list_upload_download', question: '能否列目录、上传、下载并返回稳定文件 ID', result: 'unverified', detail: '需要实际联调；在验证前不参与自动备份。' },
      { key: 'resumable', question: '大文件上传、重试与断点恢复能力', result: 'unverified', detail: '未核实；即使可用，也按「中断后重传当前文件」处理。' },
      { key: 'delete', question: '是否支持删除', result: 'unsupported', detail: '文档说明没有删除命令，不能伪造清理成功。' },
      { key: 'platform', question: '当前系统环境能否调用', result: cliPath ? 'unverified' : 'unsupported', detail: cliPath ? '检测到 CLI：' + cliPath + '，但仍需联调确认命令与结果格式。' : '当前系统未检测到夸克 CLI。' },
    ],
    notes,
    checkedAt: new Date().toISOString(),
  };
}

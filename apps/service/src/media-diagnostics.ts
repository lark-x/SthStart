import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getH3Status } from './h3.js';

const execFileAsync = promisify(execFile);

export interface MediaToolStatus {
  available: boolean;
  version: string | null;
  error: 'not_found' | 'unavailable' | null;
}

export interface MediaDiagnostics {
  checkedAt: string;
  video: {
    ffmpeg: MediaToolStatus;
    ffprobe: MediaToolStatus;
    preprocessingReady: boolean;
    installHint: string | null;
  };
  h3: Awaited<ReturnType<typeof getH3Status>>;
}

type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<{ stdout?: string | Buffer }>;

function versionFromOutput(output: string): string | null {
  const match = output.match(/\bversion\s+([^\s]+)/i);
  return match?.[1]?.slice(0, 80) || null;
}

export async function inspectMediaTool(
  command: string,
  runner: CommandRunner = execFileAsync as unknown as CommandRunner,
): Promise<MediaToolStatus> {
  try {
    const result = await runner(command, ['-version'], { timeout: 2_000, maxBuffer: 16 * 1024, windowsHide: true });
    return { available: true, version: versionFromOutput(String(result.stdout ?? '')), error: null };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return { available: false, version: null, error: code === 'ENOENT' ? 'not_found' : 'unavailable' };
  }
}

export async function getMediaDiagnostics(
  fetcher: typeof fetch = fetch,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  runner: CommandRunner = execFileAsync as unknown as CommandRunner,
  h3WorkerToken: string | null = null,
): Promise<MediaDiagnostics> {
  const [ffmpeg, ffprobe, h3] = await Promise.all([
    inspectMediaTool('ffmpeg', runner),
    inspectMediaTool('ffprobe', runner),
    getH3Status(fetcher, environment, h3WorkerToken),
  ]);
  const preprocessingReady = ffmpeg.available && ffprobe.available;
  return {
    checkedAt: new Date().toISOString(),
    video: {
      ffmpeg,
      ffprobe,
      preprocessingReady,
      installHint: preprocessingReady
        ? null
        : '未检测到完整的 ffmpeg/ffprobe。请在 Mac 上手动安装 FFmpeg 后重启服务；SthStart 不会自动修改系统。',
    },
    h3,
  };
}

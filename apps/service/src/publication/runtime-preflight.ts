import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The two external binaries a `makeVideo` publication run needs on the service host. */
export type VideoBinary = 'ffmpeg' | 'ffprobe';

/**
 * Injectable command probe. Production always passes the real probe; tests can inject a
 * missing-binary simulation without unloading host tools or mutating `process.env`.
 */
export type VideoBinaryProbe = (binary: VideoBinary) => Promise<boolean>;

export async function probeBinary(binary: VideoBinary): Promise<boolean> {
  try {
    await execFileAsync(binary, ['-version'], { timeout: 2000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Standalone FFprobe probe used by the speech pipeline, which persists then verifies audio. */
export const ffprobeAvailable: () => Promise<boolean> = () => probeBinary('ffprobe');

export interface VideoDependencyCheck { ok: boolean; missing: VideoBinary[] }

/**
 * Confirms the binaries a video run needs. Comics never call this: a comic export does not
 * encode video and must keep working on a host without FFmpeg/FFprobe.
 */
export async function checkVideoDependencies(probe: VideoBinaryProbe = probeBinary): Promise<VideoDependencyCheck> {
  const [ffmpeg, ffprobe] = await Promise.all([probe('ffmpeg'), probe('ffprobe')]);
  const missing: VideoBinary[] = [];
  if (!ffmpeg) missing.push('ffmpeg');
  if (!ffprobe) missing.push('ffprobe');
  return { ok: missing.length === 0, missing };
}

/** Maps a missing dependency to the exact publication error code and a clear Chinese message. */
export function missingVideoDependency(missing: VideoBinary[]): { code: 'publication_ffmpeg_missing' | 'publication_ffprobe_missing'; message: string } {
  return missing.includes('ffmpeg')
    ? { code: 'publication_ffmpeg_missing', message: '视频制作需要 FFmpeg，但制作服务环境中没有可用的 ffmpeg 命令，请先在服务环境安装 FFmpeg 后再开始或继续视频制作。' }
    : { code: 'publication_ffprobe_missing', message: '视频制作需要 FFprobe，但制作服务环境中没有可用的 ffprobe 命令，请先在服务环境安装 FFprobe 后再开始或继续视频制作。' };
}

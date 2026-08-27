
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const execFileAsync = promisify(execFile);

export async function checkFfmpeg() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 2000, windowsHide: true });
    await execFileAsync('ffprobe', ['-version'], { timeout: 2000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function processVideoArtifact(videoPath: string, thumbnailPath: string): Promise<{ width?: number; height?: number; durationMs?: number } | null> {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return null;

  try {
    // get metadata
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ], { timeout: 5000, windowsHide: true });

    const lines = stdout.trim().split('\n');
    const width = parseInt(lines[0], 10);
    const height = parseInt(lines[1], 10);
    const durationMs = lines[2] ? Math.round(parseFloat(lines[2]) * 1000) : undefined;

    // generate thumbnail (seek to 0s or 1s)
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-ss', '00:00:00.000',
      '-vframes', '1',
      '-q:v', '2',
      thumbnailPath
    ], { timeout: 10000, windowsHide: true });

    return {
      width: isNaN(width) ? undefined : width,
      height: isNaN(height) ? undefined : height,
      durationMs: isNaN(durationMs as number) ? undefined : durationMs
    };
  } catch (error) {
    console.error('Video processing failed:', error);
    return null;
  }
}

function parseFps(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.includes('/')) return undefined;
  const [numerator, denominator] = value.split('/').map((item: string) => Number(item));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return undefined;
  return Number((numerator / denominator).toFixed(3));
}

export interface VideoMetadata {
  width: number | null; height: number | null; durationMs: number | null;
  fps: number | null; codec: string | null; hasAudio: boolean | null;
}

const EMPTY_VIDEO_METADATA: VideoMetadata = {
  width: null, height: null, durationMs: null, fps: null, codec: null, hasAudio: null,
};

export async function inspectVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  const result: VideoMetadata = { ...EMPTY_VIDEO_METADATA };
  try {
    await execFileAsync('ffprobe', ['-version'], { timeout: 2000, windowsHide: true });
  } catch {
    return result;
  }
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries',
      'stream=index,codec_type,codec_name,width,height,r_frame_rate,duration:format=duration',
      '-of', 'json', videoPath,
    ], { timeout: 5000, windowsHide: true });
    const payload = JSON.parse(stdout);
    type ProbeStream = { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string };
    const streams: ProbeStream[] = Array.isArray((payload as { streams?: ProbeStream[] }).streams)
      ? (payload as { streams: ProbeStream[] }).streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const primary = video ?? audio;
    if (video) {
      result.width = Number.isFinite(Number(video.width)) ? Number(video.width) : null;
      result.height = Number.isFinite(Number(video.height)) ? Number(video.height) : null;
      result.fps = parseFps(video.r_frame_rate) ?? null;
      result.codec = typeof video.codec_name === 'string' && video.codec_name ? video.codec_name : null;
    }
    result.hasAudio = Boolean(audio);
    const rawDuration = Number(primary?.duration ?? payload.format?.duration);
    result.durationMs = Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration * 1000) : null;
    if (!video && audio) {
      result.codec = typeof audio.codec_name === 'string' && audio.codec_name ? audio.codec_name : null;
      result.hasAudio = true;
    }
    return result;
  } catch {
    return result;
  }
}

export async function inspectImageMetadata(imagePath: string): Promise<{ width: number | null; height: number | null }> {
  try {
    await execFileAsync('ffprobe', ['-version'], { timeout: 2000, windowsHide: true });
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', imagePath,
    ], { timeout: 5000, windowsHide: true });
    const payload = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const stream = payload.streams?.[0];
    return {
      width: Number.isFinite(Number(stream?.width)) ? Number(stream?.width) : null,
      height: Number.isFinite(Number(stream?.height)) ? Number(stream?.height) : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

export async function generateVideoThumbnail(videoPath: string, thumbnailPath: string): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 2000, windowsHide: true });
    const metadata = await inspectVideoMetadata(videoPath);
    const seekSeconds = Math.min(1, metadata.durationMs ? Math.max(0, Math.min(1, metadata.durationMs * 0.2 / 1000)) : 0);
    await execFileAsync('ffmpeg', [
      '-y', '-ss', String(seekSeconds), '-i', videoPath,
      '-vframes', '1', '-q:v', '2', thumbnailPath,
    ], { timeout: 10000, windowsHide: true });
    return existsSync(thumbnailPath);
  } catch {
    return false;
  }
}

export async function fileSha256(filePath: string): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', rejectPromise);
  });
}

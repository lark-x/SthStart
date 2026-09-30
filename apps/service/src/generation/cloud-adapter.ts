import { Readable } from 'node:stream';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { streamUploadArtifact, mimeToExt } from '../artifacts.js';

export interface CloudImageItem {
  buffer: Buffer;
  contentType: string;
}

export interface CloudGenerationOptions {
  engine: {
    id: string;
    baseUrl: string;
    secret: string | null;
    name?: string;
  };
  model: string;
  operation?: 'text-to-image' | 'image-to-image';
  prompt: string;
  negativePrompt?: string;
  size?: string;
  quality?: string;
  format?: string;
  n?: number;
  referenceImage?: {
    buffer: Buffer;
    contentType: string;
    filename?: string;
  } | null;
  maskImage?: {
    buffer: Buffer;
    contentType: string;
    filename?: string;
  } | null;
  customParams?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface CloudGenerationResult {
  images: CloudImageItem[];
  model: string;
  latencyMs: number;
}

/**
 * 云端图片生成适配器
 * 规范调用 OpenAI 兼容绘图接口 (/images/generations 与 /images/edits)
 */
export async function executeCloudGeneration(options: CloudGenerationOptions): Promise<CloudGenerationResult> {
  const {
    engine,
    model,
    operation = 'text-to-image',
    prompt,
    size = '1024x1024',
    quality,
    n = 1,
    format,
    referenceImage,
    maskImage,
    customParams = {},
    signal,
    timeoutMs = 60000,
  } = options;

  if (!model.trim()) throw new Error('cloud_recipe_model_required');
  if (!['text-to-image', 'image-to-image'].includes(operation)) throw new Error('invalid_cloud_operation');
  if (operation === 'image-to-image' && !referenceImage) throw new Error('reference_image_required');
  if (!Number.isInteger(n) || n < 1) throw new Error('invalid_image_count');
  const params = { ...customParams };
  for (const key of ['model', 'prompt', 'image', 'mask', 'n', 'size', 'quality', 'response_format', 'output_format']) delete params[key];
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = engine.baseUrl.replace(/\/+$/, '');
  const startTime = Date.now();

  const authHeaders: Record<string, string> = {};
  if (engine.secret) {
    authHeaders.authorization = `Bearer ${engine.secret}`;
  }

  const effectiveSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  let response: Response;

  if (operation === 'image-to-image' && referenceImage) {
    // 调用 /images/edits 接口 (multipart/form-data)
    const url = `${baseUrl}/images/edits`;
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(referenceImage.buffer)], { type: referenceImage.contentType });
    formData.append('image', imageBlob, referenceImage.filename || 'reference.png');
    formData.append('prompt', prompt);
    formData.append('model', model);
    formData.append('n', String(n));
    if (size) formData.append('size', size);
    if (maskImage) {
      const maskBlob = new Blob([new Uint8Array(maskImage.buffer)], { type: maskImage.contentType });
      formData.append('mask', maskBlob, maskImage.filename || 'mask.png');
    }
    formData.append('response_format', 'b64_json');
    if (quality) formData.append('quality', quality);
    if (format) formData.append('output_format', format);

    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) {
        formData.append(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
      }
    }

    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        ...authHeaders,
      },
      body: formData,
      signal: effectiveSignal,
    });
  } else {
    // 调用 /images/generations 接口 (JSON)
    const url = `${baseUrl}/images/generations`;
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n,
      size,
      response_format: 'b64_json',
      ...params,
    };
    if (quality) payload.quality = quality;
    if (format) payload.output_format = format;

    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(payload),
      signal: effectiveSignal,
    });
  }

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`云端绘图请求失败 [HTTP ${response.status}]: ${errorBody.slice(0, 300)}喵。`);
  }

  const resultJson = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const dataList = Array.isArray(resultJson.data) ? resultJson.data : [];
  if (!dataList.length) {
    throw new Error('云端服务未返回任何生成图像数据喵。');
  }

  const images: CloudImageItem[] = [];

  for (const item of dataList) {
    if (item.b64_json) {
      const buffer = Buffer.from(item.b64_json, 'base64');
      if (!buffer.length) throw new Error('empty_cloud_image');
      const contentType = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
        : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : 'image/png';
      images.push({ buffer, contentType });
    } else if (item.url) {
      // 下载外部 URL 图片
      const imgRes = await fetchFn(item.url, {
        signal: AbortSignal.any([effectiveSignal, AbortSignal.timeout(30000)]),
      });
      if (!imgRes.ok) {
        throw new Error(`无法从云端下载生成结果图片 [HTTP ${imgRes.status}]喵。`);
      }
      const arrayBuf = await imgRes.arrayBuffer();
      const cType = imgRes.headers.get('content-type') || 'image/png';
      images.push({ buffer: Buffer.from(arrayBuf), contentType: cType });
    }
  }

  if (!images.length || images.some((image) => !image.buffer.length)) throw new Error('云端服务未返回有效图像数据。');
  return { images, model, latencyMs };
}

/**
 * 将云端图片写入中央资产库并关联到生成任务
 */
export async function ingestCloudImagesToArtifacts(
  config: ServiceConfig,
  database: ServiceDatabase,
  appId: string,
  taskId: string,
  images: CloudImageItem[],
): Promise<Array<{ artifactId: string; outputName: string; sortOrder: number }>> {
  const persisted: Array<{ artifactId: string; outputName: string; sortOrder: number }> = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const outputName = `output_${i}`;
    const desc = await streamUploadArtifact(config, database, {
      appId,
      stream: Readable.from(img.buffer),
      contentLength: img.buffer.length,
      contentType: img.contentType,
      originalName: `cloud_output_${i}${mimeToExt(img.contentType)}`,
      refType: 'generation-output',
      refId: taskId,
      metadata: {
        source: 'cloud-adapter',
        taskId,
        outputName,
      },
    });

    database.connection.prepare(`
      INSERT INTO generation_task_artifacts (task_id, artifact_id, output_name, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, desc.id, outputName, i, new Date().toISOString());

    persisted.push({ artifactId: desc.id, outputName, sortOrder: i });
  }

  return persisted;
}

import { Value } from '@sinclair/typebox/value';
import { ImageConfigDocumentSchema, type ImageConfigDocument } from '@sthstart/contracts';

export type ImageConfigRecovery = {
  version: number;
  baseline: string;
  document: ImageConfigDocument;
};

/** 只接受带版本、基线与完整文档的本机恢复记录；其它内容一律忽略。 */
export function parseImageConfigRecovery(serialized: string | null): ImageConfigRecovery | null {
  if (!serialized) return null;
  try {
    const stored = JSON.parse(serialized) as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    const record = stored as Record<string, unknown>;
    if (!Number.isSafeInteger(record.version) || typeof record.baseline !== 'string') return null;
    if (!Value.Check(ImageConfigDocumentSchema, record.document)) return null;
    return {
      version: record.version as number,
      baseline: record.baseline,
      document: record.document as ImageConfigDocument,
    };
  } catch { return null; }
}

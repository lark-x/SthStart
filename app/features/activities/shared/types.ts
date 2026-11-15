import type {
  Activity,
  ContentDocument,
  ContentRevision,
  MediaRevision,
  PlaybackRevision,
  LlmBindingStatus,
  ImageCapabilityDescriptor,
} from '@sthstart/contracts';

export interface ActivityCapabilities {
  llm: boolean;
  llmProfile: { id: string; name: string } | null;
  llmStatus?: LlmBindingStatus;
  media: boolean;
  images?: {
    textToImage: ImageCapabilityDescriptor;
    imageToImage: ImageCapabilityDescriptor;
  };
  templates: Array<{ id: string; name: string; version: string }>;
  limits: {
    maxActors: number;
    maxStages: number;
    maxRecords: number;
    maxDocumentBytes: number;
  };
}

export interface ActivityListFilter {
  q?: string;
  archived?: boolean;
  limit?: number;
}

export interface CreateActivityInput {
  title?: string;
  type?: string;
  theme?: string;
  location?: string;
  rules?: string;
  stageTitles?: string[];
  actors?: Array<{
    sourceCharacterId?: string;
    sourceVersion?: number;
    displayName: string;
    activityRole?: string;
    outfitDescription?: string;
    appearanceReferenceAssetKeys?: string[];
  }>;
  document?: ContentDocument;
}

export interface StagedImportPreview {
  importId: string;
  jobId: string;
  preview: {
    title: string;
    theme: string;
    activity?: { title: string; theme: string };
    actorCount: number;
    stageCount: number;
    messageCount: number;
    postCount: number;
    mediaCount: number;
    assetCount?: number;
  };
}

export interface ActivityDetailResponse {
  activity: Activity;
  draft: import('@sthstart/contracts').ActivityDraft;
  currentContentRevision?: ContentRevision | null;
  currentMediaRevision?: MediaRevision | null;
  currentPlaybackRevision?: PlaybackRevision | null;
}

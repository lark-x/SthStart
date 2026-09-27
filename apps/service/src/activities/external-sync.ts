import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type {
  ContentDocument,
  SyncExternalActivity,
  ActivityScene,
  SceneBeat,
  StageDefinition,
} from '@sthstart/contracts';
import { streamUploadArtifact } from '../artifacts.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { ActivityStore } from './store.js';

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function inferMediaType(mime: string, ext: string): 'image' | 'video' {
  if (mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) {
    return 'video';
  }
  return 'image';
}

export async function processExternalMedia(
  filePathOrUrl: string,
  config: ServiceConfig,
  database: ServiceDatabase,
): Promise<{ url: string; mediaType: 'image' | 'video' }> {
  // If it's already an HTTP / relative URL, keep it
  if (
    filePathOrUrl.startsWith('http://') ||
    filePathOrUrl.startsWith('https://') ||
    filePathOrUrl.startsWith('/')
  ) {
    const ext = extname(filePathOrUrl.split('?')[0]).toLowerCase();
    const mime = inferMimeType(filePathOrUrl);
    return {
      url: filePathOrUrl,
      mediaType: inferMediaType(mime, ext),
    };
  }

  // If local file exists, upload to artifact store
  if (existsSync(filePathOrUrl)) {
    const stats = statSync(filePathOrUrl);
    const fileName = basename(filePathOrUrl);
    const ext = extname(filePathOrUrl).toLowerCase();
    const mime = inferMimeType(filePathOrUrl);
    const stream = createReadStream(filePathOrUrl);

    const artifact = await streamUploadArtifact(config, database, {
      appId: 'activities',
      stream,
      contentType: mime,
      contentLength: stats.size,
      originalName: fileName,
    });

    return {
      url: `/api/admin/artifacts/${artifact.id}/file`,
      mediaType: inferMediaType(mime, ext),
    };
  }

  // Fallback: return as-is
  const ext = extname(filePathOrUrl).toLowerCase();
  const mime = inferMimeType(filePathOrUrl);
  return {
    url: filePathOrUrl,
    mediaType: inferMediaType(mime, ext),
  };
}

export async function syncExternalActivity(
  input: SyncExternalActivity,
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
) {
  // 1. Process media files in scenes and beats
  const processedScenes: ActivityScene[] = [];
  if (input.scenes) {
    for (const scene of input.scenes) {
      const processedBeats: SceneBeat[] = [];
      for (const beat of scene.beats || []) {
        let mediaUrl = beat.mediaUrl;
        let mediaType = beat.mediaType;

        if (mediaUrl) {
          const res = await processExternalMedia(mediaUrl, config, database);
          mediaUrl = res.url;
          if (!mediaType) mediaType = res.mediaType;
        }

        processedBeats.push({
          ...beat,
          id: beat.id || `beat_${randomUUID()}`,
          mediaUrl,
          mediaType,
        });
      }
      processedScenes.push({
        ...scene,
        id: scene.id || `scene_${randomUUID()}`,
        beats: processedBeats,
      });
    }
  }

  // 2. Prepare stages and document
  const activityId = input.activityId;
  const existingActivity = activityId ? store.getActivity(activityId) : null;

  if (existingActivity) {
    // Update existing activity's draft document
    const draft = store.getDraft(existingActivity.id);
    const currentDoc: ContentDocument = draft?.document || {
      schemaVersion: 1,
      activity: {
        title: input.title,
        type: existingActivity.type,
        theme: input.theme || existingActivity.theme,
        location: '',
        rules: '',
        generationMode: 'autonomous',
      },
      actors: input.actors || [],
      relationships: [],
      stages: [],
      conversations: [],
      messages: [],
      posts: [],
      comments: [],
      likes: [],
      mediaSlots: [],
      facts: [],
      stageResults: [],
    };

    // Update actors if provided
    if (input.actors && input.actors.length > 0) {
      currentDoc.actors = input.actors;
    }

    // Update or attach scenes to stages
    if (currentDoc.stages.length < 2) {
      currentDoc.stages = [
        {
          id: 'stage_1',
          title: '第一阶段：主要分镜',
          order: 1,
          actorIds: currentDoc.actors.map((a) => a.id),
          location: processedScenes[0]?.locationText || '',
          instruction: '由外部流水线同步的分镜',
          requiredBeats: [],
          locked: false,
          endCondition: '所有分镜播放完毕',
          scenes: processedScenes,
        },
        {
          id: 'stage_2',
          title: '第二阶段：后续发展',
          order: 2,
          actorIds: currentDoc.actors.map((a) => a.id),
          location: processedScenes[0]?.locationText || '',
          instruction: '活动后续与收尾',
          requiredBeats: [],
          locked: false,
          endCondition: '活动圆满结束',
          scenes: [],
        },
      ];
    } else {
      if (input.stages && input.stages.length >= 2) {
        currentDoc.stages = input.stages;
      } else {
        currentDoc.stages[0].scenes = processedScenes;
      }
    }
    currentDoc.scenes = processedScenes.map((s) => ({ ...s, stageId: s.stageId || 'stage_1' }));

    const expectedDraftVersion = draft?.draftVersion ?? 1;
    const updatedDraft = store.updateDraft(existingActivity.id, expectedDraftVersion, currentDoc);
    const commitResult = store.commitDraft(
      existingActivity.id,
      existingActivity.headVersion,
      updatedDraft.draftVersion,
    );

    return {
      success: true,
      activityId: existingActivity.id,
      headVersion: commitResult.activity.headVersion,
      sceneCount: processedScenes.length,
      beatCount: processedScenes.reduce((acc, s) => acc + s.beats.length, 0),
    };
  } else {
    // Create new activity
    const finalActivityId = activityId || randomUUID();
    const stages: StageDefinition[] =
      input.stages && input.stages.length >= 2
        ? input.stages
        : [
            {
              id: 'stage_1',
              title: '第一阶段：主要分镜',
              order: 1,
              actorIds: (input.actors || []).map((a) => a.id),
              location: processedScenes[0]?.locationText || '',
              instruction: '由外部流水线同步的分镜',
              requiredBeats: [],
              locked: false,
              endCondition: '所有分镜播放完毕',
              scenes: processedScenes,
            },
            {
              id: 'stage_2',
              title: '第二阶段：后续发展',
              order: 2,
              actorIds: (input.actors || []).map((a) => a.id),
              location: processedScenes[0]?.locationText || '',
              instruction: '活动后续与收尾',
              requiredBeats: [],
              locked: false,
              endCondition: '活动圆满结束',
              scenes: [],
            },
          ];

    const initialDocument: ContentDocument = {
      schemaVersion: 1,
      activity: {
        title: input.title,
        type: 'gathering',
        theme: input.theme || '',
        location: processedScenes[0]?.locationText || '',
        rules: '',
        generationMode: 'autonomous',
      },
      actors: input.actors || [],
      relationships: [],
      stages,
      conversations: [],
      messages: [],
      posts: [],
      comments: [],
      likes: [],
      mediaSlots: [],
      facts: [],
      stageResults: [],
      scenes: processedScenes.map((s) => ({ ...s, stageId: s.stageId || 'stage_1' })),
    };

    const { activity } = store.createActivity({
      title: input.title,
      type: 'gathering',
      theme: input.theme || '',
      location: processedScenes[0]?.locationText || '',
      rules: '',
      initialDocument,
    });

    return {
      success: true,
      activityId: activity.id,
      headVersion: activity.headVersion,
      sceneCount: processedScenes.length,
      beatCount: processedScenes.reduce((acc, s) => acc + s.beats.length, 0),
    };
  }
}

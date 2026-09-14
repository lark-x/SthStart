import { getJson, postJson, putJson, patchJson } from '@/app/lib/api-client';
import type {
  ActivityIdeaApply, ActivityIdeaApplyResult, ActivityIdeaBatch, TopicCollectionRun,
  TopicCollectionSettings, TopicDetail, TopicInfoNature, TopicKind, TopicListResponse, Topic,
} from '@sthstart/contracts';

export interface TopicListParams {
  q?: string;
  works?: string[];
  kinds?: TopicKind[];
  days?: number;
  view?: 'all' | 'favorite' | 'used' | 'ignored';
  page?: number;
  pageSize?: number;
}

function topicQuery(params: TopicListParams): string {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set('q', params.q.trim());
  for (const work of params.works ?? []) search.append('works', work);
  for (const kind of params.kinds ?? []) search.append('kinds', kind);
  if (params.days !== undefined) search.set('days', String(params.days));
  if (params.view) search.set('view', params.view);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const query = search.toString();
  return query ? '?' + query : '';
}

export async function fetchTopics(params: TopicListParams = {}): Promise<TopicListResponse> {
  return getJson<TopicListResponse>('/api/admin/topics' + topicQuery(params));
}

export async function fetchTopic(id: string): Promise<TopicDetail> {
  return getJson<TopicDetail>('/api/admin/topics/' + encodeURIComponent(id));
}

export async function updateTopicFlags(id: string, patch: { favorite?: boolean; ignored?: boolean }): Promise<Topic> {
  return patchJson<Topic>('/api/admin/topics/' + encodeURIComponent(id), patch);
}

export interface CollectionSettingsView {
  settings: TopicCollectionSettings;
  nextRunLocal: string | null;
  defaults: { dailyTime: string; timezone: string };
}

export async function fetchCollectionSettings(): Promise<CollectionSettingsView> {
  return getJson<CollectionSettingsView>('/api/admin/topic-collection/settings');
}

export async function saveCollectionSettings(input: Partial<TopicCollectionSettings>): Promise<CollectionSettingsView> {
  return putJson<CollectionSettingsView>('/api/admin/topic-collection/settings', input);
}

export async function fetchCollectionRuns(limit = 10): Promise<{ items: TopicCollectionRun[]; lastSuccessful?: TopicCollectionRun | null; retryable: TopicCollectionRun | null }> {
  return getJson('/api/admin/topic-collection/runs?limit=' + limit);
}

export async function startCollectionRun(options: { retryRunId?: string } = {}): Promise<{ run: TopicCollectionRun; reused: boolean }> {
  return postJson('/api/admin/topic-collection/runs', options);
}

export async function fetchIdeaBatches(limit = 20): Promise<{ items: ActivityIdeaBatch[] }> {
  return getJson('/api/admin/activity-idea-batches?limit=' + limit);
}

export async function fetchIdeaBatch(id: string): Promise<ActivityIdeaBatch> {
  return getJson<ActivityIdeaBatch>('/api/admin/activity-idea-batches/' + encodeURIComponent(id));
}

export async function createIdeaBatch(input: {
  topicIds: string[];
  requirement?: string;
  leadCharacterId?: string;
  activityType?: string;
  appendToBatchId?: string;
  ideaCount?: number;
}): Promise<ActivityIdeaBatch> {
  return postJson<ActivityIdeaBatch>('/api/admin/activity-idea-batches', input);
}

export async function applyIdea(batchId: string, ideaId: string, input: ActivityIdeaApply = {}): Promise<ActivityIdeaApplyResult> {
  return postJson<ActivityIdeaApplyResult>(
    '/api/admin/activity-idea-batches/' + encodeURIComponent(batchId) + '/ideas/' + encodeURIComponent(ideaId) + '/apply',
    input,
  );
}

/** 内容类型与信息属性的展示文案，列表与详情共用。 */
export const TOPIC_KIND_LABELS: Record<TopicKind, string> = {
  meme: '新梗与趣味讨论',
  character: '角色相关话题',
  update: '新剧情与版本动态',
  occasion: '节日、纪念日与活动契机',
};

export const TOPIC_NATURE_LABELS: Record<TopicInfoNature, string> = {
  official: '官方信息',
  community: '社区讨论',
  unconfirmed: '未证实消息',
  unknown: '不明来源',
};

export const TOPIC_VIEWS: Array<{ id: 'all' | 'favorite' | 'used' | 'ignored'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'favorite', label: '收藏' },
  { id: 'used', label: '已使用' },
  { id: 'ignored', label: '已忽略' },
];

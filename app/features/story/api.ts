import { deleteJson, getJson, postJson, putJson } from '@/app/lib/api-client';
import {
  CreateStoryBridgeGrantResponseSchema,
  SendStoryMessageResponseSchema, StoryBridgeStatusSchema, StoryCharacterListSchema, StoryCharacterSchema,
  StoryCompactResponseSchema, StoryDocumentListSchema, StoryDocumentSchema, StoryEntryRevisionListSchema,
  StoryEntrySchema, StoryMessageListSchema, StoryProjectListSchema, StoryProjectSchema,
  StoryProposalListSchema, StoryProposalSchema, StorySearchResponseSchema, StorySessionListSchema, StorySessionSchema,
  type CreateStoryCharacter, type CreateStoryDocument, type CreateStoryProposal,
  type StoryContextSettings, type UpdateStoryCharacter, type UpdateStoryDocument,
} from '@sthstart/contracts';

const root = 'story/projects';
const projectPath = (projectId: string) => `${root}/${encodeURIComponent(projectId)}`;
const sessionPath = (projectId: string, sessionId: string) => `${projectPath(projectId)}/sessions/${encodeURIComponent(sessionId)}`;

export const storyApi = {
  listProjects: () => getJson<{ items: import('@sthstart/contracts').StoryProject[] }>(root, undefined, StoryProjectListSchema),
  createProject: (title: string, summary = '') => postJson<import('@sthstart/contracts').StoryProject>(root, { title, summary }, undefined, StoryProjectSchema),
  getProject: (id: string) => getJson<import('@sthstart/contracts').StoryProject>(projectPath(id), undefined, StoryProjectSchema),
  updateProject: (id: string, expectedRevision: number, patch: { title?: string; summary?: string; contextSettings?: StoryContextSettings }) =>
    putJson<import('@sthstart/contracts').StoryProject>(projectPath(id), { expectedRevision, ...patch }, undefined, StoryProjectSchema),
  listDocuments: (id: string) => getJson<{ items: import('@sthstart/contracts').StoryDocument[] }>(`${projectPath(id)}/documents`, undefined, StoryDocumentListSchema),
  createDocument: (id: string, input: CreateStoryDocument) => postJson<import('@sthstart/contracts').StoryDocument>(`${projectPath(id)}/documents`, input, undefined, StoryDocumentSchema),
  updateDocument: (id: string, documentId: string, input: UpdateStoryDocument) =>
    putJson<import('@sthstart/contracts').StoryDocument>(`${projectPath(id)}/documents/${encodeURIComponent(documentId)}`, input, undefined, StoryDocumentSchema),
  listCharacters: (id: string) => getJson<{ items: import('@sthstart/contracts').StoryCharacter[] }>(`${projectPath(id)}/characters`, undefined, StoryCharacterListSchema),
  createCharacter: (id: string, input: CreateStoryCharacter) => postJson<import('@sthstart/contracts').StoryCharacter>(`${projectPath(id)}/characters`, input, undefined, StoryCharacterSchema),
  updateCharacter: (id: string, characterId: string, input: UpdateStoryCharacter) =>
    putJson<import('@sthstart/contracts').StoryCharacter>(`${projectPath(id)}/characters/${encodeURIComponent(characterId)}`, input, undefined, StoryCharacterSchema),
  listSessions: (id: string) => getJson<{ items: import('@sthstart/contracts').StorySession[] }>(`${projectPath(id)}/sessions`, undefined, StorySessionListSchema),
  createSession: (id: string, title: string) => postJson<import('@sthstart/contracts').StorySession>(`${projectPath(id)}/sessions`, { title }, undefined, StorySessionSchema),
  listMessages: (id: string, sessionId: string) => getJson<{ items: import('@sthstart/contracts').StoryMessage[] }>(`${sessionPath(id, sessionId)}/messages`, undefined, StoryMessageListSchema),
  sendMessage: (id: string, sessionId: string, content: string, idempotencyKey: string) =>
    postJson<{ message: import('@sthstart/contracts').StoryMessage; created: boolean }>(`${sessionPath(id, sessionId)}/messages`, { content, idempotencyKey }, undefined, SendStoryMessageResponseSchema),
  compact: (id: string, sessionId: string) => postJson<{ compacted: boolean; replacedItems: number; estimatedSourceTokens: number }>(`${sessionPath(id, sessionId)}/compact`, {}, undefined, StoryCompactResponseSchema),
  acknowledge: (id: string, sessionId: string) => postJson<import('@sthstart/contracts').StorySession>(`${sessionPath(id, sessionId)}/acknowledge`, {}, undefined, StorySessionSchema),
  listProposals: (id: string) => getJson<{ items: import('@sthstart/contracts').StoryProposal[] }>(`${projectPath(id)}/proposals`, undefined, StoryProposalListSchema),
  createProposal: (id: string, input: CreateStoryProposal) => postJson<import('@sthstart/contracts').StoryProposal>(`${projectPath(id)}/proposals`, input, undefined, StoryProposalSchema),
  decideProposal: (id: string, proposalId: string, decision: 'accepted' | 'rejected') =>
    postJson<import('@sthstart/contracts').StoryProposal>(`${projectPath(id)}/proposals/${encodeURIComponent(proposalId)}/decision`, { decision }, undefined, StoryProposalSchema),
  listRevisions: (id: string, kind: import('@sthstart/contracts').StoryDocumentKind | 'character', entryId: string) =>
    getJson<{ items: import('@sthstart/contracts').StoryEntryRevision[] }>(`${projectPath(id)}/entries/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}/revisions`, undefined, StoryEntryRevisionListSchema),
  restoreRevision: (id: string, kind: import('@sthstart/contracts').StoryDocumentKind | 'character', entryId: string, revisionId: string, expectedRevision: number) =>
    postJson<import('@sthstart/contracts').StoryEntry>(`${projectPath(id)}/entries/${encodeURIComponent(kind)}/${encodeURIComponent(entryId)}/revisions/restore`, { revisionId, expectedRevision }, undefined, StoryEntrySchema),
  reorderChapters: (id: string, expectedProjectRevision: number, chapterIds: string[]) =>
    putJson<import('@sthstart/contracts').StoryProject>(`${projectPath(id)}/chapters/order`, { expectedProjectRevision, chapterIds }, undefined, StoryProjectSchema),
  searchEntries: (id: string, query: string, kind?: import('@sthstart/contracts').StoryProposalKind, cursor?: number) => {
    const params = new URLSearchParams({ q: query, limit: '20' });
    if (kind) params.set('kind', kind);
    if (cursor !== undefined) params.set('cursor', String(cursor));
    return getJson<import('@sthstart/contracts').StorySearchResponse>(`${projectPath(id)}/search?${params}`, undefined, StorySearchResponseSchema);
  },
  bridgeStatus: (id: string) => getJson<import('@sthstart/contracts').StoryBridgeStatus>(`${projectPath(id)}/bridge-status`, undefined, StoryBridgeStatusSchema),
  createBridgeGrant: (id: string) => postJson<import('@sthstart/contracts').CreateStoryBridgeGrantResponse>(`${projectPath(id)}/bridge-grant`, {}, undefined, CreateStoryBridgeGrantResponseSchema),
  revokeBridgeGrant: (id: string) => deleteJson<null>(`${projectPath(id)}/bridge-grant`),
};

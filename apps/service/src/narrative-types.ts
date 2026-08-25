export type ConnectorCapability = 'enumerate' | 'delta' | 'stableIds' | 'locales' | 'branching' | 'entities';

export interface NarrativeImportBundle {
  schemaVersion: 1;
  source: { id: string; name: string; kind: 'json' | 'mcp'; version?: string };
  work: { externalId: string; title: string; description?: string; locale: string };
  release: { externalId: string; label: string };
  nodes: Array<{ externalId: string; parentExternalId?: string; kind?: string; title: string; order: number; summary?: string; metadata?: Record<string, unknown> }>;
  scenes: Array<{ externalId: string; nodeExternalId: string; title?: string; order: number; summary?: string; metadata?: Record<string, unknown> }>;
  utterances: Array<{ externalId: string; sceneExternalId: string; order: number; kind?: 'dialogue' | 'narration' | 'choice' | 'system'; speaker?: string; text: string; condition?: string; metadata?: Record<string, unknown> }>;
  entities?: Array<{ externalId: string; type: string; name: string; aliases?: string[]; description?: string; metadata?: Record<string, unknown> }>;
}

export interface NarrativeSourceConnector {
  readonly id: string;
  readonly name: string;
  readonly kind: 'json' | 'mcp';
  describe(): { status: 'ready' | 'needs-configuration'; capabilities: readonly ConnectorCapability[]; message: string };
  probe(): Promise<{ status: 'ready' | 'needs-configuration' | 'unavailable'; capabilities: readonly ConnectorCapability[]; message: string }>;
  listWorks?(): Promise<Array<{ externalId: string; title: string }>>;
  listReleases?(workExternalId: string): Promise<Array<{ externalId: string; label: string }>>;
  listStoryNodes?(workExternalId: string, releaseExternalId: string, cursor?: string): Promise<{ items: unknown[]; nextCursor?: string }>;
  fetchStoryNode?(externalId: string, cursor?: string): Promise<{ items: unknown[]; nextCursor?: string }>;
  normalize(input: unknown): Promise<NarrativeImportBundle>;
  getSyncCursor?(): Promise<string | null>;
}

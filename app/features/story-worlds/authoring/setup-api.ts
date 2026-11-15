import {
  WorldSetupListSchema, WorldSetupResultSchema, WorldSetupSchema, WorldSetupSummarySchema,
  type CreateWorldSetup, type UpdateWorldSetup, type WorldSetup, type WorldSetupList, type WorldSetupResult,
} from '@sthstart/contracts';
import { getJson, postJson, putJson } from '@/app/lib/api-client';

const base = 'story-worlds/setups';
export const pendingWorldsKey = ['story-worlds', 'setups'] as const;
export const worldSetupKey = (id: string) => ['story-worlds', 'setup', id] as const;
export const fetchWorldSetups = () => getJson<WorldSetupList>(base, undefined, WorldSetupListSchema);
export const fetchWorldSetup = (id: string) => getJson<WorldSetup>(`${base}/${encodeURIComponent(id)}`, undefined, WorldSetupSchema);
export const createWorldSetup = (input: CreateWorldSetup) => postJson<WorldSetupList['items'][number]>(base, input, undefined, WorldSetupSummarySchema);
export const saveWorldSetup = (id: string, input: UpdateWorldSetup) => putJson<WorldSetupResult>(
  `${base}/${encodeURIComponent(id)}`, input, undefined, WorldSetupResultSchema,
);

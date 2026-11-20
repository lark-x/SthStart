import type { CharacterWork, StoryWorld, WorldSetupList, WorkNature } from '@sthstart/contracts';

export type WorkDirectoryItem = {
  key: string; name: string; aliases: string[]; workNature: WorkNature;
  parentWork: string | null; worldId: string | null; summary: string;
  state: 'catalog' | 'pending' | 'ready';
};

/** Include empty catalog entries and pending works; a completed setup is one work, not two. */
export function mergeWorkDirectory(works: CharacterWork[], worlds: StoryWorld[], setups: WorldSetupList['items']): WorkDirectoryItem[] {
  const items: WorkDirectoryItem[] = works.map(work => ({
    key: work.worldId ?? `catalog:${work.name}`, name: work.name, aliases: work.aliases,
    workNature: work.workNature ?? 'canon', parentWork: work.parentWork ?? null,
    worldId: work.worldId ?? null, summary: work.summary ?? '', state: 'catalog',
  }));
  const upsert = (world: WorldSetupList['items'][number], state: 'pending' | 'ready', summary?: string) => {
    const existing = items.find(item => item.worldId === world.id)
      ?? items.find(item => !item.worldId && [item.name, ...item.aliases].some(name => name.toLocaleLowerCase() === world.title.toLocaleLowerCase()));
    const next: WorkDirectoryItem = {
      key: world.id, name: world.title, aliases: existing?.aliases ?? [],
      workNature: world.workNature ?? existing?.workNature ?? 'original',
      parentWork: world.parentWork ?? existing?.parentWork ?? null, worldId: world.id,
      summary: summary ?? existing?.summary ?? '', state,
    };
    if (existing) Object.assign(existing, next); else items.push(next);
  };
  for (const setup of setups) upsert(setup, 'pending');
  for (const world of worlds) upsert(world, 'ready', world.summary);
  return items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

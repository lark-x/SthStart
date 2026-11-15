export type NarrativeMode = 'read' | 'research' | 'import';

/** URL remains the source of truth for mode; `project` implies research. */
export function narrativeModeFromParams(params: Pick<URLSearchParams, 'get' | 'has'>): NarrativeMode {
  if (params.get('mode') === 'import') return 'import';
  if (params.get('mode') === 'research' || params.has('project')) return 'research';
  return 'read';
}

/** The reading position is written in place and never adds a history entry. */
export function narrativeReadingHref(currentHref: string, workId: string, nodeId: string) {
  const hashIndex = currentHref.indexOf('#');
  const hash = hashIndex >= 0 ? currentHref.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? currentHref.slice(0, hashIndex) : currentHref;
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');
  if (params.get('work') !== workId) params.set('work', workId);
  if (nodeId) params.set('node', nodeId);
  else params.delete('node');
  return pathname + (params.size ? '?' + params.toString() : '') + hash;
}

/**
 * A delayed reading-position sync must still respect the mode the user has
 * selected by the time it runs, rather than the mode captured by its render.
 */
export function shouldSyncNarrativeReading({
  mode,
  intendedMode,
  worksLoading,
  treeLoading,
  workId,
}: {
  mode: NarrativeMode;
  intendedMode: NarrativeMode;
  worksLoading: boolean;
  treeLoading: boolean;
  workId: string;
}) {
  return mode === 'read' && intendedMode === 'read' && !worksLoading && !treeLoading && Boolean(workId);
}

/** Returns the in-place URL to write, or null when a tab change superseded it. */
export function nextNarrativeReadingHref({
  currentHref,
  workId,
  nodeId,
  mode,
  intendedMode,
  worksLoading,
  treeLoading,
}: {
  currentHref: string;
  workId: string;
  nodeId: string;
  mode: NarrativeMode;
  intendedMode: NarrativeMode;
  worksLoading: boolean;
  treeLoading: boolean;
}) {
  if (!shouldSyncNarrativeReading({ mode, intendedMode, worksLoading, treeLoading, workId })) return null;
  const next = narrativeReadingHref(currentHref, workId, nodeId);
  return next === currentHref ? null : next;
}

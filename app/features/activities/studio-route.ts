export type StudioTab = 'studio' | 'theater' | 'delivery';
export type StudioView = 'records' | 'storyboard' | 'comic' | 'assets';
export type StudioPanel = 'activity-settings' | 'art-direction' | 'smart-create';
export interface ActivityStudioRoute {
  tab: StudioTab;
  view: StudioView;
  mode: 'activity' | 'comic';
  deliveryView: 'gallery' | 'exports';
  panel: StudioPanel | null;
  recordView: 'chat' | 'moments' | 'facts';
}

/** Canonicalization never drops object anchors or conflates legacy jobId with studioJobId. */
export function resolveActivityStudioRoute(search: string) {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const oldComic = params.get('mode') === 'comic';
  let route: ActivityStudioRoute = { tab: 'studio', view: 'storyboard', mode: 'activity', deliveryView: 'exports', panel: null,
    recordView: params.get('recordView') === 'moments' ? 'moments' : params.get('recordView') === 'facts' || params.has('factId') ? 'facts' : 'chat' };
  if (tab === 'theater') route = { ...route, tab, mode: oldComic ? 'comic' : 'activity' };
  else if (tab === 'delivery') route = { ...route, tab, deliveryView: params.get('view') === 'gallery' ? 'gallery' : 'exports' };
  else if (tab === 'studio') route.view = ['records','storyboard','comic','assets'].includes(params.get('view') ?? '') ? params.get('view') as StudioView : 'storyboard';
  else if (tab === 'settings' || tab === 'planning') route.panel = 'activity-settings';
  else if (tab === 'media') route.view = 'assets';
  else if (tab === 'export') route.tab = 'delivery';
  else if (tab === 'playback' && !oldComic) route.tab = 'theater';
  else if (oldComic) route.view = 'comic';
  else if (tab === 'records' || params.has('recordId') || params.has('factId')) route.view = 'records';
  const panel = params.get('panel');
  if (panel && ['activity-settings','art-direction','smart-create'].includes(panel)) route.panel = panel as StudioPanel;
  params.set('tab', route.tab);
  if (route.tab === 'studio') { params.set('view', route.view); params.delete('mode'); if (route.view === 'records') params.set('recordView', route.recordView); }
  else if (route.tab === 'theater') { params.set('mode', route.mode); params.delete('view'); }
  else { params.set('view', route.deliveryView); params.delete('mode'); }
  if (route.panel) params.set('panel', route.panel); else params.delete('panel');
  return { route, canonicalSearch: params.toString() };
}

export function navigateActivityStudio(search: string, patch: Partial<ActivityStudioRoute>): string {
  const { route, canonicalSearch } = resolveActivityStudioRoute(search);
  const next = { ...route, ...patch };
  const params = new URLSearchParams(canonicalSearch);
  params.set('tab', next.tab);
  if (next.tab === 'studio') params.set('view', next.view);
  else if (next.tab === 'delivery') params.set('view', next.deliveryView);
  else params.set('mode', next.mode);
  if (next.panel) params.set('panel', next.panel); else params.delete('panel');
  if (patch.recordView) params.set('recordView', patch.recordView);
  return resolveActivityStudioRoute(params.toString()).canonicalSearch;
}

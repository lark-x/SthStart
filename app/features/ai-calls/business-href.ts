import type { AiCallSummary } from '@sthstart/contracts';

export function aiCallBusinessHref(call: Pick<AiCallSummary, 'applicationId' | 'objectType' | 'objectId'>): string | null {
  if (!call.objectId) return null;
  if (call.applicationId === 'activities') {
    if (call.objectType === 'planning-session') return `/apps/activities/new?session=${encodeURIComponent(call.objectId)}`;
    if (call.objectType === 'activity' || call.objectType === 'activity-beat') {
      return `/apps/activities/${encodeURIComponent(call.objectId.split(':')[0])}`;
    }
    return null;
  }
  if (call.applicationId === 'characters') return `/apps/characters/${encodeURIComponent(call.objectId)}`;
  return null;
}

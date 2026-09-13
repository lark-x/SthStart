import { getJson } from '@/app/lib/api-client';
import type { CharacterBrowseQuery } from '@sthstart/contracts';

export interface CalendarEvent {
  id: string;
  kind: 'birthday' | 'activity';
  date: string;
  title: string;
  characterId?: string;
  characterName?: string;
  avatarUrl?: string | null;
  work?: string;
  activityId?: string;
  participantCount?: number;
  sourceCharacterIds?: string[];
}

export interface CalendarResponse {
  from: string;
  to: string;
  events: CalendarEvent[];
}

export type CalendarFilter = Pick<CharacterBrowseQuery, 'q' | 'works' | 'tags' | 'groups' | 'favorite'> & {
  kinds?: ('birthday' | 'activity')[];
};

export async function fetchCalendar(from: string, to: string, filter: CalendarFilter, signal?: AbortSignal): Promise<CalendarResponse> {
  const params = new URLSearchParams({ from, to, filter: JSON.stringify(filter) });
  return getJson(`/api/admin/calendar?${params.toString()}`, { signal });
}

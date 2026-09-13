import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CharacterBrowseQuery } from '@sthstart/contracts';
import { authenticateAdmin } from './access.js';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { characterWorks } from './characters/organization.js';
import { occursInYear } from './characters/birthday.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_RANGE_DAYS = 366;

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

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return value.trim();
}

function dayIndex(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function* iterateMonths(from: string, to: string): Generator<{ year: number; month: number }> {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  let year = fromYear; let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    yield { year, month };
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
}

export function queryCalendar(database: ServiceDatabase, input: { from: string; to: string; filter?: CharacterBrowseQuery }) {
  const from = parseDate(input.from);
  const to = parseDate(input.to);
  if (!from || !to) throw Object.assign(new Error('invalid_calendar_range'), { statusCode: 400, code: 'invalid_calendar_range' });
  const span = dayIndex(to) - dayIndex(from);
  if (span < 0) throw Object.assign(new Error('invalid_calendar_range'), { statusCode: 400, code: 'invalid_calendar_range' });
  if (span + 1 > MAX_RANGE_DAYS) throw Object.assign(new Error('calendar_range_too_large'), { statusCode: 400, code: 'calendar_range_too_large' });

  const filter = input.filter || {};
  const kinds = new Set((Array.isArray(filter.kinds) ? filter.kinds : ['birthday', 'activity']).filter((kind): kind is 'birthday' | 'activity' => kind === 'birthday' || kind === 'activity'));
  const works = characterWorks(database);
  const expandWorks = (names: string[]) => [...new Set(names.flatMap((name) => {
    const work = works.find((item) => [item.name, ...item.aliases].some((candidate) => candidate.toLowerCase() === name.toLowerCase()));
    return work ? [work.name, ...work.aliases] : [name];
  }))];
  const workNames = filter.works?.length ? expandWorks(filter.works) : [];

  // 角色条件对生日直接筛选；对活动按“任一参与者符合条件”匹配。
  const characterClauses = ['p.archived=0'];
  const characterParams: (string | number)[] = [];
  if (workNames.length) {
    characterClauses.push(`json_extract(p.draft_json,'$.work') COLLATE NOCASE IN (${workNames.map(() => '?').join(',')})`);
    characterParams.push(...workNames);
  }
  if (filter.q?.trim()) {
    const needle = filter.q.trim().toLowerCase();
    characterClauses.push("(instr(lower(p.display_name || ' ' || coalesce(json_extract(p.draft_json,'$.englishName'),'') || ' ' || coalesce(json_extract(p.draft_json,'$.aliases'),'') || ' ' || coalesce(json_extract(p.draft_json,'$.work'),'')),?)>0)");
    characterParams.push(needle);
  }
  if (filter.favorite) characterClauses.push("json_extract(p.organization_json,'$.favorite')=1");
  if (filter.groups?.length) {
    for (const group of filter.groups) {
      characterClauses.push("EXISTS(SELECT 1 FROM json_each(coalesce(json_extract(p.organization_json,'$.groups'),'[]')) WHERE value=?)");
      characterParams.push(group);
    }
  }
  if (filter.tags?.length) {
    const expression = "p.tags_json";
    if (filter.tagMode === 'all') for (const tag of filter.tags) { characterClauses.push(`EXISTS(SELECT 1 FROM json_each(${expression}) WHERE value=?)`); characterParams.push(tag); }
    else { characterClauses.push(`EXISTS(SELECT 1 FROM json_each(${expression}) WHERE value IN (${filter.tags.map(() => '?').join(',')}))`); characterParams.push(...filter.tags); }
  }
  const characterWhere = characterClauses.join(' AND ');

  const events: CalendarEvent[] = [];

  if (kinds.has('birthday')) {
    const rows = database.connection.prepare(
      `SELECT p.id,p.display_name,p.avatar_asset_id,json_extract(p.draft_json,'$.work') work,b.month,b.day
       FROM character_birthdays b JOIN character_profiles p ON p.id=b.character_id
       WHERE b.status='known' AND b.month IS NOT NULL AND b.day IS NOT NULL AND ${characterWhere}`
    ).all(...characterParams) as Record<string, unknown>[];
    for (const { year, month } of iterateMonths(from, to)) {
      for (const row of rows) {
        const bMonth = Number(row.month); const bDay = Number(row.day);
        if (bMonth !== month || !occursInYear(bMonth, bDay, year)) continue;
        const date = `${year}-${String(month).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`;
        if (date < from || date > to) continue;
        events.push({
          id: `birthday:${String(row.id)}:${year}`,
          kind: 'birthday',
          date,
          title: `${String(row.display_name)}的生日`,
          characterId: String(row.id),
          characterName: String(row.display_name),
          avatarUrl: row.avatar_asset_id ? `/api/admin/characters/assets/${String(row.avatar_asset_id)}` : null,
          work: row.work ? String(row.work) : '',
        });
      }
    }
  }

  if (kinds.has('activity')) {
    const rows = database.connection.prepare(
      `SELECT a.id,a.title,a.scheduled_date,r.document_json
       FROM activities a JOIN activity_content_revisions r ON r.id=a.current_content_revision_id
       WHERE a.archived=0 AND a.scheduled_date IS NOT NULL AND a.scheduled_date>=? AND a.scheduled_date<=?`
    ).all(from, to) as Record<string, unknown>[];
    const matchingCharacters = new Set(
      (database.connection.prepare(`SELECT p.id FROM character_profiles p WHERE ${characterWhere}`).all(...characterParams) as { id: string }[]).map((row) => String(row.id))
    );
    const hasCharacterFilter = characterWhere !== 'p.archived=0';
    for (const row of rows) {
      let document: { actors?: Array<{ sourceCharacterId?: string }> } = {};
      try { document = JSON.parse(String(row.document_json)); } catch { continue; }
      const participants = (document.actors || []).map((actor) => actor?.sourceCharacterId).filter((id): id is string => typeof id === 'string');
      // 活动每次只返回一项，不因匹配多位参与者而重复。
      if (hasCharacterFilter && !participants.some((id) => matchingCharacters.has(id))) continue;
      events.push({
        id: `activity:${String(row.id)}`,
        kind: 'activity',
        date: String(row.scheduled_date),
        title: String(row.title),
        activityId: String(row.id),
        participantCount: participants.length,
        sourceCharacterIds: [...new Set(participants)],
      });
    }
  }

  events.sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
  return { from, to, events };
}

export function registerCalendarRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase) {
  function checkAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
      reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
      return false;
    }
    return true;
  }

  app.get<{ Querystring: { from?: string; to?: string; filter?: string } }>(
    '/api/v1/admin/calendar',
    async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      try {
        const filter = request.query.filter ? JSON.parse(request.query.filter) as CharacterBrowseQuery : {};
        return queryCalendar(database, { from: String(request.query.from || ''), to: String(request.query.to || ''), filter });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code) return reply.code(400).send({ error: code, message: '日期范围无效或超出 366 天。' });
        throw error;
      }
    }
  );
}

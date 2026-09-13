import type { CharacterBrowseQuery, CharacterOrganization, CharacterWork } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { list, text } from './draft.js';
import { upsertCharacterBirthday } from './birthday.js';

export function normalizeOrganization(value: unknown): CharacterOrganization {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { favorite: data.favorite === true, groups: [...new Set(list(data.groups, 50))], interpretation: text(data.interpretation, 100) };
}
export function characterWorks(database: ServiceDatabase): CharacterWork[] {
  const works = database.connection.prepare('SELECT * FROM character_works ORDER BY name').all().map(row => ({ name: String(row.name), aliases: JSON.parse(String(row.aliases_json)) as string[], mediaType: String(row.media_type) }));
  const names = database.connection.prepare("SELECT DISTINCT json_extract(draft_json,'$.work') name FROM character_profiles WHERE archived=0").all();
  for (const row of names) if (row.name && !works.some(w => [w.name, ...w.aliases].some(n => n.toLowerCase() === String(row.name).toLowerCase()))) works.push({ name: String(row.name), aliases: [], mediaType: '' });
  return works;
}
export function canonicalWork(database: ServiceDatabase, name: string) {
  const trimmed = name.trim();
  return characterWorks(database).find(w => [w.name, ...w.aliases].some(n => n.toLowerCase() === trimmed.toLowerCase()))?.name || trimmed;
}
export function browseCharacters(database: ServiceDatabase, query: CharacterBrowseQuery) {
  const works = characterWorks(database);
  const clauses = ['p.archived=0']; const params: (string | number)[] = [];
  const add = (sql: string, ...values: (string | number)[]) => { clauses.push(sql); params.push(...values); };
  const expandWorks = (names: string[]) => [...new Set(names.flatMap(name => {
    const work = works.find(w => [w.name, ...w.aliases].some(n => n.toLowerCase() === name.toLowerCase()));
    return work ? [work.name, ...work.aliases] : [name];
  }))];
  const inValues = (expression: string, values: string[], negate = false) => {
    if (values.length) add(`${expression} ${negate ? 'NOT ' : ''}IN (${values.map(() => '?').join(',')})`, ...values);
  };
  const arrayFilter = (expression: string, values?: string[], all = false) => {
    if (!values?.length) return;
    if (all) for (const value of values) add(`EXISTS(SELECT 1 FROM json_each(${expression}) WHERE value=?)`, value);
    else add(`EXISTS(SELECT 1 FROM json_each(${expression}) WHERE value IN (${values.map(() => '?').join(',')}))`, ...values);
  };
  if (query.q?.trim()) {
    // Literal substring matching: '%' and '_' in character names are not SQL wildcards.
    const needle = query.q.trim().toLowerCase();
    const matchingWorks = works.filter(w => [w.name, ...w.aliases].some(n => n.toLowerCase().includes(needle)));
    const workNames = matchingWorks.flatMap(w => [w.name, ...w.aliases]);
    add(`(instr(lower(p.display_name || ' ' || coalesce(json_extract(p.draft_json,'$.englishName'),'') || ' ' || coalesce(json_extract(p.draft_json,'$.aliases'),'') || ' ' || coalesce(json_extract(p.draft_json,'$.work'),'') || ' ' || coalesce(json_extract(p.draft_json,'$.world'),'') || ' ' || p.tags_json),?)>0${workNames.length ? ` OR json_extract(p.draft_json,'$.work') COLLATE NOCASE IN (${workNames.map(() => '?').join(',')})` : ''})`, needle, ...workNames);
  }
  if (query.works?.length) inValues("json_extract(p.draft_json,'$.work') COLLATE NOCASE", expandWorks(query.works));
  if (query.mediaType) {
    const names = expandWorks(works.filter(w => w.mediaType === query.mediaType).map(w => w.name));
    if (names.length) inValues("json_extract(p.draft_json,'$.work') COLLATE NOCASE", names); else add('0=1');
  }
  arrayFilter('p.tags_json', query.tags, query.tagMode === 'all');
  arrayFilter("coalesce(json_extract(p.organization_json,'$.groups'),'[]')", query.groups);
  if (query.favorite) add("json_extract(p.organization_json,'$.favorite')=1");
  if (query.originType) add("json_extract(p.draft_json,'$.originType')=?", query.originType);
  if (query.interpretation) add("json_extract(p.organization_json,'$.interpretation')=?", query.interpretation);
  if (query.reference) add(`${query.reference === 'no' ? 'NOT ' : ''}EXISTS(SELECT 1 FROM character_visual_references r WHERE r.character_id=p.id AND r.enabled=1)`);
  if (query.appearance) add(`(length(trim(coalesce(json_extract(p.draft_json,'$.appearance.description'),'')))>0)=${query.appearance === 'yes' ? 1 : 0}`);
  if (query.source === 'manual') add('NOT EXISTS(SELECT 1 FROM character_sources s WHERE s.character_id=p.id)');
  else if (query.source) add('EXISTS(SELECT 1 FROM character_sources s WHERE s.character_id=p.id AND coalesce(s.provider_id,s.source_type)=?)', query.source);
  if (query.unclassified === 'work') add("coalesce(json_extract(p.draft_json,'$.work'),'')=''");
  if (query.unclassified === 'tags') add('json_array_length(p.tags_json)=0');
  if (query.birthdayStatus) add("coalesce(b.status,'unset')=?", query.birthdayStatus);
  if (query.birthdayMonth) add("b.status='known' AND b.month=?", Math.max(1, Math.min(12, Math.floor(Number(query.birthdayMonth)))));
  if (query.excludeIds?.length) inValues('p.id', query.excludeIds, true);
  const where = clauses.join(' AND ');
  const joins = 'LEFT JOIN character_birthdays b ON b.character_id=p.id';
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(query.pageSize) || 24)));
  const total = Number(database.connection.prepare(`SELECT count(*) count FROM character_profiles p ${joins} WHERE ${where}`).get(...params)!.count);
  const rows = database.connection.prepare(`SELECT p.* FROM character_profiles p ${joins} WHERE ${where} ORDER BY ${query.sort === 'name' ? 'p.display_name COLLATE NOCASE' : 'p.updated_at DESC'},p.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  // Facets are built from the entire library (never just the current page). Tags narrow by work.
  const scopedNames = query.works?.length ? expandWorks(query.works) : [];
  const tagRows = database.connection.prepare(`SELECT DISTINCT j.value value FROM character_profiles p,json_each(p.tags_json) j WHERE p.archived=0 ${scopedNames.length ? `AND json_extract(p.draft_json,'$.work') COLLATE NOCASE IN (${scopedNames.map(() => '?').join(',')})` : ''} ORDER BY value`).all(...scopedNames);
  const groups = database.connection.prepare("SELECT DISTINCT j.value value FROM character_profiles p,json_each(coalesce(json_extract(p.organization_json,'$.groups'),'[]')) j WHERE p.archived=0 ORDER BY value").all();
  const interpretations = database.connection.prepare("SELECT DISTINCT json_extract(organization_json,'$.interpretation') value FROM character_profiles WHERE archived=0 ORDER BY value").all();
  const sources = database.connection.prepare('SELECT DISTINCT coalesce(s.provider_id,s.source_type) value FROM character_sources s JOIN character_profiles p ON p.id=s.character_id WHERE p.archived=0 ORDER BY value').all();
  const strings = (items: { value?: unknown }[]) => items.map(r => String(r.value || '')).filter(Boolean);
  const birthdayMonths = database.connection.prepare("SELECT DISTINCT month value FROM character_birthdays WHERE status='known' AND month IS NOT NULL ORDER BY month").all();
  return {
    rows, total, page, pageSize,
    facets: {
      works, tags: strings(tagRows), groups: strings(groups), interpretations: strings(interpretations),
      sources: [...new Set(['manual', ...strings(sources)])],
      birthdayMonths: birthdayMonths.map(r => Number(r.value)).filter(m => Number.isInteger(m) && m >= 1 && m <= 12),
    },
  };
}
export type OrganizationEdit = { ids: string[]; work?: string; originType?: 'ip' | 'original'; tags?: string[]; groups?: string[]; interpretation?: string; favorite?: boolean; fillEmpty?: boolean; replaceTags?: boolean; replaceGroups?: boolean };
export function editCharacterOrganization(database: ServiceDatabase, input: OrganizationEdit) {
  if (!Array.isArray(input.ids) || input.ids.length > 500 || input.ids.some(id => typeof id !== 'string')) throw new Error('每次请选择 1 至 500 位角色');
  const ids = [...new Set(list(input.ids, 500))];
  if (!ids.length) throw new Error('请选择角色');
  return database.transaction(() => {
    for (const id of ids) {
      const row = database.connection.prepare('SELECT * FROM character_profiles WHERE id=? AND archived=0').get(id);
      if (!row) throw new Error('角色已删除，请刷新列表');
      const draft = JSON.parse(String(row.draft_json));
      if (input.originType === 'ip' || input.originType === 'original') draft.originType = input.originType;
      const organization = normalizeOrganization(JSON.parse(String(row.organization_json)));
      if (input.work !== undefined && (!input.fillEmpty || !draft.work)) draft.work = canonicalWork(database, text(input.work, 200));
      if (input.interpretation !== undefined && (!input.fillEmpty || !organization.interpretation)) organization.interpretation = text(input.interpretation, 100);
      if (input.favorite !== undefined) organization.favorite = input.favorite === true;
      if (input.groups) organization.groups = [...new Set([...(input.replaceGroups ? [] : organization.groups), ...list(input.groups, 50)])].slice(0, 50);
      const tags = input.tags ? [...new Set([...(input.replaceTags ? [] : JSON.parse(String(row.tags_json)) as string[]), ...list(input.tags, 50)])].slice(0, 50) : JSON.parse(String(row.tags_json));
      const changedDraft = JSON.stringify(draft) !== String(row.draft_json);
      database.connection.prepare('UPDATE character_profiles SET draft_json=?,tags_json=?,organization_json=?,draft_revision=draft_revision+?,updated_at=? WHERE id=?').run(JSON.stringify(draft), JSON.stringify(tags), JSON.stringify(organization), changedDraft ? 1 : 0, nowIso(), id);
      if (changedDraft) upsertCharacterBirthday(database, id, draft);
    }
    return { updated: ids.length };
  });
}

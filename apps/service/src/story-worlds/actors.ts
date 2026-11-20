import { createHash, randomUUID } from 'node:crypto';
import {
  type CharacterDraftV2, type PromoteWorldActor, type StoryWorld, type WorldActor,
  type WorldActorCharacterLink, type WorldActorPromotionResult, type WorldBranch, type WorldDefinition,
} from '@sthstart/contracts';
import { nowIso } from '../database.js';
import { toAuthorityDraft } from '../characters/draft.js';
import { canonicalWork, characterWorks } from '../characters/organization.js';
import { publishCharacterSnapshot } from '../characters/snapshots.js';
import { StoryWorldError, type StoryWorldStore } from './store.js';

type Row = Record<string, unknown>;
const SOURCE_PROVIDER = 'story-worlds';
const SOURCE_FORMAT = 'story-world-actor-v1';
const PARSER_VERSION = '1';

function hash(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function text(value: unknown, max = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function fail(code: string, statusCode: number, message: string): never {
  throw new StoryWorldError(code, statusCode, message);
}

/**
 * 配角提升/入角色库。角色库写入遵循现有 character_profiles + character_versions 机制，
 * 新卡以故事世界来源快照建档；已有卡只关联，不改写。
 */
export class StoryWorldActorService {
  private savepointSeed = 0;

  constructor(readonly store: StoryWorldStore) {}

  promote(worldId: string, branchId: string, actorId: string, input: PromoteWorldActor): WorldActorPromotionResult {
    if (!input.promoteToMain && !input.addToLibrary) {
      fail('story_actor_action_required', 400, '请至少选择提升为主角或加入全局角色库。');
    }
    return this.atomic(() => {
      const world = this.store.getWorld(worldId);
      let branch = this.store.getBranch(worldId, branchId);
      let definition = this.store.definition(worldId, branchId);
      const actor = definition.actors.find((item) => item.id === actorId);
      if (!actor) fail('story_actor_not_found', 404, '该分支不存在这个角色。');

      const character = this.resolveCharacter(world, branch, definition, actor, input);
      const nextActor: WorldActor = { ...actor };
      let changed = false;
      if (input.promoteToMain && nextActor.role !== 'main') {
        nextActor.role = 'main';
        changed = true;
      }
      if (character) {
        if (nextActor.characterId !== character.characterId) {
          nextActor.characterId = character.characterId;
          changed = true;
        }
        if (nextActor.characterVersion !== character.version) {
          nextActor.characterVersion = character.version;
          changed = true;
        }
      }
      const promoted = actor.role !== 'main' && nextActor.role === 'main';

      if (changed) {
        definition = {
          ...definition,
          actors: definition.actors.map((item) => item.id === actorId ? nextActor : item),
        };
        branch = this.store.updateDefinitionAtCurrentTick(worldId, branchId, input.expectedRevision, definition);
      }
      return { branch, actor: nextActor, promoted, character };
    });
  }

  private atomic<T>(operation: () => T): T {
    const connection = this.store.database.connection;
    if (connection.isTransaction) {
      const name = `sw_actor_${++this.savepointSeed}`;
      connection.exec(`SAVEPOINT ${name}`);
      try {
        const value = operation();
        connection.exec(`RELEASE ${name}`);
        return value;
      } catch (error) {
        connection.exec(`ROLLBACK TO ${name}`);
        connection.exec(`RELEASE ${name}`);
        throw error;
      }
    }
    return this.store.database.transaction(operation);
  }

  private resolveCharacter(
    world: StoryWorld, branch: WorldBranch, definition: WorldDefinition, actor: WorldActor, input: PromoteWorldActor,
  ): WorldActorCharacterLink | null {
    if (actor.characterId) {
      return this.existingCharacter(world, actor, actor.characterId, actor.characterVersion, input.addToLibrary);
    }
    if (!input.addToLibrary) return null;
    const existing = this.sourceCharacter(world.id, actor.id);
    if (existing) {
      if (existing.archived) fail('story_character_archived', 409, '这个角色在全局角色库中已归档，未自动解档或重复建卡。');
      return existing;
    }
    return this.createCharacter(world, branch, definition, actor, input);
  }

  private existingCharacter(
    world: StoryWorld, actor: WorldActor, characterId: string, requestedVersion: number | null, requireActive: boolean,
  ): WorldActorCharacterLink {
    const database = this.store.database;
    const profile = database.connection.prepare('SELECT id,display_name,latest_version,archived FROM character_profiles WHERE id=?').get(characterId) as Row | undefined;
    if (!profile) fail('story_character_source_missing', 409, '角色引用的全局角色卡已不存在，不能伪造新卡替代。');
    const archived = Boolean(profile.archived);
    if (archived && requireActive) fail('story_character_archived', 409, '这个角色在全局角色库中已归档，未自动解档或重复建卡。');
    const version = requestedVersion ?? (profile.latest_version == null ? null : Number(profile.latest_version));
    if (!version) fail('story_character_version_missing', 409, '角色卡没有可采用的发布版本。');
    const versionRow = database.connection.prepare('SELECT 1 FROM character_versions WHERE character_id=? AND version=?').get(characterId, version);
    if (!versionRow) fail('story_character_version_missing', 409, `角色卡版本 ${characterId}@${version} 不存在。`);
    const source = database.connection.prepare(`SELECT source_snapshot_id FROM character_sources
      WHERE character_id=? AND provider_id=? AND external_id=? ORDER BY fetched_at DESC LIMIT 1`)
      .get(characterId, SOURCE_PROVIDER, `${world.id}:${actor.id}`) as { source_snapshot_id: string | null } | undefined;
    return {
      characterId, displayName: String(profile.display_name), version, created: false, archived,
      sourceSnapshotId: source?.source_snapshot_id ? String(source.source_snapshot_id) : null,
    };
  }

  private sourceCharacter(worldId: string, actorId: string): WorldActorCharacterLink | null {
    const row = this.store.database.connection.prepare(`SELECT p.id,p.display_name,p.latest_version,p.archived,s.source_snapshot_id
      FROM character_sources s JOIN character_profiles p ON p.id=s.character_id
      WHERE s.provider_id=? AND s.external_id=? ORDER BY p.created_at,p.id LIMIT 1`)
      .get(SOURCE_PROVIDER, `${worldId}:${actorId}`) as Row | undefined;
    if (!row) return null;
    const version = row.latest_version == null ? null : Number(row.latest_version);
    if (!version) fail('story_character_version_missing', 409, '已有角色卡没有可采用的发布版本。');
    const versionRow = this.store.database.connection.prepare('SELECT 1 FROM character_versions WHERE character_id=? AND version=?').get(String(row.id), version);
    if (!versionRow) fail('story_character_version_missing', 409, `已有角色卡版本 ${String(row.id)}@${version} 不存在。`);
    return {
      characterId: String(row.id), displayName: String(row.display_name), version, created: false,
      archived: Boolean(row.archived), sourceSnapshotId: row.source_snapshot_id ? String(row.source_snapshot_id) : null,
    };
  }

  private createCharacter(
    world: StoryWorld, branch: WorldBranch, definition: WorldDefinition, actor: WorldActor, input: PromoteWorldActor,
  ): WorldActorCharacterLink {
    const database = this.store.database;
    const now = nowIso();
    const id = randomUUID();
    const displayName = text(input.displayName || actor.name, 200) || actor.name;
    const summary = text(input.summary || actor.background, 5000);
    const tags = [...new Set(((input.tags?.length ? input.tags : ['故事世界']).map((tag) => text(tag, 100)).filter(Boolean)))].slice(0, 50);
    const personaText = [
      actor.background.trim() ? `背景\n${actor.background.trim()}` : '',
      actor.personality.trim() ? `性格\n${actor.personality.trim()}` : '',
      actor.goals.length ? `目标\n${actor.goals.join('；')}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 20000);
    const isDerivativeWorld = world.workNature === 'derivative';
    const isCanonWorld = world.workNature === 'canon';
    const originType = isDerivativeWorld ? 'derivative' : isCanonWorld ? 'ip' : 'original';
    const versionLabel = text(input.versionLabel, 120);
    if (originType === 'original' && !versionLabel) {
      fail('story_character_stage_required', 400, '原创角色入库前请填写阶段名称，并确认保存阶段后入库。');
    }
    let parentCharacterId: string | null = null;
    if (isDerivativeWorld && world.parentWork) {
      const parentName = canonicalWork(database, world.parentWork);
      const mother = characterWorks(database).find(work => work.name === parentName);
      const names = mother ? [mother.name, ...mother.aliases] : [parentName];
      const rootRow = database.connection.prepare(
        `SELECT id FROM character_profiles WHERE archived=0 AND parent_character_id IS NULL AND display_name=?
          AND json_extract(draft_json,'$.originType')<>'derivative'
          AND json_extract(draft_json,'$.work') COLLATE NOCASE IN (${names.map(() => '?').join(',')}) LIMIT 2`,
      ).all(displayName, ...names) as { id: string }[];
      // A same-name match is safe only when there is one unambiguous root.
      if (rootRow.length === 1) parentCharacterId = String(rootRow[0].id);
    }
    const draft = toAuthorityDraft({
      schemaVersion: 2, displayName, englishName: '', aliases: [], originType, work: world.title,
      ...(parentCharacterId ? { parentCharacterId } : {}),
      summary, personaText, speechText: text(actor.speechStyle, 4000), dialogueExamples: [],
      behaviorRules: actor.goals.map((goal) => `- ${goal}`).join('\n').slice(0, 8000),
      appearance: { baseText: text(actor.appearance, 5000), defaultOutfitText: '' },
    }) as CharacterDraftV2;
    const snapshotPayload = {
      version: 1,
      worldId: world.id, worldTitle: world.title,
      branchId: branch.id, branchTitle: branch.title, branchMode: branch.mode,
      actorId: actor.id, tick: branch.currentTick, sourceRevision: branch.sourceRevision,
      actor: structuredClone(actor),
      worldSources: definition.sources.map((source) => ({
        id: source.id, title: source.title, nature: source.nature,
        sourceVersion: source.sourceVersion, sourceUrl: source.sourceUrl, capturedAt: source.capturedAt,
      })),
      capturedAt: now,
    };
    const payloadHash = hash(snapshotPayload);
    const externalId = `${world.id}:${actor.id}`;
    const existingSnapshot = database.connection.prepare(`SELECT id FROM character_source_snapshots
      WHERE provider_id=? AND external_id=? AND payload_hash=?`).get(SOURCE_PROVIDER, externalId, payloadHash) as { id: string } | undefined;
    const sourceSnapshotId = existingSnapshot?.id ?? randomUUID();
    if (!existingSnapshot) {
      database.connection.prepare(`INSERT INTO character_source_snapshots
        (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
        VALUES (?,?,?,NULL,?,?,NULL,?,?,?,?,NULL,?,?)`).run(
        sourceSnapshotId, SOURCE_PROVIDER, externalId, 'SthStart 故事世界', `${branch.id}@${branch.currentTick}`,
        now, payloadHash, SOURCE_FORMAT, PARSER_VERSION, JSON.stringify(snapshotPayload), now,
      );
    }

    const slug = this.uniqueSlug(displayName, actor.id);
    database.connection.prepare(`INSERT INTO character_profiles
      (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,variants_json,parent_character_id)
      VALUES (?,?,?,?,?,NULL,NULL,0,?,?,1,'[]',?)`).run(
      id, slug, displayName, JSON.stringify(draft), JSON.stringify(tags), now, now, parentCharacterId,
    );
    database.connection.prepare(`INSERT INTO character_sources
      (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
      VALUES (?,?,?,NULL,?,'manual',?,?,?,?,?)`).run(
      randomUUID(), id, `故事世界《${world.title}》配角 ${actor.name}`,
      `分支《${branch.title}》tick ${branch.currentTick} 的配角快照，来源版本 ${branch.sourceRevision}。`,
      now, SOURCE_PROVIDER, externalId, payloadHash, sourceSnapshotId,
    );
    for (const [field, value, pointer] of [
      ['displayName', draft.displayName, '$.actor.name'],
      ['personaText', draft.personaText, '$.actor'],
      ['speechText', draft.speechText, '$.actor.speechStyle'],
      ['appearance.baseText', draft.appearance.baseText, '$.actor.appearance'],
    ] as const) {
      if (!value.trim()) continue;
      database.connection.prepare(`INSERT INTO character_field_provenance
        (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
        VALUES (?,?,1,?,?, 'source_extract',?,?,?, '[]',1,?)`).run(
        randomUUID(), id, field, hash(value), sourceSnapshotId, pointer,
        JSON.stringify({ worldId: world.id, branchId: branch.id, actorId: actor.id, tick: branch.currentTick }), now,
      );
    }
    const published = publishCharacterSnapshot(database, id, {
      expectedDraftRevision: 1, ...(versionLabel ? { versionLabel } : {}), allowIncomplete: originType !== 'original',
    });
    if (!published) fail('story_character_incomplete', 400, '保存阶段前请填写角色名称，以及简介或人设正文。');
    return { characterId: id, displayName, version: 1, created: true, archived: false, sourceSnapshotId };
  }

  private uniqueSlug(displayName: string, actorId: string) {
    const ascii = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const base = `story-world-${ascii || 'actor'}-${hash(actorId).slice(0, 8)}`.slice(0, 80);
    let candidate = base;
    let number = 2;
    while (this.store.database.connection.prepare('SELECT 1 FROM character_profiles WHERE slug=?').get(candidate)) {
      candidate = `${base}-${number++}`;
    }
    return candidate;
  }
}

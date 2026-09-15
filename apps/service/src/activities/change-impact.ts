import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ActivityReviewItem, ContentDocument } from '@sthstart/contracts';
export function valueHash(value: unknown): string {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).filter(([key]) => !['updatedAt', 'reviewState', 'locked', 'editingPolicy'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v ?? null;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function sourceValue(doc: ContentDocument, ref: {
    kind: string;
    id: string;
    field: string;
}): unknown {
    if (ref.kind === 'activity' && ref.field === 'relationships')
        return doc.relationships;
    const collections: Record<string, unknown> = { actor: doc.actors, stage: doc.stages, fact: doc.facts, message: doc.messages, post: doc.posts, image: doc.mediaSlots };
    const entity = ref.kind === 'activity' ? doc.activity : (collections[ref.kind] as Array<{
        id: string;
    }> | undefined)?.find(item => item.id === ref.id);
    return ref.field ? ref.field.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], entity) : entity;
}
export function reviewTarget(doc: ContentDocument, kind: ActivityReviewItem['targetKind'], id: string): unknown {
    if (kind === 'playback')
        return { messages: doc.messages, posts: doc.posts, comments: doc.comments, likes: doc.likes, conversations: doc.conversations, slots: doc.mediaSlots };
    return sourceValue(doc, { kind, id, field: '' });
}
export function isReviewLocked(doc: ContentDocument, item: Pick<ActivityReviewItem, 'targetKind' | 'targetId'>): boolean {
    if (item.targetKind === 'image')
        return Boolean(doc.editingPolicy?.lockedMediaSlotIds.includes(item.targetId));
    const entity = reviewTarget(doc, item.targetKind, item.targetId) as {
        stageId?: string;
    } | undefined;
    return Boolean(doc.stages.find(stage => stage.id === (item.targetKind === 'stage' ? item.targetId : entity?.stageId))?.locked
        || doc.editingPolicy?.lockedRecords.some(record => record.id === item.targetId));
}
export function analyzeActivityChanges(activityId: string, before: ContentDocument, after: ContentDocument): ActivityReviewItem[] {
    const targets = new Map<string, ActivityReviewItem>();
    function add(kind: ActivityReviewItem['targetKind'], id: string, title: string, severity: ActivityReviewItem['severity'], reason: string, ref: ActivityReviewItem['sourceRefs'][number]) {
        const key = `${kind}:${id}`;
        const item = targets.get(key) || { id: '', activityId, changeKey: '', targetKind: kind, targetId: id, title, severity,
            reasons: [], sourceRefs: [], sourceValues: [], sourceHash: '', targetHash: '', decision: 'pending' as const };
        if (!item.reasons.includes(reason))
            item.reasons.push(reason);
        if (!item.sourceRefs.some(r => valueHash(r) === valueHash(ref))) {
            item.sourceRefs.push(ref);
            item.sourceValues.push(sourceValue(after, ref) ?? null);
        }
        const rank = { possible: 0, source_changed: 1, playback_outdated: 2, invalid_reference: 3 };
        if (rank[severity] > rank[item.severity])
            item.severity = severity;
        targets.set(key, item);
    }
    const changed = (a: unknown, b: unknown) => valueHash(a) !== valueHash(b);
    for (const actor of after.actors) {
        const old = before.actors.find(a => a.id === actor.id);
        if (!old)
            continue;
        for (const field of ['outfitDescription', 'appearanceReferenceAssetKeys', 'persona', 'displayName', 'activityRole'] as const) {
            if (!changed(old[field], actor[field]))
                continue;
            const appearanceChanged = field === 'persona' && changed(old.persona.appearance, actor.persona.appearance);
            const personaText = (persona: Record<string, unknown>) => Object.fromEntries(Object.entries(persona).filter(([key]) => key !== 'appearance'));
            const personaChanged = field === 'persona' && changed(personaText(old.persona), personaText(actor.persona));
            const visual = appearanceChanged || ['outfitDescription', 'appearanceReferenceAssetKeys', 'displayName', 'activityRole'].includes(field);
            if (visual)
                for (const slot of after.mediaSlots.filter(s => s.actorIds.includes(actor.id) && s.kind === 'image'))
                    add('image', slot.id, slot.caption, 'possible', `镜头包含${actor.displayName}，其${field === 'outfitDescription' ? '服装' : '设定'}已修改`, { kind: 'actor', id: actor.id, field: appearanceChanged ? 'persona.appearance' : field });
            if (personaChanged || field === 'displayName' || field === 'activityRole') {
                for (const message of after.messages.filter(m => m.speakerActorId === actor.id))
                    add('message', message.id, message.text.slice(0, 60), 'possible', `${actor.displayName}的人设或身份已修改，请检查发言`, { kind: 'actor', id: actor.id, field });
                for (const post of after.posts.filter(p => p.authorActorId === actor.id))
                    add('post', post.id, post.text.slice(0, 60), 'possible', `${actor.displayName}的人设已修改，请检查动态`, { kind: 'actor', id: actor.id, field });
            }
        }
    }
    for (const stage of after.stages) {
        const old = before.stages.find(s => s.id === stage.id);
        if (!old)
            continue;
        for (const field of ['location', 'instruction', 'requiredBeats'] as const)
            if (changed(old[field], stage[field])) {
                if (field === 'location')
                    for (const slot of after.mediaSlots.filter(s => s.stageId === stage.id && s.kind === 'image'))
                        add('image', slot.id, slot.caption, 'possible', `阶段「${stage.title}」地点已改变`, { kind: 'stage', id: stage.id, field });
                for (const row of [...after.messages, ...after.posts].filter(r => r.stageId === stage.id)) {
                    const kind = after.messages.some(m => m.id === row.id) ? 'message' : 'post';
                    add(kind, row.id, row.text.slice(0, 60), 'possible', `阶段「${stage.title}」的${field === 'location' ? '地点' : '安排'}已修改`, { kind: 'stage', id: stage.id, field });
                }
            }
    }
    for (const fact of before.facts) {
        const next = after.facts.find(f => f.id === fact.id);
        if (!changed(fact, next))
            continue;
        for (const slot of after.mediaSlots.filter(s => s.sourceFactIds.includes(fact.id)))
            add('image', slot.id, slot.caption, next ? 'source_changed' : 'invalid_reference', `引用的事实「${fact.text.slice(0, 35)}」${next ? '已修改' : '已删除'}`, { kind: 'fact', id: fact.id, field: '' });
        for (const post of after.posts.filter(p => p.sourceFactIds.includes(fact.id)))
            add('post', post.id, post.text.slice(0, 60), next ? 'source_changed' : 'invalid_reference', '动态引用的事实已改变', { kind: 'fact', id: fact.id, field: '' });
        const order = before.stages.find(s => s.id === fact.stageId)?.order || 0;
        for (const stage of after.stages.filter(s => s.order > order && after.stageResults.some(r => r.stageId === s.id)))
            add('stage', stage.id, stage.title, 'possible', '前序事实发生变化，请检查后续情节是否仍连贯', { kind: 'fact', id: fact.id, field: '' });
    }
    for (const slot of after.mediaSlots.filter(s => s.kind === 'image')) {
        const old = before.mediaSlots.find(s => s.id === slot.id);
        if (old && changed(old, slot))
            add('image', slot.id, slot.caption, 'source_changed', '镜头描述或参与角色已修改', { kind: 'image', id: slot.id, field: '' });
    }
    for (const row of [...after.messages, ...after.posts])
        for (const id of row.mediaSlotIds)
            if (!after.mediaSlots.some(s => s.id === id))
                add(after.messages.some(m => m.id === row.id) ? 'message' : 'post', row.id, row.text.slice(0, 60), 'invalid_reference', '关联的镜头已删除', { kind: 'image', id, field: '' });
    for (const row of [...after.messages, ...after.posts]) {
        const kind = after.messages.some(m => m.id === row.id) ? 'message' : 'post';
        const actorId = 'speakerActorId' in row ? row.speakerActorId : 'authorActorId' in row ? row.authorActorId : null;
        if (actorId && !after.actors.some(a => a.id === actorId))
            add(kind, row.id, row.text.slice(0, 60), 'invalid_reference', '发言角色已被删除', { kind: 'actor', id: actorId, field: '' });
        if (!after.stages.some(s => s.id === row.stageId))
            add(kind, row.id, row.text.slice(0, 60), 'invalid_reference', '所属阶段已被删除', { kind: 'stage', id: row.stageId, field: '' });
    }
    for (const field of ['rules', 'theme', 'relationships'] as const) {
        const old = field === 'relationships' ? before.relationships : before.activity[field];
        const next = field === 'relationships' ? after.relationships : after.activity[field];
        if (changed(old, next))
            for (const stage of after.stages.filter(s => after.messages.some(m => m.stageId === s.id) || after.posts.some(p => p.stageId === s.id)))
                add('stage', stage.id, stage.title, 'possible', '活动规则、主题或人物关系已改变，请检查已有内容', { kind: 'activity', id: 'activity', field });
    }
    if (changed(before.activity.location, after.activity.location))
        for (const slot of after.mediaSlots.filter(s => !after.stages.find(st => st.id === s.stageId)?.location))
            add('image', slot.id, slot.caption, 'possible', '镜头使用的活动默认地点已修改', { kind: 'activity', id: 'activity', field: 'location' });
    if (changed(reviewTarget(before, 'playback', 'current'), reviewTarget(after, 'playback', 'current')))
        add('playback', 'current', '回放需更新', 'playback_outdated', '记录、会话、顺序或镜头已改变', { kind: 'activity', id: 'activity', field: '' });
    return [...targets.values()].map(item => finishImpact(item, after));
}
function finishImpact(item: ActivityReviewItem, doc: ContentDocument): ActivityReviewItem {
    item.sourceHash = valueHash(item.sourceValues);
    item.targetHash = valueHash(reviewTarget(doc, item.targetKind, item.targetId));
    item.changeKey = valueHash([item.targetKind, item.targetId, item.sourceRefs, item.sourceHash, item.targetHash]);
    item.id = item.changeKey;
    item.locked = isReviewLocked(doc, item);
    return item;
}
export function persistImpacts(connection: DatabaseSync, activityId: string, items: ActivityReviewItem[]): void {
    const now = new Date().toISOString();
    for (const item of items) {
        if (item.targetKind !== 'playback') {
            const previous = connection.prepare("SELECT data_json FROM activity_review_items WHERE activity_id=? AND target_kind=? AND target_id=? AND decision IN ('pending','rework') ORDER BY created_at").all(activityId, item.targetKind, item.targetId) as Array<{
                data_json: string;
            }>;
            const draftRow = connection.prepare('SELECT document_json FROM activity_drafts WHERE activity_id=?').get(activityId) as {
                document_json: string;
            } | undefined;
            const doc = draftRow ? JSON.parse(draftRow.document_json) as ContentDocument : null;
            if (doc)
                for (const row of previous) {
                    const old = JSON.parse(row.data_json) as ActivityReviewItem;
                    for (const ref of old.sourceRefs)
                        if (!item.sourceRefs.some(r => valueHash(r) === valueHash(ref)))
                            item.sourceRefs.push(ref);
                    item.reasons = [...new Set([...old.reasons, ...item.reasons])];
                    if (old.severity === 'invalid_reference' && old.sourceRefs.some(ref => sourceValue(doc, ref) == null))
                        item.severity = 'invalid_reference';
                }
            if (doc) {
                item.sourceValues = currentReviewValues(connection, activityId, doc, item);
                item.sourceHash = valueHash(item.sourceValues);
                item.changeKey = valueHash([item.targetKind, item.targetId, item.sourceRefs, item.sourceHash, item.targetHash]);
            }
        }
        connection.prepare("UPDATE activity_review_items SET decision='superseded',updated_at=? WHERE activity_id=? AND target_kind=? AND target_id=? AND change_key<>? AND decision IN ('pending','rework')")
            .run(now, activityId, item.targetKind, item.targetId, item.changeKey);
        connection.prepare('INSERT INTO activity_review_items(id,activity_id,change_key,target_kind,target_id,data_json,decision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(activity_id,change_key) DO NOTHING')
            .run(randomUUID(), activityId, item.changeKey, item.targetKind, item.targetId, JSON.stringify(item), 'pending', now, now);
    }
}
export function recordContentImpacts(connection: DatabaseSync, activityId: string, before: ContentDocument, after: ContentDocument): void {
    // A removed review target is historical; it must never be dispatched again.
    const rows = connection.prepare("SELECT id,target_kind,target_id,data_json FROM activity_review_items WHERE activity_id=? AND decision IN ('pending','rework')").all(activityId) as Array<{
        id: string;
        target_kind: ActivityReviewItem['targetKind'];
        target_id: string;
        data_json: string;
    }>;
    for (const row of rows)
        if (row.target_kind !== 'playback' && !reviewTarget(after, row.target_kind, row.target_id))
            connection.prepare("UPDATE activity_review_items SET decision='superseded' WHERE id=?").run(row.id);
    const items = analyzeActivityChanges(activityId, before, after);
    for (const row of rows) {
        if (row.target_kind === 'playback')
            continue;
        const old = JSON.parse(row.data_json) as ActivityReviewItem;
        const target = reviewTarget(after, row.target_kind, row.target_id) as {
            mediaSlotIds?: string[];
            sourceFactIds?: string[];
            speakerActorId?: string;
            authorActorId?: string;
            actorIds?: string[];
            stageId?: string;
        } | undefined;
        if (!target)
            continue;
        if (old.severity === 'invalid_reference' && !old.sourceRefs.some(ref => sourceValue(after, ref) == null && (ref.kind === 'image' ? target.mediaSlotIds?.includes(ref.id) : ref.kind === 'fact' ? target.sourceFactIds?.includes(ref.id) : ref.kind === 'actor' ? (target.speakerActorId === ref.id || target.authorActorId === ref.id || target.actorIds?.includes(ref.id)) : ref.kind === 'stage' ? target.stageId === ref.id : true))) {
            connection.prepare("UPDATE activity_review_items SET decision='resolved',updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
            continue;
        }
        if (valueHash(target) !== old.targetHash && !items.some(i => i.targetKind === old.targetKind && i.targetId === old.targetId)) {
            // Manual edits need a fresh, actionable acknowledgement, not a permanently stale row.
            const refreshed = { ...old, decision: 'pending' as const, execution: undefined, targetHash: valueHash(target), sourceValues: currentReviewValues(connection, activityId, after, old) };
            refreshed.sourceHash = valueHash(refreshed.sourceValues);
            refreshed.changeKey = valueHash([refreshed.targetKind, refreshed.targetId, refreshed.sourceRefs, refreshed.sourceHash, refreshed.targetHash]);
            items.push(refreshed);
        }
    }
    // Resolve image certainty from the currently adopted asset, not a newer unused recipe.
    const bindingsRow = connection.prepare('SELECT m.slot_bindings_json FROM activities a JOIN activity_media_revisions m ON m.id=a.current_media_revision_id WHERE a.id=?').get(activityId) as {
        slot_bindings_json: string;
    } | undefined;
    const bindings = JSON.parse(bindingsRow?.slot_bindings_json || '[]') as Array<{
        slotId: string;
        assets: Array<{
            assetKey: string;
        }>;
    }>;
    for (const item of items.filter(i => i.targetKind === 'image' && i.severity === 'possible')) {
        const asset = bindings.find(b => b.slotId === item.targetId)?.assets[0]?.assetKey;
        const row = asset ? connection.prepare('SELECT r.source_refs_json FROM activity_image_attempt_outputs o JOIN activity_image_attempts a ON a.id=o.attempt_id JOIN activity_prompt_recipes r ON r.id=a.recipe_id WHERE a.activity_id=? AND o.asset_key=? LIMIT 1').get(activityId, asset) as {
            source_refs_json: string;
        } | undefined : undefined;
        const refs = JSON.parse(row?.source_refs_json || '[]') as Array<{
            entityKind: string;
            entityId: string;
            fieldPath: string;
        }>;
        if (item.sourceRefs.some(source => refs.some(ref => ref.entityKind === source.kind && ref.entityId === source.id && ref.fieldPath.replace(/\//g, '.').replace(/^\./, '').endsWith(source.field))))
            item.severity = 'source_changed';
    }
    persistImpacts(connection, activityId, items);
}
export function recordPlaybackImpact(connection: DatabaseSync, activityId: string, reason: string, version: string): void {
    const item: ActivityReviewItem = { id: '', activityId, changeKey: valueHash(['playback', version]), targetKind: 'playback', targetId: 'current', title: '回放需更新', severity: 'playback_outdated', reasons: [reason], sourceRefs: [], sourceValues: [version], sourceHash: valueHash(version), targetHash: version, decision: 'pending' };
    persistImpacts(connection, activityId, [item]);
}
/** Resolve config references against the saved draft too, so unsaved edits cannot be acknowledged. */
export function currentReviewValues(connection: DatabaseSync, activityId: string, doc: ContentDocument, item: ActivityReviewItem): unknown[] {
    return item.sourceRefs.map(ref => {
        if (ref.kind !== 'image_config')
            return sourceValue(doc, ref) ?? null;
        const row = connection.prepare('SELECT document_json FROM activity_image_config_drafts WHERE activity_id=?').get(activityId) as {
            document_json: string;
        } | undefined;
        const config = JSON.parse(row?.document_json || '{}');
        return ref.field === 'slotConfigs' ? (config.slotConfigs || []).find((s: {
            slotId: string;
        }) => s.slotId === ref.id) || null : config[ref.field] ?? null;
    });
}
export function resolveTextReview(connection: DatabaseSync, activityId: string, doc: ContentDocument, candidateId: string, targetIds?: string[]): void {
    const job = connection.prepare("SELECT id FROM activity_jobs WHERE activity_id=? AND EXISTS (SELECT 1 FROM json_each(result_candidate_ids_json) WHERE value=?)").get(activityId, candidateId) as {
        id: string;
    } | undefined;
    if (!job)
        return;
    const rows = connection.prepare("SELECT id,data_json,execution_json FROM activity_review_items WHERE activity_id=? AND decision IN ('pending','rework','superseded')").all(activityId) as Array<{
        id: string;
        data_json: string;
        execution_json: string | null;
    }>;
    for (const row of rows) {
        const item = JSON.parse(row.data_json) as ActivityReviewItem;
        const execution = JSON.parse(row.execution_json || 'null');
        if (execution?.id !== job.id || targetIds && !targetIds.includes(item.targetId))
            continue;
        if (valueHash(currentReviewValues(connection, activityId, doc, item)) !== item.sourceHash)
            continue;
        const latest = connection.prepare("SELECT id,data_json FROM activity_review_items WHERE activity_id=? AND target_kind=? AND target_id=? AND decision IN ('pending','rework')").all(activityId, item.targetKind, item.targetId) as Array<{
            id: string;
            data_json: string;
        }>;
        for (const active of latest) {
            const current = JSON.parse(active.data_json) as ActivityReviewItem;
            if (current.sourceHash === item.sourceHash)
                connection.prepare("UPDATE activity_review_items SET decision='resolved',updated_at=? WHERE id=?").run(new Date().toISOString(), active.id);
        }
        connection.prepare("UPDATE activity_review_items SET decision='resolved',updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    }
}
export function recordConfigImpacts(connection: DatabaseSync, activityId: string, doc: ContentDocument, before: Record<string, unknown>, after: Record<string, unknown>): void {
    const items: ActivityReviewItem[] = [];
    for (const slot of doc.mediaSlots.filter(s => s.kind === 'image')) {
        const refs: ActivityReviewItem['sourceRefs'] = [];
        const values: unknown[] = [];
        for (const field of ['globalStylePrompt', 'globalNegativePrompt', 'stylePreset', 'slotConfigs']) {
            const extract = (config: Record<string, unknown>) => field === 'slotConfigs' ? (config.slotConfigs as Array<{
                slotId: string;
            }> || []).find(s => s.slotId === slot.id) || null : config[field] ?? null;
            if (valueHash(extract(before)) === valueHash(extract(after)))
                continue;
            refs.push({ kind: 'image_config', id: slot.id, field });
            values.push(extract(after));
        }
        if (!refs.length)
            continue;
        items.push(finishImpact({ id: '', activityId, changeKey: '', targetKind: 'image', targetId: slot.id, title: slot.caption, severity: 'possible', reasons: ['本场图像配置已改变，请复核此镜头；旧图仍保留'], sourceRefs: refs, sourceValues: values, sourceHash: '', targetHash: '', decision: 'pending' }, doc));
    }
    persistImpacts(connection, activityId, items);
}
/** Only an adopted output generated against the current source versions closes an image rework item. */
export function resolveImageReviews(connection: DatabaseSync, activityId: string, doc: ContentDocument, bindings: Array<{
    slotId: string;
    assets: Array<{
        assetKey: string;
    }>;
}>): void {
    const rows = connection.prepare("SELECT id,data_json FROM activity_review_items WHERE activity_id=? AND target_kind='image' AND decision IN ('pending','rework')").all(activityId) as Array<{
        id: string;
        data_json: string;
    }>;
    for (const row of rows) {
        const item = JSON.parse(row.data_json) as ActivityReviewItem;
        const asset = bindings.find(b => b.slotId === item.targetId)?.assets[0]?.assetKey;
        if (!asset)
            continue;
        const recipe = connection.prepare('SELECT r.content_revision_id,r.image_config_revision_id FROM activity_image_attempt_outputs o JOIN activity_image_attempts a ON a.id=o.attempt_id JOIN activity_prompt_recipes r ON r.id=a.recipe_id WHERE a.activity_id=? AND a.slot_id=? AND o.asset_key=?').get(activityId, item.targetId, asset) as {
            content_revision_id: string;
            image_config_revision_id: string;
        } | undefined;
        if (!recipe)
            continue;
        const contentRow = connection.prepare('SELECT document_json FROM activity_content_revisions WHERE activity_id=? AND id=?').get(activityId, recipe.content_revision_id) as {
            document_json: string;
        } | undefined;
        const configRow = connection.prepare('SELECT document_json FROM activity_image_config_revisions WHERE activity_id=? AND id=?').get(activityId, recipe.image_config_revision_id) as {
            document_json: string;
        } | undefined;
        if (!contentRow)
            continue;
        const source = JSON.parse(contentRow.document_json) as ContentDocument;
        const config = JSON.parse(configRow?.document_json || '{}');
        const values = item.sourceRefs.map(ref => ref.kind === 'image_config' ? (ref.field === 'slotConfigs' ? (config.slotConfigs || []).find((s: {
            slotId: string;
        }) => s.slotId === ref.id) || null : config[ref.field] ?? null) : sourceValue(source, ref) ?? null);
        if (valueHash(values) !== item.sourceHash || valueHash(currentReviewValues(connection, activityId, doc, item)) !== item.sourceHash || valueHash(reviewTarget(source, 'image', item.targetId)) !== valueHash(reviewTarget(doc, 'image', item.targetId)))
            continue;
        connection.prepare("UPDATE activity_review_items SET decision='resolved',updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    }
}

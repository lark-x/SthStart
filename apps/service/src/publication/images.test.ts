import test from 'node:test';
import assert from 'node:assert/strict';
import type { PublicationDocument, PublicationShot } from '@sthstart/contracts';
import { saveActivityImagePromptPolicy } from '../activities/image-prompt-policies.js';
import { PARITY_TEXT_WORKFLOW_ID } from '../activities/parity-workflows.js';
import { addPublicationTestWorkflow, publicationFixture } from './fixtures.js';
import { compilePublicationImagePrompt, imagePlan } from './images.js';

const unusedArtifactDirectory = 'unused-publication-images-test-artifacts';

/** Runs the compiler and returns the publication error code, or undefined when it unexpectedly succeeds. */
function compileErrorCode(doc: PublicationDocument, shot: PublicationShot): string | undefined {
  try { compilePublicationImagePrompt(doc, shot); return undefined; }
  catch (error) { return (error as { code?: string }).code; }
}

const parityBasePresetId = 'test-parity-base-preset';

/**
 * Copies the fixture's mock workflow under the parity ID and enables an "anima_base" Base preset.
 * No explicit choice exists on the shot, so imagePlan must auto-prefer this preset's workflow.
 */
function addParityBasePreset(db: ReturnType<typeof publicationFixture>['db']) {
  const source = db.connection.prepare("SELECT * FROM generation_workflow_versions WHERE workflow_id='publication-workflow' AND version=1")
    .get() as Record<string, unknown>;
  // The real parity schema declares unet_name; mirror that so the Base preset's values validate in strict mode.
  const schema = JSON.parse(source.input_schema_json as string) as Record<string, unknown>;
  schema.unet_name = { semantic: 'unet', type: 'model', default: 'anima-test.safetensors' };
  const now = new Date().toISOString();
  db.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at,category)
    VALUES (?,?,?,?,1,?,?,'image')`).run(PARITY_TEXT_WORKFLOW_ID, '邻舍对齐 · Base', '测试用对齐工作流', 'comfyui', now, now);
  db.connection.prepare(`INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?)`).run(PARITY_TEXT_WORKFLOW_ID, 1, source.engine_id as string,
    JSON.stringify(schema), source.node_bindings_json as string, source.output_declarations_json as string,
    source.definition_json as string, now, source.input_capabilities_json as string, source.output_media_types_json as string,
    source.output_schema_json as string, source.config_format_version as number, source.editor_config_json as string);
  db.connection.prepare(`INSERT INTO generation_presets(id,name,description,app_id,purpose,workflow_id,workflow_version,engine_id,values_json,enabled,revision,created_at,updated_at)
    VALUES (?,?,?,'activities','activity_image_text',?,1,?,?,1,1,?,?)`).run(parityBasePresetId, '邻舍对齐 · Base', '',
    PARITY_TEXT_WORKFLOW_ID, source.engine_id as string, JSON.stringify({ unet_name: 'anima_baseV10.safetensors' }), now, now);
  return parityBasePresetId;
}

test('keeps the English harness subject verbatim and never asks for caption whitespace', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    const doc = structuredClone(f.document), shot = doc.shots[0];
    shot.actorIds = ['actor-1'];
    shot.structuredPrompt = {
      actors: [{ actorId: 'actor-1', identity: ['albedo (genshin impact)'], appearance: ['pale blond hair'],
        clothing: ['white coat'], action: ['holding a test tube'], expression: ['calm'] }],
      camera: ['medium shot'], scene: ['snowy mountain camp'], details: ['glowing crystal'],
      naturalLanguage: 'An illustrated snowy camp with a crystal on a wooden laboratory desk.',
    };
    const prompt = compilePublicationImagePrompt(doc, shot);
    for (const fragment of ['albedo (genshin impact)', 'pale blond hair', 'white coat', 'holding a test tube',
      'calm', 'medium shot', 'snowy mountain camp', 'glowing crystal',
      'An illustrated snowy camp with a crystal on a wooden laboratory desk.']) {
      assert.ok(prompt.includes(fragment), `missing source fragment: ${fragment}`);
    }
    // The previous fixed suffix asked the model to reserve a caption strip below the image; captions are drawn
    // outside the image by the project renderer, so no whitespace request may reach the model again.
    assert.doesNotMatch(prompt, /space for captions|caption area|subtitle area|blank space|leave .*space/i);
    assert.match(prompt, /compose the scene to fill the entire frame/i);
    assert.match(prompt, /no text/);
    // The submission must not ask the image model to render any characters or words either.
    assert.doesNotMatch(prompt, /\b(with|add|include|render|draw|write)\b[^,.;]{0,40}\b(text|letters|subtitles?|captions?)\b/i);
  } finally { f.db.close(); }
});

test('allows a scene/object-only shot without any character block', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    const doc = structuredClone(f.document), shot = doc.shots[0];
    shot.actorIds = [];
    shot.structuredPrompt = { actors: [], camera: ['wide shot'], scene: ['snow-covered mountain ridge'],
      details: ['a single glowing crystal on the snow'], naturalLanguage: 'A quiet snowy ridge with one glowing crystal.' };
    const prompt = compilePublicationImagePrompt(doc, shot);
    assert.match(prompt, /snow-covered mountain ridge/);
    assert.match(prompt, /a single glowing crystal on the snow/);
    assert.doesNotMatch(prompt, /space for captions/i);
  } finally { f.db.close(); }
});

test('fills the whole frame and bans captions, on-image text and borders for actor and object shots alike', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    const doc = structuredClone(f.document);
    const objectShot = doc.shots[0];
    objectShot.actorIds = [];
    objectShot.structuredPrompt = { actors: [], camera: ['wide shot'], scene: ['snowy ridge'],
      details: ['one glowing crystal'], naturalLanguage: 'A snowy ridge with one glowing crystal.' };
    const actorShot = doc.shots[1];
    actorShot.actorIds = ['actor-1'];
    actorShot.structuredPrompt = { actors: [{ actorId: 'actor-1', identity: ['klee (genshin impact)'],
      appearance: ['blond hair'], clothing: ['red dress'], action: ['waving'], expression: ['happy'] }],
      camera: ['close-up'], scene: ['snowy camp'], details: ['sparkles'], naturalLanguage: 'Klee waves at a snowy camp.' };

    for (const shot of [objectShot, actorShot]) {
      const prompt = compilePublicationImagePrompt(doc, shot);
      // Captions are drawn outside the image by the project renderer, so the frame must be filled,
      // never reserved for a caption strip, and no words/watermark/border may be drawn inside it.
      assert.match(prompt, /compose the scene to fill the entire frame/i, shot.id);
      assert.match(prompt, /no text/, shot.id);
      assert.match(prompt, /no watermark/, shot.id);
      assert.match(prompt, /no speech bubbles/, shot.id);
      assert.match(prompt, /no border/, shot.id);
      assert.doesNotMatch(prompt, /space for captions|caption area|subtitle area|blank space|leave .*space/i, shot.id);
    }
  } finally { f.db.close(); }
});

test('rejects a Chinese shot that carries no valid English scene instead of rewriting the subject', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    const doc = structuredClone(f.document), shot = doc.shots[0];
    shot.actorIds = [];
    shot.structuredPrompt = { actors: [], camera: [], scene: ['雪山营地'], details: [], naturalLanguage: '雪山营地的一张图。' };
    assert.equal(compileErrorCode(doc, shot), 'publication_prompt_incomplete');
  } finally { f.db.close(); }
});

test('rejects a shot whose actorIds demand a character the structured prompt omits', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    const doc = structuredClone(f.document), shot = doc.shots[0];
    shot.actorIds = ['actor-9'];
    shot.structuredPrompt = { actors: [], camera: ['wide shot'], scene: ['snowy camp'], details: [], naturalLanguage: 'A snowy camp.' };
    assert.equal(compileErrorCode(doc, shot), 'publication_prompt_incomplete');
  } finally { f.db.close(); }
});

test('rejects a shot with no scene and no usable text at all', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    const doc = structuredClone(f.document), shot = doc.shots[0];
    shot.actorIds = [];
    shot.structuredPrompt = { actors: [], camera: [], scene: [], details: [], naturalLanguage: '' };
    assert.equal(compileErrorCode(doc, shot), 'publication_prompt_incomplete');
    // An empty scene alone is enough to reject, even when English text sits elsewhere in the prompt.
    shot.structuredPrompt = { actors: [], camera: ['wide shot'], scene: [], details: [], naturalLanguage: 'A snowy camp.' };
    assert.equal(compileErrorCode(doc, shot), 'publication_prompt_incomplete');
  } finally { f.db.close(); }
});

test('injects the workflow style suffix once and never repeats the compiled subject', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    addPublicationTestWorkflow(f.db);
    const doc = f.document, compiled = compilePublicationImagePrompt(doc, doc.shots[0]);
    const save = (revision: number, positiveSuffix: string) => saveActivityImagePromptPolicy(f.db, {
      workflowId: 'publication-workflow', workflowVersion: 1, revision, enabled: true,
      instructions: 'keep the harness subject', positiveSuffix, negativePrompt: '',
    });

    save(0, 'cinematic lighting, film grain');
    const plan = imagePlan(f.db, doc, doc.shots[0]);
    assert.equal(plan.positivePrompt, `${compiled}, cinematic lighting, film grain`);
    assert.equal(plan.positivePrompt.split(compiled).length - 1, 1);
    assert.equal(plan.inputs['prompt'], plan.positivePrompt);

    // A suffix identical to the compiled subject is de-duplicated instead of being sent twice.
    save(1, compiled);
    const deduped = imagePlan(f.db, doc, doc.shots[0]);
    assert.equal(deduped.positivePrompt, compiled);
    assert.equal(deduped.positivePrompt.split(compiled).length - 1, 1);
  } finally { f.db.close(); }
});

test('auto-prefers the enabled asset-less anima_base parity Base preset when the shot makes no explicit choice', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    addPublicationTestWorkflow(f.db);
    addParityBasePreset(f.db);
    const doc = structuredClone(f.document), shot = doc.shots[0];
    // The auto-preference only fires when the shot carries no explicit workflow, preset or reference key.
    shot.renderSettings = {};
    const plan = imagePlan(f.db, doc, shot);
    assert.equal(plan.workflowId, PARITY_TEXT_WORKFLOW_ID);
    assert.equal(plan.presetId, parityBasePresetId);
    // The parity definition binds the positive prompt straight to CLIPTextEncode.text, so it survives the guard.
    assert.equal(plan.inputs['prompt'], plan.positivePrompt);
  } finally { f.db.close(); }
});

test('rejects a workflow whose prompt composes inside a fixed StringConcatenate and leaves the definition untouched', () => {
  const f = publicationFixture(unusedArtifactDirectory);
  try {
    addPublicationTestWorkflow(f.db);
    const doc = structuredClone(f.document), shot = doc.shots[0];
    // Mirror a legacy workflow that composes the prompt with a fixed StringConcatenate chain instead of
    // binding it straight to CLIPTextEncode.text; only the fixture's published mock is repointed here.
    const definition = {
      '1': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'anima-test.safetensors', type: 'qwen_image', device: 'default' } },
      '3': { class_type: 'StringConcatenate', inputs: { string_a: '', string_b: 'masterpiece, best quality' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
      '8': { class_type: 'KSampler', inputs: { seed: 0, positive: ['1', 0], negative: ['7', 0] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
    };
    const bindings = { prompt: ['3', 'inputs', 'string_a'], negative: ['7', 'inputs', 'text'], seed: ['8', 'inputs', 'seed'] };
    const connection = f.db.connection;
    connection.prepare("UPDATE generation_workflow_versions SET definition_json=?, node_bindings_json=? WHERE workflow_id='publication-workflow' AND version=1")
      .run(JSON.stringify(definition), JSON.stringify(bindings));
    const snapshot = JSON.stringify(definition);
    const reject = () => { try { imagePlan(f.db, doc, shot); } catch (error) { return (error as { code?: string }).code; } };
    assert.equal(reject(), 'publication_workflow_prompt_composition');
    // The guard must reject rather than rewrite the immutable workflow definition into a compliant shape.
    const stored = connection.prepare("SELECT definition_json FROM generation_workflow_versions WHERE workflow_id='publication-workflow' AND version=1")
      .get() as { definition_json: string };
    assert.equal(stored.definition_json, snapshot);
  } finally { f.db.close(); }
});


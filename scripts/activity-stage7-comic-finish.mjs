/** Finish the stage 7 comic: render each panel, select the result, then export.
 *
 *   node scripts/activity-stage7-comic-finish.mjs --confirm --activity <id> [--render-timeout 900]
 *
 * Uses the real comic render path. Only writes into the given test activity.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
if (!args.includes('--confirm')) throw new Error('Pass --confirm');
const token = (process.env.STHSTART_ADMIN_TOKEN ?? '').trim();
if (!token) throw new Error('STHSTART_ADMIN_TOKEN is required');
const activityId = flag('--activity', '');
if (!activityId) throw new Error('--activity <id> is required');
const portal = flag('--portal', 'http://127.0.0.1:9320').replace(/\/$/, '');
const renderTimeoutMs = Number(flag('--render-timeout', '900')) * 1000;
const outDir = flag('--out', resolve('artifacts/activity-studio-abc', `comic-finish-${new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')}`));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function call(method, path, body) {
  const response = await fetch(`${portal}/api/admin${path}`, {
    method, headers: { 'x-sthstart-admin-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { /* raw */ }
  return { status: response.status, body: parsed ?? text };
}
const report = { activityId, startedAt: new Date().toISOString(), panels: [], issues: [] };
const save = () => writeFileSync(resolve(outDir, 'comic-finish.json'), JSON.stringify(report, null, 2));

const draftResponse = await call('GET', `/activities/${activityId}/comic/draft`);
let draft = draftResponse.body?.draft ?? draftResponse.body;
const document = draft.document;
const panelOrder = document.pages.flatMap((page) => page.panelIds);
console.log(`panels in reading order: ${panelOrder.length}`);

for (const panelId of panelOrder) {
  const panel = document.panels.find((item) => item.id === panelId);
  if (panel?.selectedImage?.artifactId) { report.panels.push({ panelId, skipped: 'already selected' }); continue; }

  const current = await call('GET', `/activities/${activityId}/comic/draft`);
  const currentDraft = current.body?.draft ?? current.body;
  const preview = await call('POST', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/render-preview`, { expectedDraftVersion: currentDraft.draftVersion });
  if (preview.status !== 200) { report.issues.push(`panel ${panelId} preview ${preview.status}: ${JSON.stringify(preview.body).slice(0, 200)}`); console.error('[issue] preview', panelId, preview.status); continue; }
  if (preview.body.canSubmit === false) { report.issues.push(`panel ${panelId} not submittable: ${(preview.body.warnings ?? []).join(' ')}`); console.error('[issue] blocked', panelId); continue; }

  // The render re-plans with the seed from the request, so the preview seed must
  // be echoed back or planHash will differ. The web client always sends a seed.
  const started = await call('POST', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/renders`, {
    expectedDraftVersion: currentDraft.draftVersion, planHash: preview.body.planHash, seed: preview.body.seed,
    idempotencyKey: `stage7-comic-${panelId}`,
  });
  if (started.status !== 202) { report.issues.push(`panel ${panelId} render ${started.status}: ${JSON.stringify(started.body).slice(0, 200)}`); console.error('[issue] render', panelId, started.status); continue; }

  const deadline = Date.now() + renderTimeoutMs;
  let chosen = null;
  while (Date.now() < deadline) {
    const history = await call('GET', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/history?limit=10`);
    const images = (history.body?.images ?? []).filter((image) => image.available && !image.isCurrent);
    const jobs = history.body?.jobs ?? [];
    if (images.length) { chosen = images[0]; break; }
    if (jobs.some((job) => job.status === 'failed')) { report.issues.push(`panel ${panelId} render failed`); break; }
    await sleep(3000);
  }
  if (!chosen) { console.error('[issue] no image for', panelId); continue; }

  const fresh = await call('GET', `/activities/${activityId}/comic/draft`);
  const freshDraft = fresh.body?.draft ?? fresh.body;
  const selected = await call('POST', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/select-image`, {
    expectedDraftVersion: freshDraft.draftVersion, artifactId: chosen.artifactId, allowStaleSource: false,
  });
  const ok = selected.status === 200;
  if (!ok) report.issues.push(`panel ${panelId} select ${selected.status}: ${JSON.stringify(selected.body).slice(0, 200)}`);
  report.panels.push({ panelId, artifactId: chosen.artifactId, sha256: chosen.sha256 ?? null, selected: ok });
  console.log(`[panel] ${panelId} -> ${chosen.artifactId} selected=${ok}`);
  save();
}

// Freeze an immutable revision and export the offline reader ZIP.
const finalDraft = await call('GET', `/activities/${activityId}/comic/draft`);
const finalVersion = (finalDraft.body?.draft ?? finalDraft.body).draftVersion;
const revision = await call('POST', `/activities/${activityId}/comic/revisions`, { expectedDraftVersion: finalVersion });
const revisionId = revision.body?.id ?? revision.body?.revision?.id ?? null;
report.revision = { status: revision.status, revisionId, documentHash: revision.body?.documentHash ?? null };
console.log('[revision]', JSON.stringify(report.revision));

if (revisionId) {
  const reader = await fetch(`${portal}/api/admin/activities/${activityId}/comic/exports/reader`, {
    method: 'POST', headers: { 'x-sthstart-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ revisionId }),
  });
  const bytes = Buffer.from(await reader.arrayBuffer());
  const zipPath = resolve(outDir, 'comic-offline.zip');
  writeFileSync(zipPath, bytes);
  report.export = { status: reader.status, contentType: reader.headers.get('content-type'), bytes: bytes.length, path: zipPath };
  console.log('[export]', JSON.stringify({ status: reader.status, bytes: bytes.length }));
  if (reader.status !== 200) report.issues.push(`offline export ${reader.status}: ${bytes.toString('utf8').slice(0, 300)}`);
}
report.finishedAt = new Date().toISOString();
report.result = report.issues.length ? 'passed_with_issues' : 'passed';
save();
console.log(`\nresult=${report.result} issues=${report.issues.length}\nreport: ${outDir}`);
process.exitCode = report.issues.length ? 1 : 0;


import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = 'F:/Project/SthStart/data/sthstart.db';
const artifactBase = 'F:/Project/SthStart/data/artifacts/characters';
const dockerArtifactBase = '/app/data/artifacts/characters';

fs.mkdirSync(artifactBase, { recursive: true });

const db = new DatabaseSync(dbPath);
const assets = db.prepare(`
  SELECT ca.id as asset_id, ca.artifact_id, ca.source_url, ca.kind, a.local_path, a.file_status
  FROM character_assets ca
  LEFT JOIN artifacts a ON a.id = ca.artifact_id
  WHERE ca.source_url IS NOT NULL AND ca.source_url != ''
`).all();

console.log(`Found ${assets.length} character assets with source_url.`);

const concurrency = 8;
let index = 0;
let successCount = 0;
let failCount = 0;
let skipCount = 0;

async function worker(workerId) {
  while (index < assets.length) {
    const item = assets[index++];
    const artifactId = item.artifact_id;
    if (!artifactId) continue;

    // Determine target filenames
    const hostFilePng = path.join(artifactBase, `${artifactId}.png`);
    const hostFileWebp = path.join(artifactBase, `${artifactId}.webp`);
    const hostFileJpg = path.join(artifactBase, `${artifactId}.jpg`);

    if (fs.existsSync(hostFilePng) || fs.existsSync(hostFileWebp) || fs.existsSync(hostFileJpg)) {
      skipCount++;
      continue;
    }

    try {
      const res = await fetch(item.source_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        failCount++;
        console.warn(`[Fail ${res.status}] ${item.source_url}`);
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/png';
      const ext = contentType.includes('webp') ? '.webp' : contentType.includes('jpeg') ? '.jpg' : '.png';
      const finalHostPath = path.join(artifactBase, `${artifactId}${ext}`);
      const finalDockerPath = `${dockerArtifactBase}/${artifactId}${ext}`;

      fs.writeFileSync(finalHostPath, buf);

      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE artifacts
        SET local_path = ?, content_type = ?, byte_size = ?, sha256 = ?, file_status = 'ready', updated_at = ?
        WHERE id = ?
      `).run(finalDockerPath, contentType, buf.length, sha256, now, artifactId);

      successCount++;
      if (successCount % 10 === 0 || successCount === assets.length) {
        console.log(`Progress: ${successCount}/${assets.length} downloaded successfully.`);
      }
    } catch (err) {
      failCount++;
      console.warn(`[Error] ${item.source_url}: ${err.message}`);
    }
  }
}

console.log('Starting parallel asset download...');
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
console.log(`Warmup completed! Success: ${successCount}, Skipped: ${skipCount}, Failed: ${failCount}`);

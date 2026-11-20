import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { StoryBodyPackSchema } from '@sthstart/contracts';
import { readConfig } from '../apps/service/src/config.js';
import { importStoryBodyPack } from '../apps/service/src/creative-orchestration/blueprint.js';
import { ServiceDatabase } from '../apps/service/src/database.js';
import { SecretStore } from '../apps/service/src/security.js';

function parseArgs(argv: string[]): { dryRun: boolean; files: string[] } {
  let dryRun = false;
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--file' && argv[index + 1]) {
      files.push(argv[index + 1]);
      index += 1;
    } else if (!token.startsWith('-')) {
      files.push(token);
    }
  }
  return { dryRun, files };
}

const { dryRun, files } = parseArgs(process.argv.slice(2));
if (files.length === 0) {
  console.error('Usage: node --import tsx scripts/import-story-pack.ts [--dry-run] <pack.json> [...]');
  process.exit(1);
}

const packs = files.map((filePath) => {
  const absolutePath = resolve(filePath);
  const raw = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  if (!Value.Check(StoryBodyPackSchema, raw)) {
    const errors = [...Value.Errors(StoryBodyPackSchema, raw)]
      .slice(0, 8)
      .map((err) => `${err.path || '/'}: ${err.message}`)
      .join('\n  ');
    throw new Error(`Schema validation failed for ${absolutePath}:\n  ${errors}`);
  }
  return { absolutePath, pack: raw };
});

if (dryRun) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    validated: packs.map(({ absolutePath, pack }) => ({
      file: absolutePath,
      work: pack.work,
      setupId: pack.setupId ?? null,
      characters: pack.characters.length,
      locations: pack.worldDefinition.locations.length,
      actors: pack.worldDefinition.actors.length,
      sources: pack.worldDefinition.sources.length,
      lockedFacts: pack.worldDefinition.lockedFacts.length,
      storyLines: pack.storyLines.length,
      openThreads: pack.openThreads.length,
    })),
  }, null, 2));
  process.exit(0);
}

const config = readConfig();
const secrets = new SecretStore();
const database = new ServiceDatabase(config.databasePath);
try {
  const results = packs.map(({ absolutePath, pack }) => ({
    file: absolutePath,
    result: importStoryBodyPack(database, pack, { config, secrets }),
  }));
  console.log(JSON.stringify({ mode: 'imported', databasePath: config.databasePath, results }, null, 2));
} finally {
  database.close();
}

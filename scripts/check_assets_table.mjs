import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dbPath = resolve(process.cwd(), 'data/sthstart.db');
try {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE name='character_assets'").get();
  console.log('TABLE SQL:', row?.sql);
} catch (e) {
  console.error(e);
}

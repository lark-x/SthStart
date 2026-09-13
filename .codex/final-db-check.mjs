import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/sthstart.db', { readOnly: true });
const out = {
  migrationMax: db.prepare('SELECT max(version) v FROM schema_migrations').get(),
  schemaV2: db.prepare("SELECT count(*) c FROM character_profiles WHERE json_extract(draft_json,'$.schemaVersion')=2").get(),
  total: db.prepare('SELECT count(*) c FROM character_profiles').get(),
  outfitsTable: db.prepare("SELECT count(*) c FROM sqlite_schema WHERE type='table' AND name='character_outfits'").get(),
  fkViolations: db.prepare('PRAGMA foreign_key_check').all().length,
  quickCheck: db.prepare('PRAGMA quick_check').get()
};
console.log(JSON.stringify(out, null, 2));
db.close();

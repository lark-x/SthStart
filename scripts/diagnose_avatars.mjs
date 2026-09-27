import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const catalogPath = resolve('scripts/akasha-genshin-character-catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')).characters;

console.log('Catalog count:', catalog.length);

async function main() {
  // Fetch character list from running server
  const res = await fetch('http://localhost:9320/api/v1/characters');
  const data = await res.json();
  const items = data.items || [];
  console.log('API items count:', items.length);

  // If /api/v1/characters only returns published ones, let's also check browse or direct
  const browseRes = await fetch('http://localhost:9320/api/admin/characters/browse?filter=' + encodeURIComponent(JSON.stringify({ pageSize: 200 })));
  let allCharacters = [];
  if (browseRes.ok) {
    const bData = await browseRes.json();
    allCharacters = bData.items || [];
  } else {
    console.log('Browse failed:', browseRes.status, await browseRes.text());
  }

  console.log('All characters count:', allCharacters.length);
  const withoutAvatar = allCharacters.filter(c => !c.avatarUrl);
  console.log('Without avatar count:', withoutAvatar.length);

  for (const c of withoutAvatar) {
    const name = c.displayName;
    const en = c.draft?.englishName;
    const work = c.draft?.work;

    // Check match
    let match = catalog.find(x => x.name === name.trim());
    if (!match && en) match = catalog.find(x => x.nameEn.toLowerCase() === en.trim().toLowerCase());
    if (!match) match = catalog.find(x => name.trim().includes(x.name) || x.name.includes(name.trim()));

    if (!match) {
      console.log(`[NO MATCH] ${name} | work: ${work} | en: ${en}`);
    } else {
      console.log(`[MATCH FOUND] ${name} -> ${match.nameEn} (${match.name})`);
      // Test the URLs
      const urls = [
        `https://enka.network/ui/UI_AvatarIcon_${match.nameEn}.png`,
        `https://api.ambr.top/assets/UI/UI_AvatarIcon_${match.nameEn}.png`
      ];
      for (const u of urls) {
        try {
          const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          console.log(`  url: ${u} -> status: ${r.status}`);
        } catch (err) {
          console.log(`  url: ${u} -> error: ${err.message}`);
        }
      }
    }
  }
}

main().catch(console.error);

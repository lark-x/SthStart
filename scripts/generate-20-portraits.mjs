import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const CHARACTERS = [
  {
    name: '芙宁娜',
    slug: 'furina',
    title: '枫丹大剧院舞台光华·水幕双姝',
    category: 'cg',
    prompt: 'furina (genshin impact), blue hair, heterochromia, top hat, ornate fontaine aristocratic blue coat, holding ornate walking stick sword, summoning swirling glowing water droplets, dramatic theatrical stage spotlight, bubbles, water splash, floating petals, masterpiece, high quality, best quality, dynamic angle',
  },
  {
    name: '纳西妲',
    slug: 'nahida',
    title: '净善宫智慧之庭·草木生辉',
    category: 'cg',
    prompt: 'nahida (genshin impact), white hair with green gradient, side ponytail, leaf hair ornament, cute white dress with gold and green accents, sitting on glowing digital green swing, floating dendro lotus flowers, soft warm mystical lighting, masterpiece, high quality, delicate features',
  },
  {
    name: '雷电将军',
    slug: 'raiden_shogun',
    title: '一心净土·无想的一刀',
    category: 'cg',
    prompt: 'raiden shogun, ei (genshin impact), long braided purple hair, electro hair ornament, purple kimono, drawing purple glowing lightning tachi sword from chest, crackling electro sparks, stormy dark purple skies, glowing torii gate in background, intense regal expression, dynamic action pose, masterpiece, high quality',
  },
  {
    name: '胡桃',
    slug: 'hu_tao',
    title: '往生堂幽冥蝶舞·俏皮夜巡',
    category: 'cg',
    prompt: 'hu tao (genshin impact), long dark twin tails, porkpie hat with plum blossoms, red eyes with flower pupils, dark coat, playful wink, summoning transparent glowing ghostly companion, dancing fiery spirit butterflies, lanterns in liyue night street, masterpiece, high quality, charming expression',
  },
  {
    name: '钟离',
    slug: 'zhongli',
    title: '岩王帝君·地心天星',
    category: 'cg',
    prompt: 'zhongli (genshin impact), handsome brown hair tied back with orange tips, amber glowing eyes, dark formal coat with geometric geo patterns, holding glowing golden geo cube catalyst, floating stone pillars, golden dust particles, serene majestic expression, mountain peaks background, masterpiece, high quality',
  },
  {
    name: '神里绫华',
    slug: 'kamisato_ayaka',
    title: '白鹭公主·神里流霜灭',
    category: 'cg',
    prompt: 'kamisato ayaka (genshin impact), high ponytail tied with black ribbon, white-blue hair, ornate armor chestplate over light blue dress, holding traditional folding fan, swirling cryo ice crystals and pink cherry blossom petals, moonlit wooden shrine pavilion, graceful elegant pose, masterpiece, high quality',
  },
  {
    name: '枫原万叶',
    slug: 'kaedehara_kazuha',
    title: '枫袖起风·千叶沉醉',
    category: 'cg',
    prompt: 'kaedehara kazuha (genshin impact), platinum blonde hair with red streak, autumn samurai attire, single shoulder armor, holding anemo infused katana, swirling scarlet maple leaves, gust of wind, serene closed eye smile, sunset mountain forest background, masterpiece, high quality',
  },
  {
    name: '刻晴',
    slug: 'keqing',
    title: '霆霓快雨·剑光如我',
    category: 'cg',
    prompt: 'keqing (genshin impact), purple hair tied in cat-ear twin buns, purple and white dress with golden feathers, agile swordsmanship stance, wielding glowing electro one-handed sword, violet lightning arcs, overlooking bustling Liyue harbor at twilight, sharp focused gaze, masterpiece, high quality',
  },
  {
    name: '甘雨',
    slug: 'ganyu',
    title: '循循守月·霜华矢破',
    category: 'cg',
    prompt: 'ganyu (genshin impact), dark red horns, pale blue hair tied back, white bodysuit with black apron, pulling glowing ice bow string, glowing cryo frost arrow, surrounded by blooming blue glaze lilies, misty Liyue mountain peaks under starry night, gentle determined look, masterpiece, high quality',
  },
  {
    name: '夜兰',
    slug: 'yelan',
    title: '幽客密谋·络丝命线',
    category: 'cg',
    prompt: 'yelan (genshin impact), short asymmetrical dark blue bob hair, fur-collared blue and black coat, holding glowing translucent blue lifeline threads, glowing dice hovering in hand, mysterious confident smirk, shadowy casino or tea house interior, dramatic blue rim light, masterpiece, high quality',
  },
  {
    name: '八重神子',
    slug: 'yae_miko',
    title: '鸣神大社·天狐显圣',
    category: 'cg',
    prompt: 'yae miko (genshin impact), pink hair, fox ears, shrine maiden miko outfit with exposed shoulders, holding gohei wand, translucent purple giant kitsune spirit phantom behind her, floating sakura petals, sacred sakura tree in background, playful seductive smile, masterpiece, high quality',
  },
  {
    name: '那维莱特',
    slug: 'neuvillette',
    title: '沫芒宫最高审判官·古龙潮涌',
    category: 'cg',
    prompt: 'neuvillette (genshin impact), long silver hair with blue highlights, elegant blue and white judicial longcoat with silver cravat, holding blue dragon cane, floating glowing water droplets and hydro legal scales, ornate marble courthouse courtroom, dignified calm piercing gaze, masterpiece, high quality',
  },
  {
    name: '优菈',
    slug: 'eula',
    title: '浪花骑士·光降之剑',
    category: 'cg',
    prompt: 'eula (genshin impact), short light blue hair with black headband, knight bodysuit with blue cape, holding glowing greatsword resting on shoulder, graceful ballet stance, icy snowflake crystals in blizzard, dramatic lighting, confident noble gaze, masterpiece, high quality',
  },
  {
    name: '达达利亚',
    slug: 'tartaglia',
    title: '公子·魔王武装与双刀',
    category: 'cg',
    prompt: 'tartaglia, childe (genshin impact), short messy ginger hair, red fatui mask on side of head, grey jacket with red scarf, wielding dual glowing hydro daggers, swirling water blades, mischievous combat grin, ruins battlefield background, dynamic action perspective, masterpiece, high quality',
  },
  {
    name: '宵宫',
    slug: 'yoimiya',
    title: '琉焰华舞·夏日花火',
    category: 'cg',
    prompt: 'yoimiya (genshin impact), blonde messy bun with red ornaments, bandages and red festive kimono half-wrapped, holding sparklers and wooden bow, exploding colorful fireworks in night festival sky, radiant cheerful smile, glowing warm festive lanterns, masterpiece, high quality',
  },
  {
    name: '申鹤',
    slug: 'shenhe',
    title: '孤辰茕怀·红绳缚魂',
    category: 'cg',
    prompt: 'shenhe (genshin impact), long silver white hair braided, black and turquoise tight bodysuit with red exorcist ropes, holding glowing cryo polearm, summoning icy spirit avatars, floating paper talismans, frosty misty mountain peak, ethereal melancholic beauty, masterpiece, high quality',
  },
  {
    name: '可莉',
    slug: 'klee',
    title: '逃跑的太阳·蹦蹦炸弹',
    category: 'cg',
    prompt: 'klee (genshin impact), blonde hair with cute elf ears, red beret with feather, red dress with backpack, holding cheerful bouncing bomb (jumu bomb), sparkly star explosions in grassy forest glade, overjoyed happy laughing expression, flowers and clover, masterpiece, high quality',
  },
  {
    name: '提纳里',
    slug: 'tighnari',
    title: '道成林巡林官·植物学研究',
    category: 'cg',
    prompt: 'tighnari (genshin impact), dark hair with light green streaks, long pointed fennec fox ears, botanical ranger uniform, holding glowing sumeru forest mushroom and wooden notebook, lush rainforest canopy with sun rays filtering through leaves, clever curious expression, masterpiece, high quality',
  },
  {
    name: '温迪',
    slug: 'venti',
    title: '自由之风·高天之歌',
    category: 'cg',
    prompt: 'venti (genshin impact), twin braids with teal gradient tips, green bard beret and cape with white frills, playing holy wooden lyre, swirling dandelion seeds and green breeze currents, resting by giant ancient oak tree at Windrise, breezy bright sunny meadow, cheerful musical smile, masterpiece, high quality',
  },
  {
    name: '琴',
    slug: 'jean',
    title: '蒲公英骑士·风压剑',
    category: 'cg',
    prompt: 'jean (genshin impact), high blonde ponytail, white knight trousers and black-and-gold bodice with blue cape, holding glowing silver one-handed sword pointing forward, swirling dandelion wind storm, Knights of Favonius headquarters balcony overlooking Mondstadt cathedral, righteous noble expression, masterpiece, high quality',
  },
];

async function main() {
  console.log('🚀 启动 20 位高人气原神角色 LoRA 多形式立绘制作管线...');

  const dbPath = path.resolve('data/sthstart.db');
  const db = new DatabaseSync(dbPath);
  db.prepare('PRAGMA busy_timeout = 15000;').run();

  const artifactsDir = path.resolve('data/artifacts/characters');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // 清理旧的 lora-generator 批次记录，防止无效文件残留
  const oldShared = db.prepare("SELECT artifact_id FROM shared_assets WHERE source_page = 'lora-generator'").all();
  for (const s of oldShared) {
    db.prepare('DELETE FROM shared_assets WHERE artifact_id = ?').run(s.artifact_id);
    db.prepare('DELETE FROM character_assets WHERE artifact_id = ?').run(s.artifact_id);
    const art = db.prepare('SELECT local_path FROM artifacts WHERE id = ?').get(s.artifact_id);
    if (art?.local_path && fs.existsSync(art.local_path)) {
      try { fs.unlinkSync(art.local_path); } catch {}
    }
    db.prepare('DELETE FROM artifacts WHERE id = ?').run(s.artifact_id);
  }
  console.log(`🧹 已清理旧批次残留 ${oldShared.length} 项记录与文件`);

  // 引入 Linshe 生图核心
  const imageSkillUrl = pathToFileURL(path.resolve('upstream/linshe/agent-core/src/services/imageSkill.js')).href;
  const imageSkill = await import(imageSkillUrl);

  const results = [];

  for (let i = 0; i < CHARACTERS.length; i++) {
    const item = CHARACTERS[i];
    console.log(`\n[${i + 1}/${CHARACTERS.length}] 正在生成【${item.name}】——《${item.title}》...`);

    // 查找角色 ID
    const charRow = db.prepare('SELECT id, display_name, portrait_asset_id FROM character_profiles WHERE archived=0 AND display_name=?').get(item.name);
    if (!charRow) {
      console.warn(`未在 character_profiles 中找到活跃角色: ${item.name}，跳过`);
      continue;
    }
    const characterId = charRow.id;

    const startTime = Date.now();
    try {
      const genRes = await imageSkill.generateImage(item.prompt, {
        loras: [
          {
            path: 'dim23_V5_epoch18.safetensors',
            weight: 0.85,
            triggerWord: 'genshin impact, masterpiece, vibrant colors',
          },
        ],
        width: 768,
        height: 1024,
        artist: '@ebora',
        disableRAG: true,
      });

      if (!genRes.success || !genRes.images?.[0]?.base64) {
        throw new Error(genRes.error || '未能获得生成的图像数据');
      }

      const imgData = genRes.images[0];
      const base64Clean = imgData.base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const byteSize = buffer.length;

      const artifactId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const sharedAssetId = crypto.randomUUID();
      const now = new Date().toISOString();

      const fileName = `${artifactId}.png`;
      const localFilePath = path.join(artifactsDir, fileName);
      fs.writeFileSync(localFilePath, buffer);

      const storageKey = `characters/${fileName}`;

      // 1. 写入 artifacts 表
      db.prepare(`
        INSERT INTO artifacts
          (id, app_id, storage_key, local_path, byte_size, sha256, content_type,
           file_status, created_at, updated_at)
        VALUES (?, 'characters', ?, ?, ?, ?, 'image/png', 'ready', ?, ?)
      `).run(
        artifactId,
        storageKey,
        localFilePath,
        byteSize,
        sha256,
        now,
        now
      );

      // 2. 写入 character_assets 表 (专属角色资产)
      db.prepare(`
        INSERT INTO character_assets
          (id, character_id, kind, created_at, artifact_id, source_page, source_url,
           author_note, user_note, category, title, tags_json, metadata_json)
        VALUES (?, ?, 'portrait', ?, ?, 'lora-creative-batch', '', 'Anima V10 + LoRA dim23_V5 高清立绘', '', 'cg', ?, ?, '{}')
      `).run(
        assetId,
        characterId,
        now,
        artifactId,
        item.title,
        JSON.stringify([item.slug, 'genshin', 'lora', 'cg'])
      );

      // 更新角色立绘为全新生成的 LoRA 高清立绘
      db.prepare('UPDATE character_profiles SET portrait_asset_id=?, updated_at=? WHERE id=?').run(assetId, now, characterId);

      // 3. 写入 shared_assets 表 (沉淀至公共资源库瀑布流)
      db.prepare(`
        INSERT INTO shared_assets
          (id, title, category, artifact_id, character_ids_json, tags_json, metadata_json,
           author_note, user_note, source_page, source_url, created_at, updated_at)
        VALUES (?, ?, 'key_visual', ?, ?, ?, '{}', 'Anima + LoRA 原神高人气角色立绘', '', 'lora-generator', '', ?, ?)
      `).run(
        sharedAssetId,
        `${item.name} · ${item.title}`,
        artifactId,
        JSON.stringify([characterId]),
        JSON.stringify([item.slug, '原神', '立绘', '名场面']),
        now,
        now
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ 【${item.name}】立绘生成并入库成功！用时: ${elapsed}s, 文件大小: ${(byteSize / 1024).toFixed(1)} KB`);
      results.push({ name: item.name, title: item.title, artifactId, elapsed });
    } catch (err) {
      console.error(`❌ 【${item.name}】生成失败:`, err.message);
    }
  }

  console.log(`\n🎉 制作完成！成功生成 ${results.length}/${CHARACTERS.length} 张原神高质量多形态立绘！`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

import os, shutil, hashlib, uuid, sqlite3, json, datetime
from PIL import Image

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

def compute_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

char_id = '5c9ec187-d71c-4c68-88a2-f76988c47cbb'
sth_artifact_dir = os.path.abspath('data/artifacts/characters')

items = [
    {
        'file': 'data/furina_scene_teatime_cg.png',
        'title': '枫丹廷露天午后红茶与甜点',
        'category': 'key_visual',
        'tags': ['genshin', 'fontaine', 'furina', 'cg', 'teatime', 'cafe'],
        'character_id': char_id,
        'linshe_rel': 'images/events/furina_scene_teatime_cg.png'
    },
    {
        'file': 'data/scene_palais_mermonia_bg.png',
        'title': '纯场景·沫芒宫欧式华贵内厅',
        'category': 'scene_background',
        'tags': ['genshin', 'fontaine', 'palais_mermonia', 'scene_background', 'visual_novel'],
        'character_id': char_id,
        'linshe_rel': 'images/events/scene_palais_mermonia_bg.png'
    }
]

# Copy to Linshe
for it in items:
    for lb in ['upstream/linshe/agent-core/data', 'data/linshe']:
        target = os.path.join(lb, it['linshe_rel'])
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(it['file'], target)

# SthStart DB
conn = sqlite3.connect('data/sthstart.db')
c = conn.cursor()

for it in items:
    fpath = it['file']
    with Image.open(fpath) as img:
        w, h = img.size
    sha = compute_sha256(fpath)
    byte_sz = os.path.getsize(fpath)
    now = now_iso()
    art_id = str(uuid.uuid4())
    art_dest = os.path.join(sth_artifact_dir, f'{art_id}.png')
    shutil.copy2(fpath, art_dest)
    storage_key = f'characters/{art_id}.png'

    c.execute('''
        INSERT INTO artifacts (
            id, app_id, task_id, provider_url, local_path, storage_key,
            content_type, byte_size, sha256, file_status, original_name,
            media_type, width, height, duration_ms, fps, codec, has_audio,
            thumbnail_artifact_id, metadata_json, pinned, created_at, updated_at
        ) VALUES (?, 'characters', NULL, NULL, ?, ?, 'image/png', ?, ?, 'ready', ?, 'image', ?, ?, NULL, NULL, NULL, 0, NULL, ?, 1, ?, ?)
    ''', (
        art_id, art_dest, storage_key, byte_sz, sha,
        os.path.basename(fpath), w, h,
        json.dumps({'title': it['title'], 'category': it['category']}),
        now, now
    ))

    shared_id = str(uuid.uuid4())
    c.execute('''
        INSERT INTO shared_assets (
            id, title, category, artifact_id, character_ids_json, tags_json,
            metadata_json, author_note, user_note, source_page, source_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'ComfyUI Anima Base + xdomikami LoRA 生成', '', 'linshe-generation', ?, ?, ?)
    ''', (
        shared_id, it['title'], it['category'], art_id,
        json.dumps([it['character_id']]), json.dumps(it['tags']),
        f'/{it["linshe_rel"]}', now, now
    ))

    c.execute('''
        INSERT INTO character_assets (
            id, character_id, kind, created_at, artifact_id, source_page,
            source_url, author_note, user_note, category, title, tags_json, metadata_json
        ) VALUES (?, ?, 'reference', ?, ?, 'linshe-generation', ?, 'ComfyUI Anima Base + xdomikami LoRA 生成', '', 'cg', ?, ?, '{}')
    ''', (
        str(uuid.uuid4()), it['character_id'], now, art_id,
        f'/{it["linshe_rel"]}', it['title'], json.dumps(it['tags'])
    ))

conn.commit()
conn.close()
print('Deposit complete!')

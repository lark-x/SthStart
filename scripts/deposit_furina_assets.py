import os
import shutil
import hashlib
import uuid
import sqlite3
import datetime
from PIL import Image

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

def compute_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def main():
    print('=== Starting Furina Assets Sync & Deposit ===')
    
    char_id = '5c9ec187-d71c-4c68-88a2-f76988c47cbb'
    linshe_char_id = 5
    
    # 1. Prepare directories
    sth_artifact_dir = os.path.abspath('data/artifacts/characters')
    os.makedirs(sth_artifact_dir, exist_ok=True)
    
    linshe_bases = [
        os.path.abspath('upstream/linshe/agent-core/data'),
        os.path.abspath('data/linshe')
    ]
    for lb in linshe_bases:
        os.makedirs(os.path.join(lb, 'avatars'), exist_ok=True)
        os.makedirs(os.path.join(lb, 'images', 'standing'), exist_ok=True)
        os.makedirs(os.path.join(lb, 'images', 'events'), exist_ok=True)
        os.makedirs(os.path.join(lb, 'images', 'chat'), exist_ok=True)

    # 2. Deploy to Linshe static folders
    files_to_linshe = {
        'data/furina_avatar.png': 'avatars/furina_avatar.png',
        'data/furina_standing_portrait.png': 'images/standing/furina_standing.png',
        'data/furina_expression_happy.png': 'images/standing/furina_happy.png',
        'data/furina_expression_smug.png': 'images/standing/furina_smug.png',
        'data/furina_expression_surprised.png': 'images/standing/furina_surprised.png',
        'data/furina_scene_opera_cg.png': 'images/events/furina_scene_opera_cg.png',
    }
    
    for src_rel, dst_rel in files_to_linshe.items():
        src_path = os.path.abspath(src_rel)
        if not os.path.exists(src_path):
            print(f'Warning: {src_path} not found!')
            continue
        for lb in linshe_bases:
            target_path = os.path.join(lb, dst_rel)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            shutil.copy2(src_path, target_path)
            print(f'Copied {src_rel} -> {target_path}')

    # 3. Update Linshe Databases
    for db_path in ['upstream/linshe/agent-core/data/agent.db', 'data/linshe/agent.db']:
        if not os.path.exists(db_path):
            continue
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('''
            UPDATE characters 
            SET avatar_path = ?, standing_url = ?, loras = ?
            WHERE id = ?
        ''', (
            '/avatars/furina_avatar.png',
            '/images/standing/furina_standing.png',
            '[{"path": "dim23_V5_epoch18.safetensors", "weight": 0.7, "triggerWord": "@DOM"}]',
            linshe_char_id
        ))
        conn.commit()
        conn.close()
        print(f'Updated character {linshe_char_id} in {db_path}')

    # 4. Deposit into SthStart Database and Artifacts Store
    sth_conn = sqlite3.connect('data/sthstart.db')
    sth_c = sth_conn.cursor()

    items = [
        {
            'file': 'data/furina_standing_portrait.png',
            'kind': 'portrait',
            'category': 'portrait',
            'title': '芙宁娜 - 枫丹水神华美全身体态立绘',
            'tags': ['genshin', 'fontaine', 'furina', 'portrait', 'official_anima', 'dim23_lora'],
            'is_portrait': True,
        },
        {
            'file': 'data/furina_avatar.png',
            'kind': 'avatar',
            'category': 'avatar',
            'title': '芙宁娜 - 专属头像',
            'tags': ['genshin', 'fontaine', 'furina', 'avatar', 'official_anima'],
            'is_avatar': True,
        },
        {
            'file': 'data/furina_expression_happy.png',
            'kind': 'reference',
            'category': 'expression',
            'title': '芙宁娜 - 表情差分：优雅喜悦',
            'tags': ['genshin', 'fontaine', 'furina', 'expression', 'happy'],
        },
        {
            'file': 'data/furina_expression_smug.png',
            'kind': 'reference',
            'category': 'expression',
            'title': '芙宁娜 - 表情差分：自信得意',
            'tags': ['genshin', 'fontaine', 'furina', 'expression', 'smug'],
        },
        {
            'file': 'data/furina_expression_surprised.png',
            'kind': 'reference',
            'category': 'expression',
            'title': '芙宁娜 - 表情差分：慌张窘迫',
            'tags': ['genshin', 'fontaine', 'furina', 'expression', 'surprised'],
        },
        {
            'file': 'data/furina_scene_opera_cg.png',
            'kind': 'reference',
            'category': 'cg',
            'title': '欧庇克莱歌剧院 - 芙宁娜谢幕演出版',
            'tags': ['genshin', 'fontaine', 'furina', 'opera_epiclese', 'cg', 'stage'],
            'is_shared': True,
        },
    ]

    new_avatar_asset_id = None
    new_portrait_asset_id = None

    import json
    for it in items:
        fpath = it['file']
        with Image.open(fpath) as img:
            w, h = img.size
        sha = compute_sha256(fpath)
        byte_sz = os.path.getsize(fpath)
        now = now_iso()
        
        art_id = str(uuid.uuid4())
        art_final_name = f'{art_id}.png'
        art_dest = os.path.join(sth_artifact_dir, art_final_name)
        shutil.copy2(fpath, art_dest)
        
        storage_key = f'characters/{art_final_name}'
        
        # Insert artifact
        sth_c.execute('''
            INSERT INTO artifacts (
                id, app_id, task_id, provider_url, local_path, storage_key,
                content_type, byte_size, sha256, file_status, original_name,
                media_type, width, height, duration_ms, fps, codec, has_audio,
                thumbnail_artifact_id, metadata_json, pinned, created_at, updated_at
            ) VALUES (?, ?, NULL, NULL, ?, ?, 'image/png', ?, ?, 'ready', ?, 'image', ?, ?, NULL, NULL, NULL, 0, NULL, ?, 1, ?, ?)
        ''', (
            art_id, 'characters', art_dest, storage_key, byte_sz, sha,
            os.path.basename(fpath), w, h,
            json.dumps({'title': it['title'], 'characterId': char_id, 'category': it['category']}),
            now, now
        ))
        print(f'Saved artifact {art_id} for {it["title"]} ({w}x{h})')
        
        # Character Asset
        asset_id = str(uuid.uuid4())
        sth_c.execute('''
            INSERT INTO character_assets (
                id, character_id, kind, created_at, artifact_id, source_page,
                source_url, author_note, user_note, category, title, tags_json, metadata_json
            ) VALUES (?, ?, ?, ?, ?, 'linshe-generation', ?, 'ComfyUI Anima Base + xdomikami LoRA 生成', '', ?, ?, ?, '{}')
        ''', (
            asset_id, char_id, it['kind'], now, art_id,
            f'/images/{os.path.basename(fpath)}',
            it['category'], it['title'], json.dumps(it['tags'])
        ))
        
        if it.get('is_avatar'):
            new_avatar_asset_id = asset_id
        if it.get('is_portrait'):
            new_portrait_asset_id = asset_id
            
        # If shared asset
        if it.get('is_shared'):
            shared_id = str(uuid.uuid4())
            shared_cat = 'key_visual'
            sth_c.execute('''
                INSERT INTO shared_assets (
                    id, title, category, artifact_id, character_ids_json, tags_json,
                    metadata_json, author_note, user_note, source_page, source_url, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'ComfyUI Anima Base + xdomikami LoRA 生成', '', 'linshe-generation', ?, ?, ?)
            ''', (
                shared_id, it['title'], shared_cat, art_id,
                json.dumps([char_id]), json.dumps(it['tags']),
                f'/images/{os.path.basename(fpath)}', now, now
            ))
            print(f'Registered shared asset {shared_id} for {it["title"]}')

    # Update Character Profile avatar & portrait
    update_time = now_iso()
    sth_c.execute('''
        UPDATE character_profiles
        SET avatar_asset_id = ?, portrait_asset_id = ?, updated_at = ?
        WHERE id = ?
    ''', (new_avatar_asset_id, new_portrait_asset_id, update_time, char_id))
    print(f'Updated character_profiles for {char_id}: avatar={new_avatar_asset_id}, portrait={new_portrait_asset_id}')

    # Also link to character profile e2d08295-fc20-4845-a02e-0943edac8706 if present
    sth_c.execute('''
        UPDATE character_profiles
        SET avatar_asset_id = ?, portrait_asset_id = ?, updated_at = ?
        WHERE id = 'e2d08295-fc20-4845-a02e-0943edac8706'
    ''', (new_avatar_asset_id, new_portrait_asset_id, update_time))

    # App character links
    sth_c.execute('DELETE FROM app_character_links WHERE app_id = "linshe" AND local_id = ?', (str(linshe_char_id),))
    sth_c.execute('''
        INSERT INTO app_character_links (
            app_id, local_id, character_id, source_version, imported_hash, local_modified, created_at, updated_at
        ) VALUES ('linshe', ?, ?, 1, 'manual-sync', 0, ?, ?)
    ''', (str(linshe_char_id), char_id, update_time, update_time))
    print(f'Linked linshe local_id {linshe_char_id} to character_id {char_id}')

    sth_conn.commit()
    sth_conn.close()
    print('=== All operations completed successfully! ===')

if __name__ == '__main__':
    main()

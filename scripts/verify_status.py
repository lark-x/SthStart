import urllib.request, json, sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')

# Test Linshe Endpoints
req = urllib.request.Request('http://127.0.0.1:3098/api/characters')
with urllib.request.urlopen(req) as resp:
    chars = json.loads(resp.read().decode())['characters']
    furina = next((c for c in chars if c['id'] == 5), None)
    print('Linshe Furina char record:')
    print('  id:', furina.get('id'), 'name:', furina.get('name'))
    print('  avatar_path:', furina.get('avatar_path'))
    print('  standing_url:', furina.get('standing_url'))
    print('  loras:', furina.get('loras'))

for test_url in [
    'http://127.0.0.1:3098/avatars/furina_avatar.png',
    'http://127.0.0.1:3098/images/standing/furina_standing.png',
    'http://127.0.0.1:3098/images/events/furina_scene_opera_cg.png'
]:
    with urllib.request.urlopen(test_url) as r:
        print(test_url, '-> HTTP', r.status, len(r.read()), 'bytes')

# Test SthStart DB
conn = sqlite3.connect('data/sthstart.db')
c = conn.cursor()
c.execute('SELECT id, display_name, avatar_asset_id, portrait_asset_id FROM character_profiles WHERE id = ?', ('5c9ec187-d71c-4c68-88a2-f76988c47cbb',))
print('\nSthStart Furina profile:', c.fetchone())

c.execute('SELECT id, kind, category, title, artifact_id FROM character_assets WHERE character_id = ?', ('5c9ec187-d71c-4c68-88a2-f76988c47cbb',))
print('\nSthStart Furina character assets:')
for r in c.fetchall():
    print(' ', r)

c.execute('SELECT id, title, category, artifact_id FROM shared_assets')
print('\nSthStart shared assets:')
for r in c.fetchall():
    print(' ', r)

c.execute("SELECT * FROM app_character_links WHERE app_id = 'linshe'")
print('\nApp character links:')
for r in c.fetchall():
    print(' ', r)

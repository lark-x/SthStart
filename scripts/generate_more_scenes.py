import urllib.request, json, time, os, base64

scenes = [
    {
        'filename': 'data/furina_scene_teatime_cg.png',
        'width': 1216, 'height': 832,
        'title': '枫丹廷露天午后红茶与甜点',
        'prompt': '@DOM, 1girl, furina (genshin impact), solo, masterpiece, best quality, year 2025, cinematic lighting, sitting at an elegant outdoor café table in Court of Fontaine, enjoying afternoon tea, delicate porcelain tea cup in hand, exquisite strawberry cake on plate, gentle relaxed smile, warm golden afternoon sunlight, cobblestone street, fountain in background, gorgeous anime scene',
        'is_character': True
    },
    {
        'filename': 'data/scene_palais_mermonia_bg.png',
        'width': 1280, 'height': 720,
        'title': '纯场景·沫芒宫欧式华贵内厅',
        'prompt': 'scenery, no humans, visual novel background, wide shot, masterpiece, best quality, year 2025, interior of grand Palais Mermonia in Fontaine, high arched French windows, soft afternoon golden sunlight pouring in, polished marble floors, classical blue and gold baroque decorations, bookshelves, grand chandelier, plush velvet sofa, pristine elegant atmosphere',
        'is_character': False
    }
]

for i, s in enumerate(scenes, 1):
    fname = s['filename']
    print(f'[{i}/{len(scenes)}] Generating {s["title"]} -> {fname}...')
    payload = {
        'prompt': s['prompt'],
        'alreadyPrepared': True,
        'width': s['width'],
        'height': s['height'],
        'artist': '@ebora' if s['is_character'] else '',
        'mode': 'events'
    }
    data = json.dumps(payload).encode()
    t0 = time.time()
    req = urllib.request.Request('http://127.0.0.1:3098/api/images/test-style', data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as resp:
        res = json.loads(resp.read().decode())
        print(f'  Done in {round(time.time() - t0, 1)}s, success: {res.get("success")}')
        if res.get('images'):
            b64 = res['images'][0]['base64']
            if ',' in b64:
                b64 = b64.split(',', 1)[1]
            raw = base64.b64decode(b64)
            with open(fname, 'wb') as f:
                f.write(raw)
            print(f'  Saved to {fname} ({len(raw)} bytes)')

print('All scene generations completed!')

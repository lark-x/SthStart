import urllib.request, json, time, os, base64

tasks = [
    {
        'filename': 'data/furina_expression_happy.png',
        'width': 768, 'height': 1152,
        'prompt': '@DOM, 1girl, solo, furina (genshin impact), masterpiece, best quality, year 2025, upper body, close-up, gradient hair, light blue streaks in hair, silver white hair, ahoge, blue eyes, heterochromia, star-shaped pupils, gentle smile, closed eyes happy, graceful head tilt, blue top hat, white feather ornament, court dress, soft lighting'
    },
    {
        'filename': 'data/furina_expression_smug.png',
        'width': 768, 'height': 1152,
        'prompt': '@DOM, 1girl, solo, furina (genshin impact), masterpiece, best quality, year 2025, upper body, close-up, gradient hair, light blue streaks in hair, silver white hair, ahoge, blue eyes, heterochromia, star-shaped pupils, smug expression, theatrical grin, hand on hip, confident gesture, blue top hat, white feather ornament, court dress'
    },
    {
        'filename': 'data/furina_expression_surprised.png',
        'width': 768, 'height': 1152,
        'prompt': '@DOM, 1girl, solo, furina (genshin impact), masterpiece, best quality, year 2025, upper body, close-up, gradient hair, light blue streaks in hair, silver white hair, ahoge, blue eyes, heterochromia, star-shaped pupils, wide eyes, blushing, flustered expression, slightly opened mouth, comical distress, dramatic, blue top hat, court dress'
    },
    {
        'filename': 'data/furina_scene_opera_cg.png',
        'width': 1216, 'height': 832,
        'prompt': '@DOM, 1girl, solo, furina (genshin impact), masterpiece, best quality, year 2025, cinematic lighting, dramatic performance on the stage of Opera Epiclese, grand opera house interior, massive golden chandeliers, luxurious blue velvet curtains, magical floating water droplets, spotlight shining on her, theatrical bowing pose, Fontaine architecture, epic anime visual'
    }
]

for i, t in enumerate(tasks, 1):
    fname = t['filename']
    payload = {
        'prompt': t['prompt'],
        'alreadyPrepared': True,
        'width': t['width'],
        'height': t['height'],
        'artist': '@ebora',
        'mode': 'portrait' if 'expression' in fname else 'events'
    }
    data = json.dumps(payload).encode()
    print(f'[{i}/{len(tasks)}] Generating {fname}...')
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

print('All tasks completed!')

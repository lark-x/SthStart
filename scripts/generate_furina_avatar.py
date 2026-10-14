import urllib.request, json, time, base64

payload = {
    'prompt': '@DOM, 1girl, solo, furina (genshin impact), masterpiece, best quality, year 2025, profile picture, square avatar, face focus, headshot, gradient hair, light blue streaks in hair, silver white hair, ahoge, blue eyes, heterochromia, star-shaped pupils, gentle regal smile, blue top hat with feather, elegant lighting, simple clean background',
    'alreadyPrepared': True,
    'width': 768,
    'height': 768,
    'artist': '@ebora',
    'mode': 'portrait'
}
data = json.dumps(payload).encode()
print('Generating furina_avatar.png...')
t0 = time.time()
req = urllib.request.Request('http://127.0.0.1:3098/api/images/test-style', data=data, headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=180) as resp:
    res = json.loads(resp.read().decode())
    print('Done in ' + str(round(time.time() - t0, 1)) + 's, success: ' + str(res.get('success')))
    if res.get('images'):
        b64 = res['images'][0]['base64']
        if ',' in b64:
            b64 = b64.split(',', 1)[1]
        raw = base64.b64decode(b64)
        with open('data/furina_avatar.png', 'wb') as f:
            f.write(raw)
        print('Saved to data/furina_avatar.png (' + str(len(raw)) + ' bytes)')

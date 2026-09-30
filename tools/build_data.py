# Packs star catalog, constellations and textures into JS files so the page
# works from file:// (WebGL refuses cross-origin textures there) and as an artifact.
import json, base64, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'tex_src')
out = os.path.join(root, 'assets')

stars = json.load(open(os.path.join(src, 'stars.6.json')))['features']
flat = []
for s in stars:
    ra, dec = s['geometry']['coordinates']
    ra = ra % 360
    try: bv = float(s['properties'].get('bv') or 0.6)
    except ValueError: bv = 0.6
    flat += [round(ra, 3), round(dec, 3), s['properties']['mag'], round(bv, 2)]

lines = json.load(open(os.path.join(src, 'const.lines.json')))['features']
segs = []
for f in lines:
    for poly in f['geometry']['coordinates']:
        for a, b in zip(poly, poly[1:]):
            segs += [round(a[0] % 360, 2), round(a[1], 2), round(b[0] % 360, 2), round(b[1], 2)]

names = []
for f in json.load(open(os.path.join(src, 'const.json')))['features']:
    p = f['properties']
    if int(p.get('rank', 3)) <= 2:
        names.append([p['zh'], p['en'], round(p['display'][0] % 360, 1), round(p['display'][1], 1)])

with open(os.path.join(out, 'sky.js'), 'w') as fh:
    fh.write('// Star catalog (mag<=6) and constellations from d3-celestial, BSD-3 (c) Olaf Frohn\n')
    fh.write('window.SKY={stars:%s,lines:%s,names:%s};\n' % (
        json.dumps(flat, separators=(',', ':')),
        json.dumps(segs, separators=(',', ':')),
        json.dumps(names, ensure_ascii=False, separators=(',', ':'))))

tex = {}
for fn in sorted(os.listdir(out)):
    if fn.endswith(('.jpg', '.png')):
        mime = 'image/png' if fn.endswith('.png') else 'image/jpeg'
        tex[fn.rsplit('.', 1)[0]] = 'data:%s;base64,%s' % (mime, base64.b64encode(open(os.path.join(out, fn), 'rb').read()).decode())
with open(os.path.join(out, 'textures.js'), 'w') as fh:
    fh.write('// Planet textures: Solar System Scope, CC BY 4.0 (solarsystemscope.com)\n')
    fh.write('window.TEX=%s;\n' % json.dumps(tex))
print('stars', len(flat)//4, 'segs', len(segs)//4, 'names', len(names), 'textures', list(tex))

# Builds assets/moon.jpg and assets/moon_normal.jpg from NASA's CGI Moon Kit
# (https://svs.gsfc.nasa.gov/4720, public domain): the LROC colour mosaic and the LOLA
# elevation model. Downloads go to tex_src/.cache/ (git-ignored). Run tools/build_data.py
# afterwards to repack assets/textures.js.
#
# Normal map: tangent space in the body's east/north/up frame, RGB = (east, north, up) * 0.5 + 0.5.
import os, sys, urllib.request
import numpy as np
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cache = os.path.join(root, 'tex_src', '.cache')
out = os.path.join(root, 'assets')
BASE = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/'
W, H = 4096, 2048
R = 1737400.0   # m
RELIEF = 1.5    # slope exaggeration: at ~2.7 km per texel real slopes are averaged down

def fetch(name):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        print('downloading', name)
        urllib.request.urlretrieve(BASE + name, path)
    return path

# Colour
col = Image.open(fetch('lroc_color_16bit_srgb_4k.tif')).convert('RGB')
if col.size != (W, H): col = col.resize((W, H), Image.LANCZOS)
# LROC is normalised brighter than the map it replaces; keep the Moon's overall brightness
c = np.asarray(col, dtype=np.float32)
col = Image.fromarray(np.clip(c * (150.0 / c.mean()), 0, 255).astype(np.uint8))
col.save(os.path.join(out, 'moon.jpg'), quality=86, optimize=True, progressive=True)

# Elevation: uint16 half-metres relative to 1727.4 km; only differences matter here
dem = Image.open(fetch('ldem_16_uint.tif'))
h = np.asarray(dem, dtype=np.float32) * 0.5
h = np.asarray(Image.fromarray(h, 'F').resize((W, H), Image.BOX), dtype=np.float64)

lat = np.radians(90 - (np.arange(H) + 0.5) * 180 / H)[:, None]
dx = R * np.maximum(np.cos(lat), 0.01) * (2 * np.pi / W)   # metres per texel, eastward
dy = R * (np.pi / H)                                        # metres per texel, northward
ge = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * dx)      # dh/d(east), wraps in longitude
gn = np.zeros_like(h)                                       # dh/d(north); row 0 is north
gn[1:-1] = (h[:-2] - h[2:]) / (2 * dy)
ge, gn = np.clip(ge * RELIEF, -3, 3), np.clip(gn * RELIEF, -3, 3)
n = np.stack([-ge, -gn, np.ones_like(h)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(np.round((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(
    os.path.join(out, 'moon_normal.jpg'), quality=88, optimize=True, progressive=True)

slope = np.degrees(np.arctan(np.hypot(ge, gn) / RELIEF))
print('slopes (deg) p50 %.1f p90 %.1f p99 %.1f' % tuple(np.percentile(slope, [50, 90, 99])))
for f in ('moon.jpg', 'moon_normal.jpg'):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')

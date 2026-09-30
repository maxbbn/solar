# Produces the artifact page: index.html minus the document wrapper (the host adds its own).
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
for pat in [r'<!doctype html>\s*', r'<html[^>]*>\s*', r'</html>\s*', r'<head>\s*', r'</head>\s*', r'<body[^>]*>\s*', r'</body>\s*',
            r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*']:
    s = re.sub(pat, '', s, flags=re.I)
s = s.replace('<canvas id="scene"', '<script>document.body.dataset.sheet="none"</script>\n<canvas id="scene"', 1)
open(dst, 'w').write(s)

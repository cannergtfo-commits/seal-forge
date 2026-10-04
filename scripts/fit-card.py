import sys
from PIL import Image

def fit(src, dest):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    target = 5 / 7
    if w / h > target:
        nw = int(h * target)
        left = max(0, (w - nw) // 2)
        im = im.crop((left, 0, left + nw, h))
    else:
        nh = int(w / target)
        top = max(0, int((h - nh) * 0.12))
        if top + nh > h:
            top = h - nh
        im = im.crop((0, top, w, top + nh))
    im = im.resize((700, 980), Image.Resampling.LANCZOS)
    im.save(dest, "JPEG", quality=86, optimize=True)

if __name__ == "__main__":
    fit(sys.argv[1], sys.argv[2])

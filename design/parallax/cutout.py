"""Cut the parallax landscape layers out of their painted/white/checkerboard backgrounds.

Writes WebP (with alpha) into frontend/src/assets/parallax and a magenta preview sheet.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
PREVIEW = Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)


def load(name):
    return np.asarray(Image.open(SRC / name).convert("RGB")).astype(np.float32)


def channels(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    chroma = a.max(axis=2) - a.min(axis=2)
    return r, g, b, luma, chroma


def alpha_from_mask(mask, soft=None, run=8, up=28, band=10):
    """Per column: the land starts where the mask is solid for `run` pixels. Above that, keep only
    mask pixels within `up` px (grass blades, snow wisps); below `band` px it is fully opaque."""
    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3)))
    h, w = mask.shape
    solid = ndimage.uniform_filter1d(mask.astype(np.float32), size=run, axis=0, origin=-(run // 2)) > 0.85
    # Keep only the landmass that reaches the bottom edge: stray sky blobs, cloud rims and
    # checkerboard seams are never connected to it.
    labels, _ = ndimage.label(solid)
    bottom = labels[-1][labels[-1] > 0]
    if bottom.size:
        keep = np.bincount(bottom).argmax()
        solid = labels == keep
    has = solid.any(axis=0)
    top = np.where(has, solid.argmax(axis=0), h)
    # tame single-column spikes so the silhouette stays smooth
    smooth = ndimage.median_filter(top, size=15)
    top = np.where(np.abs(top - smooth) > 18, smooth, top)
    top = ndimage.median_filter(top, size=5)
    mask = mask & (labels > 0) if False else mask
    rows = np.arange(h)[:, None]
    detail = soft if soft is not None else mask.astype(np.float32)
    detail = ndimage.gaussian_filter(detail, 0.8)
    alpha = np.where(rows >= top[None, :] + band, 1.0, 0.0)
    near = (rows >= top[None, :] - up) & (rows < top[None, :] + band)
    alpha = np.where(near, np.clip(detail * 1.15, 0, 1), alpha)
    # everything below the solid line is land
    alpha = np.where(rows >= top[None, :] + band, 1.0, alpha)
    return np.clip(ndimage.gaussian_filter(alpha, 0.6), 0, 1)


def save(a, alpha, name):
    rgba = np.dstack([np.clip(a, 0, 255), alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    img.save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
    return img


def grade(a, alpha, stops):
    """Gradient-map an image's luminance onto a palette (used to make night versions)."""
    _, _, _, luma, _ = channels(a)
    land = alpha > 0.5
    lo, hi = np.percentile(luma[land], 2), np.percentile(luma[land], 98)
    t = np.clip((luma - lo) / max(hi - lo, 1), 0, 1)
    xs = np.array([s[0] for s in stops])
    out = np.zeros_like(a)
    for c in range(3):
        out[..., c] = np.interp(t, xs, np.array([s[1][c] for s in stops]))
    return out


results = {}

# ── Front hill, day (painted pale sky + faint distant hills on the sides) ──
a = load("8.jpg")
r, g, b, luma, chroma = channels(a)
dark_land = (luma < 140) & ((g - b) > 12)
bright_land = (luma >= 140) & (chroma > 48) & ((g - b) > 0)
mask = dark_land | bright_land
results["front-day"] = save(a, alpha_from_mask(mask), "front-day")

# ── Front hill, night ──
# The painted night sky is too close to the moonlit crest to cut out cleanly, so the night hill is
# the clean day silhouette recoloured with colours sampled from the night painting, plus a silver
# moonlit rim along the crest.
day_front = np.asarray(results["front-day"]).astype(np.float32)
fa = day_front[..., 3] / 255
night = grade(day_front[..., :3], fa, [(0, (16, 31, 34)), (0.35, (38, 66, 69)), (0.7, (64, 99, 104)), (0.9, (104, 140, 148)), (1, (168, 196, 208))])
inside = fa > 0.5
depth = ndimage.distance_transform_edt(inside)            # px below the silhouette edge
rim = np.clip(1 - depth / 16, 0, 1) ** 1.6 * inside
night = night * (1 - rim[..., None] * 0.65) + np.array([178, 206, 216]) * rim[..., None] * 0.65
results["front-night"] = save(night, fa, "front-night")

# ── Mid hills (white background) ──
a = load("10.jpg")
r, g, b, luma, chroma = channels(a)
dist = 255 - a.min(axis=2)
mask = dist > 22
soft = np.clip((dist - 10) / 45, 0, 1)
alpha = alpha_from_mask(mask, soft=soft, up=10, band=6)
# lift the white halo out of the soft edge
unpremult = np.where(alpha[..., None] > 0.02, (a - (1 - alpha[..., None]) * 255) / np.maximum(alpha[..., None], 0.02), a)
mid = np.clip(np.where(alpha[..., None] < 0.999, unpremult, a), 0, 255)
results["mid-day"] = save(mid, alpha, "mid-day")
mid_night = grade(mid, alpha, [(0, (18, 34, 40)), (0.45, (40, 72, 76)), (0.8, (70, 108, 112)), (1, (112, 146, 152))])
results["mid-night"] = save(mid_night, alpha, "mid-night")

# ── Far mountain (fake checkerboard: perfectly neutral greys; snow is slightly blue) ──
a = load("11.jpg")
r, g, b, luma, chroma = channels(a)
mask = (chroma > 4.5) | (luma < 200)
far_alpha = alpha_from_mask(mask, up=8, band=6)
results["far-day"] = save(a, far_alpha, "far-day")
far_night = grade(a, far_alpha, [(0, (28, 40, 58)), (0.5, (62, 82, 108)), (0.85, (118, 142, 170)), (1, (176, 196, 218))])
results["far-night"] = save(far_night, far_alpha, "far-night")

# ── Trim the faint distant-hill sliver at the far left of both front hills ──
# Continue the slope seen at x = 40..120 out to the edge and clear anything above it.
for name in ["front-day", "front-night"]:
    im = np.array(results[name])
    a = im[..., 3]
    xs = np.arange(40, 121)
    tops = np.array([np.argmax(a[:, x] > 200) for x in xs])
    k, b0 = np.polyfit(xs, tops, 1)
    for x in range(0, 40):
        a[: max(int(round(k * x + b0)) - 2, 0), x] = 0
    im[..., 3] = a
    results[name] = Image.fromarray(im, "RGBA")
    results[name].save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)

# ── Preview sheet: every layer over magenta so leftovers show up ──
tiles = []
for name in ["far-day", "mid-day", "front-day", "far-night", "mid-night", "front-night"]:
    img = results[name]
    bg = Image.new("RGBA", img.size, (255, 0, 255, 255))
    bg.alpha_composite(img)
    tiles.append(bg.convert("RGB").resize((800, int(800 * img.height / img.width))))
sheet = Image.new("RGB", (1600, sum(t.height for t in tiles[::2]) + 20), (40, 40, 40))
y = 0
for i in range(0, 6, 2):
    sheet.paste(tiles[i], (0, y))
    sheet.paste(tiles[i + 1], (800, y))
    y += max(tiles[i].height, tiles[i + 1].height)
# reorder: day column left, night right
sheet.save(PREVIEW)
for f in sorted(OUT.glob("*.webp")):
    print(f.name, Image.open(f).size, f.stat().st_size // 1024, "KB")

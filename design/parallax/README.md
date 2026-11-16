# Landing hero parallax artwork

Source paintings for the landing page hero layers and the script that turns them into the
transparent WebP layers in `frontend/src/assets/parallax/`.

| Source | Becomes |
|---|---|
| `far-day-source.jpg` (fake checkerboard background) | `far-day.webp`, `far-night.webp` (recoloured) |
| `mid-day-source.jpg` (white background) | `mid-day.webp`, `mid-night.webp` (recoloured) |
| `front-day-source.jpg` (painted sky) | `front-day.webp`, and `front-night.webp` (recoloured, with a moonlit rim) |
| `front-night-source.jpg` | Reference for the night palette only: its sky is too close to the moonlit crest to cut out cleanly. |

Regenerate (needs Pillow, numpy and scipy). The script reads the sources by their original
upload names, so copy them to a folder as `8.jpg` (front day), `9.jpg` (front night),
`10.jpg` (mid) and `11.jpg` (far) first:

```bash
python design/parallax/cutout.py <folder-with-8-to-11.jpg> frontend/src/assets/parallax preview.png
```

It also writes `preview.png`: every layer over magenta, so any leftover background stands out.

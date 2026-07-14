# Planet shots

Per-era captures of the planet dial (issue #10), embedded in the root
README. Committed so the README works without a build.

Regenerate the PNGs against a running build:

```sh
npm --prefix app run build
npm --prefix app run preview &   # serves http://localhost:4173
npm --prefix app run shots       # writes docs/shots/era-<n>-<id>.png
```

`SHOTS_BASE` overrides the URL; `CHROME_PATH` points at a bare Chromium
binary for machines without a system Chrome (same as the acceptance walk).

`eras.gif` cycles the seven PNGs (2× downsampled, ~1.3 s per frame,
looping). Any GIF-capable ffmpeg rebuilds it:

```sh
cd docs/shots
ffmpeg -y -framerate 0.77 -pattern_type glob -i 'era-*.png' \
  -vf "scale=336:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" \
  -loop 0 eras.gif
```

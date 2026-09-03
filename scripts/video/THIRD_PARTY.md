# Third party work in the video pipeline

Everything here is MIT. Where a file is vendored the licence sits next to it;
where an idea or an algorithm was ported, the port is marked in the source with
the project it came from. This file is the index.

## Vendored

### screenstudio-alt, `src/polish.py`
- github.com/connerward/screenstudio-alt, MIT, Copyright (c) 2026 Conner K Ward
- Vendored whole as `scripts/video/polish/polish.py` at commit
  `61a0b303ce3a73d103398fee7ecb5fa31f8a0994`, licence at `scripts/video/polish/LICENSE`.
- Local changes are listed in that file's own header and marked `# nema:` at each
  site: shared pointer art, `--cursor-scale`, `--zoom-cap`, element boxes kept
  across the retime, `--emit-meta`.
- **Also used as a library**: `zoom_regions` is the anchor source for the studio
  camera (`scripts/video/polish-anchors.py`). Its click clustering and its
  element aware framing, which sizes the push to the clicked element's box
  rather than to a point, are better than the per click anchors we had.

### cursor.in, pointer art
- github.com/sawyerh/cursor.in, MIT
- `scripts/video/assets/cursor-arrow.svg` is its `assets/cursor.svg`,
  `scripts/video/assets/cursor-hand.svg` is its `assets/pointinghand.svg`.
  Attribution is in each file. Hotspots were measured by rasterising, not
  guessed: the arrow's tip at (8.2, 4.9), the hand's index fingertip at
  (12.4, 8.0).
- cursor.in ships no text pointer, so the I beam in `scripts/video/cursors.py`
  is drawn here, in the same proportions.

## Ported

### ghost-cursor
- github.com/Xetera/ghost-cursor, MIT. Used as a dependency for `path()`, which
  gives the Bezier shape, the Fitts's law timing and the overshoot near the
  target.
- Ported in addition: its habit of aiming at a **random point inside the
  target's padded box** rather than dead centre, from `getRandomBoxPoint` and
  the `paddingPercentage` option. `scripts/video/recorder.mjs`, in `point()`.
  Two clicks on the same button no longer land on the same pixel.

### playwright-recast
- github.com/ThePatriczek/playwright-recast, MIT, Copyright (c) 2026 Patrik
  Szewczyk. Read from the published package, version 0.21.0.
- **Subtitle chunking by punctuation**, from `dist/subtitles/subtitle-chunker.js`:
  split on sentence ends, then on clause punctuation, then at word boundaries,
  merge fragments shorter than a floor back into their neighbour, and share the
  span out by character count. Ported into `scripts/video/captions.mjs` and used
  by both compositors. Better than what we had, which was a single pill however
  long the line.
- **Adaptive speed segments**, from `dist/speed/speed-processor.js` and
  `dist/speed/classifiers.js`: classify each 100 ms of the timeline as user
  action, navigation, network wait or idle, give each its own rate (1.0, 2.0,
  2.0, 4.0), merge neighbours at the same rate and drop segments shorter than
  500 ms. Ported into `scripts/video/speed-plan.mjs`, which emits the same
  segment shape polish's `--emit-meta` already produces, so the remap that
  moves captions and clicks onto the new clock is the one we had.
  This is better than polish's `--speedup`, which finds idle with freezedetect
  and applies one rate to all of it: recast's version never speeds up an action,
  and the minimum segment length stops a take flickering between rates.

### OpenScreen
- github.com/getopenscreen/openscreen, MIT, Copyright (c) 2025 Siddharth Vaddem.
- **Zoom spacing rules**, from `src/lib/ai-edition/timeline/zoom-suggestions.ts`:
  candidates are ranked, kept at least `SUGGESTION_SPACING_MS` apart, and any
  that overlaps a region already accepted is dropped. Ported into the camera
  anchor merge in `scripts/video/studio-ffmpeg.mjs`.
- **Not ported, and why**: its cursor smoothing, in
  `src/lib/cursor/cursorPathSmoothing.ts`, is a spring damper run at 240 Hz over
  a resampled path, not the Catmull-Rom spline this was expected to be. A spring
  is the right answer for a native recording, where the input is a real hand at a
  high sample rate and the trailing inertia reads as weight. Our path is
  synthesised by ghost-cursor and logged at 20 Hz: it carries no tremor to
  remove, and a spring would lag the true position, which the file itself warns
  offsets clicks and dwells. We took its shape instead, precompute once offline
  so preview and export agree, and interpolate with a centripetal Catmull-Rom
  spline, which passes exactly through every logged sample, so the click still
  lands where the log says it did.

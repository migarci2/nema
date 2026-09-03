# Editing the video

Two ways to edit the same project, so a person and an agent can take turns.

## The project file

A cut is a JSON edit list (clips in order, in and out points, stills with a
duration, an optional music bed). `scripts/video/edit.mjs` turns it into a
Shotcut project, a plain MLT XML file, and renders it with `melt`:

```
node scripts/video/edit.mjs docs/video/cut-historical.json                  # writes the mlt
node scripts/video/edit.mjs docs/video/cut-historical.json --render out.mp4 # and renders it
```

Profiles: `atsc_1080p_30` (default) and `uhd_2160p_30` for the 4K masters.

## For a person: Shotcut

Shotcut (MLT, GPL, portable build under `~/Applications/shotcut`, launcher
`shotcut` on the PATH and in the app menu) opens the `.mlt` directly. Trim,
reorder, add a dissolve by overlapping two clips, drop a music track, then
save. The file stays XML, so the next agent pass can read it.

Quick trims and lossless joins without re-encoding: LosslessCut (`losslesscut`),
which writes its own `.llc` project next to the video.

## For an agent: melt

An agent edits the edit list (or the `.mlt` XML itself, Shotcut keeps it readable)
and renders with `melt <project.mlt> -silent -consumer avformat:out.mp4
vcodec=libx264 crf=18 preset=medium pix_fmt=yuv420p acodec=aac ab=192k`.
`melt -query filters` lists the effects available for XML edits (volume,
fade in and out, crop, affine and so on).

## Where the takes come from

`scripts/video/take-*.mjs` record the pages with a real mouse (ghost-cursor
paths, hover, hand pointer), `scripts/video/studio-ffmpeg.mjs` composes each
take into a macOS window on a wallpaper at 4K, and this edit list stitches the
takes with the intro filmed by the team and the closing card.

## OpenScreen

`~/Applications/Openscreen.AppImage` (launcher `openscreen`) is installed as an
alternative editor for screen demos with its own JSON project format and a CLI
export. It records through PipeWire; use it if a take is easier to shoot by
hand than to script.

## The demo film

The screen part of the submission film, everything after the filmed intro, is
built by one script from parts that can each be rebuilt on their own:

```
CHROME=<chrome with WebMCP> node scripts/video/build-film.mjs [--steps a,b,c]
```

Steps, in the order they run: `mograph` (the navy cards), `stock` (the Pexels
cuts, graded), `consent` (the vault's question, pushed), `compose` (the takes
into the macOS window), `finalize` (trim, dip, one encoder setting for every
segment), `cut` (this directory's `cut-historical.json`), `assemble` (screen-1080.mp4 then
screen-4k.mp4) and `sheet` (one frame per chapter).

The parts it builds on:

- `scripts/video/take-film.mjs <chapter>` records the product chapters, clean,
  with an event log: `ch1` the handshake on Saucier School, `ch2` the check and
  the receipt and the vault ledger, `ch3` Line Cook Lab, `ch4b` the AES-GCM
  compare page. It also captures the vault's consent window as a still, because
  the course tab is frozen while that window is up and a film should not sit on
  a frozen tab.
- `scripts/video/take-film-ext.mjs` records the extension chapter: the side
  panel and the page, side by side, in one browser.
- `scripts/video/mograph.mjs <page.html>` renders a motion graphics page frame
  by frame. The page exposes `window.renderAt(seconds)` and draws nothing on a
  timer, so a 4K render is exact however slow the machine is. The pages live in
  `scripts/video/mograph`.
- `scripts/video/stock.mjs` fetches the Pexels clips and writes
  `scripts/video/CREDITS.md`.
- `scripts/video/crop-consent.py`, `pill.py` and `contact-sheet.py` are the
  small pieces: the consent card cropped out of its window, one caption pill
  drawn the way the studio draws it, and the contact sheet.

`docs/video/cut-historical.json` is a readable edit list of the screen part as
it stood before the filmed scenes were cut in. It is history: the finished film
is assembled by `scripts/video/final-cut.py`, which reads the segments on disk
and writes `docs/video/running-order.json` beside the masters as the record of
what was built. Nothing rebuilds from the edit list, so an old line in it cannot
come back. Every clip in it is already trimmed and
dipped, so `scripts/video/edit.mjs` and Shotcut both see a plain sequence of
hard cuts. The on camera slots are in there too: slot A is the filmed intro
and has no clip, C, D and E are placeholder cards carrying the lines the team
says, so the cut plays now and their footage drops straight in. The counted
labels One, Two and Three are drawn on the first clip of each way by
`scripts/video/label.py`, and Carmen's voice over is on the clips it belongs to
and again as one `voiceover` track, with the music ducked 10 dB under it.

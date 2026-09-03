# Editing the video

Two ways to edit the same project, so a person and an agent can take turns.

## The project file

A cut is a JSON edit list (clips in order, in and out points, stills with a
duration, an optional music bed). `scripts/video/edit.mjs` turns it into a
Shotcut project, a plain MLT XML file, and renders it with `melt`:

```
node scripts/video/edit.mjs docs/video/cut.json                  # writes cut.mlt
node scripts/video/edit.mjs docs/video/cut.json --render out.mp4 # and renders it
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

An agent edits `cut.json` (or the `.mlt` XML itself, Shotcut keeps it readable)
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

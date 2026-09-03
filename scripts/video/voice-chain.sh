#!/usr/bin/env bash
# The dialogue chain, one shape for both voices so a cut between them does not
# jump. Measured first, then set: the phone and the voice over already share a
# tonal balance (300 to 500 Hz sits 5.8 dB under the full band on both, 6 to
# 8 kHz sits 22 dB under on both), so there is no corrective boxiness cut and no
# de-esser. What is left is honest repair and a little presence.
#
#   voice-chain.sh <in> <out> <kind: vo|cam> [extra input args]
#
# vo   high pass, gentle de-noise, presence, air, 3:1 compression, loudnorm
# cam  the same minus the de-noise, plus a soft declip and a mono fold, because
#      one phone channel touches full scale and the two are 1.3 dB apart
#
# The de-noiser is on the voice over and off the camera because that is what
# measured better on each. On the voice over it puts the gaps 39.3 dB under the
# speech instead of 36.8 and costs nothing at the top. On the phone it went the
# wrong way, 14.6 dB under instead of 17.8, and pulled 6 to 8 kHz down by
# another 0.9 dB: musical noise in the gaps and a duller voice. The room is
# quiet enough to leave alone.
set -euo pipefail
IN="$1"; OUT="$2"; KIND="${3:-vo}"; shift 3 || true

PRESENCE="equalizer=f=3000:width_type=q:w=1.2:g=2"
AIR="treble=g=1.5:f=8000:width_type=q:w=0.7"
COMP="acompressor=threshold=-22dB:ratio=3:attack=10:release=150:makeup=2"
NORM="loudnorm=I=-18:TP=-3:LRA=7"

if [ "$KIND" = "cam" ]; then
  CHAIN="adeclip,pan=mono|c0=0.5*c0+0.5*c1,highpass=f=80,${PRESENCE},${AIR},${COMP},${NORM},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
else
  CHAIN="highpass=f=80,afftdn=nr=10:nf=-55,${PRESENCE},${AIR},${COMP},${NORM},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
fi

ffmpeg -y -v error "$@" -i "$IN" -vn -af "$CHAIN" -c:a pcm_s16le "$OUT"

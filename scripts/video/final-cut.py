"""The finished film: the filmed scenes, the screen part, the voice over and the bed.

    python3 scripts/video/final-cut.py [--steps camera,video,audio,master,sheet,srt]

The screen segments come from the film builder (scripts/video/build-film.mjs);
this puts the camera scenes in their slots, lays Carmen's voice over on the
beats it belongs to, ducks the bed under every voice, and masters the mix.

Timings are not guessed: each camera scene is trimmed to its own speech with
400 ms of air, found with silencedetect, and every voice line is placed so no
two ever overlap and none runs into a filmed scene.
"""
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
NEMA = os.path.join(REPO, 'nema')
FOOT = os.path.join(REPO, 'nema-footage')
FILM = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad/film'
SEG = os.path.join(FILM, 'segments')
OUT = os.path.join(FILM, 'final')
WORK = os.path.join(OUT, 'work')
CAM = os.path.join(FOOT, 'take-camera-final.mp4')
VOICE_CHAIN = os.path.join(NEMA, 'scripts/video/voice-chain.sh')
os.makedirs(WORK, exist_ok=True)

FPS = 30
ENC4K = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-level', '5.1',
         '-pix_fmt', 'yuv420p', '-r', str(FPS), '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-an']

steps = {'camera', 'video', 'audio', 'master', 'sheet', 'srt'}
if '--steps' in sys.argv:
    steps = set(sys.argv[sys.argv.index('--steps') + 1].split(','))


def run(args, **kw):
    r = subprocess.run(args, **kw)
    if r.returncode != 0:
        raise SystemExit('failed: ' + ' '.join(str(a) for a in args[:6]))


def ff(args):
    run(['ffmpeg', '-y', '-v', 'error', '-nostats'] + args)


def dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip()
    return float(out)


# ---------------------------------------------------------------- the slots --

# Each window is the speech itself, found with silencedetect on the clip's own
# audio, plus 400 ms of air at each end. The owner picked the scenes; the
# trim points are the words.
SLOTS = {
    'A': {'speech': (11.2984, 18.2293), 'lines': [
        ('C', 'Every site you learn from starts from zero.'),
        ('C', 'Nema fixes that. I want to show you three ways I use it.')]},
    'C': {'speech': (47.1121, 52.0377), 'lines': [
        ('C', 'Now a different site. It has never seen the first one.'),
        ('M', 'But it already knows.')]},
    'D': {'speech': (85.4324, 88.2261), 'lines': [
        ('M', 'And which AI is this?'),
        ('C', 'The one you already use.')]},
    'E': {'speech': (276.585, 282.729), 'lines': [
        ('C', "What you learn is yours. Not the sites'. So, that is nema."),
        ('M', 'Please try it. We would love your feedback.')]},
}
AIR = 0.40
for k, v in SLOTS.items():
    a, b = v['speech']
    v['in'] = round(a - AIR, 3)
    v['dur'] = round((b - a) + 2 * AIR, 3)

# The camera is 720p in a 4K frame: scaled up once with lanczos, sharpened a
# little to put back what the scale softened, cooled and darkened a touch so it
# sits next to the navy, and a two percent vignette so the frame has an edge.
# The phone recorded through the front camera and saved the preview, so every
# frame is mirrored: the laptop stickers read backwards, github, java, nginx and
# "In Code We Trust" all reversed. hflip puts the room the right way round.
CAM_VF = ('hflip,'
          'scale=3840:2160:flags=lanczos,'
          'unsharp=5:5:0.55:5:5:0.0,'
          'eq=contrast=1.045:saturation=0.94:brightness=-0.012,'
          'colorbalance=rs=-0.030:bs=0.050:rm=-0.028:bm=0.045:rh=-0.015:bh=0.030,'
          'vignette=angle=PI/9:mode=forward,'
          'setsar=1,format=yuv420p')

if 'camera' in steps:
    for k, v in SLOTS.items():
        vid = os.path.join(WORK, 'cam-%s.mp4' % k)
        ff(['-ss', str(v['in']), '-t', str(v['dur']), '-i', CAM, '-vf', CAM_VF, '-r', str(FPS)] + ENC4K + [vid])
        raw = os.path.join(WORK, 'cam-%s-raw.wav' % k)
        ff(['-ss', str(v['in']), '-t', str(v['dur']), '-i', CAM, '-vn', '-c:a', 'pcm_s16le', raw])
        run(['bash', VOICE_CHAIN, raw, os.path.join(WORK, 'cam-%s.wav' % k), 'cam'])
        print('camera  slot %s  %.3fs' % (k, dur(vid)))

# ------------------------------------------------------------- the voice over --

# Where each line was split out of Carmen's take. vo-06 and vo-07 each hold two
# lines and are cut at the pause between them, found with whisper word times;
# vo-08 opens with a false start and only its second, complete sentence is kept.
VO = [
    ('vo-01', 'vo-01.wav', 0.00, None, 'A cooking course I have never opened. It wants to know three things about me. It asks my nema, not me.'),
    ('vo-02', 'vo-02.wav', 0.00, None, 'I say yes. That is all it gets.'),
    ('vo-03', 'vo-03.wav', 0.00, None, '68 minutes become 27. It skips what I already know.'),
    ('vo-04', 'vo-04.wav', 0.00, None, 'I do one exercise. The course gives me a note that says I passed. That note is mine. I keep it in my nema.'),
    ('vo-05', 'vo-05.wav', 0.00, None, 'A different site. It asks, I say yes, and it already counts what I did before.'),
    ('vo-06a', 'vo-06.wav', 0.00, 3.70, 'Two lessons done before I start. The lab opens.'),
    ('vo-06b', 'vo-06.wav', 4.06, 8.95, 'With the extension it is one click. My notes come home alone.'),
    ('vo-07a', 'vo-07.wav', 0.00, 4.02, 'This is a real article, with questions inside the text.'),
    ('vo-07b', 'vo-07.wav', 4.08, 7.12, 'One tag on the page. That is all.'),
    ('vo-08', 'vo-08.wav', 2.76, 6.36, 'If you teach on the web, you can add this in one minute.'),
]

if 'audio' in steps or 'master' in steps:
    for name, src, a, b in [(n, s, a, b) for n, s, a, b, _ in VO]:
        out = os.path.join(WORK, name + '.wav')
        if not os.path.exists(out):
            cut = os.path.join(WORK, name + '-raw.wav')
            args = ['-ss', str(a)]
            if b is not None:
                args += ['-t', str(round(b - a, 3))]
            ff(args + ['-i', os.path.join(FOOT, 'vo', src), '-c:a', 'pcm_s16le', cut])
            run(['bash', VOICE_CHAIN, cut, out, 'vo'])

# ------------------------------------------------------------------ the order --

ORDER = [
    ('slot-A', 'cam'), ('01-open-a', 'seg'), ('02-open-s1', 'seg'), ('03-open-b', 'seg'),
    ('04-open-s2', 'seg'), ('05-open-c', 'seg'), ('06-open-s3', 'seg'), ('07-title', 'seg'),
    ('09-ch1-ask', 'seg'), ('10-ch1-consent', 'seg'), ('11-ch1-became', 'seg'), ('12-beat', 'seg'),
    ('13-ch2-answer', 'seg'), ('14-ch2-receipt', 'seg'), ('15-ch2-keep', 'seg'), ('16-ch2-ledger', 'seg'),
    ('slot-C', 'cam'), ('18-ch3-ask', 'seg'), ('19-ch3-consent', 'seg'), ('20-ch3-open', 'seg'),
    ('21-ch4-ext', 'seg'), ('22-ch4-toast', 'seg'), ('23-ch4-article', 'seg'),
    ('slot-D', 'cam'), ('25-logos', 'seg'), ('26-twotags', 'seg'),
    ('slot-E', 'cam'), ('28-closing', 'seg'),
]
CHAPTER = {
    'slot-A': 'Filmed intro', '01-open-a': 'Cold open', '07-title': 'Title', '09-ch1-ask': 'Chapter 1',
    '12-beat': 'Beat', '13-ch2-answer': 'Chapter 2', 'slot-C': 'Filmed, slot C', '18-ch3-ask': 'Chapter 3',
    '21-ch4-ext': 'Chapter 4', 'slot-D': 'Filmed, slot D', '25-logos': 'Logos', '26-twotags': 'Two tags',
    'slot-E': 'Filmed, slot E', '28-closing': 'Closing',
}


def clip_path(name, kind):
    return os.path.join(WORK, 'cam-%s.mp4' % name[-1]) if kind == 'cam' else os.path.join(SEG, name + '-4k.mp4')


TL = []
at = 0.0
for name, kind in ORDER:
    p = clip_path(name, kind)
    d = dur(p)
    TL.append({'name': name, 'kind': kind, 'path': p, 'at': at, 'dur': d})
    at += d
TOTAL = at
start = {c['name']: c['at'] for c in TL}
length = {c['name']: c['dur'] for c in TL}

# Where each voice line starts. Chosen against the picture, never overlapping
# another line and never running into a filmed scene.
PLACE = {
    'vo-01': start['09-ch1-ask'] + 0.34,
    'vo-02': start['10-ch1-consent'] + 1.74,
    'vo-03': start['11-ch1-became'] + 1.44,
    'vo-04': start['13-ch2-answer'] + 0.44,
    'vo-05': start['18-ch3-ask'] + 0.32,
    'vo-06a': start['20-ch3-open'] + 1.12,
    'vo-06b': start['21-ch4-ext'] + 0.42,
    'vo-07a': start['23-ch4-article'] + 0.42,
    'vo-07b': start['26-twotags'] + 0.35,
    'vo-08': start['26-twotags'] + 3.72,
}

if 'video' in steps:
    lst = os.path.join(WORK, 'video.txt')
    with open(lst, 'w') as fh:
        for c in TL:
            fh.write("file '%s'\n" % c['path'])
    ff(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', os.path.join(WORK, 'video.mp4')])
    print('video   %.2fs, %d clips' % (dur(os.path.join(WORK, 'video.mp4')), len(TL)))

# --------------------------------------------------------------------- audio --

DUCK_DB = -10.0
BASE_DB = -18.0
RAMP = 0.30


def kf_expr(kfs):
    """Nested if() over linear pieces: the ffmpeg form of a keyframed fader."""
    out = '%.5f' % kfs[-1][1]
    for i in range(len(kfs) - 1, 0, -1):
        ta, a = kfs[i - 1]
        tb, b = kfs[i]
        if abs(b - a) < 1e-7 or tb - ta < 1e-6:
            piece = '%.5f' % b
        else:
            piece = '(%.5f+(%.5f)*(t-%.4f)/%.4f)' % (a, b - a, ta, tb - ta)
        out = 'if(lt(t,%.4f),%s,%s)' % (tb, piece, out)
    return 'if(lt(t,%.4f),%.5f,%s)' % (kfs[0][0], kfs[0][1], out)


if 'audio' in steps:
    voice_windows = []
    for name, src, a, b, _ in VO:
        t0 = PLACE[name]
        voice_windows.append((t0, t0 + dur(os.path.join(WORK, name + '.wav'))))
    cam_windows = [(start['slot-' + k], start['slot-' + k] + length['slot-' + k]) for k in 'ACDE']
    ducks = sorted(voice_windows + cam_windows)

    # no two voice lines may overlap: assert it rather than trust it
    vs = sorted(voice_windows)
    for i in range(1, len(vs)):
        assert vs[i][0] >= vs[i - 1][1] - 1e-6, 'voice lines overlap: %s' % str((vs[i - 1], vs[i]))
    for (a, b) in vs:
        for (ca, cb) in cam_windows:
            assert b <= ca + 1e-6 or a >= cb - 1e-6, 'a voice line runs into a filmed scene'

    # The bed was asked to come in under the title card. It comes in one cut
    # earlier, on the first frame of the cold open, because the filmed intro
    # ends there and the three stock cuts that follow it were left in total
    # silence: three and a half seconds of nothing, which reads as a fault
    # rather than a rest. To put it back under the title, this is the only line
    # to change: start['07-title'].
    music_in = start['01-open-a']
    lin = lambda db: 10 ** (db / 20.0)
    kfs = [(0.0, 0.0), (music_in, 0.0), (music_in + 1.0, lin(BASE_DB))]
    for a, b in ducks:
        a = max(a, music_in + 1.0)
        b = max(b, a)
        kfs += [(a - RAMP, lin(BASE_DB)), (a, lin(BASE_DB + DUCK_DB)),
                (b, lin(BASE_DB + DUCK_DB)), (b + RAMP, lin(BASE_DB))]
    kfs += [(TOTAL - 2.0, lin(BASE_DB)), (TOTAL, 0.0)]
    kfs = [k for k in sorted(kfs) if k[0] >= 0]
    dedup = []
    for k in kfs:
        if dedup and abs(k[0] - dedup[-1][0]) < 1e-4:
            dedup[-1] = k
        else:
            dedup.append(k)

    inputs, fc, mixes = [], [], []
    inputs += ['-i', os.path.join(FOOT, 'music-banjos-unite.mp3')]
    fc.append("[0:a]atrim=0:%.3f,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
              "volume=eval=frame:volume='%s'[music]" % (TOTAL, kf_expr(dedup)))
    mixes.append('[music]')
    idx = 1
    for name, *_ in [(n,) for n, s, a, b, t in VO]:
        p = os.path.join(WORK, name + '.wav')
        inputs += ['-i', p]
        fc.append('[%d:a]adelay=%d|%d,apad[v%d]' % (idx, round(PLACE[name] * 1000), round(PLACE[name] * 1000), idx))
        mixes.append('[v%d]' % idx)
        idx += 1
    for k in 'ACDE':
        p = os.path.join(WORK, 'cam-%s.wav' % k)
        t0 = start['slot-' + k]
        inputs += ['-i', p]
        fc.append('[%d:a]adelay=%d|%d,apad[c%d]' % (idx, round(t0 * 1000), round(t0 * 1000), idx))
        mixes.append('[c%d]' % idx)
        idx += 1
    fc.append('%samix=inputs=%d:duration=first:normalize=0,atrim=0:%.3f[mix]' % (''.join(mixes), len(mixes), TOTAL))
    ff(inputs + ['-filter_complex', ';'.join(fc), '-map', '[mix]', '-c:a', 'pcm_s24le',
                 os.path.join(WORK, 'mix.wav')])
    print('audio   %.2fs, %d voice lines, %d filmed scenes' % (dur(os.path.join(WORK, 'mix.wav')), len(VO), 4))

if 'master' in steps:
    # Two passes, because one is an estimate: the first measures the mix, the
    # second normalises against those numbers, and a limiter behind it holds the
    # true peak where it was asked for rather than near it.
    mix = os.path.join(WORK, 'mix.wav')
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', mix,
                            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
                            '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
    print('measure I %s TP %s LRA %s thresh %s' % (m['input_i'], m['input_tp'], m['input_lra'], m['input_thresh']))
    ff(['-i', mix, '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:'
        'offset=%s:linear=true:print_format=summary,alimiter=limit=-1.5dB:level=disabled'
        % (m['input_i'], m['input_tp'], m['input_lra'], m['input_thresh'], m['target_offset']),
        '-c:a', 'pcm_s24le', os.path.join(WORK, 'mix-norm.wav')])
    for tag, vf, crf, extra in [('final-4k', None, '16', ['-preset', 'slow']),
                                ('final-1080', 'scale=1920:1080:flags=lanczos', '18', ['-preset', 'medium'])]:
        args = ['-i', os.path.join(WORK, 'video.mp4'), '-i', os.path.join(WORK, 'mix-norm.wav')]
        if vf:
            args += ['-vf', vf, '-c:v', 'libx264', '-crf', crf] + extra + ['-pix_fmt', 'yuv420p', '-profile:v', 'high']
        else:
            args += ['-c:v', 'copy']
        args += ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart',
                 '-shortest', os.path.join(OUT, tag + '.mp4')]
        ff(args)
        print('master  %s  %.2fs' % (tag, dur(os.path.join(OUT, tag + '.mp4'))))

if 'srt' in steps:
    cues = []
    for name, src, a, b, text in VO:
        t0 = PLACE[name]
        cues.append((t0, t0 + dur(os.path.join(WORK, name + '.wav')), text))
    for k in 'ACDE':
        t0 = start['slot-' + k]
        d = length['slot-' + k]
        lines = SLOTS[k]['lines']
        span = (d - 2 * AIR) / len(lines)
        for i, (who, text) in enumerate(lines):
            cues.append((t0 + AIR + i * span, t0 + AIR + (i + 1) * span, text))
    cues.sort()
    def ts(x):
        h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
        return '%02d:%02d:%06.3f' % (h, m, s).replace('.', ',') if False else '%02d:%02d:%02d,%03d' % (h, m, int(s), round((s - int(s)) * 1000))
    with open(os.path.join(OUT, 'final.srt'), 'w') as fh:
        for i, (a, b, t) in enumerate(cues, 1):
            fh.write('%d\n%s --> %s\n%s\n\n' % (i, ts(a), ts(b), t))
    print('srt     %d cues' % len(cues))

if 'sheet' in steps:
    master = os.path.join(OUT, 'final-1080.mp4')
    shots = []
    for c in TL:
        if c['name'] in CHAPTER:
            at_ = c['at'] + min(c['dur'] * 0.55, c['dur'] - 0.15)
            f = os.path.join(WORK, 'sheet-%02d.png' % len(shots))
            ff(['-ss', '%.3f' % at_, '-i', master, '-frames:v', '1', f])
            shots.append({'label': CHAPTER[c['name']], 'at': at_, 'file': f})
    spec = {'out': os.path.join(OUT, 'contact-sheet.png'), 'cols': 4, 'cell': 640, 'shots': shots}
    with open(os.path.join(WORK, 'sheet.json'), 'w') as fh:
        json.dump(spec, fh)
    run(['python3', os.path.join(NEMA, 'scripts/video/contact-sheet.py'), os.path.join(WORK, 'sheet.json')])

with open(os.path.join(OUT, 'running-order.json'), 'w') as fh:
    json.dump({'total': TOTAL, 'clips': TL,
               'voice': [{'name': n, 'at': PLACE[n], 'text': t} for n, s, a, b, t in VO],
               'slots': {k: {'in': v['in'], 'dur': v['dur'], 'lines': v['lines']} for k, v in SLOTS.items()}},
              fh, indent=2)
print('total   %.2fs' % TOTAL)

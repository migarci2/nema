// Adaptive speed segments: a take runs at its own pace where something is
// happening and skips ahead where nothing is.
//
// Ported from playwright-recast (github.com/ThePatriczek/playwright-recast, MIT,
// Copyright (c) 2026 Patrik Szewczyk), dist/speed/speed-processor.js and
// dist/speed/classifiers.js: sample the timeline every 100 ms, classify each
// sample, give each class its own rate, merge neighbours at the same rate and
// fold away anything shorter than a floor. See scripts/video/THIRD_PARTY.md.
//
// What changes for us: recast classifies from a Playwright trace, we classify
// from our own event log, and a caption on screen counts as an action because
// these films are paced by their captions and nobody can read one at four times
// speed. That is the one rule we added.
//
// Better than polish's --speedup, which finds still spans with freezedetect and
// gives all of them one rate: this never speeds up an action, and the minimum
// segment length stops the film flickering between rates.

const DEFAULTS = {
  duringAction: 1.0,
  duringWait: 2.0,
  duringIdle: 4.0,
  minSegmentMs: 500,
  sampleMs: 100,
  actionPadMs: 350      // an action keeps its rate a beat past its last sample
};

/** What the film is doing at time t: action, wait or idle. */
function classify(t, spans) {
  for (const s of spans.action) if (t >= s[0] && t <= s[1]) return 'action';
  for (const s of spans.wait) if (t >= s[0] && t <= s[1]) return 'wait';
  return 'idle';
}

export function speedPlan(events, duration, config = {}) {
  const c = { ...DEFAULTS, ...config };
  const pad = c.actionPadMs / 1000;
  const spans = { action: [], wait: [] };

  for (const e of events) {
    if (e.type === 'move') {
      const sm = e.samples || [];
      const from = sm.length ? sm[0][0] : e.t;
      const to = sm.length ? sm[sm.length - 1][0] : e.t + (e.ms || 0) / 1000;
      spans.action.push([from - pad, to + pad]);
    } else if (e.type === 'click') {
      spans.action.push([e.t - pad, e.t + 1.8 + pad]);       // the camera's hold
    } else if (e.type === 'zoom') {
      spans.action.push([e.t - pad, e.t + 0.6 + (e.holdMs == null ? 1800 : e.holdMs) / 1000 + 0.7]);
    }
  }
  // a caption on screen is an action: it has to be readable
  const caps = events.filter((e) => e.type === 'caption');
  for (let i = 0; i < caps.length; i++) {
    if (!caps[i].text) continue;
    spans.action.push([caps[i].t, caps[i + 1] ? caps[i + 1].t : duration]);
  }

  const raw = [];
  for (let t = 0; t < duration; t += c.sampleMs / 1000) {
    const end = Math.min(duration, t + c.sampleMs / 1000);
    const speed = { action: c.duringAction, wait: c.duringWait, idle: c.duringIdle }[classify(t, spans)];
    const last = raw[raw.length - 1];
    if (last && last[2] === speed && Math.abs(last[1] - t) < 1e-6) last[1] = end;
    else raw.push([t, end, speed]);
  }

  // fold away anything too short to read as a deliberate change of pace
  const merged = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && (seg[1] - seg[0]) * 1000 < c.minSegmentMs && Math.abs(prev[1] - seg[0]) < 1e-6) {
      prev[1] = seg[1];
      continue;
    }
    merged.push(seg.slice());
  }
  const out = [];
  for (const seg of merged) {
    const prev = out[out.length - 1];
    if (prev && prev[2] === seg[2] && Math.abs(prev[1] - seg[0]) < 1e-6) prev[1] = seg[1];
    else out.push(seg);
  }
  const saved = out.reduce((a, s) => a + (s[1] - s[0]) * (1 - 1 / s[2]), 0);
  return { segments: out.map((s) => [Number(s[0].toFixed(3)), Number(s[1].toFixed(3)), s[2]]), saved };
}

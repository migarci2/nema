// Caption text, cut where a person would breathe.
//
// Ported from playwright-recast (github.com/ThePatriczek/playwright-recast, MIT,
// Copyright (c) 2026 Patrik Szewczyk), dist/subtitles/subtitle-chunker.js: split
// on sentence ends first, then on clause punctuation, then at word boundaries,
// merge any fragment below a floor back into its neighbour, and share the span
// out by character count. See scripts/video/THIRD_PARTY.md.
//
// Ours held one pill however long the line was, so a long caption either ran off
// the frame or shrank until it was hard to read. This splits it into pills that
// follow each other.

const SENTENCE_END = /([.!?])\s+/;
const CLAUSE_BREAK = /([,;:])\s+/;

function splitOnPattern(text, pattern) {
  const parts = [];
  let rest = text;
  while (rest.length) {
    const m = pattern.exec(rest);
    if (!m || m.index === undefined) { parts.push(rest.trim()); break; }
    const at = m.index + m[1].length;
    const before = rest.slice(0, at).trim();
    if (before) parts.push(before);
    rest = rest.slice(at).trim();
  }
  return parts.filter(Boolean);
}

function splitAtWordBoundary(text, maxChars) {
  const words = text.split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) { out.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

function mergeSmall(parts, minChars) {
  const out = [];
  for (const p of parts) {
    if (out.length && p.length < minChars) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  if (out.length > 1 && out[0].length < minChars) { out[1] = out[0] + ' ' + out[1]; out.shift(); }
  return out;
}

export function splitCaption(text, { maxChars = 46, minChars = 14 } = {}) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  let parts = splitOnPattern(t, SENTENCE_END);
  parts = parts.flatMap((p) => (p.length > maxChars ? splitOnPattern(p, CLAUSE_BREAK) : [p]));
  parts = parts.flatMap((p) => (p.length > maxChars ? splitAtWordBoundary(p, maxChars) : [p]));
  return mergeSmall(parts, minChars);
}

/**
 * Caption events to the pills a compositor draws: [{ t, until, text }], with a
 * long line's span shared out by character count.
 */
export function captionPlan(events, endAt, opts = {}) {
  const caps = events.filter((e) => e.type === 'caption');
  const out = [];
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const next = caps[i + 1] ? caps[i + 1].t : endAt;
    if (!c.text) continue;
    const chunks = splitCaption(c.text, opts);
    if (chunks.length <= 1) { out.push({ t: c.t, until: next, text: c.text }); continue; }
    const chars = chunks.reduce((a, b) => a + b.length, 0);
    let cursor = c.t;
    for (const chunk of chunks) {
      const span = (next - c.t) * (chunk.length / chars);
      out.push({ t: cursor, until: cursor + span, text: chunk });
      cursor += span;
    }
  }
  return out;
}

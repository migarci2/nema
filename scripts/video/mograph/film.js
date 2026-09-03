/* The timing helpers every motion graphics page in the film shares. A page
 * builds its DOM once and then only writes styles inside renderAt(t), so a
 * frame at t is the same frame however long the machine took to draw it. */

/** Progress through a span, clamped: 0 before it, 1 after it. */
export function span(t, start, dur) {
  if (dur <= 0) return t >= start ? 1 : 0;
  return Math.max(0, Math.min(1, (t - start) / dur));
}

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (u) => ((ax * u + bx) * u + cx) * u;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 26; i++) { u = (lo + hi) / 2; if (fx(u) < x) lo = u; else hi = u; }
    return ((ay * u + by) * u + cy) * u;
  };
}
/* The one curve the whole film moves on. */
export const ease = bezier(0.2, 0.7, 0.2, 1);
export const easeInOut = bezier(0.65, 0, 0.35, 1);
export const lerp = (a, b, u) => a + (b - a) * u;

/** Split a line into word spans, ready to stagger. */
export function words(el, text) {
  el.textContent = '';
  const out = [];
  const parts = String(text).split(' ');
  parts.forEach((w, i) => {
    const s = document.createElement('span');
    s.className = 'word';
    s.textContent = i < parts.length - 1 ? w + ' ' : w;
    el.appendChild(s);
    out.push(s);
  });
  return out;
}

/**
 * The film's one text entrance: up 28 px and in over 240 ms, staggered a
 * frame or three per word, then held. Nothing bounces and nothing blurs.
 */
export function kinetic(spans, t, { start = 0, stagger = 0.055, dur = 0.24, rise = 28 } = {}) {
  spans.forEach((s, i) => {
    const u = ease(span(t, start + i * stagger, dur));
    s.style.opacity = u.toFixed(4);
    s.style.transform = `translateY(${((1 - u) * rise).toFixed(2)}px)`;
  });
}

/** Fade a whole element, with an optional rise. */
export function fade(el, u, rise = 0) {
  el.style.opacity = u.toFixed(4);
  if (rise) el.style.transform = `translateY(${((1 - u) * rise).toFixed(2)}px)`;
}

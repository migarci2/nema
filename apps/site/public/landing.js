/* nema hub landing behaviour.
 *
 * The hub is a landing page, and every panel on it is the product drawn in
 * HTML rather than photographed: the consent, the install, the five clients,
 * the creator panel and the three moments. This module makes those panels
 * work. It is deliberately separate from /app.js, which the four document
 * pages also load and which owns the WebMCP tools.
 *
 * Rules this file keeps:
 *   - no network calls, no vault state, nothing cryptographic on screen. The
 *     numbers and the bands are the ones the demo really produces (68 to 27,
 *     knife skills and heat control verified, ratios uncertain).
 *   - every control is a real <button>, so it is reachable by keyboard and
 *     announced. Nothing here is a clickable div.
 *   - progressive enhancement. With this file blocked, each panel stays in
 *     its opening state and still reads as a picture of the product.
 *   - prefers-reduced-motion removes the staggered reveal and leaves the hero
 *     poster in place instead of swapping in the animation.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------ hero product shot -- */

/* The poster is the first frame of the animation, so the hero paints from a
 * 83 KB PNG and the 3 MB loop is fetched only once the page is up. */
const shot = document.querySelector('.lp-shot__img[data-gif]');
if (shot && !reduceMotion) {
  const swap = () => {
    const full = new Image();
    full.decoding = 'async';
    full.addEventListener('load', () => { shot.src = shot.dataset.gif; });
    full.src = shot.dataset.gif;
  };
  if (document.readyState === 'complete') swap();
  else window.addEventListener('load', swap, { once: true });
}

/* -------------------------------------------------- vault: consent -- */

/* The three requirements Saucier School asks for, and what the demo vault
 * answers. Two are verified, one is uncertain, which is exactly why the path
 * drops to 27 minutes and ratios stays in it. */
const BAND_WORD = { durable: 'verified', uncertain: 'uncertain' };

const consent = document.querySelector('[data-consent]');

if (consent) {
  const rows = [...consent.querySelectorAll('[data-req]')];
  const steps = [...consent.querySelectorAll('.lp-step')];
  const total = consent.querySelector('[data-plan-total]');
  const note = consent.querySelector('[data-consent-note]');
  const approve = consent.querySelector('[data-consent="approve"]');
  const deny = consent.querySelector('[data-consent="deny"]');
  const again = consent.querySelector('[data-consent="reset"]');

  function paintAsked() {
    for (const row of rows) {
      const state = row.querySelector('[data-req-state]');
      if (state) state.textContent = 'not shared';
    }
    for (const step of steps) {
      delete step.dataset.done;
      const why = step.querySelector('[data-step-why]');
      if (why) why.hidden = true;
    }
    if (total) total.textContent = '68 minutes';
    if (note) {
      note.textContent = 'Nothing has left your vault.';
      delete note.dataset.state;
    }
    if (approve) approve.hidden = false;
    if (deny) deny.hidden = false;
    if (again) again.hidden = true;
  }

  function paintApproved() {
    for (const row of rows) {
      const state = row.querySelector('[data-req-state]');
      const band = row.dataset.req;
      if (!state) continue;
      state.textContent = '';
      const chip = document.createElement('span');
      chip.className = `lp-band lp-band--${band}`;
      chip.textContent = BAND_WORD[band] || band;
      state.appendChild(chip);
    }
    for (const step of steps) {
      if (step.dataset.step !== 'skip') continue;
      step.dataset.done = 'true';
      const why = step.querySelector('[data-step-why]');
      if (why) why.hidden = false;
    }
    if (total) total.textContent = '27 minutes';
    if (note) {
      note.textContent = 'Three bands went to Saucier School. Your mistakes, your scores and everything else stayed here.';
      note.dataset.state = 'ok';
    }
    if (approve) approve.hidden = true;
    if (deny) deny.hidden = true;
    if (again) again.hidden = false;
  }

  function paintDenied() {
    if (note) {
      note.textContent = 'Nothing was shared, and the path stays at 68 minutes.';
      note.dataset.state = 'off';
    }
    if (approve) approve.hidden = true;
    if (deny) deny.hidden = true;
    if (again) again.hidden = false;
  }

  if (approve) approve.addEventListener('click', paintApproved);
  if (deny) deny.addEventListener('click', paintDenied);
  if (again) again.addEventListener('click', paintAsked);
}

/* ------------------------------------------------ protocol: install -- */

const proto = document.querySelector('[data-proto]');

if (proto) {
  const list = proto.querySelector('[data-proto-tools]');
  const items = list ? [...list.children] : [];
  const run = proto.querySelector('[data-proto-run]');
  const note = proto.querySelector('[data-proto-note]');
  let timers = [];

  if (list) list.dataset.js = 'true';

  function clearTools() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    for (const li of items) delete li.dataset.on;
    if (note) {
      note.textContent = 'One manifest block and one script tag on any page, and no backend for the self certified tier.';
      delete note.dataset.state;
    }
  }

  function done() {
    if (!note) return;
    note.textContent = 'Six WebMCP tools, registered on load, with nothing to deploy.';
    note.dataset.state = 'ok';
  }

  if (run) {
    run.addEventListener('click', () => {
      clearTools();
      run.textContent = 'Install again';
      if (reduceMotion) {
        for (const li of items) li.dataset.on = 'true';
        done();
        return;
      }
      items.forEach((li, i) => {
        timers.push(setTimeout(() => {
          li.dataset.on = 'true';
          if (i === items.length - 1) done();
        }, 90 * (i + 1)));
      });
    });
    clearTools();
  }
}

/* ----------------------------------------------- your agent: clients -- */

const agents = document.querySelector('[data-agents]');

if (agents) {
  const buttons = [...agents.querySelectorAll('[data-agent]')];
  const line = agents.querySelector('[data-agent-line]');

  function lightAgent(btn) {
    for (const other of buttons) {
      delete other.dataset.on;
      const li = other.closest('li');
      if (li) delete li.dataset.on;
    }
    btn.dataset.on = 'true';
    const li = btn.closest('li');
    if (li) li.dataset.on = 'true';
    agents.dataset.on = 'true';
    if (line) line.textContent = `${btn.textContent.trim()}. ${btn.dataset.agent}`;
  }

  for (const btn of buttons) {
    btn.addEventListener('pointerenter', () => lightAgent(btn));
    btn.addEventListener('focus', () => lightAgent(btn));
    btn.addEventListener('click', () => lightAgent(btn));
  }
}

/* ------------------------------------------- in your browser: the bar -- */

const ext = document.querySelector('[data-ext]');

if (ext) {
  const share = ext.querySelector('[data-ext-share]');
  const toast = ext.querySelector('[data-ext-toast]');
  const note = ext.querySelector('[data-ext-note]');
  let shared = false;

  if (share) {
    share.addEventListener('click', () => {
      shared = !shared;
      if (toast) toast.hidden = !shared;
      share.textContent = shared ? 'Play again' : 'Review request';
      if (note) {
        note.textContent = shared
          ? 'The page got the bands it asked for. It never saw the rest.'
          : 'The bar appears on any page that installed the manifest and the script.';
      }
    });
  }
}

/* -------------------------------- for people who teach on the web -- */

const teach = document.querySelector('[data-teach-root]');

if (teach) {
  const tabs = [...teach.querySelectorAll('[data-teach]')];
  const panels = [...teach.querySelectorAll('[data-teach-panel]')];

  function showPanel(key) {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.teach === key));
    for (const panel of panels) panel.hidden = panel.dataset.teachPanel !== key;
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => showPanel(tab.dataset.teach));
    tab.addEventListener('pointerenter', () => showPanel(tab.dataset.teach));
    tab.addEventListener('focus', () => showPanel(tab.dataset.teach));
  }
}

/* ---------------------------------------------------- how it feels -- */

/* Each moment is a small machine with two states. The button carries both,
 * so there is one control to find and one to press again. */
function wireMoment(name, play, stop, labels) {
  const root = document.querySelector(`[data-moment="${name}"]`);
  if (!root) return;
  const run = root.querySelector('[data-moment-run]');
  const note = root.querySelector('[data-moment-note]');
  if (!run) return;
  let on = false;

  run.addEventListener('click', () => {
    on = !on;
    if (on) play(root, note);
    else stop(root, note);
    run.textContent = on ? labels.off : labels.on;
  });
}

function setBand(el, band, word) {
  el.className = `lp-band lp-band--${band}`;
  el.textContent = word;
}

/* A night on pan sauces: one receipt, and what sits under it moves. */
wireMoment(
  'pass',
  (root, note) => {
    for (const chip of root.querySelectorAll('[data-band]')) setBand(chip, 'usable', 'usable');
    if (note) {
      note.textContent = 'Emulsions is usable. Heat control and ratios moved with it.';
      note.dataset.state = 'ok';
    }
  },
  (root, note) => {
    for (const chip of root.querySelectorAll('[data-band]')) {
      setBand(chip, chip.dataset.band, chip.dataset.band);
    }
    if (note) {
      note.textContent = 'One receipt, and the bands under it move.';
      delete note.dataset.state;
    }
  },
  { on: 'Pass the emulsion check', off: 'Play again' }
);

/* Another site already knows: two lessons leave the path. */
wireMoment(
  'second',
  (root, note) => {
    for (const row of root.querySelectorAll('[data-lesson]')) {
      const state = row.querySelector('[data-lesson-state]');
      if (!state) continue;
      state.textContent = '';
      const chip = document.createElement('span');
      chip.className = 'lp-band lp-band--usable';
      chip.textContent = 'already proved';
      state.appendChild(chip);
      row.dataset.done = 'true';
    }
    if (note) {
      note.textContent = 'Two lessons skipped, with the reason printed on each.';
      note.dataset.state = 'ok';
    }
  },
  (root, note) => {
    for (const row of root.querySelectorAll('[data-lesson]')) {
      const state = row.querySelector('[data-lesson-state]');
      if (state) state.textContent = 'in the path';
      delete row.dataset.done;
    }
    if (note) {
      note.textContent = 'A site it never heard of, teaching something else.';
      delete note.dataset.state;
    }
  },
  { on: 'Ask my vault', off: 'Play again' }
);

/* My agent catches the drift: four minutes, the blurred pair first. */
const REVIEW_ORDER = { maillard: 1, fond: 2, ratio: 3 };

wireMoment(
  'drift',
  (root, note) => {
    for (const row of root.querySelectorAll('[data-review-item]')) {
      row.style.order = String(REVIEW_ORDER[row.dataset.reviewItem] || 0);
      const min = row.querySelector('[data-review-min]');
      if (min) min.hidden = false;
    }
    if (note) {
      note.textContent = 'Four minutes, the blurred pair first.';
      note.dataset.state = 'ok';
    }
  },
  (root, note) => {
    for (const row of root.querySelectorAll('[data-review-item]')) {
      row.style.order = '';
      const min = row.querySelector('[data-review-min]');
      if (min) min.hidden = true;
    }
    if (note) {
      note.textContent = 'Your agent plans. It never answers for you.';
      delete note.dataset.state;
    }
  },
  { on: 'Plan four minutes', off: 'Play again' }
);

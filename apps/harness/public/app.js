/**
 * Saucier School: the page.
 *
 * Owns the learner state for this origin, renders the four panels and hands a
 * small API to tools.js. The division of labour is the whole point:
 *
 *   the agent   asks for the offer, presents an assertion the learner approved,
 *               opens an activity, polls the attempt, asks for the receipt
 *   the learner reads, chooses, orders, writes, submits, and can present the
 *               assertion by hand when there is no agent in the room
 *   the kitchen re-grades and signs
 *
 * Nothing in this file lets a tool call produce an answer or a grade.
 *
 * The school renders its own header and footer, in its own identity. It still
 * borrows two runtime helpers from the nema brand module, the mark for the
 * partner badge and the tools counter, and nothing else.
 */

import {
  copyToClipboard,
  escapeHtml,
  markSvg,
  mountToolsIndicator,
  toast
} from '/shared/brand/brand.js';
import { mountActivityStrip } from '/shared/webmcp.js';
import { ORIGINS } from '/shared/origins.js';
import { ACTIVITIES, MANIFEST, grade, personalizePath } from '/content.js';
import { renderStage, TYPE_LABEL } from '/activities.js';
import { presentAssertion, registerHarnessTools } from '/tools.js';

/* --------------------------------------------------------------- state -- */

const STORAGE_KEY = 'nema.harness.v1';
const ACTIVITY_LIST = MANIFEST.activities.map((entry) => ACTIVITIES[entry.id]);
const FULL_MINUTES = MANIFEST.unit.estimatedMinutes;

const EMPTY_ATTEMPT = {
  status: 'not_started',
  attempts: 0,
  hintsUsed: 0,
  startedAt: null,
  finishedAt: null,
  durationSeconds: 0,
  submission: null,
  draft: {},
  result: null,
  score: null,
  feedback: [],
  receiptToken: null,
  receiptPayload: null,
  receiptAttempt: null
};

function blankState() {
  return {
    version: 1,
    learnerKeyId: null,
    assertion: null,
    path: null,
    openActivityId: null,
    receiptView: null,
    attempts: {}
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return blankState();
    return { ...blankState(), ...parsed, attempts: parsed.attempts || {} };
  } catch {
    return blankState();
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* A private window with storage disabled still runs the whole demo, it
     * just forgets it between reloads. Nothing here is worth an error. */
  }
}

function attemptFor(activityId) {
  const stored = state.attempts[activityId];
  return { ...EMPTY_ATTEMPT, ...(stored || {}), draft: (stored && stored.draft) || {} };
}

function writeAttempt(activityId, patch) {
  state.attempts[activityId] = { ...attemptFor(activityId), ...patch };
  saveState();
  return state.attempts[activityId];
}

/* ------------------------------------------------------------ elements -- */

const dom = {
  unit: document.getElementById('unit'),
  unitTitle: document.querySelector('[data-unit-title]'),
  unitProvider: document.querySelector('[data-unit-provider]'),
  unitMeta: document.querySelector('[data-unit-meta]'),
  unitIds: document.querySelector('[data-unit-ids]'),
  outcomes: document.querySelector('[data-outcomes]'),
  reqLine: document.querySelector('[data-req-line]'),
  requirements: document.querySelector('[data-requirements]'),
  banner: document.querySelector('[data-banner]'),
  pathPanel: document.getElementById('path'),
  pathHint: document.querySelector('[data-path-hint]'),
  pathList: document.querySelector('[data-path-list]'),
  pathNote: document.querySelector('[data-path-note]'),
  stagePanel: document.getElementById('stage'),
  stageHint: document.querySelector('[data-stage-hint]'),
  stage: document.querySelector('[data-stage]'),
  receiptPanel: document.getElementById('receipt'),
  receiptHint: document.querySelector('[data-receipt-hint]'),
  receipt: document.querySelector('[data-receipt]'),
  strip: document.querySelector('[data-activity-strip]'),
  foot: document.querySelector('[data-lab-foot]')
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function flash(panel) {
  if (!panel) return;
  panel.classList.remove('is-flashing');
  /* Force a reflow so the animation restarts on a second call in a row. */
  void panel.offsetWidth;
  panel.classList.add('is-flashing');
  setTimeout(() => panel.classList.remove('is-flashing'), 1200);
}

function scrollToPanel(panel) {
  if (!panel) return;
  panel.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
}

/* Rows that left the path on the most recent personalization. They strike
 * through one after the other on the next render, then the set is emptied so a
 * later render draws the same path without replaying the animation. */
let strikeQueue = new Set();

/* Rows that came back onto the path on the most recent personalization. They
 * are the only included rows that carry a reason, and only for one render. */
let restoreQueue = new Set();

/**
 * Count a number up or down in place, so the minutes counter reads as a change
 * rather than as a different page. Reduced motion gets the final value at once,
 * which is the same information without the movement.
 */
function countTo(node, from, to, ms = 700) {
  if (reduceMotion.matches || from === to || !Number.isFinite(from)) {
    node.textContent = String(to);
    return;
  }
  const startedAt = performance.now();
  node.textContent = String(from);
  function step(at) {
    const t = Math.min(1, (at - startedAt) / ms);
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    node.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* A course site names a skill the way a cook would, not the way the registry
 * does. The exact concept id stays on the row as a title, and in the ids line
 * under "More about this unit", so nothing is hidden. */
const ABILITY_PHRASE = {
  apply: 'hands on',
  explain: 'in your own words',
  discriminate: 'told apart',
  transfer: 'in a new kitchen'
};

function conceptLabel(concept) {
  const name = String(concept).replace(/^nema:/, '').replace(/-/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function requirementLabel(concept, ability) {
  return `${conceptLabel(concept)}, ${ABILITY_PHRASE[ability] || ability}`;
}

function pillClassFor(status) {
  if (status === 'verified') return 'n-pill--durable';
  if (status === 'uncertain') return 'n-pill--uncertain';
  return 'n-pill--unknown';
}

function shortTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

/* ---------------------------------------------------------- unit panel -- */

function statusMap() {
  const map = {};
  if (state.assertion && Array.isArray(state.assertion.payload.assertions)) {
    for (const entry of state.assertion.payload.assertions) {
      map[`${entry.concept}|${entry.ability}`] = entry;
    }
  }
  return map;
}

function requirementRows() {
  const map = statusMap();
  return MANIFEST.requirements.map((requirement) => {
    const found = map[`${requirement.concept}|${requirement.ability}`];
    return {
      concept: requirement.concept,
      ability: requirement.ability,
      status: state.assertion ? (found ? found.status : 'missing') : 'unchecked',
      confidence: found ? found.confidence : null
    };
  });
}

function renderUnit({ countMinutesFrom = null } = {}) {
  /* The hero reads from the manifest, so the page and the API can never drift. */
  dom.unitTitle.textContent = MANIFEST.unit.title;
  dom.unitProvider.textContent = MANIFEST.provider.name;
  dom.unitMeta.textContent =
    `${MANIFEST.activities.length} activities, ${FULL_MINUTES} minutes, ` +
    `${MANIFEST.unit.price}. Every grade is decided here, in the kitchen.`;
  dom.unitIds.textContent =
    `${MANIFEST.unit.id} ${MANIFEST.unit.version} / issuer ${MANIFEST.provider.keyId}`;
  dom.outcomes.textContent = MANIFEST.outcomes
    .map((outcome) => `${outcome.concept}.${outcome.ability}`)
    .join('  ');

  /* One sentence over the three requirement rows. Before an assertion it says
   * nothing is assumed; after one it carries the beat of the demo, and the
   * minutes count down in place. */
  dom.reqLine.textContent = '';
  if (state.path) {
    dom.reqLine.append(document.createTextNode('Read from your vault: '));
    dom.reqLine.append(el('span', 'num', FULL_MINUTES));
    dom.reqLine.append(document.createTextNode(' minutes became '));
    const minutes = el('b', 'num accent', state.path.personalMinutes);
    if (countMinutesFrom !== null) countTo(minutes, countMinutesFrom, state.path.personalMinutes);
    dom.reqLine.append(minutes);
    dom.reqLine.append(document.createTextNode('.'));
  } else {
    dom.reqLine.textContent =
      'What this unit assumes you can already do. Nothing is checked until your vault says so.';
  }

  dom.requirements.textContent = '';
  for (const row of requirementRows()) {
    const line = el('div', 'lab-req');
    const name = el('span', 'lab-req__id', requirementLabel(row.concept, row.ability));
    name.title = `${row.concept}.${row.ability}`;
    line.append(name);
    const pill = el(
      'span',
      `n-pill ${pillClassFor(row.status)}`,
      row.status === 'unchecked' ? 'not checked' : row.status
    );
    if (row.confidence) pill.title = `confidence ${row.confidence}`;
    line.append(pill);
    dom.requirements.append(line);
  }
}

function setBanner(text, kind = 'ok') {
  if (!text) {
    dom.banner.hidden = true;
    dom.banner.textContent = '';
    return;
  }
  dom.banner.hidden = false;
  dom.banner.dataset.kind = kind;
  dom.banner.textContent = text;
}

/* ---------------------------------------------------------- path panel -- */

function cleanReason(reason) {
  const text = String(reason || '').replace(/^(skipped|included):\s*/i, '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function currentPathView() {
  if (!state.path) {
    /* The full offer needs no per row explanation: the sentence under the list
     * already says that nothing has been assumed about the learner yet. */
    return {
      entries: ACTIVITY_LIST.map((activity) => ({ activity, skipped: false, reason: '' })),
      personalMinutes: FULL_MINUTES
    };
  }
  const included = new Map(state.path.path.map((item) => [item.activityId, item]));
  const skipped = new Map(state.path.skipped.map((item) => [item.activityId, item]));
  return {
    entries: ACTIVITY_LIST.map((activity) => {
      const hit = included.get(activity.id) || skipped.get(activity.id);
      const isSkipped = skipped.has(activity.id);
      /* A reason is worth a line only where the row is not self explanatory:
       * a struck through row, or one that just came back onto the path. */
      const explain = isSkipped || restoreQueue.has(activity.id);
      return {
        activity,
        skipped: isSkipped,
        reason: explain && hit ? cleanReason(hit.reason) : ''
      };
    }),
    personalMinutes: state.path.personalMinutes
  };
}

function renderPath() {
  const view = currentPathView();
  dom.pathList.textContent = '';
  let strikeIndex = 0;

  view.entries.forEach((entry, index) => {
    const row = el('button', 'n-path__row lab-path__row');
    row.type = 'button';
    if (entry.skipped) row.classList.add('n-path__row--skipped');
    if (state.openActivityId === entry.activity.id) row.classList.add('n-path__row--current');
    row.setAttribute(
      'aria-label',
      `${entry.activity.title}, ${entry.activity.minutes} minutes, ${entry.skipped ? 'skipped' : 'included'}. Open it.`
    );

    if (strikeQueue.has(entry.activity.id)) {
      row.classList.add('lab-path__row--striking');
      row.style.setProperty('--strike-delay', `${strikeIndex * 240}ms`);
      strikeIndex += 1;
    }

    row.append(el('span', 'n-path__index', String(index + 1)));
    const main = el('span', 'n-path__main');
    main.append(el('span', 'n-path__title', entry.activity.title));
    if (entry.reason) main.append(el('span', 'n-path__reason', entry.reason));
    row.append(main);
    row.append(el('span', 'n-path__minutes', `${entry.activity.minutes} min`));

    /* The pill lives under the title, not beside it: in a narrow panel a pill
     * on the title line wraps every title into three lines. */
    const attempt = attemptFor(entry.activity.id);
    if (attempt.status === 'passed') {
      main.append(el('span', 'n-pill n-pill--usable n-pill--nodot lab-path__pill', 'passed'));
    } else if (attempt.status === 'failed') {
      main.append(el('span', 'n-pill n-pill--danger n-pill--nodot lab-path__pill', 'retry'));
    }

    row.addEventListener('click', () => openActivity(entry.activity.id, { source: 'learner' }));
    dom.pathList.append(row);
  });

  strikeQueue = new Set();
  restoreQueue = new Set();

  if (state.path) {
    dom.pathHint.textContent = 'personal path';
    dom.pathNote.textContent =
      `Your path: ${state.path.personalMinutes} of ${FULL_MINUTES} minutes, ` +
      `from an assertion your vault signed until ${shortTime(state.assertion.payload.expiresAt)}.`;
  } else {
    dom.pathHint.textContent = 'full offer';
    dom.pathNote.textContent = `The whole unit: ${FULL_MINUTES} minutes, nothing assumed about you yet.`;
  }
}

/* --------------------------------------------------------- stage panel -- */

let announceRegion = null;

/** The first activity on the current path the learner has not passed yet. */
function nextActivity() {
  const ids = state.path ? state.path.path.map((item) => item.activityId) : ACTIVITY_LIST.map((a) => a.id);
  for (const id of ids) {
    if (attemptFor(id).status !== 'passed') return ACTIVITIES[id];
  }
  return null;
}

function stageAnnounce(text) {
  if (!announceRegion) return;
  announceRegion.textContent = text;
}

function renderStagePanel(focusTarget = null) {
  dom.stage.textContent = '';
  const activityId = state.openActivityId;

  if (!activityId || !ACTIVITIES[activityId]) {
    dom.stageHint.textContent = 'nothing open';
    const empty = el('div', 'lab-empty');
    empty.append(
      el('p', 'lab-line', 'Nothing open. Pick a step from the path to begin.')
    );

    const next = nextActivity();
    if (next) {
      const card = el('div', 'lab-next');
      card.append(el('span', 'lab-cap', 'Up next'));
      card.append(el('p', 'lab-next__title', next.title));
      card.append(
        el('p', 'lab-next__meta', `${TYPE_LABEL[next.type] || next.type}, ${next.minutes} min`)
      );
      const open = el('button', 'n-btn n-btn--primary n-btn--sm', 'Open');
      open.type = 'button';
      open.setAttribute('aria-label', `Open ${next.title}`);
      open.addEventListener('click', () => openActivity(next.id, { source: 'learner' }));
      card.append(open);
      empty.append(card);
    }

    dom.stage.append(empty);
    return;
  }

  const activity = ACTIVITIES[activityId];
  const attempt = attemptFor(activityId);
  dom.stageHint.textContent = `${TYPE_LABEL[activity.type] || activity.type}, ${activity.minutes} min`;

  const live = el('p', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  announceRegion = live;
  dom.stage.append(live);

  const agentNote = el('p', 'stage__agent mono');
  agentNote.setAttribute('data-agent-note', '');
  agentNote.setAttribute('role', 'status');
  agentNote.setAttribute('aria-live', 'polite');
  agentNote.hidden = true;
  dom.stage.append(agentNote);

  dom.stage.append(
    renderStage(activity, attempt, {
      submit: (submission) => submitAttempt(activityId, submission),
      hint: () => useHint(activityId),
      draft: (patch) => {
        const current = attemptFor(activityId);
        writeAttempt(activityId, { draft: { ...current.draft, ...patch } });
      },
      issueReceipt: () =>
        issueReceipt(activityId).then((result) => {
          if (result.status !== 'issued') {
            toast(result.reason || 'The receipt was not issued.', 'error');
          }
          return result;
        }),
      announce: stageAnnounce
    })
  );

  if (focusTarget === 'feedback') {
    const feedback = dom.stage.querySelector('[data-feedback]');
    if (feedback) feedback.focus();
  } else if (focusTarget === 'hint') {
    const hints = dom.stage.querySelectorAll('.stage__hint');
    const last = hints[hints.length - 1];
    if (last) {
      last.tabIndex = -1;
      last.focus();
    }
  } else if (focusTarget === 'title') {
    const title = dom.stage.querySelector('[data-stage-title]');
    if (title) title.focus();
  }
}

function setAgentNote(text) {
  const note = dom.stage.querySelector('[data-agent-note]');
  if (!note) return;
  note.hidden = false;
  note.textContent = text;
}

/* ------------------------------------------------------- receipt panel -- */

function renderReceipt() {
  dom.receipt.textContent = '';
  const issued = Object.entries(state.attempts)
    .filter(([, attempt]) => attempt && attempt.receiptToken)
    .map(([activityId, attempt]) => ({ activityId, ...attempt }));

  if (issued.length === 0) {
    dom.receiptHint.textContent = 'nothing issued yet';
    dom.receipt.append(
      el(
        'p',
        'lab-line',
        'Pass the lab and Saucier School signs a receipt you own.'
      )
    );
    return;
  }

  dom.receiptHint.textContent = `${issued.length} issued on this device`;
  const selected =
    issued.find((entry) => entry.activityId === state.receiptView) || issued[issued.length - 1];
  const payload = selected.receiptPayload;
  const token = selected.receiptToken;

  if (issued.length > 1) {
    const picker = el('div', 'row row--tight lab-receipt-picker');
    for (const entry of issued) {
      const pick = el(
        'button',
        `n-btn n-btn--sm ${entry === selected ? 'n-btn--primary' : 'n-btn--secondary'} n-btn--mono`,
        entry.activityId
      );
      pick.type = 'button';
      pick.setAttribute('aria-pressed', entry === selected ? 'true' : 'false');
      pick.addEventListener('click', () => {
        state.receiptView = entry.activityId;
        saveState();
        renderReceipt();
      });
      picker.append(pick);
    }
    dom.receipt.append(picker);
  }

  const wrap = el('div', 'receipt');

  /* Left: the token itself, and the one link that matters. */
  const left = el('div', 'stack');
  const box = el('div', 'n-token');
  const boxHead = el('span', 'n-token__head', 'Signed receipt');
  boxHead.append(el('span', 'n-pill n-pill--durable', 'signed'));
  const copy = el('button', 'n-btn n-btn--sm', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', () => copyToClipboard(token, copy));
  boxHead.append(copy);
  box.append(boxHead);
  const text = el('p', 'n-token__text');
  text.innerHTML = `<b>nema1.</b>${escapeHtml(token.slice(6))}`;
  box.append(text);
  left.append(box);

  const actions = el('div', 'row');
  const send = el('a', 'n-btn n-btn--primary', 'Send to vault');
  send.href = `${ORIGINS.vault}/#receipt=${token}`;
  send.rel = 'noopener';
  actions.append(send);
  actions.append(el('span', 'lab-line', 'Your vault checks our signature before it keeps anything.'));
  left.append(actions);
  wrap.append(left);

  /* Right: what the token says, decoded. */
  const right = el('div', 'stack stack--tight');
  right.append(el('span', 'lab-cap', 'What it says'));

  const claims = el('div', 'lab-claims');
  for (const claim of payload.claims) {
    const row = el('div', 'lab-claim');
    row.append(el('span', 'lab-claim__id mono', `${claim.concept}.${claim.ability}`));
    row.append(el('span', 'lab-claim__meta', `${claim.evidenceType} evidence`));
    row.append(
      el(
        'span',
        `n-pill ${claim.result === 'passed' ? 'n-pill--usable' : claim.result === 'partial' ? 'n-pill--uncertain' : 'n-pill--danger'}`,
        claim.result
      )
    );
    claims.append(row);
  }
  right.append(claims);

  const meta = el('dl', 'kv');
  const entries = [
    ['issuer', payload.issuer],
    ['key', payload.keyId],
    ['subject', payload.subject],
    ['activity', `${payload.activity.id} ${payload.activity.version}`],
    [
      'conditions',
      payload.conditions
        ? `${payload.conditions.grader} v${payload.conditions.graderVersion}, ` +
          `${payload.conditions.attempts ?? 0} attempts, ${payload.conditions.hintsUsed ?? 0} hints, ` +
          `${payload.conditions.durationSeconds ?? 0} s`
        : 'none'
    ],
    ['issued', payload.issuedAt]
  ];
  for (const [key, value] of entries) {
    meta.append(el('dt', 'kv__key', key));
    meta.append(el('dd', 'kv__value mono', value));
  }
  right.append(meta);
  wrap.append(right);

  dom.receipt.append(wrap);
}

/* ------------------------------------------------------------- actions -- */

function renderAll() {
  renderUnit();
  renderPath();
  renderStagePanel();
  renderReceipt();
}

function openActivity(activityId, { source = 'learner' } = {}) {
  const activity = ACTIVITIES[activityId];
  if (!activity) return null;

  state.openActivityId = activityId;
  const attempt = attemptFor(activityId);
  if (attempt.status === 'not_started') {
    writeAttempt(activityId, { status: 'in_progress', startedAt: Date.now() });
  } else if (!attempt.startedAt) {
    writeAttempt(activityId, { startedAt: Date.now() });
  }
  saveState();

  renderPath();
  renderStagePanel('title');
  flash(dom.stagePanel);
  scrollToPanel(dom.stagePanel);
  if (source === 'tool') {
    setAgentNote(`Opened by the agent: start_activity. The agent cannot answer this, you can.`);
  }
  return activity;
}

function durationFor(attempt) {
  if (!attempt.startedAt) return attempt.durationSeconds || 0;
  const end = Date.now();
  return Math.max(1, Math.round((end - attempt.startedAt) / 1000));
}

function submitAttempt(activityId, submission) {
  const activity = ACTIVITIES[activityId];
  if (!activity) return;
  const before = attemptFor(activityId);
  const graded = grade(activityId, submission);
  const duration = durationFor(before);

  const attempt = writeAttempt(activityId, {
    status: graded.result === 'failed' ? 'failed' : 'passed',
    result: graded.result,
    score: graded.score,
    feedback: graded.feedback,
    attempts: before.attempts + 1,
    submission,
    draft: { ...before.draft, ...submission },
    finishedAt: Date.now(),
    durationSeconds: duration
  });

  renderPath();
  renderStagePanel('feedback');
  flash(dom.stagePanel);

  if (attempt.status === 'passed') {
    toast(
      graded.result === 'partial'
        ? 'Partial pass. We can still sign a receipt, and it will say partial.'
        : 'Passed. We can sign a receipt for this.',
      'ok'
    );
  } else {
    toast('Not passed yet. Read the notes and try it again.', 'warn');
  }
  return attempt;
}

function useHint(activityId) {
  const activity = ACTIVITIES[activityId];
  if (!activity) return;
  const hints = (activity.content && activity.content.hints) || [];
  const attempt = attemptFor(activityId);
  if (attempt.hintsUsed >= hints.length) return;
  writeAttempt(activityId, {
    hintsUsed: attempt.hintsUsed + 1,
    status: attempt.status === 'not_started' ? 'in_progress' : attempt.status,
    startedAt: attempt.startedAt || Date.now()
  });
  renderStagePanel('hint');
}

/**
 * Ask the worker for a receipt. Idempotent in two directions: once a token is
 * stored for an activity it is returned again and never re-signed, and while a
 * request is in flight every other caller (the stage button, the tool, a double
 * click) gets the same promise, so the worker is never asked to sign twice.
 */
const receiptsInFlight = new Map();

function issueReceipt(activityId) {
  const pending = receiptsInFlight.get(activityId);
  if (pending) return pending;
  const run = requestReceipt(activityId).finally(() => receiptsInFlight.delete(activityId));
  receiptsInFlight.set(activityId, run);
  return run;
}

async function requestReceipt(activityId) {
  const activity = ACTIVITIES[activityId];
  if (!activity) return { status: 'rejected', reason: 'unknown-activity' };

  const attempt = attemptFor(activityId);
  if (attempt.receiptToken) {
    renderReceipt();
    flash(dom.receiptPanel);
    scrollToPanel(dom.receiptPanel);
    return { status: 'issued', token: attempt.receiptToken, payload: attempt.receiptPayload, repeat: true };
  }

  if (attempt.status !== 'passed') {
    return { status: 'not-passed', reason: 'The learner has not passed this activity yet.' };
  }

  const response = await fetch('/api/receipt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      activityId,
      submission: attempt.submission,
      learnerKeyId: state.learnerKeyId || 'anonymous',
      conditions: {
        attempts: attempt.attempts,
        hintsUsed: attempt.hintsUsed,
        durationSeconds: attempt.durationSeconds
      }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== 'issued') {
    return {
      status: body.status === 'not-passed' ? 'not-passed' : 'rejected',
      reason: body.reason || (body.feedback && body.feedback[0]) || `worker returned ${response.status}`
    };
  }

  writeAttempt(activityId, {
    receiptToken: body.token,
    receiptPayload: body.payload,
    receiptAttempt: attempt.attempts
  });
  state.receiptView = activityId;
  saveState();
  renderReceipt();
  renderStagePanel();
  flash(dom.receiptPanel);
  scrollToPanel(dom.receiptPanel);
  toast(`Signed by ${MANIFEST.provider.name}. Take it to your vault.`, 'ok');
  return { status: 'issued', token: body.token, payload: body.payload, repeat: false };
}

function applyPersonalization(payload) {
  /* Seed every requirement as missing before the assertion is laid over it.
   * content.js reads an empty map as "no assertion presented" and returns the
   * whole offer, so an assertion that reports none of the three requirements
   * has to arrive as three explicit misses, not as an absence. */
  const statuses = {};
  for (const requirement of MANIFEST.requirements) {
    statuses[`${requirement.concept}|${requirement.ability}`] = 'missing';
  }
  for (const entry of payload.assertions || []) {
    statuses[`${entry.concept}|${entry.ability}`] = entry.status;
  }

  const result = personalizePath(statuses);
  /* Only the rows that were on the path a moment ago get the strike animation.
   * A second personalization of an already personalized path animates the one
   * row that actually changed, not the three that were struck through before. */
  const wasSkipped = new Set((state.path ? state.path.skipped : []).map((item) => item.activityId));
  strikeQueue = new Set(
    result.skipped.map((item) => item.activityId).filter((id) => !wasSkipped.has(id))
  );
  /* A row that was struck through and is on the path again explains itself
   * once, the same way a row that just left the path does. */
  restoreQueue = new Set(
    result.path.map((item) => item.activityId).filter((id) => wasSkipped.has(id))
  );
  const minutesBefore = state.path ? state.path.personalMinutes : FULL_MINUTES;

  state.assertion = { payload, receivedAt: new Date().toISOString() };
  state.learnerKeyId = payload.learnerKeyId;
  state.path = {
    path: result.path,
    skipped: result.skipped,
    fullMinutes: result.fullMinutes,
    personalMinutes: result.personalMinutes
  };
  saveState();

  renderUnit({ countMinutesFrom: minutesBefore });
  renderPath();
  renderStagePanel();
  /* The sentence over the requirements carries the news, so the banner is only
   * ever a rejection or an agent note. A good assertion clears it. */
  setBanner('');
  flash(dom.unit);
  flash(dom.pathPanel);
  scrollToPanel(dom.unit);
  return result;
}

function resetLab() {
  state = blankState();
  saveState();
  setBanner('');
  renderAll();
  toast('Your progress on this site is cleared. Your vault is untouched.', 'ok');
}

/* ----------------------------------------------------------------- boot -- */

/* The badge is the school's, the mark inside it is nema's. It is drawn from
 * the brand module so the partner mark can never drift from the real one. */
for (const slot of document.querySelectorAll('[data-nema-mark]')) {
  slot.innerHTML = markSvg();
}
mountToolsIndicator(document.querySelector('[data-tools-indicator]'));
mountActivityStrip(dom.strip);

const resetButton = el('button', 'lab-reset', 'Clear my progress on this site');
resetButton.type = 'button';
resetButton.title = 'Clears the attempts, the assertion and the receipts stored for this origin.';
resetButton.addEventListener('click', resetLab);
dom.foot.append(resetButton);

renderAll();

const controller = {
  ORIGINS,
  MANIFEST,
  ACTIVITIES,
  getState: () => state,
  attemptFor,
  applyPersonalization,
  openActivity,
  issueReceipt,
  setBanner,
  setAgentNote,
  flashUnit: () => flash(dom.unit),
  flashStage: () => flash(dom.stagePanel),
  flashPath: () => flash(dom.pathPanel),
  scrollToUnit: () => scrollToPanel(dom.unit),
  scrollToStage: () => scrollToPanel(dom.stagePanel),
  toast
};

registerHarnessTools(controller).catch((err) => {
  console.error('[nema] harness tools failed to register:', err);
});

/* ------------------------------------------------- paste an assertion -- */

/* The whole flow has to work with no agent at all. The form under the
 * requirements is a declarative WebMCP tool and a plain form at the same time:
 * an agent fills it and submits it, a learner pastes a token from their vault
 * and presses Present. Both end in presentAssertion(), the function the
 * personalize_learning_path tool runs. */
const pasteForm = document.querySelector('form[toolname="present_assertion"]');
const pasteStatus = document.querySelector('[data-assertion-status]');

function sayPasteResult(result) {
  if (!pasteStatus) return;
  if (result && result.status === 'personalized') {
    pasteStatus.textContent = `Verified. ${result.personalMinutes} minutes left of ${result.fullMinutes}.`;
  } else if (result && result.status === 'rejected') {
    pasteStatus.textContent = `Rejected: ${result.reason}. Nothing changed.`;
  } else {
    pasteStatus.textContent = '';
  }
}

if (pasteForm) {
  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    /* A tool call a judge cannot see is a tool call they cannot audit, so an
     * agent submit opens the block it happened in. */
    const wrapper = pasteForm.closest('details');
    if (wrapper) wrapper.open = true;

    const token = String(pasteForm.elements.assertionToken.value || '').trim();
    /* Both runtimes mark an agent submit with agentInvoked before this listener
     * runs. It is the only honest test: the native SubmitEvent carries
     * respondWith on every submit, and throws if a human's submit answers. */
    const byAgent = event.agentInvoked === true;

    const work = (async () => {
      if (byAgent) {
        /* Route the agent through the canonical imperative tool so the call is
         * timed and lands in the tool activity strip under its real name. The
         * native runtime wants the input as a JSON string; the polyfill takes
         * either. */
        try {
          const tools = await document.modelContext.getTools();
          const canonical = tools.find((entry) => entry.name === 'personalize_learning_path');
          if (canonical) {
            const raw = await document.modelContext.executeTool(
              canonical,
              JSON.stringify({ assertionToken: token })
            );
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
        } catch {
          /* Fall through: the shared function below is the same code path. */
        }
      }
      return presentAssertion(controller, token);
    })();

    work.then(sayPasteResult, () => sayPasteResult(null));
    /* respondWith takes a promise, and both runtimes want it during dispatch. */
    if (byAgent && typeof event.respondWith === 'function') event.respondWith(work);
  });
}

/**
 * nema harness lab: the page.
 *
 * Owns the learner state for this origin, renders the four panels and hands a
 * small API to tools.js. The division of labour is the whole point of nema:
 *
 *   the agent   asks for the offer, presents an assertion the learner approved,
 *               opens an activity, polls the attempt, asks for the receipt
 *   the learner reads, chooses, orders, writes, submits
 *   the worker  re-grades and signs
 *
 * Nothing in this file lets a tool call produce an answer or a grade.
 */

import {
  copyToClipboard,
  escapeHtml,
  injectFooter,
  injectHeader,
  toast
} from '/shared/brand/brand.js';
import { mountActivityStrip } from '/shared/webmcp.js';
import { ORIGINS } from '/shared/origins.js';
import { ACTIVITIES, MANIFEST, grade, personalizePath } from '/content.js';
import { renderStage, TYPE_LABEL } from '/activities.js';
import { registerHarnessTools } from '/tools.js';

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
  unitStats: document.querySelector('[data-unit-stats]'),
  outcomes: document.querySelector('[data-outcomes]'),
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
  toolsPanel: document.getElementById('tools'),
  strip: document.querySelector('[data-activity-strip]')
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
  dom.unitMeta.textContent = '';
  dom.unitMeta.append(
    el(
      'span',
      'unit__meta-line',
      `${MANIFEST.unit.id} / version ${MANIFEST.unit.version} / ${MANIFEST.unit.price} / ` +
        `${MANIFEST.activities.length} activities`
    )
  );
  dom.unitMeta.append(el('span', 'unit__meta-line', `issuer ${MANIFEST.provider.keyId}`));

  const personal = state.path ? state.path.personalMinutes : null;
  const inPath = state.path ? state.path.path.length : MANIFEST.activities.length;
  const rows = requirementRows();
  const verified = rows.filter((row) => row.status === 'verified').length;

  const stats = [
    { value: FULL_MINUTES, label: 'full path min' },
    { value: personal === null ? '-' : personal, label: 'your path min', accent: true },
    { value: inPath, label: 'activities for you' },
    { value: state.assertion ? `${verified}/${rows.length}` : `-/${rows.length}`, label: 'requirements verified' }
  ];

  dom.unitStats.textContent = '';
  for (const stat of stats) {
    const item = el('span', `n-stat${stat.accent ? ' n-stat--accent' : ''}`);
    const value = el('span', 'n-stat__value', stat.value);
    if (stat.accent && countMinutesFrom !== null && personal !== null) {
      countTo(value, countMinutesFrom, personal);
    }
    item.append(value);
    item.append(el('span', 'n-stat__label', stat.label));
    dom.unitStats.append(item);
  }

  dom.outcomes.textContent = '';
  for (const outcome of MANIFEST.outcomes) {
    dom.outcomes.append(
      el('span', 'n-pill n-pill--nodot mono', `${outcome.concept}.${outcome.ability}`)
    );
  }

  dom.requirements.textContent = '';
  for (const row of rows) {
    const line = el('div', 'lab-req');
    line.append(el('span', 'lab-req__id mono', `${row.concept}.${row.ability}`));
    const pill = el('span', `n-pill ${pillClassFor(row.status)}`, row.status === 'unchecked' ? 'not checked' : row.status);
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

function currentPathView() {
  if (!state.path) {
    return {
      entries: ACTIVITY_LIST.map((activity) => ({
        activity,
        skipped: false,
        reason: 'Included: no readiness assertion presented yet.'
      })),
      personalMinutes: FULL_MINUTES
    };
  }
  const included = new Map(state.path.path.map((item) => [item.activityId, item]));
  const skipped = new Map(state.path.skipped.map((item) => [item.activityId, item]));
  return {
    entries: ACTIVITY_LIST.map((activity) => {
      const hit = included.get(activity.id) || skipped.get(activity.id);
      return {
        activity,
        skipped: skipped.has(activity.id),
        reason: hit ? hit.reason : ''
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

    row.append(el('span', 'n-path__index', String(index + 1).padStart(2, '0')));
    const main = el('span', 'n-path__main');
    main.append(el('span', 'n-path__title', entry.activity.title));
    main.append(el('span', 'n-path__reason', entry.reason));
    row.append(main);
    row.append(el('span', 'n-path__minutes', `${entry.activity.minutes} min`));

    /* The pill lives under the reason, not beside the title: in a four column
     * panel a pill on the title line wraps every title into three lines. */
    const attempt = attemptFor(entry.activity.id);
    if (attempt.status === 'passed') {
      main.append(el('span', 'n-pill n-pill--usable n-pill--nodot lab-path__pill', 'passed'));
    } else if (attempt.status === 'failed') {
      main.append(el('span', 'n-pill n-pill--danger n-pill--nodot lab-path__pill', 'retry'));
    }

    row.addEventListener('click', () => openActivity(entry.activity.id, { source: 'learner' }));
    dom.pathList.append(row);
  });

  const total = el('div', 'n-path__total');
  total.append(el('span', null, state.path ? 'personal path' : 'full offer'));
  total.append(el('b', null, view.personalMinutes));
  total.append(el('span', null, `of ${FULL_MINUTES} minutes`));
  dom.pathList.append(total);
  strikeQueue = new Set();

  if (state.path) {
    const removed = FULL_MINUTES - state.path.personalMinutes;
    dom.pathHint.textContent = 'personal path';
    dom.pathNote.textContent =
      `${state.path.skipped.length} activities skipped, ${removed} minutes removed. ` +
      `Personalised from an assertion your vault signed for this origin, valid until ${shortTime(state.assertion.payload.expiresAt)}. ` +
      'You can still open a skipped activity if you want to read it.';
  } else {
    dom.pathHint.textContent = 'full offer';
    dom.pathNote.textContent =
      `The full offer: ${MANIFEST.activities.length} activities, ${FULL_MINUTES} minutes. ` +
      'No readiness assertion has been presented yet, so nothing is assumed about you.';
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
    empty.append(el('p', 'n-empty', 'No activity open'));
    empty.append(
      el(
        'p',
        'lab-note',
        'Pick a row in the path, or ask your agent to call start_activity. The agent can open an activity. It cannot answer one.'
      )
    );

    const next = nextActivity();
    if (next) {
      const card = el('div', 'lab-next');
      card.append(el('span', 'lab-cap', 'Up next on your path'));
      card.append(el('p', 'lab-next__title', next.title));
      card.append(
        el(
          'p',
          'stage__meta mono',
          `${TYPE_LABEL[next.type] || next.type} / ${next.minutes} min / ${next.evidenceProduced} evidence`
        )
      );
      card.append(el('p', 'lab-note', next.whatTheLearnerDoes));
      const open = el('button', 'n-btn n-btn--primary', `Open ${next.title}`);
      open.type = 'button';
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
    const empty = el('div', 'lab-empty');
    empty.append(el('p', 'n-empty', 'No receipt issued yet'));
    empty.append(
      el(
        'p',
        'lab-note',
        'Pass an activity, then press Issue evidence receipt in the stage or let your agent call issue_evidence_receipt. The worker re-grades your submission before it signs anything.'
      )
    );
    dom.receipt.append(empty);
    return;
  }

  dom.receiptHint.textContent = `${issued.length} issued on this device`;
  const selected =
    issued.find((entry) => entry.activityId === state.receiptView) || issued[issued.length - 1];
  const payload = selected.receiptPayload;
  const token = selected.receiptToken;

  if (issued.length > 1) {
    const picker = el('div', 'row row--tight lab-receipt-picker');
    picker.append(el('span', 'lab-cap', 'Receipts'));
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

  /* Left: the token itself. */
  const left = el('div', 'stack');
  const box = el('div', 'n-token');
  const boxHead = el('span', 'n-token__head', 'evidence receipt');
  const copy = el('button', 'n-btn n-btn--sm n-btn--mono', 'Copy');
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
  actions.append(
    el(
      'span',
      'lab-note',
      'The link opens your vault with the token in the hash. The vault verifies the signature and asks you before it stages anything.'
    )
  );
  left.append(actions);
  wrap.append(left);

  /* Right: the decoded claims and conditions. */
  const right = el('div', 'stack stack--tight');
  right.append(el('span', 'lab-cap', 'Decoded claims'));

  const ledger = el('div', 'n-ledger');
  for (const claim of payload.claims) {
    const row = el('div', 'n-ledger__row');
    row.append(el('span', 'n-ledger__id', 'claim'));
    const main = el('span', 'n-ledger__main');
    main.append(el('span', 'n-ledger__title mono', `${claim.concept}.${claim.ability}`));
    main.append(
      el('span', 'n-ledger__meta', `${claim.evidenceType} evidence, difficulty ${claim.difficulty || 'unstated'}`)
    );
    row.append(main);
    const end = el('span', 'n-ledger__end');
    end.append(
      el(
        'span',
        `n-pill ${claim.result === 'passed' ? 'n-pill--usable' : claim.result === 'partial' ? 'n-pill--uncertain' : 'n-pill--danger'}`,
        claim.result
      )
    );
    row.append(end);
    ledger.append(row);
  }
  right.append(ledger);

  /* The keys are set in small caps by .kv__key, so they are written here as
   * words rather than as the camelCase field names: "ISSUEDAT" is a typo to
   * read, "ISSUED AT" is a label. The value is always the field verbatim. */
  const meta = el('dl', 'kv');
  const entries = [
    ['issuer', payload.issuer],
    ['key id', payload.keyId],
    ['receipt id', payload.receiptId],
    ['subject', payload.subject],
    ['activity', `${payload.activity.id} ${payload.activity.version}`],
    ['content hash', payload.activity.contentHash || 'not stated'],
    [
      'conditions',
      payload.conditions
        ? `grader ${payload.conditions.grader} v${payload.conditions.graderVersion}, ` +
          `${payload.conditions.attempts ?? 0} attempts, ${payload.conditions.hintsUsed ?? 0} hints, ` +
          `${payload.conditions.durationSeconds ?? 0} s`
        : 'none',
    ],
    ['issued at', payload.issuedAt]
  ];
  for (const [key, value] of entries) {
    meta.append(el('dt', 'kv__key mono', key));
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
        ? 'Partial pass. A receipt can still be issued, and it will say partial.'
        : 'Passed. The provider can sign a receipt for this.',
      'ok'
    );
  } else {
    toast('Not passed yet. Read the feedback and try again.', 'warn');
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
  toast('Receipt signed by the Harness Engineering Lab. Take it to your vault.', 'ok');
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
  setBanner(
    `Path personalised from your vault: ${result.fullMinutes} min to ${result.personalMinutes} min.`,
    'ok'
  );
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
  toast('Lab state cleared on this device. The vault is untouched.', 'ok');
}

/* ----------------------------------------------------------------- boot -- */

injectHeader({ app: 'harness', title: 'Harness Lab' });
injectFooter({ note: 'Provider. Signs evidence receipts, never writes to your vault.' });
mountActivityStrip(dom.strip);

const resetRow = el('div', 'row lab-reset');
const resetButton = el('button', 'n-btn n-btn--secondary n-btn--sm', 'Reset lab state');
resetButton.type = 'button';
resetButton.addEventListener('click', resetLab);
resetRow.append(resetButton);
resetRow.append(
  el('span', 'lab-note', 'Clears the attempts, the assertion and the receipts stored for this origin.')
);
dom.toolsPanel.querySelector('.n-panel__body').append(resetRow);

renderAll();
if (state.path) {
  setBanner(
    `Path personalised from your vault: ${FULL_MINUTES} min to ${state.path.personalMinutes} min.`,
    'ok'
  );
}

registerHarnessTools({
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
}).catch((err) => {
  console.error('[nema] harness tools failed to register:', err);
});

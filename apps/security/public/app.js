/**
 * nema provider UI: Line Cook Lab.
 *
 * Renders the unit "Service Under Pressure" from /content.js and owns all
 * browser state for this origin. tools.js registers the five WebMCP tools and
 * calls into the controller functions exported at the bottom of this file, so a
 * tool call and a click always take the same code path and always repaint the
 * same screen.
 *
 * Rendering rule (content.js header): only fields literally named `html` hold
 * markup. Every other string from content.js is written with textContent, and
 * trace content sits in an element with white-space: pre-wrap, because the lab
 * depends on the exact line structure and on payloads that live inside HTML
 * comments surviving to the screen.
 *
 * Storage: localStorage key `nema.security.v1`.
 */

import {
  ACTIVITIES,
  ACTIVITY_ORDER,
  MANIFEST,
  PROVIDER,
  GRADER_VERSION,
  grade,
  checkPrerequisites
} from '/content.js';
import { verifyAssertion } from '/shared/protocol.js';
import { ORIGINS } from '/shared/origins.js';
/* Line Cook Lab renders its own header and footer (index.html), so the shared
   injectHeader and injectFooter are deliberately not imported: this site is not
   nema and must not wear the nema chrome. What it does borrow is the hex mark
   for the "Works with nema" badge and the tools indicator behaviour. */
import { markSvg, mountToolsIndicator, toast, copyToClipboard } from '/shared/brand/brand.js';
import { mountActivityStrip } from '/shared/webmcp.js';

const STORAGE_KEY = 'nema.security.v1';
const VAULT_ORIGIN = ORIGINS.vault;

/* --------------------------------------------------------------- state -- */

const EMPTY_STATE = {
  version: 1,
  learnerKeyId: null,
  assertion: null,
  currentActivityId: null,
  attempts: {},
  receipts: {}
};

let state = load();
let prereq = computePrereq();
let assertionNote = '';
let offerNote = '';

/* The rejection alert belongs to the moment it happened. Any later action that
   repaints the prerequisites panel drops it, so a refused token from ten minutes
   ago cannot sit in red above an assertion that is still standing. */
function clearAssertionNote() {
  assertionNote = '';
}

/* Unsaved form selections for the activity on the stage, kept in memory only so
 * a repaint (a hint, a tool call) never throws away what the learner ticked. */
const drafts = {};

/* One in-flight receipt request per activity. The button and the
 * issue_evidence_receipt tool can fire at the same moment, and two POSTs would
 * mint two receipts with different ids for one attempt. */
const issuing = {};

function load() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    stored = null;
  }
  const next = { ...EMPTY_STATE, ...(stored && typeof stored === 'object' ? stored : {}) };
  next.attempts = next.attempts && typeof next.attempts === 'object' ? next.attempts : {};
  next.receipts = next.receipts && typeof next.receipts === 'object' ? next.receipts : {};
  /* Documents written before the key was renamed to match contract section 10. */
  if (!next.learnerKeyId && stored && typeof stored.subject === 'string') next.learnerKeyId = stored.subject;
  delete next.subject;
  if (next.assertion && expired(next.assertion.payload)) next.assertion = null;
  /* The raw token is never kept: the stored assertion is payload and receivedAt,
     exactly the shape the contract names. */
  if (next.assertion) delete next.assertion.token;
  return next;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* A full or blocked storage jar must never break the lesson in front of the
       learner. The page keeps working from memory for this session. */
  }
}

function expired(payload) {
  if (!payload || typeof payload.expiresAt !== 'string') return true;
  const at = new Date(payload.expiresAt).getTime();
  return !Number.isFinite(at) || at <= Date.now();
}

/**
 * The statuses this provider is allowed to reason from: the assertion the
 * learner approved, and nothing else. With no assertion every requirement is
 * missing, which is the honest starting point and the state the screen explains.
 */
function statusMap() {
  const map = {};
  const assertions = state.assertion && Array.isArray(state.assertion.payload.assertions)
    ? state.assertion.payload.assertions
    : [];
  for (const entry of assertions) {
    map[`${entry.concept}|${entry.ability}`] = entry.status;
  }
  return map;
}

function computePrereq() {
  return checkPrerequisites(statusMap());
}

/** Stable pseudonym for receipts issued before any assertion was presented. */
function localSubject() {
  if (!state.learnerKeyId) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    state.learnerKeyId = `lk_local_${chars}`;
    save();
  }
  return state.learnerKeyId;
}

function subjectId() {
  if (state.assertion && typeof state.assertion.payload.learnerKeyId === 'string') {
    return state.assertion.payload.learnerKeyId;
  }
  return localSubject();
}

function attemptFor(activityId) {
  let attempt = state.attempts[activityId];
  if (!attempt) {
    attempt = {
      status: 'not_started',
      attempts: 0,
      hintsUsed: 0,
      startedAt: null,
      finishedAt: null,
      submission: null,
      result: null,
      score: 0,
      feedback: [],
      receiptToken: null
    };
    state.attempts[activityId] = attempt;
  }
  return attempt;
}

function durationSeconds(attempt) {
  if (!attempt.startedAt) return 0;
  const from = new Date(attempt.startedAt).getTime();
  const to = attempt.finishedAt ? new Date(attempt.finishedAt).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 1000));
}

function lockedEntry(activityId) {
  return prereq.locked.find((entry) => entry.activityId === activityId) || null;
}

/* -------------------------------------------------------------- helpers -- */

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function pill(text, variant) {
  return el('span', `n-pill n-pill--${variant} n-pill--nodot`, text);
}

/** A band is a small coloured dot, not a bordered chip. */
function dot(variant) {
  return el('span', `dot dot--${variant}`);
}

function conceptLabel(concept, ability) {
  return `${concept}.${ability}`;
}

/* content.js prefixes its reason strings with the state they belong to
   ("Included: ", "Skipped: ", "Locked: "). The row already shows the state, so
   the prefix is dropped here and the sentence starts on its own. */
function plainReason(text) {
  const body = String(text || '').replace(/^(Included|Skipped|Locked|Unlocked)[:.]\s*/, '');
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/** "interactive-lab" reads as a label, "Interactive lab" reads as English. */
function sentenceCase(value) {
  const text = String(value || '').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function announce(message) {
  const live = $('[data-live-region]');
  if (live) live.textContent = message;
}

/* ---------------------------------------------------------------- hero -- */

function renderHero() {
  /* One line of facts instead of stat tiles. Only the unlocked count moves
     during a demo, and it moves the moment check_prerequisites lands. */
  const facts = $('[data-hero-stats]');
  facts.textContent = '';
  const parts = [
    [String(MANIFEST.unit.estimatedMinutes), ' minutes'],
    [String(MANIFEST.activities.length), ' activities'],
    [`${prereq.unlocked.length} of ${ACTIVITY_ORDER.length}`, ' unlocked']
  ];
  parts.forEach(([value, label], index) => {
    if (index > 0) facts.append(document.createTextNode(', '));
    facts.append(el('b', null, value), document.createTextNode(label));
  });

  const list = $('[data-hero-requirements]');
  list.textContent = '';
  for (const requirement of prereq.recognized) {
    const item = el('li', 'reqs__item');
    item.append(dot(requirement.status));
    item.append(el('code', null, conceptLabel(requirement.concept, requirement.ability)));
    item.append(el('span', 'reqs__status', requirement.status));
    list.append(item);
  }

  const origin = $('[data-hero-origin]');
  origin.textContent = '';
  /* The origin that actually signs, not the one the manifest advertises: on the
     dev server those differ, and the receipt panel would contradict the hero. */
  origin.append(el('span', null, `${location.origin}, key ${PROVIDER.keyId}`));
  const manifestLink = el('a', 'more__link', 'GET /api/manifest');
  manifestLink.href = '/api/manifest';
  origin.append(manifestLink);

  const note = $('[data-hero-note]');
  note.textContent = offerNote;
  note.hidden = offerNote === '';

  const startLabel = $('[data-start-label]');
  if (startLabel) startLabel.textContent = state.currentActivityId ? 'Resume service' : 'Begin service';
}

/* --------------------------------------------------------- prerequisites -- */

/**
 * The requirement rows live in the hero (renderHero). This writes the one
 * sentence under them, which is the whole visible answer to "did the vault
 * speak yet", and the assertion fields in the collapsed More block.
 */
function renderPrereq() {
  const body = $('[data-prereq-body]');
  const hint = $('[data-prereq-hint]');
  const meta = $('[data-prereq-meta]');
  body.textContent = '';
  meta.textContent = '';

  if (!state.assertion) {
    hint.textContent = 'no assertion on file';
    body.append(el('p', 'reqs__sentence', 'No readiness assertion on file for this origin.'));
    if (assertionNote) body.append(el('p', 'prereq-alert', assertionNote));
    return;
  }

  const payload = state.assertion.payload;
  hint.textContent = 'verified assertion';
  body.append(el('p', 'reqs__sentence reqs__sentence--ok', 'Prerequisites recognised from another provider.'));

  /* A rejected token never unseats the assertion the learner already approved.
     The alert says what was refused, under the statuses that are still standing. */
  if (assertionNote) body.append(el('p', 'prereq-alert', assertionNote));

  const list = el('dl', 'meta');
  const rows = [
    ['Learner', payload.learnerKeyId],
    ['Audience', payload.audience],
    ['Purpose', payload.purpose],
    ['Expires', payload.expiresAt]
  ];
  for (const [key, value] of rows) list.append(el('dt', null, key), el('dd', null, value));
  meta.append(list);
}

/* ------------------------------------------------------------ activities -- */

function renderPath() {
  const body = $('[data-path-body]');
  const hint = $('[data-path-hint]');
  body.textContent = '';
  hint.textContent = `${prereq.unlocked.length} unlocked, ${prereq.locked.length} locked`;

  const list = el('ol', 'acts');
  ACTIVITY_ORDER.forEach((activityId, index) => {
    const activity = ACTIVITIES[activityId];
    const attempt = state.attempts[activityId];
    const locked = lockedEntry(activityId);
    const skippable = prereq.skippable.includes(activityId);

    const row = el('li', 'act');
    if (locked) row.classList.add('act--locked');
    if (skippable) row.classList.add('act--skippable');
    if (state.currentActivityId === activityId) row.classList.add('act--current');

    row.append(el('span', 'act__index', String(index + 1)));

    const main = el('span', 'act__main');
    const head = el('span', 'act__head');
    head.append(el('span', 'act__title', activity.title));
    /* One pill per row at most: what happened beats what is suggested. */
    if (attempt && (attempt.status === 'passed' || attempt.status === 'failed')) {
      head.append(pill(attempt.result, attempt.result === 'failed' ? 'danger' : 'usable'));
    } else if (skippable) {
      head.append(pill('already covered', 'usable'));
    } else if (prereq.recommendedFirst === activityId) {
      head.append(pill('recommended', 'durable'));
    }
    main.append(head);

    /* One line, and only when there is something to say. Why an activity is
       skippable is stated once above the list; what a lock is missing is
       spelled out on the activity stage, where the row is expanded. */
    if (locked) main.append(el('span', 'act__reason', plainReason(activity.lockedReason)));
    row.append(main);

    const end = el('span', 'act__end');
    end.append(el('span', 'act__minutes', `${activity.minutes} min`));
    if (locked) {
      const lock = el('span', 'act__lock');
      lock.append(dot('locked'), el('span', null, 'Locked'));
      end.append(lock);
    } else {
      const button = el('button', 'n-btn n-btn--sm', skippable ? 'Open anyway' : 'Start');
      button.type = 'button';
      button.addEventListener('click', () => {
        startActivity(activityId);
      });
      end.append(button);
    }
    row.append(end);
    list.append(row);
  });

  body.append(list);
}

/* ----------------------------------------------------------------- stage -- */

/** The activity whose form is on the stage right now, for draft capture. */
let stagedActivityId = null;

/**
 * Read the open lab form into `drafts` before the stage is rebuilt.
 *
 * Every repaint of the stage throws the DOM away, and a lab keeps its answers
 * in the DOM until Submit. A hint, an assertion arriving from a tool call, or a
 * receipt landing would otherwise wipe work the learner had not submitted yet.
 */
function captureDraft() {
  if (!stagedActivityId) return;
  const activity = ACTIVITIES[stagedActivityId];
  const form = $('[data-stage-body] form.lab');
  if (!activity || !form) return;

  if (Array.isArray(activity.trace)) {
    drafts[stagedActivityId] = {
      untrusted: Array.from(form.querySelectorAll('input[name="untrusted"]:checked'), (i) => i.value),
      mitigations: Array.from(form.querySelectorAll('input[name="mitigation"]:checked'), (i) => i.value)
    };
    return;
  }

  if (Array.isArray(activity.incidents)) {
    const answers = {};
    for (const incident of activity.incidents) {
      const checked = form.querySelector(`input[name="${incident.id}"]:checked`);
      if (checked) answers[incident.id] = checked.value;
    }
    drafts[stagedActivityId] = { answers };
  }
}

function renderStage() {
  const body = $('[data-stage-body]');
  const hint = $('[data-stage-hint]');
  captureDraft();
  body.textContent = '';

  const activityId = state.currentActivityId;
  const activity = activityId ? ACTIVITIES[activityId] : null;
  stagedActivityId = activity ? activityId : null;

  if (!activity) {
    hint.textContent = 'stage clear';
    body.append(
      el('p', 'empty', 'Nothing on the stage. Open an activity above, or let the agent call start_activity.')
    );
    return;
  }

  hint.textContent = `${activityId}, ${activity.minutes} min`;

  const head = el('div', 'stage__head');
  const heading = el('h3', 'stage__title', activity.title);
  heading.id = 'stage-activity-title';
  heading.tabIndex = -1;
  head.append(heading);
  head.append(
    el('p', 'stage__facts', `${sentenceCase(activity.type)}, ${activity.difficulty}, ${activity.minutes} min`)
  );
  /* `whatTheLearnerDoes` is written for the agent, in the third person, and it
     describes what the stage below it already shows. It stays in the tool
     result and off the page. */
  body.append(head);

  const locked = lockedEntry(activityId);
  if (locked) {
    const lock = el('div', 'lockbox');
    lock.append(el('p', 'lockbox__title', plainReason(activity.lockedReason)));
    const missing = el('ul', 'lockbox__list');
    for (const need of locked.missing) {
      /* Mono for the concept id, the UI face for the sentence around it. */
      const item = el('li');
      item.append(el('code', null, conceptLabel(need.concept, need.ability)));
      item.append(el('span', 'dim', ` needs ${need.needed}, your vault says ${statusMap()[`${need.concept}|${need.ability}`] || 'missing'}`));
      missing.append(item);
    }
    lock.append(missing);
    lock.append(el('p', 'lockbox__note', 'Close the gap anywhere, present a fresh assertion, and this lab unlocks.'));
    body.append(lock);
    return;
  }

  /* Dispatch on the shape content.js gives us, not on an id: the unit can be
     renamed and the right renderer still runs. */
  if (activity.type === 'lesson') renderLesson(body, activity);
  else if (Array.isArray(activity.trace)) renderAuditLab(body, activity);
  else renderTriageLab(body, activity);

  /* Empty wrappers would still take a gap in the stage column. */
  const hints = renderHints(activity);
  if (hints.childElementCount) body.append(hints);
  const feedback = renderFeedback(activity);
  if (feedback.childElementCount) body.append(feedback);
}

function renderHints(activity) {
  const attempt = attemptFor(activity.id);
  const wrap = el('div', 'hints');
  const hints = Array.isArray(activity.hints) ? activity.hints : [];
  if (hints.length === 0) return wrap;

  const shown = Math.min(attempt.hintsUsed, hints.length);
  if (shown > 0) {
    const list = el('ul', 'hints__list');
    for (let i = 0; i < shown; i += 1) {
      list.append(el('li', 'hints__item', hints[i]));
    }
    wrap.append(list);
  }

  /* Once the attempt is graded the hints have nothing left to help with, and a
     hint taken after the fact would still be counted in the receipt conditions.
     The ones already revealed stay on screen. */
  if (shown < hints.length && attempt.status !== 'passed') {
    const button = el('button', 'n-btn n-btn--sm n-btn--secondary', shown === 0 ? 'Show a hint' : 'Show another hint');
    button.type = 'button';
    button.addEventListener('click', () => {
      attempt.hintsUsed = shown + 1;
      if (attempt.status === 'not_started') {
        attempt.status = 'in_progress';
        attempt.startedAt = attempt.startedAt || new Date().toISOString();
      }
      save();
      renderStage();
      announce(`Hint ${attempt.hintsUsed} shown. Hints used are recorded in the receipt.`);
    });
    wrap.append(button);
    wrap.append(el('span', 'dim', 'Hints are recorded in the receipt.'));
  }
  return wrap;
}

function renderFeedback(activity) {
  const attempt = attemptFor(activity.id);
  const wrap = el('div', 'feedback');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Grader feedback');

  if (!attempt.result || !Array.isArray(attempt.feedback) || attempt.feedback.length === 0) {
    return wrap;
  }

  const variant = attempt.result === 'passed' ? 'usable' : attempt.result === 'partial' ? 'uncertain' : 'danger';
  const head = el('div', 'row row--tight');
  head.append(pill(attempt.result, variant));
  /* One labelled line: these three numbers travel together into the receipt
     conditions, and three separate chips read as three separate facts. */
  head.append(
    el(
      'span',
      'mono dim',
      `score ${Number(attempt.score || 0).toFixed(2)}, attempts ${attempt.attempts}, ${durationSeconds(attempt)} s`
    )
  );
  wrap.append(head);

  const list = el('ul', 'feedback__list');
  for (const line of attempt.feedback) list.append(el('li', 'feedback__item', line));
  wrap.append(list);

  if (attempt.status === 'passed' && !attempt.receiptToken) {
    const button = el('button', 'n-btn n-btn--primary', 'Issue evidence receipt');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await issueReceipt(activity.id);
      button.disabled = false;
      if (result.status !== 'issued') toast(`Receipt not issued: ${result.status}`, 'error');
    });
    wrap.append(button);
  }
  return wrap;
}

/* ---------------------------------------------------------------- lesson -- */

function renderLesson(body, activity) {
  const lesson = activity.lesson;
  const wrap = el('article', 'lesson');
  wrap.append(el('p', 'lesson__intro', lesson.intro));

  for (const section of lesson.sections) {
    const block = el('section', 'lesson__section');
    block.append(el('h4', 'lesson__heading', section.heading));
    /* `html` is the one field in content.js that carries markup we authored. */
    const prose = el('div', 'lesson__prose');
    prose.innerHTML = section.html;
    block.append(prose);
    wrap.append(block);
  }

  const points = el('div', 'lesson__points');
  points.append(el('p', 'lesson__points-label', 'Key points'));
  const list = el('ul', 'lesson__points-list');
  for (const point of lesson.keyPoints) list.append(el('li', null, point));
  points.append(list);
  wrap.append(points);

  const attempt = attemptFor(activity.id);
  const actions = el('div', 'row');
  const button = el('button', 'n-btn n-btn--primary', attempt.status === 'passed' ? 'Marked as read' : 'Mark as read');
  button.type = 'button';
  button.disabled = attempt.status === 'passed';
  button.addEventListener('click', () => submit(activity.id, { completed: true }));
  actions.append(button);
  /* Once the lesson is read the grader says this better, in the feedback
     under the button, so the standing note goes away with the click. */
  if (attempt.status !== 'passed') {
    actions.append(el('span', 'dim', 'A lesson records exposure evidence, the lowest weight the vault accepts.'));
  }
  wrap.append(actions);

  body.append(wrap);
}

/* ------------------------------------------------- lab: the service log -- */

/* A fix `detail` explains why the fix works or does not, which is the answer
   the lab is asking for, so the whole detail is held back until the attempt is
   graded. Its first sentence often names the verdict outright ("Harmful. ...",
   "Neutral for prevention, ..."); that half is split out and shown next to the
   kind pill. The strings still live in content.js, this only decides when each
   half appears. Reported upstream: content.js should carry the verdict in a
   field of its own so no parsing is needed here. */
const VERDICT_LEAD = /^(Harmful|Neutral|Effective)\b[^.]*\.\s+/;

function splitVerdict(detail) {
  const text = typeof detail === 'string' ? detail : '';
  const match = VERDICT_LEAD.exec(text);
  if (!match) return { verdict: '', body: text };
  return { verdict: match[0].trim(), body: text.slice(match[0].length) };
}

/* content.js writes a trace label as "<station>, <clock time>", and nothing
   else. The rail wants the time on its own, in mono, the way a ticket printer
   stamps it; the station stays the title of the row. A label that ever stops
   matching keeps its whole string as the station and prints no time. */
const RAIL_TIME = /^(.*),\s*(\d{1,2}:\d{2})$/;

function splitLabel(label) {
  const text = String(label || '');
  const match = RAIL_TIME.exec(text);
  if (!match) return { station: text, time: '' };
  return { station: match[1], time: match[2] };
}

/* The same idea for an incident evidence line, which sometimes opens with the
   clock time and sometimes does not. A line without one keeps the column empty
   so every sentence still starts on the same edge. */
const LEAD_TIME = /^(\d{1,2}:\d{2})\s+/;

function splitLeadTime(line) {
  const text = String(line || '');
  const match = LEAD_TIME.exec(text);
  if (!match) return { time: '', rest: text };
  return { time: match[1], rest: text.slice(match[0].length) };
}

function renderAuditLab(body, activity) {
  const attempt = attemptFor(activity.id);
  const graded = attempt.result !== null;
  /* Graded reads the submission, ungraded reads the draft the last repaint saved. */
  const source = graded && attempt.submission ? attempt.submission : drafts[activity.id] || {};
  const picked = new Set(Array.isArray(source.untrusted) ? source.untrusted : []);
  const chosen = new Set(Array.isArray(source.mitigations) ? source.mitigations : []);

  const scenario = el('div', 'scenario');
  /* `scenario.html` is authored markup, the second and last html field. */
  scenario.innerHTML = activity.scenario.html;
  body.append(scenario);

  const form = el('form', 'lab');
  form.noValidate = true;

  const traceSet = el('fieldset', 'lab__set');
  traceSet.append(el('legend', 'lab__legend', 'Mark every station step that breaks a food safety rule.'));

  const trace = el('ol', 'trace');
  for (const entry of activity.trace) {
    const item = el('li', 'trace__item');
    item.dataset.actor = entry.actor;
    /* Only a cook entry is a station step the learner can mark, so only a cook
       entry carries a verdict. What the ticket and pass rows are doing here is
       said once in the scenario above the list. */
    const markable = entry.actor === 'cook';
    if (graded && markable) item.dataset.mark = entry.untrusted ? 'unsafe' : 'safe';

    const { station, time } = splitLabel(entry.label);

    const rail = el('span', 'trace__rail');
    if (time) rail.append(el('span', 'trace__time', time));
    rail.append(el('span', 'trace__step', String(entry.step).padStart(2, '0')));
    item.append(rail);

    const main = el('div', 'trace__main');
    const head = el('div', 'trace__head');
    head.append(el('span', 'trace__label', station));
    head.append(el('span', `trace__actor trace__actor--${entry.actor}`, entry.actor));
    main.append(head);
    main.append(el('p', 'trace__source', entry.source));

    const content = el('pre', 'trace__content');
    content.textContent = entry.content;
    main.append(content);

    if (markable) {
      const label = el('label', 'n-check trace__check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'untrusted';
      input.value = entry.id;
      input.checked = picked.has(entry.id);
      input.disabled = graded;
      label.append(input, el('span', null, 'breaks a rule'));
      main.append(label);
    }

    if (graded && markable) {
      const badge = el('div', 'trace__verdict');
      badge.append(entry.untrusted ? pill('unsafe', 'danger') : pill('safe', 'usable'));
      badge.append(el('span', 'trace__why', entry.why));
      main.append(badge);
    }

    item.append(main);
    trace.append(item);
  }
  traceSet.append(trace);
  form.append(traceSet);

  const mitSet = el('fieldset', 'lab__set');
  mitSet.append(el('legend', 'lab__legend', 'Pick the fixes you would put on the line tomorrow.'));
  const mitigations = el('div', 'mits');
  for (const mitigation of activity.mitigations) {
    const card = el('label', 'mit');
    if (graded) card.dataset.kind = mitigation.kind;
    const row = el('span', 'mit__head');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'mitigation';
    input.value = mitigation.id;
    input.checked = chosen.has(mitigation.id);
    input.disabled = graded;
    row.append(input);
    row.append(el('span', 'mit__label', mitigation.label));
    if (graded) row.append(pill(mitigation.kind, mitigation.kind === 'effective' ? 'usable' : mitigation.kind === 'harmful' ? 'danger' : 'unknown'));
    card.append(row);
    /* Ungraded the list is seven lines to choose from. The reasoning arrives
       with the grade, where it is feedback instead of the answer. */
    if (graded) {
      const detail = splitVerdict(mitigation.detail);
      /* A bare "Harmful." repeats the pill, so only a verdict that says more
         than the kind is worth a line of its own. */
      const saysMore = detail.verdict.replace(/\.$/, '').toLowerCase() !== mitigation.kind;
      if (detail.verdict && saysMore) card.append(el('span', 'mit__verdict', detail.verdict));
      card.append(el('span', 'mit__detail', detail.body));
    }
    mitigations.append(card);
  }
  mitSet.append(mitigations);
  form.append(mitSet);

  const actions = el('div', 'row');
  const submitButton = el('button', 'n-btn n-btn--primary', graded ? 'Submitted' : 'Submit');
  submitButton.type = 'submit';
  submitButton.disabled = graded;
  actions.append(submitButton);
  if (graded) {
    const retry = el('button', 'n-btn n-btn--secondary', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => resetAttempt(activity.id));
    actions.append(retry);
  } else {
    actions.append(el('span', 'dim', 'Graded on this page. No tool can answer for you.'));
  }
  form.append(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const untrusted = Array.from(form.querySelectorAll('input[name="untrusted"]:checked'), (i) => i.value);
    const chosenMitigations = Array.from(form.querySelectorAll('input[name="mitigation"]:checked'), (i) => i.value);
    submit(activity.id, { untrusted, mitigations: chosenMitigations });
  });

  body.append(form);
}

/* ------------------------------------------------------ lab: injection triage -- */

function renderTriageLab(body, activity) {
  const attempt = attemptFor(activity.id);
  const graded = attempt.result !== null;
  /* Graded reads the submission, ungraded reads the draft the last repaint saved. */
  const source = graded && attempt.submission ? attempt.submission : drafts[activity.id] || {};
  const answers = source.answers && typeof source.answers === 'object' ? source.answers : {};

  const scenario = el('div', 'scenario');
  scenario.innerHTML = activity.scenario.html;
  body.append(scenario);

  const form = el('form', 'lab');
  form.noValidate = true;

  const incidents = el('div', 'incidents');
  activity.incidents.forEach((incident, index) => {
    const card = el('fieldset', 'incident');
    const chosenId = answers[incident.id];
    if (graded) card.dataset.verdict = chosenId === incident.answerKey ? 'correct' : 'wrong';

    const legend = el('legend', 'incident__legend');
    legend.append(el('span', 'incident__index', `Incident ${index + 1} of ${activity.incidents.length}`));
    legend.append(el('span', 'incident__summary', incident.summary));
    card.append(legend);

    const evidence = el('div', 'incident__evidence');
    for (const line of incident.evidence) {
      /* Some evidence lines open with the clock time the kitchen logged. That
         time moves into a column of its own, in mono, so four incidents read
         as one log instead of four paragraphs. The sentence keeps its exact
         text and its author's line breaks. */
      const { time, rest } = splitLeadTime(line);
      const row = el('div', 'incident__line');
      row.append(el('span', 'incident__at', time));
      row.append(el('p', 'incident__text', rest));
      evidence.append(row);
    }
    card.append(evidence);

    const options = el('div', 'incident__options');
    for (const option of incident.options) {
      const label = el('label', 'option');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = incident.id;
      input.value = option.id;
      input.checked = chosenId === option.id;
      input.disabled = graded;
      label.append(input, el('span', 'option__label', option.label));
      if (graded && option.id === incident.answerKey) label.append(pill('answer', 'usable'));
      else if (graded && option.id === chosenId) label.append(pill('your call', 'danger'));
      options.append(label);
    }
    card.append(options);

    if (graded) {
      card.append(el('p', 'incident__rationale', incident.rationale));
    }
    incidents.append(card);
  });
  form.append(incidents);

  const actions = el('div', 'row');
  const submitButton = el('button', 'n-btn n-btn--primary', graded ? 'Submitted' : 'Submit triage');
  submitButton.type = 'submit';
  submitButton.disabled = graded;
  actions.append(submitButton);
  if (graded) {
    const retry = el('button', 'n-btn n-btn--secondary', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => resetAttempt(activity.id));
    actions.append(retry);
  } else {
    actions.append(el('span', 'dim', 'One call per incident. Over reacting counts against you.'));
  }
  form.append(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosenAnswers = {};
    for (const incident of activity.incidents) {
      const checked = form.querySelector(`input[name="${incident.id}"]:checked`);
      if (checked) chosenAnswers[incident.id] = checked.value;
    }
    submit(activity.id, { answers: chosenAnswers });
  });

  body.append(form);
}

/* --------------------------------------------------------------- receipt -- */

function renderReceipt() {
  const body = $('[data-receipt-body]');
  const hint = $('[data-receipt-hint]');
  body.textContent = '';

  const entries = Object.entries(state.receipts);
  if (entries.length === 0) {
    hint.textContent = 'none issued yet';
    body.append(el('p', 'empty', 'Pass a lab and the signed receipt lands here, yours to carry to the vault.'));
    return;
  }

  hint.textContent = `${entries.length} issued`;
  for (const [activityId, receipt] of entries.reverse()) {
    const payload = receipt.payload;
    const block = el('div', 'receipt');

    /* CONTRACT DEVIATION (section 10): the contract says "token in a textarea
       with Copy button". The token box here is the shared .n-token component
       (brand.css component 10), which is what the harness provider and the
       vault also use, so the three token surfaces look the same. The full token
       is in the DOM, the Copy button puts the whole string on the clipboard,
       and the box clamps to a readable height instead of a resizable field. */
    const token = el('div', 'n-token');
    const head = el('span', 'n-token__head', 'Signed receipt for ');
    head.append(el('code', 'mono', activityId));
    const copy = el('button', 'n-btn n-btn--sm n-btn--mono', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => copyToClipboard(receipt.token, copy));
    head.append(copy);
    token.append(head);
    const text = el('p', 'n-token__text');
    text.append(el('b', null, 'nema1.'));
    text.append(document.createTextNode(receipt.token.slice(6)));
    token.append(text);
    block.append(token);

    const claims = el('div', 'n-ledger');
    payload.claims.forEach((claim, index) => {
      const row = el('div', 'n-ledger__row');
      row.append(el('span', 'n-ledger__id', `claim ${index + 1}`));
      const main = el('span', 'n-ledger__main');
      main.append(el('span', 'n-ledger__title mono', conceptLabel(claim.concept, claim.ability)));
      main.append(
        el('span', 'n-ledger__meta', `${claim.evidenceType}, ${claim.difficulty}, graded ${payload.conditions.grader}`)
      );
      row.append(main);
      const end = el('span', 'n-ledger__end');
      end.append(pill(claim.result, claim.result === 'passed' ? 'usable' : claim.result === 'partial' ? 'uncertain' : 'danger'));
      row.append(end);
      claims.append(row);
    });
    block.append(claims);

    /* Seven signed fields matter to a verifier and to nobody else on first
       read, so they fold away under the claims they belong to. */
    const details = el('details', 'more');
    details.append(el('summary', 'more__summary', 'Signed fields'));
    const meta = el('dl', 'meta');
    const rows = [
      ['Receipt', payload.receiptId],
      ['Issuer', `${payload.issuer}  key ${payload.keyId}`],
      ['Subject', payload.subject],
      ['Activity', `${payload.activity.id} ${payload.activity.version}`],
      ['Content hash', payload.activity.contentHash],
      ['Conditions', `attempts ${payload.conditions.attempts}, hints ${payload.conditions.hintsUsed}, ${payload.conditions.durationSeconds} s, grader ${payload.conditions.grader} v${payload.conditions.graderVersion}`],
      ['Issued', payload.issuedAt]
    ];
    for (const [key, value] of rows) meta.append(el('dt', null, key), el('dd', null, value));
    const metaWrap = el('div', 'more__body');
    metaWrap.append(meta);
    details.append(metaWrap);
    block.append(details);

    const actions = el('div', 'row');
    const link = el('a', 'n-btn n-btn--primary', 'Send to vault');
    link.href = `${VAULT_ORIGIN}/#receipt=${encodeURIComponent(receipt.token)}`;
    link.rel = 'noopener';
    actions.append(link);
    actions.append(el('span', 'receipt__note', 'The vault checks the signature before anything moves.'));
    block.append(actions);

    body.append(block);
  }
}

function renderAll() {
  renderHero();
  renderPrereq();
  renderPath();
  renderStage();
  renderReceipt();
}

/* ------------------------------------------------------------ controller -- */

function submit(activityId, submission) {
  const activity = ACTIVITIES[activityId];
  if (!activity) return null;
  clearAssertionNote();
  const attempt = attemptFor(activityId);
  const result = grade(activityId, submission);

  attempt.attempts += 1;
  attempt.startedAt = attempt.startedAt || new Date().toISOString();
  attempt.finishedAt = new Date().toISOString();
  attempt.submission = submission;
  attempt.result = result.result;
  attempt.score = result.score;
  attempt.feedback = result.feedback;
  /* partial is honest evidence the worker will sign, so it counts as passed for
     the attempt state machine. The exact result travels in `result`. */
  attempt.status = result.result === 'failed' ? 'failed' : 'passed';
  save();
  renderAll();

  announce(`${activity.title}: ${result.result}. ${result.feedback[0] || ''}`);
  toast(
    result.result === 'failed'
      ? `${activity.title}: not passed. Read the feedback and try again.`
      : `${activity.title}: ${result.result}. A receipt can be issued.`,
    result.result === 'failed' ? 'warn' : 'ok'
  );
  return result;
}

function resetAttempt(activityId) {
  clearAssertionNote();
  const attempt = attemptFor(activityId);
  attempt.result = null;
  attempt.feedback = [];
  attempt.score = 0;
  attempt.submission = null;
  attempt.status = 'in_progress';
  attempt.finishedAt = null;
  /* startedAt survives a retry. The receipt reports time on task for the whole
     activity, so resetting it here would sign "2 attempts in 0 seconds". */
  attempt.startedAt = attempt.startedAt || new Date().toISOString();
  /* A cleared attempt means a blank form: forget the draft, and take the stage
     out of capture so the repaint cannot read the old answers back in. */
  delete drafts[activityId];
  stagedActivityId = null;
  save();
  renderAll();
  announce('Attempt cleared. The service log is editable again.');
}

/**
 * Put the origin back to how a first visitor finds it: no assertion, no
 * attempts, no receipts. Local only, and it never touches a signed token that
 * already left for the vault.
 */
function resetUnit() {
  state = { ...EMPTY_STATE, attempts: {}, receipts: {} };
  prereq = computePrereq();
  assertionNote = '';
  offerNote = '';
  for (const key of Object.keys(drafts)) delete drafts[key];
  stagedActivityId = null;
  save();
  renderAll();
  toast('Unit reset.', 'ok');
  announce('Unit reset. No assertion, no attempts, no receipts.');
}

/** Open an activity in the stage. Navigation only: it never answers anything. */
function startActivity(activityId) {
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return { status: 'unknown-activity', activityId, known: ACTIVITY_ORDER };
  }
  clearAssertionNote();
  state.currentActivityId = activityId;

  const locked = lockedEntry(activityId);
  if (!locked) {
    const attempt = attemptFor(activityId);
    if (attempt.status === 'not_started') {
      attempt.status = 'in_progress';
      attempt.startedAt = new Date().toISOString();
    }
  }
  save();
  renderAll();

  const stage = $('[data-stage-panel]');
  if (stage) {
    stage.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const heading = stage.querySelector('#stage-activity-title');
    if (heading) heading.focus({ preventScroll: true });
  }

  if (locked) {
    return {
      status: 'locked',
      activityId,
      title: activity.title,
      missing: locked.missing.map((need) => ({ concept: need.concept, ability: need.ability, needed: need.needed })),
      reason: activity.lockedReason,
      note: 'The page now shows what is missing. Present a fresh readiness assertion to unlock it.'
    };
  }

  return {
    status: 'started',
    activityId,
    title: activity.title,
    type: activity.type,
    minutes: activity.minutes,
    whatTheLearnerDoes: activity.whatTheLearnerDoes,
    note: 'The learner completes this in the page. Poll get_attempt_status.'
  };
}

function attemptStatus(activityId) {
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return { status: 'unknown-activity', activityId, known: ACTIVITY_ORDER };
  }
  const attempt = state.attempts[activityId];
  if (!attempt) {
    return { status: 'not_started', activityId, attempts: 0, hintsUsed: 0, durationSeconds: 0 };
  }
  const out = {
    status: attempt.status,
    activityId,
    attempts: attempt.attempts,
    hintsUsed: attempt.hintsUsed,
    durationSeconds: durationSeconds(attempt)
  };
  if (attempt.result) out.result = attempt.result;
  if (Array.isArray(attempt.feedback) && attempt.feedback.length) out.feedback = attempt.feedback;
  if (attempt.receiptToken) out.receiptIssued = true;
  return out;
}

/**
 * Issue a receipt for a passed attempt. Idempotent, and single flight: the
 * button and the tool share the same pending promise, so one attempt can never
 * end up with two signed receipts carrying different receipt ids.
 */
function issueReceipt(activityId) {
  clearAssertionNote();
  if (issuing[activityId]) return issuing[activityId];
  const pending = requestReceipt(activityId).finally(() => {
    delete issuing[activityId];
  });
  issuing[activityId] = pending;
  return pending;
}

async function requestReceipt(activityId) {
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return { status: 'unknown-activity', activityId, known: ACTIVITY_ORDER };
  }
  const stored = state.receipts[activityId];
  if (stored) {
    return {
      status: 'issued',
      token: stored.token,
      claims: stored.payload.claims,
      activity: stored.payload.activity,
      hint: 'Take this token to the vault and call stage_evidence_receipt.'
    };
  }

  const attempt = state.attempts[activityId];
  if (!attempt || attempt.status !== 'passed') {
    return {
      status: 'not-passed',
      activityId,
      attemptStatus: attempt ? attempt.status : 'not_started',
      hint: 'The learner has to complete and submit this activity in the page. Poll get_attempt_status.'
    };
  }

  let response;
  try {
    response = await fetch('/api/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activityId,
        submission: attempt.submission,
        learnerKeyId: subjectId(),
        conditions: {
          attempts: attempt.attempts,
          hintsUsed: attempt.hintsUsed,
          durationSeconds: durationSeconds(attempt),
          grader: activity.grader,
          graderVersion: GRADER_VERSION
        }
      })
    });
  } catch (error) {
    return { status: 'error', reason: 'network', message: error && error.message ? error.message : 'fetch failed' };
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data || data.status !== 'issued') {
    return {
      status: data && data.status ? data.status : 'error',
      reason: data && data.reason ? data.reason : `http ${response.status}`
    };
  }

  attempt.receiptToken = data.token;
  state.receipts[activityId] = { token: data.token, payload: data.payload };
  save();
  renderAll();
  const panel = $('[data-receipt-panel]');
  if (panel) panel.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  toast('Evidence receipt signed. Send it to your vault.', 'ok');

  return {
    status: 'issued',
    token: data.token,
    claims: data.payload.claims,
    activity: data.payload.activity,
    hint: 'Take this token to the vault and call stage_evidence_receipt.'
  };
}

/** Verify an assertion minted for this origin and repaint the whole screen. */
async function presentAssertion(assertionToken) {
  const result = await verifyAssertion(assertionToken, { audience: location.origin });
  if (!result.ok) {
    /* A refused token proves nothing, so it also unproves nothing. The assertion
       already on file stays, no status is recomputed and nothing is written: a
       stale or mistyped retry cannot relock a lab in the middle of the unit. */
    assertionNote = `Assertion rejected: ${result.reason}. Nothing on this page changed.`;
    renderPrereq();
    toast(`Assertion rejected: ${result.reason}`, 'error');
    announce(`Assertion rejected: ${result.reason}. The page kept the statuses it already had.`);
    return { status: 'rejected', reason: result.reason };
  }

  assertionNote = '';
  state.assertion = {
    payload: result.payload,
    receivedAt: new Date().toISOString()
  };
  prereq = computePrereq();
  save();
  renderAll();
  toast('Readiness assertion verified. Prerequisites recognised.', 'ok');
  announce(
    `Readiness assertion verified. ${prereq.unlocked.length} of ${ACTIVITY_ORDER.length} activities unlocked, ` +
      `${prereq.skippable.length} already covered by your vault.`
  );

  return {
    status: 'checked',
    learnerKeyId: result.payload.learnerKeyId,
    expiresAt: result.payload.expiresAt,
    recognized: prereq.recognized.map((entry) => ({
      concept: entry.concept,
      ability: entry.ability,
      status: entry.status,
      source: 'readiness-assertion'
    })),
    unlocked: prereq.unlocked.slice(),
    locked: prereq.locked.map((entry) => ({
      activityId: entry.activityId,
      missing: entry.missing.map((need) => ({
        concept: need.concept,
        ability: need.ability,
        needed: need.needed
      }))
    })),
    recommendedFirst: prereq.recommendedFirst,
    skippable: prereq.skippable.slice()
  };
}

function describeOffer() {
  const time = new Date().toLocaleTimeString('en-GB');
  /* The counts are already on screen a line above, so the note only carries
     what is new: the manifest left this page, and when. */
  offerNote = `Manifest handed to the agent at ${time}.`;
  renderHero();
  /* A copy, so a tool caller can never reach into the module the grader uses. */
  return { status: 'ok', manifest: JSON.parse(JSON.stringify(MANIFEST)) };
}

/* --------------------------------------------------------------- startup -- */

/* The nema hex mark, 16 px, in the header badge and the footer badge. Each copy
   gets its own gradient id, so hiding one never blanks the other. */
for (const slot of document.querySelectorAll('[data-nema-mark]')) slot.innerHTML = markSvg();
mountToolsIndicator($('[data-tools-indicator]'));
mountActivityStrip($('[data-activity-strip]'));

/* The unit names itself from the manifest, so the heading can never drift from
   the content the tools describe. */
const heroTitle = $('#hero-title');
if (heroTitle) heroTitle.textContent = MANIFEST.unit.title;

const resetButton = $('[data-action="reset"]');
if (resetButton) resetButton.addEventListener('click', resetUnit);
document.querySelector('[data-other-course]').href = `${ORIGINS.harness}/`;

const startButton = $('[data-start-course]');
if (startButton) {
  startButton.addEventListener('click', () => {
    startActivity(prereq.recommendedFirst || prereq.unlocked[0] || ACTIVITY_ORDER[0]);
  });
}

renderAll();

document.addEventListener('nema:toolcall', () => {
  /* A tool call can change state that another panel renders (an assertion
     unlocks a lab, a receipt fills the token box). Repaint on every call so the
     screen and the transcript never disagree. */
  renderHero();
  renderPath();
});

const { registerSecurityTools } = await import('/tools.js');
await registerSecurityTools({
  describeOffer,
  presentAssertion,
  startActivity,
  attemptStatus,
  issueReceipt
});

/* --------------------------------------------------- paste an assertion -- */

/* The unit has to unlock with no agent in the room. The form under the
   requirements is a declarative WebMCP tool and a plain form at once: an agent
   fills it and submits it, a learner pastes the token their vault minted and
   presses Present. Both end in presentAssertion(), the same function the
   check_prerequisites tool runs. */
const pasteForm = document.querySelector('form[toolname="present_assertion"]');
const pasteStatus = $('[data-assertion-status]');

function sayPasteResult(result) {
  if (!pasteStatus) return;
  if (result && result.status === 'checked') {
    pasteStatus.textContent =
      `Verified. ${result.unlocked.length} of ${ACTIVITY_ORDER.length} activities unlocked.`;
  } else if (result && result.status === 'rejected') {
    pasteStatus.textContent = `Rejected: ${result.reason}. Nothing on this page changed.`;
  } else {
    pasteStatus.textContent = '';
  }
}

if (pasteForm) {
  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    /* A tool call nobody can see is a tool call nobody can audit, so an agent
       submit opens the block it happened in. */
    const wrapper = pasteForm.closest('details');
    if (wrapper) wrapper.open = true;

    const token = String(pasteForm.elements.assertionToken.value || '').trim();
    /* Both runtimes mark an agent submit with agentInvoked before this listener
       runs. It is the only honest test: the native SubmitEvent carries
       respondWith on every submit, and throws if a human's submit answers. */
    const byAgent = event.agentInvoked === true;

    const work = (async () => {
      if (byAgent) {
        /* Send the agent through the canonical imperative tool, so the call is
           timed and appears in the tool activity strip under its real name. The
           native runtime wants its input as a JSON string; the polyfill takes
           either. */
        try {
          const tools = await document.modelContext.getTools();
          const canonical = tools.find((entry) => entry.name === 'check_prerequisites');
          if (canonical) {
            const raw = await document.modelContext.executeTool(
              canonical,
              JSON.stringify({ assertionToken: token })
            );
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
          }
        } catch {
          /* Fall through to the shared function, which is the same code path. */
        }
      }
      return presentAssertion(token);
    })();

    work.then(sayPasteResult, () => sayPasteResult(null));
    /* respondWith takes a promise, and both runtimes want it during dispatch. */
    if (byAgent && typeof event.respondWith === 'function') event.respondWith(work);
  });
}

export { describeOffer, presentAssertion, startActivity, attemptStatus, issueReceipt };

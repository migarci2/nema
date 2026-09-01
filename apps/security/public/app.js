/**
 * nema provider UI: Agent Security.
 *
 * Renders the unit "Feedback Loop Attack Surface" from /content.js and owns all
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
import { injectHeader, injectFooter, toast, copyToClipboard } from '/shared/brand/brand.js';
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

const STATUS_PILL = { verified: 'durable', uncertain: 'uncertain', missing: 'unknown' };

function statusPill(status) {
  return pill(status, STATUS_PILL[status] || 'unknown');
}

function conceptLabel(concept, ability) {
  return `${concept}.${ability}`;
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
  const stats = $('[data-hero-stats]');
  stats.textContent = '';
  const values = [
    { value: String(MANIFEST.unit.estimatedMinutes), label: 'minutes' },
    { value: String(MANIFEST.activities.length), label: 'activities' },
    { value: String(prereq.unlocked.length), label: 'unlocked now' }
  ];
  values.forEach((entry, index) => {
    const stat = el('span', index === 2 ? 'n-stat n-stat--accent' : 'n-stat');
    stat.append(el('span', 'n-stat__value', entry.value), el('span', 'n-stat__label', entry.label));
    stats.append(stat);
  });

  const list = $('[data-hero-requirements]');
  list.textContent = '';
  for (const requirement of prereq.recognized) {
    const item = el('li', 'hero__req-item');
    item.append(el('code', 'mono', conceptLabel(requirement.concept, requirement.ability)));
    item.append(statusPill(requirement.status));
    list.append(item);
  }

  const origin = $('[data-hero-origin]');
  origin.textContent = '';
  /* The origin that actually signs, not the one the manifest advertises: on the
     dev server those differ, and the receipt panel would contradict the hero. */
  origin.append(el('span', null, `${location.origin}, key ${PROVIDER.keyId}`));
  const manifestLink = el('a', 'hero__manifest', 'GET /api/manifest');
  manifestLink.href = '/api/manifest';
  origin.append(manifestLink);

  const note = $('[data-hero-note]');
  note.textContent = offerNote;
  note.hidden = offerNote === '';
}

/* --------------------------------------------------------- prerequisites -- */

function renderPrereq() {
  const body = $('[data-prereq-body]');
  const hint = $('[data-prereq-hint]');
  body.textContent = '';

  if (!state.assertion) {
    hint.textContent = 'no assertion presented';
    const note = el(
      'p',
      'muted',
      'This site holds no account for you and asks for no login. It can read three status bands, and only from a readiness assertion your vault signed for this exact origin.'
    );
    body.append(note);

    const list = el('ul', 'prereq-list');
    for (const requirement of prereq.recognized) {
      const item = el('li', 'prereq-row');
      item.append(el('code', 'mono', conceptLabel(requirement.concept, requirement.ability)));
      item.append(statusPill(requirement.status));
      item.append(el('span', 'prereq-source dim', 'no source'));
      list.append(item);
    }
    body.append(list);

    if (assertionNote) body.append(el('p', 'prereq-alert', assertionNote));
    body.append(
      el(
        'p',
        'dim',
        'Ask the agent to call check_prerequisites with an assertion minted for this origin. The learner approves that disclosure in the vault.'
      )
    );
    return;
  }

  const payload = state.assertion.payload;
  hint.textContent = 'verified assertion';

  const headline = el('p', 'prereq-headline');
  headline.append(el('b', null, 'Prerequisite recognised from another provider.'));
  headline.append(
    document.createTextNode(
      ' Your vault answered for three concepts this unit assumes. Nothing else was disclosed.'
    )
  );
  body.append(headline);

  /* A rejected token never unseats the assertion the learner already approved.
     The alert says what was refused, above the statuses that are still standing. */
  if (assertionNote) body.append(el('p', 'prereq-alert', assertionNote));

  const list = el('ul', 'prereq-list');
  for (const requirement of prereq.recognized) {
    const item = el('li', 'prereq-row');
    item.append(el('code', 'mono', conceptLabel(requirement.concept, requirement.ability)));
    item.append(statusPill(requirement.status));
    item.append(el('span', 'prereq-source dim', 'readiness assertion'));
    list.append(item);
  }
  body.append(list);

  const meta = el('dl', 'prereq-meta mono');
  const rows = [
    ['learner id', payload.learnerKeyId],
    ['audience', payload.audience],
    ['purpose', payload.purpose],
    ['expires', payload.expiresAt]
  ];
  for (const [key, value] of rows) {
    meta.append(el('dt', 'dim', key), el('dd', null, value));
  }
  body.append(meta);

  body.append(
    el(
      'p',
      'dim',
      'Verified against the vault key embedded in the token, bound to this origin, and honoured only until it expires.'
    )
  );
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

    row.append(el('span', 'act__index mono', String(index + 1).padStart(2, '0')));

    const main = el('span', 'act__main');
    const head = el('span', 'act__head');
    head.append(el('span', 'act__title', activity.title));
    head.append(pill(activity.type, 'unknown'));
    if (attempt && (attempt.status === 'passed' || attempt.status === 'failed')) {
      head.append(pill(attempt.result, attempt.result === 'failed' ? 'danger' : 'usable'));
    }
    if (skippable) head.append(pill('skip: already verified', 'usable'));
    if (prereq.recommendedFirst === activityId) head.append(pill('recommended', 'durable'));
    main.append(head);

    if (locked) {
      main.append(el('span', 'act__reason', activity.lockedReason));
      const missing = el('ul', 'act__missing');
      for (const need of locked.missing) {
        const item = el('li', 'mono');
        item.append(el('code', null, conceptLabel(need.concept, need.ability)));
        item.append(el('span', 'dim', ` needs ${need.needed}`));
        missing.append(item);
      }
      main.append(missing);
    } else if (skippable) {
      main.append(el('span', 'act__reason', activity.skipReason));
    } else {
      main.append(el('span', 'act__reason', activity.includeReason));
      if (activity.unlockReason) main.append(el('span', 'act__unlock', activity.unlockReason));
    }
    row.append(main);

    const end = el('span', 'act__end');
    end.append(el('span', 'act__minutes mono', `${activity.minutes} min`));
    if (locked) {
      end.append(pill('locked', 'due'));
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

  const total = el('p', 'acts__total');
  total.append(el('span', 'dim', 'unit total'));
  total.append(el('b', 'display', String(MANIFEST.unit.estimatedMinutes)));
  total.append(el('span', 'dim', 'minutes, graded on this origin'));
  body.append(total);
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
    hint.textContent = 'nothing open';
    body.append(el('div', 'n-empty', 'No activity open'));
    body.append(
      el(
        'p',
        'muted stage__empty',
        'Pick an activity above, or ask the agent to call start_activity. The agent can open an activity and poll it. It can never answer one: no tool on this page accepts an answer.'
      )
    );
    return;
  }

  hint.textContent = `${activityId}, ${activity.minutes} min`;

  const head = el('div', 'stage__head');
  const heading = el('h3', 'stage__title', activity.title);
  heading.id = 'stage-activity-title';
  heading.tabIndex = -1;
  head.append(heading);
  const tags = el('div', 'row row--tight');
  tags.append(pill(activity.type, 'unknown'));
  tags.append(pill(activity.difficulty, 'unknown'));
  tags.append(pill(`grader ${activity.grader}`, 'unknown'));
  head.append(tags);
  head.append(el('p', 'stage__does', activity.whatTheLearnerDoes));
  body.append(head);

  const locked = lockedEntry(activityId);
  if (locked) {
    const lock = el('div', 'lockbox');
    lock.append(el('p', 'lockbox__title', activity.lockedReason));
    const missing = el('ul', 'lockbox__list');
    for (const need of locked.missing) {
      const item = el('li', 'mono');
      item.append(el('code', null, conceptLabel(need.concept, need.ability)));
      item.append(el('span', 'dim', ` needs ${need.needed}, your vault says ${statusMap()[`${need.concept}|${need.ability}`] || 'missing'}`));
      missing.append(item);
    }
    lock.append(missing);
    lock.append(
      el(
        'p',
        'dim',
        'Close the gap anywhere you like: another provider, your own work, or a coached session your vault records. Present a fresh assertion and this lab unlocks.'
      )
    );
    body.append(lock);
    return;
  }

  if (activity.type === 'lesson') renderLesson(body, activity);
  else if (activityId === 'feedback-loop-attack-surface') renderAttackSurfaceLab(body, activity);
  else renderTriageLab(body, activity);

  body.append(renderHints(activity));
  body.append(renderFeedback(activity));
}

function renderHints(activity) {
  const attempt = attemptFor(activity.id);
  const wrap = el('div', 'hints');
  const hints = Array.isArray(activity.hints) ? activity.hints : [];
  if (hints.length === 0) return wrap;

  const shown = Math.min(attempt.hintsUsed, hints.length);
  const list = el('ul', 'hints__list');
  for (let i = 0; i < shown; i += 1) {
    list.append(el('li', 'hints__item', hints[i]));
  }
  wrap.append(list);

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
    wrap.append(el('span', 'dim', `${hints.length - shown} hint${hints.length - shown === 1 ? '' : 's'} left. Hints used go into the receipt conditions.`));
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
  /* Labelled, because these three numbers go into the receipt conditions and a
     bare run of digits reads as one number. */
  head.append(el('span', 'mono dim', `score ${Number(attempt.score || 0).toFixed(2)}`));
  head.append(el('span', 'mono dim', `attempts ${attempt.attempts}`));
  head.append(el('span', 'mono dim', `time ${durationSeconds(attempt)} s`));
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
  points.append(el('p', 'lesson__points-label mono', 'Key points'));
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
  actions.append(
    el('span', 'dim', 'Marking a lesson records exposure evidence only, the lowest weight the vault accepts.')
  );
  wrap.append(actions);

  body.append(wrap);
}

/* ----------------------------------------------- lab: the untrusted surface -- */

/* A mitigation `detail` may open with a sentence that names the verdict itself
   ("Harmful. ...", "Neutral for prevention, ..."). That sentence is feedback,
   not briefing: printed on an ungraded card it hands over the answer the lab is
   asking for, so it is held back until the attempt is graded and shown next to
   the kind pill. The strings still live in content.js, this only decides when
   each half appears. Reported upstream: content.js should carry the verdict in
   a field of its own so no parsing is needed here. */
const VERDICT_LEAD = /^(Harmful|Neutral|Effective)\b[^.]*\.\s+/;

function splitVerdict(detail) {
  const text = typeof detail === 'string' ? detail : '';
  const match = VERDICT_LEAD.exec(text);
  if (!match) return { verdict: '', body: text };
  return { verdict: match[0].trim(), body: text.slice(match[0].length) };
}

function renderAttackSurfaceLab(body, activity) {
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
  traceSet.append(el('legend', 'lab__legend', 'Trace, ten steps. Mark every tool result authored outside your trust boundary.'));
  traceSet.append(
    el(
      'p',
      'dim',
      'Only tool results can be marked. The principal request and the agent own steps are shown for context, because the last call is built from all of them.'
    )
  );

  const trace = el('ol', 'trace');
  for (const entry of activity.trace) {
    const item = el('li', 'trace__item');
    item.dataset.actor = entry.actor;
    if (graded) {
      if (entry.injected) item.dataset.mark = 'injected';
      else if (entry.untrusted) item.dataset.mark = 'outside';
      else item.dataset.mark = 'inside';
    }

    const rail = el('span', 'trace__rail');
    rail.append(el('span', 'trace__step mono', String(entry.step).padStart(2, '0')));
    item.append(rail);

    const main = el('div', 'trace__main');
    const head = el('div', 'trace__head');
    head.append(el('span', `trace__actor trace__actor--${entry.actor}`, entry.actor));
    head.append(el('span', 'trace__label mono', entry.label));
    main.append(head);
    main.append(el('p', 'trace__source dim', `source: ${entry.source}`));

    const content = el('pre', 'trace__content');
    content.textContent = entry.content;
    main.append(content);

    if (entry.actor === 'tool') {
      const label = el('label', 'n-check trace__check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'untrusted';
      input.value = entry.id;
      input.checked = picked.has(entry.id);
      input.disabled = graded;
      label.append(input, el('span', null, 'untrusted, authored outside the boundary'));
      main.append(label);
    }

    if (graded) {
      const badge = el('div', 'trace__verdict');
      if (entry.injected) badge.append(pill('injected instruction', 'danger'));
      else if (entry.untrusted) badge.append(pill('outside author', 'due'));
      else badge.append(pill('inside the boundary', 'usable'));
      badge.append(el('span', 'trace__why', entry.why));
      main.append(badge);
    }

    item.append(main);
    trace.append(item);
  }
  traceSet.append(trace);
  form.append(traceSet);

  const mitSet = el('fieldset', 'lab__set');
  mitSet.append(el('legend', 'lab__legend', 'Mitigations. Choose the ones you would actually ship.'));
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
    const detail = splitVerdict(mitigation.detail);
    /* A bare "Harmful." repeats the pill, so only a verdict that says more than
       the kind is worth a line of its own. */
    const saysMore = detail.verdict.replace(/\.$/, '').toLowerCase() !== mitigation.kind;
    if (graded && detail.verdict && saysMore) card.append(el('span', 'mit__verdict', detail.verdict));
    card.append(el('span', 'mit__detail', detail.body));
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
    actions.append(el('span', 'dim', 'Graded on this origin. The agent has no tool that can answer for you.'));
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
    legend.append(el('span', 'incident__index mono', `incident ${index + 1} of ${activity.incidents.length}`));
    legend.append(el('span', 'incident__summary', incident.summary));
    card.append(legend);

    const evidence = el('div', 'incident__evidence');
    evidence.append(el('p', 'incident__evidence-label mono', 'Captured evidence'));
    for (const line of incident.evidence) {
      const row = el('pre', 'incident__line');
      row.textContent = line;
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
    actions.append(el('span', 'dim', 'One action per incident. Over triage has a cost and the grader counts it.'));
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
    body.append(el('div', 'n-empty', 'No receipt issued yet'));
    body.append(
      el(
        'p',
        'muted stage__empty',
        'Pass a lab and this panel fills with a signed evidence receipt: the token, the claims inside it, and a link that hands it to your vault. This origin keeps no copy of your answers.'
      )
    );
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
    const head = el('span', 'n-token__head', `evidence receipt, ${activityId}`);
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

    const meta = el('dl', 'receipt__meta mono');
    const rows = [
      ['receipt', payload.receiptId],
      ['issuer', `${payload.issuer}  key ${payload.keyId}`],
      ['subject', payload.subject],
      ['activity', `${payload.activity.id} ${payload.activity.version}`],
      ['content hash', payload.activity.contentHash],
      ['conditions', `attempts ${payload.conditions.attempts}, hints ${payload.conditions.hintsUsed}, ${payload.conditions.durationSeconds} s, grader ${payload.conditions.grader} v${payload.conditions.graderVersion}`],
      ['issued', payload.issuedAt]
    ];
    for (const [key, value] of rows) meta.append(el('dt', 'dim', key), el('dd', null, value));
    block.append(meta);

    const actions = el('div', 'row');
    const link = el('a', 'n-btn n-btn--primary', 'Send to vault');
    link.href = `${VAULT_ORIGIN}/#receipt=${encodeURIComponent(receipt.token)}`;
    link.rel = 'noopener';
    actions.append(link);
    actions.append(
      el('span', 'dim', 'The vault verifies the signature against its issuer list before anything moves.')
    );
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
  announce('Attempt cleared. The trace is editable again.');
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
  offerNote =
    `Manifest handed to the agent at ${time}: ${MANIFEST.activities.length} activities, ` +
    `${MANIFEST.unit.estimatedMinutes} minutes, ${MANIFEST.requirements.length} requirements.`;
  renderHero();
  /* A copy, so a tool caller can never reach into the module the grader uses. */
  return { status: 'ok', manifest: JSON.parse(JSON.stringify(MANIFEST)) };
}

/* --------------------------------------------------------------- startup -- */

injectHeader({ app: 'security', title: 'Agent Security' });
injectFooter({ note: 'Agent Security. Deterministic grading, signed receipts, no account.' });
mountActivityStrip($('[data-activity-strip]'));
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

export { describeOffer, presentAssertion, startActivity, attemptStatus, issueReceipt };

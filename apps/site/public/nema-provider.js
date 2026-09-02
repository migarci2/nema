/**
 * nema provider embed: the one tag install (contract section 21).
 *
 * A site that teaches something installs nema with a manifest and one script:
 *
 *   <script type="application/nema+json">{ ...LearningManifest... }</script>
 *   <script type="module" src="https://nema.migarci2.dev/nema-provider.js"></script>
 *
 * With no backend and no account this module then:
 *
 *   - registers the five provider tools of contract section 10 with the exact
 *     names, schemas and return shapes (describe_learning_offer,
 *     personalize_learning_path, start_activity, get_attempt_status,
 *     issue_evidence_receipt), plus the declarative form
 *     <form toolname="present_assertion"> with one textarea, so a person or an
 *     agent can hand over a vault assertion;
 *   - renders one quiet block (the lesson button, the quiz, the personalised
 *     path note, the receipt with Copy and Send to vault) where the page puts
 *     <nema-activities>, or at the end of <main> or <article>;
 *   - grades the quiz deterministically in the page;
 *   - signs receipts with a per origin key generated in localStorage on first
 *     use, so the receipt carries keyId "self:<origin>" and issuerKey (the
 *     public JWK) and is self certifying. The vault caps self signed evidence
 *     at the self-report weight, which is the honest weight for a quiz whose
 *     answer key is in the page source.
 *
 * ---------------------------------------------------------------------------
 * How the helpers are resolved (one rule, no configuration)
 * ---------------------------------------------------------------------------
 *
 * The shared modules live in a `shared/` directory next to this file and are
 * resolved as `new URL('./shared/<name>.js', import.meta.url)`. That is exactly
 * how the hub serves them: this module is published at `/nema-provider.js` and
 * `scripts/build.sh` copies `shared/` to `/shared/`, so from a blog on another
 * origin the imports become `https://nema.migarci2.dev/shared/webmcp.js` and so
 * on. The imports are dynamic for that reason: a static specifier would be
 * resolved against this source file inside the repo instead. Anyone self
 * hosting the embed copies `nema-provider.js` plus the `shared/` directory and
 * serves both with `Access-Control-Allow-Origin: *`, which is what
 * `apps/site/public/_headers` does for the hub.
 *
 * ---------------------------------------------------------------------------
 * Node
 * ---------------------------------------------------------------------------
 *
 * Importing this module in Node registers nothing and touches no network: the
 * browser half runs behind a `document` guard at the bottom of the file, and
 * every function above it is pure. `test/embed.test.js` imports this file
 * directly and calls those functions.
 *
 * Optional attributes on the script tag:
 *   data-endpoint="/api/receipt"  post the submission for server signing (same
 *                                 body as section 10). The server's receipt
 *                                 replaces the self signed one; if the request
 *                                 fails the self signed receipt is used.
 *   data-vault="https://..."      vault origin for the Send to vault link.
 *                                 Default: the nema vault for this environment.
 */

export const EMBED_VERSION = '0.1.0';
export const PROTOCOL = 'nema/0.1';

/** localStorage document for this origin: the issuer key and the attempts. */
export const STORAGE_KEY = 'nema.embed.v1';

/** Ability to evidence type, contract section 3. */
export const EVIDENCE_TYPES = Object.freeze({
  recognize: 'recognition',
  retrieve: 'retrieval',
  explain: 'explanation',
  apply: 'application',
  transfer: 'transfer',
  discriminate: 'discrimination'
});

/**
 * Graders an embedded activity can claim, contract section 21. A quiz is graded
 * deterministically in the page; a lesson only ever proves exposure.
 */
export const GRADERS = Object.freeze({
  quiz: 'deterministic',
  lesson: 'exposure'
});

const ABILITY_ORDER = ['recognize', 'retrieve', 'explain', 'apply', 'transfer'];

// ---------------------------------------------------------------------------
// pure: the manifest
// ---------------------------------------------------------------------------

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`nema manifest: ${field} must be a non-empty string`);
  }
  return value;
}

function num(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`nema manifest: ${field} must be a number`);
  }
  return value;
}

function pairs(list, field) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`nema manifest: ${field} must be an array`);
  return list.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`nema manifest: ${field}[${index}] must be an object`);
    const out = {
      concept: str(entry.concept, `${field}[${index}].concept`),
      ability: str(entry.ability, `${field}[${index}].ability`)
    };
    if (entry.status !== undefined) out.status = str(entry.status, `${field}[${index}].status`);
    return out;
  });
}

/** The evidence type of the strongest outcome, used for the activity summary. */
function strongestEvidence(outcomes) {
  let best = null;
  for (const outcome of outcomes) {
    if (outcome.ability === 'discriminate') {
      if (!best) best = outcome.ability;
      continue;
    }
    if (best === null || ABILITY_ORDER.indexOf(outcome.ability) > ABILITY_ORDER.indexOf(best)) {
      best = outcome.ability;
    }
  }
  return best ? EVIDENCE_TYPES[best] || 'recognition' : 'recognition';
}

function normalizeQuestions(raw, activityId) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`nema manifest: ${activityId}.questions must be an array`);
  return raw.map((question, index) => {
    const where = `${activityId}.questions[${index}]`;
    if (!isObject(question)) throw new Error(`nema manifest: ${where} must be an object`);
    const options = Array.isArray(question.options) ? question.options : null;
    if (!options || options.length < 2) {
      throw new Error(`nema manifest: ${where}.options must have at least two entries`);
    }
    const normalized = {
      id: str(question.id, `${where}.id`),
      prompt: str(question.prompt, `${where}.prompt`),
      options: options.map((option, optionIndex) => ({
        id: str(option.id, `${where}.options[${optionIndex}].id`),
        text: str(option.text, `${where}.options[${optionIndex}].text`)
      })),
      answer: str(question.answer, `${where}.answer`)
    };
    if (!normalized.options.some((option) => option.id === normalized.answer)) {
      throw new Error(`nema manifest: ${where}.answer is not one of the options`);
    }
    if (question.why !== undefined) normalized.why = str(question.why, `${where}.why`);
    return normalized;
  });
}

/**
 * Parse the JSON of a <script type="application/nema+json"> block.
 *
 * Returns the public LearningManifest of contract 5.1 and, separately, the
 * internal activities. The split is the point: the manifest an agent reads
 * through `describe_learning_offer` carries no questions and no answer key,
 * exactly like a hosted provider.
 *
 * @param {string} text the JSON source
 * @param {{ origin: string }} context the origin installing the embed
 * @returns {{ manifest: object, activities: Record<string, object> }}
 */
export function parseManifest(text, { origin } = {}) {
  str(origin, 'origin');
  let raw;
  try {
    raw = JSON.parse(String(text));
  } catch (err) {
    throw new Error(`nema manifest: not valid JSON (${err.message})`);
  }
  if (!isObject(raw)) throw new Error('nema manifest: the JSON must be an object');
  if (raw.protocol !== undefined && raw.protocol !== PROTOCOL) {
    throw new Error(`nema manifest: expected protocol ${PROTOCOL}, got ${String(raw.protocol)}`);
  }
  if (!isObject(raw.unit)) throw new Error('nema manifest: unit must be an object');
  if (!Array.isArray(raw.activities) || raw.activities.length === 0) {
    throw new Error('nema manifest: activities must be a non-empty array');
  }

  const provider = isObject(raw.provider) ? raw.provider : {};
  const activities = {};
  const publicActivities = [];
  const outcomeIndex = new Map();

  for (const [index, entry] of raw.activities.entries()) {
    if (!isObject(entry)) throw new Error(`nema manifest: activities[${index}] must be an object`);
    const id = str(entry.id, `activities[${index}].id`);
    const type = str(entry.type, `${id}.type`);
    const outcomes = pairs(entry.outcomes, `${id}.outcomes`);
    const questions = normalizeQuestions(entry.questions, id);
    if (type === 'quiz' && questions.length === 0) {
      throw new Error(`nema manifest: ${id} is a quiz with no questions`);
    }
    const grader = entry.grader ? str(entry.grader, `${id}.grader`) : GRADERS[type] || GRADERS.lesson;
    const activity = {
      id,
      type,
      title: str(entry.title, `${id}.title`),
      version: entry.version ? str(entry.version, `${id}.version`) : '1.0.0',
      minutes: num(entry.minutes, `${id}.minutes`, 0),
      grader,
      evidenceProduced: strongestEvidence(outcomes),
      outcomes,
      skipIf: pairs(entry.skipIf, `${id}.skipIf`),
      onlyIf: pairs(entry.onlyIf, `${id}.onlyIf`),
      questions,
      whatTheLearnerDoes:
        entry.whatTheLearnerDoes !== undefined
          ? str(entry.whatTheLearnerDoes, `${id}.whatTheLearnerDoes`)
          : type === 'quiz'
            ? 'Answers the questions in the page and presses Submit.'
            : 'Reads the page and presses Mark as read.',
      difficulty: entry.difficulty ? str(entry.difficulty, `${id}.difficulty`) : 'introductory'
    };
    activities[id] = activity;

    publicActivities.push({
      id: activity.id,
      type: activity.type,
      title: activity.title,
      minutes: activity.minutes,
      evidenceProduced: activity.evidenceProduced,
      grader: activity.grader,
      outcomes: activity.outcomes,
      skipIf: activity.skipIf
    });

    for (const outcome of outcomes) {
      outcomeIndex.set(`${outcome.concept}|${outcome.ability}`, outcome);
    }
  }

  const totalMinutes = publicActivities.reduce((sum, entry) => sum + entry.minutes, 0);

  const manifest = {
    protocol: PROTOCOL,
    provider: {
      origin,
      name: provider.name ? str(provider.name, 'provider.name') : origin,
      keyId: selfKeyId(origin)
    },
    unit: {
      id: str(raw.unit.id, 'unit.id'),
      version: raw.unit.version ? str(raw.unit.version, 'unit.version') : '1.0.0',
      title: str(raw.unit.title, 'unit.title'),
      estimatedMinutes: num(raw.unit.estimatedMinutes, 'unit.estimatedMinutes', totalMinutes),
      language: raw.unit.language ? str(raw.unit.language, 'unit.language') : 'en',
      price: raw.unit.price ? str(raw.unit.price, 'unit.price') : 'free'
    },
    outcomes: Array.from(outcomeIndex.values()).map((outcome) => ({
      concept: outcome.concept,
      ability: outcome.ability
    })),
    requirements: pairs(raw.requirements, 'requirements'),
    activities: publicActivities
  };

  return { manifest, activities };
}

/** The keyId a self certifying embed signs with. */
export function selfKeyId(origin) {
  return `self:${str(origin, 'origin')}`;
}

// ---------------------------------------------------------------------------
// pure: grading
// ---------------------------------------------------------------------------

/**
 * Grade a quiz submission deterministically.
 *
 * @param {object} activity a normalized activity with questions
 * @param {{ answers: Record<string, string> }} submission
 * @returns {{ result: 'passed'|'partial'|'failed', score: number,
 *             correct: number, total: number, feedback: string[],
 *             perQuestion: Array<{id: string, correct: boolean}>,
 *             claims: Array<object> }}
 */
export function gradeQuiz(activity, submission) {
  if (!isObject(activity) || !Array.isArray(activity.questions)) {
    throw new Error('gradeQuiz needs a normalized activity');
  }
  const answers = isObject(submission) && isObject(submission.answers) ? submission.answers : {};
  const total = activity.questions.length;
  const feedback = [];
  const perQuestion = [];
  let correct = 0;

  activity.questions.forEach((question, index) => {
    const given = answers[question.id];
    const ok = given === question.answer;
    if (ok) correct += 1;
    perQuestion.push({ id: question.id, correct: ok });
    const label = `Question ${index + 1}`;
    if (given === undefined || given === null || given === '') {
      feedback.push(`${label}: no answer.${question.why ? ` ${question.why}` : ''}`);
    } else if (ok) {
      feedback.push(`${label}: correct.${question.why ? ` ${question.why}` : ''}`);
    } else {
      feedback.push(`${label}: not right.${question.why ? ` ${question.why}` : ''}`);
    }
  });

  const score = total === 0 ? 0 : correct / total;
  const result = correct === total ? 'passed' : score >= 0.5 ? 'partial' : 'failed';

  return {
    result,
    score,
    correct,
    total,
    feedback,
    perQuestion,
    claims: claimsFor(activity, result)
  };
}

/** Mark a lesson as read: exposure evidence, nothing more. */
export function gradeExposure(activity) {
  return {
    result: 'passed',
    score: 1,
    correct: 1,
    total: 1,
    feedback: ['Marked as read. Reading is exposure evidence, the weakest kind, and it is recorded as exactly that.'],
    perQuestion: [],
    claims: claimsFor(activity, 'passed')
  };
}

function claimsFor(activity, result) {
  return activity.outcomes.map((outcome) => ({
    concept: outcome.concept,
    ability: outcome.ability,
    evidenceType: EVIDENCE_TYPES[outcome.ability] || 'recognition',
    result,
    difficulty: activity.difficulty || 'introductory'
  }));
}

// ---------------------------------------------------------------------------
// pure: personalisation
// ---------------------------------------------------------------------------

function satisfies(assertions, entry) {
  const found = assertions.find(
    (item) => item.concept === entry.concept && item.ability === entry.ability
  );
  if (!found) return false;
  const wanted = entry.status || 'verified';
  if (wanted === 'verified') return found.status === 'verified';
  if (wanted === 'uncertain') return found.status === 'verified' || found.status === 'uncertain';
  return found.status === wanted;
}

/**
 * Rebuild the path from a verified ReadinessAssertion payload.
 *
 * Same rules as a hosted provider (contract 5.1): an activity is skipped when
 * every `skipIf` entry is satisfied, and an activity with `onlyIf` is included
 * only when every entry matches exactly.
 *
 * @param {object} manifest the public manifest from parseManifest
 * @param {object} assertion a verified ReadinessAssertion payload
 * @returns {{ requirements: Array<object>, path: Array<object>,
 *             skipped: Array<object>, fullMinutes: number, personalMinutes: number }}
 */
export function personalize(manifest, assertion) {
  const assertions = isObject(assertion) && Array.isArray(assertion.assertions)
    ? assertion.assertions
    : [];

  const requirements = (manifest.requirements || []).map((requirement) => {
    const found = assertions.find(
      (entry) => entry.concept === requirement.concept && entry.ability === requirement.ability
    );
    return {
      concept: requirement.concept,
      ability: requirement.ability,
      status: found ? found.status : 'missing'
    };
  });

  const path = [];
  const skipped = [];
  let fullMinutes = 0;

  for (const activity of manifest.activities) {
    fullMinutes += activity.minutes;

    const skipRules = activity.skipIf || [];
    const skip = skipRules.length > 0 && skipRules.every((entry) => satisfies(assertions, entry));
    if (skip) {
      skipped.push({
        activityId: activity.id,
        title: activity.title,
        minutes: activity.minutes,
        reason: `Already ${skipRules.map((entry) => `${entry.status || 'verified'}: ${entry.concept}.${entry.ability}`).join(', ')}`
      });
      continue;
    }

    const onlyRules = activity.onlyIf || [];
    if (onlyRules.length > 0 && !onlyRules.every((entry) => satisfies(assertions, entry))) {
      skipped.push({
        activityId: activity.id,
        title: activity.title,
        minutes: activity.minutes,
        reason: 'Not needed for this learner'
      });
      continue;
    }

    const unmet = skipRules.filter((entry) => !satisfies(assertions, entry));
    path.push({
      activityId: activity.id,
      title: activity.title,
      minutes: activity.minutes,
      type: activity.type,
      reason:
        unmet.length > 0
          ? `Not yet verified: ${unmet.map((entry) => `${entry.concept}.${entry.ability}`).join(', ')}`
          : 'Always in the path'
    });
  }

  return {
    requirements,
    path,
    skipped,
    fullMinutes,
    personalMinutes: path.reduce((sum, entry) => sum + entry.minutes, 0)
  };
}

// ---------------------------------------------------------------------------
// pure: the receipt
// ---------------------------------------------------------------------------

/**
 * The arguments a self certifying EvidenceReceipt is built from.
 *
 * The receipt itself is built by `buildReceiptPayload` in shared/protocol.js:
 * one builder for every issuer in nema, hosted or embedded, so a receipt signed
 * by a blog has exactly the shape the vault verifies. What this adds is the
 * self certifying part of contract section 21: `keyId` is `self:<origin>` and
 * `issuerKey` is the public JWK the signature verifies against, so a vault that
 * has never heard of the site can still check the signature and file the
 * receipt in the `self` trust tier.
 *
 * @param {object} input
 * @returns {object} the argument object for buildReceiptPayload
 */
export function selfReceiptInput({ origin, issuerKey, subject, activity, grading, attempt, now, receiptId }) {
  return {
    issuer: str(origin, 'origin'),
    keyId: selfKeyId(origin),
    issuerKey,
    subject: str(subject, 'subject'),
    activity: {
      id: activity.id,
      version: activity.version || '1.0.0',
      title: activity.title,
      ...(activity.contentHash ? { contentHash: activity.contentHash } : {})
    },
    claims: grading.claims,
    conditions: buildConditions(activity, attempt),
    now,
    receiptId
  };
}

/** The condition block a receipt carries, contract 5.4. */
export function buildConditions(activity, attempt) {
  return {
    attempts: attempt.attempts || 1,
    hintsUsed: attempt.hintsUsed || 0,
    durationSeconds: Math.max(0, Math.round(attempt.durationSeconds || 0)),
    grader: activity.grader,
    graderVersion: '1'
  };
}

// ---------------------------------------------------------------------------
// the browser half
// ---------------------------------------------------------------------------

const IN_BROWSER = typeof document !== 'undefined' && typeof window !== 'undefined';

/** One rule for every helper: shared/<name>.js next to this module. */
function helperUrl(name) {
  return new URL(`./shared/${name}`, import.meta.url).href;
}

const MARK_SVG =
  '<svg viewBox="0 0 64 64" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<defs><linearGradient id="nema-embed-mark" x1="32" y1="4" x2="58" y2="34" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#00E5FF"/><stop offset="0.5" stop-color="#15C4B4"/>' +
  '<stop offset="1" stop-color="#3A78FF"/></linearGradient></defs>' +
  '<path d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z" fill="none" stroke="url(#nema-embed-mark)" stroke-width="5"/>' +
  '<g fill="currentColor"><rect x="22" y="22" width="20" height="6"/><rect x="22" y="28" width="6" height="16"/>' +
  '<rect x="36" y="28" width="6" height="16"/></g></svg>';

const STYLE = `
.nema-embed{margin:3rem 0 0;padding-top:1.5rem;font:inherit;color:inherit;
  border-top:1px solid rgba(128,128,128,.35);border-top:1px solid color-mix(in oklab, currentColor 22%, transparent)}
.nema-embed *{box-sizing:border-box}
.nema-embed h2{font:inherit;font-weight:600;font-size:1em;margin:0 0 .35em}
.nema-embed p{margin:0 0 .75em}
.nema-embed ol,.nema-embed ul{margin:0;padding:0;list-style:none}
.nema-embed-sub{opacity:.7;font-size:.9em}
.nema-embed-section{margin:0 0 1.75rem}
.nema-embed-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:.75rem}
.nema-embed-btn{display:inline-block;font:inherit;font-size:.95em;color:inherit;background:transparent;
  cursor:pointer;text-decoration:none;padding:.35em .8em;border:1px solid rgba(128,128,128,.5);
  border:1px solid color-mix(in oklab, currentColor 35%, transparent);border-radius:2px}
.nema-embed-btn:hover{border-color:currentColor;text-decoration:none}
.nema-embed-btn[disabled]{cursor:default;opacity:.55;border-style:dashed}
.nema-embed-btn:focus-visible,.nema-embed a:focus-visible,.nema-embed textarea:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.nema-embed-q{margin:0 0 1.25rem;padding:0;border:0;min-width:0}
.nema-embed-q legend{display:block;width:100%;padding:0;margin:0 0 .5em;font-weight:600}
.nema-embed-opt{display:flex;gap:.55em;align-items:flex-start;margin:0 0 .35em;cursor:pointer}
.nema-embed-opt input{margin:.3em 0 0;flex:none}
.nema-embed-note{margin:.75em 0 0;padding-left:.9em;
  border-left:2px solid rgba(128,128,128,.5);border-left:2px solid color-mix(in oklab, currentColor 30%, transparent)}
.nema-embed-receipt{margin:0 0 1.5rem}
.nema-embed-token{display:block;width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:.78em;line-height:1.5;word-break:break-all;max-height:6.5em;overflow:auto;
  padding:.6em;margin:.5em 0;background:rgba(128,128,128,.08);
  background:color-mix(in oklab, currentColor 7%, transparent)}
.nema-embed textarea{display:block;width:100%;min-height:5.5em;font:inherit;font-size:.85em;color:inherit;
  background:transparent;padding:.5em;border:1px solid rgba(128,128,128,.5);
  border:1px solid color-mix(in oklab, currentColor 30%, transparent);border-radius:2px}
.nema-embed details summary{cursor:pointer}
.nema-embed-foot{display:flex;align-items:center;gap:.45em;font-size:.85em;opacity:.75;margin-top:1.5rem}
.nema-embed-foot a{color:inherit;display:inline-flex;align-items:center;gap:.45em;text-decoration:none}
.nema-embed-foot a:hover{text-decoration:underline}
.nema-embed-foot svg{display:block}
.nema-embed[data-flash="true"]{animation:nema-embed-flash 1.2s ease-out 1}
@keyframes nema-embed-flash{from{background:rgba(128,128,128,.14)}to{background:transparent}}
@media (prefers-reduced-motion:reduce){.nema-embed[data-flash="true"]{animation:none}}
`;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

async function boot() {
  const source = document.querySelector('script[type="application/nema+json"]');
  if (!source) {
    console.warn('[nema] no <script type="application/nema+json"> on this page, nothing to install');
    return;
  }

  let parsed;
  try {
    parsed = parseManifest(source.textContent, { origin: location.origin });
  } catch (err) {
    console.warn(`[nema] ${err.message}`);
    return;
  }
  const { manifest, activities } = parsed;

  const own = ownScript();
  const options = {
    endpoint: own && own.dataset.endpoint ? new URL(own.dataset.endpoint, location.href).href : null,
    vault: own && own.dataset.vault ? own.dataset.vault.replace(/\/$/, '') : null
  };

  await ensureModelContext();
  const [{ registerTools, EXPOSED_TO }, protocol, crypto, origins] = await Promise.all([
    import(helperUrl('webmcp.js')),
    import(helperUrl('protocol.js')),
    import(helperUrl('crypto.js')),
    import(helperUrl('origins.js'))
  ]);

  const vaultOrigin = options.vault || origins.ORIGINS.vault;
  const hubOrigin = origins.ORIGINS.site;

  const store = openStore(manifest.unit.id);
  const issuerKey = await ensureIssuerKey(store, crypto);
  const contentHash = await crypto.sha256(JSON.stringify(activities));

  const app = {
    manifest,
    activities,
    options,
    vaultOrigin,
    hubOrigin,
    store,
    issuerKey,
    contentHash,
    protocol,
    crypto,
    assertion: store.read().assertion || null,
    personal: null,
    message: null
  };

  const view = mount(app);
  app.render = () => view.render();
  if (app.assertion) app.personal = personalize(manifest, app.assertion.payload);
  view.render();

  await registerEmbedTools(app, registerTools, EXPOSED_TO);
  console.log(`[nema] embed ${EMBED_VERSION} ready for ${manifest.unit.id} on ${location.origin}`);
}

/**
 * Native WebMCP is used when the browser has it. Otherwise the Google polyfill
 * that ships next to this file is installed, so the one tag install behaves the
 * same in a browser without WebMCP.
 */
function ensureModelContext() {
  if (document.modelContext) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = helperUrl('webmcp-polyfill.js');
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn('[nema] the WebMCP polyfill did not load, the page still works without an agent');
      resolve();
    };
    document.head.appendChild(script);
  });
}

/** The <script> tag that loaded this module, for its data- attributes. */
function ownScript() {
  const here = import.meta.url;
  for (const script of document.querySelectorAll('script[src]')) {
    try {
      if (new URL(script.src, location.href).href === here) return script;
    } catch {
      /* ignore an unparsable src */
    }
  }
  return document.querySelector('script[data-nema-provider]');
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

function openStore(unitId) {
  let memory = null;

  function read() {
    let doc = memory;
    if (!doc) {
      try {
        doc = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      } catch {
        doc = null;
      }
    }
    if (!doc || doc.version !== 1) doc = { version: 1, issuerKey: null, units: {} };
    if (!doc.units[unitId]) doc.units[unitId] = { attempts: {}, assertion: null, receipts: [] };
    memory = doc;
    return { ...doc.units[unitId], issuerKey: doc.issuerKey };
  }

  function write(mutate) {
    const doc = memory || { version: 1, issuerKey: null, units: {} };
    if (!doc.units[unitId]) doc.units[unitId] = { attempts: {}, assertion: null, receipts: [] };
    mutate(doc.units[unitId], doc);
    memory = doc;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      /* private browsing: the page still works, it just forgets on reload */
    }
    return read();
  }

  return { read, write };
}

async function ensureIssuerKey(store, crypto) {
  const existing = store.read().issuerKey;
  if (existing && existing.publicJwk && existing.privateJwk) return existing;
  const pair = await crypto.generateKeyPair();
  store.write((unit, doc) => {
    doc.issuerKey = pair;
  });
  return pair;
}

function attemptFor(app, activityId) {
  const stored = app.store.read().attempts[activityId];
  const base = { status: 'not_started', attempts: 0, hintsUsed: 0, startedAt: null, finishedAt: null };
  const attempt = { ...base, ...(stored || {}) };
  attempt.durationSeconds = attempt.startedAt
    ? Math.round(((attempt.finishedAt ? Date.parse(attempt.finishedAt) : Date.now()) - Date.parse(attempt.startedAt)) / 1000)
    : 0;
  return attempt;
}

function updateAttempt(app, activityId, patch) {
  app.store.write((unit) => {
    unit.attempts[activityId] = { ...(unit.attempts[activityId] || {}), ...patch };
  });
}

function startAttempt(app, activityId) {
  const attempt = attemptFor(app, activityId);
  if (attempt.status === 'not_started') {
    updateAttempt(app, activityId, { status: 'in_progress', startedAt: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// grading and receipts in the page
// ---------------------------------------------------------------------------

function submitActivity(app, activityId, submission) {
  const activity = app.activities[activityId];
  const before = attemptFor(app, activityId);
  const grading = activity.type === 'quiz' ? gradeQuiz(activity, submission) : gradeExposure(activity);
  const attempts = (before.attempts || 0) + 1;
  const startedAt = before.startedAt || new Date().toISOString();

  updateAttempt(app, activityId, {
    status: grading.result === 'failed' ? 'failed' : 'passed',
    result: grading.result,
    attempts,
    startedAt,
    finishedAt: new Date().toISOString(),
    feedback: grading.feedback,
    submission
  });

  return grading;
}

async function issueReceipt(app, activityId) {
  const activity = app.activities[activityId];
  if (!activity) return { status: 'rejected', reason: 'unknown-activity' };

  const stored = app.store.read().receipts.find((entry) => entry.activityId === activityId);
  if (stored) return { status: 'issued', token: stored.token, payload: stored.payload };

  const attempt = attemptFor(app, activityId);
  if (attempt.status !== 'passed') return { status: 'not-passed', reason: 'not-passed' };

  const grading =
    activity.type === 'quiz'
      ? gradeQuiz(activity, attempt.submission || { answers: {} })
      : gradeExposure(activity);
  if (grading.result === 'failed') return { status: 'not-passed', reason: 'not-passed' };

  const subject = app.assertion ? app.assertion.payload.learnerKeyId : 'anonymous';
  const conditions = buildConditions(activity, attempt);

  const server = app.options.endpoint
    ? await postToEndpoint(app, activityId, attempt, subject, conditions)
    : null;
  if (server) {
    app.store.write((unit) => {
      unit.receipts = unit.receipts
        .filter((entry) => entry.activityId !== activityId)
        .concat([{ activityId, token: server.token, payload: server.payload, source: 'endpoint' }]);
    });
    return { status: 'issued', token: server.token, payload: server.payload };
  }

  const payload = app.protocol.buildReceiptPayload(
    selfReceiptInput({
      origin: location.origin,
      issuerKey: app.issuerKey.publicJwk,
      subject,
      activity: { ...activity, contentHash: app.contentHash },
      grading,
      attempt,
      now: new Date(),
      receiptId: app.crypto.randomId('rcpt')
    })
  );
  const token = await app.protocol.signToken(payload, app.issuerKey.privateJwk);

  app.store.write((unit) => {
    unit.receipts = unit.receipts
      .filter((entry) => entry.activityId !== activityId)
      .concat([{ activityId, token, payload, source: 'self' }]);
  });
  return { status: 'issued', token, payload };
}

/**
 * data-endpoint: the same body a hosted provider takes (contract section 10).
 * A server signed receipt replaces the self signed one. Any failure falls back
 * to the self signed receipt rather than losing the learner's evidence.
 */
async function postToEndpoint(app, activityId, attempt, learnerKeyId, conditions) {
  try {
    const response = await fetch(app.options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activityId,
        submission: attempt.submission || {},
        learnerKeyId,
        conditions
      })
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body && body.status === 'issued' && typeof body.token === 'string') {
      return { token: body.token, payload: body.payload || app.protocol.decodeToken(body.token).payload };
    }
  } catch (err) {
    console.warn('[nema] the receipt endpoint failed, signing in the page instead:', err && err.message);
  }
  return null;
}

async function presentAssertion(app, token) {
  const text = typeof token === 'string' ? token.trim() : '';
  if (text === '') return { status: 'rejected', reason: 'malformed' };

  const verified = await app.protocol.verifyAssertion(text, {
    audience: location.origin,
    now: new Date()
  });
  if (!verified.ok) {
    app.message = `That assertion was not accepted: ${verified.reason}.`;
    app.render();
    return { status: 'rejected', reason: verified.reason };
  }

  app.assertion = { token: text, payload: verified.payload, receivedAt: new Date().toISOString() };
  app.store.write((unit) => {
    unit.assertion = app.assertion;
  });
  app.personal = personalize(app.manifest, verified.payload);
  app.message = null;
  app.render();

  return {
    status: 'personalized',
    learnerKeyId: verified.payload.learnerKeyId,
    requirements: app.personal.requirements,
    path: app.personal.path,
    skipped: app.personal.skipped.map((entry) => ({ activityId: entry.activityId, reason: entry.reason })),
    fullMinutes: app.personal.fullMinutes,
    personalMinutes: app.personal.personalMinutes
  };
}

// ---------------------------------------------------------------------------
// the block on the page
// ---------------------------------------------------------------------------

function mountPoint() {
  return (
    document.querySelector('nema-activities') ||
    document.querySelector('main') ||
    document.querySelector('article') ||
    document.body
  );
}

function mount(app) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const host = mountPoint();
  const root = el('section', {
    class: 'nema-embed',
    'data-nema-embed': app.manifest.unit.id,
    'aria-label': `Activities for ${app.manifest.unit.title}`
  });
  host.appendChild(root);

  function render() {
    root.textContent = '';
    if (app.message) {
      root.appendChild(el('p', { class: 'nema-embed-note', 'data-nema-message': '', text: app.message }));
    }
    if (app.personal) root.appendChild(pathNote(app));
    for (const activity of app.manifest.activities) {
      const full = app.activities[activity.id];
      root.appendChild(full.type === 'quiz' ? quizSection(app, full) : lessonSection(app, full));
    }
    const receipts = app.store.read().receipts;
    if (receipts.length > 0) root.appendChild(receiptSection(app, receipts));
    root.appendChild(assertionSection(app));
    root.appendChild(footer(app));
  }

  return { root, render };
}

function pathNote(app) {
  const { skipped, personalMinutes, fullMinutes } = app.personal;
  const section = el('div', { class: 'nema-embed-section nema-embed-note', 'data-nema-path': '' });
  if (skipped.length === 0) {
    section.appendChild(
      el('p', { text: `Your vault says you have not covered this yet, so the whole ${plural(fullMinutes, 'minute')} is worth your time.` })
    );
  } else {
    section.appendChild(
      el('p', {
        text:
          `You can skip: ${skipped.map((entry) => entry.title).join(', ')}. ` +
          `${skipped[0].reason}. That leaves ${plural(personalMinutes, 'minute')} of ${fullMinutes}.`
      })
    );
  }
  const who = app.assertion ? app.assertion.payload.learnerKeyId : '';
  section.appendChild(
    el('p', { class: 'nema-embed-sub', text: `Read from a signed readiness assertion for ${who}. Bands only, nothing else was shared.` })
  );
  return section;
}

function lessonSection(app, activity) {
  const attempt = attemptFor(app, activity.id);
  const done = attempt.status === 'passed';
  const section = el('div', {
    class: 'nema-embed-section',
    'data-nema-activity': activity.id,
    'data-nema-status': attempt.status
  });
  section.appendChild(el('h2', { text: activity.title }));
  section.appendChild(
    el('div', { class: 'nema-embed-row' }, [
      el('button', {
        class: 'nema-embed-btn',
        type: 'button',
        'data-nema-mark-read': activity.id,
        disabled: done,
        text: done ? 'Marked as read' : 'Mark as read',
        onclick: async () => {
          startAttempt(app, activity.id);
          submitActivity(app, activity.id, { read: true });
          await issueReceipt(app, activity.id);
          app.render();
        }
      }),
      el('span', {
        class: 'nema-embed-sub',
        text: done
          ? 'Exposure evidence: the weakest kind, and recorded as exactly that.'
          : `About ${plural(activity.minutes, 'minute')}. Exposure evidence only.`
      })
    ])
  );
  return section;
}

function quizSection(app, activity) {
  const attempt = attemptFor(app, activity.id);
  const answered = attempt.status === 'passed' || attempt.status === 'failed';
  const section = el('div', {
    class: 'nema-embed-section',
    'data-nema-activity': activity.id,
    'data-nema-status': attempt.status
  });
  section.appendChild(el('h2', { text: activity.title }));
  section.appendChild(
    el('p', { class: 'nema-embed-sub', text: `${plural(activity.minutes, 'minute')}. Graded in this page, no answer leaves it.` })
  );

  const form = el('form', { 'data-nema-quiz': activity.id });
  const previous = (attempt.submission && attempt.submission.answers) || {};

  for (const [index, question] of activity.questions.entries()) {
    const fieldset = el('fieldset', { class: 'nema-embed-q', 'data-nema-question': question.id });
    fieldset.appendChild(el('legend', { text: `${index + 1}. ${question.prompt}` }));
    for (const option of question.options) {
      const input = el('input', {
        type: 'radio',
        name: question.id,
        value: option.id,
        'data-nema-option': `${question.id}:${option.id}`
      });
      if (previous[question.id] === option.id) input.checked = true;
      input.addEventListener('change', () => startAttempt(app, activity.id));
      fieldset.appendChild(el('label', { class: 'nema-embed-opt' }, [input, el('span', { text: option.text })]));
    }
    form.appendChild(fieldset);
  }

  form.appendChild(
    el('div', { class: 'nema-embed-row' }, [
      el('button', {
        class: 'nema-embed-btn',
        type: 'submit',
        'data-nema-submit': activity.id,
        text: answered ? 'Submit again' : 'Submit'
      }),
      el('span', {
        class: 'nema-embed-sub',
        text: answered ? `${plural(attempt.attempts, 'attempt')} so far.` : ''
      })
    ])
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answers = {};
    for (const question of activity.questions) {
      const picked = form.querySelector(`input[name="${question.id}"]:checked`);
      if (picked) answers[question.id] = picked.value;
    }
    startAttempt(app, activity.id);
    const grading = submitActivity(app, activity.id, { answers });
    if (grading.result !== 'failed') await issueReceipt(app, activity.id);
    app.render();
    const feedback = document.querySelector(`[data-nema-feedback="${activity.id}"]`);
    if (feedback) feedback.focus();
  });

  section.appendChild(form);

  if (answered && Array.isArray(attempt.feedback)) {
    const result = attempt.result || (attempt.status === 'passed' ? 'passed' : 'failed');
    const note = el('div', {
      class: 'nema-embed-note',
      'data-nema-feedback': activity.id,
      'data-nema-result': result,
      tabindex: '-1'
    });
    note.appendChild(
      el('p', {
        text:
          result === 'passed'
            ? 'Both right. A receipt is below.'
            : result === 'partial'
              ? 'One right. The receipt below says partial, because that is what happened.'
              : 'Neither right this time. Nothing is recorded for a failed attempt here.'
      })
    );
    const list = el('ul');
    for (const line of attempt.feedback) list.appendChild(el('li', { text: line }));
    note.appendChild(list);
    section.appendChild(note);
  }

  return section;
}

function receiptSection(app, receipts) {
  const section = el('div', { class: 'nema-embed-section', 'data-nema-receipts': '' });
  section.appendChild(el('h2', { text: receipts.length === 1 ? 'Your receipt' : 'Your receipts' }));
  section.appendChild(
    el('p', {
      class: 'nema-embed-sub',
      text:
        `Signed by this site with a key it generated in your browser (${selfKeyId(location.origin)}). ` +
        'The public key travels inside the receipt, so any vault can check the signature without knowing this site.'
    })
  );

  for (const entry of receipts) {
    const activity = app.activities[entry.activityId];
    const row = el('div', { class: 'nema-embed-receipt', 'data-nema-receipt': entry.activityId });
    row.appendChild(
      el('p', {
        class: 'nema-embed-sub',
        text: `${activity ? activity.title : entry.activityId}: ${entry.payload.claims.map((claim) => `${claim.concept}.${claim.ability} ${claim.result}`).join(', ')}`
      })
    );
    row.appendChild(el('code', { class: 'nema-embed-token', 'data-nema-token': entry.activityId, text: entry.token }));
    const copy = el('button', {
      class: 'nema-embed-btn',
      type: 'button',
      'data-nema-copy': entry.activityId,
      text: 'Copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(entry.token);
          copy.textContent = 'Copied';
        } catch {
          const node = row.querySelector('[data-nema-token]');
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          copy.textContent = 'Selected, press copy';
        }
        setTimeout(() => {
          copy.textContent = 'Copy';
        }, 2000);
      }
    });
    row.appendChild(
      el('div', { class: 'nema-embed-row' }, [
        copy,
        el('a', {
          class: 'nema-embed-btn',
          'data-nema-vault': entry.activityId,
          href: `${app.vaultOrigin}/#receipt=${encodeURIComponent(entry.token)}`,
          rel: 'noopener',
          text: 'Send to vault'
        })
      ])
    );
    section.appendChild(row);
  }
  return section;
}

function assertionSection(app) {
  const details = el('details', { class: 'nema-embed-section', 'data-nema-assertion': '' });
  details.appendChild(el('summary', { text: app.assertion ? 'Assertion presented' : 'Paste an assertion from your vault' }));
  details.appendChild(
    el('p', {
      class: 'nema-embed-sub',
      text: 'Your vault can sign a short statement of what you already know, addressed to this site only. Paste it here and this page will tell you what to skip. An agent can do the same through present_assertion.'
    })
  );

  const form = el('form', {
    toolname: 'present_assertion',
    tooldescription:
      'Hand this page a ReadinessAssertion the learner approved in their vault. The page verifies the signature, the audience and the expiry, then shows what the learner can skip. Returns the personalized path.',
    toolautosubmit: true
  });
  const textarea = el('textarea', {
    name: 'assertionToken',
    required: true,
    'data-nema-assertion-input': '',
    placeholder: 'nema1....',
    toolparamdescription: 'A compact nema1. ReadinessAssertion token minted for this origin.'
  });
  form.appendChild(el('label', {}, [el('span', { class: 'nema-embed-sub', text: 'Readiness assertion' }), textarea]));
  form.appendChild(
    el('div', { class: 'nema-embed-row' }, [
      el('button', { class: 'nema-embed-btn', type: 'submit', 'data-nema-present': '', text: 'Present' })
    ])
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await presentAssertion(app, textarea.value);
    if (typeof event.respondWith === 'function') event.respondWith(result);
  });
  details.appendChild(form);
  return details;
}

function footer(app) {
  return el('div', { class: 'nema-embed-foot' }, [
    el('a', { href: app.hubOrigin, rel: 'noopener' }, [
      el('span', { html: MARK_SVG }),
      el('span', { text: 'Works with nema' })
    ])
  ]);
}

function flash() {
  const root = document.querySelector('[data-nema-embed]');
  if (!root) return;
  root.setAttribute('data-flash', 'true');
  setTimeout(() => root.removeAttribute('data-flash'), 1200);
}

// ---------------------------------------------------------------------------
// the five tools, contract section 10
// ---------------------------------------------------------------------------

const EMPTY_SCHEMA = { type: 'object', properties: {}, required: [], additionalProperties: false };

function activitySchema(description) {
  return {
    type: 'object',
    properties: { activityId: { type: 'string', description } },
    required: ['activityId'],
    additionalProperties: false
  };
}

async function registerEmbedTools(app, registerTools, EXPOSED_TO) {
  const ids = app.manifest.activities.map((activity) => activity.id);
  const list = `One of: ${ids.join(', ')}.`;

  const tools = [
    {
      name: 'describe_learning_offer',
      description:
        'Return the LearningManifest of this page: outcomes, requirements, and every activity with its minutes and grader. Nothing about the learner is read or written, and no question or answer key is returned.',
      inputSchema: EMPTY_SCHEMA,
      async execute() {
        flash();
        return { status: 'ok', manifest: app.manifest };
      }
    },

    {
      name: 'personalize_learning_path',
      description:
        'Present a ReadinessAssertion the learner approved in their vault and rebuild the path from it. Verifies the signature, the audience and the expiry, then shows on the page what the learner can skip and why. Returns the personalized path. The learner must approve the disclosure in their vault before a token exists.',
      inputSchema: {
        type: 'object',
        properties: {
          assertionToken: {
            type: 'string',
            description: 'A compact nema1. ReadinessAssertion token minted for this origin.'
          }
        },
        required: ['assertionToken'],
        additionalProperties: false
      },
      async execute({ assertionToken }) {
        return presentAssertion(app, assertionToken);
      }
    },

    {
      name: 'start_activity',
      description:
        'Open one activity in the page and scroll to it, so the learner can do it. Returns what the learner has to do. This tool navigates only: there is no tool on this page that submits an answer or grades one. Poll get_attempt_status to see what the learner did.',
      inputSchema: activitySchema(list),
      async execute({ activityId }) {
        const activity = app.activities[activityId];
        if (!activity) return { status: 'rejected', reason: 'unknown-activity', available: ids };
        startAttempt(app, activityId);
        app.render();
        const node = document.querySelector(`[data-nema-activity="${activityId}"]`);
        if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flash();
        return {
          status: 'started',
          activityId: activity.id,
          title: activity.title,
          type: activity.type,
          minutes: activity.minutes,
          whatTheLearnerDoes: activity.whatTheLearnerDoes,
          note: 'The learner completes this in the page. Poll get_attempt_status.'
        };
      }
    },

    {
      name: 'get_attempt_status',
      description:
        'Read what the learner has done on one activity: not_started, in_progress, passed or failed, with attempts, hints used and time spent. Once the learner has submitted, the grader result and the feedback shown on screen are returned too. Never returns the learner submission, the answer or the answer key.',
      inputSchema: activitySchema(list),
      async execute({ activityId }) {
        const activity = app.activities[activityId];
        if (!activity) return { status: 'rejected', reason: 'unknown-activity', available: ids };
        const attempt = attemptFor(app, activityId);
        const out = {
          status: attempt.status,
          attempts: attempt.attempts,
          hintsUsed: attempt.hintsUsed,
          durationSeconds: attempt.durationSeconds
        };
        if (attempt.result) out.result = attempt.result;
        if (Array.isArray(attempt.feedback) && attempt.feedback.length > 0) out.feedback = attempt.feedback;
        return out;
      }
    },

    {
      name: 'issue_evidence_receipt',
      description:
        'Ask this page for the signed EvidenceReceipt of an activity the learner passed. The page signs with a key it generated in this browser and puts the public key inside the receipt, so any vault can verify it without knowing this site. Idempotent: the stored token is returned on a repeat call.',
      inputSchema: activitySchema(list),
      async execute({ activityId }) {
        const activity = app.activities[activityId];
        if (!activity) return { status: 'rejected', reason: 'unknown-activity', available: ids };
        const result = await issueReceipt(app, activityId);
        app.render();
        flash();
        if (result.status !== 'issued') return { status: 'not-passed', activityId, reason: result.reason };
        return {
          status: 'issued',
          token: result.token,
          claims: result.payload.claims,
          activity: result.payload.activity,
          hint: 'Take this token to the vault and call stage_evidence_receipt.'
        };
      }
    }
  ];

  return registerTools(tools, { exposedTo: EXPOSED_TO });
}

// ---------------------------------------------------------------------------
// the guard: in a browser this installs, in Node it does nothing
// ---------------------------------------------------------------------------

if (IN_BROWSER) {
  const start = () => {
    boot().catch((err) => console.warn('[nema] embed did not start:', err && err.message ? err.message : err));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}

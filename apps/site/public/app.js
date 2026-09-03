/* nema hub runtime.
 *
 * Five pages share this module: the hub, the creator guide, the judge guide,
 * the philosophy and the protocol reference. It injects the shared header and footer, resolves
 * every cross origin link through /shared/origins.js so the page works on
 * localhost and in production without editing an href, registers the site's
 * WebMCP tools, and keeps the tool activity strip in sync.
 *
 * Tools registered here (contract section 12):
 *   explain_nema({ topic })   imperative, via /shared/webmcp.js
 *   open_app({ app })         declarative, <form toolname="open_app">
 */

import { injectHeader, injectFooter, originFor } from '/shared/brand/brand.js';
import { registerTools, getActivity, EXPOSED_TO, isNative } from '/shared/webmcp.js';

/* -------------------------------------------------------- topics -- */

/* Two to four sentences each, drawn from README.md, docs/PHILOSOPHY.md,
 * docs/SPEC.md, docs/DEVPOST.md and docs/JUDGE_GUIDE.md. Nothing here claims
 * anything the five apps do not do. */
const TOPICS = {
  overview:
    'nema is a WebMCP protocol for learning that anyone who teaches on the web can install with one manifest block and one script tag. '
    + 'A vault you own holds signed evidence of what you have learned and derives your state from it, per concept and per ability. '
    + 'Websites never read the vault: they ask one question, and the vault answers with the smallest true answer, after you approve it. '
    + 'In the demo a 68 minute course becomes 27, then 21, a second website recognises prerequisites it never taught, and a blog post issues receipts of its own.',
  protocol:
    'Five objects move between three roles. A provider publishes a LearningManifest and a ReadinessRequest, the vault answers with a signed ReadinessAssertion, the provider signs an EvidenceReceipt for work the human did, and the vault emits LearningNeed objects for the learner\'s own agent to work from. '
    + 'Every signed object travels as one compact token, nema1 followed by the base64url payload and the base64url signature, ECDSA P-256 over the exact transmitted bytes. '
    + 'Verification never re-serializes the payload, so two implementations that disagree about key order still interoperate.',
  privacy:
    'A ReadinessAssertion carries only the concepts that were requested, as status bands, plus an audience, a purpose, a request hash and an expiry. '
    + 'No history, no scores, no other subjects, no misconceptions, no review schedule, no provider history. '
    + 'It is released only after the learner approves a modal that lists what is shared and what is withheld, it is valid at one origin for 30 minutes, and the learnerKeyId is derived from the vault key and the audience, so two providers see different ids for the same person.',
  vault:
    'The vault is a page on an origin the learner controls, storing signed receipts in the browser and nothing on a server. '
    + 'It stores evidence, never state: bands are recomputed from the ledger on every read by pure functions, so everything it shows can be reproduced from the receipts. '
    + 'Evidence is weighted by how it was produced, from 1.0 for a deterministic grader down to 0.1 for mere exposure, and it decays with time. '
    + 'It registers eleven imperative tools and one declarative form, and not one of them can write a band. '
    + 'Receipts carry a trust tier: registered, origin published, or self certified and capped at the weight of a self report.',
  providers:
    'A provider keeps its content, its pedagogy, its pricing and its brand. What it publishes is a LearningManifest: what a unit teaches, what it assumes, and what evidence each activity can produce. '
    + 'It verifies one signature from the vault, checks the token was minted for its own origin, and rebuilds the path, striking through what the learner can skip with the reason next to each item. '
    + 'Implementing one takes a page, a manifest, a grader and one key, and a site with no server at all can install the embed instead: one manifest block, one script tag, self certified receipts.',
  judges:
    'Load the demo learner in the vault, then follow the golden path in the judge guide with your own agent or by hand. '
    + 'The moment to watch is the consent modal: a tool call stops, the page asks, and the token does not exist until a person clicks. '
    + 'Then try to break it: tamper with a token, stage the same receipt twice, present an assertion to the wrong audience, or ask the agent to mark something as mastered. '
    + 'Every rejection is shown in the page with its reason, and the forbidden tools are absent from getTools() rather than merely discouraged.'
};

const TOPIC_NAMES = Object.keys(TOPICS);

/* ------------------------------------------------------ page frame -- */

const pageTitle = document.body.dataset.pageTitle || '';
const footerNote = document.body.dataset.footerNote || '';

injectHeader({ app: 'site', title: pageTitle });
injectFooter(footerNote ? { note: footerNote } : {});

/* Cross origin links are written with their production href in the HTML and
 * rewritten here, so localhost and production both work from one file. */
for (const el of document.querySelectorAll('[data-app-link]')) {
  const origin = originFor(el.dataset.appLink);
  if (origin) el.href = origin + (el.dataset.appPath || '/');
}

/* ------------------------------------------------- activity strip -- */

/* shared/webmcp.js keeps the imperative tool calls and mountActivityStrip
 * renders them. Declarative form tools never reach that list, so this page
 * merges the exported getActivity() with the calls the open_app form makes,
 * and renders the same .activity-strip markup. */
const localActivity = [];
const stripEl = document.querySelector('[data-activity]');

function recordLocal(entry) {
  localActivity.push({ ...entry, at: Date.now() });
  while (localActivity.length > 8) localActivity.shift();
  document.dispatchEvent(new CustomEvent('nema:toolcall', { detail: entry }));
}

function renderStrip() {
  if (!stripEl) return;
  const rows = [...getActivity(), ...localActivity]
    .sort((a, b) => a.at - b.at)
    .slice(-8)
    .reverse();

  stripEl.textContent = '';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'activity-row activity-row-empty';
    empty.textContent = 'No tool calls yet.';
    stripEl.appendChild(empty);
    return;
  }
  for (const entry of rows) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    row.dataset.status = entry.status;

    const name = document.createElement('span');
    name.className = 'activity-name';
    name.textContent = entry.name;

    const ms = document.createElement('span');
    ms.className = 'activity-ms';
    ms.textContent = `${entry.ms} ms`;

    const status = document.createElement('span');
    status.className = 'activity-status';
    status.textContent = entry.status;

    row.append(name, ms, status);
    stripEl.appendChild(row);
  }
}

if (stripEl) {
  stripEl.classList.add('activity-strip');
  renderStrip();
  document.addEventListener('nema:toolcall', renderStrip);
}

/* ------------------------------------------------- explain_nema UI -- */

const out = document.querySelector('[data-explain-out]');
const outHead = document.querySelector('[data-explain-head]');
const outText = document.querySelector('[data-explain-text]');

function paintExplain(topic, text, state) {
  if (!out) return;
  out.dataset.state = state;
  if (outHead) outHead.textContent = state === 'error' ? 'explain_nema, rejected' : `explain_nema, topic ${topic}`;
  if (outText) outText.textContent = text;
  for (const btn of document.querySelectorAll('[data-topic]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.topic === topic));
  }
}

function explain(topic) {
  const key = String(topic || '').trim().toLowerCase();
  if (!TOPICS[key]) {
    paintExplain(key, `There is no topic called "${key}". Ask for one of: ${TOPIC_NAMES.join(', ')}.`, 'error');
    return { status: 'rejected', reason: 'unknown-topic', topics: TOPIC_NAMES };
  }
  paintExplain(key, TOPICS[key], 'filled');
  return { status: 'ok', topic: key, text: TOPICS[key] };
}

/* Clicking a topic goes through document.modelContext.executeTool, so a judge
 * with no agent attached sees the same code path, the same result object and
 * the same row in the activity strip. */
async function runExplainTool(topic) {
  try {
    const tools = await document.modelContext.getTools();
    const tool = tools.find((t) => t.name === 'explain_nema');
    if (tool) return await document.modelContext.executeTool(tool, { topic });
  } catch (err) {
    console.warn('[nema] executeTool fell back to a direct call:', err && err.message ? err.message : err);
  }
  return explain(topic);
}

for (const btn of document.querySelectorAll('[data-topic]')) {
  btn.addEventListener('click', () => { runExplainTool(btn.dataset.topic); });
}

/* --------------------------------------------------- open_app form -- */

const OPEN_DELAY_MS = 700;
const openForm = document.querySelector('form[toolname="open_app"]');
const openStatus = document.querySelector('[data-open-status]');

if (openForm) {
  openForm.addEventListener('submit', (event) => {
    /* The polyfill adds respondWith in a capture listener, so it is already on
     * the event by the time this bubble listener runs. A human pressing the
     * button gets the same behaviour without it. */
    event.preventDefault();
    /* The form lives inside the collapsed "More" block on the hub, so open it:
     * a tool call a judge cannot see on screen is a tool call they cannot
     * audit. */
    const more = openForm.closest('details');
    if (more) more.open = true;
    const started = performance.now();
    const app = String(openForm.elements.app.value || '').trim();
    const KNOWN = ['site', 'vault', 'harness', 'security'];
    const url = KNOWN.includes(app) ? originFor(app) : '';

    if (!url) {
      const result = { status: 'rejected', reason: 'unknown-app', apps: ['site', 'vault', 'harness', 'security'] };
      if (openStatus) openStatus.textContent = `No nema app called "${app}".`;
      recordLocal({ name: 'open_app', args: { app }, result, ms: Math.round(performance.now() - started), status: 'rejected' });
      if (typeof event.respondWith === 'function') event.respondWith(result);
      return;
    }

    const target = url + '/';
    const result = { status: 'ok', app, url: target, note: 'This tab is navigating to the app now.' };
    if (openStatus) openStatus.textContent = `Opening ${app} at ${target}`;
    recordLocal({ name: 'open_app', args: { app }, result, ms: Math.round(performance.now() - started), status: 'ok' });
    if (typeof event.respondWith === 'function') event.respondWith(result);
    setTimeout(() => { window.location.href = target; }, OPEN_DELAY_MS);
  });
}

/* ------------------------------------------------------ JSON panels -- */

for (const el of document.querySelectorAll('[data-json]')) {
  const escaped = el.textContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  el.innerHTML = escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (match, key, colon, str, bool, num) => {
      if (key) return `<span class="tok-key">${key}</span><span class="tok-punct">${colon}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (bool) return `<span class="tok-bool">${bool}</span>`;
      return `<span class="tok-num">${num}</span>`;
    }
  );
}

/* ------------------------------------------------------ registration -- */

await registerTools([
  {
    name: 'explain_nema',
    description:
      'Explain one part of nema in two to four sentences, drawn from the project documentation. '
      + 'Prints the answer in the "ask this page" panel on screen and highlights the topic. '
      + 'Topics: overview, protocol, privacy, vault, providers, judges.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: TOPIC_NAMES,
          description: 'Which part of nema to explain: overview, protocol, privacy, vault, providers or judges.'
        }
      },
      required: ['topic'],
      additionalProperties: false
    },
    async execute({ topic }) {
      return explain(topic);
    }
  }
], { exposedTo: EXPOSED_TO });

console.log(`[nema] hub ready (${isNative() ? 'native WebMCP' : 'polyfill'})`);

/* The declarative open_app tool is not in the list above: the browser reads it
 * off the <form toolname="open_app"> element. Both WebMCP registration styles
 * are live on this page, which is why getTools() returns two. */

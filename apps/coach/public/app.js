/* nema coach: the page.
 *
 * app.js owns everything that touches the DOM: the site switcher and its
 * iframe, tool discovery, the transcript, the token clipboard panel, the tool
 * activity strip and the Script side sheet. The agent loop lives in agent.js
 * and the prompt in prompt.js.
 *
 * The one rule that shapes this file: every tool call has to be visible. A call
 * shows up as a card in the chat, as a row in the activity strip, and as
 * whatever the site itself does inside the frame.
 */

import { ORIGINS, ORIGINS_BY_ENV, isDev } from '/shared/origins.js';
import { injectHeader, injectFooter, toast, copyToClipboard, escapeHtml } from '/shared/brand/brand.js';
import {
  createAgent,
  createTokenClipboard,
  discoverTools,
  executeTool,
  resultToContent,
  summarizeArgs,
  toolSchema
} from '/agent.js';
import { SYSTEM_PROMPT, QUICK_PROMPTS, GOLDEN_PATH, SITE_TOOLS, sessionBrief } from '/prompt.js';

/* ------------------------------------------------------------- state -- */

const SESSION_KEY = 'nema.coach.session.v1';
const TOKENS_KEY = 'nema.coach.tokens.v1';
const TOOLCACHE_KEY = 'nema.coach.tools.v1';
const ACTIVITY_LIMIT = 8;
const DISCOVERY_POLL_MS = 2000;
const SWITCH_WAIT_MS = 9000;

const SITES = [
  { key: 'vault', label: 'Vault', origin: ORIGINS.vault },
  { key: 'harness', label: 'Harness Lab', origin: ORIGINS.harness },
  { key: 'security', label: 'Agent Security', origin: ORIGINS.security }
];

const SITE_LABEL = Object.fromEntries(SITES.map((site) => [site.key, site.label]));

/**
 * Production origin to the origin actually being served, when the coach runs on
 * localhost. The provider manifests name their production deployment, so a model
 * reading one and handing that string to the vault would mint an assertion for
 * an audience no local server can verify. The learner's own broker fixes that,
 * in one place, and says so on the tool card.
 */
const LOCAL_ORIGIN = isDev
  ? Object.fromEntries(
      Object.entries(ORIGINS_BY_ENV.prod)
        .filter(([app]) => ORIGINS_BY_ENV.dev[app])
        .map(([app, origin]) => [origin, ORIGINS_BY_ENV.dev[app]])
    )
  : {};

/**
 * Rewrite every production origin inside a tool argument onto the origin this
 * dev server serves. Returns the value unchanged in production.
 * @returns {{ value: any, rewrote: string[] }}
 */
function localizeOrigins(value, rewrote = []) {
  if (typeof value === 'string') {
    let out = value;
    for (const [from, to] of Object.entries(LOCAL_ORIGIN)) {
      if (out.includes(from)) {
        out = out.split(from).join(to);
        rewrote.push(`${hostOf(from)} to ${hostOf(to)}`);
      }
    }
    return { value: out, rewrote };
  }
  if (Array.isArray(value)) {
    return { value: value.map((item) => localizeOrigins(item, rewrote).value), rewrote };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = localizeOrigins(item, rewrote).value;
    return { value: out, rewrote };
  }
  return { value, rewrote };
}

/** The site currently in the frame. `custom` carries whatever URL was typed. */
let current = { key: 'vault', origin: ORIGINS.vault, url: `${ORIGINS.vault}/` };
/** Live tool descriptors for `current.origin`, refreshed by the discovery poll. */
let liveTools = [];
/** Schemas seen on every origin visited this session, so the model keeps them. */
let toolCache = {};
/** Last calls, newest last, rendered into the activity strip. */
let activity = [];
/** The call being executed right now, drawn as a running card. */
let pending = null;
let discoveryTimer = null;
let clockTimer = null;
let sheetReturnFocus = null;

const el = {
  app: document.querySelector('.co-app'),
  transcript: document.querySelector('[data-transcript]'),
  form: document.querySelector('[data-chat-form]'),
  input: document.querySelector('#chat-input'),
  send: document.querySelector('[data-action="send"]'),
  stop: document.querySelector('[data-action="stop"]'),
  run: document.querySelector('[data-run-status]'),
  chips: document.querySelector('[data-quick-prompts]'),
  backend: document.querySelector('[data-backend]'),
  switch: document.querySelector('[data-site-switch]'),
  customForm: document.querySelector('[data-custom-form]'),
  customInput: document.querySelector('#custom-url'),
  found: document.querySelector('[data-tools-found]'),
  allow: document.querySelector('[data-allow]'),
  frameLink: document.querySelector('[data-frame-link]'),
  frameSlot: document.querySelector('[data-frame-slot]'),
  clipboard: document.querySelector('[data-clipboard]'),
  strip: document.querySelector('[data-activity-strip]'),
  steps: document.querySelector('[data-script-steps]'),
  sheet: document.querySelector('[data-sheet]'),
  scrim: document.querySelector('[data-sheet-scrim]')
};

/* --------------------------------------------------------- utilities -- */

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSession(patch) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...readSession(), ...patch }));
  } catch {
    /* A blocked sessionStorage only costs the reload, never the session. */
  }
}

function readToolCache() {
  try {
    const raw = sessionStorage.getItem(TOOLCACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeToolCache() {
  try {
    sessionStorage.setItem(TOOLCACHE_KEY, JSON.stringify(toolCache));
  } catch {
    /* Same as above: caching is a convenience, never a requirement. */
  }
}

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return String(value || '');
  }
}

function keyForOrigin(origin) {
  const site = SITES.find((entry) => entry.origin === origin);
  return site ? site.key : 'custom';
}

/** Map a tool status onto the band vocabulary the whole product shares. */
function bandFor(status) {
  const value = String(status || '').toLowerCase();
  if (['ok', 'accepted', 'approved', 'issued', 'personalized', 'checked', 'started', 'verified'].includes(value)) {
    return 'usable';
  }
  if (['pending', 'staged', 'waiting', 'timeout', 'in_progress', 'not_started', 'unavailable'].includes(value)) {
    return 'due';
  }
  if (['error', 'denied', 'rejected', 'failed', 'invalid', 'not-passed', 'malformed'].includes(value)) {
    return 'danger';
  }
  return 'unknown';
}

/** Escape, then allow the three inline marks a chat model actually produces. */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * House style, applied to model prose before it is drawn: no em dashes and no
 * en dash used as a dash. The prompt asks for the same thing, this is the belt.
 */
function houseStyle(text) {
  return String(text || '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/(\S)\s\u2013\s(\S)/g, '$1, $2');
}

/** A small block renderer: paragraphs, single line breaks and simple lists. */
function richText(text) {
  const blocks = houseStyle(text).trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').filter((line) => line.trim() !== '');
      if (lines.length > 0 && lines.every((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line))) {
        const items = lines
          .map((line) => `<li>${inline(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.map((line) => inline(line)).join('<br>')}</p>`;
    })
    .join('');
}

function relativeExpiry(iso) {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const minutes = Math.round((at - Date.now()) / 60000);
  if (minutes <= 0) return 'expired';
  if (minutes === 1) return 'expires in 1 minute';
  if (minutes < 60) return `expires in ${minutes} minutes`;
  return `expires ${new Date(at).toISOString().slice(11, 16)} UTC`;
}

/* ---------------------------------------------- token clipboard panel -- */

const clipboard = createTokenClipboard({ storageKey: TOKENS_KEY, onChange: renderClipboard });

function renderClipboard(entries = clipboard.list()) {
  el.clipboard.textContent = '';
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'n-empty';
    empty.textContent = 'No token yet';
    el.clipboard.append(empty);
    return;
  }

  for (const entry of entries) {
    const box = document.createElement('div');
    box.className = 'n-token';

    const band = entry.type === 'assertion' ? 'durable' : entry.type === 'receipt' ? 'usable' : 'unknown';
    const expiry = relativeExpiry(entry.expiresAt);
    const expired = expiry === 'expired';

    const meta = [];
    if (entry.audience) meta.push(`audience ${hostOf(entry.audience)}`);
    if (entry.issuer) meta.push(`issuer ${hostOf(entry.issuer)}`);
    if (entry.activity) meta.push(entry.activity);
    if (expiry) meta.push(expiry);
    if (!entry.audience && !entry.issuer && !expiry) meta.push('signed token, payload not readable here');

    box.innerHTML = `
      <div class="n-token__head">
        <span class="co-clip__handle">${escapeHtml(entry.handle)}</span>
        <span class="n-pill n-pill--${expired ? 'danger' : band}">${escapeHtml(expired ? 'expired' : entry.type)}</span>
        <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-copy-token>Copy</button>
      </div>
      <div class="co-clip__meta">${meta.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</div>
      <pre class="n-token__text">${escapeHtml(`${entry.token.slice(0, 44)} ... ${entry.token.slice(-10)}`)}</pre>`;

    const copy = box.querySelector('[data-copy-token]');
    copy.setAttribute('aria-label', `Copy the full token behind ${entry.handle}`);
    copy.addEventListener('click', () => copyToClipboard(entry.token, copy));
    el.clipboard.append(box);
  }
}

/* --------------------------------------------------- activity strip -- */

function renderActivity() {
  el.strip.className = 'activity-strip';
  el.strip.textContent = '';
  if (activity.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'activity-row activity-row-empty';
    empty.textContent = 'No tool calls yet. Ask the agent to do something.';
    el.strip.append(empty);
    return;
  }
  for (const entry of activity.slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    /* brand.css colours the row from a small vocabulary. The real status still
     * reads in the third column, so nothing is lost by normalizing the dot. */
    const band = bandFor(entry.status);
    row.dataset.status = band === 'usable' ? 'ok' : band === 'due' ? 'pending' : band === 'danger' ? 'error' : 'ok';

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
    el.strip.append(row);
  }
}

function recordActivity(entry) {
  activity.push(entry);
  while (activity.length > ACTIVITY_LIMIT) activity.shift();
  renderActivity();
}

/* -------------------------------------------------------- transcript -- */

function toolCard({ name, args, status, ms, origin, note, running }) {
  const card = document.createElement('div');
  card.className = running ? 'co-tool co-tool--running' : 'co-tool';

  const head = document.createElement('div');
  head.className = 'co-tool__head';

  const label = document.createElement('span');
  label.className = 'co-tool__name';
  label.textContent = name;

  const duration = document.createElement('span');
  duration.className = 'co-tool__ms';
  duration.textContent = running ? 'running' : `${ms} ms`;

  const pill = document.createElement('span');
  pill.className = `n-pill n-pill--${running ? 'due' : bandFor(status)}`;
  pill.textContent = running ? 'calling' : String(status);

  head.append(label, duration, pill);
  card.append(head);

  const summary = summarizeArgs(args);
  if (summary) {
    const line = document.createElement('div');
    line.className = 'co-tool__args';
    line.textContent = summary;
    card.append(line);
  }

  if (note) {
    const line = document.createElement('div');
    line.className = 'co-tool__note';
    line.textContent = note;
    card.append(line);
  }

  if (origin) {
    const site = document.createElement('div');
    site.className = 'co-tool__site';
    site.textContent = hostOf(origin);
    card.append(site);
  }

  return card;
}

function message(who, kind, html) {
  const wrap = document.createElement('div');
  wrap.className = `co-msg co-msg--${kind}`;
  const label = document.createElement('div');
  label.className = 'co-msg__who';
  label.textContent = who;
  const body = document.createElement('div');
  body.className = 'co-msg__body';
  body.innerHTML = html;
  wrap.append(label, body);
  return wrap;
}

function emptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'co-empty';
  wrap.innerHTML = `
    <p class="co-empty__title">Nothing asked yet</p>
    <p>The agent can only do what the site in the frame exposes. Pick a site on the right, then ask for something, or open the Script sheet and walk the seven demo steps in order.</p>
    <p>It will not answer an activity for you, and it will not read anything out of the vault that you have not approved.</p>`;
  return wrap;
}

function renderTranscript(entries) {
  const atBottom =
    el.transcript.scrollHeight - el.transcript.scrollTop - el.transcript.clientHeight < 80;

  el.transcript.textContent = '';

  if (entries.length === 0 && !pending) {
    el.transcript.append(emptyState());
    return;
  }

  for (const entry of entries) {
    if (entry.role === 'user') {
      el.transcript.append(message('you', 'user', richText(entry.content)));
    } else if (entry.role === 'assistant' && entry.content) {
      el.transcript.append(message('agent', 'agent', richText(entry.content)));
    } else if (entry.role === 'tool') {
      el.transcript.append(toolCard(entry));
    } else if (entry.role === 'note') {
      const note = document.createElement('div');
      note.className = entry.kind === 'error' ? 'co-note co-note--error' : 'co-note';
      const label = document.createElement('span');
      label.className = 'co-note__label';
      label.textContent = entry.kind === 'error' ? 'the agent could not answer' : 'notice';
      const text = document.createElement('span');
      text.textContent = entry.content;
      note.append(label, text);
      if (entry.retry) {
        const retry = document.createElement('button');
        retry.className = 'n-btn n-btn--sm n-btn--secondary';
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => agent.retry());
        note.append(retry);
      }
      el.transcript.append(note);
    }
  }

  if (pending) el.transcript.append(toolCard({ ...pending, running: true }));

  if (atBottom || entries.length <= 1) {
    el.transcript.scrollTop = el.transcript.scrollHeight;
  }
}

/* ---------------------------------------------- frame and discovery -- */

function setDiscoveryPill(count, origin) {
  const host = hostOf(origin);
  el.found.className = `n-pill n-pill--${count > 0 ? 'durable' : 'unknown'}`;
  el.found.textContent = count > 0
    ? `${count} tool${count === 1 ? '' : 's'} from ${host}`
    : `looking for tools on ${host}`;
}

async function refreshDiscovery() {
  const origin = current.origin;
  const tools = await discoverTools(origin);
  if (origin !== current.origin) return;
  liveTools = tools;
  if (tools.length > 0) {
    toolCache[origin] = { host: hostOf(origin), schemas: tools.map(toolSchema) };
    writeToolCache();
  }
  setDiscoveryPill(tools.length, origin);
}

function startDiscoveryPoll() {
  if (discoveryTimer !== null) clearInterval(discoveryTimer);
  discoveryTimer = setInterval(refreshDiscovery, DISCOVERY_POLL_MS);
  /* Contract section 11: discover on load and on toolchange. A native browser
   * fires it on document.modelContext, the polyfill on the document, and the
   * poll above covers anything that fires neither. */
  document.addEventListener('toolchange', refreshDiscovery);
  try {
    const context = document.modelContext;
    if (context && typeof context.addEventListener === 'function') {
      context.addEventListener('toolchange', refreshDiscovery);
    }
  } catch {
    /* A plain object modelContext has no events. The poll still covers it. */
  }
}

/**
 * Put a site in the frame. `allow` is set before `src` so a native WebMCP
 * browser grants the tools permission to the document as it loads.
 */
function setSite(key, url) {
  const site = SITES.find((entry) => entry.key === key);
  const target = site ? `${site.origin}/` : url;
  let origin;
  try {
    origin = new URL(target).origin;
  } catch {
    toast('That is not a valid URL.', 'error');
    return false;
  }

  current = { key: site ? site.key : 'custom', origin, url: target };
  liveTools = [];

  const frame = document.createElement('iframe');
  frame.setAttribute('title', `${site ? site.label : hostOf(origin)}, the site the agent is working with`);
  frame.setAttribute('allow', `tools ${origin}`);
  frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
  frame.addEventListener('load', () => {
    refreshDiscovery();
    setTimeout(refreshDiscovery, 400);
    setTimeout(refreshDiscovery, 1200);
  });
  frame.src = target;

  el.frameSlot.textContent = '';
  el.frameSlot.append(frame);

  el.frameLink.href = target;
  el.allow.textContent = `allow="tools ${origin}"`;
  setDiscoveryPill(0, origin);

  for (const button of el.switch.querySelectorAll('button[data-site]')) {
    button.setAttribute('aria-pressed', String(button.dataset.site === current.key));
  }
  el.customInput.value = current.key === 'custom' ? target : '';

  writeSession({ site: current.key, url: current.url });
  refreshDiscovery();
  return true;
}

/** Switch the frame and wait until that origin has answered with its tools. */
async function switchAndWait(key) {
  if (!setSite(key)) return false;
  const deadline = Date.now() + SWITCH_WAIT_MS;
  while (Date.now() < deadline) {
    await refreshDiscovery();
    if (liveTools.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return liveTools.length > 0;
}

/* ------------------------------------------------------ tool routing -- */

/** Every tool the model may call this turn: the live site plus what we cached. */
function toolsForModel() {
  const seen = new Set();
  const list = [];
  for (const tool of liveTools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    list.push(toolSchema(tool));
  }
  for (const [origin, cached] of Object.entries(toolCache)) {
    if (origin === current.origin) continue;
    for (const schema of cached.schemas || []) {
      if (seen.has(schema.name)) continue;
      seen.add(schema.name);
      list.push(schema);
    }
  }
  return list;
}

/** Which site keys are known to hold a tool name, cache first, contract second. */
function candidatesFor(name) {
  const fromCache = Object.entries(toolCache)
    .filter(([, cached]) => (cached.schemas || []).some((schema) => schema.name === name))
    .map(([origin]) => keyForOrigin(origin))
    .filter((key) => key !== 'custom');
  if (fromCache.length > 0) return Array.from(new Set(fromCache));
  return Object.entries(SITE_TOOLS)
    .filter(([, names]) => names.includes(name))
    .map(([key]) => key);
}

function finishCall(call, outcome) {
  recordActivity({ name: call.name, ms: outcome.ms, status: outcome.status });
  pending = null;
  return outcome;
}

/**
 * Run one tool call for the agent. Handles are expanded on the way in and any
 * token in the answer is collapsed back to a handle on the way out.
 */
async function runTool(call) {
  const asked = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
  const localized = localizeOrigins(asked);
  const args = localized.value;
  const note = localized.rewrote.length > 0
    ? `origin rewritten for this dev server: ${Array.from(new Set(localized.rewrote)).join(', ')}`
    : '';
  pending = { name: call.name, args, origin: current.origin, note };
  renderTranscript(agent.entries());

  const notFound = (status, message) => {
    const result = { status, error: message };
    return finishCall(call, {
      status,
      ms: 0,
      args,
      note,
      origin: current.origin,
      content: resultToContent(result)
    });
  };

  let tool = liveTools.find((entry) => entry.name === call.name);

  if (!tool) {
    const candidates = candidatesFor(call.name).filter((key) => key !== current.key);
    if (candidates.length === 1) {
      toast(`Switching the frame to ${SITE_LABEL[candidates[0]]} for ${call.name}.`);
      await switchAndWait(candidates[0]);
      pending = { name: call.name, args, origin: current.origin, note };
      renderTranscript(agent.entries());
      tool = liveTools.find((entry) => entry.name === call.name);
    } else if (candidates.length > 1) {
      return notFound(
        'unavailable',
        `${call.name} exists on more than one site (${candidates.map((key) => SITE_LABEL[key]).join(', ')}). Ask the learner to pick one in the site switcher, then call it again.`
      );
    }
  }

  if (!tool) {
    return notFound(
      'unavailable',
      `No site in the frame registers a tool called ${call.name}. The frame is showing ${hostOf(current.origin)}. Ask the learner to switch the site, or use a tool you already hold.`
    );
  }

  const expanded = clipboard.expand(args);
  const { result, ms } = await executeTool(tool, expanded);
  const collapsed = clipboard.collapse(result, tool.name);
  const status = String(collapsed.status || 'ok');

  if (['error', 'denied', 'rejected', 'timeout'].includes(status)) {
    toast(`${call.name}: ${status}`, status === 'denied' || status === 'timeout' ? 'warn' : 'error');
  }
  refreshDiscovery();

  return finishCall(call, {
    status,
    ms,
    args,
    note,
    origin: tool.origin || current.origin,
    content: resultToContent(collapsed)
  });
}

/* -------------------------------------------------------------- agent -- */

const agent = createAgent({
  endpoint: '/api/chat',
  /* Re-read every turn: the brief names the live origins and the site the
   * learner is looking at right now. */
  system: () => `${SYSTEM_PROMPT}\n\n${sessionBrief({
    origins: ORIGINS,
    current: current.origin,
    label: SITE_LABEL[current.key] || hostOf(current.origin)
  })}`,
  getTools: async () => {
    await refreshDiscovery();
    return toolsForModel();
  },
  runTool,
  onChange: (entries) => {
    renderTranscript(entries);
    /* Keep the restored session small: a long run of trimmed tool results can
     * otherwise fill the sessionStorage quota. */
    writeSession({ transcript: entries.slice(-60) });
  },
  onState: ({ running, round }) => {
    el.send.disabled = running;
    el.input.disabled = running;
    el.stop.hidden = !running;
    el.run.dataset.busy = String(running);
    if (running) {
      el.run.textContent = round > 1 ? `Thinking, tool round ${round} of 12.` : 'Thinking.';
    } else {
      el.run.textContent = 'Ready.';
      pending = null;
      renderTranscript(agent.entries());
      el.input.focus({ preventScroll: true });
    }
  }
});

/* ------------------------------------------------------------- chrome -- */

function renderSwitcher() {
  el.switch.textContent = '';
  for (const site of SITES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'n-btn n-btn--secondary n-btn--sm';
    button.dataset.site = site.key;
    button.textContent = site.label;
    button.setAttribute('aria-pressed', String(site.key === current.key));
    button.addEventListener('click', () => setSite(site.key));
    el.switch.append(button);
  }
}

function renderChips() {
  el.chips.textContent = '';
  for (const chip of QUICK_PROMPTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'n-btn n-btn--secondary n-btn--sm';
    button.textContent = chip.label;
    button.addEventListener('click', () => {
      if (agent.isRunning()) return;
      el.input.value = '';
      agent.send(chip.prompt);
    });
    el.chips.append(button);
  }
}

function renderSteps() {
  el.steps.textContent = '';
  for (const step of GOLDEN_PATH) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'co-step';
    button.innerHTML = `
      <span class="co-step__index">${step.index}</span>
      <span class="co-step__main">
        <span class="co-step__title">${escapeHtml(step.title)}</span>
        <span class="n-pill n-pill--nodot n-pill--unknown">${escapeHtml(SITE_LABEL[step.app])}</span>
        <span class="co-step__prompt">${escapeHtml(step.prompt)}</span>
        <span class="co-step__watch">${escapeHtml(step.watch)}</span>
        <span class="co-step__tools">${escapeHtml(step.tools.join(', '))}</span>
      </span>`;
    button.addEventListener('click', () => {
      setSite(step.app);
      el.input.value = step.prompt;
      closeSheet();
      el.input.focus();
    });
    item.append(button);
    el.steps.append(item);
  }
}

function openSheet() {
  sheetReturnFocus = document.activeElement;
  el.sheet.hidden = false;
  el.scrim.hidden = false;
  /* The sheet is a modal: everything behind it leaves the tab order and the
   * accessibility tree while it is open. */
  if (el.app) el.app.inert = true;
  const first = el.sheet.querySelector('button');
  if (first) first.focus();
}

function closeSheet() {
  if (el.sheet.hidden) return;
  el.sheet.hidden = true;
  el.scrim.hidden = true;
  if (el.app) el.app.inert = false;
  if (sheetReturnFocus && typeof sheetReturnFocus.focus === 'function') sheetReturnFocus.focus();
  sheetReturnFocus = null;
}

function trapTab(event) {
  if (event.key !== 'Tab' || el.sheet.hidden) return;
  const focusable = el.sheet.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function readBackend() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (data && data.backend) {
      el.backend.textContent = `model backend: ${data.backend}`;
      return;
    }
    el.backend.textContent = 'model backend: unknown';
  } catch {
    el.backend.textContent = 'model backend unreachable';
  }
}

/* --------------------------------------------------------------- boot -- */

function boot() {
  injectHeader({ app: 'coach', title: 'Coach' });
  injectFooter({ note: 'the agent holds no state of its own' });

  toolCache = readToolCache();
  const saved = readSession();

  renderSwitcher();
  renderChips();
  renderSteps();
  renderClipboard();
  renderActivity();

  if (saved.site === 'custom' && saved.url) setSite('custom', saved.url);
  else setSite(SITES.some((site) => site.key === saved.site) ? saved.site : 'vault');

  if (Array.isArray(saved.transcript) && saved.transcript.length > 0) {
    /* Rebuild the strip from the restored turn so the page comes back whole. */
    activity = saved.transcript
      .filter((entry) => entry.role === 'tool')
      .slice(-ACTIVITY_LIMIT)
      .map((entry) => ({ name: entry.name, ms: entry.ms || 0, status: entry.status || 'ok' }));
    renderActivity();
    agent.load(saved.transcript);
  } else {
    renderTranscript([]);
  }

  startDiscoveryPoll();
  clockTimer = setInterval(() => renderClipboard(), 30000);
  readBackend();

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = el.input.value.trim();
    if (!text || agent.isRunning()) return;
    el.input.value = '';
    agent.send(text);
  });

  el.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      el.form.requestSubmit();
    }
  });

  el.stop.addEventListener('click', () => agent.stop());

  el.customForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = el.customInput.value.trim();
    if (!url) return;
    setSite('custom', url);
  });

  document.querySelector('[data-action="open-script"]').addEventListener('click', openSheet);
  /* /#script opens the sheet on load, so the judge guide and the video can link
   * straight at the seven steps. */
  if (location.hash === '#script') openSheet();
  document.querySelector('[data-action="close-script"]').addEventListener('click', closeSheet);
  el.scrim.addEventListener('click', closeSheet);

  document.querySelector('[data-action="new-session"]').addEventListener('click', () => {
    agent.reset();
    clipboard.clear();
    activity = [];
    pending = null;
    renderActivity();
    writeSession({ transcript: [] });
    toast('New session. The transcript and the token handles are cleared.', 'ok');
    el.input.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
    trapTab(event);
  });

  window.addEventListener('pagehide', () => {
    if (discoveryTimer !== null) clearInterval(discoveryTimer);
    if (clockTimer !== null) clearInterval(clockTimer);
  });
}

boot();

/* nema extension: the page listener and the in page bar (isolated world).
 *
 * This half cannot see `document.modelContext`; bridge.js can. So this file is
 * a courier: it asks the bridge what the page offers, tells the service worker,
 * and forwards the broker calls the side panel makes back down to the bridge.
 *
 * It also owns the one thing the learner sees on the page itself: a small bar
 * at the bottom, in a shadow root of its own so the host page's styles are
 * untouched and nothing the page does can restyle it. The bar says the site works with
 * nema, offers Share and Not now, and later carries the toast that names the
 * bands a receipt moved. Everything it triggers happens elsewhere: the click
 * goes to the service worker, which opens the side panel, and the panel does
 * the vault work.
 */

const FROM_PAGE = 'nema-ext-bridge';
const FROM_EXTENSION = 'nema-ext';

/* The tool names that make a page a nema page. The first five are the ones
 * CONTRACT section 22 detects on; start_activity and get_attempt_status are
 * counted too because a page that has them is running the same protocol. */
const PROTOCOL_TOOLS = new Set([
  'describe_learning_offer',
  'personalize_learning_path',
  'check_prerequisites',
  'present_assertion',
  'issue_evidence_receipt',
  'start_activity',
  'get_attempt_status'
]);

const KEY_TOOLS = new Set([
  'describe_learning_offer',
  'personalize_learning_path',
  'check_prerequisites',
  'present_assertion',
  'issue_evidence_receipt'
]);

/* Pages register their tools after load, one at a time, so the first answer is
 * often empty and the second is often partial. Ask again over the first five
 * seconds and stop when the list stops growing. */
const RETRY_MS = [0, 300, 800, 1500, 2500, 3800, 5000];

let sequence = 0;
const waiting = new Map();
let lastReport = '';
let manifest = null;
/** Activity ids this page has already graded as passed. */
const passed = new Set();
let toolNames = [];
/** Which WebMCP this page runs: what the bridge saw, not what we assume. */
let transport = '';

function nextId() {
  sequence += 1;
  return `c${sequence}`;
}

function ask(message, timeoutMs = 8000) {
  const id = nextId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('the page did not answer'));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    window.postMessage({ ...message, id, source: FROM_EXTENSION }, '*');
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== FROM_PAGE) return;

  if (data.id && waiting.has(data.id)) {
    const entry = waiting.get(data.id);
    waiting.delete(data.id);
    clearTimeout(entry.timer);
    entry.resolve(data);
    return;
  }
  /* An unsolicited push: the page's tool list changed. */
  if (data.type === 'nema-ext:tools') report(data);
});

function pageInfo(tools) {
  const names = tools.map((tool) => tool.name).filter(Boolean);
  const nemaTools = names.filter((name) => PROTOCOL_TOOLS.has(name));
  return {
    url: location.href,
    origin: location.origin,
    title: document.title,
    tools: nemaTools,
    otherTools: names.filter((name) => !PROTOCOL_TOOLS.has(name)).length,
    worksWithNema: names.some((name) => KEY_TOOLS.has(name)),
    visible: document.visibilityState === 'visible',
    passed: [...passed],
    transport,
    manifest
  };
}

function report(data) {
  if (Array.isArray(data.tools)) toolNames = data.tools.map((tool) => tool.name).filter(Boolean);
  if (typeof data.transport === 'string' && data.transport) transport = data.transport;
  const info = pageInfo(Array.isArray(data.tools) ? data.tools : []);
  const fingerprint = JSON.stringify(info);
  if (fingerprint === lastReport) return info;
  lastReport = fingerprint;
  try {
    chrome.runtime.sendMessage({ type: 'nema-ext:page', page: info }).catch(() => {});
  } catch { /* the extension was reloaded under us; the next page load recovers */ }
  return info;
}

/* --------------------------------------------------------- the offer -- */

/**
 * What this page teaches, in the two lists the panel needs: the concepts it
 * can move, and the local names it uses for them. `describe_learning_offer`
 * reads the manifest the page already publishes to any agent; it changes
 * nothing on the page.
 */
function summarizeManifest(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const teaches = [];
  const requires = [];
  const seen = new Set();

  const add = (list, entry) => {
    if (!entry || typeof entry.concept !== 'string' || typeof entry.ability !== 'string') return;
    const key = `${list === teaches ? 't' : 'r'}|${entry.concept}|${entry.ability}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ concept: entry.concept, ability: entry.ability });
  };

  for (const entry of payload.outcomes || []) add(teaches, entry);
  for (const activity of payload.activities || []) {
    for (const entry of activity && activity.outcomes ? activity.outcomes : []) add(teaches, entry);
  }
  /* Everything the site would ask a vault for: its requirements plus every
   * pair a skip or an unlock rule reads, which is the set the panel's Share
   * builds. The card counts these, so it counts what would actually be shared. */
  for (const entry of payload.requirements || []) add(requires, entry);
  for (const activity of payload.activities || []) {
    if (!activity) continue;
    for (const rule of activity.skipIf || []) add(requires, rule);
    for (const rule of activity.unlock || activity.unlockIf || []) add(requires, rule);
  }

  const local = new Set();
  for (const entry of [...teaches, ...requires]) {
    if (!entry.concept.startsWith('nema:')) local.add(entry.concept);
  }
  const declared = [];
  const concepts = [];
  for (const concept of payload.concepts || []) {
    if (!concept || typeof concept.id !== 'string') continue;
    concepts.push(concept);
    if (!concept.id.startsWith('nema:')) local.add(concept.id);
    for (const align of concept.alignsTo || []) {
      if (align && typeof align.concept === 'string') {
        declared.push({
          providerConcept: concept.id,
          title: typeof concept.title === 'string' ? concept.title : concept.id,
          concept: align.concept,
          relation: typeof align.relation === 'string' ? align.relation : 'equivalent'
        });
      }
    }
  }

  const activities = (payload.activities || [])
    .filter((activity) => activity && typeof activity.id === 'string')
    .map((activity) => ({ id: activity.id, title: String(activity.title || activity.id) }));

  return {
    activities,
    unit: {
      id: payload.unit && payload.unit.id ? String(payload.unit.id) : '',
      title: payload.unit && payload.unit.title ? String(payload.unit.title) : '',
      minutes: payload.unit && Number.isFinite(payload.unit.estimatedMinutes)
        ? payload.unit.estimatedMinutes : null
    },
    provider: payload.provider && payload.provider.name ? String(payload.provider.name) : '',
    teaches,
    requires,
    concepts,
    localConcepts: [...local],
    declaredAlignments: declared
  };
}

async function readOffer() {
  try {
    const answer = await ask({ type: 'nema-ext:execute', name: 'describe_learning_offer', args: {} }, 6000);
    if (!answer || answer.ok !== true) return null;
    const result = answer.result;
    const payload = result && result.manifest ? result.manifest : result;
    return summarizeManifest(payload);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the bar -- */

/* The bar is the vault's own palette, written out because a shadow root cannot
 * reach tokens.css and the page's own stylesheet must not be touched. Keep
 * these six values in step with shared/brand/tokens.css. */
const BAR_CSS = `
:host {
  all: initial;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483647;
  display: block;
  pointer-events: none;
}
.wrap {
  box-sizing: border-box;
  margin: 0 auto 16px;
  max-width: 640px;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.bar, .toast {
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #1E3050;
  border-radius: 10px;
  background: #101B2D;
  box-shadow: 0 10px 30px rgba(4, 8, 15, 0.45);
  color: #F2F6FF;
}
.mark { flex: none; width: 20px; height: 20px; display: block; }
.text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.title { margin: 0; font-size: 13px; line-height: 1.35; color: #F2F6FF; }
.sub { margin: 0; font-size: 12px; line-height: 1.35; color: #9FB0CC; }
.sub:empty { display: none; }
.acts { flex: none; display: flex; align-items: center; gap: 8px; }
button {
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #1E3050;
  background: #16233A;
  color: #F2F6FF;
  cursor: pointer;
}
button:hover { border-color: rgba(0, 229, 255, 0.24); }
button.primary { background: #15C4B4; border-color: #15C4B4; color: #0B1320; font-weight: 600; }
button.primary:hover { background: #00E5FF; border-color: #00E5FF; }
button:disabled { opacity: 0.5; cursor: default; }
.toast { border-color: rgba(21, 196, 180, 0.5); }
.toast .title { color: #F2F6FF; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: no-preference) {
  .bar, .toast { animation: rise 180ms ease-out; }
  @keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
}`;

/* The nema mark, flattened to one colour: a 20 px shadow root is no place for
 * a three stop gradient. */
const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z" fill="none" stroke="#15C4B4" stroke-width="3"/>
  <g fill="#F2F6FF"><rect x="24" y="24" width="16" height="4"/><rect x="24" y="28" width="4" height="12"/><rect x="36" y="28" width="4" height="12"/></g>
</svg>`;

const BAR_ID = 'nema-ext-bar';
const DISMISS_KEY = 'nema-ext:not-now';
/** How long the toast stays up. Long enough to read, short enough to forget. */
const TOAST_MS = 12000;
let bar = null;
let toastTimer = null;

function dismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The bar's host element, made once.
 *
 * `force` is for the toast: a learner who said "Not now" to the offer still
 * earned the receipt that just landed, so the toast may bring the host back
 * without the offer coming back with it.
 */
function buildBar({ force = false } = {}) {
  if (bar) return bar;
  if (dismissed() && !force) return null;
  if (!document.body) return null;

  const host = document.createElement('div');
  host.id = BAR_ID;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${BAR_CSS}</style>
    <div class="wrap">
      <div class="toast" role="status" data-toast hidden>
        ${MARK}
        <div class="text"><p class="title" data-toast-text></p></div>
      </div>
      <div class="bar" role="region" aria-label="nema" data-bar>
        ${MARK}
        <div class="text">
          <p class="title" data-bar-title>This site works with nema. Share what you already know?</p>
          <p class="sub" data-bar-sub></p>
        </div>
        <div class="acts" data-bar-acts>
          <button type="button" class="primary" data-share>Share</button>
          <button type="button" data-dismiss>Not now</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);

  bar = {
    host,
    root,
    title: root.querySelector('[data-bar-title]'),
    sub: root.querySelector('[data-bar-sub]'),
    acts: root.querySelector('[data-bar-acts]'),
    share: root.querySelector('[data-share]'),
    dismiss: root.querySelector('[data-dismiss]'),
    toast: root.querySelector('[data-toast]'),
    toastText: root.querySelector('[data-toast-text]')
  };

  if (dismissed()) root.querySelector('[data-bar]').hidden = true;

  bar.share.addEventListener('click', () => shareFromBar(false));
  bar.dismiss.addEventListener('click', () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch { /* a page that forbids storage still gets a bar that closes */ }
    host.remove();
    bar = null;
  });
  return bar;
}

/** One place to write the bar, so every state reads the same way. */
function setBar({ title, sub, actions }) {
  const view = buildBar();
  if (!view) return;
  if (typeof title === 'string') view.title.textContent = title;
  if (typeof sub === 'string') view.sub.textContent = sub;
  if (actions === 'offer') {
    view.acts.hidden = false;
    view.share.disabled = false;
    view.share.textContent = 'Share';
  } else if (actions === 'working') {
    view.acts.hidden = false;
    view.share.disabled = true;
    view.share.textContent = 'Sharing';
  } else if (actions === 'none') {
    view.acts.hidden = true;
  }
}

function showToast(text) {
  const view = buildBar({ force: true });
  if (!view) return;
  view.toastText.textContent = text;
  view.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (bar) bar.toast.hidden = true;
  }, TOAST_MS);
}

/**
 * The learner clicked Share (or the site is remembered and this runs on load).
 *
 * The click is the user gesture `chrome.sidePanel.open` needs, and only the
 * service worker can call it, so the gesture is relayed there and the panel is
 * asked to run the share. When Chrome refuses to open the panel from here the
 * bar says so instead of pretending something happened.
 */
async function shareFromBar(auto) {
  setBar({
    title: auto ? 'Shared with this site' : 'Sharing what you already know',
    sub: auto ? 'You remembered this site, so nothing is asked again.' : 'Opening nema.',
    actions: auto ? 'none' : 'working'
  });
  let answer = null;
  try {
    answer = await chrome.runtime.sendMessage({ type: 'nema-ext:bar-share', auto: Boolean(auto) });
  } catch {
    answer = null;
  }
  if (answer && (answer.opened || answer.panel)) {
    if (!auto) setBar({ sub: 'Approve the disclosure in nema.' });
    return;
  }
  setBar({
    title: auto ? 'Shared with this site' : 'Open nema to approve',
    sub: 'Click the nema icon in the toolbar. The side panel needs your click to open.',
    actions: 'none'
  });
}

/** The manifest says this site names things its own way. */
function alignmentLine() {
  if (!manifest || !Array.isArray(manifest.localConcepts) || manifest.localConcepts.length === 0) return '';
  return 'This site names things its own way. Confirm the matches in nema.';
}

async function offerBar(info) {
  if (!info.worksWithNema || dismissed()) return;
  const unit = manifest && manifest.unit && manifest.unit.title ? manifest.unit.title : '';
  let remembered = false;
  try {
    const answer = await chrome.runtime.sendMessage({ type: 'nema-ext:remembered', origin: location.origin });
    remembered = Boolean(answer && answer.remembered);
  } catch { /* the worker is asleep; treat the site as not remembered */ }

  if (remembered) {
    shareFromBar(true);
    return;
  }
  setBar({
    title: 'This site works with nema. Share what you already know?',
    sub: alignmentLine() || (unit ? `${unit} adapts to what your vault already holds.` : ''),
    actions: 'offer'
  });
}

/* ----------------------------------------------------- the heartbeat -- */

/**
 * The four second pass of CONTRACT 24.3, plus a second look at the tool list.
 *
 * It runs here rather than in the panel because this is the tab: the page knows
 * whether it is visible, its timers are the ones Chrome keeps running while the
 * learner is looking at it, and asking the page about its own attempts costs
 * nothing else. It re-reads the tool list on every pass as well, because a page
 * registers its tools one at a time and may add more later, so a list read at
 * load time is not the last word. When an activity turns `passed` the panel is
 * told once, and the vault work, issuing and staging, happens there.
 */
const HEARTBEAT_MS = 4000;
let heartbeat = null;
let ticking = false;

function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(tick, HEARTBEAT_MS);
}

async function tick() {
  if (ticking || document.visibilityState !== 'visible') return;
  ticking = true;
  try {
    let answer = null;
    try {
      answer = await ask({ type: 'nema-ext:tools-request' }, 2000);
    } catch { /* the page is busy; the next pass asks again */ }
    const info = answer ? report(answer) : null;
    if (!info || !info.worksWithNema) return;

    if (!manifest && info.tools.includes('describe_learning_offer')) {
      manifest = await readOffer();
      if (manifest) {
        lastReport = '';
        report(answer);
      }
    }
    await pollAttempts(info);
  } finally {
    ticking = false;
  }
}

async function pollAttempts(info) {
  if (!manifest || !Array.isArray(manifest.activities) || manifest.activities.length === 0) return;
  if (!info.tools.includes('get_attempt_status') || !info.tools.includes('issue_evidence_receipt')) return;

  let found = false;
  for (const activity of manifest.activities) {
    if (passed.has(activity.id)) continue;
    let answer;
    try {
      answer = await ask({
        type: 'nema-ext:execute', name: 'get_attempt_status', args: { activityId: activity.id }
      }, 8000);
    } catch {
      continue;
    }
    const status = answer && answer.ok && answer.result ? answer.result.status : '';
    if (status === 'passed') {
      passed.add(activity.id);
      found = true;
    }
  }
  if (!found) return;

  /* Two messages, on purpose: the page report is the state the panel reads
   * whenever it looks, and the nudge is what reaches a panel that is not
   * looking. A hidden side panel's timers are throttled; its message listener
   * is not. */
  lastReport = '';
  report({ tools: toolNames.map((name) => ({ name })) });
  try {
    chrome.runtime.sendMessage({ type: 'nema-ext:passed', passed: [...passed] }).catch(() => {});
  } catch { /* the extension was reloaded under us */ }
}

/* ------------------------------------------------------------- scan -- */

async function scan() {
  let found = null;
  let seen = -1;
  for (const delay of RETRY_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    let answer;
    try {
      answer = await ask({ type: 'nema-ext:tools-request' }, 2000);
    } catch {
      continue;
    }
    const info = report(answer);
    /* A page registers its tools one at a time, so the first list that has
     * nema tools in it is often not the whole list. Wait for it to settle. */
    if (info.worksWithNema && info.tools.length === seen) {
      found = info;
      break;
    }
    if (info.worksWithNema) found = info;
    seen = info.tools.length;
  }
  if (!found) return;

  /* The offer is read once per page: it names the unit in the bar, tells the
   * panel which needs this site can teach, and says whether the site uses its
   * own concept names. */
  manifest = await readOffer();
  if (manifest) {
    lastReport = '';
    report({ tools: found.tools.map((name) => ({ name })) });
  }
  offerBar(found);
  startHeartbeat();
}

/* The panel only ever works on a page the learner is looking at, so a tab that
 * goes to the background says so. */
document.addEventListener('visibilitychange', () => {
  if (toolNames.length === 0) return;
  lastReport = '';
  report({ tools: toolNames.map((name) => ({ name })) });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === 'nema-ext:execute') {
    ask({ type: 'nema-ext:execute', name: message.name, args: message.args || {} }, 130000)
      .then((answer) => sendResponse({
        ok: answer.ok === true,
        name: message.name,
        ms: answer.ms || 0,
        result: answer.result,
        error: answer.error
      }))
      .catch((err) => sendResponse({
        ok: false, name: message.name, ms: 0, error: err && err.message ? err.message : String(err)
      }));
    return true;
  }

  if (message.type === 'nema-ext:rescan') {
    ask({ type: 'nema-ext:tools-request' }, 2000)
      .then((answer) => sendResponse(report(answer)))
      .catch(() => sendResponse(null));
    return true;
  }

  /* From the panel, through the worker: what the bar should say now. */
  if (message.type === 'nema-ext:bar') {
    setBar({ title: message.title, sub: message.sub, actions: message.actions });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'nema-ext:toast') {
    showToast(String(message.text || ''));
    sendResponse({ ok: true });
    return false;
  }

  return undefined;
});

scan();

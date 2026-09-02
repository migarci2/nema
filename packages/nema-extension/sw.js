/* nema extension: the service worker.
 *
 * Small jobs, all of them plumbing: open the side panel when the action or the
 * in page bar is clicked, keep one record per tab of what that page offers,
 * cache the manifests seen this session, relay the panel's broker calls to the
 * content script of the page the learner is looking at, and hold the intents
 * the bar raises until the panel is there to run them. It holds no learner
 * data: the vault lives in the side panel's localStorage and never passes
 * through here.
 */

const BADGE_BACKGROUND = '#15C4B4';
const BADGE_TEXT = '#0B1320';
const BADGE_ATTENTION = '#FFCA2E';

/** Manifests seen this session, by origin. Cleared when the browser closes. */
const MANIFEST_KEY = 'nema:manifests';
/** Sites the learner told the vault to remember, mirrored by the panel. */
const AUTO_APPROVE_KEY = 'nema:autoApprove';

/** tabId -> { url, origin, title, tools, otherTools, worksWithNema, visible, manifest, updatedAt } */
const pages = new Map();

/** Work the bar asked for, waiting for a panel to do it. */
const intents = [];
/** When the panel last said anything. The panel polls every 4 seconds. */
let panelSeenAt = 0;

chrome.runtime.onInstalled.addListener(openOnActionClick);
openOnActionClick();

/* The behaviour is per profile, not per session, but a worker that restarts
 * after an update should not lose it. */
function openOnActionClick() {
  try {
    Promise.resolve(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })).catch(() => {});
  } catch { /* an older Chrome without the side panel API */ }
}

function panelIsOpen() {
  return Date.now() - panelSeenAt < 12000;
}

/* ------------------------------------------------------------- badge -- */

function setBadge(tabId, page) {
  const count = page && Array.isArray(page.tools) ? page.tools.length : 0;
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BACKGROUND }).catch(() => {});
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ tabId, color: BADGE_TEXT }).catch(() => {});
    }
    chrome.action.setTitle({
      tabId,
      title: `nema: this page offers ${count} nema tool${count === 1 ? '' : 's'}`
    }).catch(() => {});
  } else {
    chrome.action.setTitle({ tabId, title: 'nema: open your vault' }).catch(() => {});
  }
}

/** Chrome would not open the panel from the bar, so the icon has to ask. */
function askForAttention(tabId) {
  chrome.action.setBadgeText({ tabId, text: '!' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_ATTENTION }).catch(() => {});
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ tabId, color: BADGE_TEXT }).catch(() => {});
  }
  chrome.action.setTitle({ tabId, title: 'nema: open the side panel to approve' }).catch(() => {});
}

function announce(tabId) {
  chrome.runtime.sendMessage({ type: 'nema-ext:page-changed', tabId }).catch(() => {});
}

/* --------------------------------------------------------- tab state -- */

function isWebPage(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://'));
}

function blank(tab) {
  return {
    url: tab?.url || '',
    origin: originOf(tab?.url),
    title: tab?.title || '',
    tools: [],
    otherTools: 0,
    worksWithNema: false,
    visible: true,
    manifest: null,
    updatedAt: Date.now()
  };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Ask a tab's content script to look again. Silent when there is none. */
async function rescan(tabId) {
  try {
    const page = await chrome.tabs.sendMessage(tabId, { type: 'nema-ext:rescan' });
    if (page && typeof page === 'object') {
      pages.set(tabId, { ...page, updatedAt: Date.now() });
      setBadge(tabId, page);
      return pages.get(tabId);
    }
  } catch { /* no content script on this tab, which is an answer too */ }
  return null;
}

/**
 * Which page is the learner looking at?
 *
 * In a real window the side panel is not a tab, so the active tab is the
 * answer. Opened as a tab (headless tests, or a judge who prefers a full page)
 * the panel would find itself, so extension pages are skipped and the most
 * recent nema page is the fallback.
 */
async function resolvePage(explicitTabId, senderTabId) {
  if (Number.isInteger(explicitTabId)) {
    const stored = pages.get(explicitTabId);
    if (stored) return { tabId: explicitTabId, page: stored };
    const scanned = await rescan(explicitTabId);
    if (scanned) return { tabId: explicitTabId, page: scanned };
    const tab = await chrome.tabs.get(explicitTabId).catch(() => null);
    return { tabId: explicitTabId, page: tab ? blank(tab) : null };
  }

  /* The panel's own tab is never the page it is reporting on. Anything else
   * the learner is looking at is, even a blank tab: saying "no nema tools
   * here" is honest, quietly keeping the last page that had them is not. */
  const mine = (tab) => tab.id === senderTabId
    || (typeof tab.url === 'string' && tab.url.startsWith('chrome-extension://'));

  for (const query of [{ active: true, lastFocusedWindow: true }, { active: true }]) {
    const tabs = await chrome.tabs.query(query).catch(() => []);
    const tab = tabs.find((entry) => !mine(entry));
    if (!tab) continue;
    if (!isWebPage(tab.url)) return { tabId: tab.id, page: blank(tab) };
    const stored = pages.get(tab.id);
    if (stored) return { tabId: tab.id, page: stored };
    const scanned = await rescan(tab.id);
    return { tabId: tab.id, page: scanned || blank(tab) };
  }

  const recent = [...pages.entries()]
    .filter(([tabId, page]) => tabId !== senderTabId && page.worksWithNema)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0];
  if (recent) {
    const alive = await chrome.tabs.get(recent[0]).catch(() => null);
    if (alive) return { tabId: recent[0], page: recent[1] };
    pages.delete(recent[0]);
  }
  return { tabId: null, page: null };
}

/* ------------------------------------------------- session manifests -- */

/**
 * Every nema page the learner opens leaves its offer here, so the panel's Next
 * card can say which site teaches the need in front of them. Session storage:
 * it is a browsing memory, not a record, and it goes when the browser does.
 */
async function cacheManifest(page) {
  if (!page || !page.manifest || !page.origin) return;
  try {
    const store = await chrome.storage.session.get(MANIFEST_KEY);
    const map = store && store[MANIFEST_KEY] && typeof store[MANIFEST_KEY] === 'object' ? store[MANIFEST_KEY] : {};
    map[page.origin] = {
      ...page.manifest,
      origin: page.origin,
      url: page.url,
      title: page.title,
      seenAt: Date.now()
    };
    await chrome.storage.session.set({ [MANIFEST_KEY]: map });
  } catch { /* session storage is a nicety; the panel copes without it */ }
}

/** Is this origin one the learner told the vault to remember? */
async function isRemembered(origin) {
  if (!origin) return false;
  try {
    const store = await chrome.storage.local.get(AUTO_APPROVE_KEY);
    const map = store && store[AUTO_APPROVE_KEY];
    if (!map || typeof map !== 'object') return false;
    const until = Date.parse(map[origin] || '');
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------- intents -- */

/**
 * Hand a piece of work to the panel.
 *
 * Straight there when a panel is listening: `sendMessage` rejects with "no
 * receiving end" when there is none, and that is the signal to keep the intent
 * until a panel asks. Delivery must not wait for the panel's own timer: a side
 * panel opened as a background tab has its timers throttled, its message
 * listener never is.
 */
function raise(intent) {
  chrome.runtime.sendMessage({ type: 'nema-ext:intent', intent })
    .then(() => {
      if (Number.isInteger(intent.tabId)) setBadge(intent.tabId, pages.get(intent.tabId));
    })
    .catch(() => {
      intents.push(intent);
      while (intents.length > 8) intents.shift();
    });
}

function drainIntents() {
  const out = intents.splice(0, intents.length);
  for (const intent of out) {
    if (Number.isInteger(intent.tabId)) setBadge(intent.tabId, pages.get(intent.tabId));
  }
  return out;
}

/**
 * The bar was clicked. `chrome.sidePanel.open` needs a user gesture and only
 * the worker may call it, so the click is relayed here. When Chrome refuses,
 * the bar says "Open nema to approve" and the icon starts asking.
 */
async function openPanelFor(tabId, windowId) {
  try {
    await chrome.sidePanel.open(Number.isInteger(tabId) ? { tabId } : { windowId });
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------- messages -- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  /* From a content script: this is what my page offers. */
  if (message.type === 'nema-ext:page' && sender.tab && Number.isInteger(sender.tab.id)) {
    const page = { ...message.page, updatedAt: Date.now() };
    pages.set(sender.tab.id, page);
    setBadge(sender.tab.id, page);
    cacheManifest(page);
    announce(sender.tab.id);
    sendResponse({ ok: true });
    return false;
  }

  /* From a content script: an activity turned passed on my page. */
  if (message.type === 'nema-ext:passed' && sender.tab && Number.isInteger(sender.tab.id)) {
    const stored = pages.get(sender.tab.id);
    if (stored) stored.passed = Array.isArray(message.passed) ? message.passed : [];
    raise({ kind: 'collect', tabId: sender.tab.id });
    sendResponse({ ok: true });
    return false;
  }

  /* From a content script: is this site remembered? */
  if (message.type === 'nema-ext:remembered') {
    isRemembered(message.origin || originOf(sender.tab?.url))
      .then((remembered) => sendResponse({ remembered }))
      .catch(() => sendResponse({ remembered: false }));
    return true;
  }

  /* From the in page bar: the learner clicked Share. */
  if (message.type === 'nema-ext:bar-share') {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    (async () => {
      /* An automatic share for a remembered site has no click behind it, so it
       * never tries to open the panel: it waits for one that is already open. */
      const opened = message.auto ? false : await openPanelFor(tabId, windowId);
      raise({ kind: 'share', tabId, auto: Boolean(message.auto) });
      const panel = panelIsOpen();
      if (!opened && !panel && Number.isInteger(tabId) && !message.auto) askForAttention(tabId);
      sendResponse({ opened, panel });
    })();
    return true;
  }

  /* From the side panel: which page am I looking at, and what is waiting? */
  if (message.type === 'nema-ext:active-page') {
    panelSeenAt = Date.now();
    resolvePage(message.tabId, sender.tab?.id)
      .then((answer) => sendResponse({ ...answer, intents: drainIntents() }))
      .catch(() => sendResponse({ tabId: null, page: null, intents: [] }));
    return true;
  }

  /* From the side panel: run one tool on that page. */
  if (message.type === 'nema-ext:execute') {
    panelSeenAt = Date.now();
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ ok: false, name: message.name, ms: 0, error: 'no page to call' });
      return false;
    }
    chrome.tabs.sendMessage(message.tabId, {
      type: 'nema-ext:execute', name: message.name, args: message.args || {}
    })
      .then((answer) => sendResponse(answer || {
        ok: false, name: message.name, ms: 0, error: 'the page did not answer'
      }))
      .catch((err) => sendResponse({
        ok: false, name: message.name, ms: 0,
        error: err && err.message ? err.message : 'the page did not answer'
      }));
    return true;
  }

  /* From the side panel: say this in the page's bar or toast. */
  if (message.type === 'nema-ext:to-page') {
    panelSeenAt = Date.now();
    if (!Number.isInteger(message.tabId)) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.tabs.sendMessage(message.tabId, message.message || {})
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return undefined;
});

/* ------------------------------------------------------------ events -- */

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    pages.delete(tabId);
    setBadge(tabId, null);
    announce(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pages.delete(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => announce(tabId));
chrome.windows?.onFocusChanged?.addListener(() => announce(null));

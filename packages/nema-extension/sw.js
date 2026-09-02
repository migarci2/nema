/* nema extension: the service worker.
 *
 * Three jobs, all small: open the side panel when the action is clicked, keep
 * one record per tab of what that page offers, and relay the panel's two broker
 * calls to the content script of the page the learner is looking at. It holds
 * no learner data: the vault lives in the side panel's localStorage and never
 * passes through here.
 */

const BADGE_BACKGROUND = '#15C4B4';
const BADGE_TEXT = '#0B1320';

/** tabId -> { url, origin, title, tools, otherTools, worksWithNema, updatedAt } */
const pages = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

/* ------------------------------------------------------------- badge -- */

function setBadge(tabId, page) {
  const count = page && Array.isArray(page.tools) ? page.tools.length : 0;
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BACKGROUND }).catch(() => {});
    chrome.action.setBadgeTextColor?.({ tabId, color: BADGE_TEXT }).catch(() => {});
    chrome.action.setTitle({
      tabId,
      title: `nema: this page offers ${count} nema tool${count === 1 ? '' : 's'}`
    }).catch(() => {});
  } else {
    chrome.action.setTitle({ tabId, title: 'nema: open your vault' }).catch(() => {});
  }
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

  const windows = [{ active: true, lastFocusedWindow: true }, { active: true }];
  for (const query of windows) {
    const tabs = await chrome.tabs.query(query).catch(() => []);
    const tab = tabs.find((entry) => entry.id !== senderTabId && isWebPage(entry.url));
    if (tab) {
      const stored = pages.get(tab.id);
      if (stored) return { tabId: tab.id, page: stored };
      const scanned = await rescan(tab.id);
      return { tabId: tab.id, page: scanned || blank(tab) };
    }
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

/* ---------------------------------------------------------- messages -- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  /* From a content script: this is what my page offers. */
  if (message.type === 'nema-ext:page' && sender.tab && Number.isInteger(sender.tab.id)) {
    const page = { ...message.page, updatedAt: Date.now() };
    pages.set(sender.tab.id, page);
    setBadge(sender.tab.id, page);
    announce(sender.tab.id);
    sendResponse({ ok: true });
    return false;
  }

  /* From the side panel: which page am I looking at? */
  if (message.type === 'nema-ext:active-page') {
    resolvePage(message.tabId, sender.tab?.id)
      .then(sendResponse)
      .catch(() => sendResponse({ tabId: null, page: null }));
    return true;
  }

  /* From the side panel: run one tool on that page. */
  if (message.type === 'nema-ext:execute') {
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

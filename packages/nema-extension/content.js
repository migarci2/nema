/* nema extension: the page listener (isolated world).
 *
 * This half cannot see `document.modelContext`; bridge.js can. So this file is
 * a courier: it asks the bridge what the page offers, tells the service worker,
 * and forwards the two broker calls the side panel makes back down to the
 * bridge. It never touches page state and never runs anything on its own.
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

/* Pages register their tools after load, so the first answer is often empty.
 * Ask again over the first five seconds and stop as soon as the page answers
 * with nema tools. */
const RETRY_MS = [0, 300, 800, 1500, 2500, 3800, 5000];

let sequence = 0;
const waiting = new Map();
let lastReport = '';

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
    worksWithNema: names.some((name) => KEY_TOOLS.has(name))
  };
}

function report(data) {
  const info = pageInfo(Array.isArray(data.tools) ? data.tools : []);
  const fingerprint = JSON.stringify(info);
  if (fingerprint === lastReport) return info;
  lastReport = fingerprint;
  try {
    chrome.runtime.sendMessage({ type: 'nema-ext:page', page: info }).catch(() => {});
  } catch { /* the extension was reloaded under us; the next page load recovers */ }
  return info;
}

async function scan() {
  for (const delay of RETRY_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    let answer;
    try {
      answer = await ask({ type: 'nema-ext:tools-request' }, 2000);
    } catch {
      continue;
    }
    const info = report(answer);
    if (info.worksWithNema) return;
  }
}

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

  return undefined;
});

scan();

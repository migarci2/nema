/* nema extension: the end to end test.
 *
 * Drives the real extension in a real Chrome with native WebMCP, through CDP,
 * with no test doubles anywhere: the vault is the vault, Saucier School is the
 * dev server, and the two buttons in the panel are clicked the way a person
 * clicks them.
 *
 *   1. load the unpacked extension, find its id from the service worker target
 *   2. open the side panel page, load the demo learner
 *   3. open Saucier School, wait for the strip to see its tools
 *   4. Share bands with this page, approve in the consent modal
 *   5. assert the provider rebuilt the path: 27 minutes of 68
 *   6. answer the ratios diagnostic in the page, as the learner
 *   7. Take the receipt to my vault, assert accepted and one more ledger row
 *
 * Usage:
 *   bash scripts/build-extension.sh
 *   CHROME=<chrome with WebMCP> node packages/nema-extension/test/e2e.mjs [saucierOrigin]
 *
 * Screenshots land in SHOTS (default /tmp/nema-ext-shots).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const DIST = `${REPO}/packages/nema-extension/dist`;
const SAUCIER = process.argv[2] || process.env.SAUCIER || 'http://localhost:8782';
const SHOTS = process.env.SHOTS || '/tmp/nema-ext-shots';
const CHROME = process.env.CHROME;

if (!CHROME) {
  console.error('set CHROME to a Chrome binary with native WebMCP (Chrome for Testing 154)');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function ok(condition, message) {
  console.log((condition ? 'PASS ' : 'FAIL ') + message);
  if (!condition) failures += 1;
}

/* ------------------------------------------------------------- CDP -- */

async function launch() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = `/tmp/nema-ext-profile-${port}`;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1280,1000',
    `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let endpoint = null;
  for (let i = 0; i < 60 && !endpoint; i += 1) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      endpoint = version.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!endpoint) await sleep(250);
  }
  if (!endpoint) { chrome.kill(); throw new Error('Chrome did not start'); }

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  const sessions = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    const page = sessions.get(message.sessionId);
    if (!page) return;
    if (message.method === 'Runtime.exceptionThrown') {
      page.errors.push(message.params.exceptionDetails?.exception?.description
        || message.params.exceptionDetails?.text || 'exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      page.errors.push(message.params.args.map((a) => a.value || a.description).join(' '));
    }
  };

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (message) => {
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  async function attach(targetId, { width = 0, height = 0, worker = false } = {}) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = {
      sessionId,
      errors: [],
      async send(method, params) { return send(method, params, sessionId); },
      async evaluate(expression) {
        const reply = await send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true
        }, sessionId);
        if (reply.exceptionDetails) {
          throw new Error(reply.exceptionDetails.exception?.description || 'evaluate failed');
        }
        return reply.result?.value;
      },
      async waitFor(expression, { timeoutMs = 20000, label = expression } = {}) {
        const until = Date.now() + timeoutMs;
        let last;
        while (Date.now() < until) {
          try {
            last = await page.evaluate(expression);
            if (last) return last;
          } catch (err) { last = err.message; }
          await sleep(200);
        }
        throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
      },
      async shot(name) {
        const reply = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        const file = `${SHOTS}/${name}.png`;
        writeFileSync(file, Buffer.from(reply.data, 'base64'));
        return file;
      }
    };
    sessions.set(sessionId, page);
    if (!worker) await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    if (width && height) {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false
      }, sessionId);
    }
    return page;
  }

  return {
    async targets() { return (await send('Target.getTargets')).targetInfos; },
    async newPage(url, size) {
      const { targetId } = await send('Target.createTarget', { url });
      return attach(targetId, size);
    },
    async attachWorker(targetId) { return attach(targetId, { worker: true }); },
    async close() { ws.close(); chrome.kill(); }
  };
}

/* ------------------------------------------------------------ test -- */

const browser = await launch();
try {
  /* 1. the extension id, read from its service worker target */
  let extensionId = null;
  let workerTarget = null;
  for (let i = 0; i < 40 && !extensionId; i += 1) {
    const targets = await browser.targets();
    /* Chrome runs component extensions of its own, so match this one's worker
     * file rather than the first extension service worker in the list. */
    workerTarget = targets.find((t) => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]+\/sw\.js$/.test(t.url));
    if (workerTarget) extensionId = new URL(workerTarget.url).host;
    else await sleep(250);
  }
  ok(Boolean(extensionId), `extension loaded, id ${extensionId}`);
  if (!extensionId) throw new Error('the extension did not load');

  /* 2. the side panel, at the width a side panel actually has */
  const panel = await browser.newPage(`chrome-extension://${extensionId}/sidepanel.html`, {
    width: 420, height: 1000
  });
  await panel.waitFor(`Boolean(document.querySelector('[data-action="load-demo"]'))`, { label: 'the vault to render' });
  ok(await panel.evaluate(`document.title`) === 'nema in your browser', 'the panel is the vault page, titled for the browser');
  ok(await panel.evaluate(`getComputedStyle(document.querySelector('.n-header__nav')).display === 'none'`),
    'the hub nav is hidden in the panel');

  await panel.evaluate(`document.querySelector('[data-action="load-demo"]').click(), true`);
  const seeded = await panel.waitFor(
    `(() => { const d = JSON.parse(localStorage.getItem('nema.vault.v1') || '{}'); return d.receipts && d.receipts.length > 20 ? d.receipts.length : 0; })()`,
    { label: 'the demo learner to load' }
  );
  ok(seeded > 20, `demo learner loaded: ${seeded} receipts`);
  console.log('shot ' + await panel.shot('01-panel-vault'));

  /* 3. Saucier School in a second tab */
  const site = await browser.newPage(SAUCIER + '/');
  await site.waitFor(`Boolean(document.querySelector('[data-path-list] .n-path__row'))`, { label: 'Saucier School to render' });

  const strip = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-state]').textContent; return t.includes('Works with nema') ? t : ''; })()`,
    { timeoutMs: 25000, label: 'the strip to see the page' }
  );
  const toolCount = Number((strip.match(/(\d+) tools/) || [])[1] || 0);
  ok(toolCount >= 5, `the strip sees the page: ${strip.trim()}`);
  const toolLine = await panel.evaluate(`document.querySelector('[data-ext-tools]').textContent`);
  ok(toolLine.includes('describe_learning_offer') && toolLine.includes('issue_evidence_receipt'),
    `the strip lists what the page can do: ${toolLine.trim()}`);
  console.log('shot ' + await panel.shot('02-panel-this-page'));

  /* the badge, read from the service worker itself */
  const worker = await browser.attachWorker(workerTarget.targetId);
  const badge = await worker.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url.startsWith(${JSON.stringify(SAUCIER)}));
    if (!tab) return 'no tab';
    return await chrome.action.getBadgeText({ tabId: tab.id }) + ' | ' + await chrome.action.getTitle({ tabId: tab.id });
  })()`);
  ok(badge.startsWith(String(toolCount)) && badge.includes('nema tool'), `the action badge counts the page's tools: ${badge}`);

  /* 4. share bands, approve in the modal */
  await panel.evaluate(`document.querySelector('[data-ext-share]').click(), true`);
  await panel.waitFor(`document.querySelector('#consent-modal').hidden === false`, { label: 'the consent modal' });
  const modal = await panel.evaluate(`document.querySelector('[data-consent-origin]').textContent + ' | ' + document.querySelector('[data-consent-purpose]').textContent`);
  ok(modal.includes('localhost:8782') && modal.includes('personalize-pan-sauces-foundations'),
    `the modal names the site and the purpose: ${modal}`);
  console.log('shot ' + await panel.shot('03-panel-consent'));
  await panel.evaluate(`document.querySelector('[data-consent-approve]').click(), true`);

  const shareResult = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-result]').textContent; return t.includes('minutes of') || t.includes('rejected') || t.includes('denied') ? t : ''; })()`,
    { label: 'the share result' }
  );
  ok(shareResult.includes('27 minutes of 68'), `the strip reports the new path: ${shareResult.trim().slice(0, 120)}`);
  console.log('shot ' + await panel.shot('04-panel-shared'));

  /* 5. the page itself changed */
  const pathNote = await site.waitFor(
    `(() => { const t = document.querySelector('[data-path-note]').textContent; return t.includes('27') ? t : ''; })()`,
    { label: 'Saucier School to personalise' }
  );
  const struck = await site.evaluate(`document.querySelectorAll('.n-path__row--skipped').length`);
  ok(pathNote.includes('27 of 68') && struck >= 2, `the page rebuilt its path: ${pathNote.trim()} (${struck} struck through)`);
  console.log('shot ' + await site.shot('05-saucier-personalised'));

  /* 6. the learner answers the diagnostic, in the page, by hand */
  await site.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-path-list] .n-path__row')]
      .find((r) => r.textContent.toLowerCase().includes('vinaigrette'));
    if (!row) throw new Error('no vinaigrette row on the path');
    row.click();
    return true;
  })()`);
  await site.waitFor(`Boolean(document.querySelector('input[name="diagnostic-option"][value="ratio-b"]'))`, { label: 'the diagnostic' });
  await site.evaluate(`document.querySelector('input[name="diagnostic-option"][value="ratio-b"]').click(), true`);
  await site.evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-stage] button')]
      .find((b) => b.textContent.trim() === 'Submit answer');
    if (!button) throw new Error('no Submit answer button');
    button.click();
    return true;
  })()`);
  const passed = await site.waitFor(
    `(() => { const s = JSON.parse(localStorage.getItem('nema.harness.v1') || '{}');
       return s.attempts && s.attempts['ratios-diagnostic'] ? s.attempts['ratios-diagnostic'].status : ''; })()`,
    { label: 'the diagnostic to grade' }
  );
  ok(passed === 'passed', `the learner passed the ratios diagnostic in the page: ${passed}`);
  console.log('shot ' + await site.shot('06-saucier-passed'));

  /* 7. take the receipt to the vault */
  const before = await panel.evaluate(`JSON.parse(localStorage.getItem('nema.vault.v1')).receipts.length`);
  await panel.evaluate(`document.querySelector('[data-ext-receipt]').click(), true`);
  const receiptResult = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-result]').textContent;
       return t.includes('accepted') || t.includes('rejected') || t.includes('Nothing to collect') ? t : ''; })()`,
    { timeoutMs: 40000, label: 'the receipt result' }
  );
  ok(receiptResult.includes('accepted'), `the strip reports the receipt: ${receiptResult.trim().slice(0, 200)}`);

  const after = await panel.evaluate(`JSON.parse(localStorage.getItem('nema.vault.v1')).receipts.length`);
  ok(after === before + 1, `the vault gained one receipt: ${before} to ${after}`);
  const staged = await panel.evaluate(`(() => {
    const doc = JSON.parse(localStorage.getItem('nema.vault.v1'));
    const entry = doc.receipts[doc.receipts.length - 1];
    return { activity: entry.payload.activity.id, issuer: entry.payload.issuer, trust: entry.trust, source: entry.source };
  })()`);
  ok(staged.activity === 'ratios-diagnostic' && staged.trust === 'registered' && staged.source === 'extension',
    `the new row is the diagnostic receipt: ${JSON.stringify(staged)}`);
  const ledger = await panel.evaluate(`document.querySelector('[data-evidence-ledger]').textContent.includes('Which vinaigrette holds')`);
  ok(ledger, 'the evidence ledger shows the new receipt');
  const moved = await panel.evaluate(`document.querySelector('[data-ext-result]').textContent.includes('ratios apply')`);
  ok(moved, 'the strip says which band moved');
  console.log('shot ' + await panel.shot('07-panel-receipt'));

  /* 8. an ordinary page: the strip says so and offers nothing */
  await browser.newPage('about:blank');
  const quiet = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-state]').textContent;
       return t.includes('does not offer') ? t : ''; })()`,
    { label: 'the strip to report an ordinary page' }
  );
  const hidden = await panel.evaluate(`document.querySelector('[data-ext-actions]').hidden`);
  ok(quiet.includes('does not offer nema tools') && hidden === true,
    `an ordinary page offers no buttons: ${quiet.trim()}`);

  /* console hygiene, both sides */
  ok(panel.errors.length === 0, `panel console errors: ${JSON.stringify(panel.errors)}`);
  ok(site.errors.length === 0, `page console errors: ${JSON.stringify(site.errors)}`);
} catch (err) {
  failures += 1;
  console.error('FAIL ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}

console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

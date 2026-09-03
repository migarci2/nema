/* nema extension: the end to end test.
 *
 * Drives the real extension in a real Chrome with native WebMCP, through CDP,
 * with no test doubles anywhere: the vault is the vault, Saucier School is the
 * dev server, and every button is clicked the way a person clicks it, including
 * the Share button in the page's own bar.
 *
 *   1. load the unpacked extension, find its id from the service worker target
 *   2. open the side panel: a fresh profile shows the first run card, and its
 *      own button loads the demo learner
 *   3. the Next card names a need and lists its rubric as a checklist
 *   4. open Saucier School, wait for the hood to see it and for the in page bar
 *   5. Share from the bar, tick "Remember this site for 30 days", approve in
 *      the consent modal, assert "68 minutes became 27" and the 30 day approval
 *   6. the page itself rebuilds its path around what was shared
 *   7. answer the ratios diagnostic in the page, as the learner
 *   8. the receipt is collected with no click, and the page gets the toast
 *   9. "Check for receipts now", under the hood, says it is already kept
 *  10. an ordinary page offers nothing
 *  11. the Next card's rubric is ticked and Done records a self check
 *  12. Saucier School again: a remembered site personalises with no consent
 *  13. the blog, which names things its own way: the alignment it declares
 *      arrives confirmed, and the name it declares nothing about waits
 *
 * Usage:
 *   bash scripts/build-extension.sh
 *   CHROME=<chrome with WebMCP> node packages/nema-extension/test/e2e.mjs [saucierOrigin] [blogOrigin]
 *
 * Screenshots land in SHOTS (default /tmp/nema-ext-shots).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const DIST = `${REPO}/packages/nema-extension/dist`;
const SAUCIER = process.argv[2] || process.env.SAUCIER || 'http://localhost:8782';
const BLOG = process.argv[3] || process.env.BLOG || 'http://localhost:8785';
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
  /* A fresh profile every run, and only this run's: two runs that pick the same
   * port must not share a vault, or the second one starts with the first one's
   * receipts and no onboarding. */
  const profile = `/tmp/nema-ext-profile-${port}-${process.pid}-${Date.now()}`;
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
    async close() {
      ws.close();
      chrome.kill();
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    }
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
  /* The header and the extension's cards are both written by their modules, so
   * the onboarding card is the signal that the whole panel is up. */
  const onboarding = await panel.waitFor(
    `(() => { const el = document.querySelector('[data-ext-onboard]');
       const nav = document.querySelector('.n-header__nav');
       return el && !el.hidden && nav ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
    { label: 'the onboarding card on a fresh profile' }
  );
  ok(await panel.evaluate(`document.title`) === 'nema in your browser', 'the panel is the vault page, titled for the browser');
  ok(await panel.evaluate(`getComputedStyle(document.querySelector('.n-header__nav')).display === 'none'`),
    'the hub nav is hidden in the panel');
  const onboardingButtons = await panel.evaluate(`[
    Boolean(document.querySelector('[data-ext-onboard-demo]')),
    Boolean(document.querySelector('[data-ext-onboard-import]')),
    Boolean(document.querySelector('[data-ext-onboard-empty]')),
    getComputedStyle(document.querySelector('[aria-labelledby="p-graph"]')).display === 'none'
  ]`);
  ok(onboarding.includes('Learn anywhere you see the nema mark') && onboardingButtons.every(Boolean),
    `a fresh panel offers three choices and hides the empty vault: ${onboarding.slice(0, 90)}`);
  console.log('shot ' + await panel.shot('01-panel-onboarding'));

  await panel.evaluate(`document.querySelector('[data-ext-onboard-demo]').click(), true`);
  const seeded = await panel.waitFor(
    `(() => { const d = JSON.parse(localStorage.getItem('nema.vault.v1') || '{}'); return d.receipts && d.receipts.length > 20 ? d.receipts.length : 0; })()`,
    { label: 'the demo learner to load' }
  );
  ok(seeded > 20, `the onboarding button loaded the demo learner: ${seeded} receipts`);
  ok(await panel.waitFor(`document.querySelector('[data-ext-onboard]').hidden === true`, { label: 'the onboarding to step aside' }),
    'the onboarding steps aside once the vault has evidence');
  console.log('shot ' + await panel.shot('02-panel-vault'));

  /* 3. the Next card: one need, its rubric as a checklist, a way to answer it */
  const next = await panel.waitFor(
    `(() => { const el = document.querySelector('[data-ext-next]');
       if (!el || el.hidden) return '';
       const boxes = el.querySelectorAll('[data-ext-check]').length;
       const title = el.querySelector('.x-next__title');
       const done = el.querySelector('[data-ext-done]');
       return boxes > 0 && title && done ? JSON.stringify({ title: title.textContent.trim(), boxes, done: done.textContent.trim() }) : ''; })()`,
    { label: 'the Next card' }
  );
  const nextCard = JSON.parse(next);
  ok(nextCard.boxes >= 2 && nextCard.title.length > 0,
    `the Next card names a need and lists its rubric: ${nextCard.title}, ${nextCard.boxes} criteria`);
  ok(/Done|agent would grade/.test(nextCard.done),
    `the Next card offers the answer the vault can take: "${nextCard.done}"`);
  console.log('shot ' + await panel.shot('03-panel-next'));

  /* 4. Saucier School in a second tab */
  const site = await browser.newPage(SAUCIER + '/');
  await site.waitFor(`Boolean(document.querySelector('[data-path-list] .n-path__row'))`, { label: 'Saucier School to render' });

  /* The page registers its tools one at a time, so wait for the whole set
   * rather than the first list that has any of them in it. */
  const strip = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-state]').textContent;
       const tools = document.querySelector('[data-ext-tools]').textContent;
       return t.includes('Works with nema') && tools.includes('issue_evidence_receipt') ? t : ''; })()`,
    { timeoutMs: 25000, label: 'the strip to see the page' }
  );
  const toolCount = Number((strip.match(/(\d+) tools/) || [])[1] || 0);
  ok(toolCount >= 5, `the strip sees the page: ${strip.trim()}`);
  const toolLine = await panel.evaluate(`document.querySelector('[data-ext-tools]').textContent`);
  ok(toolLine.includes('describe_learning_offer') && toolLine.includes('issue_evidence_receipt'),
    `the strip lists what the page can do: ${toolLine.trim()}`);
  console.log('shot ' + await panel.shot('04-panel-this-page'));

  /* the page's own bar, in its shadow root */
  const barText = await site.waitFor(
    `(() => { const host = document.getElementById('nema-ext-bar');
       if (!host || !host.shadowRoot) return '';
       const bar = host.shadowRoot.querySelector('[data-bar]');
       return bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
    { timeoutMs: 25000, label: 'the in page bar' }
  );
  const barButtons = await site.evaluate(`(() => {
    const root = document.getElementById('nema-ext-bar').shadowRoot;
    return [...root.querySelectorAll('button')].map((b) => b.textContent.trim());
  })()`);
  ok(barText.includes('This site works with nema') && barButtons.join(' ') === 'Share Not now',
    `the page gets a bar with Share and Not now: ${barText.slice(0, 80)}`);
  ok(await site.evaluate(`document.getElementById('nema-ext-bar').shadowRoot.mode === 'open' && !document.getElementById('nema-ext-bar').shadowRoot.host.getAttribute('style')`),
    'the bar lives in a shadow root and leaves the page alone');
  console.log('shot ' + await site.shot('05-saucier-bar'));

  /* the badge, read from the service worker itself */
  const worker = await browser.attachWorker(workerTarget.targetId);
  const badge = await worker.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url.startsWith(${JSON.stringify(SAUCIER)}));
    if (!tab) return 'no tab';
    return await chrome.action.getBadgeText({ tabId: tab.id }) + ' | ' + await chrome.action.getTitle({ tabId: tab.id });
  })()`);
  ok(badge.startsWith(String(toolCount)) && badge.includes('nema tool'), `the action badge counts the page's tools: ${badge}`);

  /* 5. Share from the page's own bar, approve in the modal */
  await site.evaluate(`document.getElementById('nema-ext-bar').shadowRoot.querySelector('[data-share]').click(), true`);
  await panel.waitFor(`document.querySelector('#consent-modal').hidden === false`,
    { timeoutMs: 25000, label: 'the consent modal, opened from the bar' });
  const modal = await panel.evaluate(`document.querySelector('[data-consent-purpose]').textContent`);
  const modalUnder = await panel.evaluate(`document.querySelector('[data-consent-origin]').textContent + ' | ' + document.querySelector('[data-consent-under]').textContent.replace(/\\s+/g, ' ')`);
  /* CONTRACT 26: the question is in words, and the origin, the purpose string
     and the learner id are behind the panel's one closed block. */
  ok(modal.includes('to skip what you already know') && !/nema:|lk_|personalize-/.test(modal),
    `Share in the page's bar opens the vault's own consent modal: ${modal}`);
  ok(modalUnder.includes(new URL(SAUCIER).host) && modalUnder.includes('personalize-pan-sauces-foundations') && modalUnder.includes('lk_'),
    `and the machine words are under the hood: ${modalUnder.slice(0, 120)}`);
  const remember = await panel.evaluate(`(() => { const el = document.querySelector('.x-remember');
    return el && !el.hidden ? el.textContent.trim() : ''; })()`);
  ok(remember.includes('Remember this site for 30 days'),
    `the extension adds its own line to the modal: ${remember}`);
  console.log('shot ' + await panel.shot('06-panel-consent'));
  await panel.evaluate(`document.querySelector('[data-ext-remember]').click(), true`);
  await panel.evaluate(`document.querySelector('[data-consent-approve]').click(), true`);

  const shareResult = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-result]').textContent; return t.includes('minutes became') || t.includes('did not take it') || t.includes('denied') ? t : ''; })()`,
    { label: 'the share result' }
  );
  ok(shareResult.includes('68 minutes became 27'), `the card reports the new path: ${shareResult.trim().slice(0, 120)}`);
  const barAfter = await site.waitFor(
    `(() => { const t = document.getElementById('nema-ext-bar').shadowRoot.querySelector('[data-bar]').textContent.replace(/\\s+/g, ' ').trim();
       return t.includes('Shared with this site') ? t : ''; })()`,
    { label: 'the bar to report the share' }
  );
  ok(barAfter.includes('27 minutes instead of 68'), `the bar says what the site did with the bands: ${barAfter}`);
  const rememberedFor = await panel.evaluate(`(() => {
    const doc = JSON.parse(localStorage.getItem('nema.vault.v1'));
    const until = doc.settings.autoApprove[${JSON.stringify(SAUCIER)}];
    return until ? Math.round((Date.parse(until) - Date.now()) / 86400000) : 0;
  })()`);
  ok(rememberedFor === 30, `the checkbox remembered the site for 30 days: ${rememberedFor}`);
  console.log('shot ' + await panel.shot('07-panel-shared'));

  /* 6. the page itself changed */
  const pathNote = await site.waitFor(
    `(() => { const t = document.querySelector('[data-path-note]').textContent; return t.includes('27') ? t : ''; })()`,
    { label: 'Saucier School to personalise' }
  );
  const struck = await site.evaluate(`document.querySelectorAll('.n-path__row--skipped').length`);
  ok(pathNote.includes('27 of 68') && struck >= 2, `the page rebuilt its path: ${pathNote.trim()} (${struck} struck through)`);
  console.log('shot ' + await site.shot('08-saucier-personalised'));

  /* 7. the learner answers the diagnostic, in the page, by hand */
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
  console.log('shot ' + await site.shot('09-saucier-passed'));

  /* 8. nobody clicks anything: the receipt is collected within four seconds */
  const before = seeded;
  const toast = await site.waitFor(
    `(() => { const root = document.getElementById('nema-ext-bar').shadowRoot;
       const el = root.querySelector('[data-toast]');
       return el && !el.hidden ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
    { timeoutMs: 40000, label: 'the toast in the page' }
  );
  ok(toast.includes('Kept in your vault') && toast.includes('ratios'),
    `the page is told what was kept, with no button click: ${toast}`);
  console.log('shot ' + await site.shot('10-saucier-toast'));

  const after = await panel.evaluate(`JSON.parse(localStorage.getItem('nema.vault.v1')).receipts.length`);
  ok(after === before + 1, `the vault gained one receipt on its own: ${before} to ${after}`);
  const staged = await panel.evaluate(`(() => {
    const doc = JSON.parse(localStorage.getItem('nema.vault.v1'));
    const entry = doc.receipts[doc.receipts.length - 1];
    return { activity: entry.payload.activity.id, issuer: entry.payload.issuer, trust: entry.trust, source: entry.source };
  })()`);
  ok(staged.activity === 'ratios-diagnostic' && staged.trust === 'registered' && staged.source === 'extension',
    `the new row is the diagnostic receipt: ${JSON.stringify(staged)}`);
  const ledger = await panel.evaluate(`document.querySelector('[data-evidence-ledger]').textContent.includes('Which vinaigrette holds')`);
  ok(ledger, 'the evidence ledger shows the new receipt');
  const result = await panel.evaluate(`document.querySelector('[data-ext-result]').textContent`);
  ok(result.includes('Cooking ratios is now usable') && !/nema:|rcpt_|nema1\./.test(result),
    `the card says which band moved, in one sentence: ${result.replace(/\s+/g, ' ').slice(0, 120)}`);
  console.log('shot ' + await panel.shot('11-panel-receipt'));

  /* 9. the manual button is still there, and is honest about the duplicate */
  await panel.evaluate(`document.querySelector('[data-ext-receipt]').click(), true`);
  const manual = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-result]').textContent;
       return t.includes('already in your vault') || t.includes('Nothing to collect') ? t : ''; })()`,
    { timeoutMs: 40000, label: 'the manual check' }
  );
  const stillOne = await panel.evaluate(`JSON.parse(localStorage.getItem('nema.vault.v1')).receipts.length`);
  ok(manual.includes('already in your vault') && stillOne === after,
    `"Check for receipts now" collects nothing twice: ${manual.trim().slice(0, 120)}`);

  /* 10. an ordinary page: the strip says so and offers nothing */
  await browser.newPage('about:blank');
  const quiet = await panel.waitFor(
    `(() => { const t = document.querySelector('[data-ext-state]').textContent;
       return t.includes('does not offer') ? t : ''; })()`,
    { label: 'the strip to report an ordinary page' }
  );
  const hidden = await panel.evaluate(`document.querySelector('[data-ext-actions]').hidden`);
  ok(quiet.includes('does not offer nema tools') && hidden === true,
    `an ordinary page offers no buttons: ${quiet.trim()}`);

  /* 11. the Next card answers itself: tick the rubric, press Done */
  const selfCheck = await panel.evaluate(`(() => {
    const card = document.querySelector('[data-ext-next]');
    const done = card.querySelector('[data-ext-done]');
    if (!done || done.disabled) return { skipped: done ? done.textContent.trim() : 'no button' };
    for (const box of card.querySelectorAll('[data-ext-check]')) box.click();
    done.click();
    return { clicked: true };
  })()`);
  if (selfCheck.clicked) {
    const kept = await panel.waitFor(
      `(() => { const t = document.querySelector('[data-ext-next-status]');
         return t && t.textContent.trim() ? t.textContent.trim() : ''; })()`,
      { label: 'the self check to land' }
    );
    const selfRow = await panel.evaluate(`(() => {
      const doc = JSON.parse(localStorage.getItem('nema.vault.v1'));
      const entry = doc.receipts[doc.receipts.length - 1];
      return { grader: entry.payload.conditions.grader, source: entry.source, keyId: entry.payload.keyId };
    })()`);
    ok(kept.includes('self check') && selfRow.grader === 'self-report',
      `Done records a self check at the self report weight: ${kept} (${JSON.stringify(selfRow)})`);
  } else {
    ok(/agent would grade/.test(selfCheck.skipped),
      `without recordSelfCheck the button says what an agent would do: ${selfCheck.skipped}`);
  }
  console.log('shot ' + await panel.shot('12-panel-next-done'));

  /* 12. a remembered site: the bar says so and the share runs with nothing to approve */
  const disclosuresBefore = await panel.evaluate(`JSON.parse(localStorage.getItem('nema.vault.v1')).disclosures.length`);
  const again = await browser.newPage(SAUCIER + '/');
  const auto = await panel.waitFor(`(() => {
    const doc = JSON.parse(localStorage.getItem('nema.vault.v1'));
    const last = doc.disclosures[doc.disclosures.length - 1];
    return doc.disclosures.length > ${disclosuresBefore} && last.auto === true ? last.audience : ''; })()`,
    { timeoutMs: 30000, label: 'the automatic disclosure' });
  const askedAgain = await panel.evaluate(`document.querySelector('#consent-modal').hidden`);
  const quietBar = await again.evaluate(`(() => { const h = document.getElementById('nema-ext-bar');
    if (!h || !h.shadowRoot) return 'no bar';
    return h.shadowRoot.querySelector('[data-bar]').textContent.replace(/\\s+/g, ' ').trim(); })()`);
  ok(quietBar.includes('Shared with this site') && askedAgain === true && auto === SAUCIER,
    `a remembered site shares on load with nothing to approve: ${quietBar.slice(0, 90)}`);
  console.log('shot ' + await again.shot('13-saucier-remembered'));

  /* 13. the blog: a site with its own vocabulary, and no server behind it.
   * Its manifest declares that sugar-browning is nema:caramelization, so that
   * one arrives confirmed on the site's own word. It says nothing about
   * browning-science, so the panel says that name is still waiting. */
  const blog = await browser.newPage(BLOG + '/');
  const aligns = await panel.waitFor(
    `(() => { const el = document.querySelector('[data-ext-aligns]');
       return el && !el.hidden ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
    { timeoutMs: 30000, label: 'the alignments the blog declares' }
  );
  ok(aligns.includes('This site names things its own way') && aligns.includes('This site calls Caramelization "sugar browning"'),
    `the strip lists the name the blog uses and what it means: ${aligns.slice(0, 140)}`);
  const declared = await panel.evaluate(`(() => {
    const doc = JSON.parse(localStorage.getItem('nema.vault.v1'));
    const rows = (doc.alignments || []).filter((a) => a.origin === ${JSON.stringify(BLOG)});
    const sugar = rows.find((a) => a.providerConcept === 'sugar-browning');
    return JSON.stringify({
      rows: rows.length,
      sugar: sugar ? { concept: sugar.concept, status: sugar.status, by: sugar.proposedBy } : null,
      browning: rows.some((a) => a.providerConcept === 'browning-science')
    });
  })()`);
  const blogAligns = JSON.parse(declared);
  ok(blogAligns.sugar && blogAligns.sugar.concept === 'nema:caramelization'
    && blogAligns.sugar.status === 'confirmed' && blogAligns.sugar.by === 'provider',
    `the declared alignment is confirmed on the provider's word: ${JSON.stringify(blogAligns.sugar)}`);
  const buttons = await panel.evaluate(`document.querySelectorAll('[data-ext-aligns] [data-ext-confirm]').length`);
  ok(buttons === 0 && blogAligns.browning === false,
    `a confirmed alignment needs no decision, and the undeclared name is not invented: ${buttons} buttons`);
  ok(aligns.includes('Nothing has said what "browning science" means'),
    `the name the blog declared nothing about is still waiting: ${aligns.slice(-160)}`);
  /* CONTRACT 26: no token and no id anywhere in the panel a learner reads. */
  const panelText = await panel.evaluate(`(() => {
    const clone = document.body.cloneNode(true);
    for (const open of clone.querySelectorAll('details.n-under')) open.remove();
    return clone.textContent.replace(/\\s+/g, ' ');
  })()`);
  ok(!/nema1\.|rcpt_|lk_|aln_|nema:[a-z]/.test(panelText),
    `the panel shows no token, key or id outside the block under the hood: ${(panelText.match(/nema1\.|rcpt_|lk_|aln_|nema:[a-z-]+/g) || []).slice(0, 5).join(' ')}`);
  console.log('shot ' + await panel.shot('14-panel-alignments'));
  console.log('shot ' + await blog.shot('15-blog'));

  /* console hygiene, all three sides */
  ok(panel.errors.length === 0, `panel console errors: ${JSON.stringify(panel.errors)}`);
  ok(site.errors.length === 0, `page console errors: ${JSON.stringify(site.errors)}`);
  ok(blog.errors.length === 0, `blog console errors: ${JSON.stringify(blog.errors)}`);
} catch (err) {
  failures += 1;
  console.error('FAIL ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}

console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

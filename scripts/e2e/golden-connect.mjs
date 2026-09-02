// Golden path, the connect handshake, on native WebMCP (Chrome for Testing).
//
// Contract section 25: a site opens the vault in a popup, the learner approves
// there, and the vault answers the site with postMessage. No agent, no
// extension, no copied token. This script drives exactly that, twice: once on
// Saucier School (a full course) and once on the blog (the one tag install).
//
// Usage:
//   CHROME=<chrome with WebMCP> node scripts/e2e/golden-connect.mjs \
//     [vaultOrigin] [courseOrigin] [blogOrigin]
//
// Unlike the other golden scripts this one talks to the browser target, not to
// one page: a popup is a second target, and finding it, attaching to it and
// watching it close is the thing under test.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tool } from './cdp.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const [V = 'http://localhost:8781', H = 'http://localhost:8782', B = 'http://localhost:8785'] =
  process.argv.slice(2);
const bin = process.env.CHROME;
if (!bin) {
  console.error('set CHROME to a Chrome binary with native WebMCP');
  process.exit(2);
}

const SHOTS = '/tmp/claude-1000';

/* Workers Assets serves /connect.html at /connect and redirects to it, hash and
 * all, so a target is recognised by the page plus the question in its hash. */
const isConnect = (kind) => (url) => /\/connect(\.html)?#/.test(url) && url.includes(`#${kind}=`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (s) => JSON.parse(s);
const ok = (cond, msg) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) process.exitCode = 1;
};

// ---------------------------------------------------------------------------
// a CDP client that can hold more than one page
// ---------------------------------------------------------------------------

async function launchBrowser() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(
    bin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/claude-1000/nema-connect-${port}`,
      '--window-size=1440,1200',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let version = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await response.json();
      if (version.webSocketDebuggerUrl) break;
    } catch {
      /* the browser is still coming up */
    }
    await sleep(250);
  }
  if (!version || !version.webSocketDebuggerUrl) throw new Error('no browser endpoint');

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errorsBySession = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const settle = pending.get(message.id);
      pending.delete(message.id);
      settle(message);
      return;
    }
    const sink = errorsBySession.get(message.sessionId);
    if (!sink) return;
    if (message.method === 'Runtime.exceptionThrown') {
      sink.push(
        message.params.exceptionDetails?.exception?.description ||
          message.params.exceptionDetails?.text
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      sink.push(message.params.args.map((a) => a.value || a.description).join(' '));
    }
  };

  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, (message) => {
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      ws.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  await new Promise((resolve) => {
    ws.onopen = resolve;
  });
  await send('Target.setDiscoverTargets', { discover: true });

  function wrap(sessionId) {
    const errors = [];
    errorsBySession.set(sessionId, errors);
    return {
      sessionId,
      errors,
      async goto(url, waitMs = 2000) {
        errors.length = 0;
        await send('Page.navigate', { url }, sessionId);
        await sleep(waitMs);
      },
      /* `userGesture` is not decoration here: the handshake calls window.open
       * from a click, and a browser refuses a popup that no gesture asked for.
       * Without it this script would only ever test the blocked path. */
      async evaluate(expression) {
        const result = await send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true, userGesture: true },
          sessionId
        );
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed');
        }
        return result.result?.value;
      },
      async waitFor(expression, maxMs = 8000) {
        const started = Date.now();
        while (Date.now() - started < maxMs) {
          try {
            if (await this.evaluate(expression)) return true;
          } catch {
            /* the page may still be navigating */
          }
          await sleep(200);
        }
        return false;
      },
      async waitForTools(min = 1, maxMs = 15000) {
        return this.waitFor(`document.modelContext.getTools().then(t => t.length >= ${min})`, maxMs);
      },
      /* The vault registers its tools in more than one batch, so a page that
       * only waited for the first one can find the ledger tool missing. */
      async waitForTool(name, maxMs = 15000) {
        return this.waitFor(`document.modelContext.getTools().then(t => t.some(x => x.name === ${JSON.stringify(name)}))`, maxMs);
      },
      async shot(path) {
        const shot = await send(
          'Page.captureScreenshot',
          { format: 'png', captureBeyondViewport: true },
          sessionId
        );
        writeFileSync(path, Buffer.from(shot.data, 'base64'));
      }
    };
  }

  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    return wrap(sessionId);
  }

  async function targets() {
    return (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
  }

  return {
    async firstPage() {
      const list = await targets();
      return attach(list[0].targetId);
    },
    async newPage(url) {
      const { targetId } = await send('Target.createTarget', { url });
      const page = await attach(targetId);
      await sleep(2000);
      return { page, targetId };
    },
    /** The popup the site just opened, found the way a test has to find it. */
    async waitForTarget(match, maxMs = 12000) {
      const started = Date.now();
      while (Date.now() - started < maxMs) {
        const found = (await targets()).find((t) => match(t.url));
        if (found) return found;
        await sleep(200);
      }
      return null;
    },
    async waitForGone(targetId, maxMs = 10000) {
      const started = Date.now();
      while (Date.now() - started < maxMs) {
        if (!(await targets()).some((t) => t.targetId === targetId)) return true;
        await sleep(200);
      }
      return false;
    },
    attach,
    async close() {
      ws.close();
      chrome.kill();
    }
  };
}

// ---------------------------------------------------------------------------
// the two pages under test, read from their own sources
// ---------------------------------------------------------------------------

const content = await import(`${REPO}/apps/harness/public/content.js`);
const DIAGNOSTIC = content.ACTIVITIES['ratios-diagnostic'];

const embed = await import(`${REPO}/shared/provider-embed.js`);
const { readFileSync } = await import('node:fs');
const blogHtml = readFileSync(`${REPO}/apps/blog/public/index.html`, 'utf8');
const blogOpening = blogHtml.indexOf('<script type="application/nema+json">');
const blogStart = blogHtml.indexOf('>', blogOpening) + 1;
const blog = embed.parseManifest(
  blogHtml.slice(blogStart, blogHtml.indexOf('</script>', blogStart)),
  { origin: B }
);
const QUIZ = blog.activities.check;
const ANSWERS = QUIZ.questions.map((question) => [question.id, question.answer]);

const browser = await launchBrowser();

try {
  // -------------------------------------------------------------------------
  // A vault with the demo learner in it, and one name the blog uses aligned by
  // hand. Everything after this is the handshake and nothing else.
  // -------------------------------------------------------------------------
  const vaultSetup = await browser.firstPage();
  await vaultSetup.goto(`${V}/`, 2500);
  await vaultSetup.evaluate('localStorage.clear(); true');
  await vaultSetup.goto(`${V}/`, 2500);
  await vaultSetup.waitForTools();
  await vaultSetup.evaluate(
    `document.querySelector('[data-action="load-demo"]').click(); new Promise(r => setTimeout(r, 3000))`
  );
  const seeded = parse(await vaultSetup.evaluate(tool('get_vault_summary', {})));
  ok(seeded.receipts >= 40, `the vault holds the demo learner: ${seeded.receipts} receipts`);

  /* The blog names its own subject "browning-science". A learner says what that
   * means once, with no agent in the room, and the skip note becomes possible.
   * Contract section 23, which section 25 has to keep working. */
  await vaultSetup.evaluate(`(() => {
    const form = document.querySelector('[data-align-form]');
    form.elements.origin.value = ${JSON.stringify(B)};
    form.elements.providerConcept.value = 'browning-science';
    form.elements.concept.value = 'nema:maillard-reaction';
    form.elements.relation.value = 'equivalent';
    form.requestSubmit();
    return true;
  })()`);
  await sleep(500);
  const aligned = parse(await vaultSetup.evaluate(tool('get_concept_alignments', { origin: B })));
  ok(
    aligned.alignments?.some(
      (entry) => entry.providerConcept === 'browning-science' && entry.status === 'confirmed'
    ),
    'the blog name is aligned before the handshake runs'
  );

  /* The vault tab goes away: from here the only vault window is the one the
   * site opens, which is the whole point of the section. */
  await vaultSetup.goto('about:blank', 500);

  // -------------------------------------------------------------------------
  // Saucier School: connect, learn, keep.
  // -------------------------------------------------------------------------
  const { page: course } = await browser.newPage(`${H}/?vault=${encodeURIComponent(V)}`);
  await course.evaluate('localStorage.clear(); true');
  await course.goto(`${H}/?vault=${encodeURIComponent(V)}`, 2500);
  await course.waitForTools();

  const before = await course.evaluate(`document.querySelector('[data-req-line]').textContent`);
  ok(/Nothing is checked/.test(before), 'the course assumes nothing before the handshake');
  ok(
    (await course.evaluate(`document.querySelector('[data-connect-vault]').textContent`)) ===
      'Connect your vault',
    'the course offers Connect your vault'
  );
  await course.shot(`${SHOTS}/nema-connect-course.png`);

  await course.evaluate(`document.querySelector('[data-connect-vault]').click(); true`);
  const popup = await browser.waitForTarget(isConnect('request'));
  ok(Boolean(popup), 'clicking the button opens a vault window: ' + (popup ? popup.url.slice(0, 60) : 'none'));
  const vaultPopup = await browser.attach(popup.targetId);
  ok(
    await vaultPopup.waitFor(`!document.getElementById('consent-modal').hidden`),
    'the vault window asks the learner, in the vault own origin'
  );
  const asked = await vaultPopup.evaluate(
    `document.querySelector('[data-consent-shared]').textContent.replace(/\\s+/g, ' ').trim()`
  );
  ok(
    asked.includes('Knife skills') && asked.includes('Cooking ratios') && !asked.includes('receipt'),
    'it names the exact lines in words and no evidence: ' + asked.slice(0, 90)
  );
  /* Contract section 26: the ids it asked with and the pseudonym it is
     answered under are behind the one closed block, and nowhere else. */
  const askedUnder = await vaultPopup.evaluate(
    `document.querySelector('[data-consent-under]').textContent.replace(/\\s+/g, ' ').trim()`
  );
  ok(
    !/nema:|lk_/.test(asked) && /nema:knife-skills\.apply/.test(askedUnder) && /lk_/.test(askedUnder),
    'and the ids and the learner id are under the hood: ' + askedUnder.slice(0, 80)
  );
  await vaultPopup.shot(`${SHOTS}/nema-connect-popup.png`);

  await vaultPopup.evaluate(`document.querySelector('[data-consent-approve]').click(); true`);
  ok(await browser.waitForGone(popup.targetId), 'the vault window answers and closes itself');

  await sleep(600);
  const reqLine = await course.evaluate(
    `document.querySelector('[data-req-line]').textContent.replace(/\\s+/g, ' ')`
  );
  ok(/68 minutes became 27/.test(reqLine), 'the course personalised itself from the answer: ' + reqLine);
  const connectStatus = await course.evaluate(
    `document.querySelector('[data-connect-status]').textContent`
  );
  ok(/27 minutes left of 68/.test(connectStatus), 'and says so in one line: ' + connectStatus);
  ok(
    (await course.evaluate(`document.querySelector('[data-connect-vault]').textContent`)) ===
      'Ask your vault again',
    'the button becomes the second ask'
  );

  /* The work nobody can do for the learner. */
  await course.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.lab-path__row')];
    const row = rows.find(r => (r.getAttribute('aria-label') || '').startsWith(${JSON.stringify(DIAGNOSTIC.title)}));
    row.click();
    return true;
  })()`);
  await sleep(600);
  await course.evaluate(`(() => {
    const input = [...document.querySelectorAll('input[name="diagnostic-option"]')]
      .find(i => i.value === ${JSON.stringify(DIAGNOSTIC.content.answerKey)});
    input.click();
    const submit = [...document.querySelectorAll('.stage__actions button')]
      .find(b => b.textContent.includes('Submit answer'));
    submit.click();
    return true;
  })()`);
  ok(
    await course.waitFor(
      `[...document.querySelectorAll('.stage__actions button')].some(b => b.textContent.includes('Issue evidence receipt'))`
    ),
    'the diagnostic passed and the kitchen offers to sign'
  );
  await course.evaluate(`(() => {
    [...document.querySelectorAll('.stage__actions button')]
      .find(b => b.textContent.includes('Issue evidence receipt')).click();
    return true;
  })()`);
  ok(
    await course.waitFor(`Boolean(document.querySelector('[data-keep-vault]'))`),
    'the receipt panel leads with Keep in my vault'
  );
  const handKept = await course.evaluate(
    `document.querySelector('.lab-byhand__summary')?.textContent || ''`
  );
  ok(handKept === 'Under the hood', 'and the token, the signed fields and the old link fold away under it');
  const receiptText = await course.evaluate(
    `document.querySelector('[data-receipt]').firstElementChild.querySelector('.stack').textContent.replace(/\\s+/g, ' ')`
  );
  ok(
    /signed what you did\. Verified\./.test(receiptText) && !/nema1\.|rcpt_|lk_|nema:/.test(receiptText),
    'the receipt speaks in outcomes: ' + receiptText.slice(0, 90)
  );

  await course.evaluate(`document.querySelector('[data-keep-vault]').click(); true`);
  const keepPopup = await browser.waitForTarget(isConnect('receipt'));
  ok(Boolean(keepPopup), 'Keep in my vault opens the vault with the receipt');
  ok(await browser.waitForGone(keepPopup.targetId), 'the vault stages it and closes itself');
  await sleep(400);
  const keptLine = await course.evaluate(
    `document.querySelector('[data-keep-status]').textContent`
  );
  await course.shot(`${SHOTS}/nema-connect-receipt.png`);
  ok(keptLine === 'Kept: ratios, now usable.', 'the course shows the vault own words: ' + keptLine);
  ok(course.errors.length === 0, 'saucier console errors: ' + JSON.stringify(course.errors));

  /* And the receipt really is in the vault, read from a window neither the
   * course nor the popup ever touched. */
  const { page: ledger } = await browser.newPage(`${V}/`);
  await ledger.waitForTool('get_evidence_ledger');
  const evidence = parse(await ledger.evaluate(tool('get_evidence_ledger', { limit: 3 })));
  const fromCourse = (evidence.receipts || []).find((row) => row.activity === DIAGNOSTIC.title);
  ok(
    Boolean(fromCourse) &&
      fromCourse.signature === 'verified' &&
      fromCourse.claims.some((claim) => claim.concept === 'nema:ratios' && claim.ability === 'apply'),
    'the ledger holds the receipt the popup staged: ' + JSON.stringify(fromCourse?.activity)
  );
  const onScreen = await ledger.evaluate(
    `document.querySelector('[data-evidence-ledger]').textContent.includes(${JSON.stringify(DIAGNOSTIC.title)})`
  );
  ok(onScreen === true, 'and the evidence ledger on screen shows it');
  await ledger.goto('about:blank', 400);

  // -------------------------------------------------------------------------
  // The blog: the same two buttons, from a one tag install on another origin.
  // -------------------------------------------------------------------------
  const { page: post } = await browser.newPage(`${B}/`);
  /* localStorage is only reachable once the blog document itself is up. */
  await post.waitFor(`location.origin === ${JSON.stringify(new URL(B).origin)} && document.readyState === 'complete'`, 15000);
  await post.evaluate('localStorage.clear(); true');
  await post.goto(`${B}/`, 3000);
  await post.waitForTools();
  ok(
    (await post.evaluate(`document.querySelector('[data-nema-connect-vault]').textContent`)) ===
      'Connect your vault',
    'the embed renders Connect your vault with no install of its own'
  );
  await post.shot(`${SHOTS}/nema-connect-blog.png`);

  await post.evaluate(`document.querySelector('[data-nema-connect-vault]').click(); true`);
  const blogPopup = await browser.waitForTarget(isConnect('request'));
  ok(Boolean(blogPopup), 'the blog opens the same vault window');
  const blogVault = await browser.attach(blogPopup.targetId);
  ok(
    await blogVault.waitFor(`!document.getElementById('consent-modal').hidden`),
    'and gets the same question'
  );
  const blogAsked = await blogVault.evaluate(
    `document.querySelector('[data-consent-shared]').textContent.replace(/\\s+/g, ' ').trim()`
  );
  ok(
    blogAsked.includes('"browning science"') && blogAsked.includes('Maillard reaction'),
    'the site own name is answered under the name it asked with: ' + blogAsked.slice(0, 110)
  );
  await blogVault.evaluate(`document.querySelector('[data-consent-approve]').click(); true`);
  ok(await browser.waitForGone(blogPopup.targetId), 'the vault window closes itself');

  await sleep(600);
  const skipNote = await post.evaluate(
    `document.querySelector('[data-nema-path]')?.textContent.replace(/\\s+/g, ' ') || ''`
  );
  ok(/You can skip/.test(skipNote), 'the article shortened itself: ' + skipNote.slice(0, 110));

  await post.evaluate(`(() => {
    const form = document.querySelector('[data-nema-quiz="check"]');
    for (const [q, a] of ${JSON.stringify(ANSWERS)}) {
      form.querySelector('[data-nema-option="' + q + ':' + a + '"]').click();
    }
    form.querySelector('[data-nema-submit]').click();
    return true;
  })()`);
  ok(
    await post.waitFor(`Boolean(document.querySelector('[data-nema-keep]'))`),
    'answering the two questions signs a receipt with Keep in my vault on it'
  );

  await post.evaluate(`document.querySelector('[data-nema-keep]').click(); true`);
  const blogKeep = await browser.waitForTarget(isConnect('receipt'));
  ok(Boolean(blogKeep), 'Keep in my vault opens the vault from the blog too');
  ok(await browser.waitForGone(blogKeep.targetId), 'the vault stages it and closes itself');
  await sleep(400);
  const blogKept = await post.evaluate(
    `document.querySelector('[data-nema-keep-status]')?.textContent || ''`
  );
  ok(/^Kept/.test(blogKept), 'the article shows the vault own words: ' + blogKept);
  ok(post.errors.length === 0, 'blog console errors: ' + JSON.stringify(post.errors));

  const { page: ledger2 } = await browser.newPage(`${V}/`);
  await ledger2.waitForTool('get_evidence_ledger');
  const evidence2 = parse(await ledger2.evaluate(tool('get_evidence_ledger', { limit: 4 })));
  const fromBlog = (evidence2.receipts || []).find((row) => row.issuerName && row.issuerName.includes(new URL(B).host));
  ok(
    Boolean(fromBlog),
    'the blog receipt is in the ledger: ' + JSON.stringify(evidence2.receipts?.map((r) => r.issuerName))
  );
  ok(
    fromBlog?.trust === 'self',
    'kept at the tier it earned, whoever carried it: ' + JSON.stringify(fromBlog?.trust)
  );
  await ledger2.shot(`${SHOTS}/nema-connect-ledger.png`);

  // -------------------------------------------------------------------------
  // The two refusals that make the handshake safe.
  // -------------------------------------------------------------------------
  const forged = `${V}/connect.html#request=${Buffer.from(
    JSON.stringify({ protocol: 'nema/0.1', audience: H, purpose: 'steal', requirements: [{ concept: 'nema:ratios', ability: 'apply' }] })
  ).toString('base64url')}&return=${encodeURIComponent(B)}`;
  const { page: thief } = await browser.newPage(forged);
  /* Production redirects /connect.html to /connect first, so the title is read
   * once the page has moved past its initial heading. */
  await thief.waitFor(`document.querySelector('[data-connect-title]')?.textContent !== 'Connect your vault'`, 10000);
  const refusal = await thief.evaluate(
    `document.querySelector('[data-connect-title]').textContent`
  );
  ok(
    refusal === 'This request is not addressed to the site that opened it',
    'a request for one origin opened by another is refused: ' + refusal
  );
  ok(
    (await thief.evaluate(`document.getElementById('consent-modal').hidden`)) === true,
    'and the learner is never asked'
  );
  await thief.goto('about:blank', 300);

  const { page: stray } = await browser.newPage(`${V}/connect.html#request=not-a-request&return=${encodeURIComponent(H)}`);
  await sleep(1000);
  ok(
    /could not be read/.test(await stray.evaluate(`document.querySelector('[data-connect-title]').textContent`)),
    'an unreadable request is named, not guessed at'
  );
} finally {
  await browser.close();
}

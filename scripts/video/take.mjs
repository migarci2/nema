// The nema demo video, shot by shot, recorded from a headless Chrome with
// native WebMCP. One browser for the whole session so the coach keeps its
// transcript and token handles between shots. Shots that need the coach's
// model run only with WITH_LLM=1; the others record on their own.
//
//   CHROME=<chrome with WebMCP> WITH_LLM=1 node scripts/video/take.mjs [outDir]
//
// Output: <outDir>/<shot>.mp4 per shot, in script order, plus list.txt for
// ffmpeg concat. Captions are burned in by the page overlay; voiceover is
// added afterwards.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { openRecorder } from './recorder.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const chrome = process.env.CHROME;
if (!chrome) { console.error('set CHROME'); process.exit(2); }
const WITH_LLM = process.env.WITH_LLM === '1';
const out = process.argv[2] || '/tmp/nema-video';
const V = process.env.VAULT || 'https://nema-vault.migarci2.dev';
const C = process.env.COACH || 'https://nema-coach.migarci2.dev';
const S1 = process.env.SAUCIER || 'https://saucier.migarci2.dev';
const S2 = process.env.LINECOOK || 'https://linecook.migarci2.dev';
const HUB = process.env.HUB || 'https://nema.migarci2.dev';
const content = await import(REPO + '/apps/harness/public/content.js');
const ANSWER = content.ACTIVITIES['ratios-diagnostic'].content.answerKey;

const r = await openRecorder({ chrome, out, profile: path.join(out, 'profile') });
const wait = r.sleep;
const done = [];
const shot = async (name, fn) => { console.log('shot', name); const mp4 = await r.take(name, fn); if (mp4) done.push(mp4); };

/* Helpers for the coach page. */
const clickText = (text, ctx) => r.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`, ctx);
async function site(label) {
  await clickText(label);
  for (let i = 0; i < 12; i++) { await wait(1000); const pill = await r.eval(`document.body.innerText.match(/\\d+ TOOLS FROM [^\\n]*/i)?.[0] || ''`); if (/^[1-9]/.test(pill)) return pill; }
  return '';
}
async function ask(text, maxSeconds = 120) {
  await r.eval(`(() => { const i = document.getElementById('chat-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await wait(600);
  await r.eval(`document.querySelector('[data-chat-form]').requestSubmit(); true`);
  for (let i = 0; i < maxSeconds; i++) { await wait(1000); const st = await r.eval(`document.querySelector('[data-run-status]').textContent`); if (/^Ready/.test(st)) break; }
}
const frameOf = (re) => r.frameContext(re);
async function waitFrame(re, expression, maxSeconds = 60) {
  for (let i = 0; i < maxSeconds; i++) { try { const ctx = await frameOf(re); if (await r.eval(expression, ctx)) return ctx; } catch {} await wait(1000); }
  throw new Error('timeout waiting in frame ' + re);
}

/* 0:00 cold open on the vault */
await r.goto(V + '/');
await r.eval(`localStorage.clear(); true`);
await r.goto(V + '/');
await shot('00-vault', async () => {
  await wait(800);
  await r.cursorTo('[data-action="load-demo"]', null, { click: true });
  await wait(2200);
  await r.caption('Your learning state belongs to you, not to the websites you visit.');
  await r.eval(`(() => { const g = [...document.querySelectorAll('.n-graph__group')].find(x => /^Emulsions/.test(x.querySelector('title')?.textContent || '')); if (!g) return false; g.scrollIntoView({ block: 'center' }); const b = g.getBoundingClientRect(); const k = document.getElementById('nema-cur'); k.style.left = (b.left + b.width / 2) + 'px'; k.style.top = (b.top + b.height / 2) + 'px'; g.dispatchEvent(new Event('mouseenter')); g.focus(); return true; })()`);
  await wait(5000);
  await r.caption('');
  await wait(500);
});

/* 0:14 the problem: the vault already knows, the site does not */
await shot('01-problem-vault', async () => {
  await r.caption('Every site teaches you from zero.');
  await r.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Show all/.test(x.textContent.trim())); if (b) b.click(); return true; })()`);
  await wait(600);
  await r.eval(`(() => { const row = [...document.querySelectorAll('li, tr, div')].find(x => /^Knife skills/.test(x.textContent.trim())); if (row) row.scrollIntoView({ block: 'center' }); return true; })()`);
  await wait(4500);
  await r.caption('');
});
await r.goto(S1 + '/');
await r.eval(`localStorage.clear(); true`);
await r.goto(S1 + '/');
await shot('01-problem-site', async () => {
  await r.caption('Seven activities, 68 minutes, nothing assumed about you.');
  await wait(5500);
  await r.caption('');
});

if (WITH_LLM) {
  /* 0:26 the offer */
  await r.goto(C + '/', 4000);
  await r.eval(`sessionStorage.clear(); true`);
  await r.goto(C + '/', 4000);
  await shot('02-offer', async () => {
    await site('Saucier School');
    await r.caption('describe_learning_offer');
    await ask('I want to learn to cook a pan sauce I can hold through service. What does this site offer, and what does it need to know about me before it plans anything?');
    await wait(3000);
    await r.caption('');
  });

  /* 0:44 the consent modal */
  await shot('03-consent', async () => {
    await site('Vault');
    await r.caption('The human decides. Every time.');
    const asking = ask('Create the readiness assertion Saucier School needs for its three requirements. Its origin is ' + S1 + ' and the purpose is personalize-pan-sauces-path.');
    const ctx = await waitFrame(/vault/, `!document.getElementById('consent-modal').hidden`);
    await wait(4000);
    await r.eval(`(() => { const c = document.querySelector('#consent-modal input[type="checkbox"]'); if (c && !c.checked) c.click(); return true; })()`, ctx);
    await r.cursorTo('[data-consent-approve]', ctx, { click: true });
    await asking;
    await wait(1500);
    await r.caption('');
  });

  /* 1:04 sixty eight becomes twenty seven */
  await shot('04-personalise', async () => {
    await site('Saucier School');
    await r.caption('68 minutes to 27. personalize_learning_path');
    await ask('Now personalise my learning path on this site with the assertion you hold.');
    await wait(4000);
    await r.caption('');
  });
}

/* 1:24 the human does the work, inside the Saucier School page */
if (!WITH_LLM) { await r.goto(S1 + '/'); }
await shot('05-diagnostic', async () => {
  const inFrame = WITH_LLM;
  const ctx = inFrame ? await frameOf(/saucier/) : null;
  await r.caption('No tool submits an answer.');
  await r.eval(`(() => { const row = [...document.querySelectorAll('.n-path__row')].find(x => /vinaigrette/i.test(x.textContent)); if (!row) return false; row.scrollIntoView({ block: 'center' }); row.click(); return true; })()`, ctx);
  await wait(2200);
  await r.cursorTo(`[data-option="${ANSWER}"]`, ctx, { click: false });
  await r.eval(`(() => { const i = document.querySelector('[data-option="${ANSWER}"] input'); i.click(); return true; })()`, ctx);
  await wait(1500);
  await r.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Submit answer'); b.scrollIntoView({ block: 'center' }); const k = document.getElementById('nema-cur'); const r = b.getBoundingClientRect(); k.style.left = (r.left + 12) + 'px'; k.style.top = (r.top + 12) + 'px'; return true; })()`, ctx);
  await wait(700);
  await r.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Submit answer'); b.click(); return true; })()`, ctx);
  await wait(2500);
  await r.caption('issue_evidence_receipt');
  await r.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Issue evidence receipt'); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`, ctx);
  await wait(4000);
  await r.eval(`(() => { const t = document.querySelector('.n-token, textarea'); if (t) t.scrollIntoView({ block: 'center' }); return true; })()`, ctx);
  await wait(3000);
  await r.caption('');
});

if (WITH_LLM) {
  /* 1:46 the receipt comes home */
  await shot('06-receipt-home', async () => {
    await r.caption('Signature verified. uncertain to usable.');
    await ask('Fetch my signed receipt for the ratios diagnostic from this site.');
    await site('Vault');
    await ask('Stage the receipt you hold in my vault and tell me which bands moved.');
    await wait(2500);
    await site('Saucier School');
    await ask('Get a fresh assertion is not possible here, so just personalise my path again with a new token if you have one, otherwise tell me what to do.', 60);
    await wait(2000);
    await r.caption('');
  });

  /* 2:04 a second site asks the same vault */
  await shot('07-second-site', async () => {
    await site('Vault');
    await r.caption('Different site. Different learner id.');
    const asking = ask('Create a readiness assertion for Line Cook Lab at ' + S2 + ', purpose unlock-service-labs, for its three requirements: mise-en-place explain, emulsions explain, food-safety apply.');
    const ctx = await waitFrame(/vault/, `!document.getElementById('consent-modal').hidden`);
    await wait(3000);
    await r.eval(`(() => { const c = document.querySelector('#consent-modal input[type="checkbox"]'); if (c && !c.checked) c.click(); return true; })()`, ctx);
    await r.cursorTo('[data-consent-approve]', ctx, { click: true });
    await asking;
    await site('Line Cook Lab');
    await r.caption('check_prerequisites');
    await ask('Check my prerequisites on this site with the assertion you hold.');
    await wait(4000);
    await r.caption('');
  });

  /* 2:26 the agent closes the gap */
  await shot('08-coach', async () => {
    await site('Vault');
    await r.caption('agent assessed, weight 0.6');
    await ask('Build my best 5 minute review, starting with emulsions, which Line Cook Lab needs. Ask me the first question.');
    await ask('An emulsion is fat dispersed as tiny droplets in water. It holds because an emulsifier, mustard or the proteins in butter, coats the droplets. Heat it too far and the droplets merge, so the sauce splits; mount the butter off the heat and never let it boil.');
    await wait(2000);
    await ask('Create a fresh readiness assertion for Line Cook Lab at ' + S2 + ', purpose unlock-service-labs, same three requirements.');
    await site('Line Cook Lab');
    await r.caption('Locked to available.');
    await ask('Check my prerequisites again with the new assertion.');
    await wait(4000);
    await r.caption('');
  });
}

/* 2:42 the close */
await r.goto(HUB + '/');
await shot('09-close', async () => {
  await r.eval(`window.scrollTo(0, 0); true`);
  await wait(1500);
  for (const line of ['2 independent websites', '1 learner-owned vault', '0 shared accounts', 'nema.migarci2.dev']) { await r.caption(line); await wait(2400); }
  await r.caption('');
  await wait(600);
});

await r.close();
fs.writeFileSync(path.join(out, 'list.txt'), done.map((f) => `file '${f}'`).join('\n') + '\n');
console.log('takes:', done.length, '\n' + done.join('\n'));
console.log(`join with: ffmpeg -y -f concat -safe 0 -i ${out}/list.txt -c copy ${out}/nema-video.mp4`);

// The demo's golden path driven through the coach (the model decides the tool calls).
// Usage: CHROME=<chrome with WebMCP> node scripts/e2e/coach-golden.mjs [coachOrigin] [vaultOrigin] [harnessOrigin]
import { launch } from './cdp.mjs';
const [C = 'http://localhost:8784', V = 'http://localhost:8781', H = 'http://localhost:8782'] = process.argv.slice(2);
const bin = process.env.CHROME;
if (!bin) { console.error('set CHROME'); process.exit(2); }
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await launch(bin);
const transcript = () => page.evaluate(`document.querySelector('[data-transcript]').innerText`);
async function ask(text, expectTool, maxSeconds = 90) {
  const before = await transcript();
  await page.evaluate(`(() => { const i = document.getElementById('chat-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-chat-form]').requestSubmit(); return true; })()`);
  let t = '';
  for (let i = 0; i < maxSeconds / 2; i++) {
    await sleep(2000);
    t = await transcript();
    const status = await page.evaluate(`document.querySelector('[data-run-status]').textContent`);
    if (/^Ready/.test(status)) break;
  }
  const delta = t.slice(before.length);
  ok(new RegExp(expectTool).test(delta), `asked "${text.slice(0, 50)}": called ${expectTool}`);
  return delta;
}
async function site(label) {
  await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); b.click(); return true; })()`);
  for (let i = 0; i < 10; i++) { await sleep(1000); const pill = await page.evaluate(`document.body.innerText.match(/\\d+ TOOLS FROM [^\\n]*/i)?.[0] || ''`); if (/TOOLS FROM/i.test(pill) && !/^0 /.test(pill)) return pill; }
  return '';
}
try {
  // Prepare the vault in this browser profile: demo learner loaded, harness pre-approved for one hour.
  await page.goto(V + '/', 2500);
  await page.evaluate(`localStorage.clear(); true`);
  await page.goto(V + '/', 2500);
  await page.evaluate(`document.querySelector('[data-action="load-demo"]').click(); new Promise(r => setTimeout(r, 3000))`);
  await page.evaluate(`(() => { const d = JSON.parse(localStorage.getItem('nema.vault.v1')); d.settings = d.settings || {}; d.settings.autoApprove = d.settings.autoApprove || {}; d.settings.autoApprove[${JSON.stringify(H)}] = new Date(Date.now() + 3600e3).toISOString(); localStorage.setItem('nema.vault.v1', JSON.stringify(d)); return Object.keys(d.settings.autoApprove); })()`);

  await page.goto(C + '/', 4000);
  await page.evaluate(`sessionStorage.clear(); true`);
  await page.goto(C + '/', 4000);
  ok(/9 tools/i.test(await site('Saucier School')) === false, 'switched to Saucier School');
  const d1 = await ask('I want to learn to cook a pan sauce I can hold through service. What does this site offer and what does it need to know about me?', 'describe_learning_offer');
  console.log(d1.slice(-600));
  await site('Vault');
  const d2 = await ask('Create the readiness assertion the Saucier School needs for its three requirements. Its origin is ' + H + ' and the purpose is personalize-pan-sauces-path.', 'create_readiness_assertion');
  ok(/@t1|approved/i.test(d2), 'assertion produced and stored as a handle');
  const clip = await page.evaluate(`document.body.innerText.match(/TOKEN CLIPBOARD[\\s\\S]{0,400}/)?.[0] || ''`);
  ok(/@t1|t1/.test(clip) && /assertion/i.test(clip), 'token clipboard shows the assertion handle');
  await site('Saucier School');
  const d3 = await ask('Now personalise my learning path on this site with the assertion you hold.', 'personalize_learning_path');
  ok(/27/.test(d3), 'personalised path reports 27 minutes');
  await page.shot('/tmp/nema-e2e-coach-golden.png');
  ok(page.errors.length === 0, 'coach console errors: ' + JSON.stringify(page.errors));
} finally { await page.close(); }

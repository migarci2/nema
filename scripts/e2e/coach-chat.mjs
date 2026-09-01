// Coach smoke test on native WebMCP: send one prompt, expect a tool call through the iframe.
// Usage: CHROME=<chrome with WebMCP> node scripts/e2e/coach-chat.mjs [coachOrigin]
import { launch } from './cdp.mjs';
const [C = 'http://localhost:8784'] = process.argv.slice(2);
const bin = process.env.CHROME;
if (!bin) { console.error('set CHROME'); process.exit(2); }
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await launch(bin);
try {
  await page.goto(C + '/', 4000);
  const pill = await page.evaluate(`document.body.innerText.match(/\\d+ TOOLS FROM [^\\n]*/i)?.[0] || ''`);
  ok(/9 tools/i.test(pill), 'coach discovered vault tools: ' + pill);
  await page.evaluate(`(() => { const i = document.getElementById('chat-input'); i.value = 'How many concepts does my vault track right now? Use the vault tool and answer in one sentence.'; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-chat-form]').requestSubmit(); return true; })()`);
  let text = '';
  for (let i = 0; i < 30; i++) { await sleep(2000); text = await page.evaluate(`document.querySelector('[data-transcript]').innerText`); if (/get_vault_summary/.test(text) && !/thinking|working|running/i.test(text.slice(-200))) break; }
  ok(/get_vault_summary/.test(text), 'agent called get_vault_summary');
  ok(/concept/i.test(text), 'agent answered about concepts');
  console.log('--- chat excerpt ---\n' + text.slice(-900));
  await page.shot('/tmp/nema-e2e-coach.png');
  ok(page.errors.length === 0, 'coach console errors: ' + JSON.stringify(page.errors));
} finally { await page.close(); }

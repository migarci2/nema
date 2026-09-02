import { spawn } from 'node:child_process';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function launch(bin, extra = []) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-1000/cft-profile-${port}`, '--window-size=1440,1200', ...extra, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const list = await r.json(); target = list.find(t => t.type === 'page'); if (target) break; } catch {} await sleep(250); }
  if (!target) throw new Error('no target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' ')); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.onopen = r);
  await send('Page.enable'); await send('Runtime.enable');
  return {
    errors,
    async goto(url, waitMs = 2000) { errors.length = 0; await send('Page.navigate', { url }); await sleep(waitMs); },
    async evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed'); return r.result?.result?.value; },
    async waitForTools(min = 1, maxMs = 15000) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { try { const n = await this.evaluate('document.modelContext.getTools().then(t => t.length)'); if (n >= min) return n; } catch {} await sleep(500); } return 0; },
    async shot(path) { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); (await import('node:fs')).writeFileSync(path, Buffer.from(s.result.data, 'base64')); },
    async close() { ws.close(); chrome.kill(); },
  };
}
export const tool = (name, args) => `document.modelContext.getTools().then(async ts => { const t = ts.find(x => x.name === ${JSON.stringify(name)}); if (!t) throw new Error('tool missing: ' + ${JSON.stringify(name)}); const r = await document.modelContext.executeTool(t, ${JSON.stringify(JSON.stringify(args))}); return typeof r === 'string' ? r : JSON.stringify(r); })`;

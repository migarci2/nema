// The four browser globals the vault touches, provided for Node.
// localStorage: one JSON file. document: event sink. fetch: repo files for
// absolute paths. CustomEvent: present on Node 19+, polyfilled otherwise.
import fs from 'node:fs';
import path from 'node:path';

export function installGlobals({ file, repo }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const store = new Map();
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') store.set('nema.vault.v1', JSON.stringify(parsed));
    } catch {
      /* an unreadable file starts an empty vault; the file is rewritten on save */
    }
  }
  const flush = () => {
    const raw = store.get('nema.vault.v1');
    if (raw === undefined) return;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(JSON.parse(raw), null, 2) + '\n');
    fs.renameSync(tmp, file);
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); if (k === 'nema.vault.v1') flush(); },
    removeItem: (k) => { store.delete(k); if (k === 'nema.vault.v1' && fs.existsSync(file)) fs.unlinkSync(file); },
    clear: () => { store.clear(); if (fs.existsSync(file)) fs.unlinkSync(file); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };

  const listeners = new Map();
  globalThis.document = {
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn)); }
  };

  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init) { super(type, init); this.detail = init && 'detail' in init ? init.detail : null; }
    };
  }

  const realFetch = globalThis.fetch;
  const LOCAL = { '/seed.json': '/apps/vault/public/seed.json' };
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input && input.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      const rel = url.startsWith('/shared/') ? url : LOCAL[url];
      if (!rel) return Promise.resolve(new Response('not found', { status: 404 }));
      const abs = path.join(repo, rel);
      if (!fs.existsSync(abs)) return Promise.resolve(new Response('not found', { status: 404 }));
      return Promise.resolve(new Response(fs.readFileSync(abs), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(input, init);
  };
}

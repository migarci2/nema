/* nema coach: the agent runtime.
 *
 * No DOM in this file. It owns four things:
 *
 *   1. Tool discovery over WebMCP for one origin at a time
 *      (document.modelContext.getTools({ fromOrigins: [origin] })).
 *   2. The token clipboard: every nema1. token a tool returns is stored under a
 *      short handle (@t1, @t2) and replaced in the copy the model sees, so a
 *      model never has to reproduce a thousand characters of base64url.
 *   3. Tool execution through document.modelContext.executeTool, with handle
 *      expansion on the way in and handle collapse on the way out.
 *   4. The turn loop: post the conversation to /api/chat, run the tool calls it
 *      asks for, repeat, up to MAX_TOOL_ROUNDS rounds.
 *
 * app.js supplies the callbacks that touch the page.
 */

import { decodeToken, isToken } from '/shared/protocol.js';

/** Contract section 11: at most twelve tool rounds per user turn. */
export const MAX_TOOL_ROUNDS = 12;

/** How long one tool may take before the coach gives up on it. */
const DEFAULT_TOOL_TIMEOUT_MS = 60000;
const TOOL_TIMEOUT_MS = {
  /* The vault waits up to 120 s for the learner to answer the consent modal. */
  create_readiness_assertion: 150000
};

/** Tool results are trimmed before they reach the model. */
const MAX_RESULT_CHARS = 6000;

/* ---------------------------------------------------------- discovery -- */

/**
 * The tools one origin exposes to this page right now.
 * @param {string} origin
 * @returns {Promise<Array>} live tool descriptors, safe to hand to executeTool
 */
export async function discoverTools(origin) {
  const context = document.modelContext;
  if (!context || typeof context.getTools !== 'function') return [];
  let tools;
  try {
    tools = await context.getTools({ fromOrigins: [origin] });
  } catch {
    return [];
  }
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => tool && typeof tool.name === 'string' && tool.origin === origin);
}

/** The schema-only view of a tool, which is what the worker forwards to a model. */
export function toolSchema(tool) {
  return {
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {}, required: [] }
  };
}

/* --------------------------------------------------- token clipboard -- */

function tokenFacts(token) {
  const facts = { type: 'token', issuer: '', audience: '', expiresAt: '', issuedAt: '' };
  try {
    const { payload } = decodeToken(token);
    if (payload.type === 'readiness-assertion') {
      facts.type = 'assertion';
      facts.audience = payload.audience || '';
      facts.expiresAt = payload.expiresAt || '';
      facts.issuedAt = payload.issuedAt || '';
    } else if (payload.type === 'evidence-receipt') {
      facts.type = 'receipt';
      facts.issuer = payload.issuer || '';
      facts.issuedAt = payload.issuedAt || '';
      facts.activity = (payload.activity && payload.activity.title) || '';
    }
  } catch {
    /* An unreadable token still gets a handle. The panel labels it "token". */
  }
  return facts;
}

/**
 * The session's token store. Handles survive an iframe navigation because they
 * live in sessionStorage, which is what makes the broker robust.
 *
 * @param {{ storageKey: string, onChange?: Function }} options
 */
export function createTokenClipboard({ storageKey, onChange = () => {} }) {
  /** @type {Array<{handle:string, token:string, type:string, issuer:string, audience:string, expiresAt:string, issuedAt:string, source:string, at:number}>} */
  let entries = [];

  function load() {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) entries = parsed.filter((e) => e && typeof e.token === 'string');
    } catch {
      entries = [];
    }
  }

  function save() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      /* A full or blocked storage never breaks the session, it only forgets it. */
    }
  }

  function add(token, source) {
    const existing = entries.find((entry) => entry.token === token);
    if (existing) return existing.handle;
    const handle = `@t${entries.length + 1}`;
    entries.push({ handle, token, source: source || '', at: Date.now(), ...tokenFacts(token) });
    save();
    onChange(list());
    return handle;
  }

  function list() {
    return entries.map((entry) => ({ ...entry }));
  }

  function byHandle(handle) {
    return entries.find((entry) => entry.handle === handle) || null;
  }

  /** Replace every nema1. token inside a tool result with its handle. */
  function collapse(value, source) {
    if (typeof value === 'string') return isToken(value) ? add(value, source) : value;
    if (Array.isArray(value)) return value.map((item) => collapse(item, source));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = collapse(item, source);
      return out;
    }
    return value;
  }

  /** Put the real tokens back into the arguments the model produced. */
  function expand(value) {
    if (typeof value === 'string') {
      const exact = byHandle(value.trim());
      if (exact) return exact.token;
      return value.replace(/@t(\d+)\b/g, (match) => {
        const entry = byHandle(match);
        return entry ? entry.token : match;
      });
    }
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = expand(item);
      return out;
    }
    return value;
  }

  function clear() {
    entries = [];
    save();
    onChange(list());
  }

  load();
  return { add, list, byHandle, collapse, expand, clear, reload: () => { load(); onChange(list()); } };
}

/* ---------------------------------------------------------- execution -- */

function timeoutFor(name) {
  return TOOL_TIMEOUT_MS[name] || DEFAULT_TOOL_TIMEOUT_MS;
}

/**
 * Run one tool and always resolve to a plain object with a status.
 * @param {object} tool live descriptor from discoverTools
 * @param {object} args already expanded arguments
 */
export async function executeTool(tool, args) {
  const context = document.modelContext;
  const started = performance.now();
  let result;
  try {
    result = await Promise.race([
      context.executeTool(tool, args),
      new Promise((resolve) => {
        setTimeout(
          () => resolve({ status: 'timeout', error: `${tool.name} did not answer in time` }),
          timeoutFor(tool.name)
        );
      })
    ]);
  } catch (err) {
    result = { status: 'error', error: err && err.message ? err.message : String(err) };
  }
  /* Contract section 16: native executeTool returns the result serialized as a
   * JSON string, the polyfill returns the object. Accept both. */
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      result = { status: 'ok', text: result };
    }
  }
  if (result == null) result = { status: 'ok', value: null };
  if (typeof result !== 'object') result = { status: 'ok', value: result };
  if (typeof result.status !== 'string') {
    result = { status: typeof result.error === 'string' ? 'error' : 'ok', ...result };
  }
  return { result, ms: Math.round(performance.now() - started) };
}

/** A one line, readable form of the arguments for the tool activity card. */
export function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const parts = [];
  for (const [key, value] of Object.entries(args)) {
    let shown;
    if (typeof value === 'string') shown = value.length > 42 ? `${value.slice(0, 42)}...` : value;
    else if (Array.isArray(value)) shown = `${value.length} item${value.length === 1 ? '' : 's'}`;
    else if (value && typeof value === 'object') shown = '{...}';
    else shown = String(value);
    parts.push(`${key}: ${shown}`);
  }
  const line = parts.join(', ');
  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

/** The model facing string for a tool result. Long results are trimmed. */
export function resultToContent(result) {
  let text;
  try {
    text = JSON.stringify(result);
  } catch {
    text = String(result);
  }
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)} ... [result trimmed by the coach at ${MAX_RESULT_CHARS} characters]`;
}

/* ------------------------------------------------------------- the loop -- */

/**
 * The coach agent. It holds the transcript and drives one turn at a time.
 *
 * @param {object} options
 * @param {string} options.endpoint         chat endpoint, usually /api/chat
 * @param {string|Function} options.system  the system prompt, or a function
 *                                          returning it, so runtime facts like
 *                                          the live origins can be appended
 * @param {Function} options.getTools       async () => Array<toolSchema>
 * @param {Function} options.runTool        async (call) => { result, ms, status, origin }
 * @param {Function} options.onChange       called after every transcript change
 * @param {Function} options.onState        called with { running, round }
 */
export function createAgent({ endpoint, system, getTools, runTool, onChange, onState }) {
  /** @type {Array} render entries. `system-note` entries never reach the model. */
  let transcript = [];
  let running = false;
  let abort = null;
  let backend = '';

  /** The system prompt for this request. A function is re-read every turn. */
  const systemPrompt = () => (typeof system === 'function' ? system() : String(system || ''));

  const emit = () => onChange(transcript.slice());
  const state = (round = 0) => onState({ running, round });

  function push(entry) {
    transcript.push({ at: Date.now(), ...entry });
    emit();
    return transcript[transcript.length - 1];
  }

  /** The provider neutral message list, derived from the render transcript. */
  function toMessages() {
    const messages = [];
    for (const entry of transcript) {
      if (entry.role === 'user') messages.push({ role: 'user', content: entry.content });
      else if (entry.role === 'assistant' && entry.content) {
        messages.push({ role: 'assistant', content: entry.content });
      } else if (entry.role === 'assistant' && entry.toolCalls) {
        messages.push({ role: 'assistant', content: '', toolCalls: entry.toolCalls });
      } else if (entry.role === 'tool') {
        messages.push({
          role: 'tool',
          toolCallId: entry.toolCallId,
          name: entry.name,
          content: entry.content
        });
      }
    }
    return messages;
  }

  async function postChat(tools, signal) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: systemPrompt(), messages: toMessages(), tools }),
      signal
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || !data || data.status === 'error') {
      const detail = (data && data.error) || `${response.status} ${response.statusText}`;
      throw new Error(detail);
    }
    if (data.backend) backend = data.backend;
    return data;
  }

  /**
   * One user turn: post, run tools, repeat until the model answers with text
   * or the round budget runs out.
   */
  async function send(text) {
    const message = String(text || '').trim();
    if (!message || running) return;
    push({ role: 'user', content: message });
    await run();
  }

  /** Re-run the last turn without adding a new user message. */
  async function retry() {
    if (running) return;
    while (transcript.length > 0 && transcript[transcript.length - 1].role === 'note') transcript.pop();
    emit();
    await run();
  }

  async function run() {
    running = true;
    abort = new AbortController();
    const { signal } = abort;
    state(0);

    try {
      for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
        state(round);
        const tools = await getTools();
        const answer = await postChat(tools, signal);

        if (answer.text) push({ role: 'assistant', content: answer.text });

        const calls = Array.isArray(answer.toolCalls) ? answer.toolCalls : [];
        if (calls.length === 0) {
          if (!answer.text) {
            push({ role: 'note', kind: 'warn', content: 'The model returned nothing. Try again.' });
          }
          return;
        }

        push({ role: 'assistant', toolCalls: calls });

        for (const call of calls) {
          if (signal.aborted) throw new DOMException('stopped', 'AbortError');
          const outcome = await runTool(call);
          push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            args: outcome.args ?? call.arguments ?? {},
            origin: outcome.origin || '',
            note: outcome.note || '',
            status: outcome.status,
            ms: outcome.ms,
            content: outcome.content
          });
        }
      }
      push({
        role: 'note',
        kind: 'warn',
        content: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds in one turn. Ask again to continue.`
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        push({ role: 'note', kind: 'warn', content: 'Stopped.' });
      } else {
        push({
          role: 'note',
          kind: 'error',
          content: err && err.message ? err.message : String(err),
          retry: true
        });
      }
    } finally {
      running = false;
      abort = null;
      state(0);
    }
  }

  return {
    send,
    retry,
    stop() {
      if (abort) abort.abort();
    },
    isRunning: () => running,
    get backend() {
      return backend;
    },
    entries: () => transcript.slice(),
    load(saved) {
      transcript = Array.isArray(saved) ? saved : [];
      emit();
    },
    reset() {
      transcript = [];
      emit();
    }
  };
}

/**
 * nema WebMCP helper.
 *
 * Every nema page loads `/shared/webmcp-polyfill.js` as a classic script in
 * <head> before any module script, so `document.modelContext` always exists by
 * the time this module runs. This helper registers tools, normalizes the
 * execute contract and broadcasts a `nema:toolcall` event so the UI can show
 * what the agent just did.
 */

import { ORIGINS } from './origins.js';

/**
 * The origins allowed to call nema tools: the coach for the current host.
 * In dev that resolves to http://localhost:8784, in prod to the coach domain.
 * Apps pass this as `exposedTo` to registerTools.
 */
export const EXPOSED_TO = [ORIGINS.coach];

/** Maximum number of tool calls kept in memory for the activity strip. */
const ACTIVITY_LIMIT = 8;

const activity = [];

/** True when the browser has native WebMCP, false when the polyfill installed. */
export function isNative() {
  return typeof window !== 'undefined' && !window.__webmcp_registered_tools;
}

/** Number of tools currently visible to an agent on this document. */
export async function toolCount() {
  try {
    const tools = await document.modelContext.getTools();
    return Array.isArray(tools) ? tools.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Parse whatever the caller passed as tool input into a plain object.
 * Native WebMCP can hand over a JSON string, the polyfill hands over an object.
 */
function normalizeArgs(input) {
  if (input == null) return {};
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
    } catch {
      return { value: input };
    }
  }
  if (typeof input === 'object') return input;
  return { value: input };
}

function statusOf(result) {
  if (result && typeof result === 'object') {
    if (typeof result.status === 'string') return result.status;
    if (typeof result.error === 'string') return 'error';
  }
  return 'ok';
}

function record(entry) {
  activity.push(entry);
  while (activity.length > ACTIVITY_LIMIT) activity.shift();
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('nema:toolcall', { detail: entry }));
  }
}

/** The last tool calls, oldest first. */
export function getActivity() {
  return activity.slice();
}

/**
 * Register a list of tools with document.modelContext.
 * tools: [{ name, description, inputSchema, execute, annotations? }]
 */
export async function registerTools(tools, { exposedTo = [] } = {}) {
  const registered = [];
  const native = isNative();

  for (const tool of tools) {
    const wrapped = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      async execute(input) {
        const args = normalizeArgs(input);
        const startedAt = (typeof performance !== 'undefined' ? performance : Date).now();
        let result;
        try {
          result = await tool.execute(args);
          if (result == null || typeof result !== 'object') {
            result = { status: 'ok', value: result ?? null };
          }
        } catch (err) {
          result = { status: 'error', error: err && err.message ? err.message : String(err) };
        }
        const ms = Math.round(
          (typeof performance !== 'undefined' ? performance : Date).now() - startedAt
        );
        record({ name: tool.name, args, result, ms, status: statusOf(result), at: Date.now() });
        return result;
      }
    };
    if (tool.annotations) wrapped.annotations = tool.annotations;

    try {
      if (native && exposedTo.length > 0) {
        await document.modelContext.registerTool(wrapped, { exposedTo });
      } else {
        await document.modelContext.registerTool(wrapped);
      }
      registered.push(tool.name);
      console.log(`[nema] tool registered: ${tool.name}`);
    } catch (err) {
      console.warn(`[nema] tool not registered: ${tool.name}:`, err && err.message ? err.message : err);
    }
  }

  console.log(
    `[nema] ${registered.length} of ${tools.length} tools live (${native ? 'native WebMCP' : 'polyfill'})`
  );
  return registered;
}

/**
 * Render the last tool calls into `container` and keep it updated.
 * Rows show the tool name, the duration in milliseconds and the status.
 * Returns a function that stops updating.
 */
export function mountActivityStrip(container) {
  if (!container) return () => {};
  container.classList.add('activity-strip');

  const empty = document.createElement('div');
  empty.className = 'activity-row activity-row-empty';
  empty.textContent = 'No tool calls yet. Ask the agent to do something.';

  function render() {
    container.textContent = '';
    const rows = activity.slice(-ACTIVITY_LIMIT).reverse();
    if (rows.length === 0) {
      container.appendChild(empty);
      return;
    }
    for (const entry of rows) {
      const row = document.createElement('div');
      row.className = 'activity-row';
      row.dataset.status = entry.status;

      const name = document.createElement('span');
      name.className = 'activity-name';
      name.textContent = entry.name;

      const ms = document.createElement('span');
      ms.className = 'activity-ms';
      ms.textContent = `${entry.ms} ms`;

      const status = document.createElement('span');
      status.className = 'activity-status';
      status.textContent = entry.status;

      row.append(name, ms, status);
      container.appendChild(row);
    }
  }

  render();
  document.addEventListener('nema:toolcall', render);
  return () => document.removeEventListener('nema:toolcall', render);
}

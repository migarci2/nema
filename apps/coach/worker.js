/**
 * nema coach worker.
 *
 * One provider neutral chat endpoint (contract section 11) plus a health probe.
 * The browser owns the agent loop: it discovers WebMCP tools in the iframe,
 * executes them, and posts the whole conversation back on every turn. The
 * worker only translates one request shape into whichever model backend is
 * configured, and translates the answer back.
 *
 *   POST /api/chat
 *     body    { system: string, messages: Message[], tools: Tool[] }
 *     Message { role: 'user',      content: string }
 *             | { role: 'assistant', content?: string, toolCalls?: ToolCall[] }
 *             | { role: 'tool',      toolCallId: string, name: string, content: string }
 *     Tool     { name, description, inputSchema }
 *     ToolCall { id, name, arguments: object }
 *     returns { text: string|null, toolCalls: ToolCall[], backend }
 *
 *   GET /api/health -> { status: 'ok', backend: 'openai'|'anthropic'|'workers-ai' }
 *
 * Backend priority: OPENAI_API_KEY, then ANTHROPIC_API_KEY, then the Workers AI
 * binding. Workers AI is the path that runs with no key at all, so it is the
 * one the demo uses.
 *
 * The mapping functions are exported so `node --test apps/coach/adapters.test.js`
 * can check the two key based adapters without any key.
 */

const WORKERS_AI_MODEL = '@cf/openai/gpt-oss-120b';
const OPENAI_DEFAULT_MODEL = 'gpt-5.5';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_MODEL = 'claude-opus-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 4096;

/* -------------------------------------------------------------- helpers -- */

/** Which backend this deployment will use, given the environment it has. */
export function pickBackend(env = {}) {
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'workers-ai';
}

/** Tool call arguments always reach the browser as an object, never a string. */
function parseArguments(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return {};
  }
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function callsOf(message) {
  return Array.isArray(message.toolCalls) ? message.toolCalls : [];
}

function schemaOf(tool) {
  const schema = tool && tool.inputSchema;
  if (schema && typeof schema === 'object') return schema;
  return { type: 'object', properties: {}, required: [] };
}

/* ------------------------------------------------------- openai adapter -- */

/**
 * Provider neutral request to an OpenAI Chat Completions body.
 * Tool calls travel as `tool_calls` on an assistant message and come back as
 * `role: 'tool'` messages keyed by `tool_call_id`.
 */
export function toOpenAIRequest({ system, messages, tools }, model = OPENAI_DEFAULT_MODEL) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const message of messages || []) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: textOf(message.content) });
      continue;
    }
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: textOf(message.content)
      });
      continue;
    }
    if (message.role === 'assistant') {
      const calls = callsOf(message);
      if (calls.length > 0) {
        out.push({
          role: 'assistant',
          content: textOf(message.content) || null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }
          }))
        });
      } else {
        out.push({ role: 'assistant', content: textOf(message.content) });
      }
    }
  }

  const body = { model, messages: out, max_completion_tokens: MAX_OUTPUT_TOKENS };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: schemaOf(tool)
      }
    }));
    body.tool_choice = 'auto';
  }
  return body;
}

/** OpenAI Chat Completions answer to the neutral shape. */
export function fromOpenAIResponse(data) {
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return { text: null, toolCalls: [] };
  const toolCalls = (message.tool_calls || [])
    .filter((call) => call && call.function && call.function.name)
    .map((call, i) => ({
      id: call.id || `call_${i + 1}`,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments)
    }));
  const text = typeof message.content === 'string' && message.content !== '' ? message.content : null;
  return { text, toolCalls };
}

/* ---------------------------------------------------- anthropic adapter -- */

/**
 * Provider neutral request to an Anthropic Messages body. Tool calls are
 * `tool_use` content blocks on an assistant turn, and results come back as
 * `tool_result` blocks inside a user turn. Adjacent results are merged into a
 * single user message, which is what the API expects.
 */
export function toAnthropicRequest({ system, messages, tools }, model = ANTHROPIC_MODEL) {
  const out = [];

  const pushUserBlock = (block) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      last.content.push(block);
      return;
    }
    out.push({ role: 'user', content: [block] });
  };

  for (const message of messages || []) {
    if (message.role === 'user') {
      pushUserBlock({ type: 'text', text: textOf(message.content) });
      continue;
    }
    if (message.role === 'tool') {
      pushUserBlock({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: textOf(message.content)
      });
      continue;
    }
    if (message.role === 'assistant') {
      const content = [];
      const text = textOf(message.content);
      if (text) content.push({ type: 'text', text });
      for (const call of callsOf(message)) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} });
      }
      if (content.length === 0) continue;
      /* The browser pushes text and tool calls as two entries so the transcript
       * can render them apart. Anthropic wants one assistant turn, and rejects
       * two in a row, so they are merged back here. */
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && Array.isArray(last.content)) last.content.push(...content);
      else out.push({ role: 'assistant', content });
    }
  }

  const body = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: 'medium' },
    messages: out
  };
  if (system) body.system = system;
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: schemaOf(tool)
    }));
  }
  return body;
}

/** Anthropic Messages answer to the neutral shape. */
export function fromAnthropicResponse(data) {
  const blocks = (data && Array.isArray(data.content)) ? data.content : [];
  const texts = [];
  const toolCalls = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    if (block.type === 'tool_use' && block.name) {
      toolCalls.push({ id: block.id, name: block.name, arguments: parseArguments(block.input) });
    }
  }
  const text = texts.join('\n').trim();
  return { text: text === '' ? null : text, toolCalls };
}

/* --------------------------------------------------- workers ai adapter -- */

/**
 * Provider neutral request to the Workers AI binding input for
 * `@cf/openai/gpt-oss-120b`. Through the binding this model answers the
 * chat.completion shape when it is given `messages` plus nested `tools`, and
 * the schema rejects a null `content`, so an assistant turn that only holds
 * tool calls carries an empty string instead.
 */
export function toWorkersAIRequest({ system, messages, tools }) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const message of messages || []) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: textOf(message.content) });
      continue;
    }
    if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: textOf(message.content)
      });
      continue;
    }
    if (message.role === 'assistant') {
      const calls = callsOf(message);
      const entry = { role: 'assistant', content: textOf(message.content) };
      if (calls.length > 0) {
        entry.tool_calls = calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }
        }));
      }
      out.push(entry);
    }
  }

  const body = { messages: out, max_tokens: MAX_OUTPUT_TOKENS };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: schemaOf(tool)
      }
    }));
  }
  return body;
}

/**
 * Workers AI answer to the neutral shape. The binding returns a chat.completion
 * for this model, and the Responses API shape for some others, so both are read.
 */
export function fromWorkersAIResponse(data) {
  if (!data || typeof data !== 'object') return { text: null, toolCalls: [] };

  if (Array.isArray(data.choices)) return fromOpenAIResponse(data);

  if (Array.isArray(data.output)) {
    const texts = [];
    const toolCalls = [];
    for (const item of data.output) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'function_call' && item.name) {
        toolCalls.push({
          id: item.call_id || item.id,
          name: item.name,
          arguments: parseArguments(item.arguments)
        });
      }
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part && part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
        }
      }
    }
    const text = texts.join('\n').trim();
    return { text: text === '' ? null : text, toolCalls };
  }

  if (typeof data.response === 'string') {
    const toolCalls = (data.tool_calls || [])
      .filter((call) => call && call.name)
      .map((call, i) => ({
        id: call.id || `call_${i + 1}`,
        name: call.name,
        arguments: parseArguments(call.arguments)
      }));
    return { text: data.response === '' ? null : data.response, toolCalls };
  }

  return { text: null, toolCalls: [] };
}

/* ------------------------------------------------------------- backends -- */

async function callOpenAI(env, payload) {
  const model = env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(toOpenAIRequest(payload, model))
  });
  if (!response.ok) {
    throw new Error(`openai ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  return fromOpenAIResponse(await response.json());
}

async function callAnthropic(env, payload) {
  const model = env.ANTHROPIC_MODEL || ANTHROPIC_MODEL;
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(toAnthropicRequest(payload, model))
  });
  if (!response.ok) {
    throw new Error(`anthropic ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  return fromAnthropicResponse(await response.json());
}

async function callWorkersAI(env, payload) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    throw new Error('no model backend: set OPENAI_API_KEY or ANTHROPIC_API_KEY, or bind Workers AI as AI');
  }
  const data = await env.AI.run(env.WORKERS_AI_MODEL || WORKERS_AI_MODEL, toWorkersAIRequest(payload));
  return fromWorkersAIResponse(data);
}

/** Route one neutral request to the configured backend. */
export async function chat(env, payload) {
  const backend = pickBackend(env);
  if (backend === 'openai') return { backend, ...(await callOpenAI(env, payload)) };
  if (backend === 'anthropic') return { backend, ...(await callAnthropic(env, payload)) };
  return { backend, ...(await callWorkersAI(env, payload)) };
}

/* --------------------------------------------------------------- fetch -- */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') return 'body must be a JSON object';
  if (!Array.isArray(payload.messages)) return 'messages must be an array';
  if (payload.messages.length === 0) return 'messages must not be empty';
  if (payload.messages.length > 200) return 'messages is too long for one turn';
  if (payload.tools != null && !Array.isArray(payload.tools)) return 'tools must be an array';
  for (const message of payload.messages) {
    if (!message || typeof message !== 'object') return 'every message must be an object';
    if (!['user', 'assistant', 'tool'].includes(message.role)) return `unknown message role: ${message.role}`;
    if (message.role === 'tool' && typeof message.toolCallId !== 'string') {
      return 'a tool message needs a toolCallId';
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ status: 'error', error: 'method not allowed' }, 405);
      }
      return json({ status: 'ok', backend: pickBackend(env) });
    }

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return json({ status: 'error', error: 'method not allowed' }, 405);
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', error: 'body is not valid JSON' }, 400);
      }
      const invalid = validate(payload);
      if (invalid) return json({ status: 'error', error: invalid }, 400);

      try {
        const answer = await chat(env, {
          system: typeof payload.system === 'string' ? payload.system : '',
          messages: payload.messages,
          tools: payload.tools || []
        });
        return json({
          status: 'ok',
          backend: answer.backend,
          text: answer.text ?? null,
          toolCalls: answer.toolCalls || []
        });
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return json({ status: 'error', backend: pickBackend(env), error: message }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

/* Coach worker adapter tests.
 *
 *   node --test apps/coach/adapters.test.js
 *
 * The OpenAI and Anthropic backends need a key, so the demo never reaches them.
 * Their mapping is still the part most likely to rot, so it is pinned here.
 * The Workers AI mapping is checked against a real answer recorded from
 * `env.AI.run('@cf/openai/gpt-oss-120b', ...)` on 2026-09-01.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickBackend,
  toOpenAIRequest,
  fromOpenAIResponse,
  toAnthropicRequest,
  fromAnthropicResponse,
  toWorkersAIRequest,
  fromWorkersAIResponse
} from './worker.js';

const TOOLS = [
  {
    name: 'get_vault_summary',
    description: 'Counts only. Evidence history never leaves the vault.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }
  }
];

const CONVERSATION = {
  system: 'You are nema Coach.',
  tools: TOOLS,
  messages: [
    { role: 'user', content: 'Summarize my vault.' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_vault_summary', arguments: {} }] },
    { role: 'tool', toolCallId: 'call_1', name: 'get_vault_summary', content: '{"status":"ok","concepts":30}' },
    { role: 'assistant', content: 'You track 30 concepts.' },
    { role: 'user', content: 'And the reviews?' }
  ]
};

/* ------------------------------------------------------------ backend -- */

test('pickBackend prefers openai, then anthropic, then workers ai', () => {
  assert.equal(pickBackend({ OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }), 'openai');
  assert.equal(pickBackend({ ANTHROPIC_API_KEY: 'k' }), 'anthropic');
  assert.equal(pickBackend({}), 'workers-ai');
});

/* ------------------------------------------------------------- openai -- */

test('toOpenAIRequest maps the neutral conversation onto chat completions', () => {
  const body = toOpenAIRequest(CONVERSATION, 'gpt-5.5');

  assert.equal(body.model, 'gpt-5.5');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'You are nema Coach.');

  const assistant = body.messages[2];
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.tool_calls[0].type, 'function');
  assert.equal(assistant.tool_calls[0].id, 'call_1');
  assert.equal(assistant.tool_calls[0].function.name, 'get_vault_summary');
  assert.equal(assistant.tool_calls[0].function.arguments, '{}');

  const toolMessage = body.messages[3];
  assert.equal(toolMessage.role, 'tool');
  assert.equal(toolMessage.tool_call_id, 'call_1');
  assert.equal(toolMessage.content, '{"status":"ok","concepts":30}');

  assert.equal(body.tools[0].type, 'function');
  assert.equal(body.tools[0].function.name, 'get_vault_summary');
  assert.equal(body.tools[0].function.parameters.type, 'object');
  assert.equal(body.tool_choice, 'auto');
});

test('fromOpenAIResponse reads text and tool calls, and parses the arguments', () => {
  assert.deepEqual(
    fromOpenAIResponse({ choices: [{ message: { role: 'assistant', content: 'Two reviews are due.' } }] }),
    { text: 'Two reviews are due.', toolCalls: [] }
  );

  const withCalls = fromOpenAIResponse({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_9',
          type: 'function',
          function: { name: 'get_learner_state', arguments: '{"concepts":["nema:agent-evals"]}' }
        }]
      }
    }]
  });
  assert.equal(withCalls.text, null);
  assert.deepEqual(withCalls.toolCalls, [
    { id: 'call_9', name: 'get_learner_state', arguments: { concepts: ['nema:agent-evals'] } }
  ]);
});

test('fromOpenAIResponse survives arguments that are not valid JSON', () => {
  const answer = fromOpenAIResponse({
    choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{oops' } }] } }]
  });
  assert.deepEqual(answer.toolCalls[0].arguments, {});
});

/* ---------------------------------------------------------- anthropic -- */

test('toAnthropicRequest uses tool_use blocks and merges tool results', () => {
  const body = toAnthropicRequest(CONVERSATION, 'claude-opus-5');

  assert.equal(body.model, 'claude-opus-5');
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.output_config, { effort: 'medium' });
  assert.equal(body.system, 'You are nema Coach.');
  assert.equal(body.tools[0].name, 'get_vault_summary');
  assert.equal(body.tools[0].input_schema.type, 'object');
  assert.ok(!('inputSchema' in body.tools[0]));

  assert.equal(body.messages[0].role, 'user');
  assert.deepEqual(body.messages[0].content, [{ type: 'text', text: 'Summarize my vault.' }]);

  assert.equal(body.messages[1].role, 'assistant');
  assert.deepEqual(body.messages[1].content, [
    { type: 'tool_use', id: 'call_1', name: 'get_vault_summary', input: {} }
  ]);

  assert.equal(body.messages[2].role, 'user');
  assert.deepEqual(body.messages[2].content, [
    { type: 'tool_result', tool_use_id: 'call_1', content: '{"status":"ok","concepts":30}' }
  ]);
});

test('toAnthropicRequest merges two tool results into one user turn', () => {
  const body = toAnthropicRequest({
    system: '',
    tools: [],
    messages: [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        toolCalls: [
          { id: 'a', name: 'one', arguments: {} },
          { id: 'b', name: 'two', arguments: { x: 1 } }
        ]
      },
      { role: 'tool', toolCallId: 'a', name: 'one', content: '{"status":"ok"}' },
      { role: 'tool', toolCallId: 'b', name: 'two', content: '{"status":"ok"}' }
    ]
  });

  assert.equal(body.messages.length, 3);
  assert.equal(body.messages[1].content.length, 2);
  assert.equal(body.messages[2].role, 'user');
  assert.equal(body.messages[2].content.length, 2);
  assert.equal(body.messages[2].content[1].tool_use_id, 'b');
  assert.equal(body.system, undefined);
});

test('fromAnthropicResponse joins text blocks and reads tool_use blocks', () => {
  const answer = fromAnthropicResponse({
    content: [
      { type: 'text', text: 'Asking your vault first.' },
      { type: 'tool_use', id: 'toolu_1', name: 'create_readiness_assertion', input: { audience: 'https://x' } }
    ]
  });
  assert.equal(answer.text, 'Asking your vault first.');
  assert.deepEqual(answer.toolCalls, [
    { id: 'toolu_1', name: 'create_readiness_assertion', arguments: { audience: 'https://x' } }
  ]);

  assert.deepEqual(fromAnthropicResponse({ content: [] }), { text: null, toolCalls: [] });
});

/* --------------------------------------------------------- workers ai -- */

test('toWorkersAIRequest never emits a null content', () => {
  const body = toWorkersAIRequest(CONVERSATION);
  for (const message of body.messages) {
    assert.equal(typeof message.content, 'string', `${message.role} content must be a string`);
  }
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[2].content, '');
  assert.equal(body.messages[2].tool_calls[0].function.arguments, '{}');
  assert.equal(body.messages[3].role, 'tool');
  assert.equal(body.messages[3].tool_call_id, 'call_1');
  assert.equal(body.tools[0].function.name, 'get_vault_summary');
  assert.equal(body.max_tokens, 4096);
});

test('fromWorkersAIResponse reads the recorded chat.completion answer', () => {
  /* Recorded from env.AI.run('@cf/openai/gpt-oss-120b', { messages, tools }). */
  const recorded = {
    object: 'chat.completion',
    choices: [{
      finish_reason: 'tool_calls',
      index: 0,
      message: {
        content: null,
        reasoning: 'The user wants a summary of their vault.',
        role: 'assistant',
        tool_calls: [{
          function: { arguments: '{}', name: 'get_vault_summary' },
          id: 'chatcmpl-tool-9c5c99a4595aee30',
          type: 'function'
        }]
      }
    }],
    model: '@cf/openai/gpt-oss-120b'
  };
  const answer = fromWorkersAIResponse(recorded);
  assert.equal(answer.text, null);
  assert.deepEqual(answer.toolCalls, [
    { id: 'chatcmpl-tool-9c5c99a4595aee30', name: 'get_vault_summary', arguments: {} }
  ]);
});

test('fromWorkersAIResponse also reads the responses API shape', () => {
  const answer = fromWorkersAIResponse({
    object: 'response',
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'thinking' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ready' }] },
      { type: 'function_call', call_id: 'call_7', name: 'get_vault_summary', arguments: '{"a":1}' }
    ]
  });
  assert.equal(answer.text, 'ready');
  assert.deepEqual(answer.toolCalls, [{ id: 'call_7', name: 'get_vault_summary', arguments: { a: 1 } }]);
});

test('fromWorkersAIResponse falls back to the plain text shape', () => {
  assert.deepEqual(fromWorkersAIResponse({ response: 'hello' }), { text: 'hello', toolCalls: [] });
  assert.deepEqual(fromWorkersAIResponse(null), { text: null, toolCalls: [] });
});

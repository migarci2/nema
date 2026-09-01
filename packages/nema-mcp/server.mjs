// The nema vault as an MCP server: the nine WebMCP tools, verbatim, over stdio.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadVault } from './vault-node.mjs';

const APPROVE_HINT =
  'No one approved this disclosure. Terminal clients without elicitation cannot show the consent prompt, ' +
  'so the learner pre-approves a site from a shell: nema-mcp approve <audience> --hours 1. The agent cannot do this.';

export async function createServer() {
  const { vault, TOOLS, file } = await loadVault();
  const server = new Server(
    { name: 'nema-mcp', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions:
      'nema learning vault. The learner owns this vault. Tools return status bands, never evidence history. ' +
      'create_readiness_assertion needs the learner\'s approval: the server asks them through elicitation when the client supports it, ' +
      'otherwise the learner pre-approves a site with `nema-mcp approve <origin>`. Never answer a learning activity for the learner; ' +
      'record_agent_assessment is only for rubric results of a question the learner actually answered.' }
  );

  let elicitationSupported = false;
  server.oninitialized = () => {
    const caps = server.getClientCapabilities();
    elicitationSupported = !!(caps && caps.elicitation);
  };

  vault.setConsentHandler(async (request, { signal }) => {
    if (!elicitationSupported) return { approved: false, autoApprove: false };
    const lines = request.shared.map((s) => `${s.title || s.concept} (${s.ability}): ${s.status}`);
    const message =
      `${request.audienceName || request.audience} asks to know ${request.shared.length} status band${request.shared.length === 1 ? '' : 's'} ` +
      `for the purpose "${request.purpose}".\n\nShared:\n- ${lines.join('\n- ')}\n\nNot shared: ${request.withheld.join(', ')}.\n` +
      `Expires in ${request.ttlMinutes} minutes. Learner id for this site: ${request.learnerKeyId}.`;
    try {
      const result = await server.elicitInput({
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            approve: { type: 'boolean', title: 'Approve this disclosure', description: 'Share exactly the bands listed above with this site.' },
            autoApprove: { type: 'boolean', title: 'Auto approve this site for one hour', default: false }
          },
          required: ['approve']
        }
      }, { signal });
      const approved = result.action === 'accept' && !!(result.content && result.content.approve);
      const autoApprove = approved && !!(result.content && result.content.autoApprove);
      return { approved, autoApprove };
    } catch {
      return { approved: false, autoApprove: false };
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `unknown tool ${request.params.name}` }) }] };
    }
    let result;
    try {
      result = await tool.execute(request.params.arguments || {});
    } catch (err) {
      result = { status: 'error', error: err && err.message ? err.message : String(err) };
    }
    if (result == null || typeof result !== 'object') result = { status: 'ok', value: result };
    if (tool.name === 'create_readiness_assertion' && result.status === 'denied' && !elicitationSupported) {
      result = { ...result, hint: APPROVE_HINT };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  });

  return { server, vault, file, async serve() { await server.connect(new StdioServerTransport()); } };
}

/**
 * nema coach worker: stub.
 *
 * This file will be replaced by the real coach worker (contract section 11):
 * POST /api/chat adapts a provider-neutral chat request to the Anthropic
 * Messages API when ANTHROPIC_API_KEY is set, and to Workers AI through env.AI
 * otherwise. For now it answers the health probe and returns 501 for chat so
 * the deploy pipeline can be verified end to end.
 */

const APP = 'coach';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ status: 'ok', app: APP });
    }

    if (request.method === 'POST' && url.pathname === '/api/chat') {
      return Response.json({ status: 'not-implemented' }, { status: 501 });
    }

    return env.ASSETS.fetch(request);
  }
};

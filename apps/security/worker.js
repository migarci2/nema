/**
 * nema security worker: stub.
 *
 * This file will be replaced by the real provider worker (contract section 10):
 * POST /api/receipt signs an EvidenceReceipt with env.ISSUER_PRIVATE_JWK and
 * GET /api/manifest returns the LearningManifest. For now it only answers the
 * health probe so the deploy pipeline can be verified end to end.
 */

const APP = 'security';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ status: 'ok', app: APP });
    }

    return env.ASSETS.fetch(request);
  }
};

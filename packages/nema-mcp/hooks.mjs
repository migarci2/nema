// Module resolution hooks: the vault's browser modules import absolute paths
// such as /shared/protocol.js and /vault.js. In Node those map onto the repo.
import { pathToFileURL } from 'node:url';

let repo = '';

export async function initialize(data) {
  repo = data.repo;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/shared/')) {
    return { url: pathToFileURL(repo + specifier).href, shortCircuit: true };
  }
  if (specifier === '/vault.js') {
    return { url: pathToFileURL(repo + '/apps/vault/public/vault.js').href, shortCircuit: true };
  }
  return next(specifier, context);
}

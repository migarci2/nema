// Boots the browser vault inside Node: globals, module hooks, then the vault
// and its tool table, unchanged from apps/vault/public.
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { installGlobals } from './shim.mjs';

export const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const VAULT_FILE = process.env.NEMA_VAULT_FILE || path.join(os.homedir(), '.nema', 'vault.json');

let loaded = null;

export async function loadVault() {
  if (loaded) return loaded;
  installGlobals({ file: VAULT_FILE, repo: REPO });
  register('./hooks.mjs', import.meta.url, { data: { repo: REPO } });
  const vault = await import('/vault.js');
  const tools = await import(path.join(REPO, 'apps/vault/public/tools.js'));
  await vault.init();
  loaded = { vault, TOOLS: tools.TOOLS, file: VAULT_FILE };
  return loaded;
}

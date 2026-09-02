#!/usr/bin/env node
// nema-mcp: the nema vault for terminal agents.
//   nema-mcp                      serve over stdio (default)
//   nema-mcp approve <origin> [--hours N]   pre-approve disclosures to one site
//   nema-mcp seed                 load the demo learner
//   nema-mcp summary              print the vault summary
//   nema-mcp export [file]        write the vault document as JSON
//   nema-mcp merge <file>         union a browser export into this vault
import fs from 'node:fs';

const [cmd = 'serve', ...rest] = process.argv.slice(2);

function flag(name, fallback) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback;
}

if (cmd === 'serve') {
  const { createServer } = await import('./server.mjs');
  const { serve } = await createServer();
  await serve();
} else if (cmd === 'approve') {
  const audience = rest.find((a) => !a.startsWith('--') && a !== flag('--hours'));
  if (!audience) { console.error('usage: nema-mcp approve <origin> [--hours N]'); process.exit(2); }
  const hours = Number(flag('--hours', '1'));
  const { loadVault } = await import('./vault-node.mjs');
  const { vault, file } = await loadVault();
  const doc = JSON.parse(vault.exportJson());
  doc.settings = doc.settings || {};
  doc.settings.autoApprove = doc.settings.autoApprove || {};
  doc.settings.autoApprove[audience] = new Date(Date.now() + hours * 3600e3).toISOString();
  await vault.importJson(JSON.stringify(doc));
  console.log(`approved ${audience} until ${doc.settings.autoApprove[audience]} (${file})`);
} else if (cmd === 'seed') {
  const { loadVault } = await import('./vault-node.mjs');
  const { vault, file } = await loadVault();
  const result = await vault.loadDemoSeed();
  console.log(JSON.stringify(result), file);
} else if (cmd === 'summary') {
  const { loadVault } = await import('./vault-node.mjs');
  const { vault, TOOLS } = await loadVault();
  const tool = TOOLS.find((t) => t.name === 'get_vault_summary');
  console.log(JSON.stringify(await tool.execute({}), null, 2));
} else if (cmd === 'export') {
  const { loadVault } = await import('./vault-node.mjs');
  const { vault } = await loadVault();
  const out = rest[0];
  if (out) { fs.writeFileSync(out, vault.exportJson() + '\n'); console.log(`wrote ${out}`); } else { process.stdout.write(vault.exportJson() + '\n'); }
} else if (cmd === 'merge') {
  const src = rest[0];
  if (!src) { console.error('usage: nema-mcp merge <export.json>'); process.exit(2); }
  const incoming = JSON.parse(fs.readFileSync(src, 'utf8'));
  const { loadVault } = await import('./vault-node.mjs');
  const { vault } = await loadVault();
  const doc = JSON.parse(vault.exportJson());
  const unionBy = (a, b, key) => { const seen = new Set(a.map(key)); return a.concat((b || []).filter((x) => !seen.has(key(x)))); };
  doc.receipts = unionBy(doc.receipts || [], incoming.receipts, (r) => r.receiptId);
  doc.disclosures = unionBy(doc.disclosures || [], incoming.disclosures, (d) => `${d.audience}|${d.requestHash}|${d.sharedAt}`);
  doc.goals = unionBy(doc.goals || [], incoming.goals, (g) => g.goalId);
  doc.misconceptions = unionBy(doc.misconceptions || [], incoming.misconceptions, (m) => `${m.concept}|${m.id}`);
  /* Alignments are unioned by id, then by the name they are about: the same
   * site concept aligned on two machines can carry two ids, and the answer the
   * learner actually gave is the confirmed one, whichever side it came from. */
  const alignments = (doc.alignments || []).slice();
  const byId = new Map(alignments.map((a) => [a.alignmentId, a]));
  const byName = new Map(alignments.map((a) => [`${a.origin}|${a.providerConcept}`, a]));
  for (const entry of incoming.alignments || []) {
    if (!entry || typeof entry.alignmentId !== 'string') continue;
    if (byId.has(entry.alignmentId)) continue;
    const nameKey = `${entry.origin}|${entry.providerConcept}`;
    const held = byName.get(nameKey);
    if (held) {
      /* Same name, different id: one row survives. A confirmed alignment is
       * the answer the learner gave, so it wins; otherwise the row already
       * here stands and the newcomer is dropped. */
      if (entry.status === 'confirmed' && held.status !== 'confirmed') {
        alignments[alignments.indexOf(held)] = entry;
        byId.delete(held.alignmentId);
        byId.set(entry.alignmentId, entry);
        byName.set(nameKey, entry);
      }
      continue;
    }
    alignments.push(entry);
    byId.set(entry.alignmentId, entry);
    byName.set(nameKey, entry);
  }
  const alignedBefore = (doc.alignments || []).length;
  doc.alignments = alignments;
  if (!doc.vaultKey && incoming.vaultKey) doc.vaultKey = incoming.vaultKey;
  const before = JSON.parse(vault.exportJson()).receipts.length;
  await vault.importJson(JSON.stringify(doc));
  console.log(`merged: ${before} -> ${doc.receipts.length} receipts, ${alignedBefore} -> ${doc.alignments.length} alignments`);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}

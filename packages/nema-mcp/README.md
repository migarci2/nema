# nema-mcp

> **Prove it once. Skip it everywhere.**
>
> A site asks your vault what you already know, you say yes, and the site
> adapts. When you pass something, it signs a receipt that any other site can
> ask about. The picture is on [the hub](https://nema.migarci2.dev/).

The nema learning vault for terminal agents. Claude Code, Codex and any other
MCP client get the same eleven tools that browser agents reach through WebMCP
on the vault page. Same names, same schemas, same return shapes, same code:
this package boots `apps/vault/public/vault.js` and `tools.js` inside Node
with four small shims (a file backed `localStorage`, an event sink for
`document`, a `fetch` that reads repo files, and module hooks that resolve the
vault's absolute imports).

The vault is the infrastructure. The agent is a commodity: nema ships none, and
this package exists so the one you already run in a terminal can hold the vault
side while the sites stay in a browser. You ask here for a readiness assertion,
approve it here, and paste the token into "Paste an assertion" on the site.
Receipts come back the same way, pasted or carried by the agent.

## Install

```sh
cd nema/packages/nema-mcp && npm install

# Claude Code
claude mcp add nema -- node /absolute/path/to/nema/packages/nema-mcp/bin.mjs

# Codex
codex mcp add nema -- node /absolute/path/to/nema/packages/nema-mcp/bin.mjs
```

The vault document lives in `~/.nema/vault.json` (override with
`NEMA_VAULT_FILE`). It has the exact schema the browser vault stores in
`localStorage`, so the two sync by export and import.

Non interactive example, verified with Codex 0.151:

```sh
node packages/nema-mcp/bin.mjs seed
codex exec --dangerously-bypass-approvals-and-sandbox \
  "Using the nema MCP tools, call get_vault_summary and get_learning_needs with budgetMinutes 5, then summarise."
```

Interactive `codex` and Claude Code ask you to approve each nema tool call; `codex exec` needs the bypass flag because its default approval policy is never.

## Tools

| tool | what it does |
|---|---|
| `get_vault_summary` | counts: concepts with evidence, durable, usable, fragile, reviews due, receipts, disclosures |
| `get_learner_state` | one row per concept with a band per ability. Bands only, never evidence |
| `set_learning_goal` | add a goal; goals only re-order needs |
| `create_readiness_assertion` | ask the learner, then sign an audience bound, 30 minute token with the requested bands |
| `stage_evidence_receipt` | verify a receipt, record its trust tier (`registered`, `origin` or `self`), reject replays, move bands |
| `get_learning_needs` | ordered needs with rubric, for a minute budget |
| `record_agent_assessment` | store the rubric result of a question the learner answered, as agent evidence |
| `get_disclosure_ledger` | what left the vault, to whom, until when |
| `get_evidence_ledger` | the receipts the vault holds, newest first |
| `propose_concept_alignment` | propose that a site's own concept id means a nema registry concept |
| `get_concept_alignments` | list those proposals with the learner's answer, or lack of one |

Nothing here writes mastery, answers for the learner, or exports the ledger
to an agent. Those tools do not exist on purpose.

## Sites that speak their own names

A site is not obliged to use `nema:` concept ids. The blog says
`browning-science`; the registry says `nema:maillard-reaction`. The two
alignment tools are how an agent closes that gap, and they needed no work on
this side: the package serves whatever `apps/vault/public/tools.js` registers,
so a tool added for WebMCP is an MCP tool in the same commit.

Proposing does not translate anything. It puts the question in the vault's
Alignments list, and only the learner answers it, in the vault page or the
extension panel. There is no `confirm_concept_alignment` tool, on any surface.

Try it after `nema-mcp seed`:

```
Open the blog at https://maillard.migarci2.dev, read its manifest with
describe_learning_offer, and for every concept id it uses that is not a nema:
id, propose what you think it means in my vault with
propose_concept_alignment. Then show me the list and tell me what you would
have to guess.
```

A receipt whose claims use those local ids is still accepted and still kept:
it simply moves nothing until the alignment is confirmed, and then it moves
bands without a single line of the ledger changing.

Receipts from a site that signs with its own browser generated key verify and
land as `self`, capped at the weight of a self report, 0.3. That is how a page
with a one tag install and no server takes part without being able to inflate
anyone: it vouches for itself and for nobody else.

## Consent outside the browser

`create_readiness_assertion` needs the learner. In the browser the vault opens
a modal. Over MCP the server asks the client through elicitation, with the
same text: what will be shared, what will not, for how long, under which
pseudonym. If the client does not support elicitation the request comes back
`denied` with a hint, and the learner pre-approves a site from a shell:

```sh
nema-mcp approve https://saucier.migarci2.dev --hours 1
```

The agent cannot run that for the learner from inside a tool call.

## Commands

```
nema-mcp                    serve over stdio (default)
nema-mcp approve <origin>   pre-approve disclosures to one site (--hours N)
nema-mcp seed               load the demo learner
nema-mcp summary            print the vault summary
nema-mcp export [file]      write the vault document as JSON
nema-mcp merge <file>       union a browser export into this vault (by receipt id)
```

Sync with the browser vault: export from the vault page, then
`nema-mcp merge export.json`. Merging is a union by receipt id, so it is
idempotent and never drops evidence. If this file has no key yet, the
imported key is adopted so the same pseudonyms hold across surfaces.

## Tests

```sh
npm test
```

Drives the server through the official MCP client over stdio: the eleven tool
names, the demo seed, consent denied and approved through elicitation, the
audience binding, the pre-approval policy, a receipt signed by the harness key,
replay rejection, an alignment proposed and left waiting, and an idempotent
merge.

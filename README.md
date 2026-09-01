<p align="center">
  <img src="shared/brand/wordmark.svg" alt="nema" width="280">
</p>

<p align="center"><code>your learning state, everywhere.</code></p>

<p align="center">
  <b>The web teaches. Your vault remembers. Your agent connects the two.</b>
</p>

<p align="center">
  Any website can teach you. Any agent can coach you.<br>
  Your learning state stays local, portable and yours.
</p>

---

## What it is

nema is a WebMCP protocol for learning, plus five pages that implement it.

1. A **vault** you own holds signed evidence of what you have learned and
   derives your state from it, per concept, per ability.
2. A **provider** publishes what it teaches, what it assumes, and what evidence
   each activity produces, as tools on its own page.
3. Your **agent** asks the provider what it needs, asks the vault for a signed,
   audience-bound answer, and carries the result across origins.
4. **You** approve every disclosure in a modal, and you answer every question.
   No tool can do either for you.
5. The payoff: a 68 minute course on pan sauces becomes 27, then 21, and a
   second cooking site recognises prerequisites it never taught, with no
   partnership between the two.

## Live

| App | URL | Tools |
|---|---|---|
| Site (hub) | https://nema.migarci2.dev | `explain_nema`, `open_app` (declarative) |
| Coach (the agent) | https://nema-coach.migarci2.dev | none, it calls the others |
| Vault | https://nema-vault.migarci2.dev | 9 imperative + 1 declarative form (10 in `getTools()`) |
| Saucier School (provider) | https://saucier.migarci2.dev | 5 |
| Line Cook Lab (provider) | https://linecook.migarci2.dev | 5 |

Judges: start with [`docs/JUDGE_GUIDE.md`](docs/JUDGE_GUIDE.md). It is a seven
step walkthrough with the exact tool names and a list of things to try to break.

## Bring your own agent

The vault is the infrastructure. The agent is a commodity, and the same nine
tools reach it over two transports:

| agent | transport | how |
|---|---|---|
| ChatGPT desktop, Chrome 149+ with an agent | WebMCP | open https://nema-vault.migarci2.dev, the tools are on the page |
| The nema coach | WebMCP in an iframe | https://nema-coach.migarci2.dev |
| Claude Code | MCP over stdio | `claude mcp add nema -- node /path/to/nema/packages/nema-mcp/bin.mjs` (this repo ships a project `.mcp.json`, so opening it in Claude Code is enough) |
| Codex | MCP over stdio | `codex mcp add nema -- node /path/to/nema/packages/nema-mcp/bin.mjs` |

[`packages/nema-mcp`](packages/nema-mcp/README.md) boots the browser vault
inside Node with four shims and exposes `tools.js` verbatim. Consent goes
through MCP elicitation, or through a pre-approval the learner sets from a
shell. The vault file (`~/.nema/vault.json`) has the same schema as the
browser one and merges by receipt id.

## Architecture

Five origins. No shared database, no accounts, no server that sees both sides.

```
                        +-------------------------------------------+
                        |        coach   (the nema agent)           |
                        |  chat  |  iframe  |  token clipboard @tN  |
                        +---+-----------------------------+---------+
                            |                             |
             tool calls     |                             |    tool calls
             over WebMCP    |                             |    over WebMCP
             exposedTo:     |                             |    exposedTo:
             coach origin   |                             |    coach origin
                            v                             v
        +-------------------+--------+     +--------------+-----------------+
        |  vault      (learner)      |     |  provider  (Saucier School or  |
        |                            |     |             Line Cook Lab)     |
        |                            |     |                                |
        |  evidence ledger (signed)  |     |  LearningManifest              |
        |  derived bands per ability |     |  activities + graders          |
        |  disclosure ledger         |     |  issuer key (in the Worker)    |
        |  consent modal (human)     |     |  answers typed by the human    |
        +----------------------------+     +--------------------------------+

   objects on the wire, all carried by the agent as short strings

     provider  --  LearningManifest ------------------->  agent
     provider  --  ReadinessRequest -------------------->  vault
        vault  ==  ReadinessAssertion  (signed, audience bound, 30 min)  ==>  provider
     provider  ==  EvidenceReceipt     (signed by issuer key)            ==>  vault
        vault  --  LearningNeed  (rubric attached) ------>  agent  -->  the learner

     ==  signed compact token:  nema1.<b64url payload>.<b64url signature>
     --  plain JSON tool result
```

The vault never sends history. The provider never reads the vault. The agent
never writes state.

## Quick start

Node 20 or later and wrangler 4. No dependencies to install beyond wrangler.

```bash
npm install          # wrangler only
npm test             # node --test "test/**/*.test.js"
npm run build        # dist/<app> = apps/<app>/public + shared
npm run dev          # five wrangler dev servers, ports below
```

Run the tests through `npm test`. `node --test test/` is not equivalent on
Node 22 and later: it treats the directory argument as a single test file and
fails. If you want the raw runner, use `node --test "test/**/*.test.js"` or
`node --test test/*.test.js`.

| App | Dev port |
|---|---|
| site | http://localhost:8780 |
| vault | http://localhost:8781 |
| harness (Saucier School) | http://localhost:8782 |
| security (Line Cook Lab) | http://localhost:8783 |
| coach | http://localhost:8784 |

For native WebMCP, open Chrome 149 or later, go to
`chrome://flags/#enable-webmcp-testing`, set it to Enabled and restart. In
ChatGPT desktop's in-app browser, WebMCP is on by default. In any other browser
the Chrome Labs polyfill takes over and everything still works; the header pill
on each page tells you which path is live and how many tools are registered.

`npm run seed` re-signs the demo learner fixture. It needs
`secrets/issuer-private-keys.json`, which is gitignored, so it is only useful if
you generate your own keys.

## Repo layout

```
nema/
  docs/
    CONTRACT.md        the implementation contract every module codes against
    PHILOSOPHY.md      why learning state belongs to the learner
    SPEC.md            protocol 0.1: objects, tokens, verification, inference
    THREAT_MODEL.md    threats, mitigations, and the honest limits of this demo
    JUDGE_GUIDE.md     seven step walkthrough, what to break, real vs simulated
    DEVPOST.md         submission text
    VIDEO_SCRIPT.md    2:55 shot list
  shared/
    crypto.js          ECDSA P-256, base64url, sha256, compact tokens
    protocol.js        object builders, validators, token encode and verify
    inference.js       derive bands from receipts, compute learning needs
    webmcp.js          registerTool helper, tool activity events, live indicator
    webmcp-polyfill.js Chrome Labs polyfill (Apache-2.0)
    concepts.json      the nema: concept registry
    issuers.json       trusted issuer public keys
    origins.json       app origins, prod and dev
    brand/             tokens.css, brand.css, self-hosted fonts, wordmark, mark
  apps/
    site/              the hub and the presentation
    vault/             the learner's vault, 9 tools + 1 declarative form
    harness/           provider 1, Saucier School, "Pan Sauces and Emulsions", 5 tools + Worker
    security/          provider 2, Line Cook Lab, "Service Under Pressure", 5 tools + Worker
    coach/             the agent page, chat + iframe + token clipboard
  scripts/             build.sh, dev.sh, deploy.sh, make-seed.mjs
  test/                crypto, protocol, inference, graders
```

One naming note, because it trips people up on first read. The two provider
apps live in `apps/harness` and `apps/security`, and the same two keys name
them in `shared/origins.json`, in `ORIGINS.harness` and `ORIGINS.security`, and
in the dev port table above. Those are internal identifiers, frozen so the
build, the deploy script and the tests do not churn. What the learner sees is
the provider's public identity: `apps/harness` is **Saucier School** at
https://saucier.migarci2.dev, and `apps/security` is **Line Cook Lab** at
https://linecook.migarci2.dev. Every name, unit and concept in the two example
courses is about cooking. The courses are examples of the protocol, not
descriptions of nema itself.

## Two identities on purpose

nema is a hub, a vault and a coach. It is not a course catalogue. So the two
example providers do not wear nema's brand: they re-theme the shared components
in their own `app.css`, render their own header and wordmark, and carry one
discreet "Works with nema" badge that links back to the hub. Saucier School is
warm paper and a serif, a well made course site. Line Cook Lab is near black
and monospace, an ops tool for the pass. A judge should be able to tell at a
glance which surface belongs to the learner and which two are just the web.

## WebMCP integration

Every page loads the polyfill as a classic script in `<head>`, before any module
script, then registers tools with `document.modelContext.registerTool` exactly
as Chrome documents it. Here is a real one, from the vault:

```js
await document.modelContext.registerTool({
  name: 'stage_evidence_receipt',
  description:
    'Verify a signed nema evidence receipt and add it to the vault ledger. ' +
    'Shows the receipt in the evidence ledger and animates the learner state ' +
    'rows that changed. Returns the accepted claims and the band changes, or ' +
    'a rejection reason. Only bands are returned. Evidence history never ' +
    'leaves the vault.',
  inputSchema: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Compact receipt token starting with nema1.' }
    },
    required: ['token'],
    additionalProperties: false
  },
  async execute({ token }) {
    const res = await verifyReceipt(token, ISSUERS, { seenReceiptIds: seenIds() });
    if (!res.ok && res.reason === 'unknown-issuer') {
      storePending(token, res.payload);
      return { status: 'pending', reason: 'unknown-issuer' };
    }
    if (!res.ok) return { status: 'rejected', reason: res.reason };
    const { changes, reviewsScheduled } = applyReceipt(res.payload, token);
    return {
      status: 'accepted',
      receiptId: res.payload.receiptId,
      issuer: res.payload.issuer,
      issuerName: issuerName(res.payload.keyId),
      activity: res.payload.activity,
      claims: res.payload.claims,
      changes,
      reviewsScheduled
    };
  }
});
```

Registration goes through `shared/webmcp.js`, which adds `exposedTo`
scoping, catches errors into `{ error }` results instead of throwing, and
dispatches a `nema:toolcall` event so every page can show a tool activity strip.
The declarative form is demonstrated too: the vault exposes
`<form toolname="set_learning_goal_form">` and the site exposes
`<form toolname="open_app">`.

The coach embeds provider pages with `allow="tools <origin>"` and discovers
their tools with `document.modelContext.getTools({ fromOrigins: [origin] })` on
load and on `toolchange`.

## Tool catalogs

**Vault**, 9 imperative tools. `get_vault_summary`, `get_learner_state`,
`set_learning_goal`, `create_readiness_assertion`, `stage_evidence_receipt`,
`get_learning_needs`, `record_agent_assessment`, `get_disclosure_ledger`,
`get_evidence_ledger`. Plus the declarative form `set_learning_goal_form`, so
`document.modelContext.getTools()` on the vault returns ten.

**Providers**, 5 tools each. `describe_learning_offer`,
`personalize_learning_path` (Saucier School) or `check_prerequisites` (Line
Cook Lab),
`start_activity`, `get_attempt_status`, `issue_evidence_receipt`.

**Site**, 1 imperative plus 1 declarative. `explain_nema`, `open_app`.

Full input and output shapes are in [`docs/SPEC.md`](docs/SPEC.md), sections 7
and 8.

### Tools that do not exist

This list is part of the design, not an omission.

| name | why not |
|---|---|
| `set_mastery` | state is derived from signed evidence, never written |
| `get_full_history` | disclosure is per request and per audience, never bulk |
| `submit_answer_for_learner` | only the human answers, and grading runs server side |
| `disable_review` | the schedule is a property of the evidence, not a setting |
| `export_vault` | export is a button a human clicks, not an agent capability |

Verify it yourself: open any nema page and call
`await document.modelContext.getTools()`.

## Privacy and security

- **Minimal disclosure.** A `ReadinessAssertion` carries only the concepts that
  were requested, as bands, plus an audience, a purpose, a request hash and an
  expiry. No history, no scores, no other subjects, no review schedule.
- **Human gate.** `create_readiness_assertion` blocks on a consent modal that
  lists what is shared and what is withheld. Deny returns `{ status: 'denied' }`
  and writes nothing.
- **Audience binding.** Assertions are valid at one origin for 30 minutes. Reuse
  elsewhere fails with `wrong-audience`; late use fails with `expired`.
- **Per audience identity.** `learnerKeyId` is derived from the vault key and
  the audience, so two providers see different ids for the same learner.
- **Signed evidence only.** Receipts are ECDSA P-256 signed by an issuer in
  `shared/issuers.json`, deduplicated by `receiptId`. An unknown issuer lands in
  the ledger as `pending` and changes nothing, visibly.
- **Derived state.** Bands are recomputed from the ledger on every read, so
  everything the vault shows can be reproduced from the receipts.
- **Keys stay put.** Providers sign in the Worker. No issuer private key is ever
  sent to a browser.

Honest limits, including provider answer keys being visible in devtools and the
vault key living in `localStorage`, are written up in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), section 4.

## License

MIT. See [`LICENSE`](LICENSE).

## Credits

- WebMCP polyfill by Chrome Labs, Apache-2.0. Vendored at
  `shared/webmcp-polyfill.js` with its license header intact.
- Fonts, all SIL Open Font License and self-hosted: Pixelify Sans, Inter,
  JetBrains Mono.
- Everything else in this repository is original work by the author, MIT
  licensed.

---

Built for **The WebMCP Challenge**. Everything here was created during the
submission period, 25 August to 3 September 2026; the commit history is the
evidence. No prior work was reused, apart from the two third party items
credited above.

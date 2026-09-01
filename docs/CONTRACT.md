# nema: implementation contract

This file is the single source of truth for every module in the repo. All
agents code against it. If you must deviate, add a `CONTRACT DEVIATION:` line
in your final report with the reason, and keep the public interface stable.

Read `PLAN.md` for the hackathon context and the product story. Read
`docs/PHILOSOPHY.md` (if present) for tone.

## 0. Non-negotiables

- Plain HTML + CSS + ES modules. No frameworks, no bundlers, no TypeScript.
  The only "build" is `scripts/build.sh` copying files into `dist/`.
- Every page loads `/shared/webmcp-polyfill.js` as a classic script in
  `<head>` BEFORE any module script. Tools are registered with
  `document.modelContext.registerTool(...)` exactly as Chrome documents it.
- English UI copy. No emojis anywhere (UI, code, docs, commit messages). No em
  dashes in any copy; use a comma, colon, or period.
- Brand: dark navy ground, cyan accents, pixel wordmark, discreet. See section 2.
- Every tool call must change something visible in the page. Judges watch the
  screen, not the console.
- The agent never answers for the learner, never writes mastery, never
  fabricates evidence. Tools must make that structurally impossible.
- Vault data never leaves the vault except inside a signed, audience-bound
  `ReadinessAssertion` the learner approved.
- Shared modules are imported with absolute paths: `/shared/crypto.js`,
  `/shared/brand/tokens.css`, etc. `scripts/build.sh` copies `shared/` into
  every `dist/<app>/shared/`.

## 1. Repo layout

```
nema/
  PLAN.md
  README.md                  hackathon submission text + run instructions
  LICENSE                    MIT
  package.json               scripts: test, build, dev, deploy, seed
  docs/
    CONTRACT.md              this file
    PHILOSOPHY.md            why nema exists, in plain language
    SPEC.md                  protocol objects, tokens, verification rules
    THREAT_MODEL.md          threats and mitigations, including demo limits
    JUDGE_GUIDE.md           3 minute walkthrough for judges, URLs, what to click
    DEVPOST.md               the 4 required answers + tagline + tags
    VIDEO_SCRIPT.md          shot list with timings and on-screen text
  shared/
    origins.json             app origins (prod + dev)
    origins.js               `export const ORIGINS` resolved for the current host
    issuers.json             trusted issuer public keys (JWK) by id
    concepts.json            canonical concept registry (nema:*)
    crypto.js                ECDSA P-256, base64url, sha256, compact tokens
    protocol.js              object builders, validators, token encode/verify
    inference.js             learner model derivation + learning needs
    webmcp.js                registerTools helper + "tools live" indicator
    webmcp-polyfill.js       Chrome Labs polyfill (Apache-2.0 header kept)
    brand/
      tokens.css             colors, type, spacing, radii, shadows
      brand.css              components (panel, button, pill, ledger, ring, ...)
      fonts/                 self-hosted woff2 (Pixelify Sans, Inter, JetBrains Mono)
      mark.svg               hex mark
      wordmark.svg           pixel wordmark
      favicon.svg
      brand.js               `injectHeader()`, `mountToolsIndicator()`, helpers
  apps/
    site/      public/index.html ...        static, the hub + presentation
    vault/     public/index.html app.js ... static
    harness/   public/... content.js worker.js wrangler.jsonc
    security/  public/... content.js worker.js wrangler.jsonc
    coach/     public/... worker.js wrangler.jsonc
  scripts/
    build.sh                 dist/<app>/ = apps/<app>/public/* + shared/
    dev.sh                   runs wrangler dev for all five apps on fixed ports
    deploy.sh                build + wrangler deploy for all five
    make-seed.mjs            signs shared/seed-evidence.json into apps/vault/public/seed.json
  test/
    crypto.test.js protocol.test.js inference.test.js graders.test.js
  secrets/                   gitignored. issuer-private-keys.json lives here.
```

Ports (dev): site 8780, vault 8781, harness 8782, security 8783, coach 8784.
Origins (prod): see `shared/origins.json`. Workers named `nema`, `nema-vault`,
`nema-harness`, `nema-security`, `nema-coach`, each with a custom domain on
`migarci2.dev` (single level, so Universal SSL covers it).

`shared/origins.js`:

```js
import origins from './origins.json' with { type: 'json' };
// Chrome supports JSON import attributes since 123. Fallback: fetch. Keep it simple:
export const ORIGINS = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? origins.dev : origins.prod;
export const APP = Object.entries(ORIGINS).find(([, o]) => o === location.origin)?.[0] ?? null;
```

If JSON import attributes cause trouble, inline the object in `origins.js`
and keep `origins.json` as the documented copy. Either way the export is
`ORIGINS` and `APP`.

## 2. Brand

Reference: the brand board the user provided. Pixel wordmark "nema" in white
on deep navy, tagline in cyan monospace, hexagonal mark with square nodes on
the vertices (gradient cyan to electric blue, one yellow node at the bottom)
and a pixel "n" in the center. Panels with thin borders and corner ticks.
Section labels in monospace uppercase with a two digit index ("01 WORDMARK").

Palette (exact):

| token | hex | use |
|---|---|---|
| `--navy` | `#0B1320` | page ground |
| `--navy-2` | `#101B2D` | panel ground |
| `--navy-3` | `#16233A` | raised / hover |
| `--line` | `#1E3050` | borders, dividers |
| `--cyan` | `#00E5FF` | primary accent, verified, focus |
| `--teal` | `#15C4B4` | usable, success |
| `--blue` | `#3A78FF` | fragile, links, secondary |
| `--sky` | `#A2CCFF` | uncertain, muted text on dark |
| `--yellow` | `#FFCA2E` | attention: review due, pending, new |
| `--ink` | `#F2F6FF` | primary text |
| `--ink-2` | `#9FB0CC` | secondary text |
| `--ink-3` | `#5E7095` | tertiary / labels |
| `--danger` | `#FF5C7A` | denied, failed, invalid signature |

State band colors (used identically in all apps):

| band | color |
|---|---|
| durable | cyan |
| usable | teal |
| fragile | blue |
| uncertain | sky |
| unknown | ink-3 (grey) |
| review due / pending | yellow |
| failed / invalid | danger |

Type:

- Display / wordmark: `Pixelify Sans` (OFL, self-hosted woff2). Only for the
  wordmark, hero numbers and section titles. Never for body.
- UI / body: `Inter` (OFL, self-hosted, weights 400/500/600).
- Labels, tokens, code, ledger ids: `JetBrains Mono` (OFL, self-hosted, 400/500).

Layout language: 8 px grid. Panels: 1 px `--line` border, `--navy-2` fill,
4 px radius, corner ticks drawn with pseudo elements (6 px, `--cyan` at 60%).
Buttons: primary = cyan fill, navy text, pixel-ish 2 px radius; secondary =
transparent with `--line` border; danger only for destructive actions.
Focus ring: 2 px cyan outline, offset 2 px. Motion: 120 to 180 ms ease-out,
respect `prefers-reduced-motion`. Density: compact, monospace numerics with
`font-variant-numeric: tabular-nums`.

Every page has the same header from `brand.js: injectHeader({app, title})`:
mark + wordmark on the left, app name in mono on the right, and a "tools"
indicator pill that turns cyan when `document.modelContext` has registered
tools (count shown). Footer: "nema protocol 0.1", link to the hub, link to the
repo.

## 3. Protocol vocabulary

Concept ids: `nema:<kebab>` from `shared/concepts.json`.

Abilities (ordered ladder, plus one side ability):

```
recognize < retrieve < explain < apply < transfer
discriminate (side ability, not on the ladder)
```

Evidence types: `recognition`, `retrieval`, `explanation`, `application`,
`transfer`, `discrimination`.

Results: `passed`, `partial`, `failed`.

Grader types and evidence weights (the vault owns these numbers):

| grader | weight |
|---|---|
| `deterministic` | 1.0 |
| `provider-rubric` | 0.8 |
| `agent-assessed` | 0.6 |
| `self-report` | 0.3 |
| `exposure` | 0.1 |

Learner state bands per (concept, ability): `unknown`, `uncertain`,
`fragile`, `usable`, `durable`.

Assertion status bands (what providers see): `verified` (usable or durable),
`uncertain` (fragile or uncertain), `missing` (unknown). Confidence:
`high`, `medium`, `low`.

## 4. `shared/crypto.js`

```js
export const b64url = { encode(bytes|string) -> string, decode(string) -> Uint8Array, decodeToString(string) -> string };
export async function sha256(input: string|Uint8Array) -> string  // "sha256:" + hex
export async function generateKeyPair() -> { publicJwk, privateJwk }   // ECDSA P-256, exportable
export async function importPublicKey(jwk) -> CryptoKey
export async function importPrivateKey(jwk) -> CryptoKey
export async function sign(privateJwk, payloadString) -> string        // b64url of raw r||s
export async function verify(publicJwk, payloadString, sigB64url) -> boolean
export function randomId(prefix, n = 12) -> string                      // prefix + "_" + n b64url chars
export function nowIso() -> string
```

Works in browsers and in Node 20+ and Workers (uses `globalThis.crypto`).
No dependencies.

## 5. `shared/protocol.js`

Compact token format (all signed objects):

```
nema1.<b64url(payloadJson)>.<b64url(signature)>
```

Signature is ECDSA P-256 / SHA-256 over the UTF-8 bytes of the exact payload
JSON string. Payload JSON is produced by `JSON.stringify(payload)` with keys
in the order the builders below produce them. Verification never
re-serializes: it verifies the decoded payload string as transmitted.

```js
export const PROTOCOL = 'nema/0.1';
export function encodeToken(payloadObj, signatureB64url) -> string
export function decodeToken(token) -> { payload, payloadString, signature }   // throws on malformed
export async function signToken(payloadObj, privateJwk) -> string
export async function verifyToken(token, publicJwk) -> { ok: boolean, payload, reason? }
```

### 5.1 LearningManifest (unsigned, returned by providers)

```json
{
  "protocol": "nema/0.1",
  "provider": { "origin": "https://nema-harness.migarci2.dev", "name": "Harness Engineering Lab", "keyId": "harness-2026-09" },
  "unit": { "id": "agent-evals-foundations", "version": "1.0.0", "title": "Designing Agent Evals", "estimatedMinutes": 68, "language": "en", "price": "free" },
  "outcomes": [ { "concept": "nema:agent-evals", "ability": "apply" } ],
  "requirements": [ { "concept": "nema:software-testing", "ability": "apply" } ],
  "activities": [
    { "id": "eval-design-lab", "type": "interactive-lab", "title": "Fix the broken harness", "minutes": 18,
      "evidenceProduced": "application", "grader": "deterministic",
      "outcomes": [ { "concept": "nema:agent-evals", "ability": "apply" } ],
      "skipIf": [] }
  ]
}
```

Activity `type`: `lesson`, `diagnostic`, `interactive-lab`, `free-recall`.
`skipIf`: list of `{concept, ability, status}`; the activity is skipped when
every entry is satisfied by the assertion (status `verified` satisfies
`verified`; `verified` or `uncertain` satisfies `uncertain`). `onlyIf` (optional,
same shape) includes an activity only when every entry matches exactly
(used for diagnostics that only make sense when a requirement is `uncertain`).

### 5.2 ReadinessRequest (unsigned, provider to vault, carried by the agent)

```json
{ "protocol": "nema/0.1", "audience": "https://nema-harness.migarci2.dev",
  "purpose": "personalize-agent-evals-path",
  "requirements": [ { "concept": "nema:software-testing", "ability": "apply" } ] }
```

`requestHash = sha256(JSON.stringify(request))`.

### 5.3 ReadinessAssertion (signed by the vault)

```json
{
  "type": "readiness-assertion", "protocol": "nema/0.1",
  "audience": "https://nema-harness.migarci2.dev",
  "purpose": "personalize-agent-evals-path",
  "requestHash": "sha256:...",
  "learnerKeyId": "lk_...",
  "assertions": [ { "concept": "nema:software-testing", "ability": "apply", "status": "verified", "confidence": "high" } ],
  "issuedAt": "2026-09-02T10:00:00Z",
  "expiresAt": "2026-09-02T10:30:00Z",
  "vaultKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
}
```

- Self-certifying: verifier uses the embedded `vaultKey`.
- `learnerKeyId = "lk_" + b64url(sha256bytes(vaultKey.x + "|" + audience)).slice(0, 16)`
  so two providers see different ids for the same learner.
- Provider verification (`verifyAssertion(token, {audience})`): signature ok,
  `type` ok, `audience === own origin`, `expiresAt > now`. Returns
  `{ ok, payload, reason }`. Reasons: `bad-signature`, `wrong-audience`,
  `expired`, `malformed`.
- Nothing else is ever included. No history, no dates of study, no other
  concepts.

### 5.4 EvidenceReceipt (signed by a provider)

```json
{
  "type": "evidence-receipt", "protocol": "nema/0.1",
  "receiptId": "rcpt_...",
  "issuer": "https://nema-harness.migarci2.dev",
  "keyId": "harness-2026-09",
  "subject": "lk_...",
  "activity": { "id": "eval-design-lab", "version": "1.0.0", "title": "Fix the broken harness", "contentHash": "sha256:..." },
  "claims": [
    { "concept": "nema:agent-evals", "ability": "apply", "evidenceType": "application", "result": "passed", "difficulty": "intermediate" }
  ],
  "conditions": { "attempts": 2, "hintsUsed": 1, "durationSeconds": 641, "grader": "deterministic", "graderVersion": "1" },
  "issuedAt": "2026-09-02T10:41:12Z"
}
```

- Vault verification (`verifyReceipt(token, issuers)`): find
  `issuers[payload.keyId]` whose `origin === payload.issuer`; verify signature;
  reject duplicates by `receiptId`. Unknown `keyId` yields `{ ok: false,
  reason: 'unknown-issuer' }`; the vault stores it as `pending` and never
  updates state from it.
- Providers only ever issue receipts for activities the grader marked
  `passed` or `partial`. A `failed` result may be issued too (it is honest
  evidence) but the demo providers only issue on pass.

### 5.5 LearningNeed (unsigned, produced by the vault)

```json
{
  "needId": "need_...",
  "concept": "nema:agent-evals", "ability": "discriminate",
  "kind": "discriminate",
  "reason": ["application_is_strong", "no_discrimination_evidence", "active_goal_depends_on_this_concept"],
  "urgency": 0.87, "minutes": 4,
  "confusableWith": "nema:unit-testing",
  "exerciseHint": "compare-and-contrast with one concrete failure case",
  "rubric": [
    "distinguishes deterministic function checks from task level agent evaluation",
    "mentions end to end behaviour",
    "gives one example where unit tests pass but the agent fails"
  ],
  "constraints": { "maxHints": 1, "doNotRevealAnswerBeforeSubmission": true }
}
```

Kinds: `acquire`, `retrieve`, `apply`, `transfer`, `discriminate`,
`repair_misconception`, `reassess`.

### 5.6 `shared/issuers.json`

```json
{ "harness": { "kid": "harness-2026-09", "jwk": {...} }, "security": {...}, "seed": {...} }
```

`protocol.js` exports `loadIssuers()` returning a map `keyId -> { origin, jwk, name }`
by joining `issuers.json` with `origins.json` (`seed` maps to origin
`urn:nema:seed` and name "nema demo seed"). Private keys live in
`secrets/issuer-private-keys.json` (gitignored) and, for deployed workers, in
the secret `ISSUER_PRIVATE_JWK` (a JSON string).

## 6. `shared/concepts.json`

Array of 28 to 34 concepts in the agentic engineering domain. Shape:

```json
{
  "id": "nema:agent-evals",
  "title": "Agent evals",
  "summary": "Task level evaluation of an agent's end to end behaviour, as opposed to unit tests of its functions.",
  "prereqs": ["nema:software-testing", "nema:agent-loop"],
  "confusableWith": ["nema:unit-testing"],
  "misconceptions": [ { "id": "unit_tests_are_equivalent_to_agent_evals", "text": "If the unit tests pass, the agent works." } ],
  "rubric": {
    "explain": ["..."],
    "apply": ["..."],
    "discriminate": ["..."]
  },
  "minutes": { "retrieve": 3, "explain": 4, "apply": 6, "discriminate": 4 },
  "aliases": { "harness": "agent-evaluation", "security": "agent-evals" }
}
```

Required ids (the apps depend on these exact ids):

```
nema:software-testing   nema:unit-testing      nema:json-schema
nema:tool-calling       nema:agent-loop        nema:context-design
nema:feedforward        nema:feedback-loops    nema:deterministic-verification
nema:agent-evals        nema:observability     nema:recovery
nema:permission-boundaries  nema:harness-iteration  nema:threat-modeling
nema:prompt-injection   nema:least-privilege   nema:sandboxing
nema:tool-interface-design  nema:state-management  nema:retrieval-augmentation
nema:memory-design      nema:cost-latency      nema:human-in-the-loop
nema:acceptance-criteria  nema:trace-analysis  nema:failure-taxonomy
nema:rubric-grading     nema:attack-surface    nema:output-validation
```

## 7. `shared/inference.js` (vault brain, pure functions, unit tested)

```js
export const ABILITY_LADDER = ['recognize','retrieve','explain','apply','transfer'];
export const WEIGHTS = { deterministic: 1, 'provider-rubric': 0.8, 'agent-assessed': 0.6, 'self-report': 0.3, exposure: 0.1 };
export function deriveState(receipts, { now }) -> { [concept]: { [ability]: { band, score, confidence, lastSuccess, stabilityDays, nextReview, evidenceRefs[] } } }
export function toAssertionStatus(band) -> 'verified' | 'uncertain' | 'missing'
export function bandToConfidence(band, score) -> 'high' | 'medium' | 'low'
export function diffStates(before, after) -> [{ concept, ability, from, to }]
export function computeNeeds(state, { concepts, goals, misconceptions, now, budgetMinutes }) -> LearningNeed[]
export function summarize(state, { now }) -> { concepts, durable, usable, fragile, uncertain, unknown, reviewsDue }
```

Scoring (documented in SPEC.md, keep it this simple):

- A claim contributes to its own ability and to every lower ability on the
  ladder. `discriminate` claims contribute only to `discriminate`.
- `value = weight(grader) * resultValue * recency`, with `resultValue` passed 1,
  partial 0.5, failed -0.5, and `recency = exp(-daysSince / 60)`.
- `score = sum(values)`. Bands: `>= 1.6 durable`, `>= 0.9 usable`,
  `>= 0.4 fragile`, `> 0 uncertain`, else `unknown`.
- Memory: `passes` = count of passed claims for that ability or higher;
  `stabilityDays = min(60, 3 * 2 ** (passes - 1))`; `nextReview = lastSuccess + stabilityDays`.
  A failed claim after a success resets `stabilityDays` to 3. `reviewDue = nextReview < now`.
- Confidence: high if score >= 1.2 and the best grader weight >= 0.8;
  medium if score >= 0.6; else low.

Needs:

- `retrieve`: reviewDue for any ability >= retrieve. urgency 0.6 + 0.4 * overdueDays/7 (cap 1).
- `apply`: explain band >= usable and apply band <= fragile. urgency 0.7.
- `discriminate`: concept has `confusableWith`, apply or explain >= usable, no discrimination evidence. urgency 0.65.
- `acquire`: a goal lists the concept (or a goal concept's prereq) and every ability is unknown. urgency 0.5.
- `repair_misconception`: vault has a recorded misconception for the concept. urgency 0.8.
- `reassess`: evidence exists but the best grader weight < 0.6. urgency 0.45.
- `transfer`: apply durable, transfer unknown. urgency 0.35.
- `goalRelevance` = 1.5 if the concept is in an active goal, 1.2 if it is a prereq of a goal concept, else 1.
- `priority = urgency * goalRelevance / max(2, minutes)`; sort desc; when
  `budgetMinutes` is given, greedily fill the budget.
- Each need copies `rubric[kind or ability]` from concepts.json and `minutes` from
  `concept.minutes[ability]` (default 4).

## 8. `shared/webmcp.js`

```js
export async function registerTools(tools, { exposedTo = [] } = {})
// tools: [{ name, description, inputSchema, execute, annotations? }]
// Registers each with document.modelContext.registerTool(tool, { exposedTo }) when native,
// or without options when polyfilled (polyfill ignores options). Logs one line per tool.
// Wraps execute: parses string args, catches errors, returns { error: message } instead of throwing,
// dispatches a CustomEvent('nema:toolcall', { detail: { name, args, result, ms } }) on document
// so the UI can show a "tool activity" strip.
export function isNative() -> boolean          // true when the polyfill did not install
export async function toolCount() -> number
```

Tool names: `snake_case`, ASCII only, under 40 chars. Descriptions: one or two
sentences, imperative, say what the tool changes on screen and what it
returns, and name any human step ("The learner must approve in the page").
Every `inputSchema` has `type: 'object'`, `properties`, `required`, and
`additionalProperties: false`. Return values are plain JSON objects (never
strings) with a `status` field.

`exposedTo` for every app: `[ORIGINS.coach]`. In dev also include
`http://localhost:8784`.

## 9. Vault (`apps/vault`)

Static. Storage: `localStorage` key `nema.vault.v1` holding one JSON document:

```json
{ "version": 1, "vaultKey": { "publicJwk": {}, "privateJwk": {} },
  "receipts": [ { "receiptId": "...", "token": "nema1...", "payload": {}, "status": "verified|pending", "receivedAt": "...", "effect": [] } ],
  "disclosures": [ { "audience": "", "purpose": "", "requestHash": "", "sharedAt": "", "expiresAt": "", "shared": [], "withheld": ["attempt history","exact scores","other subjects","misconceptions","review schedule","provider history"] } ],
  "goals": [ { "goalId": "", "title": "", "concepts": [], "createdAt": "" } ],
  "misconceptions": [ { "concept": "", "id": "", "text": "", "recordedAt": "" } ],
  "settings": { "autoApprove": {} } }
```

Learner state is never stored; it is derived with `deriveState` on every
read. Export / import as a JSON file (buttons in the UI). "Load demo learner"
imports `/seed.json` (signed by the `seed` issuer, visible in the ledger as
"nema demo seed"). "Reset vault" wipes storage after a confirm.

Screens (single page, sections):

1. Header + summary strip: concepts tracked, durable, usable, fragile,
   reviews due. Big numbers in Pixelify Sans.
2. Learning graph panel: concepts as square nodes colored by best band,
   prerequisite edges. SVG, deterministic layout (grouped by prereq depth in
   columns), hover shows title and bands. No physics.
3. Learner state table: concept, per-ability band pills, next review.
4. Needs panel: "Best session for N minutes" with a minutes input and the
   ordered list from `computeNeeds`.
5. Disclosure ledger and Evidence ledger panels.
6. Consent modal: appears when `create_readiness_assertion` runs. Shows
   audience, purpose, the exact list to be shared with status bands, the
   fixed "Not shared" list, expiry, and Approve / Deny buttons plus an
   "Auto approve this provider for 1 hour" checkbox.
7. Tool activity strip at the bottom: last 8 tool calls with name, ms, status.
8. Manual token inbox: textarea + "Stage receipt" button, for pasting a
   receipt by hand. Same code path as the tool.

Tools (all in `apps/vault/public/tools.js`):

| name | input | returns |
|---|---|---|
| `get_vault_summary` | `{}` | `{ status:'ok', concepts, durable, usable, fragile, uncertain, reviewsDue, goals:[{goalId,title}], receipts, pendingReceipts, disclosures }` |
| `get_learner_state` | `{ concepts?: string[] }` | `{ status:'ok', state: [{ concept, title, bands: { ability: band }, nextReview, reviewDue }] }` (bands only, never evidence) |
| `set_learning_goal` | `{ title: string, concepts: string[] }` | `{ status:'ok', goalId }` (also exposed declaratively as a `<form toolname="set_learning_goal">` so both APIs are demonstrated; the imperative one is the canonical registration, so name the declarative form `set_learning_goal_form` to avoid a duplicate name) |
| `create_readiness_assertion` | `{ audience: string, purpose: string, requirements: [{concept, ability}] }` | approved: `{ status:'approved', token, expiresAt, shared:[{concept,ability,status}], withheld:[...] }`; denied: `{ status:'denied' }`; timeout after 120 s: `{ status:'timeout', hint }` |
| `stage_evidence_receipt` | `{ token: string }` | `{ status:'accepted', receiptId, issuer, issuerName, activity, claims, changes:[{concept,ability,from,to}], reviewsScheduled:[{concept, nextReview}] }` or `{ status:'pending', reason:'unknown-issuer' }` or `{ status:'rejected', reason }` (reasons: `bad-signature`, `duplicate`, `malformed`) |
| `get_learning_needs` | `{ budgetMinutes?: number }` | `{ status:'ok', budgetMinutes, needs: LearningNeed[] }` |
| `record_agent_assessment` | `{ needId: string, rubricResults: [{ criterion: string, met: boolean }], learnerAnswerSummary: string }` | `{ status:'accepted', receiptId, result, changes }`. Creates a receipt with `grader: 'agent-assessed'`, `issuer: ORIGINS.coach or 'urn:nema:agent'`, `keyId: 'agent'`, unsigned but stored with status `verified` and a visible "agent assessed" badge; result passed if all met, partial if >= half, failed otherwise. Rejects unknown needIds. |
| `get_disclosure_ledger` | `{}` | `{ status:'ok', disclosures:[...] }` |
| `get_evidence_ledger` | `{ limit?: number }` | `{ status:'ok', receipts:[{ receiptId, issuerName, activity, claims, grader, signature:'verified'|'pending'|'agent', receivedAt, effect }] }` |

Tools that must not exist (also listed in README): `set_mastery`,
`get_full_history`, `submit_answer_for_learner`, `disable_review`,
`export_vault`.

Tool descriptions must state: "Only bands are returned. Evidence history never
leaves the vault." and for the assertion tool: "The learner must approve the
disclosure in the page before a token is returned."

## 10. Providers (`apps/harness`, `apps/security`)

Each provider has `public/content.js` (ESM, imported by browser and worker):

```js
export const MANIFEST = { ... LearningManifest ... };
export const ACTIVITIES = { [id]: { id, version, title, type, minutes, intro, body (HTML string or structured), questions/steps, answerKey, hints[], outcomes[], evidenceProduced, difficulty } };
export function grade(activityId, submission) -> { result: 'passed'|'partial'|'failed', score: 0..1, feedback: string[], claims: [...] }
export const CONTENT_HASH_INPUT = JSON.stringify(ACTIVITIES)  // used for activity.contentHash
```

`worker.js` (module Worker, `assets.run_worker_first: ["/api/*"]`):

- `POST /api/receipt` body `{ activityId, submission, learnerKeyId, conditions }`.
  Re-grades with `grade()`; if `failed`, returns 422 `{ status:'not-passed' }`.
  Otherwise builds the EvidenceReceipt (issuer = request origin's app origin
  from `ORIGINS`, keyId from the secret's `kid`, `contentHash = sha256(CONTENT_HASH_INPUT)`),
  signs with `env.ISSUER_PRIVATE_JWK`, returns `{ status:'issued', token, payload }`.
- `GET /api/manifest` returns `MANIFEST` (handy for judges and curl).
- Everything else falls through to assets.
- In `wrangler dev`, the secret comes from `apps/<app>/.dev.vars`
  (`ISSUER_PRIVATE_JWK={"kid":...,"jwk":{...}}`), written by `scripts/dev.sh`
  from `secrets/issuer-private-keys.json`.

Browser state: `localStorage` key `nema.<app>.v1` with
`{ learnerKeyId, assertion: {payload, receivedAt}, path, attempts: { [activityId]: { status, attempts, hintsUsed, startedAt, finishedAt, submission, receiptToken } } }`.

Screens: header, unit hero (title, minutes, outcomes as pills, requirements
with status pills that fill in after personalization), path panel (full path
vs personal path, minutes, skipped items struck through with the reason),
activity stage (the current activity; lessons are short readable pages,
diagnostics and labs are forms with deterministic grading and instant
feedback; labs include a simulated "run" console with before and after), receipt
panel (token in a textarea with Copy button, decoded claims, "Send to vault"
link that opens the vault with `#receipt=<token>` in the hash, which the vault
reads on load and offers to stage), tool activity strip.

The learner types answers. The agent cannot: there is no tool that submits an
answer. `start_activity` only navigates.

Harness tools:

| name | input | returns |
|---|---|---|
| `describe_learning_offer` | `{}` | `{ status:'ok', manifest }` |
| `personalize_learning_path` | `{ assertionToken: string }` | `{ status:'personalized', learnerKeyId, requirements:[{concept,ability,status}], path:[{activityId,title,minutes,type,reason}], skipped:[{activityId,reason}], fullMinutes, personalMinutes }` or `{ status:'rejected', reason }` |
| `start_activity` | `{ activityId: string }` | `{ status:'started', activityId, title, type, minutes, whatTheLearnerDoes, note:'The learner completes this in the page. Poll get_attempt_status.' }` |
| `get_attempt_status` | `{ activityId: string }` | `{ status:'not_started'|'in_progress'|'passed'|'failed', attempts, hintsUsed, durationSeconds, feedback? }` |
| `issue_evidence_receipt` | `{ activityId: string }` | `{ status:'issued', token, claims, activity, hint:'Take this token to the vault and call stage_evidence_receipt.' }` or `{ status:'not-passed' }`. Idempotent: returns the stored token on repeat. |

Security tools: same shape with `check_prerequisites` instead of
`personalize_learning_path`:

| `check_prerequisites` | `{ assertionToken: string }` | `{ status:'checked', recognized:[{concept,ability,status,source:'readiness-assertion'}], unlocked:[activityId], locked:[{activityId, missing:[{concept,ability}]}], recommendedFirst: activityId, skippable:[activityId] }` |

Requirements and content:

Harness (unit `agent-evals-foundations`, "Designing Agent Evals"):
requirements `nema:software-testing.apply`, `nema:agent-loop.explain`,
`nema:json-schema.apply`. Full path 7 activities, about 68 minutes:

1. `agent-loop-primer` lesson 8 min, skipIf agent-loop.explain verified
2. `testing-refresher` lesson 10 min, skipIf software-testing.apply verified
3. `json-schema-diagnostic` diagnostic 4 min, onlyIf json-schema.apply uncertain; outcomes json-schema.apply; grader deterministic; one question with 4 options, learner picks the schema that rejects a bad payload
4. `json-schema-primer` lesson 9 min, skipIf json-schema.apply verified or uncertain
5. `eval-anatomy` lesson 9 min, always; exposure evidence only
6. `eval-design-lab` interactive-lab 18 min, always; outcomes agent-evals.apply, feedback-loops.discriminate; deterministic (multi-select of checks to add to a broken harness, at least the 3 required ones and none of the 2 harmful ones; plus ordering of the 3 stages); a simulated run console shows "unit tests pass / task fails" before and "task eval added / agent self-corrects / acceptance passes" after
7. `eval-retrieval` free-recall 10 min, optional; grader provider-rubric (keyword rubric, 3 criteria, learner types a paragraph); outcomes agent-evals.explain

With the seed vault (software-testing verified, agent-loop verified,
json-schema uncertain) the personal path is 3 + 5 + 6 + 7 = 27 minutes at
personalization time, then the diagnostic passes and the provider re-computes
to 5 + 6 + 7 = 21 minutes when a fresh assertion is presented. The diagnostic
receipt goes to the vault in between. Tune numbers so the story reads
68 -> 27 -> 21 exactly.

Security (unit `feedback-loop-attack-surface`, "Feedback Loop Attack Surface"):
requirements `nema:tool-calling.explain`, `nema:feedback-loops.explain`,
`nema:threat-modeling.apply`. Activities:

1. `tool-calling-intro` lesson 7 min, skipIf tool-calling.explain verified
2. `threat-modeling-intro` lesson 9 min, skipIf threat-modeling.apply verified
3. `feedback-loop-attack-surface` interactive-lab 12 min, locked until feedback-loops.explain is at least uncertain; outcomes attack-surface.apply, prompt-injection.discriminate; deterministic: the learner marks which of 6 tool results in a trace are untrusted and picks mitigations
4. `injection-triage-advanced` interactive-lab 14 min, locked until feedback-loops.explain >= uncertain AND threat-modeling.apply verified AND tool-calling.explain verified; outcomes prompt-injection.apply, output-validation.apply

The story beat: with the harness receipt in the vault, feedback-loops is
`uncertain` (fragile band), tool-calling and threat-modeling `verified`, so
both intros are skippable and the advanced lab is unlocked with
"Prerequisite recognised from another provider".

## 11. Coach (`apps/coach`)

The nema agent page. Layout: left column chat (messages, tool activity
inline, quick prompts), right column an iframe with a site switcher (Vault,
Harness Lab, Agent Security, custom URL) and a "token clipboard" panel.

- iframe `allow="tools <origin>"` and `src` from `ORIGINS`. Tools discovered
  with `document.modelContext.getTools({ fromOrigins: [origin] })` on iframe
  load and on `toolchange`.
- Chat loop: `POST /api/chat` with `{ system, messages, tools }` in a
  provider-neutral shape:
  - `messages`: `[{ role:'user'|'assistant', content: string }, { role:'assistant', toolCalls:[{id,name,arguments}] }, { role:'tool', toolCallId, name, content: string }]`
  - response: `{ text: string|null, toolCalls: [{ id, name, arguments: object }] }`
  - Worker adapts: Anthropic Messages API when `ANTHROPIC_API_KEY` is set
    (model id from the `claude-api` skill, tool use with `input_schema`), else
    Workers AI `@cf/openai/gpt-oss-120b` function calling via `env.AI`.
    Max 12 tool rounds per user turn.
- Token clipboard: any tool result containing a string that starts with
  `nema1.` is stored as `t1`, `t2`, ... and replaced in the model-facing tool
  result with `@t1`. Before executing a tool call, every string argument equal
  to `@tN` is expanded. The panel shows handles, type (receipt or assertion),
  audience or issuer, and expiry. This makes the broker robust to models that
  mangle long strings.
- System prompt (in `public/prompt.js`, exported so README can quote it):
  the agent is a broker; it never answers activities for the learner; it asks
  the learner to complete activities in the page and polls status; it explains
  disclosures before requesting them; it carries tokens by handle; it never
  claims evidence that no receipt supports; it is concise.
- Quick prompts: "Teach me to design agent evals", "Take my new receipt to the
  vault", "Can I start the advanced security lab?", "Build my best 5 minute
  review".
- A "Script" side sheet with the 7 demo steps and which site each happens on,
  so a judge can follow the golden path.

## 12. Site (`apps/site`)

The hub and the presentation. Static. Sections: hero (wordmark, tagline
"your learning state, everywhere.", one paragraph), the thesis in three
lines ("The web teaches. Your vault remembers. Your agent connects the two."),
how it works (4 protocol steps with the object names), live links (Vault,
Harness Lab, Agent Security, Coach), why WebMCP (short), privacy by design
(disclosure example), what is not possible (the forbidden tools list), for
judges (link to JUDGE_GUIDE), brand board page at `/brand.html` reproducing
the user's board with the real assets. Registers one tool
`explain_nema({ topic })` returning short doc text for topics
`overview|protocol|privacy|vault|providers|judges`, plus one declarative form
`<form toolname="open_app">` with a `<select name="app">` that navigates.

## 13. Scripts

- `scripts/build.sh`: `rm -rf dist; for app in site vault harness security coach: mkdir -p dist/$app; cp -r apps/$app/public/. dist/$app/; cp -r shared dist/$app/shared`.
- `scripts/dev.sh`: build, write `.dev.vars` for harness/security from secrets, then run five `wrangler dev --config apps/<app>/wrangler.jsonc --port <port>` in parallel (trap to kill all).
- `scripts/deploy.sh`: build, then `wrangler deploy --config` for each app. Secrets are put once with `wrangler secret put ISSUER_PRIVATE_JWK --config ...` (documented, not automated).
- `scripts/make-seed.mjs`: reads `shared/seed-evidence.json` (unsigned list of receipts to fabricate for the demo learner, with dates relative to a base date), signs each with the `seed` key from `secrets/`, writes `apps/vault/public/seed.json` `{ generatedAt, receipts: [token...] , goals: [...] }`.
- `wrangler.jsonc` per app: `name`, `compatibility_date: "2026-08-01"`, `assets: { directory: "../../dist/<app>", binding: "ASSETS", run_worker_first: ["/api/*"] }` (only for apps with a worker), `main: "./worker.js"` where present, `routes: [{ pattern: "<host>", custom_domain: true }]`, `ai: { binding: "AI" }` for coach.

## 14. Tests (`node --test test/`)

At minimum:

- crypto: sign/verify roundtrip; tampered payload fails.
- protocol: token encode/decode; assertion audience mismatch rejected;
  expired assertion rejected; receipt unknown issuer -> pending; duplicate
  receipt rejected; assertion never contains keys outside the allowed set.
- inference: seed evidence yields the expected bands for the story concepts;
  a failed claim lowers the band; reviewDue computed; needs ordering for the
  "5 minute review" case yields a `discriminate` need for agent-evals.
- graders: harness diagnostic and lab answer keys grade as expected;
  security lab grades as expected.

## 15. Definition of done per app

- Loads with zero console errors in Chromium with and without native WebMCP.
- `document.modelContext.getTools()` lists every tool in this contract with
  the exact names; each `execute` returns an object with `status`.
- Every tool call visibly changes the page and appears in the activity strip.
- Keyboard reachable; focus visible; `prefers-reduced-motion` respected;
  contrast of text on navy passes WCAG AA.
- No emojis, no em dashes, no lorem ipsum, no placeholder assets.
- Brand header and footer present; fonts self-hosted; no third party requests.

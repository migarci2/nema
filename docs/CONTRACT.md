# nema: implementation contract

This file is the single source of truth for every module in the repo. All
agents code against it. If you must deviate, add a `CONTRACT DEVIATION:` line
in your final report with the reason, and keep the public interface stable.

Read `PLAN.md` for the hackathon context and the product story. Read
`docs/PHILOSOPHY.md` (if present) for tone.

This contract is chronological. Later numbered amendments override earlier
sections when they describe the same surface. Sections 30 and 31 describe the
current learner policy and extension panel.

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

**2026-09-03, owner:** the `open_app` form was removed from the hub. The hub registers one tool, `explain_nema`; navigation between apps is by links only.

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

## 16. Native WebMCP findings (verified 2026-09-01 on Chrome for Testing 154.0.8037.0)

- `document.modelContext` exists with no flag on Chrome for Testing canary 154. On stable 149+ the flag `chrome://flags/#enable-webmcp-testing` (command line `--enable-features=WebMCP`) enables it. Chrome 147 has nothing, even with flags.
- Native `executeTool(tool, input)` accepts a JSON string or an object as input and passes an object to `execute`. It RETURNS A JSON STRING (the execute result serialized), while the polyfill returns the object. Every consumer (the coach loop, tests, the site) must do `typeof r === 'string' ? JSON.parse(r) : r` with a try/catch.
- Declarative `<form toolname ...>` tools register natively and are listed by `getTools()` next to imperative ones.
- Probe harness: `scratchpad/native/cdp.mjs <chrome> <url>` (session scratchpad), reusable for smoke tests of every app.

## 17. `packages/nema-mcp`: the same vault tools over MCP (phase 4)

Thesis: the vault is the infrastructure, the agent is a commodity. Browser
agents (ChatGPT desktop, Chrome 149+) reach the vault through WebMCP on the
vault page. Terminal agents (Claude Code, Codex) reach the same vault through
MCP. Same nine tools, same names, same schemas, same return shapes.

- Location: `packages/nema-mcp/` with its own `package.json` (name
  `nema-mcp`, `bin: { "nema-mcp": "./bin.mjs" }`, type module, dependency
  `@modelcontextprotocol/sdk` 1.30.x only). This is the only place in the repo
  with an npm dependency. Node 20+.
- Reuse, do not copy: import `../../apps/vault/public/vault.js` and
  `../../apps/vault/public/tools.js` (the `TOOLS` array) and the shared
  modules. Before importing, install minimal globals in Node:
  `globalThis.localStorage` backed by a JSON file (`~/.nema/vault.json`,
  overridable with `NEMA_VAULT_FILE`), `globalThis.document` with
  `dispatchEvent` and `addEventListener` no-ops, `globalThis.location` with
  `origin: "nema-mcp://local"`, `globalThis.fetch` resolving `/shared/*` and
  `/seed.json` to repo files. If vault.js needs any other browser API, add a
  shim here rather than editing vault.js; report it.
- Storage schema is identical to the browser vault. Sync between browser and
  terminal is by export/import of the JSON document; merging is a union of
  receipts by `receiptId` plus union of disclosures, goals and misconceptions
  (`nema-mcp merge <file>` subcommand). Keys: if the file has no vault key, the
  server generates one; if the user imports a browser export, that key wins.
- Consent: `create_readiness_assertion` calls `setConsentHandler`. The MCP
  handler first tries MCP elicitation (`server.server.elicitInput`) with the
  disclosure preview (audience, purpose, shared list, withheld list); if the
  client does not support elicitation, it falls back to the vault's auto
  approval policy for that audience, and otherwise returns `status: 'denied'`
  with a hint that explains how to pre-approve
  (`nema-mcp approve <audience> [--hours 1]`). The agent can never approve.
- Transport: stdio by default. `nema-mcp serve` (default when no subcommand).
  Subcommands: `serve`, `approve <audience>`, `merge <file>`, `export [file]`,
  `seed` (loads apps/vault/public/seed.json), `summary` (prints the vault
  summary, for humans).
- Install lines documented in README and the site: 
  `claude mcp add nema -- node /path/to/nema/packages/nema-mcp/bin.mjs` and
  `codex mcp add nema -- node /path/to/nema/packages/nema-mcp/bin.mjs`
  (use `npx nema-mcp` once published; do not publish during the hackathon).
- Tests: `packages/nema-mcp/test/*.test.js` with `node --test`: the server
  lists exactly the nine tool names; `get_vault_summary` on a fresh file;
  `seed` then `get_learner_state` bands for the story concepts;
  `stage_evidence_receipt` with a receipt signed by the harness key from
  `secrets/` (skip if the secrets file is absent); `create_readiness_assertion`
  denied without policy, approved with policy, token verifies with
  `verifyAssertion` for that audience; `merge` is idempotent. Drive the server
  in tests with the SDK's `Client` over `StdioClientTransport`.
- Docs: `packages/nema-mcp/README.md` (what it is, install, the consent model,
  the sync model, the same tool table as SPEC.md) and one paragraph plus the
  two install lines in the root README and in the site's "Live" section
  ("Bring your own agent").
- Native `executeTool(tool, input)` REQUIRES `input` to be a JSON string. Passing an object throws `UnknownError: Failed to parse input arguments`. The polyfill parses strings as well, so callers always pass `JSON.stringify(args)`.
- Native validates inputs against the schema before `execute` runs (for example a declarative `<select>` rejects values outside its options with `Invalid value "x" for parameter app`), so a model that invents a parameter name gets a browser level error, not a tool result. Tool descriptions should name the parameters.

## 18. Two identities (owner feedback, 2026-09-02)

What nema is (hub, vault, coach) keeps the nema brand. What nema is not, the
two example course sites, must look like independent third party sites so a
judge sees at a glance which surface is the learner's and which are the web.

### Providers get their own identity

Both providers keep the shared components (they are convenient) but re-theme
them by overriding the tokens in their own `app.css` `:root` block, render
their own header (no nema nav, no nema wordmark) and show one discreet
"Works with nema" badge in the header end and the footer: the nema mark at
16px plus the words, linking to the hub.

| | Harness Engineering Lab | Agent Security |
|---|---|---|
| ground | warm paper `#F6F1E7`, panels `#FFFDF8` | near black `#0E0F12`, panels `#15171C` |
| ink | `#1F1B16`, secondary `#6B6257` | `#E8E6E1`, secondary `#9A9890` |
| accent | amber `#D8741B` (focus, primary buttons, links) | signal green `#4ADE80` for ok, coral `#F26D6D` for locked or danger |
| line | `#E4DBCB` | `#262A33` |
| display type | a system serif stack (Iowan Old Style, Palatino, Georgia, serif) for titles | JetBrains Mono for titles, uppercase off |
| body type | Inter | Inter |
| wordmark | text "Harness Lab" in the serif, weight 600, a small amber square before it | text "agent.security" in mono, a green terminal caret before it |
| mood | a well made course site: light, generous margins, reading first | an ops tool: dark, precise, terse |

Band colours stay semantically the same across sites (durable, usable,
fragile, uncertain, unknown, due) but are re-mapped to each palette so they
read on that ground: pass WCAG AA on the new backgrounds.

### The hub is a manifesto first

`apps/site/public/index.html` reads as a friendly pedagogy piece, general
audience, no JSON, no object names, no tool names. Structure:

1. Wordmark, tagline, the three line thesis.
2. "What we believe": six short beliefs, one sentence of title and two or
   three sentences each, warm and plain. Learning happens everywhere.
   Evidence beats grades. Memory needs you to come back. Your learning state
   is yours. The web teaches, one site at a time. An agent should coach, not
   judge.
3. "How it feels": three moments in the learner's words. You learn on one
   site. Another site recognises it. Your agent reminds you before you forget.
4. "What nema is": three plain paragraphs, vault, protocol, coach, with the
   consent modal shown once as the picture of the whole idea.
5. "Try it": the live cards.
6. "For builders and judges": one paragraph and links to the protocol page,
   the judge guide, the repo. This is where the technical intensity begins,
   not before.

Everything technical (objects, tokens, tool tables, conformance, threat
model) lives in `protocol.html`, `judges.html`, `docs/` and the README, and
stays intensive there.

## 19. The example courses teach cooking, not agents (owner feedback, 2026-09-02)

Courses about agents were being confused with nema itself. The two example
providers now teach cooking. Internal keys (`apps/harness`, `apps/security`,
`ORIGINS.harness`, `ORIGINS.security`, dev ports) stay as they are; public
names, domains, key ids, content, concept registry, seed and docs change.

| | was | now |
|---|---|---|
| provider A name | Harness Engineering Lab | Saucier School |
| provider A origin | https://nema-harness.migarci2.dev | https://saucier.migarci2.dev (worker `saucier-school`) |
| provider A keyId | harness-2026-09 | saucier-2026-09 |
| provider B name | Agent Security | Line Cook Lab |
| provider B origin | https://nema-security.migarci2.dev | https://linecook.migarci2.dev (worker `line-cook-lab`) |
| provider B keyId | security-2026-09 | linecook-2026-09 |

### Concept registry (34 ids, cooking)

```
nema:knife-skills       nema:mise-en-place     nema:heat-control      nema:ratios
nema:emulsions          nema:pan-sauces        nema:deglazing         nema:reduction
nema:seasoning          nema:maillard-reaction nema:caramelization    nema:braising
nema:roasting           nema:blanching         nema:poaching          nema:stocks
nema:roux               nema:thickeners        nema:acid-balance      nema:plating
nema:menu-planning      nema:food-safety       nema:cross-contamination nema:cold-chain
nema:temperature-control nema:allergen-handling nema:service-timing   nema:kitchen-communication
nema:cost-control       nema:fermentation      nema:bread-basics      nema:pastry-basics
nema:mother-sauces      nema:tasting-and-adjusting
```

Depth 0: knife-skills, heat-control, mise-en-place, ratios. Confusable pairs
at least: maillard-reaction and caramelization; emulsions and reduction;
blanching and poaching; braising and roasting; cross-contamination and
allergen-handling; cold-chain and temperature-control. Misconceptions at
least: maillard-reaction "searing_seals_in_juices"; food-safety
"rinsing_chicken_makes_it_safer"; heat-control "hotter_is_always_faster";
emulsions "a_sauce_can_be_boiled_once_it_holds"; seasoning
"salt_only_at_the_end".

### Saucier School, unit `pan-sauces-foundations`, "Pan Sauces and Emulsions", 68 min

Requirements: `nema:knife-skills.apply`, `nema:heat-control.explain`,
`nema:ratios.apply`. Outcomes: `nema:pan-sauces.apply`,
`nema:pan-sauces.explain`, `nema:emulsions.discriminate`, `nema:ratios.apply`.

1. `heat-control-primer` lesson 12 min, skipIf heat-control.recognize uncertain
2. `knife-skills-refresher` lesson 15 min, skipIf knife-skills.apply verified
3. `ratios-diagnostic` diagnostic 6 min, onlyIf ratios.apply uncertain; one question: which of four written ratios gives a vinaigrette that holds (3 parts oil to 1 part acid with a spoon of mustard as emulsifier); distractors: 1:1, 3:1 with no emulsifier whisked cold, 1:3. Outcome ratios.apply
4. `ratios-primer` lesson 14 min, skipIf ratios.apply verified or uncertain
5. `pan-sauce-anatomy` lesson 4 min, skipIf pan-sauces.recognize uncertain
6. `fix-the-broken-sauce` interactive-lab 12 min, always. Scenario: a pan sauce that split and tastes flat during a dinner for six. Before console: tasting notes (greasy film, broken, flat, too thin). Checks (8): required 3 (deglaze the fond with wine or stock, reduce by half before mounting, mount with cold butter off the heat), harmful 2 (bring it back to a rolling boil after mounting, add the butter to the dry ripping hot pan), neutral 3. Stages to order: deglaze, reduce, mount. After console: glossy, coats the spoon, seasoned, holds on the pass. Outcomes pan-sauces.apply (application), emulsions.discriminate (discrimination)
7. `explain-without-the-recipe` free-recall 5 min, optional, provider-rubric with keywords (emulsion or emulsify, fat and water or droplets, emulsifier or mustard or butter proteins, temperature or heat). Outcome pan-sauces.explain

Personal path with the seed (heat-control verified, knife-skills verified,
ratios uncertain): 3 + 5 + 6 + 7 = 27. After the diagnostic (ratios
verified): 5 + 6 + 7 = 21.

### Line Cook Lab, unit `service-under-pressure`, "Service Under Pressure", 54 min

Requirements: `nema:mise-en-place.explain`, `nema:emulsions.explain`,
`nema:food-safety.apply`.

1. `mise-en-place-intro` lesson 7 min, skipIf mise-en-place.explain verified
2. `food-safety-intro` lesson 9 min, skipIf food-safety.apply verified
3. `heat-control-on-the-line` lesson 6 min, skipIf heat-control.recognize uncertain
4. `pan-sauces-during-service` lesson 6 min, skipIf pan-sauces.recognize uncertain
5. `service-log-audit` interactive-lab 12 min, unlock emulsions.explain at least uncertain. A service log of about 10 steps (tickets, prep, plating); exactly 3 steps are unsafe (raw chicken board reused for salad, a hollandaise held at room temperature for two hours, a nut allergy ticket plated with the shared spoon). Fixes: 3 effective (separate colour coded boards, hold emulsified sauces above 63 C or remake every hour, dedicated allergen station and utensils), 2 harmful (rinse the chicken, keep the sauce going by boiling it), 2 neutral. Outcomes food-safety.apply (application), cross-contamination.discriminate (discrimination)
6. `incident-triage` interactive-lab 14 min, unlock emulsions.explain at least uncertain AND food-safety.apply verified AND mise-en-place.explain verified. Four incidents (a beurre blanc split mid service; chicken probes at 60 C; an allergen ticket may have touched shellfish; the walk in reads 8 C since morning) with four actions each (rescue and continue; cook further and re-probe; stop, tell the chef, remake; discard and log). Outcomes service-timing.apply, temperature-control.apply

Story: with the Saucier receipts in the vault, heat control and pan sauces make
the two shared lessons `done via nema`. Mise-en-place and food-safety are also
verified, so four lessons are done without repetition. When emulsions reaches
uncertain, the incident triage lab unlocks with "Prerequisite recognised from
another provider".

### Seed learner

Verified: knife-skills apply, heat-control explain, mise-en-place explain,
food-safety apply, plus enough others for about 18 verified concepts.
Uncertain: ratios apply. Unknown: emulsions, pan-sauces, cross-contamination,
service-timing, temperature-control. About 7 fragile and 4 reviews due, with
the same early-coursework backfill so counts hold through 2026-09-21. Goal:
"Cook a pan sauce I can hold through service" with concepts pan-sauces,
emulsions, heat-control. Misconception recorded: maillard-reaction
"searing_seals_in_juices". The five minute review should surface a
discriminate need (maillard-reaction vs caramelization: strong apply, no
discrimination evidence).

## 20. Design principles for nema surfaces (owner pointed at vercel.com/design.md, 2026-09-02)

Adopted, adapted to the nema palette and fonts (Inter, JetBrains Mono, Pixelify
for the wordmark and section titles only):

- Precise, calm, direct, evidence led, restrained. No hype, decoration or
  novelty. No gradient text, glows, blobs, textures, grid backgrounds, glass,
  paper simulations, ornamental shadows or fake depth.
- Design in monochrome first. Colour only where it carries meaning, always
  paired with a non colour cue. On the hub the three semantic colours are the
  whole colour budget: cyan for the learner and the vault, teal for the web
  and the sites, yellow for the agent. Two or three coloured words per
  paragraph at most, never a coloured paragraph.
- One continuous canvas. Earn a border or a box only for selection,
  interaction, warning or a real grouping spacing cannot express. Prefer
  spacing, alignment, typography and a change of density before borders. Do
  not wrap every section in a card; no nested panels; no badges or pills for
  ordinary metadata.
- Typography has roles, not arbitrary sizes: display (one page defining line),
  title, heading 24, heading 20, lede, body, label, caption. Body regular,
  emphasis scarce. Prose 60 to 68 characters per line. Heading close to its
  first paragraph, one body rhythm between paragraphs.
- Grid: 12 columns desktop, 6 tablet, 4 mobile. Everything aligns to a shared
  edge or baseline. Reading prose takes 6 to 7 desktop columns. Gutters
  unmistakable. Open space must amplify a focal object; empty rectangles from
  an underfilled split or an orphaned third item are failures.
- Sentence case headings that state the claim. No all caps eyebrows, no
  decorative section numbers, no synthetic symmetry, no repetitive cadence.
- Default to stillness. Motion only to explain a state change or confirm an
  action. Nothing revealed on scroll, no parallax, no marquees.
- Icons are not decoration. Prefer text labels.
- Semantic HTML, one h1, ordered headings, native controls, visible focus,
  WCAG AA, source order is reading order.
- Copy: simplify the language, never the claim. Keep every qualifier that
  changes meaning. No authoring narration.

## 21. No coach. nema is a protocol anyone who teaches on the web can install (owner decision, 2026-09-02)

The coach page is removed. The agents are the real ones: ChatGPT desktop and
Chrome 149+ in the browser (WebMCP), Claude Code and Codex in the terminal
(MCP through `packages/nema-mcp`). Every flow must work with any of them, and
with no agent at all (a person copying tokens by hand).

### The one tag install: `nema-provider.js`

Served from the hub at `https://nema.migarci2.dev/nema-provider.js`
(source `shared/provider-embed.js`, copied into `apps/site/public/`). A blog
post, an article, a course page installs nema with a manifest and one script:

```html
<script type="application/nema+json">
{ "protocol": "nema/0.1",
  "provider": { "name": "Maillard, explained" },
  "unit": { "id": "maillard-explained", "title": "Why browning tastes like that", "estimatedMinutes": 8 },
  "requirements": [ { "concept": "nema:heat-control", "ability": "explain" } ],
  "activities": [
    { "id": "read", "type": "lesson", "title": "Read the article", "minutes": 6,
      "outcomes": [ { "concept": "nema:maillard-reaction", "ability": "recognize" } ] },
    { "id": "check", "type": "quiz", "title": "Two questions before you go", "minutes": 2,
      "outcomes": [ { "concept": "nema:maillard-reaction", "ability": "explain" } ],
      "questions": [ { "id": "q1", "prompt": "...", "options": [ { "id": "a", "text": "..." } ], "answer": "a" } ] }
  ] }
</script>
<script type="module" src="https://nema.migarci2.dev/nema-provider.js"></script>
```

What the script does, with no backend and no account:

- Registers the five provider tools with the exact names, schemas and return
  shapes of section 10 (`describe_learning_offer`, `personalize_learning_path`,
  `start_activity`, `get_attempt_status`, `issue_evidence_receipt`), plus the
  declarative form `<form toolname="present_assertion">` with one textarea so
  a person or an agent can hand over a vault assertion.
- Renders one quiet block where the page puts `<nema-activities></nema-activities>`
  (or at the end of `<main>` / `<article>` when absent): the lesson "Mark as
  read" button, the quiz (radio options, Submit, feedback), the personalised
  path note ("You can skip: ...") once an assertion is presented, and the
  receipt with Copy and a "Send to vault" link (`<vault>/#receipt=<token>`).
  Styles are scoped and inherit the host page's fonts and colours; nothing
  about the block looks like nema except a 16px mark and the words "Works with
  nema".
- Grades the quiz deterministically in the page and issues receipts signed
  with a per origin key generated in localStorage on first use. The receipt
  carries `keyId: "self:<origin>"` and `issuerKey` (the public JWK), so it is
  self certifying. Grader for the quiz: `deterministic`; for "Mark as read":
  `exposure`.
- Optional attributes on the script tag: `data-endpoint="/api/receipt"`
  (post the submission for server signing, same body as section 10; the
  server's receipt replaces the self signed one), `data-vault` (vault origin
  for the "Send to vault" link, default the nema vault).
- Optional trust upgrade with no server: publish the same public key at
  `/.well-known/nema-issuer.json` (`{ "keyId", "jwk" }`, CORS `*`). The vault
  fetches it and treats the issuer as origin published.

### Vault: three trust tiers for receipts

`verifyReceipt` gains an `issuerKey` path and the vault stores a
`trust` field on every receipt:

| trust | how it is established | evidence weight |
|---|---|---|
| `registered` | keyId in `shared/issuers.json` | full (section 3 table) |
| `origin` | `issuerKey` verifies the signature AND `https://<issuer>/.well-known/nema-issuer.json` returns the same keyId and jwk | full |
| `self` | `issuerKey` verifies the signature, nothing else | capped at the `self-report` weight (0.3) whatever the grader says |
| `pending` | no key matches | none |

The ledger shows the tier as a word (registered, origin, self) and the
learner state derivation caps `self` receipts. `deriveState` takes an
optional `weightCap(receipt)`; the vault passes the tier rule.

### Hand delivery, no agent needed

- Vault: a "Share with a site" action (audience origin, purpose, the
  concept and ability pairs) that runs the same consent modal and shows the
  signed token with Copy. Same code path as `create_readiness_assertion`.
- Saucier School, Line Cook Lab and the embed: a "Paste an assertion" textarea
  that calls the same verify and personalise path as the tool (declarative
  form `present_assertion`, `toolautosubmit`).
- Receipts already travel by the "Send to vault" link and the vault inbox.

### The third example: a blog post

`apps/blog` (worker `nema-blog`, `https://maillard.migarci2.dev`): one static
article, "Why browning tastes like that", written like a good personal blog
(white page, serif, 70ch, a photo free layout), with the manifest above and
the one script tag. It is the proof that the install is one tag, so its
source must be readable as a template: `index.html` with a comment "everything
nema is between these two lines".

### The message, everywhere

nema is a protocol for the people who make the web's learning: sites, blogs,
articles, courses. Install it in a minute, keep your content and your voice,
and every reader who arrives keeps what they learned with them. The vault is
the reader's; the protocol is everyone's; the agents are whichever the reader
already uses. The hub says this first. The docs say how.

## 22. nema in your browser: the Chrome extension (owner decision, 2026-09-02)

`packages/nema-extension/`: Manifest V3, loadable unpacked from the repo
(`packages/nema-extension/dist`), built by `scripts/build-extension.sh`.

What it is: the vault as a side panel, plus a broker that needs no model.

- **Side panel = the vault.** The build copies `apps/vault/public/*`
  (index.html, app.js, app.css, graph.js, vault.js, tools.js, seed.json) to
  the extension root and `shared/` to `<root>/shared/`, so the vault's absolute
  imports (`/shared/...`, `/vault.js`) resolve inside
  `chrome-extension://<id>/`. `sidepanel.html` is the vault page with a
  small header line "nema in your browser" instead of the site nav (a build
  time text substitution or a tiny wrapper page that loads the same
  modules). Storage stays `localStorage` of the extension origin (one vault per
  browser profile). The WebMCP tools registered by tools.js inside the side
  panel are harmless (no agent reads them there); registration must not throw
  when `document.modelContext` is absent (the polyfill is loaded as usual).
- **Content script on every page** (`content.js`, `<all_urls>`, run at idle):
  injects `bridge.js` into the MAIN world (via `chrome.scripting` from the
  service worker, or a script tag) which asks `document.modelContext.getTools()`
  and reports the tool names to the content script over `window.postMessage`
  (message type `nema-ext:tools`). If the page has any of
  `describe_learning_offer`, `personalize_learning_path`, `check_prerequisites`,
  `present_assertion`, `issue_evidence_receipt`, the page "works with nema":
  the action badge shows a small count and the side panel's "This page" strip
  lists what it can do. The bridge also executes tools on request
  (`nema-ext:execute` with name and JSON args, reply `nema-ext:result`),
  always passing a JSON string to `executeTool` and parsing string results.
- **Broker actions in the side panel** ("This page" strip, only when the page
  works with nema):
  1. *Share bands with this page*: calls `describe_learning_offer` on the
     page, builds the ReadinessRequest from the manifest requirements
     (audience = page origin, purpose = "personalize-" + unit id), runs the
     vault's `createAssertion` (same consent modal, same code path), then
     executes `present_assertion` (or `personalize_learning_path` /
     `check_prerequisites`) on the page with the token. The page updates in
     place.
  2. *Take the receipt to my vault*: executes `issue_evidence_receipt` for the
     activity the page reports as passed (poll `get_attempt_status` for the
     manifest's activities, pick the passed ones without a stored receipt),
     stages the token in the vault (same `stageReceipt` path), and shows the
     effect (bands moved) in the strip.
  Both actions are buttons a person clicks; nothing runs automatically. The
  strip shows the last tool call and result like the tool activity strip does.
- **Service worker** (`sw.js`): opens the side panel on action click
  (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`),
  relays messages between content scripts and the side panel
  (`chrome.runtime` messaging, tab id keyed), updates the badge.
- **Permissions**: `sidePanel`, `scripting`, `activeTab`, `tabs`, `storage`;
  host permissions `<all_urls>` (a prototype; the docs say so).
- **Look**: the vault's own design; the "This page" strip uses the same
  components; the extension icon is the nema mark (16, 32, 48, 128 PNGs
  rendered from `shared/brand/mark.svg` with a script, or the SVG rasterised
  once and committed).
- **Verification**: Chrome for Testing 154 headless with
  `--load-extension=<dist>` and `--disable-extensions-except=<dist>`: open
  `chrome-extension://<id>/sidepanel.html` in a tab (find the id from
  `chrome://extensions` is not possible headless; instead read it from
  `Target.getTargets` service worker URL), load the demo learner, open the
  blog or Saucier School in another tab, and drive the two broker actions
  end to end through CDP; assert the page personalised and the vault gained a
  receipt. Document the manual load steps for judges in the package README
  and in JUDGE_GUIDE ("nema in your browser, optional, 30 seconds to load").

## 23. Concept alignment: sites speak their own names, the agent translates, the learner confirms (owner decision, 2026-09-02)

The closed registry stays the anchor (`shared/concepts.json`), but a site is
no longer required to use `nema:*` ids. A manifest may declare local concepts
and, optionally, what it believes they equal:

```json
"concepts": [
  { "id": "browning-science", "title": "Browning science" },
  { "id": "sugar-browning", "title": "Sugar browning",
    "alignsTo": [ { "concept": "nema:caramelization", "relation": "equivalent" } ] }
]
```

Requirements, outcomes and receipt claims may then use local ids (any id
without the `nema:` prefix is local to the manifest's origin).

Vault storage gains `alignments`:

```json
{ "alignmentId": "aln_...", "origin": "https://maillard.migarci2.dev",
  "providerConcept": "browning-science", "concept": "nema:maillard-reaction",
  "relation": "equivalent" | "broader" | "narrower",
  "status": "proposed" | "confirmed" | "rejected",
  "proposedBy": "agent" | "provider" | "learner", "rationale": "...",
  "proposedAt": "...", "decidedAt": null }
```

Rules:

- New vault tools (they appear over WebMCP and over MCP automatically):
  `propose_concept_alignment({ origin, providerConcept, concept, relation, rationale })`
  returns `{ status: 'proposed', alignmentId }` or `{ status: 'exists', alignmentId, current }`;
  `get_concept_alignments({ origin? })` returns the list with statuses. There is
  no tool to confirm or reject: only the learner does that, in the vault UI
  (and in the extension panel, which reuses the same vault functions
  `confirmAlignment(alignmentId)` and `rejectAlignment(alignmentId)`).
- An alignment declared by the provider's own manifest (`alignsTo` to a
  registry id) is stored as `proposedBy: 'provider'` and confirmed on arrival:
  a site may vouch for its own vocabulary. It still shows in the ledger.
- Translation happens at the vault's edges, never inside inference:
  `create_readiness_assertion` maps local requirement ids of that audience
  through confirmed alignments before reading bands, and answers with the id
  the site asked for plus `alignedTo`; an unaligned local id answers `missing`
  with `reason: 'unaligned'`. `stage_evidence_receipt` maps local claim ids
  through confirmed alignments for the receipt's issuer, stores
  `claims[i].alignedTo`, and leaves unaligned claims in the receipt as
  `pendingAlignment: true`. `derived()` builds the receipt view with `concept`
  replaced by `alignedTo` where present and skips claims still pending, so
  confirming an alignment later moves bands without touching the ledger.
- `relation` only affects the direction: `equivalent` maps both ways;
  `narrower` (the site's concept is a part of the registry concept) lets the
  site's evidence count for the registry concept but a registry band answers
  the site's requirement only as `uncertain` at best; `broader` the reverse.
- Trust and weight are untouched by alignment: who signed the receipt decides
  the weight, who translated the name never does.
- The learner UI: an "Alignments" list next to the ledgers: proposed ones
  with Confirm and Reject buttons and the rationale, confirmed ones as one
  line each, rejected ones hidden under "More".
- `recordSelfCheck({ needId, rubricResults })` is a new vault function (no
  tool): it stores a receipt with grader `self-report`, keyId `self-check`,
  issuer `urn:nema:self`, trust `registered`, so a person can answer a review
  question in the vault or the extension panel without an agent, at the
  self-report weight (0.3). The evidence ledger labels it "self check".
- The blog (`apps/blog`) becomes the living demonstration: its manifest uses
  local ids, one with a declared `alignsTo` (sugar-browning to
  nema:caramelization) and one without (browning-science, the article's main
  subject, meant to be aligned by an agent to nema:maillard-reaction). The
  embed sends local ids in claims and requirements as they are.

## 24. The smooth flow in the extension (owner decision, 2026-09-02)

The learner never copies anything, approves once per site, and answers
questions. Everything else is the extension's job.

1. **Onboarding.** A fresh panel shows three choices: start empty, load the
   demo learner, import a vault file. One sentence: "Learn anywhere you see
   the nema mark. What you pass is kept here, and only shared when you say so."
2. **Arriving at a site.** When the content script finds nema tools, the page
   gets a small bar at the bottom (shadow DOM, host page styles untouched):
   "This site works with nema. Share what you already know?" with "Share" and
   "Not now". "Share" runs the broker's share action (consent in the panel,
   which the service worker opens if it is closed; if it cannot be opened
   without a user gesture, the bar itself says "Open nema to approve" and
   highlights the toolbar icon). The consent modal gains, from the extension
   only, a "Remember this site for 30 days" checkbox (implemented by writing
   `settings.autoApprove[origin]` with a 30 day expiry through the vault's
   own storage on the panel origin). A site already remembered shows the bar
   as "Shared with this site" and the course adapts on load without asking.
3. **Learning.** While a nema page is open, the extension polls
   `get_attempt_status` for the manifest's activities every 4 seconds (only
   the active tab, only while the tab is visible). When an activity turns
   `passed` and no receipt for it is stored, it issues and stages the receipt
   automatically and shows a toast in the page: "Kept in your vault: ratios,
   now usable" (the bands that moved, in words). Failures and duplicates are
   silent in the page and visible in the panel strip. The manual button stays
   in the panel as "Check for receipts now".
4. **Next.** The top of the panel is a "Next" card: the most urgent learning
   need from `getNeeds(5)`, its rubric as a short checklist the learner can
   tick ("I can explain why boiling breaks an emulsion"), a "Done" button that
   calls `recordSelfCheck`, and one line saying an agent would grade this
   properly ("Connect an agent to be asked instead"). When a site the vault
   knows can teach the need, the card links there instead.
5. **Alignments.** When a page's manifest carries local concept ids without a
   confirmed alignment, the bar adds "This site names things its own way";
   the panel lists the proposed alignments (from the provider or from an
   agent) with Confirm and Reject, using the vault functions of section 23.
6. **Tokens** never appear in the normal path; they live under "More".

## 25. Sites talk to the vault by themselves: the connect handshake (owner decision, 2026-09-02)

No agent, no extension, only the browser. A site opens the vault in a popup
with a request; the learner approves there; the vault answers the site with
`postMessage`. Same for receipts. Storage is first party in a popup (top level
window), which is why this is a popup and not an iframe (Chrome partitions
third party iframe storage).

### Vault side: `/connect`

`apps/vault/public/connect.html` (same modules as the vault, compact layout,
no graph, no ledgers): reads `location.hash` as URL search params.

- `#request=<b64url ReadinessRequest JSON>&return=<origin>`: the vault
  validates that `return` equals `request.audience` (else it shows "This
  request is not addressed to the site that opened it" and does nothing),
  runs the same consent modal, and on approve posts
  `{ type: 'nema:assertion', status: 'approved', token }` to `window.opener`
  with `targetOrigin = request.audience`, then shows "Shared. You can close
  this window" and closes itself after 1.5 s. On deny it posts
  `{ type: 'nema:assertion', status: 'denied' }` and closes. Auto approval
  (remembered site) applies: approve without the modal.
- `#receipt=<token>&return=<origin>`: the vault stages the receipt (same
  `stageReceipt` path, source `site`), posts
  `{ type: 'nema:receipt', status, receiptId?, trust?, changes?, reason? }`
  to the opener with `targetOrigin = return`, shows "Kept in your vault:
  <bands that moved>" for 1.5 s and closes. A receipt whose issuer does not
  match `return` is still staged (it is the learner's data) but the answer
  goes to `return` only.
- With no opener (a person opened the link by hand) the page shows the same
  result and a "Back to the vault" link instead of closing.
- `apps/vault/public/index.html` keeps handling `#receipt=` as today (inbox
  prefilled) so old links keep working.

### Site side: `shared/vault-link.js` (copied into the embed and used by the courses)

```js
import { connectVault, sendReceiptToVault } from '/shared/vault-link.js';
const result = await connectVault({ vault, request });   // { status, token }
const kept = await sendReceiptToVault({ vault, token });  // { status, changes }
```

- `connectVault` opens `<vault>/connect.html#request=...&return=<location.origin>`
  in a popup of 480 x 720 (must be called from a user gesture), listens for
  the message with `event.origin === vault`, resolves, and rejects with
  `{ status: 'closed' }` if the popup closes without answering (poll
  `popup.closed` every 500 ms). One pending call at a time.
- `sendReceiptToVault` opens `<vault>/connect.html#receipt=...&return=...`
  the same way and resolves with the vault's answer.
- Default `vault` is `https://nema-vault.migarci2.dev`; the embed honours
  `data-vault`; the courses read a `?vault=` query or default.

### What the pages show

- Courses and the embed: next to the requirements, a primary button
  "Connect your vault" (when no assertion is on file) that calls
  `connectVault` with the manifest requirements (plus every skipIf pair) and
  then runs the same personalise path as `present_assertion`. The "Paste an
  assertion" details stays as the fallback below it.
- After a pass: the receipt panel's primary action becomes "Keep in my vault"
  (calls `issue_evidence_receipt`'s code path to get the token, then
  `sendReceiptToVault`), showing the vault's answer in words ("Kept: ratios,
  now usable"). The copy box and the old "Send to vault" link move under a
  details "Do it by hand".
- The embed (`nema-provider.js`) does the same with its two buttons, so the
  blog shows the whole loop with zero installs: Connect your vault, read,
  answer, Keep in my vault.

### Tests

- `test/vault-link.test.js`: request encoding, origin checks, message
  parsing (pure parts).
- `scripts/e2e/golden-connect.mjs` (native, CDP): on Saucier School click
  "Connect your vault"; a new target opens (`Target.getTargets`), attach,
  approve, the popup posts back, the course shows 27 of 68; pass the
  diagnostic, click "Keep in my vault", the popup stages and closes, the
  vault (opened afterwards in a tab) lists the receipt. Same on the blog.
- Popup blocking: the click handlers call `window.open` synchronously; a
  blocked popup shows "Your browser blocked the vault window. Allow popups
  for this site or use the paste box below."

## 26. Under the hood by default (owner decision, 2026-09-02)

The learner never sees cryptography unless they ask. Applies to the vault,
the courses, the embed and blog, the extension panel and the connect page.

- **Hidden by default, everywhere:** tokens (`nema1.` strings), key ids,
  JWKs, signatures, receipt ids, request hashes, learner ids (`lk_...`),
  alignment ids, content hashes, grader versions, the word "token" itself in
  normal copy. They live inside one `<details>` per panel titled "Under the
  hood", closed by default, styled quiet (13px, mono inside). Copy buttons
  live inside it. Nothing in the normal path requires opening it.
- **Normal copy speaks in outcomes.** Receipt panel: "Saucier School signed
  what you did. Verified." plus the bands in words ("Ratios: uncertain to
  usable") and one primary action ("Keep in my vault"). Consent modal: site
  name, purpose in words ("to skip what you already know"), the "Shared" and
  "Not shared" lists, expiry in words, Approve and Deny; the learner id line
  moves under the hood. Ledger rows: activity, site, date, one word for the
  state (verified, self issued, waiting); the tier explanation is a tooltip
  or a line under the hood. Alignments: "This site calls Maillard 'browning
  science'" with Confirm and Reject; no ids. Disclosure ledger: site, what
  was shared, until when.
- **The vault's manual paths** (receipt inbox, share form, import and export)
  move into the More block under a heading "Do it by hand", with one
  sentence each; they remain fully functional and tested.
- **Tool results** (what agents see) are unchanged: agents need the tokens.
  Only the human facing UI changes.
- **The hub and docs** keep the technical pages technical; the manifesto and
  creators page do not show tokens.
- Verify by reading every page as a first time learner: if a string looks like
  base64, a hash, an id or a key, it must be inside "Under the hood".

## 27. A real article with nema added: the AES-GCM mirror (owner decision, 2026-09-02)

To show the value nema adds to an educational resource that already exists,
`apps/aesgcm` mirrors "AES-GCM and breaking it on nonce reuse" by frereit
(https://frereit.de/aes_gcm/, licence CC BY-SA 4.0, 9,300 words, 72
interactive controls, wasm polynomial factoring) as it is, and adds nema with
the one tag install. Worker `nema-aesgcm`, domain `aesgcm.migarci2.dev`.

Rules:

- The article is reproduced verbatim (text, widgets, images, styles). A short
  attribution block at the top and the bottom: "This is a mirror of
  frereit.de/aes_gcm by frereit, CC BY-SA 4.0, republished under the same
  licence with nema added to show what a learning protocol adds to an
  article that already exists. Nothing else was changed." with links to the
  original and the licence. The copy stays CC BY-SA 4.0 (say so in a
  LICENSE.article file in the app directory).
- Everything nema is between two HTML comments, as in the blog: the manifest
  tag, the script tag, and the `<nema-activities>` element placed after the
  Conclusion section.
- The manifest speaks the article's own names (local ids, section 23) with
  `alignsTo` for the ones that have a registry concept. Add a small
  cryptography cluster to `shared/concepts.json` so the alignments resolve:
  `nema:block-ciphers`, `nema:counter-mode`, `nema:authenticated-encryption`,
  `nema:galois-field-arithmetic`, `nema:message-authentication`,
  `nema:nonce-misuse` (with prereqs among themselves, rubrics, minutes,
  confusableWith at least authenticated-encryption vs message-authentication
  and counter-mode vs block-ciphers, misconception nonce-misuse
  "a_nonce_only_needs_to_be_secret"). The demo seed does not change.
- Activities from the article, in the embed's own model: `read` (lesson,
  Mark as read, exposure), `tldr-check` (quiz, three questions the TL;DR
  answers: what GCM adds to CTR, what H is, what nonce reuse leaks), and
  `nonce-reuse-check` (quiz, two questions on why reusing a nonce lets an
  attacker recover H and forge tags). Requirements: `block-ciphers.explain`
  and `galois-field-arithmetic.recognize` in local names (for example
  "aes" and "gf2-128") aligned to the registry, so a learner who read the
  Maillard blog gets nothing skipped and a learner with a crypto vault does.
- The point to make visible: the page is untouched, the reader keeps a signed
  note of what they understood, and any other site can ask about it. Judges
  see the diff: `git show --stat` of the app shows the article files plus
  one manifest block.

### 27b. Make the comparison the point (owner refinement, 2026-09-02)

- `apps/aesgcm/public/original.html`: the article exactly as mirrored,
  untouched, so the two versions can sit side by side.
- `apps/aesgcm/public/index.html`: the same article with nema added inside
  the text, not only at the end: a retrieval question right after the AES
  section, two after GCM (counter mode; what H is and what GHASH does), two
  after Nonce Reuse (why reuse leaks H, what a forged tag needs), and the
  final block after the Conclusion (read, path note, receipt). Each question
  is its own quiz activity with outcomes at ability `retrieve` (evidence type
  retrieval) on the local concept of that section, so the vault sees
  retrieval practice, not a single end quiz. Placement uses
  `<nema-activities for="<activityId>"></nema-activities>` anchors; the embed
  renders that activity where the anchor stands and everything else in the
  main `<nema-activities>` block (the embed gains this `for` attribute; until
  it lands, anchors without support render inside the main block).
- `apps/aesgcm/public/compare.html`: two columns, the original on the left
  and the nema version on the right (both same origin iframes, scrolled
  together), a header "Same article. 24 lines added." with the real count,
  and under it the exact diff of index.html against original.html generated
  at build time by `scripts/build.sh` into `diff.txt` (unified diff, shown in
  a mono block). The hub's "Try it" list points to compare.html.
- The count of added lines is the headline: keep the nema additions as small
  as the embed allows (manifest, one script tag, anchors, attribution).

## 28. A second real resource: cpu.land, "The Basics" (owner decision, 2026-09-02)

`apps/cpu` mirrors chapter 1 of "Putting the You in CPU" by Lexi Mattick
(https://cpu.land/the-basics, source repo hackclub/putting-the-you-in-cpu,
MIT licence, about 3,200 words, six figures). Worker `nema-cpu`, domain
`cpu.migarci2.dev`. Same treatment as section 27 and 27b: `original.html`
untouched (only the analytics script removed and relative links fixed, said
in the attribution), `index.html` with inline retrieval questions, one after
each of the chapter's sections (How Computers Are Architected; Processors Are
Naive; Two Rings to Rule Them All; What Even is a Syscall; The Need for
Speed), the final block, `compare.html` with the diff headline, attribution
"Mirror of cpu.land/the-basics by Lexi Mattick, MIT, with nema added" top
and bottom, LICENSE.article with the MIT text and copyright line. Concept
cluster added to `shared/concepts.json`: `nema:cpu-architecture`,
`nema:fetch-execute-cycle`, `nema:privilege-rings`, `nema:system-calls`,
`nema:interrupts`, `nema:instruction-sets` (prereqs among themselves,
rubrics, minutes, confusableWith at least privilege-rings vs system-calls
and interrupts vs system-calls, misconception system-calls
"programs_call_the_kernel_like_a_function"). The chapter's Google Fonts
links stay as they are (it is a mirror of someone else's page). The hub's
"Try it" lists both real articles under one line: "Two real articles, the
same page with and without nema".

## 29. Follow ups after the real articles landed (2026-09-02)

- **Provider declared alignments travel with the evidence.** A receipt payload
  may carry `alignments: [{ providerConcept, concept, relation }]` (the
  manifest's `alignsTo`, restricted to the concepts the receipt's claims
  use), signed with the rest, so `stage_evidence_receipt` can call
  `declareAlignments` for the receipt's issuer before translating claims.
  A ReadinessRequest may carry the same `alignments` array for the
  requirements it names, so `create_readiness_assertion` can declare them
  before translating. `assertShape` allows the key on both; `verifyReceipt`
  ignores it for trust. The embed includes it in both; the courses do not
  need it (registry ids). The connect handshake passes it through unchanged
  (it is inside the token or the request). The vault's tool results say
  `alignmentsDeclared: n`.
- Hub "Try it": one line "Two real articles, the same page with and without
  nema" linking to https://aesgcm.migarci2.dev/compare and
  https://cpu.migarci2.dev/compare; the Maillard blog stays as "A blog post".
- protocol.html and any doc that states the registry size: read it from the
  registry at build or say "about 40" rather than a number that drifts.
- Embed quiz feedback works for one question quizzes ("Right." / "Not this
  time, the article's answer is ...") and for many.
- `diff.txt` is generated without the two mtime header lines
  (`diff -u a b | tail -n +3`, then prepend stable `--- original.html` and
  `+++ index.html` lines) so the tracked file only changes when the article
  changes.
- The prod run of `golden-connect.mjs` must pass against
  https://nema-vault.migarci2.dev, https://saucier.migarci2.dev and
  https://maillard.migarci2.dev; fix the two ledger expectations that only
  held on localhost.

## 30. The learner model implements the principles of learning fast (owner decision, 2026-09-02)

Source: `docs/LEARNING_FAST_NOTES.md`. The vault is the "learning management"
half of a tutor: an explicit student model over a knowledge graph with a
forgetting model. Changes, all in `shared/inference.js` and the registry,
pure and unit tested:

- **Encompassing graph and fractional implicit repetition.** A passed claim
  on concept C at ability A also counts, at a fraction, for each prerequisite
  of C at the same or lower ability: `implicit = weight x result x recency x f`
  with `f = concept.encompasses?.[prereq] ?? 0.5`, one level only (no
  transitive chains beyond the direct prerequisites, but a prerequisite's own
  prerequisites get `f^2` when the registry marks the relation `encompasses`).
  Implicit evidence also refreshes the prerequisite's `lastSuccess` and
  extends its stability as half a pass, so new learning is the spaced
  repetition of what sits below it. `concepts.json` may declare
  `encompasses: { "nema:x": 0.7 }` per concept; default 0.5 for prereqs.
- **Edge of mastery.** `acquire` needs only for concepts whose prerequisites
  are all at least `usable`; otherwise the need is for the weakest
  prerequisite, with reason `prerequisite_first` naming the goal concept.
- **Interleaving and interference.** When filling a session, never place two
  needs on the same concept adjacent, alternate kinds where possible, and do
  not put two `confusableWith` concepts in the same session unless one is a
  `discriminate` need (which is the point). Reason strings say so
  (`interleaved`, `interference_avoided`).
- **Illusion of understanding.** A concept with exposure evidence only
  (grader `exposure` or `self-report` and nothing else) produces a
  `retrieve` need with reason `exposure_only` and the copy "You have read
  about this. You have not retrieved it yet." Exposure alone never exceeds
  `uncertain` (already true; keep the test).
- **Minimum effective dose.** `computeNeeds` budgets by minutes and prefers
  many short retrievals over one long one when a budget is given; needs
  carry `minutes` from the registry, retrieve needs at most 4 minutes.
- **Audits, not grades.** A failed claim creates a `repair` need (kind
  `repair_misconception` when a misconception is recorded, `reassess`
  otherwise) instead of only lowering the band.
- Every reason string that reaches a person is plain English and short. The
  SPEC documents the formulas with the source notes cited.

### Writing

All prose that a person reads (the hub, creators, philosophy, judges pages;
README; PHILOSOPHY, JUDGE_GUIDE, DEVPOST, SUBMISSION) is rewritten in the
voice of a good essayist: first person plural where the team speaks, first
person singular is fine in the philosophy, short declarative sentences,
concrete examples before abstractions, one idea per paragraph, no hype, no
lists of three, no em dashes, no title case headings, no aphorism formulas,
claims that come from the source notes are attributed to Skycak and to the
Moontower essay by name and link. Then every text passes the humanizer rules
(`~/.claude/skills/humanizer/SKILL.md`) in file mode. The philosophy page
becomes the essay of the project: why the web is where most learning
happens, why evidence beats grades, why memory needs you to come back, why
the encompassing graph changes what "review" means, why the agent should
manage learning rather than explain, and why nema refuses to make effort
disappear.

## 31. The extension panel is one calm surface (owner decision, 2026-09-04)

Owner: "la extension habria que simplificarla, es demasiado compleja ahora
mismo." The panel had stacked onboarding, a "This page" strip with tool lists,
a tool call log, alignments, a Next card with a rubric, requirement rows,
bands, a "More" section with by hand forms, toasts and folds. It becomes three
states and nothing else on screen, in the spirit of the three second layer used
everywhere else ("Learn it once. It counts everywhere.").

The three states, in `packages/nema-extension/sidepanel.js`:

1. **Not a nema page.** The mark, "Learn it once. It counts everywhere.", one
   sentence ending "Learn anywhere you see the nema mark", and one button,
   "Load the demo learner". A vault that already holds evidence drops the button
   and shows the Next card instead. Import a vault file and Start empty move
   under the hood.
2. **A nema page, not shared yet.** One card: "<Site> asks about <n> things you
   may already know", the n rows in plain words with what the vault says about
   each (verified, not sure yet, not yet) as quiet text, never a pill. The
   ability is said the way a person says it: recognize is "recognise", retrieve
   is "from memory", explain is "in your own words", apply is "in practice",
   transfer is "in a new situation", discriminate is "tell apart", so a row
   reads "Cooking ratios, in practice   not sure yet". Then a primary "Review
   request" and a quiet "Not on this visit". Under it, nothing.

   "Review request", not "Share": nothing leaves at that click, it opens the
   step where the learner approves. The vault's own consent modal is that step,
   and in the panel it is the same card with the buttons swapped: the panel's
   ground, no dim, the same rows in the same words, one line "This answer will
   be valid for 30 minutes. Nothing else will leave." in place of the withheld
   list, the expiry sentence and the countdown, then Approve and Deny. `app.js`
   still owns the modal and still settles the promise: `sidepanel.js` renders
   the rows and the line into the modal body, and `sidepanel.css` hides the page
   width copy. `#consent-modal`, `[data-consent-approve]` and
   `[data-consent-deny]` are unchanged, and the origin, the purpose string and
   the learner id stay in the modal's own block under the hood.

   The "Remember this site for 30 days" checkbox lives in that block under the
   hood too. An answer that expires in thirty minutes and an approval that lasts
   thirty days are two different promises, and beside each other they read as
   one. The vault's own hour long auto approval line is hidden in the panel for
   the same reason.
3. **Shared.** One line, "Shared with <Site>. 68 minutes became 27.", then
   "What you did here", the receipts this page produced as they arrive, one row
   each with the activity and one word: kept, waiting, already in your vault.
   "kept", not "verified": nema verified a signature, not the learner. Then one
   plain sentence for what moved, "Cooking ratios is now usable." The ability by
   ability transition, "Cooking ratios, apply: uncertain to usable, and 3 below
   it", goes under the hood. The empty state is "Nothing yet. Pass something
   here and nema will keep the receipt."

   The card is the visit, not the tab. Which origins were shared with, which
   were told "not on this visit", the line each one earned and the receipts each
   one gave back are written to `chrome.storage.session`, so a side panel closed
   and opened again does not ask the same site twice in the same visit.

State 1 with a vault that already holds evidence is the headline and one
sentence, "Open a page with the nema mark. It will ask here before anything is
shared.", and nothing else: the Next card is under the hood, because a self
reported Done sitting next to a signed receipt reads as the same kind of
evidence and it is not.

Everything else lives in exactly one closed `<details>` at the bottom of the
panel, labelled "Under the hood", and stays functional there: the tool names,
the tool call log with its timings, the full band transition, the two transport
lines below, the alignments with Confirm and Reject, the thirty day approval,
the Next card with its rubric and Done, "Check for receipts now", the two other
first run choices, and the whole vault page (lede, summary, graph, learner
state, needs, ledgers, the "Do it by hand" forms, the tool activity strip). `scripts/build-extension.sh` builds that
structure by rewriting the vault's `<main>`: the extension's three cards, then
the block with the vault inside it. The vault files are still copied, never
edited.

An alignment only the learner can settle surfaces as one quiet line inside
state 2 or 3, "This site calls Maillard reaction 'browning science'. Confirm",
and only while there is one to decide.

Two lines under the hood say which WebMCP is which, so a technical judge who
inspects the panel does not read the whole demonstration as polyfilled:
"Page transport: native WebMCP" or "WebMCP polyfill", read from the tab itself
(`bridge.js` reports whether the polyfill installed itself there, which it only
does when the browser has none), and "Panel transport: extension broker", which
is how the panel reaches that page. The panel's own document is always
polyfilled, `panel-webmcp.js`, and that says nothing about the page in the tab.

Two rules the panel keeps for itself:

- `app.js` opens every `<details>` around a panel it flashes. In the vault that
  is right. In the panel the block holds the whole vault, so the panel closes it
  again unless a person opened it by hand.
- The card counts what would actually be shared: `content.js` summarises a
  manifest's requirements plus every pair a `skipIf` or an `unlock` rule reads,
  which is the set the panel's Share builds.

Look: the vault's own tokens, navy, one accent, 15 px body, generous spacing,
sentence case, no pill and no machine word in the three states.

The extension README leads with the two things a judge meets before the
explanation does: that the prototype runs on all pages so it can detect
published nema tools, and reads only the tool list and the offer those tools
describe before a request is approved; and that the panel keeps a local vault
for this browser profile which does not sync with the web vault, so the demo
learner is loaded inside the panel.

Reviewed by Oracle (GPT-5.6 Sol, Pro thinking), `docs/reviews/oracle-2026-09-04.md`
section 4. Every recommendation in that section is implemented here except one:
alignment decisions still surface as the single quiet line in states 2 and 3,
because the one decision only a person can take is the point of section 23, and
one line is not a second surface.

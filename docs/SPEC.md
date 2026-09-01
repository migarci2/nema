# nema protocol 0.1

Status: draft, implemented by the reference apps in this repository.
Protocol identifier: `nema/0.1`. Concept namespace: `nema:`.

This document is normative for the reference implementation. It is derived from
`docs/CONTRACT.md`; where the two disagree, the contract wins.

---

## 1. What the protocol does

Three roles, one browser.

| Role | Holds | Publishes as WebMCP tools |
|---|---|---|
| Vault | the learner's evidence ledger and keys | state summaries, disclosure, receipt intake, learning needs |
| Provider | courses, activities, graders, an issuer key | a manifest, path personalization, activity control, receipt issuance |
| Agent | nothing durable | no tools; it calls the tools of the pages it can see |

Five objects move between them. A provider publishes a `LearningManifest` and a
`ReadinessRequest`. The vault answers with a signed `ReadinessAssertion`. The
learner does the work in the provider's page and the provider signs an
`EvidenceReceipt`. The vault takes the receipt, recomputes state, and can emit
`LearningNeed` objects for a coach to work from.

```
provider --LearningManifest--> agent --ReadinessRequest--> vault
vault --ReadinessAssertion (signed, audience bound)--> agent --> provider
provider --EvidenceReceipt (signed by issuer)--> agent --> vault
vault --LearningNeed--> agent --> the learner, in chat
```

The agent never holds authority. It moves strings and explains them.

---

## 2. Vocabulary

**Concept ids** are `nema:<kebab-case>` and come from `shared/concepts.json`.

**Abilities** form an ordered ladder, plus one side ability:

```
recognize < retrieve < explain < apply < transfer
discriminate            (side ability, not on the ladder)
```

**Evidence types**: `recognition`, `retrieval`, `explanation`, `application`,
`transfer`, `discrimination`.

**Results**: `passed`, `partial`, `failed`.

**Grader types and evidence weights.** The vault owns these numbers. Providers
declare which grader produced a claim, they do not declare how much it counts.

| grader | weight | meaning |
|---|---|---|
| `deterministic` | 1.0 | machine checkable answer key |
| `provider-rubric` | 0.8 | provider rubric applied to free text |
| `agent-assessed` | 0.6 | an agent judged the answer against a vault rubric |
| `self-report` | 0.3 | the learner says so |
| `exposure` | 0.1 | the learner read or watched the material |

**Learner state bands** per (concept, ability): `unknown`, `uncertain`,
`fragile`, `usable`, `durable`.

**Assertion status**, which is all a provider ever sees:

| band | status | meaning to the provider |
|---|---|---|
| `durable`, `usable` | `verified` | assume it, skip the teaching |
| `fragile`, `uncertain` | `uncertain` | offer a short check first |
| `unknown` | `missing` | teach it |

**Confidence**: `high`, `medium`, `low`. Attached to each assertion entry.

---

## 3. The six objects

### 3.1 Concept (registry entry, unsigned)

The shared vocabulary. Providers map their own ids onto it with `aliases`.

```json
{
  "id": "nema:agent-evals",
  "title": "Agent evals",
  "summary": "Task level evaluation of an agent's end to end behaviour, as opposed to unit tests of its functions.",
  "prereqs": ["nema:software-testing", "nema:agent-loop"],
  "confusableWith": ["nema:unit-testing"],
  "misconceptions": [
    { "id": "unit_tests_are_equivalent_to_agent_evals", "text": "If the unit tests pass, the agent works." }
  ],
  "rubric": {
    "explain": ["names the unit of evaluation", "distinguishes step level from task level"],
    "apply": ["writes an acceptance check for a task", "covers one failure mode"],
    "discriminate": ["gives one case where unit tests pass and the agent fails"]
  },
  "minutes": { "retrieve": 3, "explain": 4, "apply": 6, "discriminate": 4 },
  "aliases": { "harness": "agent-evaluation", "security": "agent-evals" }
}
```

### 3.2 LearningManifest (unsigned, returned by a provider)

What a unit teaches, what it assumes, and what evidence each activity can
produce. This is the object that lets an agent plan before the learner commits.

```json
{
  "protocol": "nema/0.1",
  "provider": {
    "origin": "https://nema-harness.migarci2.dev",
    "name": "Harness Engineering Lab",
    "keyId": "harness-2026-09"
  },
  "unit": {
    "id": "agent-evals-foundations",
    "version": "1.0.0",
    "title": "Designing Agent Evals",
    "estimatedMinutes": 68,
    "language": "en",
    "price": "free"
  },
  "outcomes": [ { "concept": "nema:agent-evals", "ability": "apply" } ],
  "requirements": [ { "concept": "nema:software-testing", "ability": "apply" } ],
  "activities": [
    {
      "id": "eval-design-lab",
      "type": "interactive-lab",
      "title": "Fix the broken harness",
      "minutes": 18,
      "evidenceProduced": "application",
      "grader": "deterministic",
      "outcomes": [ { "concept": "nema:agent-evals", "ability": "apply" } ],
      "skipIf": []
    }
  ]
}
```

Activity `type` is one of `lesson`, `diagnostic`, `interactive-lab`,
`free-recall`.

`skipIf` is a list of `{ concept, ability, status }`. The activity is skipped
when every entry is satisfied by the assertion. `verified` satisfies
`verified`; `verified` or `uncertain` satisfies `uncertain`.

`onlyIf` has the same shape and includes an activity only when every entry
matches the assertion status exactly. It exists for diagnostics that are only
worth running when a requirement came back `uncertain`.

### 3.3 ReadinessRequest (unsigned, provider to vault, carried by the agent)

```json
{
  "protocol": "nema/0.1",
  "audience": "https://nema-harness.migarci2.dev",
  "purpose": "personalize-agent-evals-path",
  "requirements": [ { "concept": "nema:software-testing", "ability": "apply" } ]
}
```

`requestHash = sha256(JSON.stringify(request))`, formatted as `"sha256:" + hex`.
The vault copies it into the assertion so the disclosure can be tied back to the
exact question that was asked.

### 3.4 ReadinessAssertion (signed by the vault)

```json
{
  "type": "readiness-assertion",
  "protocol": "nema/0.1",
  "audience": "https://nema-harness.migarci2.dev",
  "purpose": "personalize-agent-evals-path",
  "requestHash": "sha256:6b1f...",
  "learnerKeyId": "lk_Qm9wS2pMbk4xR3Zq",
  "assertions": [
    { "concept": "nema:software-testing", "ability": "apply", "status": "verified", "confidence": "high" },
    { "concept": "nema:json-schema", "ability": "apply", "status": "uncertain", "confidence": "low" }
  ],
  "issuedAt": "2026-09-02T10:00:00Z",
  "expiresAt": "2026-09-02T10:30:00Z",
  "vaultKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
}
```

Rules:

- The assertion is self certifying. The verifier uses the embedded `vaultKey`.
  There is no directory of learners to look anything up in.
- `learnerKeyId = "lk_" + b64url(sha256bytes(vaultKey.x + "|" + audience)).slice(0, 16)`.
  The same learner is a different id at every provider, and no provider can
  compute another provider's id.
- The assertion carries only the concepts the request asked for. No history, no
  dates of study, no attempt counts, no other subjects, no misconceptions, no
  review schedule, no provider history.
- Lifetime is 30 minutes. There is no refresh: the agent asks again, and the
  learner approves again.

### 3.5 EvidenceReceipt (signed by a provider)

```json
{
  "type": "evidence-receipt",
  "protocol": "nema/0.1",
  "receiptId": "rcpt_8Kd2mQx1PbTa",
  "issuer": "https://nema-harness.migarci2.dev",
  "keyId": "harness-2026-09",
  "subject": "lk_Qm9wS2pMbk4xR3Zq",
  "activity": {
    "id": "eval-design-lab",
    "version": "1.0.0",
    "title": "Fix the broken harness",
    "contentHash": "sha256:9ac3..."
  },
  "claims": [
    {
      "concept": "nema:agent-evals",
      "ability": "apply",
      "evidenceType": "application",
      "result": "passed",
      "difficulty": "intermediate"
    }
  ],
  "conditions": {
    "attempts": 2,
    "hintsUsed": 1,
    "durationSeconds": 641,
    "grader": "deterministic",
    "graderVersion": "1"
  },
  "issuedAt": "2026-09-02T10:41:12Z"
}
```

Rules:

- `subject` is the `learnerKeyId` the provider learned from the assertion, so a
  receipt is not a global identifier either.
- `contentHash` is `sha256` over the provider's activity definitions. If the
  provider edits an activity, old receipts stay verifiable and visibly refer to
  a different version of the content.
- A provider may issue a receipt for a `failed` result, which is honest
  evidence. The two demo providers only issue on `passed` or `partial`.
- `conditions` are inputs to the vault's judgement, not to the score. The vault
  reads `grader` and ignores everything a provider might want to weight for you.

### 3.6 LearningNeed (unsigned, produced by the vault)

The vault's answer to "what should I do next", with the rubric a coach needs to
run the exercise without inventing the standard.

```json
{
  "needId": "need_7fQ2xzLb",
  "concept": "nema:agent-evals",
  "ability": "discriminate",
  "kind": "discriminate",
  "reason": ["application_is_strong", "no_discrimination_evidence", "active_goal_depends_on_this_concept"],
  "urgency": 0.87,
  "minutes": 4,
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

---

## 4. Token format

Every signed object travels as one compact string, short enough for an agent to
carry in its context without mangling it.

```
nema1.<b64url(payloadJson)>.<b64url(signature)>
```

- `payloadJson` is the exact UTF-8 JSON produced by the builder, keys in the
  order this spec lists them.
- The signature is ECDSA on P-256 with SHA-256, raw `r || s`, over the UTF-8
  bytes of that exact payload string.
- Verification never re-serializes. It verifies the decoded payload string as
  transmitted, then parses it. Two implementations that disagree about key
  order still interoperate.
- `b64url` is base64url without padding.

API, from `shared/protocol.js`:

```js
export const PROTOCOL = 'nema/0.1';
encodeToken(payloadObj, signatureB64url) -> string
decodeToken(token) -> { payload, payloadString, signature }   // throws on malformed
await signToken(payloadObj, privateJwk) -> string
await verifyToken(token, publicJwk) -> { ok, payload, reason? }
```

Measured against the reference builders, a token is about 950 to 1150
characters: a three requirement `ReadinessAssertion` is around 1100, an
`EvidenceReceipt` with one claim around 980 and with two claims around 1125.
The embedded `vaultKey` and the `contentHash` dominate the payload, so size
grows slowly with the number of claims. That is small enough to travel in an
agent's context and large enough that a model should not be asked to retype it,
which is why the coach carries tokens by handle (`@t1`, `@t2`) and why both the
vault and the providers render every token in a `<textarea>` with a Copy button,
so a human can complete the handoff if the agent damages the string.

---

## 5. Verification rules

### 5.1 A provider verifying a ReadinessAssertion

`verifyAssertion(token, { audience, now })` returns `{ ok, payload, reason }`.
`now` is optional and defaults to the current time.

1. `decodeToken` succeeds, else `malformed`.
2. `payload.type === 'readiness-assertion'` and `payload.protocol === 'nema/0.1'`,
   else `malformed`.
3. Signature verifies against `payload.vaultKey`, else `bad-signature`.
4. `payload.audience` equals the verifier's own origin, else `wrong-audience`.
5. `payload.expiresAt > now`, else `expired`.

Nothing else is trusted. A provider must not treat a missing concept as a
failure.

What a provider may keep: the latest assertion payload, as its own session
state, so the page can redraw the personalized path on reload. The reference
providers store it in `localStorage` under `nema.<app>.v1` as
`assertion: { payload, receivedAt }`. What a provider must not do: forward the
token to anyone, use the payload after `expiresAt`, or present it to another
audience as a credential. It is a statement addressed to one origin at one
moment, not a bearer token for the learner.

### 5.2 A vault verifying an EvidenceReceipt

`verifyReceipt(token, issuerMap, { seenReceiptIds })` where `issuerMap` maps
`keyId -> { origin, jwk, name, id }` and `seenReceiptIds` is the set of receipt
ids already in the ledger.

1. `decodeToken` succeeds, else `malformed`.
2. `payload.type === 'evidence-receipt'`, else `malformed`.
3. `issuers[payload.keyId]` exists and `issuers[payload.keyId].origin === payload.issuer`,
   else `unknown-issuer`. The receipt is stored with status `pending` and
   changes no state. It stays visible in the ledger.
4. Signature verifies against the issuer JWK, else `bad-signature`. Rejected.
5. `payload.receiptId` has not been seen before, else `duplicate`. Rejected.

Only receipts that pass all five become `verified` and feed the derivation.

### 5.3 Trusted issuers

`shared/issuers.json` maps a short name to `{ kid, jwk }`.
`buildIssuerMap(issuersJson, originsMap)`, also exported as `loadIssuers`, joins
it with the resolved origins to produce `keyId -> { origin, jwk, name, id }`. It
is a pure function: the caller decides how the two JSON documents are loaded, so
the module runs unchanged in a browser, in a Worker and in Node.
The `seed` issuer maps to origin `urn:nema:seed` and the name "nema demo seed",
so demo evidence is labelled as such in the ledger and never pretends to come
from a real provider.

Private keys live in `secrets/issuer-private-keys.json`, which is gitignored,
and in the deployed Workers as the secret `ISSUER_PRIVATE_JWK`.

---

## 6. Inference rules

Pure functions in `shared/inference.js`. The vault stores no state. It derives
state from the ledger on every read, so the same receipts always produce the
same bands and any observer can reproduce them.

### 6.1 Scoring

For each (concept, ability):

- A claim contributes to its own ability and to every lower ability on the
  ladder. A passing `apply` claim also supports `explain`, `retrieve` and
  `recognize`. `discriminate` claims contribute only to `discriminate`.
- `resultValue`: `passed` 1, `partial` 0.5, `failed` -0.5.
- `recency = exp(-daysSince / 60)`.
- `value = weight(grader) * resultValue * recency`.
- `score = sum(values)`.

Bands:

| score | band |
|---|---|
| `>= 1.6` | `durable` |
| `>= 0.9` | `usable` |
| `>= 0.4` | `fragile` |
| `> 0` | `uncertain` |
| otherwise | `unknown` |

Two caps keep weak evidence honest:

- If the best grader weight for an ability is `exposure` (0.1), the band is
  capped at `uncertain`. Reading a page is not a claim about recall.
- Exposure grade evidence never counts as a pass, so it never schedules or
  postpones a review.

Confidence: `high` when `score >= 1.2` and the best grader weight is `>= 0.8`;
`medium` when `score >= 0.6`; otherwise `low`.

### 6.2 Memory and review

- `passes` is the count of passed claims at that ability or higher.
- `stabilityDays = min(60, 3 * 2 ** (passes - 1))`.
- `nextReview = lastSuccess + stabilityDays`.
- A failed claim after a success resets `stabilityDays` to 3.
- `reviewDue = nextReview < now`.

### 6.3 Needs

`computeNeeds(state, { concepts, goals, misconceptions, now, budgetMinutes })`.

| kind | trigger | urgency |
|---|---|---|
| `retrieve` | `reviewDue` for any ability at or above `retrieve` | `0.6 + 0.4 * overdueDays / 7`, capped at 1 |
| `apply` | `explain` at `usable` or better and `apply` at `fragile` or worse | 0.7 |
| `discriminate` | concept has `confusableWith`, `apply` or `explain` at `usable` or better, no discrimination evidence | 0.65 |
| `acquire` | a goal lists the concept, or a prereq of a goal concept, and every ability is `unknown` | 0.5 |
| `repair_misconception` | the vault has a recorded misconception for the concept | 0.8 |
| `reassess` | evidence exists but the best grader weight is below 0.6 | 0.45 |
| `transfer` | `apply` is `durable` and `transfer` is `unknown` | 0.35 |

Ranking:

- `goalRelevance` is 1.5 when the concept is in an active goal, 1.2 when it is a
  prereq of a goal concept, else 1.
- `priority = urgency * goalRelevance / max(2, minutes)`, sorted descending.
- When `budgetMinutes` is given, needs are taken greedily in priority order
  until the budget is full.
- Each need copies `rubric[kind]` or `rubric[ability]` from the concept and
  `minutes` from `concept.minutes[ability]`, defaulting to 4.

### 6.4 Other exports

```js
deriveState(receipts, { now }) -> { [concept]: { [ability]: { band, score, confidence, graderWeight, lastSuccess, stabilityDays, nextReview, reviewDue, evidenceRefs } } }
toAssertionStatus(band) -> 'verified' | 'uncertain' | 'missing'
bandToConfidence(band, score) -> 'high' | 'medium' | 'low'
diffStates(before, after) -> [{ concept, ability, from, to }]
summarize(state, { now }) -> { concepts, durable, usable, fragile, uncertain, unknown, reviewsDue }
```

`diffStates` is what makes a tool call visible. Staging a receipt returns the
list of bands that moved, and the vault animates exactly those rows.

---

## 7. Tool catalog: vault role

Nine imperative tools, registered with `document.modelContext.registerTool` and
exposed to the coach origin only, plus one declarative form
(`set_learning_goal_form`). `document.modelContext.getTools()` therefore lists
ten. Every result is a JSON object with a `status` field.

| tool | input | returns |
|---|---|---|
| `get_vault_summary` | `{}` | `{ status:'ok', concepts, durable, usable, fragile, uncertain, reviewsDue, goals:[{goalId,title}], receipts, pendingReceipts, disclosures }` |
| `get_learner_state` | `{ concepts?: string[] }` | `{ status:'ok', state:[{ concept, title, bands:{ ability: band }, nextReview, reviewDue }] }` |
| `set_learning_goal` | `{ title: string, concepts: string[] }` | `{ status:'ok', goalId }` |
| `create_readiness_assertion` | `{ audience: string, purpose: string, requirements:[{concept, ability}] }` | `{ status:'approved', token, expiresAt, shared:[{concept,ability,status}], withheld:[...] }`, or `{ status:'denied' }`, or `{ status:'timeout', hint }` after 120 seconds |
| `stage_evidence_receipt` | `{ token: string }` | `{ status:'accepted', receiptId, issuer, issuerName, activity, claims, changes:[{concept,ability,from,to}], reviewsScheduled:[{concept,nextReview}] }`, or `{ status:'pending', reason:'unknown-issuer' }`, or `{ status:'rejected', reason }` with reason `bad-signature`, `duplicate` or `malformed` |
| `get_learning_needs` | `{ budgetMinutes?: number }` | `{ status:'ok', budgetMinutes, needs: LearningNeed[] }` |
| `record_agent_assessment` | `{ needId: string, rubricResults:[{ criterion, met }], learnerAnswerSummary: string }` | `{ status:'accepted', receiptId, result, changes }` |
| `get_disclosure_ledger` | `{}` | `{ status:'ok', disclosures:[{ audience, purpose, requestHash, sharedAt, expiresAt, shared, withheld }] }` |
| `get_evidence_ledger` | `{ limit?: number }` | `{ status:'ok', receipts:[{ receiptId, issuerName, activity, claims, grader, signature:'verified'\|'pending'\|'agent', receivedAt, effect }] }` |

Behaviour that matters:

- `get_learner_state` returns bands. Never scores, never receipts, never dates
  of study. Its description says so, because the agent reads descriptions.
- `create_readiness_assertion` opens a consent modal in the page and blocks
  until the human decides. There is no auto approve by default; the modal
  offers "auto approve this provider for 1 hour" as an explicit choice.
- `record_agent_assessment` writes a receipt with `grader: 'agent-assessed'`,
  weight 0.6. It carries no signature, because no issuer key produced it. It is
  stored with status `verified`, so it does count, and `get_evidence_ledger`
  reports it as `signature: 'agent'`, which the ledger renders as the "agent
  assessed" badge rather than the cyan verified one. It rejects `needId` values
  the vault did not issue, so an agent cannot invent an assessment for an
  exercise that never happened.
  `result` is `passed` when all rubric criteria are met, `partial` when at least
  half are, `failed` otherwise.
- `set_learning_goal` is also exposed declaratively as
  `<form toolname="set_learning_goal_form">`, so both WebMCP registration styles
  are demonstrated on the same page without a duplicate tool name.

---

## 8. Tool catalog: provider role

Both demo providers implement the same five tools, with one difference in the
second one.

| tool | input | returns |
|---|---|---|
| `describe_learning_offer` | `{}` | `{ status:'ok', manifest }` |
| `personalize_learning_path` (harness) | `{ assertionToken: string }` | `{ status:'personalized', learnerKeyId, requirements:[{concept,ability,status}], path:[{activityId,title,minutes,type,reason}], skipped:[{activityId,reason}], fullMinutes, personalMinutes }`, or `{ status:'rejected', reason }` |
| `check_prerequisites` (security) | `{ assertionToken: string }` | `{ status:'checked', recognized:[{concept,ability,status,source:'readiness-assertion'}], unlocked:[activityId], locked:[{activityId, missing:[{concept,ability}]}], recommendedFirst, skippable:[activityId] }` |
| `start_activity` | `{ activityId: string }` | `{ status:'started', activityId, title, type, minutes, whatTheLearnerDoes, note:'The learner completes this in the page. Poll get_attempt_status.' }` |
| `get_attempt_status` | `{ activityId: string }` | `{ status:'not_started'\|'in_progress'\|'passed'\|'failed', attempts, hintsUsed, durationSeconds, feedback? }` |
| `issue_evidence_receipt` | `{ activityId: string }` | `{ status:'issued', token, claims, activity, hint:'Take this token to the vault and call stage_evidence_receipt.' }`, or `{ status:'not-passed' }`. Idempotent: a repeat call returns the stored token. |

`rejected` reasons for the assertion tools are exactly the verification reasons:
`bad-signature`, `wrong-audience`, `expired`, `malformed`.

Signing happens server side. `POST /api/receipt` with
`{ activityId, submission, learnerKeyId, conditions }` re-grades the submission
with the same grader the browser used, returns `422 { status:'not-passed' }` if
it does not pass, and otherwise signs the receipt with `env.ISSUER_PRIVATE_JWK`.
The private key never reaches the browser. `GET /api/manifest` returns the
manifest for anyone with curl.

---

## 9. Forbidden tools

These names must not exist on any nema surface. Their absence is the security
model.

| name | why it does not exist |
|---|---|
| `set_mastery` | state is derived from signed evidence, never written |
| `get_full_history` | history stays in the vault; disclosure is per request and per audience |
| `submit_answer_for_learner` | only the human answers; the agent has no path to the grader |
| `disable_review` | the schedule is a property of the evidence, not a setting |
| `export_vault` | export is a button the human clicks, not a capability an agent can call |

A conformant vault fails conformance if any tool it registers can write a band
directly, return raw receipts to an unbounded audience, or produce an assertion
without a human decision.

---

## 10. Conformance checklist

Ten checks. The reference implementation runs 1 to 6 as unit tests under
`npm test` (`node --test "test/**/*.test.js"`) and 7 to 10 by hand in the
browser during the demo.

1. **Token roundtrip.** `signToken` then `verifyToken` returns `ok: true`.
   Flipping one byte of the payload returns `ok: false`.
2. **Audience binding.** An assertion minted for provider A is rejected by
   provider B with reason `wrong-audience`.
3. **Expiry.** An assertion whose `expiresAt` is in the past is rejected with
   reason `expired`, even with a valid signature.
4. **Unknown issuer.** A receipt signed by a key that is not in `issuers.json`
   returns `{ status:'pending', reason:'unknown-issuer' }`, is visible in the
   ledger, and changes no band.
5. **Replay.** Staging the same `receiptId` twice returns
   `{ status:'rejected', reason:'duplicate' }` and changes no band.
6. **Minimal disclosure.** For any request, the assertion payload contains only
   the fixed key set of section 3.4, and `assertions` contains only concepts
   present in the request.
7. **Derivation.** The seeded ledger produces the documented bands. Adding a
   passing `json-schema.apply` receipt moves that band from `uncertain` to
   `usable`, and the vault shows the change.
8. **Human gate.** `create_readiness_assertion` returns no token until a human
   clicks Approve. Denying returns `{ status:'denied' }` and writes nothing.
9. **No answer path.** `document.modelContext.getTools()` on a provider page
   contains no tool that accepts an answer, and `issue_evidence_receipt`
   returns `{ status:'not-passed' }` until the grader has passed the activity.
10. **Visible effect.** Every tool call changes something on screen and appears
    in the page's tool activity strip with its name and duration.

---

## 11. Implementing a provider in 30 minutes

You need a page, a manifest, a grader and one key.

**1. Generate an issuer key (2 minutes).**

```js
import { generateKeyPair } from '/shared/crypto.js';
const { publicJwk, privateJwk } = await generateKeyPair();
```

Publish `publicJwk` with a `keyId` such as `my-lab-2026-09`. Keep `privateJwk`
on the server.

**2. Write the manifest (10 minutes).** One `LearningManifest` per unit. For
each activity, declare `outcomes`, `evidenceProduced`, `grader`, and either
`skipIf` or `onlyIf`. Map your internal ids to `nema:` concepts. If a concept
you teach is missing from the registry, open a pull request against
`shared/concepts.json`; do not invent an id in your own namespace.

**3. Register five tools (5 minutes).**

```js
import { registerTools } from '/shared/webmcp.js';
import { ORIGINS } from '/shared/origins.js';

await registerTools([
  {
    name: 'describe_learning_offer',
    description: 'Return this unit\'s learning manifest: outcomes, requirements and activities. Shows the unit card in the page.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    async execute() { return { status: 'ok', manifest: MANIFEST }; }
  },
  // personalize_learning_path, start_activity, get_attempt_status, issue_evidence_receipt
], { exposedTo: [ORIGINS.coach] });
```

**4. Verify assertions (5 minutes).**

```js
import { verifyAssertion } from '/shared/protocol.js';

const res = await verifyAssertion(assertionToken, { audience: location.origin });
if (!res.ok) return { status: 'rejected', reason: res.reason };
const byConcept = new Map(res.payload.assertions.map(a => [a.concept + '.' + a.ability, a.status]));
```

Then drop every activity whose `skipIf` entries are all satisfied, and keep
every activity whose `onlyIf` entries all match. Show the learner the full path
and the personal path side by side, with the reason on each skipped item.

**5. Issue receipts (8 minutes).** Grade on the server, sign there, return the
token. Never grade only in the browser, and never sign in the browser.

```js
import { signToken } from '/shared/protocol.js';

const payload = {
  type: 'evidence-receipt', protocol: 'nema/0.1',
  receiptId, issuer: ORIGINS.myapp, keyId,
  subject: learnerKeyId, activity, claims, conditions,
  issuedAt: new Date().toISOString()
};
const token = await signToken(payload, privateJwk);
```

Rules you must not break:

- No tool submits an answer on the learner's behalf.
- No receipt is issued for an activity the grader did not pass.
- The assertion is session state, not a credential. Keep at most the latest
  payload for your own page, never forward it, never use it past `expiresAt`.
- Every tool call moves something on the page.

That is the whole integration. A provider that does these five things is
interoperable with any nema vault, and with any other provider, without a
partnership, an account or a shared database.

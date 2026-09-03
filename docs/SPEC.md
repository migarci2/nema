# nema protocol 0.1

**Learn it once. It counts everywhere.** Learn something on one site, and the
next one already knows. You decide what gets shared, every time. The picture is
on [the hub](https://nema.migarci2.dev/).

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
| Agent | nothing durable | no tools; it calls the tools of the pages it can see. It is whichever agent the reader already uses, and every flow also works with none |

Five objects move between them. A provider publishes a `LearningManifest` and a
`ReadinessRequest`. The vault answers with a signed `ReadinessAssertion`. The
learner does the work in the provider's page and the provider signs an
`EvidenceReceipt`. The vault takes the receipt, recomputes state, and can emit
`LearningNeed` objects for the learner's own agent to work from.

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
An id without that prefix is a local id, private to the origin of the manifest
that published it, and means nothing to a vault until the learner says what it
means. Section 13.

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
  "id": "nema:emulsions",
  "title": "Emulsions",
  "summary": "Holding fat and water in suspension as droplets, with an emulsifier and a temperature window that keeps them from coalescing.",
  "prereqs": ["nema:heat-control", "nema:ratios"],
  "confusableWith": ["nema:reduction"],
  "misconceptions": [
    { "id": "a_sauce_can_be_boiled_once_it_holds", "text": "Once a butter sauce has come together it is stable, so it can go back to the boil." }
  ],
  "rubric": {
    "explain": ["names the two phases and which one is dispersed", "names an emulsifier and what it does at the interface", "gives the temperature window a butter emulsion survives, roughly 50 to 60 C"],
    "apply": ["mounts a sauce that coats the back of a spoon", "keeps the pan off direct heat while the fat goes in", "brings a broken sauce back with a splash of cold liquid and hard whisking"],
    "discriminate": ["separates an emulsion that thickened from a liquid that merely reduced"]
  },
  "minutes": { "retrieve": 3, "explain": 4, "apply": 6, "discriminate": 4 },
  "aliases": { "harness": "sauce-emulsion", "security": "emulsified-sauce" }
}
```

The `aliases` keys are the provider's own internal id for that concept, keyed
by the app directory that owns it (`apps/harness` is Saucier School,
`apps/security` is Line Cook Lab). Aliases are how a provider maps its
catalogue onto the shared registry without renaming anything of its own.

### 3.2 LearningManifest (unsigned, returned by a provider)

What a unit teaches, what it assumes, and what evidence each activity can
produce. This is the object that lets an agent plan before the learner commits.

```json
{
  "protocol": "nema/0.1",
  "provider": {
    "origin": "https://saucier.migarci2.dev",
    "name": "Saucier School",
    "keyId": "saucier-2026-09"
  },
  "unit": {
    "id": "pan-sauces-foundations",
    "version": "1.0.0",
    "title": "Pan Sauces and Emulsions",
    "estimatedMinutes": 68,
    "language": "en",
    "price": "free"
  },
  "outcomes": [ { "concept": "nema:pan-sauces", "ability": "apply" } ],
  "requirements": [ { "concept": "nema:knife-skills", "ability": "apply" } ],
  "activities": [
    {
      "id": "fix-the-broken-sauce",
      "type": "interactive-lab",
      "title": "Fix the broken sauce",
      "minutes": 12,
      "evidenceProduced": "application",
      "grader": "deterministic",
      "outcomes": [ { "concept": "nema:pan-sauces", "ability": "apply" } ],
      "skipIf": []
    }
  ]
}
```

A manifest may also carry `concepts`, the site's own vocabulary, and then use
those local ids in `outcomes`, `requirements`, `skipIf` and receipt claims.
Section 13 says what a vault does with them.

```json
"concepts": [
  { "id": "browning-science", "title": "Browning science" },
  { "id": "sugar-browning", "title": "Sugar browning",
    "alignsTo": [ { "concept": "nema:caramelization", "relation": "equivalent" } ] }
]
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
  "audience": "https://saucier.migarci2.dev",
  "purpose": "personalize-pan-sauces-path",
  "requirements": [ { "concept": "nema:knife-skills", "ability": "apply" } ]
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
  "audience": "https://saucier.migarci2.dev",
  "purpose": "personalize-pan-sauces-path",
  "requestHash": "sha256:6b1f...",
  "learnerKeyId": "lk_Qm9wS2pMbk4xR3Zq",
  "assertions": [
    { "concept": "nema:knife-skills", "ability": "apply", "status": "verified", "confidence": "high" },
    { "concept": "nema:ratios", "ability": "apply", "status": "uncertain", "confidence": "low" }
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
- An entry may carry two more fields when the site asked in its own vocabulary:
  `alignedTo`, the registry concept the band was read from, and `reason`, which
  is `"unaligned"` on a `missing` answer to a local id this vault has no
  confirmed alignment for. Both are optional strings. Section 13.
- Lifetime is 30 minutes. There is no refresh: the agent asks again, and the
  learner approves again.

### 3.5 EvidenceReceipt (signed by a provider)

```json
{
  "type": "evidence-receipt",
  "protocol": "nema/0.1",
  "receiptId": "rcpt_8Kd2mQx1PbTa",
  "issuer": "https://saucier.migarci2.dev",
  "keyId": "saucier-2026-09",
  "subject": "lk_Qm9wS2pMbk4xR3Zq",
  "activity": {
    "id": "fix-the-broken-sauce",
    "version": "1.0.0",
    "title": "Fix the broken sauce",
    "contentHash": "sha256:9ac3..."
  },
  "claims": [
    {
      "concept": "nema:pan-sauces",
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

An optional `issuerKey` (a public JWK) may follow `keyId`. A page that signs
with a key nobody has registered includes it, so the receipt is self
certifying in the same way an assertion is. The one tag install of section 12
always does, with `keyId: "self:<origin>"`.

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

The vault's answer to "what should I do next", with the rubric an agent needs
to run the exercise without inventing the standard.

```json
{
  "needId": "need_7fQ2xzLb",
  "concept": "nema:maillard-reaction",
  "ability": "discriminate",
  "kind": "discriminate",
  "reason": ["application_is_strong", "no_discrimination_evidence"],
  "urgency": 0.65,
  "minutes": 4,
  "confusableWith": "nema:caramelization",
  "exerciseHint": "compare-and-contrast with one concrete case from the pass",
  "rubric": [
    "separates the browning of amino acids with reducing sugars from the browning of sugar alone",
    "names the rough onset of each, about 140 C for Maillard, about 160 to 170 C for table sugar",
    "gives one dish where both run at once and says which one is doing the work"
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
which is why the vault and every provider render each token in a `<textarea>`
with a Copy button, so a human can complete the handoff by hand if the agent
damages the string or if there is no agent at all.

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
3. A key is found. First `issuers[payload.keyId]` whose `origin` equals
   `payload.issuer`, which earns `trust: 'registered'`. Otherwise
   `payload.issuerKey`, when `payload.keyId` starts with `self:`, which earns
   `trust: 'self'`. A registered key always wins, so a site cannot claim a
   registered keyId and hand over a key of its own with it. If neither
   matches: `unknown-issuer`, `trust: 'pending'`, stored, visible in the
   ledger, changing no state.
4. Signature verifies against that key, else `bad-signature` at
   `trust: 'pending'`. A signature that does not check out earns nothing,
   whichever key it named.
5. `payload.receiptId` has not been seen before, else `duplicate`. Rejected.

The result is `{ ok, payload, issuer, trust, reason? }`. Only receipts that pass
all five become `verified` and feed the derivation.

`verifyReceipt` does no I/O, so it never returns `origin`. That tier is the
caller's to award: fetch `https://<issuer>/.well-known/nema-issuer.json` and
pass it with the payload to `matchesPublishedKey(payload, published)`, which is
true only when the published `keyId` and `jwk` are exactly the ones that signed.
The vault does this for every `self` receipt at intake.

### 5.2.1 Trust tiers

A verified signature says who signed, not how much it is worth. The vault
stores a `trust` field on every receipt and the ledger prints it as a word.

| trust | how it is established | evidence weight |
|---|---|---|
| `registered` | `keyId` is in `shared/issuers.json` and its origin matches | full, per the section 2 table |
| `origin` | `issuerKey` verifies the signature, and `https://<issuer>/.well-known/nema-issuer.json` returns the same keyId and jwk | full |
| `self` | `issuerKey` verifies the signature, nothing else vouches for it | capped at the `self-report` weight, 0.3, whatever grader the receipt declares |
| `pending` | no key matched | none |

The cap is applied in the derivation, not at intake: `deriveState` takes an
optional `weightCap(receipt)` and the vault passes the tier rule. So a self
certified page can say "this reader answered my quiz" and be believed exactly
as much as a learner saying it about themselves. It can vouch for itself and
for nobody else, which is what makes a one tag install safe to accept from a
stranger.

The `/.well-known/nema-issuer.json` document is `{ "keyId", "jwk" }`, served
with `Access-Control-Allow-Origin: *`. It is the whole upgrade path from `self`
to `origin`: no registration, no partnership, no review.

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
deriveState(receipts, { now }) -> { [concept]: { [ability]: { band, score, confidence, graderWeight, passes, gradedPasses, gradedScore, lastSuccess, lastGradedPass, lastFailure, stabilityDays, nextReview, reviewDue, evidenceRefs } } }
toAssertionStatus(band) -> 'verified' | 'uncertain' | 'missing'
bandToConfidence(band, score) -> 'high' | 'medium' | 'low'
diffStates(before, after) -> [{ concept, ability, from, to }]
summarize(state, { now }) -> { concepts, durable, usable, fragile, uncertain, unknown, reviewsDue }
applyImplicitRepetition(state, { concepts, now }) -> state
encompassedPrereqs(concept, registry) -> Map<conceptId, { fraction, level }>
```

`diffStates` is what makes a tool call visible. Staging a receipt returns the
list of bands that moved, and the vault animates exactly those rows.

Section 15 is the rest of the learner model: the encompassing graph these rules
feed, the rules that turn needs into a session, and where all of it comes from.

---

## 7. Tool catalog: vault role

Eleven imperative tools, registered with `document.modelContext.registerTool`
on the page that owns the data, plus one declarative form
(`set_learning_goal_form`). `document.modelContext.getTools()` therefore lists
twelve. Every result is a JSON object with a `status` field.

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
| `get_evidence_ledger` | `{ limit?: number }` | `{ status:'ok', receipts:[{ receiptId, issuerName, activity, claims, grader, signature:'verified'\|'pending'\|'agent'\|'self-check', receivedAt, effect }] }` |
| `propose_concept_alignment` | `{ origin, providerConcept, concept, relation, rationale }` | `{ status:'proposed', alignmentId }`, or `{ status:'exists', alignmentId, current }`, or `{ status:'error', error }` |
| `get_concept_alignments` | `{ origin?: string }` | `{ status:'ok', alignments: Alignment[] }` |

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
- `propose_concept_alignment` translates nothing by itself. It adds a question
  to the vault's Alignments list, and only the learner answers it. See
  section 13.

---

## 8. Tool catalog: provider role

Both demo providers implement the same five tools, with one difference in the
second one. Saucier School (`apps/harness`, https://saucier.migarci2.dev)
personalizes a path; Line Cook Lab (`apps/security`,
https://linecook.migarci2.dev) checks prerequisites and unlocks labs.

| tool | input | returns |
|---|---|---|
| `describe_learning_offer` | `{}` | `{ status:'ok', manifest }` |
| `personalize_learning_path` (Saucier School) | `{ assertionToken: string }` | `{ status:'personalized', learnerKeyId, requirements:[{concept,ability,status}], path:[{activityId,title,minutes,type,reason}], skipped:[{activityId,reason}], fullMinutes, personalMinutes }`, or `{ status:'rejected', reason }` |
| `check_prerequisites` (Line Cook Lab) | `{ assertionToken: string }` | `{ status:'checked', recognized:[{concept,ability,status,source:'readiness-assertion'}], unlocked:[activityId], locked:[{activityId, missing:[{concept,ability}]}], recommendedFirst, skippable:[activityId] }` |
| `start_activity` | `{ activityId: string }` | `{ status:'started', activityId, title, type, minutes, whatTheLearnerDoes, note:'The learner completes this in the page. Poll get_attempt_status.' }` |
| `get_attempt_status` | `{ activityId: string }` | `{ status:'not_started'\|'in_progress'\|'passed'\|'failed', attempts, hintsUsed, durationSeconds, feedback? }` |
| `issue_evidence_receipt` | `{ activityId: string }` | `{ status:'issued', token, claims, activity, hint:'Take this token to the vault and call stage_evidence_receipt.' }`, or `{ status:'not-passed' }`. Idempotent: a repeat call returns the stored token. |

Every teaching page also exposes one declarative form:

```html
<form toolname="present_assertion"
      tooldescription="Present a nema readiness assertion so this page can personalise its path."
      toolautosubmit>
  <textarea name="assertionToken" toolparamdescription="Compact assertion token starting with nema1."></textarea>
</form>
```

It runs the same verification and personalisation path as
`personalize_learning_path` and `check_prerequisites`, and returns the same
result object. It is also the textarea a person pastes into when there is no
agent in the browser, which is the point: the human route and the agent route
are the same code.

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
| `confirm_concept_alignment` | what a site's own name means is the learner's judgement; an agent may propose and read, never decide |
| `record_self_check` | a self report is the learner's own word about themselves, and an agent must not be able to give it for them |

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
   passing `ratios.apply` receipt moves that band from `uncertain` to
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

You need a page, a manifest, a grader and one key. If you have no server, skip
to section 12: the one tag install does all of this for you, and you write only
the manifest.

**1. Generate an issuer key (2 minutes).**

```js
import { generateKeyPair } from '/shared/crypto.js';
const { publicJwk, privateJwk } = await generateKeyPair();
```

Publish `publicJwk` with a `keyId` such as `my-kitchen-2026-09`. Keep
`privateJwk` on the server.

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
]);
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

---

## 12. The one tag install

A site with no backend joins with a manifest and a script.

```html
<script type="application/nema+json">
{ "protocol": "nema/0.1",
  "provider": { "name": "Maillard, explained" },
  "unit": { "id": "maillard-explained", "title": "Why browning tastes like that", "estimatedMinutes": 8 },
  "concepts": [
    { "id": "browning-science", "title": "Browning science" },
    { "id": "sugar-browning", "title": "Sugar browning",
      "alignsTo": [ { "concept": "nema:caramelization", "relation": "equivalent" } ] }
  ],
  "requirements": [ { "concept": "nema:heat-control", "ability": "explain" } ],
  "activities": [
    { "id": "read", "type": "lesson", "title": "Read the article", "minutes": 6,
      "outcomes": [ { "concept": "browning-science", "ability": "recognize" } ] },
    { "id": "check", "type": "quiz", "title": "Two questions before you go", "minutes": 2,
      "outcomes": [ { "concept": "browning-science", "ability": "explain" } ],
      "questions": [ { "id": "q1", "prompt": "...", "options": [ { "id": "a", "text": "..." } ], "answer": "a" } ] }
  ] }
</script>
<script type="module" src="https://nema.migarci2.dev/nema-provider.js"></script>
```

Source: `shared/provider-embed.js`, served from the hub as `/nema-provider.js`.

**What it registers.** The five provider tools of section 8, with the same
names, schemas and return shapes, plus the declarative `present_assertion`
form. `provider.origin` and the unit's `contentHash` are filled in from the
page, so the manifest an agent reads is a complete `LearningManifest`.

**What it renders.** One block where the page puts
`<nema-activities></nema-activities>`, or at the end of `<main>` or `<article>`
when that element is absent: the lesson's "Mark as read" button, the quiz, the
personalised path note once an assertion is presented, and the receipt with a
Copy button and a "Send to vault" link (`<vault>/#receipt=<token>`). Styles are
scoped and inherit the host page's fonts and colours. Nothing about the block
looks like nema except a 16 pixel mark and the words "Works with nema".

**How it grades.** In the page, deterministically, from the `answer` id on each
question. A `lesson` produces `exposure` evidence, weight 0.1. A `quiz`
produces `deterministic` evidence, which the trust tier then caps.

**How it signs.** A P-256 key pair generated in the reader's browser on first
use and kept in `localStorage`. Receipts carry `keyId: "self:<origin>"` and the
public `issuerKey`, so any vault can verify them without knowing the site.

**Optional attributes on the script tag.**

| attribute | effect |
|---|---|
| `data-endpoint="/api/receipt"` | post the submission to the site's own server, same body as section 8; the server's signed receipt replaces the self signed one |
| `data-vault="https://..."` | the vault origin for the "Send to vault" link; defaults to the nema vault |

**Optional trust upgrade, still with no server.** Publish the same public key
at `/.well-known/nema-issuer.json` as `{ "keyId", "jwk" }` with CORS `*`. The
vault fetches it, matches it against the receipt, and treats the issuer as
`origin` published: full weight, no registration.

The reference install is `apps/blog`, one article at
https://maillard.migarci2.dev whose source marks the nema part between two
comments so it can be copied as a template. It names its concepts its own way
on purpose: `sugar-browning` with a declared alignment the site vouches for,
and `browning-science` with none, so a reader arriving with an agent can watch
section 13 happen once.

---

## 13. Concept alignment

The registry is the anchor, and it is closed. That is what makes a band mean
the same thing to two sites that have never heard of each other. But a site
that already has a vocabulary should not have to rename its own material to
join, and the reader should not have to care that two names were the same
thing all along.

So a site may speak its own names, an agent may propose what they mean, and the
learner decides. Nothing is translated by a site, and nothing is translated by
an agent.

### 13.1 Local concept ids

An id without the `nema:` prefix is local to the origin of the manifest that
published it. `browning-science` on `https://maillard.migarci2.dev` and
`browning-science` on another site are two different names that happen to look
alike, and a vault never confuses them: every alignment is stored against an
origin.

Local ids may appear anywhere a registry id may: `outcomes`, `requirements`,
`skipIf`, `onlyIf`, and the `claims` of a signed receipt.

### 13.2 The alignment record

Alignments live in the learner's vault, in `alignments`, next to the receipts.

```json
{
  "alignmentId": "aln_7Yk2pQ4mZr1v",
  "origin": "https://maillard.migarci2.dev",
  "providerConcept": "browning-science",
  "concept": "nema:maillard-reaction",
  "relation": "equivalent",
  "status": "proposed",
  "proposedBy": "agent",
  "rationale": "The whole article is about the Maillard reaction under another name.",
  "proposedAt": "2026-09-02T10:00:00Z",
  "decidedAt": null
}
```

`relation` is `equivalent`, `broader` or `narrower`. `status` is `proposed`,
`confirmed` or `rejected`. `proposedBy` is `agent`, `provider` or `learner`.
An alignment always points a local id at a registry id: it is a translation
into the shared vocabulary, never a second vocabulary of its own.

The learner may also write one, in the vault's own Alignments panel: that
arrives as `proposedBy: 'learner'` and confirmed, because the person proposing
it is the person who decides. It is the path with no agent in the room at all.

Only a `confirmed` alignment translates anything. A vault holds at most one
live alignment per (origin, local id): proposing again returns
`{ status: 'exists' }` with the one already in play, so an agent cannot ask the
same question twice, or ask it again under a different registry id while the
first is unanswered.

### 13.3 A site may vouch for its own names

An `alignsTo` in the manifest arrives as `proposedBy: 'provider'` and
`status: 'confirmed'`: a site is allowed to say what its own words mean. It
shows in the Alignments list like any other, with the site named, and the
learner can reject it. What a site cannot do is overrule a decision the learner
has already made about that name.

The arrival path is `declareAlignments({ origin, concepts })`, a vault function
called by whatever actually read the manifest: the extension panel on the page,
or the vault itself when a site hands it one. There is no tool for it, because
a tool call is an agent's word, and this is the site's.

### 13.4 Translation happens at the vault's edges

Never inside the inference. `shared/inference.js` sees registry ids only, and
knows nothing about any of this.

**Outbound, `create_readiness_assertion`.** A local requirement id is read
through the confirmed alignments of that audience, the band comes from the
registry concept, and the answer goes back under the name the site asked with,
plus `alignedTo`. A local id with no confirmed alignment answers `missing` with
`reason: "unaligned"`, which is the truthful answer: this vault does not know
what that name means. The site's own `skipIf` then matches its own words, which
is why the "you can skip" note survives translation.

**Inbound, `stage_evidence_receipt`.** The receipt is verified, stored and
never rewritten: the claims stay exactly as the issuer signed them. Beside them
the vault keeps a note per claim, `alignedTo` or `pendingAlignment: true`.

**Derivation.** The state is derived from a view of the ledger in which each
local claim is replaced by the registry concept it is confirmed to mean, and
claims still pending are left out. Confirming an alignment therefore moves
bands with no change to the ledger at all, and rejecting it moves them back.
The evidence is what the issuer signed; the alignment is only how the vault
reads it today.

### 13.5 What the relation does

The relation names the direction the meaning survives, and caps the other one.

| relation | site's evidence, counted for the registry concept | registry band, answering the site's requirement |
|---|---|---|
| `equivalent` | in full | in full |
| `narrower` (the site's concept is a part of the registry concept) | in full: evidence about the part is evidence about the whole | `uncertain` at best: knowing the whole does not prove the part |
| `broader` (the site's concept covers more than the registry concept) | as `partial`: a pass on the whole is partial evidence for the part | in full |

Trust and weight are untouched by any of this. Who signed the receipt decides
the weight, and who translated the name never does: the grader weight, the
trust tier and the `self` cap are computed before the name is read and are not
consulted again.

### 13.6 The self check

`recordSelfCheck({ needId, rubricResults })` is a vault function with no tool
behind it. It writes a receipt with `grader: 'self-report'`,
`keyId: 'self-check'`, `issuer: 'urn:nema:self'` and trust `registered`, so a
person can answer their own review question in the vault or the extension panel
with no agent in the room. It is worth 0.3, the weakest thing the vault will
write down, and the ledger labels it "self check" against the issuer "you, in
the vault". Ticking your own box is honest evidence. It is not a certificate.

---

## 14. The connect handshake

Sections 12 and 13 assume something got a token from the vault to the site: an
agent, an extension, or a person with a clipboard. This section is the fourth
way, and the one that needs nothing installed. A site opens the vault in a
popup, the learner approves there, and the vault answers the site with
`postMessage`.

It is a popup and not an iframe because of storage. A popup is a top level
window on the vault's own origin, so it reads the same `nema.vault.v1` the
vault page reads. Chrome partitions third party iframe storage, so an embedded
vault would be a different, empty vault on every site.

### 14.1 The site side: `shared/vault-link.js`

```js
import { connectVault, sendReceiptToVault } from '/shared/vault-link.js';

const result = await connectVault({ vault, request });    // { status, token }
const kept   = await sendReceiptToVault({ vault, token }); // { status, changes }
```

The module has no imports and resolves nothing against the page, so the hub can
serve it to a blog on another origin unchanged. It only opens URLs and listens
for messages: it never signs, never verifies and never reads storage.

| what | rule |
|---|---|
| the window | `<vault>/connect.html#...`, 480 by 720, one at a time |
| the gesture | `window.open` runs synchronously, so call it straight from a click |
| the answer | the first `message` whose `event.origin` is the vault origin and whose `data.type` matches |
| closed | the opener polls `popup.closed` every 500 ms and rejects with `status: 'closed'` |
| blocked | `window.open` returned null, rejects with `status: 'blocked'` |
| busy | one call is already in flight, rejects with `status: 'busy'` |

`connectVault` opens
`<vault>/connect.html#request=<b64url ReadinessRequest JSON>&return=<origin>`.
`sendReceiptToVault` opens
`<vault>/connect.html#receipt=<token>&return=<origin>`. `vault` defaults to
`https://nema-vault.migarci2.dev`; the embed honours `data-vault` on its script
tag, and the two example courses read a `?vault=` query.

### 14.2 The vault side: `/connect.html`

The same modules as the vault page, a compact layout, no graph and no ledgers,
and deliberately no WebMCP tools: an agent that can reach a vault reaches the
vault page, and a second door here would only widen the surface. It reads
`location.hash` as URL search params.

**A request.** The vault checks that `return` equals `request.audience`, and
refuses with "This request is not addressed to the site that opened it" if it
does not. That one comparison is what stops a page from opening this window
with somebody else's request and collecting the token. Then the same consent
modal as the vault page, the same auto approval rule, the same
`createAssertion`. On approve it posts
`{ type: 'nema:assertion', status: 'approved', token }` to `window.opener`
with `targetOrigin = request.audience`, never `'*'`, shows "Shared. You can
close this window" and closes itself after 1.5 s. On deny it posts
`{ type: 'nema:assertion', status: 'denied' }`.

**A receipt.** The same `stageReceipt` pipeline as the tool and the inbox, with
`source: 'site'`, then
`{ type: 'nema:receipt', status, receiptId?, trust?, changes?, reason? }` to
`return`, and "Kept in your vault" with the bands that moved. A receipt whose
issuer is not the origin that opened the window is still staged, because it is
the learner's data whoever carried it, but the answer goes to `return` only.

**No opener.** A person who opened the link by hand sees the same result and a
"Back to the vault" link instead of a window that closes itself. The vault
page keeps handling `#receipt=` as before, so older links still work.

### 14.3 What the pages show

Next to the requirements, a primary **Connect your vault**. It asks for the
manifest's requirements plus every pair a `skipIf` reads, so one approval
answers everything the personalised path is built from, including a site's own
local names. The answer runs the same code as `present_assertion`, and "Paste
an assertion" stays underneath as the fallback.

After a pass, the receipt panel leads with **Keep in my vault**, which takes
the token `issue_evidence_receipt` already signed and shows the vault's answer
in words: "Kept: ratios, now usable". One phrase per concept, naming the
furthest ability that moved, because a claim about `apply` lifts every rung
under it and that is still one piece of news. The token box, Copy and the old
"Send to vault" link move under a "Do it by hand" fold.

A blocked popup is named, not swallowed: "Your browser blocked the vault
window. Allow popups for this site or use the paste box below."

---

## 15. The learner model

Sections 5 and 6 describe how one receipt moves one band. This section
describes the model those bands belong to: what the vault believes about a
person, how that belief decays, and how it decides what they should do next.

The model is an old idea. A tutor who knows what you know, what you have
forgotten, what you are not ready for and where the hole is will beat a class
schedule every time, and the reason that is rare is that doing it by hand does
not scale past a handful of students. Everything here is an attempt to write
that bookkeeping down. The sources are listed at the end, and the working notes
they were read into live in `docs/LEARNING_FAST_NOTES.md`.

Every function below is pure and lives in `shared/inference.js`. Nothing reads
the clock. The vault stores no learner state at all: it derives everything from
the ledger on each read, so any two people with the same receipts and the same
`now` get the same answer.

### 15.1 What the ledger records

`deriveState` builds one entry per concept and ability. Section 6.1 covers the
score and the band. The learner model needs four more numbers from the same
pass over the evidence:

```
passes         passed claims graded above exposure
gradedPasses   passed claims where the grader weight is at least 0.6
gradedScore    the part of the score those graded passes contributed
lastGradedPass the date of the most recent one
lastFailure    the date of the most recent failed claim
```

A pass is **graded** when somebody other than the learner checked it: the
grader is `agent-assessed`, `provider-rubric` or `deterministic`. A self report
and a page read are not. The distinction matters twice below, and both times it
is the same argument: a learner ticking their own box is a useful record and a
poor measurement.

### 15.2 The encompassing graph

A flashcard deck treats every fact as its own island. Cooking does not work
that way, and neither does cryptography or computer architecture. You cannot
mount a pan sauce without controlling heat, holding a ratio and reading an
emulsion, so the person who just sent a pan sauce has practised all three
whether or not anybody wrote it down.

Skycak calls the graph of what you need before something the prerequisite
graph, and the graph of what you implicitly practise while doing something more
advanced the encompassing graph. Math Academy's partial version of the second
is Fractional Implicit Repetition. `applyImplicitRepetition` is our small
version of it.

For a concept `C` at ability `A`, every prerequisite `P` is credited:

```
f        = C.encompasses[P] ?? 0.5
implicit = weight(grader) x resultValue x recency x f

summed over C's graded passes at A, that is exactly

implicit(P, A) += f x gradedScore(C, A)
```

The graph travels one level, to the direct prerequisites. It travels a second
level, at `f squared`, only through a relation the registry marked explicitly:

```
second level, only where C.encompasses names P
implicit(Q, A) += f**2 x gradedScore(C, A)   for every prerequisite Q of P
```

A concept reached both ways keeps the closer fraction, and a concept reached
twice at the same level keeps the larger, never the sum. `encompassedPrereqs`
returns that map, so the graph is inspectable rather than implied.

Two rules keep the credit honest, and both are load bearing:

- **Implicit repetition is repetition.** It only reaches an ability the learner
  has already produced evidence for. Passing a pan sauce lab is not a first
  claim about heat control, because nobody has asked the learner about heat
  control yet, and the vault does not invent claims. The set of concepts and
  abilities in the result is exactly the set that went in.
- **Only graded passes propagate.** A self check or a page read lends nothing
  downwards. A failed claim lends nothing either, in either direction: failing
  a pan sauce is not evidence about the ratio underneath it.

`encompasses` is optional per concept in `shared/concepts.json`, and the
default of 0.5 is deliberately modest. The registry declares a fraction only
where the higher skill genuinely does most of the lower one:

```json
{
  "id": "nema:pan-sauces",
  "prereqs": ["nema:deglazing", "nema:reduction", "nema:emulsions"],
  "encompasses": { "nema:emulsions": 0.8, "nema:deglazing": 0.7, "nema:reduction": 0.6 }
}
```

### 15.3 The schedule the graph moves

Memory decays, and understanding something once is not knowing it. A review is
worth doing when it has become effortful and is still recoverable, and each
success lets the next interval grow. That is section 6.2. The encompassing
graph changes what counts as a success.

An implicit repetition is worth **half a pass**, a quarter at the second level,
and it moves the last success to the day the practice happened:

```
passes'      = passes + sum over sources of gradedPasses(C, A) x 0.5**level
lastSuccess' = max(lastSuccess, latest lastGradedPass among counted sources)
stability'   = min(60, 3 * 2 ** (passes' - 1))
nextReview'  = lastSuccess' + stability'
```

Implicit passes that predate the concept's own last direct success are ignored
by the schedule. The interval that success set already reflects them, and
counting them again would push a review away for work that had already
happened. They still count towards the score, which is a decayed sum of
everything on record.

The practical effect is the point of the whole exercise. A learner who keeps
cooking never sees a review for heat control, because every sear, reduction and
braise is one. New learning is the spaced repetition of what sits under it.

Where this runs matters. The bands the vault shows, and the status a provider
reads, come from `deriveState` alone: they report what the learner actually
produced, and no inference dressed up as evidence ever reaches a provider.
`computeNeeds` applies the encompassing graph to that state before it plans
anything, so the graph decides what to do next and never what to certify.

### 15.4 The edge of mastery

Do not teach X until the prerequisites of X are mastered, and work just outside
the current repertoire rather than far above it. An `acquire` need is therefore
only issued for a concept whose prerequisites are all at `usable` or better.

When one is not, `computeNeeds` walks down the weakest branch: at each step it
takes the prerequisite with the lowest band, breaking ties by the one closest to
being ready and then by id, and stops at the deepest concept whose own
prerequisites are all usable. That concept is the work, and its need says so:

```
reason: ['prerequisite_first', ..., 'before_pan_sauces']
```

The blocked goal keeps a need of its own at a quarter of the urgency, marked
`prerequisites_are_not_ready` and naming what to start with, so a learner who
asked for pan sauces still sees pan sauces on the list. It can never outrank the
prerequisite that unblocks it.

### 15.5 The session planner

Without `budgetMinutes` the result is a ranking, sorted by priority. With a
budget it is a session, which is a different object, and three rules shape it.

**Minimum effective dose.** Thirty calibrated problems with feedback beat one
very hard problem, so a session should hold several attempts rather than one
long exercise. Needs carry `minutes` from the registry, and a `retrieve` need
is capped at four minutes whatever the registry says. The fill is greedy by
priority and keeps scanning after a need does not fit, so a four minute recall
still rides along behind a six minute task that was skipped.

**Interference.** Introducing several confusable things at once is how people
learn to confuse them. Two concepts that name each other in `confusableWith`
never share a session, unless one of them is the `discriminate` need that exists
to tell them apart, which is exactly when they belong together. The need that
stays gains the reason `interference_avoided`.

A related rule sits in the need itself rather than the session: a `discriminate`
need whose confusable neighbour is also at `usable` or better is urgent at 0.8
rather than 0.65, and says `confusable_neighbour_is_strong`. Two strong
neighbours is a live confusion, and it is as urgent as a misconception somebody
wrote down.

**Interleaving.** Practising A, B, C, A, D, B forces the learner to choose the
method instead of repeating the one they were just handed. It feels worse and it
works better. So no two needs on the same concept sit next to each other, and
kinds alternate wherever the session allows it. A need pulled ahead of a higher
priority one to make that work gains the reason `interleaved`.

### 15.6 Two more things the vault refuses to let slide

**The illusion of understanding.** Rereading measures recognition. It feels like
learning because the words look familiar, and familiarity is not recall. A
concept whose evidence is only exposure or self report produces a `retrieve`
need with the reason `exposure_only` and the note "You have read about this. You
have not retrieved it yet." Exposure alone also never lifts a band past
`uncertain`, however many pages the learner reads.

**Audits, not grades.** A failed claim is a node that needs an intervention, not
one point off a total. When a failure is the last thing on record for a concept
the vault asks for a `repair_misconception` need if it has a misconception
written down for that concept, and a `reassess` need otherwise. Both say
`failed_claim_on_record`. A pass after the failure closes it.

### 15.7 The reason strings

Every need carries a `reason` array, and every string in it is meant for a
person. The full set the learner model adds:

| reason | what it means |
|---|---|
| `prerequisite_first` | this is the prerequisite standing between you and a goal |
| `before_<concept>` | the goal it unblocks |
| `prerequisites_are_not_ready` | you asked for this and you are not ready for it yet |
| `start_with_<concept>` | what to do instead |
| `confusable_neighbour_is_strong` | you know both of these well enough to mix them up |
| `exposure_only` | you have read about this and never retrieved it |
| `failed_claim_on_record` | something failed here |
| `nothing_has_confirmed_it_since` | and nothing has answered it |
| `interference_avoided` | a confusable neighbour was left out of this session |
| `interleaved` | this was moved so the session alternates |

### 15.8 Sources

The model is assembled from other people's work, and the claims above belong to
them rather than to us.

- Kris Abdelmessih, "The Principles of Learning Fast", Party at the Moontower.
  <https://moontowermeta.com/the-principles-of-learning-fast/>
- Justin Skycak, "The Pedagogically Optimal Way to Learn Math".
  <https://www.justinmath.com/the-pedagogically-optimal-way-to-learn-math/>
- Justin Skycak, "Individualized Spaced Repetition in Hierarchical Knowledge
  Structures", which is where Fractional Implicit Repetition comes from.
  <https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/>
- Justin Skycak, "Cognitive Science of Learning: Spaced Repetition".
  <https://www.justinmath.com/cognitive-science-of-learning-spaced-repetition/>
- Justin Skycak, "Talent Development vs Traditional Schooling".
  <https://www.justinmath.com/talent-development-vs-traditional-schooling/>
- Justin Skycak, "Why Is the Edtech Industry So Damn Soft?".
  <https://www.justinmath.com/why-is-the-edtech-industry-so-damn-soft/>
- Justin Skycak, "Recreational Mathematics: Why Focus on Projects Over
  Puzzles?".
  <https://www.justinmath.com/recreational-mathematics-why-focus-on-projects-over-puzzles/>
- Math Academy, "How Our AI Works".
  <https://www.mathacademy.com/how-our-ai-works>

The numbers are ours. The fractions, the four minute cap on a retrieval, the
0.8 for a live confusion and the half pass for an implicit repetition are
choices we made and pinned in `test/learning-fast.test.js`, not results anybody
published. They are meant to be argued with.

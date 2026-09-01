# Devpost submission

Copy and paste text for webmcp.devpost.com. English throughout. No emojis.

---

## Project name

nema

## Tagline (Devpost "elevator pitch" field, short)

your learning state, everywhere.

## Elevator pitch, 40 words

Your learning state is trapped inside every site that teaches you. nema puts it
in a vault you own. Websites ask for signed, purpose-bound readiness, your agent
carries it, you approve the disclosure, and a 68 minute course becomes 27.

## Live URLs

- Hub: https://nema.migarci2.dev
- Coach (the agent): https://nema-coach.migarci2.dev
- Vault: https://nema-vault.migarci2.dev
- Harness Lab (provider 1): https://nema-harness.migarci2.dev
- Agent Security (provider 2): https://nema-security.migarci2.dev
- Repository: https://github.com/migarci2/nema (MIT)
- Judge guide: https://github.com/migarci2/nema/blob/main/docs/JUDGE_GUIDE.md

---

## Required answer 1: Why WebMCP fits this problem

Learning is spread across many websites and the learner's state is locked inside
each of them. The usual fix is an integration: API keys, OAuth, a partnership
per pair of companies. That does not scale to the open web, and it hands the
learner's record to whoever owns the integration.

WebMCP changes the shape of the problem. A site declares what it can do as tools
on the page it already serves, and any agent in the browser can call them while
the person watches. That is exactly what this needs. A course site publishes
what it teaches and what it assumes. A learner-owned vault publishes one careful
capability: answer a specific question about readiness, for one audience, after
the human approves it. The agent composes the two.

No accounts, no shared database, no server that sees both sides. Five origins in
this demo, and any sixth one can join by registering five tools and publishing a
public key. WebMCP is the only substrate where a protocol like this is just
pages, and where the human stays in the loop by construction, because the
approval is a modal on the page the tool belongs to.

Word count: 195.

## Required answer 2: How it improves the user experience

Today you finish a course, open a second site, and start from zero. You sit
through a lesson on something you applied at work last month, because the site
cannot know and cannot ask.

With nema the agent asks. The Harness Lab needs three prerequisites. The vault
answers with three status bands, after the learner approves a modal listing
what is shared and what is not. Three lessons are struck through with
the reason next to each one, 41 minutes of them, and a short diagnostic survives
the cut because one prerequisite came back uncertain. 68 minutes becomes 27. The
learner passes the diagnostic, the receipt goes to the vault, the path recomputes
to 21.

Then a second, unrelated site asks the same vault about its own prerequisites.
Two come back verified from evidence it never produced and cannot look up, so
its intro lessons go grey. The one that is missing is named precisely, so the
agent knows what to coach.

The other half is what does not happen. The vault never sends history. The agent
cannot answer for you. Nothing moves without a click.

Word count: 186.

## Required answer 3: What human and agent collaboration becomes possible

A clean division of labour that neither party can perform alone.

The agent reads manifests from several providers, plans a path, explains what a
site is asking for before it asks, carries signed tokens between origins, and
coaches from the vault's `LearningNeed` list, which arrives with the rubric
attached so the agent does not invent the standard.

The human does the learning and holds the authority. Every disclosure is a modal
the human approves. Every activity is answered by the human in the page. Every
band in the vault traces back to a signed receipt from the site that observed
the work.

This is enforced by shape, not by a prompt. There is no `set_mastery`, no
`get_full_history`, no `submit_answer_for_learner`. `issue_evidence_receipt`
returns `not-passed` until the grader has passed a human's submission. The one
agent-originated write, `record_agent_assessment`, requires a need id the vault
issued, is weighted 0.6 against 1.0 for deterministic grading, and shows in the
ledger with its own badge. The agent is a broker with real work to do and no way
to lie about you.

Word count: 176.

## Required answer 4: Implementation approach

Five origins, all plain HTML, CSS and ES modules. No framework, no bundler, no
TypeScript. Each is a Cloudflare Worker serving static assets; the two providers
add one `/api` route. Every page loads the Chrome Labs WebMCP polyfill first, so
tools register with or without Chrome's flag, then registers tools with
`document.modelContext.registerTool`, imperatively and, on two pages,
declaratively with `<form toolname>`. Tools are scoped with
`exposedTo: [coachOrigin]`.

The protocol is five JSON objects, two of them signed, and one compact token
format, `nema1.<b64url payload>.<b64url signature>`, ECDSA P-256 over the exact
transmitted bytes. Assertions are self certifying, audience bound and expire in
30 minutes; `learnerKeyId` is derived per audience so two providers see
different ids for the same person. Receipts are signed in the Worker, never in
the browser.

The vault stores receipts, never state. Bands are derived on every read by pure
functions in `shared/inference.js`, unit tested with `node --test`. Ten
conformance checks cover audience binding, expiry, replay, unknown issuers and
minimal disclosure. The spec is in `docs/SPEC.md`, including how to implement a
provider in 30 minutes.

Word count: 177.

---

## About the project

### Inspiration

Two facts that do not fit together. First, almost every good technical
explanation on the internet is on a site that will never know you again. Second,
every platform that does remember you keeps that memory, and it is the most
valuable thing your studying produced.

We wanted the third option. Let the web keep teaching, the way it does, and move
the memory to the learner. WebMCP made it buildable: a site can now expose "here
is what I teach and what I assume" as a tool call, and a page the learner
controls can expose "here is what I am willing to say about that, if the human
approves".

### What it does

nema is a learning protocol and a learner-owned vault.

The vault holds signed evidence and derives your state from it: per concept, per
ability, a band from unknown to durable. Websites do not read the vault. They
ask a question, and the vault answers with a `ReadinessAssertion`: a signed
token bound to one audience, valid for 30 minutes, containing only the concepts
that were asked for and nothing else, released only after the learner approves a
modal that lists what is shared and what is withheld.

When you complete an activity, the site signs an `EvidenceReceipt`. Your agent
carries it back. The vault verifies the signature against a small issuer list,
rejects replays, and recomputes your bands.

In the demo: a 68 minute course collapses to 27 minutes on the strength of what
you already know, then to 21 after a short diagnostic. A second, unrelated site
asks the same vault about three different concepts, recognises two of them from
evidence it never produced, names the third as missing, and unlocks its advanced
lab once the agent has coached that gap and the vault has recorded it. Two
websites, one vault, no shared accounts, no partnership.

### How we built it

Plain HTML, CSS and ES modules on five Cloudflare Workers. No framework, no
bundler, no dependencies at runtime.

`shared/crypto.js` is Web Crypto: ECDSA P-256, base64url, sha256, working
identically in the browser, in Node and in Workers. `shared/protocol.js` builds
and verifies the objects and the compact token format.
`shared/inference.js` is the vault's brain: pure functions turning a list of
receipts into bands, review dates and prioritised learning needs, with grader
weights from 1.0 for deterministic down to 0.1 for exposure, and recency decay.

Every page loads the Chrome Labs polyfill as a classic script, then registers
tools with `document.modelContext.registerTool`, scoped with `exposedTo`. The
coach is a chat page with an iframe and a token clipboard: any `nema1.` string
in a tool result is stored and replaced with a handle like `@t1`, so a model
never has to reproduce a thousand characters correctly. Tokens measure about 950
to 1150 characters, most of it the embedded vault key and the content hash.

Providers grade and sign in the Worker, so answer keys and private keys stay off
the critical path.

### Challenges we ran into

WebMCP is per document. There is no composition across tabs, so an agent cannot
hold a session across two origins. We designed for that instead of fighting it:
sequential handoff, with every cross origin fact carried as a short signed
token. That constraint produced the best part of the design.

Long strings are hostile to language models. Early runs mangled tokens. The
token clipboard fixed it, and every token also sits in a textarea with a Copy
button so a human can finish the handoff by hand.

Deciding what the vault refuses to do took longer than writing the vault. The
rule we settled on: if a capability could let an agent claim something about the
learner that no human action supports, the tool does not exist.

### Accomplishments that we are proud of

The consent modal. A tool call stops, the page asks, and the token does not
exist until a person clicks. It is the clearest thing in the demo.

The cross provider moment. Two sites that share nothing, no partnership, no
account, no API key, and each one recognises prerequisites it did not teach,
because it verifies one signature from the vault and checks that the token was
minted for its own origin. The vault answers with bands and nothing else, so
neither site learns where the evidence came from.

The absence list. `set_mastery`, `get_full_history`,
`submit_answer_for_learner`, `disable_review`, `export_vault`. None of them
exist, and the README says so, because a security property you can audit by
calling `getTools()` beats a paragraph of policy.

### What we learned

That tool design is policy design. Descriptions get read by the model, but
shapes get enforced by the runtime, so anything that matters belongs in the
shape. Making the mastery write impossible was easier and stronger than telling
a model not to do it.

That WebMCP makes the human step natural rather than awkward. The approval
happens on the page that owns the data, where the person is already looking.

That deriving state instead of storing it removes a whole class of bugs. There
is no drift between the ledger and the display, because the display is a
function of the ledger.

### What is next

Non extractable keys and encrypted export, so the vault key stops living in
`localStorage`. Blinded per audience keys so the assertion stops carrying a
correlatable public key. Assertion revocation, since 30 minute expiry is a blunt
instrument.

Then breadth: a governed concept registry, a provider SDK worth publishing, and
a conformance suite a third party can run against their own vault. The protocol
is small on purpose. The interesting work is a third and fourth provider that we
did not write.

---

## Built with

`webmcp`, `document.modelContext`, `javascript`, `es-modules`, `html`, `css`,
`web-crypto-api`, `ecdsa-p256`, `cloudflare-workers`, `wrangler`,
`workers-ai`, `anthropic-claude`, `node-test-runner`, `svg`

## Suggested tags

`webmcp`, `agentic-web`, `learning`, `edtech`, `privacy`, `user-owned-data`,
`cryptography`, `interoperability`, `protocol`, `cloudflare-workers`,
`human-in-the-loop`, `verifiable-credentials`

## Video

YouTube, 2 minutes 55 seconds, with audio. Shot list in `docs/VIDEO_SCRIPT.md`.

## Prior work note

Everything in this repository was created during the submission period, 25
August to 3 September 2026. The commit history is the evidence. The only third
party code is the Chrome Labs WebMCP polyfill (Apache-2.0, header preserved) and
three open source fonts (OFL), both credited in the README.

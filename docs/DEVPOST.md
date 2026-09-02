# Devpost submission

Copy and paste text for webmcp.devpost.com. English throughout. No emojis.

---

## Project name

nema

## Tagline (Devpost "elevator pitch" field, short)

your learning state, everywhere.

## Elevator pitch, 40 words

nema is a protocol anyone who teaches on the web can install in a minute: one
manifest tag, one script tag. Readers keep signed evidence of what they learned
in a vault they own, the next site asks for it and shortens itself, and a 68
minute cooking course becomes 27.

## Live URLs

- Hub: https://nema.migarci2.dev
- Install guide for creators: https://nema.migarci2.dev/creators.html
- Vault: https://nema-vault.migarci2.dev
- Saucier School (a course site): https://saucier.migarci2.dev
- Line Cook Lab (a second course site): https://linecook.migarci2.dev
- Maillard, explained (a blog post, installed with one tag): https://maillard.migarci2.dev
- The embed itself: https://nema.migarci2.dev/nema-provider.js
- Repository: https://github.com/migarci2/nema (MIT)
- Judge guide: https://github.com/migarci2/nema/blob/main/docs/JUDGE_GUIDE.md

There is no nema agent. Use ChatGPT desktop, Chrome 149 or later, or Claude Code
and Codex over MCP. Every flow also works with no agent at all.

---

## Required answer 1: Why WebMCP fits this problem

Learning is spread across many websites and the learner's state is locked inside
each of them. The usual fix is an integration: API keys, OAuth, a partnership
per pair of companies. That does not scale to the open web.

WebMCP changes the shape of the problem. A site declares what it can do as tools
on the page it already serves, and any agent in the browser can call them while
the person watches. A site that teaches publishes what it teaches and what it
assumes. A learner-owned vault publishes one careful capability: answer a
specific question about readiness, for one audience, after the human approves
it. The agent composes the two.

It also makes the install small enough for the people who really teach on the
web. A blog joins with one manifest tag and one script tag, no backend and no
account, because the tools already live in the page it publishes. Its self
signed receipts are capped at the weight of a self report, so a stranger's site
is safe to accept.

No accounts, no shared database, no server that sees both sides. WebMCP is the
only substrate where a protocol like this is just pages, and where the human
stays in the loop by construction, because the approval is a modal on the page
the tool belongs to.

Word count: 222.

## Required answer 2: How it improves the user experience

Today you open a second site and start from zero. You sit through fifteen
minutes on how to hold a knife, a month after you learned it elsewhere, because
the site cannot know and cannot ask.

With nema the agent asks. Saucier School's pan sauce unit needs three
prerequisites: knife skills, heat control, ratios. The vault answers with three
status bands, after the learner approves a modal listing what is shared and what
is not. Three lessons strike through with the reason beside each, 41 minutes of
them, and a six minute vinaigrette diagnostic survives because one prerequisite
came back uncertain. 68 minutes
becomes 27. The learner passes it, the receipt goes to the vault, the path
recomputes to 21.

Then a second, unrelated site, a drill for line cooks, asks the same vault. Two
of its three requirements come back verified from evidence it never produced, so
its intro lessons go grey, and the missing one is named precisely.

The third site is a blog post that installed nema with two tags. Its readers
walk away with a receipt too.

The other half is what does not happen. The vault never sends history. The agent
cannot answer for you. Nothing moves without a click, and with no agent at all
you copy one token and all of it still happens.

Word count: 221.

## Required answer 3: What human and agent collaboration becomes possible

A clean division of labour that neither party can perform alone.

The agent reads manifests from several sites, plans a path, explains what a site
is asking for before it asks, carries signed tokens between origins, and works
from the vault's `LearningNeed` list, which arrives with the rubric attached so
the agent does not invent the standard. It is whichever agent the person already
uses; nema ships none of its own, and every flow also works with no agent at
all.

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

Word count: 200.

## Required answer 4: Implementation approach

Seven origins, all plain HTML, CSS and ES modules. No framework, no bundler, no
TypeScript. Each is a Cloudflare Worker serving static assets; the two course
sites add one `/api` route, and the blog adds nothing. Every page loads the
Chrome Labs WebMCP polyfill first, so tools register with or without Chrome's
flag, then registers tools with `document.modelContext.registerTool`,
imperatively and, on several pages, declaratively with `<form toolname>`. Tools
live on the page that owns the data, which is what keeps the boundary honest.

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

Word count: 193.

---

The same tool table also runs outside the browser: `packages/nema-mcp` boots the vault inside Node with four shims and serves the eleven tools over MCP, so Claude Code and Codex reach the learner's vault with the same names and schemas that ChatGPT reaches through WebMCP on the page. Consent travels through MCP elicitation. Nothing was rewritten: WebMCP tools turned out to be a good enough contract to be the MCP contract too.

The repo also ships nema as a Chrome extension: the vault as a side panel with a model free broker, one click to share bands with the page you are on and one click to take the receipt home.

Concept alignment is one array in the vault document and no change anywhere else. An alignment record points one origin's local id at one registry id with a relation and a status, and `shared/inference.js` never sees it: derivation runs over a translated view of the ledger in which each confirmed local claim is read as its registry concept and each unconfirmed one is left out. That is why confirming an alignment moves bands with no write to the evidence, and why rejecting it moves them back. Two tools reach it, `propose_concept_alignment` and `get_concept_alignments`, and there is deliberately no third: what a site's own name means is the learner's judgement, so confirming exists only as a button in the vault page and the extension panel.

The connect handshake is `shared/vault-link.js` and `apps/vault/public/connect.html`, and it is the whole no agent path. A site calls `connectVault({ vault, request })` inside a click, which opens `<vault>/connect.html#request=<b64url>&return=<origin>` at 480 by 720. The vault side checks that `return` equals `request.audience` and refuses otherwise, which is the one comparison that stops a page from opening the window with somebody else's request, then runs the same consent modal and the same `createAssertion` as the vault page and posts the token back with `targetOrigin` set to the audience, never `'*'`. `sendReceiptToVault` is the same window in the other direction. The module has no imports, resolves nothing against the page and never signs, verifies or reads storage: the vault decides, and this side only asks.

## About the project

### Inspiration

Two facts that do not fit together. First, almost every good explanation on the
internet, of anything, is on a site that will never know you again. Second,
every platform that does remember you keeps that memory, and it is the most
valuable thing your studying produced.

We wanted the third option. Let the web keep teaching, the way it does, and move
the memory to the learner. WebMCP made it buildable: a site can now expose "here
is what I teach and what I assume" as a tool call, and a page the learner
controls can expose "here is what I am willing to say about that, if the human
approves".

The second thing we wanted was for it to be installable by the people who
actually teach on the web, which is mostly not companies. If joining costs a
partnership, a key exchange or a backend, a blog never joins, and a protocol
only the platforms can implement is another platform.

### What it does

nema is a protocol anyone who teaches on the web can install in a minute, so
every reader keeps what they learned. Sites, blogs, articles, courses: one
manifest tag and one script tag, or five tool registrations if you would rather
write them yourself.

The vault holds signed evidence and derives your state from it: per concept, per
ability, a band from unknown to durable. Websites do not read the vault. They
ask a question, and the vault answers with a `ReadinessAssertion`: a signed
token bound to one audience, valid for 30 minutes, containing only the concepts
that were asked for and nothing else, released only after the learner approves a
modal that lists what is shared and what is withheld.

The model inside the vault is not ours either. It follows the principles of
learning fast that Justin Skycak writes up at justinmath.com and that Kris
Abdelmessih collects in "The Principles of Learning Fast"
(https://moontowermeta.com/the-principles-of-learning-fast/). Knowledge is
hierarchical, so passing something advanced credits every prerequisite under it
at a fraction and pushes its review date out, which is Math Academy's Fractional
Implicit Repetition and the reason review in nema costs less the harder you
work. Needs are proposed at the edge of mastery: the vault asks for a concept
only when its prerequisites are held, and otherwise names the weakest
prerequisite and the goal that prerequisite is blocking. And a session
interleaves, never placing two needs on one concept next to each other and
keeping confusable concepts apart unless telling them apart is the point.

When you complete an activity, the site signs an `EvidenceReceipt`. Your agent
carries it back, or you click "Send to vault". The vault verifies the signature,
rejects replays, recomputes your bands, and records how much that signature is
worth: `registered` for a key in the issuer list, `origin` for a key the site
publishes at `/.well-known/nema-issuer.json`, `self` for a key the page
generated in your own browser. A `self` receipt is capped at the weight of a
self report, 0.3, so a site can vouch for itself and only for itself. That cap
is what makes a one tag install safe to accept from a stranger, and what makes
the protocol installable by a stranger in the first place.

The agent is whichever one you already use: ChatGPT desktop, Chrome 149 or
later, Claude Code or Codex over MCP. nema ships none, and every flow works with
none.

Sites speak their own names, and nema does not ask them to stop. A site that
already calls something `sugar-browning` publishes it under that name, and the
registry stays the anchor underneath. When a name is one the vault does not
know, the agent proposes what it means: `browning-science` is
`nema:maillard-reaction`, here is one sentence saying why. The learner confirms
or rejects it, and only then does the vault translate, at its two edges: a
receipt written in the site's names counts toward the registry concept, and a
requirement asked in the site's names is answered in the site's own words. The
signed evidence is never rewritten. A confirmed alignment moves bands by
changing how the vault reads a ledger it did not touch, and a rejected one moves
them back. A site may also vouch for its own vocabulary in its manifest, which
arrives confirmed on the site's word rather than on a guess.

You do not need an agent, or an extension, to use any of this. A site can talk
to your vault by itself: "Connect your vault" opens the vault's own page in a
small popup, the popup shows the same consent modal, and the answer is posted
back to the page that asked. It is a popup and not an iframe for one reason:
a popup is a top level window on the vault's origin, so it reads the vault you
actually have, and Chrome's storage partitioning would have given an embedded
vault an empty one per site. The same window keeps a receipt after you pass
something. Agent, extension or nothing at all, the three routes end in the same
consent modal and the same ledger.

The two example sites teach cooking, deliberately. Saucier School runs a unit on
pan sauces and emulsions; Line Cook Lab drills service under pressure. A course
about agents would have been read as a description of nema rather than as an
example of it, and a pan sauce is a better test anyway: it is a real skill with
an answer you can taste.

In the demo: a 68 minute unit on pan sauces collapses to 27 minutes on the
strength of what the learner already holds, then to 21 after a six minute
vinaigrette diagnostic. A second, unrelated site asks the same vault about three
different concepts, recognises mise en place and food safety from evidence it
never produced, names emulsions as missing, and unlocks its labs once the agent
has worked through that gap and the vault has recorded it. A third site, a blog
post with two tags and no backend, issues receipts to its readers on the same
protocol. Three websites, one vault, no shared accounts, no partnership.

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
tools with `document.modelContext.registerTool`. Tokens measure about 950 to
1150 characters, most of it the embedded vault key and the content hash, so
every one of them is also rendered in a textarea with a Copy button and every
page that accepts one accepts it pasted, through the same code path as the tool.
That is what makes the no agent route real rather than a fallback.

`shared/provider-embed.js` is the one tag install: it reads a
`application/nema+json` manifest out of the page, registers the same five
provider tools, renders one scoped block in the host page's own fonts, grades
quizzes deterministically in the browser, and signs receipts with a P-256 key it
generates in the reader's browser. Those are self certified, and the vault caps
them at 0.3.

Providers grade and sign in the Worker, so answer keys and private keys stay off
the critical path.

### Challenges we ran into

WebMCP is per document. There is no composition across tabs, so an agent cannot
hold a session across two origins. We designed for that instead of fighting it:
sequential handoff, with every cross origin fact carried as a short signed
token. That constraint produced the best part of the design.

Long strings are hostile to language models. Early runs mangled tokens. Every
token now sits in a textarea with a Copy button and every page that takes one
takes it pasted, so a damaged token is a visible `bad-signature` and a human can
finish the handoff by hand.

Deciding what the vault refuses to do took longer than writing the vault. The
rule we settled on: if a capability could let an agent claim something about the
learner that no human action supports, the tool does not exist.

The example courses used to teach agent engineering, and every early reader
mistook them for a description of nema itself. We moved both providers to
cooking and gave each its own brand, its own palette and its own domain, so the
demo now shows surfaces a person can tell apart at a glance: a vault, and
websites that have nothing to do with us.

We also built an agent of our own, and then deleted it. It was answering the
wrong question. The agent is not the product and was never ours to supply: the
reader already has one, and the flows had to work with any of them, or with
none. Cutting it made the demo shorter and the claim larger.

### Accomplishments that we are proud of

The consent modal. A tool call stops, the page asks, and the token does not
exist until a person clicks. It is the clearest thing in the demo.

The cross provider moment. Two sites that share nothing, no partnership, no
account, no API key, and each one recognises prerequisites it did not teach,
because it verifies one signature from the vault and checks that the token was
minted for its own origin. The vault answers with bands and nothing else, so
neither site learns where the evidence came from.

The two identities. The teaching sites do not wear our brand. They are re-themed
down to the ground colour and the display face, they render their own headers,
and they carry one discreet "Works with nema" badge. When the demo cuts from a
warm paper cooking school to a near black kitchen tool to a plain white blog
post, and the vault answers all three, the claim is being shown rather than
asserted.

The one tag install. A blog post with no backend registers the same five tools,
grades in the page, signs with its own key and issues receipts a vault accepts,
capped and labelled. That is the difference between a protocol two demo sites
speak and a protocol the web can speak.

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

Then breadth: a governed concept registry, a conformance suite a third party can
run against their own vault, and an "ignore this issuer" control now that any
site can issue. The protocol is small on purpose. The interesting work is the
fourth and fifth site, which we did not write.

---

## Built with

`webmcp`, `document.modelContext`, `mcp`, `javascript`, `es-modules`, `html`,
`css`, `web-crypto-api`, `ecdsa-p256`, `cloudflare-workers`, `wrangler`,
`node-test-runner`, `svg`

## Suggested tags

`webmcp`, `agentic-web`, `learning`, `edtech`, `privacy`, `user-owned-data`,
`cryptography`, `interoperability`, `protocol`, `cloudflare-workers`,
`human-in-the-loop`, `verifiable-credentials`, `open-web`, `cooking`

## Video

YouTube, 2 minutes 55 seconds, with audio. Shot list in `docs/VIDEO_SCRIPT.md`.

## Prior work note

Everything in this repository was created during the submission period, 25
August to 3 September 2026. The commit history is the evidence. The only third
party code is the Chrome Labs WebMCP polyfill (Apache-2.0, header preserved) and
three open source fonts (OFL), both credited in the README.

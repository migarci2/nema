# Devpost submission, ready to paste

Every field of the WebMCP Challenge form, in order. Images are hosted on the
hub under https://nema.migarci2.dev/press/ so the story renders on Devpost.

## Project name

nema

## Elevator pitch (200 characters max)

Learn it once. It counts everywhere. WebMCP lets teaching pages ask your vault what you know, with consent, and give you a signed receipt a later page can use.

(159 characters)

## Thumbnail

`docs/assets/devpost-thumbnail.jpg` (1800 x 1200, 3:2, JPG).

## Project Story (About the project)

**Learn it once. It counts everywhere.**

Learn something on one site, and the next one already knows. You decide what
gets shared, every time.

![a site asks, you say yes, it counts next time](https://nema.migarci2.dev/press/card-how-it-works-sm.png)

Your learning is scattered across the web: a course here, an article there, a
video somewhere else. nema keeps it in one place you own, and your agent uses
WebMCP to connect that place to every page you learn from.

## Inspiration

Most of what we know we learned on the web, one page at a time: a blog post
about browning meat, a chapter about syscalls, a course on pan sauces. None of
those pages know each other, and none of them know us. Independent teaching
pages rarely share a learner record. When we move between them, the next page
usually has no evidence of what we did before.

WebMCP changes the shape of the problem. A page can declare what it can do as
tools, and an agent in the browser can call them. So we asked: what if a page
could declare what it teaches, ask a reader's own vault what they already know,
and hand back a signed note of what they did? That is nema: your learning
state, everywhere.

**Why this needs WebMCP.** Learning lives on many sites that will never share a
database. A teaching page knows what it teaches. The learner's
vault knows what evidence it holds. WebMCP lets the browser agent bring those
two capabilities together while both pages are open: the page declares what it
needs, the vault returns only the named status values under the learner's
approval, and the page adapts. After a check, the page can issue a signed
receipt back to the vault. Without WebMCP, an agent would need a custom
integration for each site or an extension that interprets the page.

## What it does

**A site asks.** Before a teaching page adapts its path, it declares the
readiness bands it needs.

**You decide.** The vault shows the requested fields, audience, purpose and
expiry before it returns anything.

**It counts next time.** After you pass a check, the site can issue a signed
receipt that another participating page can use through your vault.

Everything below is that loop at full size, in the words the system uses.

**A vault you own.** The vault is your own ledger of learning evidence: signed
receipts for activities and checks that sites recorded for you. It derives
coarse bands, review dates and next step suggestions from that ledger. The keys
are created in your browser, the ledger exports as one file, and you can erase
the vault. Teaching providers do not hold the complete record. The demo vault
is at https://nema-vault.migarci2.dev.

![A receipt, signed by the course and kept in the vault](https://nema.migarci2.dev/press/story-receipt-sm.gif)

**A small protocol for teaching pages.** Add one manifest block and one script
tag.

![One manifest block and one script tag](https://nema.migarci2.dev/press/card-one-tag-sm.png)

Together they expose five imperative WebMCP tools and one declarative form. The
page can describe what it teaches, accept a scoped readiness assertion, adapt
its path, and issue a receipt after a check. The self certified tier needs no
backend.

**A learner model with a source.** The vault follows the principles of learning
fast that Justin Skycak writes up at justinmath.com and that Kris Abdelmessih
collects in "The Principles of Learning Fast"
(https://moontowermeta.com/the-principles-of-learning-fast/). Passing something
advanced can credit declared prerequisites at a fraction and extend their review
dates, which Math Academy calls Fractional Implicit Repetition. The vault
asks for a concept only when its prerequisites are held, and otherwise names the
weakest prerequisite and the goal it is blocking. A session interleaves rather
than drilling one concept, and keeps confusable concepts apart unless telling
them apart is the point. It is an inspectable policy, not a psychometric model.
Every weight, decay rule and threshold is a documented demo default in the
repository. A signature proves which key issued a receipt and that its payload
was not altered. It does not prove how difficult or valid the check was.

**Consent you can see.** A teaching page never reads the vault directly. It
names the bands it needs. The first approval shows the requested fields,
audience, purpose and expiry. Every signed answer is bound to that site and
expires after thirty minutes.

![The consent modal, in words](https://nema.migarci2.dev/press/card-consent-sm.png)

![A course asks, you approve, 68 minutes become 27](https://nema.migarci2.dev/press/story-ask-sm.gif)

**Two example courses that look nothing like nema.** Saucier School (pan
sauces) turns a 68 minute path into 27 after the learner approves its readiness
request. After the ratios check is passed and a fresh assertion is presented, 27
becomes 21. Line Cook Lab (food safety on the pass) has never spoken to Saucier
School, but it recognises evidence from the learner's vault, skips material
already covered, and names the prerequisite still missing.

![68 to 27 to 21 minutes](https://nema.migarci2.dev/press/card-minutes-sm.png)

![A second site recognises the first](https://nema.migarci2.dev/press/story-second-site-sm.gif)

**Two real articles, with and without nema.** We republished frereit's AES-GCM
article under CC BY-SA 4.0 and Lexi Mattick's CPU chapter under its MIT licence,
with attribution and change notices. We added retrieval questions and show each
original beside the nema version with the generated diff.

![Same AES-GCM article. 112 lines added.](https://nema.migarci2.dev/press/card-diff-sm.png)

![The two columns, and a question inside the text](https://nema.migarci2.dev/press/story-article-sm.gif)

**The agent you already use.** ChatGPT's in app browser and an agent in
WebMCP enabled Chrome can call the tools on the page. Claude Code and Codex
reach the eleven imperative vault tools over MCP (`packages/nema-mcp`, the same
schemas). nema does not require its own agent; the learner's vault is the
persistent part.

![The agent you already use, one vault](https://nema.migarci2.dev/press/card-agents-sm.png)

**nema in your browser.** The Chrome extension puts the vault in a side panel
and handles the transport with no model. Its page bar opens the same approval
step, and after the learner passes a check, an accepted receipt is collected
into the local vault.

![The extension: share from the bar, the receipt is collected on its own](https://nema.migarci2.dev/press/story-extension-sm.gif)

**Sites can keep their own names.** A site may declare its own vocabulary. An
agent may propose a mapping for an undeclared name, but only the learner can
confirm or reject it. Alignments translate names without changing who signed a
receipt or how much the evidence weighs.

![A site's own word meets the vault's](https://nema.migarci2.dev/press/card-alignment-sm.png)

## How we built it

- Plain HTML, CSS and ES modules. No framework, no bundler. Each page registers
  its tools with `document.modelContext.registerTool`, exactly as Chrome
  documents it. Native end to end tests ran on Chrome for Testing 154. nema
  targets WebMCP enabled Chrome 149+ and ChatGPT's in app browser. Other
  browsers use the bundled Chrome Labs polyfill for a degraded demonstration.
- The protocol defines six objects (LearningManifest, ReadinessRequest,
  ReadinessAssertion, EvidenceReceipt, LearningNeed, ConceptAlignment).
  Readiness assertions and evidence receipts use compact ECDSA P-256 signed
  tokens, `nema1.<payload>.<signature>`, over the exact payload bytes via the
  Web Crypto API, in browsers, Workers and Node alike. Manifests, requests and
  learning needs use JSON; alignments remain inspectable records in the vault.
- Trust has three tiers. Registered issuers (the courses, whose keys never
  leave a Cloudflare Worker), origin published keys (`/.well-known/nema-issuer.json`),
  and self certified receipts (a blog with no backend signs with a key it made
  in the reader's browser; the vault caps that evidence at self report weight).
- Learner state is never stored. It is derived from the ledger on every read
  with an explainable scoring model (grader weight, result, recency, a
  spacing schedule), so a better estimator later never invalidates evidence.
- Seven origins on Cloudflare Workers: the hub, the vault, two courses, a blog,
  two mirrored articles. A site talks to the vault through a popup handshake
  (`connect.html` plus `postMessage`), the way "Sign in with" works, because
  third party iframes do not share storage.
- `packages/nema-mcp` boots the browser vault inside Node with four shims (a
  file backed localStorage, an event sink, a repo backed fetch, module
  resolution hooks) and serves `tools.js` verbatim over MCP, with consent
  through MCP elicitation.
- `packages/nema-extension` is Manifest V3: the vault page as the side panel,
  a MAIN world bridge that is the only code touching `document.modelContext`,
  and a service worker that relays tool calls per tab.
- Verification, frozen at commit `77ca78f`: `npm test` reports 267 passing unit
  tests. Separate native end to end suites cover the browser flow, the connect
  handshake, the extension, tampering, replay, wrong audience and expiry on
  Chrome for Testing 154, against the live origins.

## Challenges we ran into

- Native WebMCP differs from the polyfill in two ways that only show up in a
  real Chrome: `executeTool` wants a JSON string and returns one, and
  `document.modelContext` refuses to run on `chrome-extension://` documents.
  We found both by testing on Chrome for Testing canary, not by reading docs.
- Tokens are long. Agents mangle thousand character strings. We moved every
  handoff off the agent's transcript: popups, `postMessage`, the extension's
  bridge, and hand delivery links, so an agent carries meaning, not bytes.
- Concept identity across sites. A closed registry is honest but limiting, so
  we let sites use local names and made alignment a first class, reviewable
  claim: proposed by the site or an agent, confirmed by the person.
- We built and then removed an in house chat agent. It contradicted the thesis
  (the agent is whichever you already use) and needed a model budget judges
  would exhaust. The extension does the transport with no model at all.
- Keeping the demo learner's numbers stable across three weeks of judging with
  a real spacing model meant designing the seed ledger against the formulas,
  not around them.

## Accomplishments that we're proud of

- The consent modal. A site names a small set of readiness bands; the learner
  sees exactly those, and what will never leave. Everything else in the project
  exists so that this moment is true.
- 68 minutes to 27, and then to 21 once the ratios check is passed and a fresh
  assertion is presented, on a site that has no account, then a second site
  that recognises the first, with zero partnership between them.
- Two real articles from other authors, republished under their licences,
  gaining retrieval practice and portable evidence with about a hundred added
  lines, and the diff shown to prove it.
- The same eleven imperative vault tools are available to browser agents through
  WebMCP and to Claude Code and Codex through MCP, from one `tools.js`. The
  browser vault also exposes one declarative form.
- The critical protocol paths are covered by unit tests and native browser runs
  against the live origins.

## What we learned

- WebMCP works best when a tool changes something on screen. Judges and
  learners trust what they can watch happen, so every tool here moves the
  page.
- Evidence beats mastery. Storing what happened, signed, and deriving state
  from it is simpler and more honest than storing a score, and it makes the
  learner model recomputable.
- Human in the loop had to be built into the tool surface rather than promised
  in a description. Two things have no tool at all, on purpose: answering an
  activity and approving a disclosure.
- The pages got better every time we removed a panel, a pill or a number.

## What's next for nema

- A published `nema-provider.js` on a CDN, a `well-known` key helper, and a
  WordPress and Astro integration so the install is a single step.
- Alignment sharing between learners: once someone confirms that a site's
  "browning science" is Maillard, the next learner's agent can propose it with
  that provenance.
- The extension in the Chrome Web Store, with vault sync through a file the
  learner owns.
- Providers that issue evidence for the open web's best teachers: recorded
  lectures, interactive explainers, documentation with exercises.

## Why WebMCP, in the four required answers

**Why WebMCP suits this.** Learning happens on many sites that will never
share a database. WebMCP lets each page expose what it can do, on the page,
with the human present, and lets the learner's own vault expose a minimal,
consented answer. No API keys, no accounts, no scraping: the page is
the API, and the person is in the loop by construction.

**How it improves the user experience.** A participating site can start from
relevant evidence already in the vault. It asks for a small set of readiness
bands, and the vault returns one plain status per item. After a passed check,
the page can issue a signed receipt for that event. In the normal browser path,
the popup or extension carries the cryptographic material, so the learner does
not have to copy it.

**What collaboration between people and agents becomes possible.** The agent
reads manifests, asks your vault, carries signed tokens, proposes what a
site's words mean, and coaches you on what is about to fade. You answer every
question, approve every disclosure, and confirm every alignment. The line is
drawn in the tool surface: there is no tool to answer for you and no tool to
approve for you.

**Implementation approach.** Seven origins, each registering tools with
`document.modelContext.registerTool` (imperative and declarative forms), one
shared protocol module for building and verifying signed tokens, a vault that
derives state from a ledger, a popup handshake for sites, an MCP bridge for
terminal agents, and a Chrome extension that uses the same WebMCP tools from a
MAIN world bridge. Tested end to end on native WebMCP in Chrome for Testing
154 over the DevTools Protocol.

## Built with (tags, comma separated)

webmcp, javascript, html, css, cloudflare-workers, web-crypto-api, ecdsa, mcp, model-context-protocol, chrome-extension, manifest-v3, node.js, chrome-devtools-protocol, chrome-for-testing, codex-cli, claude-code, webassembly, ffmpeg, cloudflare

## "Try it out" links

- https://nema.migarci2.dev (the hub: manifesto, creators guide, judge guide, protocol reference)
- https://nema-vault.migarci2.dev (the vault; click Load demo learner)
- https://saucier.migarci2.dev (course one, Saucier School)
- https://linecook.migarci2.dev (course two, Line Cook Lab)
- https://maillard.migarci2.dev (a blog post installed with one manifest block and one script tag)
- https://aesgcm.migarci2.dev/compare (a real article, with and without nema)
- https://cpu.migarci2.dev/compare (a second real article, with and without nema)
- https://nema.migarci2.dev/judges (the three minute walkthrough)
- https://github.com/migarci2/nema (repository, MIT)
- https://github.com/migarci2/nema/releases/tag/v0.1.0 (the Chrome extension, zipped and ready to load unpacked)

## Which agent(s) or client(s) did you test your WebMCP tools with?

- Google Chrome for Testing 154 (native WebMCP, `document.modelContext`), driven over the Chrome DevTools Protocol by our end to end scripts against the live origins: every page's tools, the golden path, the consent modal, replay and tampering rejections, the connect handshake, and the extension.
- ChatGPT desktop's in app browser (WebMCP on by default): the pages register their tools there; the judge guide gives the prompts for each step.
- Chrome 147 with the Chrome Labs WebMCP polyfill (same code, degraded path).
- The nema Chrome extension, which is itself a WebMCP client: a MAIN world bridge calls `getTools` and `executeTool` on any page that registers nema tools.
- Codex CLI over MCP through `packages/nema-mcp` (the same vault tools by another transport), verified with `codex exec`; Claude Code is configured through the repo's `.mcp.json`.

## Which AI tools have you leveraged while working on this project?

- Claude Code (Claude Fable 5.1 as the lead, Claude Opus as parallel subagents for building, reviewing and fixing each module against a written contract).
- OpenAI Codex CLI (gpt-5.6) as an independent MCP client to validate the bridge, and its image generation tool for the thumbnail artwork candidates.
- Chrome for Testing canary for native WebMCP verification, and the Chrome Labs WebMCP polyfill and page agent pattern as references.
- Cloudflare Workers AI (gpt-oss-120b) powered a first in house coaching agent that we later removed on purpose: the agent should be the one the learner already uses.

## Prior work note

Everything original to nema was created during the submission period (first commit 2026-09-01). The mirrored works retain their own licences and attribution: frereit's AES-GCM article under CC BY-SA 4.0, and Lexi Mattick's CPU chapter under the MIT licence. The comparison pages show the nema additions; the CPU mirror also removes analytics and fixes relative links, as disclosed on the page.

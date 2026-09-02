# Devpost submission, ready to paste

Every field of the WebMCP Challenge form, in order. Images are hosted on the
hub under https://nema.migarci2.dev/press/ so the story renders on Devpost.

## Project name

nema

## Elevator pitch (200 characters max)

A learning protocol for the web: any site adds one tag, readers keep signed
proof of what they learned in a vault they own, and any agent connects the two.

(155 characters)

## Thumbnail

`docs/assets/devpost-thumbnail.jpg` (1800 x 1200, 3:2, JPG).

## Project Story (About the project)

## Inspiration

Most of what we know we learned on the web, one page at a time: a blog post
about browning meat, a chapter about syscalls, a course on pan sauces. None of
those pages know each other, and none of them know us. Every site starts from
zero, and nothing we did on one page survives on the next.

WebMCP changes the shape of the problem. A page can declare what it can do as
tools, and an agent in the browser can call them. So we asked: what if a page
could declare what it teaches, ask a reader's own vault what they already know,
and hand back a signed note of what they did? That is nema: your learning
state, everywhere.

![The protocol in three beats](https://nema.migarci2.dev/press/card-how-it-works-sm.png)

## What it does

**A vault you own.** The vault is your own record of what you have learned:
signed receipts of work you actually did, issued by the sites where you did
it. From those receipts it derives your state: a band per concept and per
ability (recognise, retrieve, explain, apply, transfer, discriminate), a memory
schedule, and a list of what to learn next. It lives with you, in your browser
or on your disk, not on any site, and there is no account. The demo vault is
at https://nema-vault.migarci2.dev.

![A receipt, signed by the course and kept in the vault](https://nema.migarci2.dev/press/story-receipt-sm.gif)

**A protocol a site installs in a minute.** Two tags on any page.

![Two tags on any page](https://nema.migarci2.dev/press/card-one-tag-sm.png)

That page now exposes six WebMCP tools: it describes what it teaches, asks the
vault about three prerequisites, adapts, and signs a receipt when the reader
passes a check. No backend needed.

**A learner model with a source.** The vault follows the principles of learning
fast that Justin Skycak writes up at justinmath.com and that Kris Abdelmessih
collects in "The Principles of Learning Fast"
(https://moontowermeta.com/the-principles-of-learning-fast/). Passing something
advanced credits every prerequisite under it at a fraction and pushes its review
date out, which Math Academy calls Fractional Implicit Repetition. The vault
asks for a concept only when its prerequisites are held, and otherwise names the
weakest prerequisite and the goal it is blocking. A session interleaves rather
than drilling one concept, and keeps confusable concepts apart unless telling
them apart is the point.

**Consent you can see.** A site never reads the vault. It asks one question,
and the vault shows a modal: what will be shared (three status bands), what
will not (history, scores, other subjects), for which site, for how long. You
approve. The answer is a signed token bound to that one site, valid thirty
minutes.

![The consent modal, in words](https://nema.migarci2.dev/press/card-consent-sm.png)

![A course asks, you approve, 68 minutes become 27](https://nema.migarci2.dev/press/story-ask-sm.gif)

**Two example courses that look nothing like nema.** Saucier School (pan
sauces) asks your vault three things and turns 68 minutes into 27, then 21.
Line Cook Lab (food safety on the pass) has never spoken to Saucier School, but
recognises what you did there and unlocks its advanced lab.

![68 to 27 to 21 minutes](https://nema.migarci2.dev/press/card-minutes-sm.png)

![A second site recognises the first](https://nema.migarci2.dev/press/story-second-site-sm.gif)

**Two real articles, with and without nema.** We mirrored a CC BY-SA article
on AES-GCM and an MIT chapter of "Putting the You in CPU", added retrieval
questions inside the text, and put the original and the nema version side by
side with the exact diff as the headline.

![Same article. 112 lines added.](https://nema.migarci2.dev/press/card-diff-sm.png)

![The two columns, and a question inside the text](https://nema.migarci2.dev/press/story-article-sm.gif)

**Any agent.** ChatGPT desktop and Chrome 149 call the tools on the page.
Claude Code and Codex reach the same vault over MCP (`packages/nema-mcp`, the
same eleven tools, same schemas). The agent is a commodity; the vault is the
infrastructure.

![Any agent, one vault](https://nema.migarci2.dev/press/card-agents-sm.png)

**nema in your browser.** A Chrome extension puts the vault in the side panel
and does the boring transport with no model: a bar appears on any site that
works with nema, one click shares your bands, and receipts are collected
automatically when you pass something.

![The extension: share from the bar, the receipt is collected on its own](https://nema.migarci2.dev/press/story-extension-sm.gif)

**Sites that speak their own names.** A site can use its own concept ids. An
agent proposes what they mean, you confirm once, and the vault translates at
its edges. Who translated a name never changes how much a receipt is worth;
who signed it does.

![A site's own word meets the vault's](https://nema.migarci2.dev/press/card-alignment-sm.png)

## How we built it

- Plain HTML, CSS and ES modules. No framework, no bundler. Every page loads
  the Chrome Labs WebMCP polyfill and registers tools with
  `document.modelContext.registerTool`, exactly as Chrome documents it, so the
  same code runs natively in Chrome 149+ and ChatGPT desktop and degrades
  gracefully elsewhere.
- The protocol is six objects (LearningManifest, ReadinessRequest,
  ReadinessAssertion, EvidenceReceipt, LearningNeed, ConceptAlignment) carried
  as compact tokens: `nema1.<payload>.<signature>`, ECDSA P-256 over the exact
  payload bytes via the Web Crypto API, in browsers, Workers and Node alike.
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
- Verification: 266 unit tests, and native end to end scripts that drive Chrome
  for Testing 154 over the DevTools Protocol against the live origins: the
  golden path, the connect handshake, the extension, replay and tampering
  rejections, wrong audience, expired tokens.

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

- The consent modal. A site asks for three things; the learner sees exactly
  those three, and what will never leave. Everything else in the project
  exists so that this moment is true.
- 68 minutes to 27 to 21, on a site that has no account, then a second site
  that recognises the first, with zero partnership between them.
- Two real articles from other authors, republished under their licences,
  gaining retrieval practice and portable evidence with about a hundred added
  lines, and the diff shown to prove it.
- The same eleven vault tools reachable from ChatGPT, Chrome, Claude Code,
  Codex and a Chrome extension, from one `tools.js`.
- Everything checkable: every claim in this text has a test that drives a
  real browser against the live URL.

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
  WordPress and Astro integration so the one tag install is one click.
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

**How it improves the user experience.** You never start from zero. A course
asks three questions, your vault answers with three words, and 68 minutes
become 27. A second site recognises the first. A blog post you read leaves you
with proof you understood it. And you never copy a token or read a key: the
extension or the popup handshake do the transport, and cryptography stays
under the hood.

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
- https://maillard.migarci2.dev (a blog post with the one tag install)
- https://aesgcm.migarci2.dev/compare (a real article, with and without nema)
- https://cpu.migarci2.dev/compare (a second real article, with and without nema)
- https://nema.migarci2.dev/judges.html (the three minute walkthrough)
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

Everything was created during the submission period (first commit 2026-09-01). The two mirrored articles are third party works reproduced under their licences (CC BY-SA 4.0 and MIT) with attribution, unchanged except for the nema additions shown in their diffs.

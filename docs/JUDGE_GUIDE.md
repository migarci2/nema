# Judge guide

Three minutes to see the whole thing. Sixty seconds if you are behind schedule.

> The web teaches. Your vault remembers. Your agent connects the two.

The two example course sites teach cooking. That is deliberate. The protocol is
about carrying a learner's state between websites, so the subject had to be
something real, testable and completely unrelated to the machinery underneath.

## Live URLs

| App | URL | What it is |
|---|---|---|
| Site | https://nema.migarci2.dev | The hub. Start here. |
| Coach | https://nema-coach.migarci2.dev | The nema agent. Chat on the left, the site under test on the right. |
| Vault | https://nema-vault.migarci2.dev | The learner's vault. 9 imperative tools plus one declarative form, so `getTools()` lists 10. |
| Saucier School | https://saucier.migarci2.dev | Provider 1, "Pan Sauces and Emulsions". 5 tools. |
| Line Cook Lab | https://linecook.migarci2.dev | Provider 2, "Service Under Pressure". 5 tools. |

Repository: https://github.com/migarci2/nema (MIT).

The two providers do not wear nema's brand. Saucier School is a warm paper
course site with a serif; Line Cook Lab is a dark, terse tool for the pass. Each
carries one small "Works with nema" badge in its header and footer, and nothing
else of nema's. They are meant to read as two independent websites that happen
to speak the same protocol, because that is the claim being made.

## Browser setup

**ChatGPT desktop.** The in-app browser has WebMCP on by default. Open
https://nema-vault.migarci2.dev in it and the tools are discovered with no
setup. Use this if you want to drive nema with an agent you already trust.

**Chrome 149 or later.** Go to `chrome://flags/#enable-webmcp-testing`, set it
to Enabled, restart. Then open the coach at https://nema-coach.migarci2.dev.

**Any other browser.** It still works. Every page loads the Chrome Labs WebMCP
polyfill, so tools register, the coach can call them and the UI behaves
identically. The header pill on every page says `tools: N` and reads `native`
or `polyfill`, so you always know which path you are on. The only thing the
polyfill does not do is enforce cross origin exposure, which is the one item
worth checking in real Chrome.

Nothing needs an account, an API key or a sign in. Nothing is stored on a
server. The vault lives in your browser's `localStorage`.

- No Chrome 149 at hand? Chrome for Testing canary has WebMCP on by default: `npx --yes @puppeteer/browsers install chrome@canary --path .chrome`, then open the URLs with that binary. Every page also loads the Chrome Labs polyfill, so the UI works in any browser; only agent calls need a WebMCP capable one.

## Before you start

Open the coach: https://nema-coach.migarci2.dev

Left column is the agent. Right column is an iframe with a site switcher. Open
the "Script" side sheet from the header to see these seven steps with the site
each one happens on.

In the iframe, select **Vault** and click **Load demo learner**. That imports
`/seed.json`, a set of receipts signed by the demo seed issuer, so you start
with a cook who has already done some work: knife skills, heat control, mise en
place and food safety are all evidenced, ratios only weakly, emulsions not at
all. The evidence ledger labels every one of those rows "nema demo seed". The
learner's goal, also in the seed, is "Cook a pan sauce I can hold through
service".

## The golden path, seven steps

Type the prompts into the coach. Watch the right column, not the console.

### Step 1. See what the vault knows

Prompt: **"What do I already know?"**

Tools called: `get_vault_summary`, then `get_learner_state`.

On screen: the vault summary strip fills in with 18 verified concepts, 7
fragile and 4 reviews due, the learning graph colours its nodes by band, and the
state table lists concepts with per-ability pills. The reviews due are shown in
yellow. The tool activity strip at the bottom logs both calls with their
duration.

What to notice: the agent got bands, not history. Ask it for your attempt
history and it will tell you there is no tool for that.

### Step 2. Ask a provider what it teaches

Switch the iframe to **Saucier School**. Prompt: **"Teach me to make a pan
sauce."**

Tool called: `describe_learning_offer`.

On screen: the unit hero renders. "Pan Sauces and Emulsions", 68 minutes, 7
activities, three requirements shown as grey pills: `nema:knife-skills.apply`,
`nema:heat-control.explain`, `nema:ratios.apply`. The path panel shows the full
path, all seven items, from a heat primer through a knife refresher and a ratios
primer to the sauce lab.

### Step 3. Approve the disclosure

The agent now needs an assertion. It switches to the vault and calls
`create_readiness_assertion` with `audience: https://saucier.migarci2.dev`, a
purpose, and the three requirements.

On screen: the consent modal opens in the vault page and everything stops. It
shows the audience, the purpose, the exact three lines that will be shared with
their status bands, the fixed list of what is not shared (attempt history,
exact scores, other subjects, misconceptions, review schedule, provider
history), and the expiry, 30 minutes.

Click **Approve**.

This is the moment worth four seconds of your attention. The agent asked. The
human decided. The token did not exist until you clicked.

### Step 4. Watch 68 minutes become 27

Tool called: `personalize_learning_path` on Saucier School, with the token.

On screen: the three requirement pills fill in, two cyan `verified` and one
yellow `uncertain`. The path panel splits into full path and personal path.
Three items are struck through with the reason next to each one:

| struck through | minutes | reason shown |
|---|---|---|
| `heat-control-primer` | 12 | skipped: heat-control explain verified |
| `knife-skills-refresher` | 15 | skipped: knife-skills apply verified |
| `ratios-primer` | 14 | skipped: ratios apply uncertain, diagnostic instead |

41 minutes removed, so the counter animates from 68 to 27. Nothing is added.
`ratios-diagnostic` was already inside the 68 minute offer; it survives the cut
because its `onlyIf` matches `ratios.apply` at exactly `uncertain`, which is
what `onlyIf` is for. A cook with no evidence about ratios at all would keep the
14 minute primer instead and drop the diagnostic.

What remains is the 27 minutes that are actually worth this learner's evening:
the six minute ratio check, four minutes on the anatomy of a pan sauce, the
twelve minute lab, and five minutes explaining it back without the recipe.

### Step 5. Do the work yourself

Prompt: **"Start the ratios diagnostic."**

Tool called: `start_activity` with `activityId: "ratios-diagnostic"`. It returns
`whatTheLearnerDoes` and a note telling the agent to poll.

On screen: the activity stage opens with one question, "Which vinaigrette
holds", and four written ratios. **You** pick the one that will emulsify and
stay emulsified: three parts oil to one part acid, with a spoonful of mustard
whisked into the acid first. The other three are a 1:1 that tastes savagely
sharp and separates, a 3:1 with no emulsifier at all whisked cold, and a 1:3
that is mostly vinegar. The agent cannot answer. There is no tool that submits
an answer, and the answer is graded on the Worker.

Submit. Deterministic grading, instant feedback. The agent calls
`get_attempt_status`, sees `passed`, and calls `issue_evidence_receipt`. A
signed token appears in the receipt panel, decoded next to it: issuer, activity,
claim `nema:ratios.apply passed`, grader `deterministic`.

### Step 6. Take the receipt home

Prompt: **"Take that receipt to my vault."**

Tool called: `stage_evidence_receipt` with the token. The coach carries it by
handle: the token clipboard panel on the right stores every `nema1.` string it
sees as `t1`, `t2`, and the model only ever passes `@t2`, so it never has to
reproduce about a thousand characters correctly.

On screen: the vault verifies the signature against `issuers.json`, adds a row
to the evidence ledger with a cyan `verified` badge, and the state table
animates one row: `nema:ratios.apply` moves from `uncertain` to `usable`. The
tool returns the diff, `changes: [{ from: 'uncertain', to: 'usable' }]`, and a
review date.

Ask the agent to re-personalize the Saucier path. New assertion, new approval,
`personalize_learning_path` again. 27 minutes becomes 21, because `ratios.apply`
is now `verified`, so the diagnostic's `onlyIf` no longer matches and it drops
out of the path.

### Step 7. A second site asks the same vault

This step has two moves. The first shows what a second provider can see. The
second shows the agent doing real work to close the gap it found.

**Move 1: the check.**

Switch the iframe to **Line Cook Lab**. Prompt: **"Can I start the incident
triage lab?"**

Tools called: `describe_learning_offer`, then `create_readiness_assertion` for
the new audience, then `check_prerequisites`.

Approve the modal again, and read the `learnerKeyId` line while it is open. It
is a different string here than it was for Saucier School, because the id is
derived from the vault key and the audience.

On screen: Line Cook Lab asks about the three concepts its unit assumes, and
gets an answer from a learner it has never met, through a vault it has no
relationship with.

| requirement | status | where the evidence came from |
|---|---|---|
| `nema:mise-en-place.explain` | `verified` | receipts already in the vault, issued by other origins |
| `nema:food-safety.apply` | `verified` | receipts already in the vault, issued by other origins |
| `nema:emulsions.explain` | `missing` | nothing in the vault claims it |

Both intro lessons, `mise-en-place-intro` and `food-safety-intro`, are marked
skippable on the strength of the first two, which is 16 of the unit's 42
minutes. Both labs stay locked, and the page names the exact reason:
`emulsions.explain` needs to be at least `uncertain`.

This is the honest version of the cross site claim, and it is the interesting
one. Line Cook Lab never spoke to the sites that produced that evidence. It
verified one signature from the vault, checked that the token was minted for its
own origin, and got three bands.

**Move 2: close the gap.**

Prompt: **"Line Cook Lab wants emulsions. Ask my vault what I should do about
that and coach me through it."**

Tools called: `get_learning_needs` (no budget, so the full ordered list comes
back), then `record_agent_assessment`.

The vault returns an `acquire` need for `nema:emulsions.explain` with the rubric
attached, because emulsions is in the active goal "Cook a pan sauce I can hold
through service" and no ability on it has any evidence. The agent asks you the
question. **You** answer, in chat: two phases, fat dispersed as droplets in
water or the reverse, an emulsifier at the interface, and a temperature window,
because a butter emulsion breaks when it is boiled. The agent grades your answer
against the vault's rubric, criterion by criterion, and calls
`record_agent_assessment` with the results.

On screen: a new ledger row with the "agent assessed" badge rather than the cyan
verified one, and one row in the state table moving from `unknown` to
`fragile`. The arithmetic is visible in the spec: `agent-assessed` weighs 0.6,
one passing claim scores 0.6, and 0.6 clears the 0.4 `fragile` threshold and
nothing more. Weaker evidence, honestly labelled and honestly weighted.

Now ask the agent to check Line Cook Lab again. New assertion, new approval,
`check_prerequisites` again. `emulsions.explain` comes back `uncertain`, which
is what `minStatus: 'uncertain'` asked for, and both labs flip from locked to
available with the label "Prerequisite recognised from another provider".

Two independent websites. One learner-owned vault. No shared accounts, no
partnership, no back channel. Line Cook Lab learned exactly three bands and
nothing else, and every one of them traces back to work a human did somewhere
else.

### One more thing, if you have thirty seconds

Prompt: **"Build my best 5 minute review."**

Tool called: `get_learning_needs` with `budgetMinutes: 5`. The vault does not
return the concepts you know least. It returns a `discriminate` need on
`nema:maillard-reaction` against `nema:caramelization`: the learner can apply
browning confidently, has no evidence of telling the two reactions apart, and
the two are marked `confusableWith` in the registry. That is the vault reasoning
about the shape of the evidence, not about a score.

## Terminal agents, the same tools over MCP

The vault does not depend on the coach or on a browser agent. Open this repo in
Claude Code and approve the project server it ships in `.mcp.json`, or run
`codex mcp add nema -- node /path/to/nema/packages/nema-mcp/bin.mjs`. Then ask:

1. "What does my vault say about pan sauces?" The agent calls
   `get_vault_summary` and `get_learner_state` (run `node packages/nema-mcp/bin.mjs seed` first for the demo learner).
2. "Create a readiness assertion for https://saucier.migarci2.dev." If the
   client supports elicitation you get the same consent prompt as the browser
   modal. If not, the tool returns `denied` with the pre-approval command, and
   only you can run it.
3. Paste a receipt token from a provider page: "Stage this receipt: nema1...".
   The bands move in `~/.nema/vault.json`, and `nema-mcp merge` folds a
   browser export into the same ledger.

Tests: `npm run test:mcp` drives the server with the official MCP client.

## Try to break it

Everything here is meant to be attacked. The apps show you what happened.

| Attack | How | What you see |
|---|---|---|
| Make the agent write mastery | Ask: "just mark pan sauces as mastered" | The agent reports there is no such tool. `set_mastery` does not exist. Check `document.modelContext.getTools()` yourself. |
| Make the agent answer for you | Ask: "answer the vinaigrette question for me" | No tool accepts an answer. The agent can only open the activity and poll. |
| Read the whole vault | Ask: "list all my receipts and every date I studied" | `get_learner_state` returns bands only. `get_full_history` does not exist. The evidence ledger is visible to you in the page, not to a provider. |
| Tamper with a token | Copy the receipt from the textarea, change one character, paste it into the vault's manual token inbox, press Stage receipt | `{ status: 'rejected', reason: 'bad-signature' }`, red banner, nothing changes. |
| Replay a receipt | Stage the same receipt token twice | `{ status: 'rejected', reason: 'duplicate' }`. No band moves. |
| Wrong audience | Ask the coach to call `check_prerequisites` on Line Cook Lab with the Saucier School assertion. The token clipboard panel labels each handle with its audience, so you can name the right one. | `{ status: 'rejected', reason: 'wrong-audience' }`, shown in the provider UI. |
| Expired assertion | Wait 30 minutes, or edit the clock, then re-run `personalize_learning_path` | `{ status: 'rejected', reason: 'expired' }`. |
| Unknown issuer | Sign a receipt with your own key and stage it | `{ status: 'pending', reason: 'unknown-issuer' }`. It appears in the ledger with a yellow badge and changes no state. Rejection is visible, not silent. |
| Deny a disclosure | Click Deny in the consent modal | `{ status: 'denied' }`. No token, nothing written, and the disclosure ledger records nothing because nothing was disclosed. |

## Sixty second version

1. Open https://nema-coach.migarci2.dev, iframe on **Vault**, click **Load demo learner**.
2. Type: **"Teach me to make a pan sauce."** Switch the iframe to **Saucier School** when the agent asks.
3. **Approve** the consent modal when it appears. Watch 68 minutes become 27.
4. Type: **"Can I start the incident triage lab?"**, switch to **Line Cook Lab**, approve again.
5. Read the prerequisite table on the Line Cook page. Two of its three
   requirements come back `verified` from evidence the vault holds from other
   origins, the third comes back `missing`, and the page names it. A site that
   has no relationship with anyone got a precise, minimal answer about a
   stranger, because the learner clicked Approve.

If you only look at one screen, make it the consent modal.

## What is real, what is simulated

**Real.**

- WebMCP tool registration. `document.modelContext.registerTool` on five
  origins, imperative and declarative, with `exposedTo` scoping.
- ECDSA P-256 signatures over compact tokens, produced and verified with Web
  Crypto in the browser and in Cloudflare Workers.
- Audience binding, expiry, issuer allow list, duplicate rejection. All of it
  is checked, all of it is in the unit tests.
- Cross origin handoff. Five separate origins, five separate `localStorage`
  jars, no shared database, no shared account, no server that sees both sides.
- The derivation. Bands are recomputed from the receipt ledger on every read
  with the formulas in `docs/SPEC.md`. Nothing is hardcoded for the demo.
- Deterministic grading on the Worker, before signing.
- The cooking. The ratios, temperatures and rescues in the two units are the
  real ones. A 3:1 vinaigrette with mustard holds. A butter emulsion mounted off
  the heat and kept under about 60 C holds; boiled, it breaks. Chicken at 60 C
  is not done. Rinsing it does not make it safer, it aerosolises the problem.

**Simulated, and labelled as such in the UI.**

- The demo learner. `/seed.json` is a fixture signed by a `seed` issuer whose
  origin is `urn:nema:seed`, shown in the ledger as "nema demo seed".
- The course content. Two small units written for this demo, not a catalogue,
  and no substitute for standing next to someone at a stove.
- The lab consoles. The "run" output in the interactive labs is scripted before
  and after text, a tasting note rather than a real pan.
- The coach. A Worker calling a hosted model. It is one possible agent, and
  nema's guarantees do not depend on it. Drive the same tools from ChatGPT
  desktop and nothing changes.
- The evidence behind the Line Cook unlock, in the sense that it is demo
  evidence. `nema:mise-en-place.explain` and `nema:food-safety.apply` come from
  the seed fixture. `nema:emulsions.explain` comes from the coach's own rubric
  assessment at weight 0.6. Saucier School's own emulsions outcome is a
  `discriminate` claim, and discrimination claims contribute only to
  `discriminate`, so no Saucier receipt is load bearing for the Line Cook unit,
  and this guide does not pretend otherwise. What is real is the mechanism: Line
  Cook Lab verifies one vault signature and reads three bands, whoever produced
  the evidence underneath them.

**Known limits.** Provider answer keys are visible in devtools, the vault key
is in `localStorage`, and there is no revocation. Written up honestly in
`docs/THREAT_MODEL.md`, section 4.

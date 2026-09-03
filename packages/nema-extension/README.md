# nema in your browser

> **Learn it once. It counts everywhere.**
>
> Learn something on one site, and the next one already knows. You decide what
> gets shared, every time. The picture is on
> [the hub](https://nema.migarci2.dev/).

A Chrome extension (Manifest V3) that puts the nema vault in the side panel and
brokers between it and any page that works with nema. No model is in the loop,
and there is no account and no server. The learner approves once per site and
answers the questions; the extension does the carrying.

## Load it (30 seconds)

```bash
bash scripts/build-extension.sh
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `packages/nema-extension/dist`.
4. Pin the nema icon, then click it: the vault opens in the side panel.
5. The first run offers one button, **Load the demo learner** (import a vault
   file and start empty are under the hood). Take the demo learner, then open
   <https://saucier.migarci2.dev> (or `http://localhost:8782` with the dev
   servers running). A small bar appears at the bottom of that page.

Reload any tab that was already open before you loaded the extension: a content
script only runs on a page that loads after it is installed.

Chrome 116 or newer. The pages themselves need WebMCP: Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`, or any Chrome at all, because every
nema page loads the WebMCP polyfill.

## What the panel shows

Three states, and nothing else on screen. Everything a machine needs and a
person does not lives in the one closed **Under the hood** block at the bottom:
tool names, timings, the call log, the alignments, the manual paths, and the
whole vault page with its graph, ledgers and forms, working exactly as it does
on the web.

**1. Not a nema page.** The mark, "Learn it once. It counts everywhere.", one
sentence ending "Learn anywhere you see the nema mark", and one button, **Load
the demo learner**. A vault that already has evidence drops the button and shows
the Next card instead. Import a vault file and Start empty are under the hood.

**2. A nema page, not shared yet.** One card: "Saucier School asks to know 5
things", those five in plain words with what your vault says about each
(verified, not sure yet, not yet), **Share**, a quiet **Not now**, and the
**Remember this site for 30 days** checkbox. Under it, nothing. Share opens the
vault's own consent modal, which in the panel is that same card with the buttons
swapped: the panel's ground, no dim, the same five rows in the same words, one
line "Shared for 30 minutes. Nothing else leaves." in place of the withheld
list, the expiry sentence and the countdown, the same checkbox, then **Approve**
and **Deny**. app.js still owns the modal and still settles the promise; the
panel adds the rows and the line, and the CSS hides the page width copy. The
checkbox is one node that moves into the modal and back, so there is one promise
about the site, not two.

**3. Shared.** One line, "Shared with Saucier School. 68 minutes became 27.",
then **What you did here**: the receipts this page produced as they arrive, one
row each, activity and one word (verified, waiting, already in your vault), and
one line naming the bands that moved. Then the Next card: the concept and
ability, the minutes, the rubric as a checklist, and **Done**.

An alignment only a person can settle surfaces as one quiet line in states 2 and
3 ("This site calls Maillard reaction \"browning science\". Confirm"), and only
while there is one to decide. The whole list is under the hood.

## The flow (CONTRACT section 24)

**1. Onboarding.** A vault with no receipts shows the hero and one button. The
demo button clicks the vault's own control, so there is one code path for each.
"Start empty" is remembered in `chrome.storage.local`, and the rest of the panel
appears.

**2. Arriving at a site.** When the content script finds nema tools, the page
gets a bar at the bottom in a shadow root: "This site works with nema. Share
what you already know?" with **Share** and **Not now**. Not now is remembered
for that tab's session. Share is the user gesture `chrome.sidePanel.open` needs,
so the click is relayed to the service worker, which opens the panel and raises
an intent; the panel runs the share, opens the vault's own consent modal, and
tells the bar what the site did with the bands ("The path is 27 minutes instead
of 68"). When Chrome refuses to open the panel from there, the bar says "Open
nema to approve" and the toolbar icon turns yellow with a `!`.

Ticking **Remember this site for 30 days** writes `settings.autoApprove[origin]`
with a 30 day expiry, and the panel mirrors the remembered origins into
`chrome.storage.local` so the content script can ask before it draws the bar. A
remembered site shows "Shared with this site" and the share runs on load with
nothing to approve.

**3. Learning.** While a nema page is visible in the active tab, the content
script polls `get_attempt_status` for the manifest's activities every four
seconds and re-reads the tool list, because a page registers its tools one at a
time and can add more later. When an activity turns `passed` it tells the panel
once; the panel issues the receipt, stages it with the vault's own
`stageReceipt`, and the page gets a toast naming the bands that moved: "Kept in
your vault: ratios, now durable". The row appears under "What you did here" in
the same moment. Failures, duplicates and pending issuers are quiet: they show
as a word on the row, never in the page. The manual button, **Check for receipts
now**, is under the hood and asks the page about every activity.

**4. Next.** The most urgent need from `getNeeds(5)`: the concept and ability,
the minutes, the rubric as a checklist, and a **Done** button that calls the
vault's `recordSelfCheck` at the self report weight. When the vault has no
`recordSelfCheck` the button says what an agent would do instead. When a site
seen this session teaches that concept, one quiet line links to it (the
manifests are cached by origin in `chrome.storage.session`).

**5. Alignments.** When a page's manifest names concepts its own way, the bar
adds "This site names things its own way", the card offers the one decision
there is to take, and the hood lists them all: the ones the site declared for
itself (handed to the vault's `declareAlignments`), and any an agent proposed,
with **Confirm** and **Reject** wired to `confirmAlignment` and
`rejectAlignment`. Local names nobody has matched yet are named as still open.

**6. Tokens** never appear in the panel's own surfaces. They live under the
hood, in the vault page's own blocks, where a token can still be pasted or
copied by hand.

## How it is put together

| file | what it does |
|---|---|
| `manifest.json` | MV3: side panel, one content script pair, the action badge |
| `sw.js` | opens the panel on the action click and on the bar's Share, keeps one record per tab, caches the session's manifests, holds intents for the panel, relays messages, sets the badge |
| `content.js` | isolated world: asks the bridge what the page offers, owns the in page bar and toast in a shadow root, polls the page's attempts every four seconds while it is visible, forwards tool calls |
| `bridge.js` | MAIN world: the only file that touches `document.modelContext`. Lists tools and executes one, with a JSON string in and a parsed result out |
| `sidepanel.js` | the three states, the Next card, the alignments, the share and the receipt collection, and what goes under the hood. Imports `/vault.js` so it is the same vault module app.js runs |
| `sidepanel.css` | the panel width, the three cards, the consent modal as a step. No new colours |
| `panel-webmcp.js` | hides native WebMCP on the panel's own page, see the caveat below |
| `icons/` | the nema mark at 16, 32, 48 and 128, rendered from `shared/brand/mark.svg` by `icons/render.mjs` |

`scripts/build-extension.sh` copies `apps/vault/public` into `dist/` and
`shared/` into `dist/shared/`, so the vault's absolute imports (`/vault.js`,
`/shared/...`) resolve inside `chrome-extension://<id>/`. `sidepanel.html` is
the vault's `index.html` rewritten in five places: the title, the panel
stylesheet, `panel-webmcp.js` before the polyfill, one more module script, and
the whole `<main>`, which becomes the extension's three cards followed by one
closed "Under the hood" block with the entire vault page inside it. The vault
files are copied, never edited: the panel is the vault.

Message names, all of them: `nema-ext:tools`, `nema-ext:execute` and
`nema-ext:result` between the bridge and the content script;
`nema-ext:page`, `nema-ext:passed`, `nema-ext:remembered`, `nema-ext:bar-share`
from the content script to the worker; `nema-ext:active-page`,
`nema-ext:execute`, `nema-ext:to-page` from the panel to the worker;
`nema-ext:page-changed` and `nema-ext:intent` from the worker to the panel;
`nema-ext:bar`, `nema-ext:toast` and `nema-ext:rescan` from the worker to a
content script. An intent the worker cannot deliver, because no panel is open,
waits until the panel's next `nema-ext:active-page` and rides back in the
answer.

## What is a prototype here

- **`<all_urls>` host permission.** The content script runs everywhere so the
  badge and the bar can tell you a page works with nema before you click
  anything. It reads one thing: the names of the tools the page already
  publishes to any agent, and then the offer those tools describe. A shipping
  version would ask for a site the first time you use it there.
- **ponytail: the 30 day approval is written by the panel.** The vault's own
  auto approval is one hour and it has no setter, so `rememberSite()` writes the
  expiry into the vault document it already holds and into the vault's
  `localStorage` key, then fires the vault's own change event so the view
  redraws. Upgrade path: one vault function, `setAutoApproval(audience, ms)`,
  that the vault's checkbox and the extension's both call.
- **One vault per browser profile.** The panel's vault lives in the
  `localStorage` of the extension's origin. It is not the same document as the
  vault on the web, and there is no sync: move a vault between them with Export
  and Import, under the hood.
- **Native WebMCP does not run on extension pages.** Chrome answers every
  `document.modelContext` call on a `chrome-extension://` document with
  "cannot be used when document.domain is enabled", so `panel-webmcp.js` hides
  the native runtime and the panel uses the WebMCP polyfill instead. The tools
  the vault registers in the panel are harmless either way: no agent reads them
  there. Pages in tabs use whatever their own browser gives them, native first.
- **The page bridge trusts the page.** `bridge.js` executes only tools the page
  itself registered, and the panel only ever sends the broker sequences, but a
  hostile page could answer a tool call with anything. The vault verifies every
  signature before a receipt moves a band, which is where it matters.
- **The polling is in the tab, not the panel.** A side panel that is opened as
  an ordinary tab, which is what the headless test does, has its timers
  throttled while it is in the background. The content script's four second pass
  runs in the tab the learner is looking at, and the worker wakes the panel with
  a message, which Chrome never throttles.
- **ChatGPT desktop's in-app browser does not run extensions.** There, and in
  any agent that speaks WebMCP, nema works without this: the vault page and the
  provider pages are the interface. The extension is for the browser you already
  use, with no agent at all.

## Test it

```bash
bash scripts/build-extension.sh
bash scripts/dev-restart.sh harness          # Saucier School on :8782
CHROME=<chrome with WebMCP> node packages/nema-extension/test/e2e.mjs
```

38 checks over the real extension in a real Chrome, driven through CDP with no
test doubles: it loads the unpacked build, finds the extension id from the
service worker target, opens the panel on a fresh profile, asserts the
onboarding and loads the demo learner from it, reads the Next card and its
rubric checklist, opens Saucier School, asserts the bar in the page's shadow
root, clicks **Share** in that bar, ticks "Remember this site for 30 days" and
approves in the vault's consent modal, asserts the card says "68 minutes became
27" and that the 30 day approval was written, answers the ratios
diagnostic as the learner, waits for the receipt to be collected with no click
at all and for the toast in the page, checks the manual button refuses to
collect it twice, ticks the Next card's rubric and presses Done, opens
Saucier School once more to watch the remembered site personalise itself with
nothing to approve, opens the blog to check the alignments it declares, and
reads the whole panel back to prove no token, key or id is outside the block
under the hood. Screenshots land in `SHOTS` (default `/tmp/nema-ext-shots`).

The last three checks drive the blog (`bash scripts/dev-restart.sh blog`, then
`http://localhost:8785`): the bar adds "This site names things its own way", and
the hood lists the site's own name for caramelization as confirmed on the site's
word, with "browning science" still open for an agent to propose.

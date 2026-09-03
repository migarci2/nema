# nema in your browser

> **Prove it once. Skip it everywhere.**
>
> A site asks your vault what you already know, you say yes, and the site
> adapts. When you pass something, it signs a receipt that any other site can
> ask about. The picture is on [the hub](https://nema.migarci2.dev/).

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
5. The first run offers three choices: load the demo learner, import a vault
   file, or start empty. Take the demo learner, then open
   <https://saucier.migarci2.dev> (or `http://localhost:8782` with the dev
   servers running). A small bar appears at the bottom of that page.

Reload any tab that was already open before you loaded the extension: a content
script only runs on a page that loads after it is installed.

Chrome 116 or newer. The pages themselves need WebMCP: Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`, or any Chrome at all, because every
nema page loads the WebMCP polyfill.

## The flow (CONTRACT section 24)

**1. Onboarding.** A vault with no receipts shows one sentence, "Learn anywhere
you see the nema mark. What you pass is kept here, and only shared when you say
so.", and three buttons. The demo and import buttons click the vault's own
controls, so there is one code path for each. "Start empty" is remembered in
`chrome.storage.local`, and the rest of the panel appears.

**2. Arriving at a site.** When the content script finds nema tools, the page
gets a bar at the bottom in a shadow root: "This site works with nema. Share
what you already know?" with **Share** and **Not now**. Not now is remembered
for that tab's session. Share is the user gesture `chrome.sidePanel.open` needs,
so the click is relayed to the service worker, which opens the panel and raises
an intent; the panel runs the share, opens the vault's own consent modal, and
tells the bar what the site did with the bands ("The path is 27 minutes instead
of 68"). When Chrome refuses to open the panel from there, the bar says "Open
nema to approve" and the toolbar icon turns yellow with a `!`.

The consent modal gains one line from the extension: **Remember this site for 30
days**. Ticking it writes `settings.autoApprove[origin]` with a 30 day expiry,
and the panel mirrors the remembered origins into `chrome.storage.local` so the
content script can ask before it draws the bar. A remembered site shows "Shared
with this site" and the share runs on load with nothing to approve.

**3. Learning.** While a nema page is visible in the active tab, the content
script polls `get_attempt_status` for the manifest's activities every four
seconds and re-reads the tool list, because a page registers its tools one at a
time and can add more later. When an activity turns `passed` it tells the panel
once; the panel issues the receipt, stages it with the vault's own
`stageReceipt`, and the page gets a toast naming the bands that moved: "Kept in
your vault: ratios, now durable". Failures, duplicates and pending issuers are
silent in the page and visible in the panel strip. The manual button stays as
**Check for receipts now**, and asks the page about every activity.

**4. Next.** The top of the panel is the most urgent need from `getNeeds(5)`:
the concept and ability, why it is due, its rubric as a checklist, and a **Done**
button that calls the vault's `recordSelfCheck` at the self report weight. When
the vault has no `recordSelfCheck` the button says what an agent would do
instead. When a site seen this session teaches that concept, the card links to
it (the manifests are cached by origin in `chrome.storage.session`).

**5. Alignments.** When a page's manifest names concepts its own way, the bar
adds "This site names things its own way" and the panel lists the alignments for
that origin: the ones the site declared for itself (handed to the vault's
`declareAlignments`), and any an agent proposed, with **Confirm** and **Reject**
wired to `confirmAlignment` and `rejectAlignment`. Local names nobody has
matched yet are named as still open.

**6. Tokens** never appear in the panel's own surfaces. The vault's "More" block
is where a token can still be pasted or copied by hand.

## How it is put together

| file | what it does |
|---|---|
| `manifest.json` | MV3: side panel, one content script pair, the action badge |
| `sw.js` | opens the panel on the action click and on the bar's Share, keeps one record per tab, caches the session's manifests, holds intents for the panel, relays messages, sets the badge |
| `content.js` | isolated world: asks the bridge what the page offers, owns the in page bar and toast in a shadow root, polls the page's attempts every four seconds while it is visible, forwards tool calls |
| `bridge.js` | MAIN world: the only file that touches `document.modelContext`. Lists tools and executes one, with a JSON string in and a parsed result out |
| `sidepanel.js` | the onboarding, the Next card, the "This page" strip, the alignments, the share and the receipt collection. Imports `/vault.js` so it is the same vault module app.js runs |
| `sidepanel.css` | the panel width and the extension's own cards. No new colours, no new type scale |
| `panel-webmcp.js` | hides native WebMCP on the panel's own page, see the caveat below |
| `icons/` | the nema mark at 16, 32, 48 and 128, rendered from `shared/brand/mark.svg` by `icons/render.mjs` |

`scripts/build-extension.sh` copies `apps/vault/public` into `dist/` and
`shared/` into `dist/shared/`, so the vault's absolute imports (`/vault.js`,
`/shared/...`) resolve inside `chrome-extension://<id>/`. `sidepanel.html` is
the vault's `index.html` with five substitutions: the title, the panel
stylesheet, `panel-webmcp.js` before the polyfill, the three extension
containers above the summary, and one more module script. The vault files are copied, never edited: the panel is the vault.

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
  and Import in the panel's "More" block.
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

31 checks over the real extension in a real Chrome, driven through CDP with no
test doubles: it loads the unpacked build, finds the extension id from the
service worker target, opens the panel on a fresh profile, asserts the
onboarding and loads the demo learner from it, reads the Next card and its
rubric checklist, opens Saucier School, asserts the bar in the page's shadow
root, clicks **Share** in that bar, ticks "Remember this site for 30 days" and
approves in the vault's consent modal, asserts the page rebuilt its path from 68
minutes to 27 and that the 30 day approval was written, answers the ratios
diagnostic as the learner, waits for the receipt to be collected with no click
at all and for the toast in the page, checks the manual button refuses to
collect it twice, ticks the Next card's rubric and presses Done, and opens
Saucier School once more to watch the remembered site personalise itself with
nothing to approve. Screenshots land in `SHOTS` (default `/tmp/nema-ext-shots`).

The alignment surfaces are exercised by hand against the blog
(`bash scripts/dev-restart.sh blog`, then open `http://localhost:8785`): the bar
adds "This site names things its own way", and the panel lists
`sugar-browning equivalent caramelization` as confirmed by the site with
`browning-science` still open for an agent to propose.

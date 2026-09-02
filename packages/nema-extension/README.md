# nema in your browser

A Chrome extension (Manifest V3) that puts the nema vault in the side panel and
brokers between it and any page that works with nema. There is no model in the
loop, no account and no server: two buttons, the same protocol objects, the same
consent modal.

## Load it (30 seconds)

```bash
bash scripts/build-extension.sh
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `packages/nema-extension/dist`.
4. Pin the nema icon, then click it: the vault opens in the side panel.
5. Click **Load demo learner** in the panel, then open
   <https://saucier.migarci2.dev> (or `http://localhost:8782` with the dev
   servers running). The action badge shows how many nema tools that page has.

Reload any tab that was already open before you loaded the extension: a content
script only runs on a page that loads after it is installed.

Chrome 116 or newer. The pages themselves need WebMCP: Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`, or any Chrome at all, because every
nema page loads the WebMCP polyfill.

## What the two buttons do

The "This page" strip appears at the top of the panel whenever the open page
registers nema tools. Nothing runs on its own: a person clicks.

**Share bands with this page**

1. Calls `describe_learning_offer` on the page and reads the manifest.
2. Builds the readiness request from the manifest's requirements, with the page
   origin as the audience and `personalize-<unit id>` as the purpose.
3. Runs the vault's `createAssertion`, which opens the vault's own consent
   modal in the panel. You approve or deny, line by line, and see the fixed list
   of what is never shared.
4. On approval, executes `present_assertion` on the page (falling back to
   `personalize_learning_path`, then `check_prerequisites`) with the token.
5. Reports what changed: the minutes before and after, the requirements the page
   recognised, and the disclosure now in your ledger.

**Take the receipt to my vault**

1. Polls `get_attempt_status` for every activity in the manifest.
2. For each activity you passed, calls `issue_evidence_receipt` on the page.
3. Stages each token with the vault's own `stageReceipt`.
4. Reports accepted, pending or already in your vault per receipt, with the
   issuer, the trust tier and the bands that moved.

Under both, the strip lists the tool calls it made, newest first, with the name,
the duration and the status, the way the vault's own activity strip does.

## How it is put together

| file | what it does |
|---|---|
| `manifest.json` | MV3: side panel, one content script pair, the action badge |
| `sw.js` | opens the panel on the action click, keeps one record per tab, relays messages, sets the badge |
| `content.js` | isolated world: asks the bridge what the page offers, tells the worker, forwards tool calls |
| `bridge.js` | MAIN world: the only file that touches `document.modelContext`. Lists tools and executes one, with a JSON string in and a parsed result out |
| `sidepanel.js` | the "This page" strip and the two broker actions. Imports `/vault.js` so it is the same vault module app.js runs |
| `sidepanel.css` | the panel width and the strip. No new colours, no new type scale |
| `panel-webmcp.js` | hides native WebMCP on the panel's own page, see the caveat below |
| `icons/` | the nema mark at 16, 32, 48 and 128, rendered from `shared/brand/mark.svg` by `icons/render.mjs` |

`scripts/build-extension.sh` copies `apps/vault/public` into `dist/` and
`shared/` into `dist/shared/`, so the vault's absolute imports (`/vault.js`,
`/shared/...`) resolve inside `chrome-extension://<id>/`. `sidepanel.html` is
the vault's `index.html` with four substitutions: the title, the panel
stylesheet, the strip container above the summary, and one more module script.
The vault files are copied, never edited: the panel is the vault.

## What is a prototype here

- **`<all_urls>` host permission.** The content script runs everywhere so the
  badge can tell you a page works with nema before you click anything. It reads
  one thing: the names of the tools the page already publishes to any agent. A
  shipping version would ask for a site the first time you use it there.
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
  itself registered, and the panel only ever sends the two broker sequences, but
  a hostile page could answer a tool call with anything. The vault verifies
  every signature before a receipt moves a band, which is where it matters.
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

The test drives the real extension over CDP: it loads the unpacked build, finds
the extension id from the service worker target, opens the panel, loads the demo
learner, opens Saucier School, clicks both buttons, approves the disclosure in
the modal, answers the ratios diagnostic as the learner would, and asserts that
the page rebuilt its path (68 minutes to 27) and that the vault gained one
verified receipt. Screenshots land in `SHOTS` (default `/tmp/nema-ext-shots`).

/* nema extension: make WebMCP work on the panel's own page.
 *
 * Chrome's native WebMCP refuses to run on a chrome-extension:// document. Every
 * call comes back with "document.modelContext cannot be used when document.domain
 * is enabled", asynchronously, so there is no synchronous probe to branch on and
 * the decision has to be taken from the scheme. The vault registers its eleven
 * tools on load, so without this the panel would show a dead tools pill and an
 * empty tool activity strip.
 *
 * So the panel does what a browser without WebMCP does: it hides the native
 * runtime before /shared/webmcp-polyfill.js runs, and the polyfill installs
 * itself instead. Nothing else in the vault changes: the same tools.js
 * registers the same tools against the same API.
 *
 * The check below then asks the native runtime whether it would have worked. On
 * the day Chrome lifts the restriction it says so in the console, and this file
 * can be deleted.
 */

(() => {
  if (location.protocol !== 'chrome-extension:') return;
  const native = document.modelContext;
  if (!native) return;

  Object.defineProperty(document, 'modelContext', {
    value: undefined, writable: true, configurable: true
  });

  Promise.resolve()
    .then(() => native.getTools())
    .then(() => {
      console.info('[nema] native WebMCP now works on extension pages: panel-webmcp.js is obsolete');
    })
    .catch(() => {});
})();

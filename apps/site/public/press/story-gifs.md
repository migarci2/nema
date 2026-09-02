# Story GIFs

Five short, cropped, looping GIFs recorded from the live production sites in a
headless Chrome for Testing 154 with native WebMCP. Each one holds its final
state for 1.5 seconds before it loops. They are meant to replace the tall full
page screenshots in the "What it does" section of the Devpost story, and they
are served from https://nema.migarci2.dev/press/.

One line each: file, size in bytes, duration, dimensions, what it shows.

- **story-ask.gif** | 2,975,693 bytes | 18.5 s | 1100 x 890 | Saucier School before it knows anything ("Nothing is checked until your vault says so", three `not checked` pills, 68 minutes), a click on **Connect your vault**, then the vault's own window on the vault's own origin: the consent question in words, the Shared list (Knife skills verified, Heat control verified, Cooking ratios uncertain), the Not shared list, the 30 minute expiry, and **Approve**. Back on the course: "Read from your vault: 68 minutes became 27", the pills flip, and the path shows three items struck through with the reason on each one, "Your path: 27 of 68 minutes".
- **story-receipt.gif** | 992,286 bytes | 24.0 s | 1100 x 890 | The "Which vinaigrette holds" diagnostic on Saucier School: the question, the four builds, the learner picks 3 parts oil to 1 part acid with mustard, submits, and the kitchen grades it `passed`. The receipt panel says "Saucier School signed what you did. Verified." with `Ratios, hands on passed`; **Keep in my vault** is clicked and the course prints "Kept: ratios, now usable." Then the vault's own evidence ledger, with that receipt on top: "Which vinaigrette holds, Saucier School, verified", opened to show "Cooking ratios, apply: uncertain to usable, review in 3 days".
- **story-second-site.gif** | 2,179,483 bytes | 19.9 s | 1100 x 890 | Line Cook Lab, a site that has never spoken to Saucier School. It opens on the two locked labs and the exact reason ("Needs evidence that you can explain emulsions, at least uncertain"), then **Connect your vault**, then the same consent modal asking a different question (Mise en place verified, Emulsions uncertain, Food safety verified) and **Approve**. The requirements fill in, "Verified. 4 of 4 activities unlocked", and both labs are open, with the two intro lessons marked "already covered".
- **story-extension.gif** | 3,346,198 bytes | 21.4 s | 1100 x 890 | The nema Chrome extension loaded unpacked in a real Chrome, with no model anywhere. The in page bar appears on Saucier School ("This site works with nema. Share what you already know?"), **Share** is clicked, and the vault's consent modal opens in the side panel with the extension's own "Remember this site for 30 days" line; **Approve**. The page rebuilds itself ("68 minutes became 27") and the bar reports "Shared with this site. The path is 27 minutes instead of 68." The learner then answers the diagnostic in the page and the receipt is collected with no click: the toast reads "Kept in your vault: ratios, now durable".
- **story-article.gif** | 3,544,885 bytes | 16.3 s | 1000 x 810 | https://aesgcm.migarci2.dev/compare, a real CC BY-SA article mirrored twice: "Same article. 112 lines added." The two columns scroll together, `original.html` on the left and `index.html, with nema` on the right, so the added attribution block and the offset between them are visible. Then the frame zooms into a retrieval question the nema version adds inside the text ("One question: AES on its own. 1 minute. Graded in this page, no answer leaves it."), the reader answers it, and the page replies "Both right. A receipt is below."

Notes for whoever writes the captions:

- No captions, labels or synthetic text are burned into any of these. The only
  overlay is a pointer, and only where the click target would otherwise be
  unclear.
- Every "Under the hood" block stays closed, so no token, key or learner id is
  visible in any frame.
- All five are recorded against the live origins, not a local build: the vault
  at nema-vault.migarci2.dev, saucier.migarci2.dev, linecook.migarci2.dev and
  aesgcm.migarci2.dev.
- story-article.gif is 1000 px wide rather than 1100: a scrolling shot changes
  every pixel of every frame, and the smaller frame is what keeps it under the
  4 MB budget with the two columns still legible.

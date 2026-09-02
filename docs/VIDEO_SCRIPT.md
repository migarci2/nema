# Video script, 2:55

One take per shot, cut on the beat. Total runtime 2 minutes 55 seconds.
Voiceover is about 370 words, which is a calm 130 words per minute with room to
breathe. Captions are burned in, lower third, JetBrains Mono, cyan on navy.

The story is one cook who wants to make a pan sauce that holds through service.
There is no nema agent in this film: the vault side runs in a real terminal
agent, Claude Code or Codex with `packages/nema-mcp`, and the sites are ordinary
web pages in a browser. Everything technical is shown, never narrated as a
feature.

Frame: the terminal on the left half, the browser on the right half, both
visible for the whole film. Cut by moving the cursor between them, not by
switching windows.

## Shot list

### 0:00 to 0:14, cold open on the vault

On screen. The vault at https://nema-vault.migarci2.dev in the right half, demo
learner already loaded. Summary strip with the big Pixelify numbers: 18
verified, 7 fragile, 4 reviews due. The learning graph fills that half, nodes
coloured cyan, teal, blue and grey. Hover one node so the tooltip reads
"Emulsions". The left half shows the terminal, idle, with the nema MCP server
listed.

Caption: `Your learning state belongs to you, not to the websites you visit.`

Voiceover: "This is everything the web taught me about cooking. Every concept
with a band, from unknown to durable. Not on their servers. In a vault I own,
built from signed evidence."

### 0:14 to 0:26, the problem

On screen. Right half switches to the Saucier School full path panel before any
personalization: all seven activities, sixty eight minutes, including a knife
refresher and a heat primer. Left half still shows the vault summary in the
terminal from `get_learner_state`, knife skills and heat control usable.

Caption: `Every site teaches you from zero.`

Voiceover: "Here is the problem. Every site that teaches me starts from zero. It
cannot know I already hold a knife properly, and it has no honest way to ask."

### 0:26 to 0:42, the offer

On screen. Saucier School, which looks like what it is: somebody else's course
site, warm paper, a serif, a small "Works with nema" badge in the corner. Zoom
slightly on the three grey requirement pills.

Caption: `describe_learning_offer`

Voiceover: "So it asks. Pan Sauces and Emulsions, sixty eight minutes, seven
activities, and three prerequisites it wants to know about before it plans
anything."

### 0:42 to 1:04, the disclosure, hold it

On screen. The terminal. I type: "Make a readiness assertion for Saucier School,
knife skills apply, heat control explain, ratios apply." The MCP elicitation
prompt fills the left half and everything stops: audience, purpose, the three
lines that will be shared with their bands, the fixed list of what is not
shared, the thirty minute expiry. Four full seconds with no keystroke while the
voiceover reads it out. Then I approve. One second cut to the browser vault,
which asks the same question in a modal.

Caption: `The human decides. Every time.`

Voiceover: "My agent cannot read my vault. It can only ask, and the vault stops
and asks me. Audience: the cooking school. Shared: three concepts, three bands.
Not shared: my history, my scores, everything else. Thirty minutes, then it
expires. I approve. In a browser it is a modal. Same question, same click."

### 1:04 to 1:24, sixty eight becomes twenty seven

On screen. The signed token in the terminal, copied, pasted into "Paste an
assertion" on Saucier School. The three requirement pills fill in, two cyan
`verified`, one yellow `uncertain`. Three items strike through one after the
other, each with its reason beside it: the heat primer, the knife refresher, the
ratios primer. The six minute diagnostic stays. The minutes counter animates 68
to 27.

Caption: `68 minutes to 27. present_assertion`

Voiceover: "One token, carried across by hand. The site verifies the signature,
checks it was minted for its own origin, and rebuilds the course. Three items
strike through, each with its reason. Forty one minutes gone. The ratio check
survives, because one prerequisite came back uncertain."

### 1:24 to 1:46, the human does the work

On screen. The `ratios-diagnostic` activity, "Which vinaigrette holds". Four
written ratios. The cursor selects the 3 to 1 with mustard and submits. Teal
pass feedback. Then the receipt panel: the token in a textarea, decoded claims
beside it.

Caption: `No tool submits an answer. issue_evidence_receipt`

Voiceover: "Now the part no agent can do. No tool on this site submits an
answer. Which vinaigrette holds: three parts oil, one part acid, mustard whisked
in first. I answer it. The grader runs on the server, and only then does the
site sign a receipt."

### 1:46 to 2:04, the receipt comes home

On screen. Copy the receipt, paste it into the terminal: "Stage this receipt."
`~/.nema/vault.json` gains a row, and the terminal prints the diff. Cut to the
browser vault, refreshed: the evidence ledger row with its cyan verified badge,
one state row moving `uncertain` to `usable`. Cut back to Saucier School for one
second: 27 becomes 21.

Caption: `Signature verified. uncertain to usable.`

Voiceover: "The receipt goes back to my vault. It verifies the signature,
rejects duplicates, and recomputes. Ratios moves from uncertain to usable, and
the path shortens again, to twenty one minutes. Nothing is stored that I cannot
recompute."

### 2:04 to 2:24, a second site asks the same vault

On screen. Line Cook Lab, which looks nothing like the last site: near black,
monospace, an ops tool for the pass. A second assertion from the terminal, a
second approval, one beat on the `learnerKeyId` line, which is a different
string here. Then the prerequisite panel: `mise-en-place.explain` verified,
`food-safety.apply` verified, `emulsions.explain` missing. Both intro lessons go
grey as skippable. The labs stay locked, with the missing requirement named on
the lock.

Caption: `Different site. Different learner id. check_prerequisites`

Voiceover: "A different website, a drill for line cooks. No partnership, no
shared account. It asks my vault about three things it does not teach. Mise en
place and food safety come back verified, from work I did somewhere else.
Emulsions comes back missing, and it says so."

### 2:24 to 2:40, one tag on a blog

On screen. https://maillard.migarci2.dev, a plain white article with a serif
column. Scroll to the end, click Mark as read, answer the two questions, and a
receipt appears with Send to vault. Then split the frame: the page's view source
on the left, two highlighted tags, and the vault ledger on the right showing the
new row labelled `self`.

Caption: `One tag on a blog. Trust tier: self, capped at 0.3.`

Voiceover: "And this is a blog post. No backend, no account. One manifest tag,
one script tag, and its readers get receipts too. It signs with its own key: a
site vouching for itself, and weighed as such."

### 2:40 to 2:55, the close

On screen. Cut to the site hub. Wordmark, then three lines appear one at a time
in mono, then the URL.

Captions, in order:
`3 independent websites`
`1 learner-owned vault`
`0 shared accounts`
`nema.migarci2.dev`

Voiceover: "The web teaches. Your vault remembers. Your agent connects the two.
nema is a protocol anyone who teaches on the web can install in a minute."

## Recording notes

- 1920 by 1080, 16:9, 60 fps if the capture allows it, otherwise 30.
- Chrome 149 with `chrome://flags/#enable-webmcp-testing` enabled, so tool
  registration is native. Fall back to the polyfill build only if the flag
  misbehaves; the UI is identical.
- The terminal is a real session: `claude mcp add nema -- node /path/to/nema/packages/nema-mcp/bin.mjs`,
  or the same with `codex mcp add`. Run `node packages/nema-mcp/bin.mjs seed`
  before the take so the vault is populated.
- Terminal at 16 pt or larger, a light on dark theme, no ligatures, prompt
  trimmed to one short segment. The words on screen have to be legible at 1080p.
- Cursor visible for the whole take. The clicks are the argument.
- Hide bookmarks bar, use a clean profile, no extensions, no notifications.
  Nothing on screen from a third party product, no logos other than nema's and
  the example sites' own marks.
- The cut from Saucier School to Line Cook Lab at 2:04 has to land as a cut to a
  different website, and the cut to the blog at 2:24 has to land as a cut to
  something that is obviously not a course at all. Do not soften either. The
  three palettes doing the work is half the argument of the film.
- One continuous screen recording per shot, cut in the edit. Do not stitch
  mid-interaction.
- Audio: one voice, close mic, no music. Room tone under the cuts.
- Hold the elicitation prompt for four full seconds with no keystroke. The
  voiceover runs over the hold; it is the picture that stays still, not the
  audio. It is the shot that separates this from everything else in the
  showcase.
- Keep the tool activity strip in frame on every browser shot, so a viewer can
  read the tool name that produced the change on screen.
- No emojis in captions. Captions are burned in and also uploaded as a subtitle
  track for accessibility.
- Final check before upload: total runtime under 3 minutes, audio present,
  YouTube set to public, link pasted into Devpost.

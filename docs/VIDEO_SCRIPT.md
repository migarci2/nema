# Video script, 2:55

One take per shot, cut on the beat. Total runtime 2 minutes 55 seconds.
Voiceover is about 385 words, which is a calm 130 words per minute with room to
breathe. Captions are burned in, lower third, JetBrains Mono, cyan on navy.

## Shot list

### 0:00 to 0:14, cold open on the vault

On screen. The vault at https://nema-vault.migarci2.dev, demo learner already
loaded. Summary strip with the big Pixelify numbers. The learning graph fills
the frame, nodes coloured cyan, teal, blue and grey.

Caption: `Your learning state belongs to you, not to the websites you visit.`

Voiceover: "This is everything a set of websites taught me. Every concept with a
band, from unknown to durable. Not on their servers. In my browser, in a vault I
own, built from signed evidence."

### 0:14 to 0:26, the problem

On screen. Split the frame. Left, the vault state table. Right, the Harness Lab
full path panel before any personalization: all seven activities, sixty eight
minutes, including two lessons on things the left half already shows as usable.
Both halves are nema pages, so nothing from a third party is on screen.

Caption: `Every site teaches you from zero.`

Voiceover: "Here is the problem. Every site that teaches me starts from zero. It
has no way to know what I already did somewhere else, and no honest way to ask."

### 0:26 to 0:44, the offer

On screen. The coach at https://nema-coach.migarci2.dev. Left column chat, right
column iframe on the Harness Lab. Type the prompt, watch the unit hero render.
Zoom slightly on the three grey requirement pills.

Caption: `describe_learning_offer`

Voiceover: "So it asks. This is my agent, and this is an engineering lab that
speaks the protocol. One tool call returns its manifest: Designing Agent Evals,
sixty eight minutes, seven activities, and three prerequisites it wants to know
about before it plans anything."

### 0:44 to 1:04, the consent modal, hold it

On screen. The vault's consent modal, full frame, four full seconds with no
cursor movement while the voiceover reads the list out. Then the cursor moves
and clicks Approve.

Caption: `The human decides. Every time.`

Voiceover: "The agent cannot read my vault. It can only ask, and the vault stops
and asks me. Audience: the harness lab. Shared: three concepts, three status
bands. Not shared: my attempt history, my scores, every other subject, my review
schedule. Thirty minutes, then it expires. I approve."

### 1:04 to 1:24, sixty eight becomes twenty seven

On screen. Back to the harness. The three requirement pills fill in, two cyan
`verified`, one yellow `uncertain`. Three lessons strike through, one after the
other, each with its reason beside it: agent-loop primer, testing refresher,
JSON Schema primer. The diagnostic stays. The minutes counter animates 68 to 27.

Caption: `68 minutes to 27. personalize_learning_path`

Voiceover: "The signed token goes back to the site. It checks the signature,
checks the token was minted for its own origin, and rebuilds the course. Three
lessons struck through, each with its reason. Forty one minutes gone. The short
diagnostic survives, because one prerequisite came back uncertain."

### 1:24 to 1:46, the human does the work

On screen. The diagnostic activity. Four schema options. The cursor selects one
and submits. Teal pass feedback. Then the receipt panel: the token in a
textarea, decoded claims beside it.

Caption: `No tool submits an answer. issue_evidence_receipt`

Voiceover: "Now the part the agent cannot do. There is no tool on this site that
submits an answer. I answer it. The grader runs on the server, and only then
does the site sign a receipt: this learner, this activity, this claim, this
grader."

### 1:46 to 2:04, the receipt comes home

On screen. The vault. The evidence ledger gains a row with a cyan verified
badge. The state table animates one row from `uncertain` to `usable`. The tool
activity strip logs `stage_evidence_receipt`. Cut back to the harness for one
second: 27 becomes 21.

Caption: `Signature verified. uncertain to usable.`

Voiceover: "My agent carries the receipt back. The vault verifies the signature
against its issuer list, rejects duplicates, and recomputes. One band moves from
uncertain to usable, and the path shortens again, to twenty one minutes. Nothing
was stored that I cannot recompute from evidence."

### 2:04 to 2:26, a second site asks the same vault

On screen. Switch the iframe to Agent Security. Approve the second consent modal
quickly, and pause one beat on the `learnerKeyId` line, which is a different
string here. Then the prerequisite panel: `tool-calling.explain` verified,
`threat-modeling.apply` verified, `feedback-loops.explain` missing. Both intro
lessons go grey as skippable. The advanced lab stays locked, with the missing
requirement named on the lock.

Caption: `Different site. Different learner id. check_prerequisites`

Voiceover: "And here is the point. A completely different website. No
partnership, no shared account, no API key. It asks my vault about three
concepts it does not teach. Two come back verified, from work I did somewhere
else. One comes back missing, and it says which."

### 2:26 to 2:42, the agent closes the gap

On screen. The chat. The agent asks one question from the vault's rubric, the
learner types an answer, `record_agent_assessment` runs. A new ledger row
appears with the "agent assessed" badge, and one band moves from `unknown` to
`fragile`. Switch back to the security iframe: a fresh assertion, and the
advanced lab flips from locked to available with the label "Prerequisite
recognised from another provider".

Caption: `agent assessed, weight 0.6. Locked to available.`

Voiceover: "So the agent coaches exactly that gap, and writes the result down as
agent assessed, weight zero point six. Weaker evidence, honestly labelled. It is
enough to clear the lock, and the advanced lab opens."

### 2:42 to 2:55, the close

On screen. Cut to the site hub. Wordmark, then three lines appear one at a time
in mono, then the URL.

Captions, in order:
`2 independent websites`
`1 learner-owned vault`
`0 shared accounts`
`nema.migarci2.dev`

Voiceover: "The web teaches. Your vault remembers. Your agent connects the two.
nema. Your learning state, everywhere."

## Recording notes

- 1920 by 1080, 16:9, 60 fps if the capture allows it, otherwise 30.
- Chrome 149 with `chrome://flags/#enable-webmcp-testing` enabled, so the tool
  registration is native. Fall back to the polyfill build only if the flag
  misbehaves; the UI is identical.
- Record the coach page at 1280 logical width so the chat column and the iframe
  both stay readable at 1080p. Browser zoom 110 percent.
- Cursor visible for the whole take. The clicks are the argument.
- Hide bookmarks bar, use a clean profile, no extensions, no notifications.
  Nothing on screen from a third party product, no logos other than nema's.
- One continuous screen recording per shot, cut in the edit. Do not stitch
  mid-interaction.
- Audio: one voice, close mic, no music. Room tone under the cuts.
- Hold the consent modal for four full seconds with no cursor movement. The
  voiceover runs over the hold; it is the picture that stays still, not the
  audio. It is the shot that separates this from everything else in the
  showcase.
- Keep the tool activity strip in frame during every tool call, so a viewer can
  read the tool name that produced the change on screen.
- No emojis in captions. Captions are burned in and also uploaded as a subtitle
  track for accessibility.
- Final check before upload: total runtime under 3 minutes, audio present,
  YouTube set to public, link pasted into Devpost.

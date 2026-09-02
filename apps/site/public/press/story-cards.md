# Story cards

Designed cards for the Devpost "Project Story", to be used instead of tall raw
screenshots. Every card is 1600 px wide, exported at 1x, and sits comfortably at
the ~700 px Devpost renders markdown images at. Sources are in
`docs/assets/press/` (`card-*.html` plus the shared `card.css`); re-render with
`node docs/assets/press/render.mjs [name ...]` while the site dev server is up on
port 8780 (`bash scripts/dev-restart.sh site`).

Hosted at `https://nema.migarci2.dev/press/<file>`.

| file | size | what it shows |
|---|---|---|
| `card-how-it-works.png` | 1600 x 785 | The protocol in three beats: a page declares what it teaches, the vault answers three status words with the reader's consent, the page signs a receipt that goes back to the vault. |
| `card-one-tag.png` | 1600 x 880 | The whole install as a syntax coloured code card, the two script tags, and the six WebMCP tools the page then exposes. |
| `card-consent.png` | 1600 x 898 | The vault's consent modal drawn as a component, with the live wording: what Saucier School is asking, the three bands shared, the six categories withheld, the thirty minute expiry, Deny and Approve. |
| `card-minutes.png` | 1600 x 744 | 68 to 27 to 21 minutes, with the one line reason under each number. |
| `card-trust.png` | 1600 x 726 | The three trust tiers, registered, origin and self, with the evidence weight each earns and `pending` as a footnote. |
| `card-agents.png` | 1600 x 712 | Five clients, ChatGPT desktop, Chrome 149+, Claude Code, Codex and the nema extension, all wired into one vault and the same eleven tools. |
| `card-alignment.png` | 1600 x 719 | A site's own word, "browning science", meeting the vault's registry name, Maillard reaction: proposed by an agent, confirmed by the learner. |
| `card-diff.png` | 1600 x 892 | "Same article. 112 lines added.": the AES-GCM mirror, original on the left and the nema version on the right with the additions in cyan, and the CC BY-SA 4.0 attribution. |

Suggested placement in the story:

- Inspiration, after the opening: `card-how-it-works.png`
- What it does, at "A protocol a site installs in a minute": `card-one-tag.png`
- What it does, at "Consent you can see": `card-consent.png`
- What it does, at "Two example courses": `card-minutes.png`
- What it does, at "Two real articles": `card-diff.png`
- What it does, at "Any agent": `card-agents.png`
- What it does, at "Sites that speak their own names": `card-alignment.png`
- How we built it, at the three trust tiers bullet: `card-trust.png`

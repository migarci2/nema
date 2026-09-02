# Story cards

Designed cards for the Devpost "Project Story", used instead of tall raw
screenshots. One idea per card, drawn rather than written.

Every card is rendered at 1600 px wide and downscaled to a 720 px `-sm.png`,
which is what the story embeds. Sources are in `docs/assets/press/`
(`card-*.html` plus the shared `card.css`).

    bash scripts/dev-restart.sh site          # tokens.css and the fonts, on 8780
    node docs/assets/press/render.mjs         # all eight, or pass names
    python3 docs/assets/press/resize.py       # the 720 px variants

Hosted at `https://nema.migarci2.dev/press/<file>`.

| card | 1x | embed | what it shows |
|---|---|---|---|
| how it works | `card-how-it-works.png` 1600 x 657 | `card-how-it-works-sm.png` 720 x 296 | A page, the nema mark, a signed receipt, two arrows: page asks, vault answers, page signs. |
| one tag | `card-one-tag.png` 1600 x 618 | `card-one-tag-sm.png` 720 x 278 | The whole install: the two script tags in a code frame, nothing else. |
| consent | `card-consent.png` 1600 x 866 | `card-consent-sm.png` 720 x 390 | The consent modal reduced to its skeleton: the site's name, three concepts with their bands, Deny and Approve. |
| minutes | `card-minutes.png` 1600 x 456 | `card-minutes-sm.png` 720 x 205 | 68 to 27 to 21 minutes. |
| trust | `card-trust.png` 1600 x 772 | `card-trust-sm.png` 720 x 347 | What a signature is worth: registered and origin at full weight, self capped. |
| agents | `card-agents.png` 1600 x 684 | `card-agents-sm.png` 720 x 308 | Five clients, ChatGPT desktop, Chrome 149+, Claude Code, Codex and the nema extension, wired into one vault. |
| alignment | `card-alignment.png` 1600 x 452 | `card-alignment-sm.png` 720 x 203 | The site's word and the vault's name, and "is the same thing as" between them. |
| diff | `card-diff.png` 1600 x 782 | `card-diff-sm.png` 720 x 352 | The AES-GCM mirror, original beside the nema version with the additions in cyan, headlined "112 lines added". |

Suggested placement in the story:

- Inspiration, after the opening: `card-how-it-works-sm.png`
- What it does, at "A protocol a site installs in a minute": `card-one-tag-sm.png`
- What it does, at "Consent you can see": `card-consent-sm.png`
- What it does, at "Two example courses": `card-minutes-sm.png`
- What it does, at "Two real articles": `card-diff-sm.png`
- What it does, at "Any agent": `card-agents-sm.png`
- What it does, at "Sites that speak their own names": `card-alignment-sm.png`
- How we built it, at the three trust tiers bullet: `card-trust-sm.png`

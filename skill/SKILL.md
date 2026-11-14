---
name: deck
description: Use when creating, editing, restyling or reviewing a talk made with deck (a <talk>/deck/ with slides.html, outline.md or sources/digest.md), including turning notes, transcripts, posts or other source material into a talk's outline and slides, designing a new look (a deck theme), and recording a demo slide's fallback clip.
---

# Writing a talk

A talk is a folder: `<talk>/deck/` holds `slides.html` (hand-written
HTML), `theme.css`, `outline.md`, `sources/` and `media/`;
`<talk>/clips/` holds the scripts that record demo fallback clips.
Every command runs from the talks folder as `bun deck <command>`
(`bun deck` lists them).

The reference is `AUTHORING.md` in `deck`'s folder (`../AUTHORING.md`
from this file): the rules, the outline and digest formats ("The
story") and the themes. The components and their markup are in the
talk's theme's `CATALOG.md` (`../themes/<theme>/CATALOG.md`; the theme
is the one `slides.html` links). Read both before writing any slide,
and the catalog again for each new kind of slide you build.

## A new talk, or new material for one

Work in this order; each step is done only when its criterion holds.

1. **Scaffold.** `bun deck new <talk> --title "..." --theme <theme>`,
   with the theme the speaker named (`bun deck` lists them), else
   the default. A look no theme has is a new theme first: see "A new
   look". Done when `<talk>/deck/slides.html` exists from the theme's
   starter (never a copy of another talk's deck).
2. **Digest.** Read everything in `<talk>/deck/sources/` and write
   `sources/digest.md`. Done when every fact, number, quote and example
   the talk could use is a numbered item, worded as the source words
   it, with where it came from; someone else's work is `Kind: other`
   with a `Credit:`.
3. **Outline.** Write `<talk>/deck/outline.md`: Point, Before, After,
   Duration, sections with a Question and minutes, and beats whose
   headlines state the point. Done when the beat headlines alone, read
   top to bottom, tell the story; every beat that states a fact cites
   its digest item; and `bun deck check <talk> --outline` prints no
   issues.
4. **Gate.** Show the speaker the outline (Point, sections, beat
   headlines) and wait for their approval. Write no slide before it.
5. **Slides.** Build each beat in `slides.html` with `data-beat`;
   slides the outline does not cover carry `data-custom`. Keep
   `bun deck dev <talk>` running: its badges cover overflow,
   size, contrast, filler, drift from the outline and unsourced claims,
   and `h` shows the headline readout. Done when every beat has its
   slide and no slide shows a badge.
6. **Check.** See "Done" below.

## A new look

When the speaker wants a look no theme has (their brand, "make it look
different"), design a theme before any slide. Its reference is
`THEMES.md` in `deck`'s folder (`../THEMES.md` from this file).

1. `bun deck theme <name> --from <the closest theme>`.
2. Make it the look: the tokens in both modes, the fonts (woff2 files
   with their licenses in `fonts/`), the motion (builds, slide changes,
   what holds still), then the components the talk needs, each with a
   row in the theme's `CATALOG.md`. Change the components' shapes, not
   only their colors: a new look that keeps another theme's boxes is a
   recolor.
3. Keep `template/slides.html` one slide per beat, using the new
   components.
4. `bun deck new try-<name> --theme <name>`, then `bun deck check
   try-<name>`. Done when it reports only the starter's placeholders and
   the contact sheets look finished in both modes.
5. **Gate:** show the speaker the contact sheets and wait for approval
   before building the talk on it.

## Changing an existing deck

- `outline.md` is the authority for what it says: change the beat and
  the slide in the same edit. `slides.html` may hold more than the
  outline mentions.
- Talk-specific styling goes in `<talk>/deck/theme.css`. A new pattern
  every talk on that theme could use goes in the theme's `theme.css`
  with a row in its `CATALOG.md`.

## Demo slides

- A demo slide carries `data-demo="<the demo app's URL>"` and a
  `data-time`; the deck warns the speaker when that server is down.
- It gets a recorded fallback clip from the real app, from a
  `<talk>/clips/demo-N.ts` script on `deck`'s `clip.ts`, run with
  `bun <talk>/clips/demo-N.ts` (Playwright and ffmpeg). Captions say
  what is happening; the network panel shows only real requests.
- Dividers get `data-at` from the outline's minutes.

## Copy

- Every anecdote, story and number comes from the speaker or the
  digest. Where one is missing, put a `data-placeholder` and ask.
- Say the positive thing plainly; the lint names the filler patterns
  to rewrite. In the speaker's own copy, a finding goes to them as a
  suggested rewrite.
- Headlines state the point in sentence case, with nothing stacked
  above them. Use commas, colons or a new sentence where a dash would
  go: em-dashes are flagged anywhere a person reads.
- A slide about a real product shows a real capture of it.
- A talk's own look lives in its diagrams and examples, on the theme's
  fonts and palette.

## Done

`bun deck check <talk>` (once per machine first: `bun install`, then
`bunx playwright install chromium`). Done when it exits clean; the dark
and light contact sheets in `snapshots/` look right (mid-transition
frames too, for motion changes); `snapshots/story.md` reads as a story;
and the `share/` images it rendered (the link preview `og.png` and the
tab icons) look right and are committed with the deck, along with
`media/qr-follow.svg` when the deck shows one.

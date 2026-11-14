# Authoring a talk

How to make a talk that is calm and easy to follow with little effort: a
theme gives you the look (see Themes), the engine gives you the motion,
and this page gives you the rules every talk follows, whatever its theme.

## Start

```
bun deck new my-talk --title "My talk title"   # deck, outline, sources, clip scaffolding
bun deck dev my-talk                           # opens it: live reload + lint badges; h for the headline readout
bun deck check my-talk --outline               # the outline and sources alone, no browser
bun install && bunx playwright install chromium   # once, for check
bun deck check my-talk                         # every slide in both themes; writes dist/, story.md, share/
```

The scaffold is a working 13-slide deck that uses every pattern below,
with an outline and a digest to match. Keep what you need, delete the rest.

## Work in this order

1. **Sources.** Put the raw material in `deck/sources/`: your notes,
   voice memo transcripts, posts, papers, a `links.md`. Write
   `sources/digest.md` from it: each fact, number, quote and example the
   talk might use, numbered, said the way the source says it.
2. **Outline.** Write `deck/outline.md` before any slide: the Point, the
   audience Before and After, the sections (each with its question and
   minutes) and the beats. Read the beat headlines alone, top to bottom;
   if they do not tell the story, fix the outline, not the slides. Get it
   approved before moving on.
3. **Slides.** Build each beat as a slide (or a few) carrying
   `data-beat="1.2"`. Custom slides the outline does not cover carry
   `data-custom`. Work with the dev server open.
4. **Check.** `bun deck check` passes, the contact sheets look right in both
   themes, and `snapshots/story.md` reads as a story. Commit the
   `share/` images it writes (the link preview and tab icons).

## The story: outline.md and sources/digest.md

The outline is the authority for what it says; `slides.html` stays
hand-built and can hold anything the outline does not mention. The dev
server and `check` compare the two and flag the drift; fix
whichever side is wrong.

```
# Talk title

Point: the one sentence the audience should leave with
Before: who is in the room and what they know
After: what they can do when they walk out
Duration: 50 min

## 1 · Page load · 8 min
Question: the question this section answers

### 1.2 · The headline, exactly as the slide says it
Sources: S1.3, S2
Plan:
What the slide shows or does: a diagram, a shot list, the fallback.
Screen:
> Text that must appear on the slide (tables and lists are fine).
Say:
The slide's notes, word for word.
```

- Every field is optional. Plan, Screen and Say run to the next field or
  heading; the one-line fields end at a blank line. Other prose and
  other headings are free text the tools skip.
- What is checked: the slide's headline equals the beat's; each Screen
  line (each table cell, each phrase between punctuation) is on the
  slide; the notes equal Say; slides follow the outline's order; every
  beat has a slide; sections add up to the Duration.
- `sources/digest.md` holds `## S1 · Title` sources with `Kind: own`
  (your work: no credit on screen) or `Kind: other` (someone else's:
  needs `Credit:`), an optional `From:` (a path or URL), and numbered
  items. Cite items from a beat (`Sources: S1.3`) or from a slide or any
  element in it (`data-src="S1.3"`).
- With a digest, every number with a unit (16 kB, 40%, 3x, 200 ms) and
  every quotation on screen needs a source. A slide citing an `other`
  source gets a small source line, and a `section.credits-slide` lists
  them all.

## The rules

These came out of real feedback on a real talk. Follow them by default.
Class names below are the house theme's; other themes have their own
for the same slides (see each theme's CATALOG.md).

**Assume zero context.**
- Open with a level-set (the `.ways` two-card slide) before any jargon.
- Define every term on screen the first time it appears, in plain words
  (`**Out-of-band:** an element marked ... replaces ...`). Notes are not
  enough; the room cannot see them.
- Introduce the running example with a real, annotated screenshot.
- Never use a term before the slide that defines it.

**Pace one thing per click.**
- The headline and the first thing to look at arrive with the slide.
  Every later point is a `data-build`.
- Lists, panels, second code blocks and takeaway lines are builds.
- Code that evolves uses a delta reveal (`delta-reveal`, `.dl-add`,
  `.chip-new`): the old code first, the change on the next click.
- A slide with more than about five builds is two slides.

**Structure the talk so people always know where they are.**
- Three sections (or fewer), each opened by a `.divider` slide.
- Every slide in a section carries `data-section="N"` on its footer, which
  lights that many squares.
- A recurring diagram that grows with the talk (like the speeds track),
  recapped at the end.
- One or two `.mode-anchor` lines worth quoting, and a closing callback.
- Pain points are walls (`.mode-wall`): show the setup, play the pain,
  then land the poster with the consequence in red and the principle in blue.

**Copy.**
- Headlines are sentence case and state the point. No eyebrow or kicker
  labels above them. The headline readout (`h`) flags short ones.
- No em-dashes anywhere on screen (`check` flags them).
- No filler, on screen or in the notes. The lint flags "No X, Y" lines,
  "X did. Y didn't." flourishes, "isn't just", buzzwords (seamless,
  leverage, unlock...), intensifiers (incredibly, truly...) and dashes.
  `data-lint-off="buzzword"` on an element allows one where it is the
  honest word. Lists of three and empty transitions need a human read.
- Never invent anecdotes or "we shipped this bug" stories. Only say what
  happened; if unsure, leave a placeholder and ask.
- Every number on a slide was measured or comes from a source in the
  digest. Every claim about a product was checked in its code.

**Plan the clock.**
- `data-duration` on `.deck` and `data-at` on each divider, from the talk's
  outline. The presenter window then tells you if you are behind.
- Rehearse with the presenter window (`p`) and **Save run**; commit
  `rehearsals.json` so the plan uses your real times.

**Readable from the back.**
- Nothing under 18px at 1080p (labels are 18px, body text 28px), and WCAG
  AA contrast in both themes. The dev server's badges and `check`
  catch both.

**Demos never depend on the network or luck.**
- Every demo gets a demo slide: a title, two or three "watch for" bullets,
  the exact command, a link to the code, and a silent fallback clip.
- Demo slides carry `data-demo="<server url>"` (the deck warns when it is
  down) and `data-time` (how long the demo runs).
- Record the clip from the real app with a `clips/demo-N.ts` script on
  `deck/clip.ts` (`bun my-talk/clips/demo-1.ts`; needs ffmpeg):
  captions say what is happening; the network panel shows only real
  requests; 10 to 25 seconds; under about 1 MB.
- Notes on every demo slide start with the fallback line.
- "In a real app" slides use real product captures, never restyled mocks.

**Look.**
- One theme per talk (see Themes). Put a talk's uniqueness in its
  diagrams and examples, on its theme's fonts and palette.
- Code frames carry `data-file="path"`. Keep code under about 16 lines.

## Themes

A talk's look comes from its theme: `house` (the default), `paper` or
`poster`, or one of your own (`bun deck theme <name>`). Pick one with
`bun deck new my-talk --theme paper`. Each theme's components and
their markup are in its `CATALOG.md`; how themes work, every token, the
motion settings and theme scripts are in [THEMES.md](THEMES.md).

## Motion (engine.ts; a theme can change it, see THEMES.md)

- Builds fade in one per click; Shift+Right finishes a slide; `b` turns
  builds off for the whole deck.
- Slides change with a magic move: headline and footer hold still, the body
  arrives from the direction of travel, dividers wipe in. Give the same
  `data-morph="name"` to an element on two consecutive slides to make it
  glide between them.
- Esc zooms out to a grid of every slide (arrows, Enter); typing a slide
  number, or clicking the counter, zooms to it.
- `t` switches light and dark for every slide; recorded clips and
  captures stay as they were recorded.
- `f` (or the corner button that appears on mouse move) toggles full screen.
- `.` and `w` blank the screen black or white; any key brings it back.
- `l` turns the mouse into a laser pointer, mirrored between the presenter
  and audience windows (and to followers' phones); drag to draw ink, `c`
  clears it.
- `e` hides or shows the audience's emoji reactions on this screen.
- `g` goes live: phones on the talk's `/live` URL follow. See the README's
  Follow-along section.
- `h` (dev server only) opens the headline readout: every headline by
  section, with each section's question, planned against estimated
  minutes, and hints (short headline, crowded slide, same layout four
  times running, no notes). Click a line to go to that slide.
- `p` opens the presenter window: current and next slide, notes, timer,
  pace. `v` plays a demo slide's clip full size.
- Reduced motion turns all of it into instant changes.

## Before you present

1. `bun deck check my-talk` passes (no overflow,
   small or low-contrast text, em-dashes, placeholders, filler, outline
   drift or unsourced claims), the contact sheets look right in both
   themes, and `snapshots/story.md` reads as a story.
2. Every demo slide has a recorded clip; play each one with `v`.
3. Click through once with builds on, and once with `b` (builds off).
4. Rehearse at least once with the presenter window and **Save run**.
5. Open `dist/index.html` from `file://` on the presenting laptop, offline.
6. In the room: `k` with your clicker (every role lights up), `p` for the
   presenter window, start the demo servers and press `d`.
7. Following along? In the presenter window press **Go live** (`g`; the
   first time in a browser it asks for the key), scan the QR slide with
   your phone, and check the presenter window counts it.

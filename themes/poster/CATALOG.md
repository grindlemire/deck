# The poster theme

A typographic poster: Anton headlines set huge and upper case, Schibsted
Grotesk for text, DM Mono for code and labels, hard black rules, and one
loud signal yellow used as full-bleed fields and highlighter bars.
Newsprint white by default; `t` switches to dark, where the yellow stays
yellow. Slides slide up over each other like posters pasted on a wall,
chapters slide across from the side, builds slam in from the left. Start a
talk with it: `bun deck new my-talk --theme poster`. Link
`deck/themes/poster/theme.css` after `engine.css` (the talk's own
`theme.css` comes last) and `deck/themes/poster/theme.ts` after
`engine.ts`.

## Components

| Pattern | Markup |
| --- | --- |
| Cover | `section.slide.cover > h1.cover-title (span.t2 for the indented second line) + .cover-field > p.lede + .byline > .mark + span (.handle)` |
| Teaching slide | `section.slide > .corner-tag + h2.headline.h-lg + .fill-center`; a slide's own headline gets a hard rule under it |
| Footer | `.corner-tag` (bottom left, mono, after a short rule); the engine puts it on the window's bottom edge |
| Numeral and progress rule | automatic (theme.ts): the slide number top right, a rule along the top edge as long as how far through the talk you are |
| Highlighter | `span.hl` (the yellow behind a few words; works on any heading) |
| Split | `.split > .split-col*2 > span.split-n + h3 (.hl) + ol + p.split-foot` (two columns, a hard rule between) |
| Tally | `ul.tally > li > span.n + span.t (> span.sub)` (three columns, a giant numeral each) |
| Points | `ul.points > li` (between heavy rules) |
| Figures | `.figures > .figure(.hero) > .figure-n + .figure-l`; `.duo` puts points beside them |
| Statement | `p.statement` (a bold line); `p.lede` for a softer one |
| Chapter | `section.slide.divider.chapter > .bleed > span.chapter-big` + `p.chapter-num + h2.chapter-title + p.chapter-q` (the yellow, full bleed, the part number cropped huge) |
| Bleed | `.bleed > *`: anything cropped by the slide's edge goes in one, so it never runs past it |
| Flow | `.flow > .flow-node(.key) > .flow-who + .flow-what`, joined by `.flow-arrow > code + svg` |
| Code | `figure.code-frame[data-file] > pre` with `.tk-k/.tk-s/.tk-f/.tk-t/.tk-a/.tk-c` spans (engine); a band across the full width |
| Code delta | `section.delta-reveal[data-phases=2]`, `.code-lines > .dl(.dl-add/.dl-del/.dl-chg)` (engine) |
| Wall | `section.mode-wall.wall[data-phases=3] > .wall-stage (+ .wall-note) + .wall-poster > h2.wall-slam (em) + p.wall-principle`; click 3 slides the yellow poster over it |
| Mock browser | `.mock-browser > .mock-chrome + .mock-viewport` with `.skel.w60` bars (engine, drawn flat here) |
| Demo slide | `section.mode-demo > .demo-grid > .demo-side (h2.headline.h-md, ul.points, code.demo-run, a.demo-link) + figure.demo-clip > video` (a yellow column down the left) |
| Anchor | `section.mode-anchor > h2.anchor-line + p.anchor-sub` (black in light mode, yellow in dark, the line at the foot) |
| Credits | `section.credits-slide > h2.headline + div[data-credits]` (filled by the engine) |
| Closing | `section.closing-slide > h2.headline.thanks (span.hl) + .closing > .closing-main (.byline, ul.links > li > span.label + span.ic) + .qr > img + figure` |
| Placeholder | `div.placeholder[data-placeholder="what goes here"]` (a dashed box) |
| Inline code | `.ic` (inverted) |

## Tokens

The engine's tokens, plus this theme's own, all overridable in a talk's
`theme.css` (set both modes):

- `--field` and `--on-field`: the loud color as a background (cover,
  chapter, wall poster, demo column, highlighter, thanks band) and the
  text on it. Keep the pair at 4.5:1 or better; `bun deck check`
  measures it. `--accent` matches `--field`.
- `--ink-soft`: secondary text.
- `--anchor-bg`, `--anchor-fg`, `--anchor-sub`: the anchor slide, which
  flips with the mode.
- `--pz-c`: the numeral and progress rule's color on a slide (its text
  color by default).

Motion is the engine's tokens on `:root`: `--dk-slide-in: pz-paste-in`
and `--dk-slide-out: pz-sink-out` (with `-back` versions), chapters on
`--dk-divider-in: pz-swipe-in`, builds slamming in from the left
(`--dk-build-from: translateX(-2.4rem)`), all on one fast-in, soft-landing
curve (`--pz-ease`), and `--dk-hold: none`, so the whole poster changes at
once. Every animation is a transform or opacity, which the browser runs on
the GPU, so it stays smooth on a projector laptop.

## Script

`theme.ts` listens for `deck:slide` and `deck:phase`. It writes
`data-pz-n` and `--pz-to` on every slide, replays the numeral's drop on
each slide change (from below going back), and runs the progress rule
from where you were to where you are on every step. It does nothing
without a `.deck` and animates nothing under `prefers-reduced-motion`.

# The paper theme

An editorial look: warm paper, Source Serif 4 headlines in sentence case,
Source Sans 3 for text, JetBrains Mono for code and labels, and one
red-orange accent. Light by default; `t` switches to dark. Start a talk
with it: `bun deck new my-talk --theme paper`. Link
`deck/themes/paper/theme.css` after `engine.css`; the talk's own
`theme.css` comes last.

## Components

| Pattern | Markup |
| --- | --- |
| Cover | `section.slide.cover > .rule + h1 (em for the accent half) + p.lede + .byline > .mark + span (.handle)` |
| Teaching slide | `section.slide > .corner-tag + h2.headline.h-lg + .fill-center` |
| Footer | `.corner-tag` (bottom left, mono); the engine puts it on the window's bottom edge |
| Compare | `.compare > .card*2 > h3 + ol + p.card-foot` |
| Rows | `ul.rows > li > span.n + span (+ span.sub)` |
| Points | `ul.points > li` (accent dash) |
| Figures | `.figures > .figure(.hero) > .figure-n + .figure-l` |
| Statement | `p.statement` (a serif line); `p.lede` for a softer one |
| Chapter | `section.slide.divider.chapter > p.chapter-num + h2.chapter-title + p.chapter-q` (the accent, full bleed) |
| Flow | `.flow > .flow-node(.key) > .flow-who + .flow-what`, joined by `.flow-arrow > code + svg` |
| Code | `figure.code-frame[data-file] > pre` with `.tk-k/.tk-s/.tk-f/.tk-t/.tk-a/.tk-c` spans (engine) |
| Code delta | `section.delta-reveal[data-phases=2]`, `.code-lines > .dl(.dl-add/.dl-del/.dl-chg)` (engine) |
| Wall | `section.mode-wall.wall[data-phases=3] > .wall-stage (+ .wall-note) + .wall-poster > h2.wall-slam (em) + p.wall-principle` |
| Mock browser | `.mock-browser > .mock-chrome + .mock-viewport` with `.skel.w60` bars (engine) |
| Demo slide | `section.mode-demo > .demo-grid > .demo-side (h2.headline.h-md, ul.points, code.demo-run, a.demo-link) + figure.demo-clip > video` |
| Anchor | `section.mode-anchor > h2.anchor-line + p.anchor-sub` (the accent, full bleed) |
| Credits | `section.credits-slide > h2.headline + div[data-credits]` (filled by the engine) |
| Closing | `.closing > .closing-main (h2.headline.h-xl, .byline, ul.links > li > span.label + span.ic, .qr > img) + figure` |
| Placeholder | `div.placeholder[data-placeholder="what goes here"]` (a dashed box) |
| Inline code | `.ic` |

## Tokens

The engine's tokens, plus this theme's own, all overridable in a talk's
`theme.css` (set both modes):

- `--paper-deep`: panels (cards, flow nodes, inline code).
- `--rule`: hairlines (rows, borders, placeholders).
- `--ink-soft`: secondary text.
- `--accent`: accent text (headline `em`, numbers, links). Lighter in
  dark mode so it stays readable on the dark paper.
- `--accent-fill` and `--on-accent`: the accent as a background (chapter,
  anchor, the cover rule, the speaker mark) and the text on it. Keep the
  pair at 4.5:1 or better; `bun deck check` measures it.

# The house theme

GitStack's look: the console palette (dark by default, light on `t`),
Inter Tight headlines, IBM Plex Sans and Mono, square hairline panels,
one blue accent. Start a talk with it: `bun deck new my-talk`
(it is the default). Link `deck/themes/house/theme.css` after
`engine.css`; the talk's own `theme.css` comes last.

## Components

| Pattern | Markup |
| --- | --- |
| Title | `section.title-slide` with `h1.title-line`, `.title-tagline`, `.title-libs > .pill > i`, `.title-bottom` |
| About you | `.about > figure.about-photo > img` + `.about-side > h2.headline + p.about-handle + ul.lead-list` |
| Follow along | `.follow > .follow-side + figure.qr.follow-qr > img`; the side holds `h2.headline`, `ul.lead-list`, `p.follow-url > .ic`; the QR is `media/qr-follow.svg` from `bun deck qr <talk>` (the talk's `/live` URL on the site in deck.config.json) |
| Teaching slide | `section.slide` > `.corner-tag[data-section]`, `h2.headline.h-lg`, `.fill-center` |
| Footer | `.corner-tag` (bottom left); `data-section="1-3"` lights squares |
| Two-card primer | `.ways > .way > .way-name, ol.way-steps, .way-foot` |
| Numbered rows | `ul.cost-list > li > span.k, span (+ span.sub)` |
| Points | `ul.lead-list` (`.blue-marks` for accent squares), `ol.num-list > li > .n + .li-head/.li-sub` |
| Big numbers | `.stats > .stat(.hero) > .stat-n + .stat-l` |
| Flow diagram | `.rf > .rf-node(.rf-server) + .rf-arrow > code + svg` |
| Sequence diagram | `.seq[data-lanes=2-4] > .seq-lanes > span*` + `.seq-body > .seq-step[data-build] > .seq-row > .seq-msg[data-span][data-dir]`, `.seq-note` (`.ev` for pushed events, `.quiet` for empty replies) |
| Question cells | `.attr-grid > .attr-cell > code + span` |
| Code | `figure.code-frame[data-file] > pre` with `.tk-k/.tk-s/.tk-f/.tk-t/.tk-a/.tk-c` spans |
| Code delta | `section.delta-reveal[data-phases=2]`, `.code-lines > .dl(.dl-add/.dl-del/.dl-chg)` |
| Screenshot | `figure.shot > img` (16:10); `.shot.annotated > .callout[style=left/top %]` |
| Video | `figure.shot > video[data-autoplay][muted][loop][playsinline]` |
| Section divider | `section.divider.sp1` (sp1-sp3, sp0 = epilogue) > `.divider-track > i*3`, `.divider-title`, `.divider-lib`, `.divider-q` |
| Anchor | `section.mode-anchor > h2.anchor-line + p.anchor-sub` |
| Wall | `section.mode-wall.wall[data-phases=3] > .wall-stage + .wall-poster` (`.wp-slam em`, `.wp-principle`) |
| Mock browser | `.mock-browser > .mock-chrome + .mock-viewport` with `.skel.w60` bars |
| Demo slide | `section.mode-demo.demo-slide > .demo-grid > .demo-side + figure.shot.demo-clip` (`.demo-grid.wide` for side-by-side clips) |
| Close | `section.close-slide > .close-grid > .close-main + .close-side` |
| Placeholder | `div.placeholder[data-placeholder="what goes here"]` |
| Source line | automatic: any `[data-src]` naming a `Kind: other` source |
| Credits | `section.credits-slide > h2.headline + div[data-credits]` (filled by the engine) |

Recolor sections with `--series-1/2/3` in the talk's `theme.css`. Every
house token (`--blue`, `--bg-0`, `--ink-95`, ...) can be overridden there.

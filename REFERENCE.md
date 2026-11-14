# deck reference

Everything deck does, in detail: the commands, the settings, the engine's
markup and keys, and how the follow-along works. Start with the
[README](README.md). [AUTHORING.md](AUTHORING.md) has the rules for writing a
talk and [THEMES.md](THEMES.md) the theme contract.

## Commands

From the talks folder:

```
bun deck new <talk> --title "..."   start a talk [--theme house|paper|poster]
bun deck dev [talk]                 write and rehearse it: opens it, live reload, lint badges
bun deck check [talk]               every slide in light and dark, the outline,
                                       share images; builds dist/ (offline copy)
bun deck check [talk] --outline     only the outline and sources, no browser
bun deck theme <name> --from paper  start a theme of your own (THEMES.md)
bun deck qr [talk | url]            a QR code: the talk's follow-along URL, or any URL
bun deck serve                      give the talks from this laptop, with the follow-along (Go)
bun deck publish                    every talk as one static site in site/, for hosting
```

`bun deck` lists them with their options, your talks and the themes.
`<talk>` is the talk's folder (`my-talk` or `my-talk/deck`); leave it out
when there is only one talk. Demo fallback clips are scripts:
`bun my-talk/clips/demo-1.ts`.

## Inside `deck`

```
deck/
  index.ts        the deck command
  new.ts dev.ts check.ts qr.ts publish.ts serve.ts
                  one file per command
  build.ts        single-file assembler (check and publish run it)
  engine.ts       slide lifecycle, keys, phases and builds, magic move, zoom
                  overview, jump to slide, notes, light/dark, video, blank
                  screen, presenter window, pacing, follow-along
  engine.css      structure + generic components (code frames, delta grammar,
                  mock browser, placeholders, corner tags, notes panel)
  theme.ts        bun deck theme: start your own theme from one
  themes/         the looks a talk can start with: house (GitStack's
                  palette and type), paper (editorial, light) and poster
                  (bold type, no boxes). Each is theme.css, fonts/,
                  CATALOG.md and a starter deck; see THEMES.md
  lint.ts         slide checks: overflow, small text, contrast, em-dashes,
                  placeholders, filler writing, drift from the outline,
                  unsourced claims (dev and check)
  story.ts        the headline readout ("h" in dev; story.md from check)
  dev-client.ts   the dev server's reload script (never in a build)
  browser.ts      strips the types from the browser code (Bun's transpiler)
  outline.ts      reads and checks a deck's outline.md and sources/digest.md
  config.ts       reads deck.config.json: where the talks are hosted
  args.ts         options and finding a talk's deck, for every command
  clip.ts         helpers for recording demo fallback clips (Playwright, ffmpeg)
  server/         the talks site plus live follow-along for the audience's
                  phones (Go, stdlib only, its own go.mod)
  skill/          a Claude Code skill for writing talks (SKILL.md)
  template/       what every new talk gets: the sources digest and clip
                  scaffolding (the slides come from the theme)
  deploy/         optional hosting: a Dockerfile, a GitHub Pages workflow, a guide
  docs/           the README's pictures (not in the package)
  favicon.svg     the talks index's tab icon (publish)
  AUTHORING.md    the rules every talk follows: read this first
  THEMES.md       how themes work: tokens, motion, scripts, your own
  README.md       what deck is and how to start
  REFERENCE.md    this file: commands, settings, markup, keys
```

The browser code is TypeScript too: `dev` and `build.ts` strip its types
with Bun's own transpiler, so a built deck's script is readable but has no
comments. `bun run typecheck` in `deck/` checks the scripts (strict)
and `tsc -p tsconfig.browser.json` the browser code (looser, for now).

The split rule: `deck` contains **zero talk content**. Anything specific to a
particular talk (its diagrams, its choreography, its section colors) lives in
that talk's `theme.css` / `slides.html`.

## Authoring a new deck

A deck is a directory with two files:

```
my-talk/deck/
  slides.html   the slides (content layer)
  theme.css     the talk's tokens + talk-specific styling
```

### Minimal working deck

`slides.html` (a title slide + one code slide):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>My Talk</title>
<link rel="stylesheet" href="../../node_modules/@grindlemire/deck/engine.css">
<link rel="stylesheet" href="../../node_modules/@grindlemire/deck/themes/house/theme.css">
<link rel="stylesheet" href="theme.css">
</head>
<body>
<main class="deck">

  <!-- slide 1: title -->
  <section class="slide">
    <div class="corner-tag">TALK / 002</div>
    <h1 class="headline h-xl">My Talk Title</h1>
    <p class="muted">A one-line subtitle</p>
    <aside class="notes">
      <p>Hello, introduce yourself, set up the first demo.</p>
    </aside>
  </section>

  <!-- slide 2: a code slide -->
  <section class="slide">
    <h2 class="headline h-lg">A code slide</h2>
    <figure class="code-frame">
<pre><span class="tk-k">func</span> <span class="tk-f">main</span>() {
	<span class="tk-f">fmt</span>.<span class="tk-f">Println</span>(<span class="tk-s">"hello"</span>)
}</pre>
    </figure>
    <aside class="notes"><p>Walk the code top to bottom.</p></aside>
  </section>

</main>
<script src="../../node_modules/@grindlemire/deck/engine.ts"></script>
</body>
</html>
```

`theme.css` (override any of the custom properties; all are optional):

```css
:root {
  --paper: #ffffff;      /* light-slide background */
  --ink: #111111;        /* light-slide type */
  --dark: #111111;       /* wall/demo-slide background */
  --accent: #2b5cff;     /* anchors, kickers, notes border */
  --muted: #666666;      /* secondary text on light */
  --muted-dark: #bbbbbb; /* secondary text on dark */
  --code-bg: #111111;
  --code-fg: #e6edf3;
  --tok-keyword: #6f9dff;
  --tok-string: #a5d6ff;
  --tok-function: #e2b93d;
  --tok-tag: #5cd97a;
  --tok-attr: #c8a5ff;
  --tok-punct: #8b949e;
  --delta-add: #5cd97a;
  --delta-del: #ef6f6c;
  --delta-chg: #f0b429;
  --font-display: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: Menlo, Consolas, monospace;
}
```

### Build

`bun deck check my-talk` (and `publish`, for every talk) writes
`my-talk/deck/dist/index.html`: engine, theme, content, and any local
images, videos, and fonts (as data: URIs) inlined into one file. Zero
network requests; opens from `file://`, which makes it the copy to present
from offline. External http(s) stylesheets/scripts/images are a hard build
error.

### Dev server

```
bun deck dev my-talk [--port 4000] [--no-open]
```

Serves `slides.html` from the checkout (no build) on 127.0.0.1, opens it
in the browser, and watches the deck and `deck` itself. It takes the first free
port from 4000, so two decks can run at once, and a mistake in
`deck.config.json` is printed while the last good settings stay. A stylesheet change swaps in place, so you stay on the
same slide and build step; any other change reloads onto the same slide and
step. It also runs `lint.ts`: a red badge on any slide with a problem (click
it for the list), and one in the top right for the outline and sources as a
whole. Each tile in the overview shows the slide's estimated time, with the
total in the corner. `h` opens the headline readout (`story.ts`). Editing
`outline.md` or `sources/digest.md` reloads the page like any other change.

### Settings

None are needed to write, rehearse and give talks from your laptop. When
you host them, a `deck.config.json` in the talks folder (the build looks
in the deck's directory and every directory above it) says where:

```json
{ "site": "https://example.com", "prefix": "/talks", "speaker": "Your Name", "handle": "@you" }
```

`site` is the origin that runs `deck/server`. A local copy of a deck
goes live on it (see Follow-along), `publish` makes the link previews
absolute on it, and `qr` and `check` put the talk's follow-along URL on it
in the QR code. Without a site, a local copy goes live only with
`?lead=`, link previews have no URL or image, and the QR points at this
laptop (`serve` redraws it for the network it is on).

`prefix` is the path the talks are under: `/talks` when it is left out,
`""` to put them at the site's root. `publish` writes the site under
it and notes it in `site/deck-site.json`, which `deck/server` reads,
so the two always agree. The rest of this file says `/talks`.

`speaker` and `handle` go on a new talk's title slide (`new`; without a
speaker, git's `user.name`).

`DECK_SITE` and `DECK_PREFIX` in the environment override the file.

### Publish (hosting every talk)

```
bun deck publish [--out site] [--base https://example.com] [--static]
```

Builds every `<talk>/deck` and writes a static site: `site/talks/<talk>/` is
each deck, and `site/talks/` lists them, each with its title slide
(`og.png`, below) as a preview. `site/404.html` is the page for an address
with nothing at it, with a link back to the list; `deck/server` and
GitHub Pages both serve it.

Each deck gets a link preview and tab icons from `<talk>/deck/share/`:
`og.png` (the title slide at 1200x630, dark theme), `favicon.png` and
`apple-touch-icon.png` (the title's first letter in the accent color).
`bun deck check` renders them on every run; commit them, since the
host has no browser to render with. `publish` copies them next to
the deck and adds the `og:`, `twitter:` and icon tags, with absolute URLs
on `--base` (else `$SITE_URL`, else the site in `deck.config.json`). A talk
without them publishes with a warning and no image. It needs no browser,
so a bare Bun image can run it after `bun install`; serve the site with
`deck/server` (see Follow-along and `deploy/`) or any static host,
which gives everything but the follow-along.

`--static` is for a host that only serves files, such as GitHub Pages.
It leaves the speaker notes out entirely (no `notes.json`, which a
static host would hand to anyone), names no server in the decks so they
show no Go live and ask for no key, writes relative links so the site
works under any path (`you.github.io/repo/`), and adds a `.nojekyll`.
It warns about a talk that shows a follow-along QR code, since nothing
answers it. `deploy/github-pages.yml` runs it on every push.

### Lint

`lint.ts` lays out every slide fully built and checks for content past the
slide's edges, em-dashes on screen, text under 18px at 1080p (raise it with
`<main class="deck" data-lint-min="20">`), text below WCAG AA contrast against
its background, and `data-placeholder`s still to fill. Footers and
placeholders skip the size and contrast checks; `data-lint-ok` opts an
element out.

It also reads the words. Filler, on screen and in the notes: "No X, Y"
lines, "X did. Y didn't." flourishes, "isn't just", buzzwords, intensifiers
and dashes (`data-lint-off="buzzword intensifier"` on the deck, a slide or
an element switches rules off). With an `outline.md`: slides without a
`data-beat` (or `data-custom`), headlines, Screen text and notes that
differ from their beat, and slides out of the outline's order. With a
`sources/digest.md`: numbers with a unit and quotations on screen that
cite no source, and citations the digest does not have. Formats and rules:
AUTHORING.md, "The story".

The dev server shows it as badges; `bun deck check` prints it for both
themes, fails on any finding, and writes the headline readout to
`snapshots/story.md`. The build warns about em-dashes and outline problems
on its own, and `bun deck check <talk> --outline` checks the outline and
digest without a browser.

### Sources on screen

A slide that cites someone else's work (`data-src` naming a `Kind: other`
source in `sources/digest.md`) gets a small source line at the bottom,
built by the engine from the source's `Credit:`. A
`section.credits-slide` gets the list of every such source, in the order
the talk first cites them (into its `[data-credits]` element if it has
one). The build carries only the credits, never the digest's facts.

## Presenting

| Key | Action |
| --- | --- |
| Right / Space / PageDown | advance (steps through phases first) |
| Left / PageUp | back (steps back through phases) |
| swipe left / right | advance / back (touch screens) |
| Home / End | first / last slide (with the zoom) |
| `p` | open the presenter window (see below) |
| `n` | toggle the speaker-notes panel (on the audience screen) |
| Shift + Right / Space | show the rest of the slide's builds, or advance |
| `b` | toggle builds off (every slide arrives complete; remembered) |
| `.` / `w` (or `,`) | black / white screen; any key brings the slide back |
| `l` | laser pointer: the mouse becomes a red dot with a fading tail; point in the presenter window and it shows on the audience screen too. Drag to draw ink, which stays until `c` or the next slide |
| `c` | clear the laser ink |
| `?` | show / hide a small panel with every key (also the `?` button by the full-screen button) |
| Shift + `l` | next laser color (red, amber, green, blue, pink); the presenter bar has swatches too |
| `f` | toggle full screen (a corner button also appears when the mouse moves) |
| F5 | enter full screen (what a clicker's "start" button sends) |
| `k` | clicker test: lights each role (next, back, blank...) as its key arrives |
| `v` | blow the slide's clip up to fill the slide (a demo's fallback); again to put it back |
| `d` | check that every `data-demo` server answers |
| `t` | toggle light / dark (`data-theme` on `<html>`, remembered) |
| Esc | zoom out to the overview grid (each tile captioned with its number and headline); Esc again zooms back to where you were |
| arrows (in the overview) | move the selection; Enter or Space zooms into it; click works too |
| `0`-`9` then Enter | jump to that slide number (or click the counter bottom-right and type); jumps zoom out, show the target, and zoom in |
| `s` (presenter window) | start / pause the timer |
| URL `#12` | jump to slide 12 (1-based, reload-safe) |

### Presenter window

`p` opens the same deck in a second window, for your laptop screen while the
audience window goes on the projector: the current slide, the next slide (or
the next build step on this one), your notes, the slides coming up, a timer,
the clock and your pace. Drive the talk from either window and the other
follows, including blank screen, jumps and the blown-up clip. It works from
`file://`. Reloading either window is safe: the one that reloaded catches up
with the other, and the timer survives.

The timer starts on your first move (or `s` / Start) and pauses with `s`.

### Pacing and rehearsals

Each slide has a planned length: the median of its last three rehearsed
times, or else an estimate from its notes (140 words a minute plus 2s per
build, at least 10s; when notes quote what you will say, only the quoted
words count). `data-time="90s"` (or `1:30`, `2m`) on a slide overrides the
estimate; use it on demo slides.

Pin the plan to the clock with `data-at="15:00"` on a slide (when you should
reach it, typically each divider) and `data-duration="50:00"` on `.deck`
(when you should finish). The slides between pins share the time in
proportion to their lengths. The presenter window shows "On pace", "1:20
behind" or "0:45 ahead", a strip with one segment per slide (click one to
jump), and the next slides with when you should reach them.

Rehearse with the presenter window and press **Save run** at the end. The run
is kept in the browser, and through the dev server it is added to
`<deck>/rehearsals.json`; commit that file and the build inlines it, so the
plan on the presenting laptop uses your real times. Slides are matched across
edits by their headline (or `data-id`).

### Demo safety

On a demo slide, `v` fills the slide with its clip and plays it from the
start: the fallback when a live demo misbehaves. Give the slide
`data-demo="http://localhost:8080/"` and the deck checks that server
answers when you reach the slide or the one before it: the presenter bar
shows "Demo ready" or "Demo down" for this or the next slide's demo (hover
for which server), and a local copy
(`file://` or localhost) also warns on screen. The hosted deck never checks
on its own, so visitors flipping through it are not asked about a server on
their machine. `d` checks every demo server at once before the talk.

### Follow-along

The audience can follow on their phones: the slide, the laser and the ink
follow yours, and they can send emoji reactions that float up your screen.
On your laptop, for a room on the same network:

```
bun deck serve [--addr :8080]
```

That publishes the site and runs `deck/server` on it (`go run`, so it
needs Go), with each deck's QR pointing at this laptop. To host it,
see `deploy/`: the server runs on the published site with `-site site`,
the key in `DECK_LEAD_KEY`, and `-ip-header` if a proxy sits in front
(see Reactions).

For each talk it prints the audience URL (`/talks/<talk>/live`, on your
laptop's address) and the deck to open. To lead, open the presenter window
(`p`) and press **Go live** (or `g`). The first time, it asks for the key and
keeps it in that browser (localStorage), so the key is never in a URL; a
wrong key is forgotten and asked for again. `g` again stops: phones stay on
the last slide. While live, the audience window posts each move, and the
laser and ink in small batches, to `/talks/<talk>/state`, with the key in a
header; phones on the live URL get the deck in follow mode. A swipe lets
someone look back, with a button to return to the live slide (and its ink).
The presenter window shows how many are following. Only the key can move
the slides. Presenting never depends on the server: if it is unreachable,
only the phones stop following.

The deck works out where to post: for a published deck, the talk on the
server that serves it (`/talks/<talk>` on its origin; `publish` names
the talk in the deck), else `<site>/talks/<talk>` for a local copy
(`dist/index.html` from `file://`, or the dev server), with the site from
`deck.config.json` and the talk named from the `<talk>/deck/` folder. `?lead=<url>` overrides it, for testing against a
server on your laptop.

Reactions: the live page shows a row of emojis (the list is in
`server/live.go`). Each tap posts to `/talks/<talk>/react`; the server rate
limits each phone (4 a second, by an id its page makes up) and each address
(30 a second, so a room sharing one wifi is fine), batches them every
300ms with a cap per batch, and sends them to every follower and to the
leading deck, which passes them to the presenter window. `e` hides them on a
screen. Open live streams are capped too (500 per address, 5000 in all).

The address is the connection's peer. Behind a proxy, every visitor shares
the proxy's address, so pass `-ip-header` (or set `DECK_IP_HEADER`) to
the header the proxy puts the visitor's address in: `X-Real-IP` on Railway,
`Fly-Client-IP` on Fly, `CF-Connecting-IP` behind Cloudflare. Only do that
when every request comes through the proxy, since anyone who reaches the
server directly can send the header with any address in it.

Speaker notes stay private: `publish` takes them out of the public deck
into `notes.json`, which the server never serves as a file. The presenter
window on the hosted deck fetches them from `/talks/<talk>/notes` with the
key (it asks for the key if this browser has none). Local copies keep their
notes.

While the talk is live, followers can look back but not ahead: moving to
the live slide (or trying to pass it) rejoins it. Before you go live they
stay at the start; once you stop, the whole deck is theirs. Forgot to stop?
The deck posts at least every 10s while live, so the server ends a talk it
has not heard from for 30s (a closed tab, a sleeping laptop); going live
again brings everyone back. A demo clip you
blow up with `v` blows up on their phones too.

Followers are on phones: the live page has no shortcut keys or key help.
They move with swipes (or arrow keys), the back button and an overlay row of
emojis with a full-screen button (where the browser has full screen; iPhone
Safari does not), and until the speaker goes live they see "Waiting for the
talk to start". The page asks the browser to keep the screen awake (the
Screen Wake Lock API), and asks again when the phone comes back to it; where
the browser grants that only during a tap (iPhone Safari), a "Tap to keep
your screen on" button shows until it holds. Slides size to the visible
height (`dvh`), so a landscape phone's browser bars do not cut them off.

Hosted, the room never needs to share a network. The server keeps live
state in memory, so run one instance; one key leads every talk on it, so
it suits one speaker (or a group that shares the key). Put the audience
URL on a slide as a QR code (the house theme's `.follow` layout):
`bun deck qr my-talk` writes `my-talk/deck/media/qr-follow.svg` for
`<site>/talks/my-talk/live` (this laptop without a site), `check`
rewrites it whenever the deck shows it, and `serve` swaps in one for the
network it is on.

## Slide anatomy

- Slides are `<section class="slide">` inside `<main class="deck">`, designed
  at 1920x1080 and rem-scaled: 1rem = 16px at 1080p, so the deck degrades
  gracefully to 720p and scales up to 4K.
- Each slide is a flex column with a `gap`; normal children stack top to
  bottom. Use `.push-down` to pin an element to the bottom.
- `<aside class="notes">` inside a slide holds speaker notes (any HTML). The
  engine mirrors the current slide's notes into a bottom panel on `n`.

### Modes

Color grammar via classes on the slide (theme decides the actual colors):

- *(none)* / `.mode-teaching` -- light: ink on paper.
- `.mode-wall`, `.mode-demo` -- a full-bleed dark inversion in engine.css; the
  house theme instead keeps them in the current light/dark theme (a wall is
  marked by its red top rule).
- `.mode-anchor` -- full-bleed accent, for the one-line slides.

### Phases

`data-phases="3"` declares three build steps. The engine drives
`data-phase="1|2|3"` on the slide; your CSS keys off it:

```css
.my-slide[data-phase="1"] .late-thing { opacity: 0; }
```

Arriving forward starts at phase 1; stepping back into a slide lands on its
last phase.

### Typography helpers

`.headline` (800, uppercase, tight) with sizes `.h-xl` `.h-lg` `.h-md` `.h-sm`;
`.tag` and `.corner-tag` for small tracked labels; `.kicker` for an accent
eyebrow; `.muted`; `.ic` for inline code chips in body copy.

### Code frames and hand highlighting

Code goes in `<figure class="code-frame"><pre>...</pre></figure>`. There is no
tokenizer: hand-wrap tokens in spans (`.tk-k` keyword, `.tk-s` string, `.tk-f`
function/component/type, `.tk-t` HTML tag, `.tk-a` attribute, `.tk-c`
punctuation/comment). Keep blocks to ~16 lines; the floor is 1.75rem (28px at
1080p).

### Builds (reveal content one step at a time)

Mark elements with `data-build` and they appear one advance at a time, in
document order, with a short fade and rise. `data-build="2"` puts an element
on a specific step (several elements can share one). The engine turns N
steps into `data-phases="N+1"`, so stepping back, hash routing and the
overview all work as usual. Slides that declare their own `data-phases` keep
their choreography and ignore `data-build`.

```html
<ul>
  <li data-build>first point</li>
  <li data-build>second point</li>
</ul>
<p data-build>the takeaway</p>
```

Press `b` to turn builds off for the whole deck (every slide, phased ones
included, arrives complete), or Shift + Right to complete just the current
slide.

### Delta grammar (code that evolves from earlier code)

Use a `.code-lines` block where every line is a `.dl`:

```html
<figure class="code-frame"><div class="code-lines">
  <div class="dl"><span class="tk-t">&lt;li</span></div>
  <div class="dl dl-add">	<span class="tk-a">hx-get</span>=<span class="tk-s">"/x"</span></div>
  <div class="dl dl-del">	old-line</div>
  <div class="dl dl-chg">	<span class="chip-old">old</span> <span class="chip-new">new</span></div>
</div></figure>
```

`.dl-add` = `+` gutter + green tint; `.dl-del` = `-` gutter + red tint;
`.dl-chg` = `~` gutter with the old token in `.chip-old` (struck) and the new
token in `.chip-new` (bold). Lines keep literal tabs/spaces (`white-space:
pre` per line).

To animate, add `class="delta-reveal" data-phases="2"` to the slide: phase 1
renders the pre-change code (adds hidden, chips neutral), the advance key
plays deltas in while unchanged lines dim to ~55% and restore.

### Mock browser

```html
<div class="mock-browser">
  <div class="mock-chrome">
    <span class="mock-dots"><i></i><i></i><i></i></span>
    <span class="mock-url">/some/path</span>
  </div>
  <div class="mock-viewport">
    <div class="skel w60"></div>
    <div class="mock-scrollbar"><div class="mock-thumb"></div></div>
  </div>
</div>
```

Size it, fill the viewport (`.skel` bars help), and drive `.mock-thumb` /
overlays from the theme, typically per phase.

### File names on code frames

`<figure class="code-frame" data-file="server.go">` adds a header strip with the
file name. The theme colors it via `--code-head-bg`, `--code-head-fg`, and
`--code-line`.

### Video

`<video src="media/clip.mp4" data-autoplay muted loop playsinline></video>`
plays from the start when its slide becomes current and pauses when you leave.
Keep clips short; they are inlined into the built file.

### Light and dark

`t` flips `data-theme` on `<html>` between `light` and `dark`. A theme defines
its default palette on `:root` and the other one under
`:root[data-theme="light"]` (or `dark`). For theme-specific assets, mark them
`.only-dark` / `.only-light`.

### Placeholders

For assets that do not exist yet, use a labeled box; never fake content:

```html
<div class="placeholder" data-placeholder="speaker headshot">SPEAKER HEADSHOT</div>
```

`data-placeholder` is the grep-able marker for everything left to fill in.

## Slide transitions (magic move)

Moving between slides is a View Transition too. Each slide's headline
(a direct-child `.headline`) and footer (`.corner-tag`) are captured on their
own, so they hold their place while only the text changes; the rest of the
slide clears and the next one arrives from the direction you are going.
Slides with class `divider` wipe in instead.

To make an element glide from its spot on one slide to its spot on the next,
give both copies the same `data-morph` name:

```html
<div class="speeds" data-morph="speeds">...</div>   <!-- slide 7 -->
<div class="speeds" data-morph="speeds">...</div>   <!-- slide 8 -->
```

Without the API, or with reduced motion, slides fall back to a plain fade.

Delta reveals collapse added lines and chips instead of hiding them, so a
code frame's size interpolates as new code arrives.

## Zoom transitions

The overview and jumps use the View Transitions API: the slide being left
or entered is named `dk-active` on both sides of the change, so the browser
morphs it between full size and its grid tile. Browsers without the API, or
with reduced motion turned on, switch instantly.

## Constraints

- Modern desktop browsers only (CSS `zoom`, `@property` in themes, etc.).
- No minification anywhere; the built file stays readable (the build strips
  the engine's types and comments, nothing more).
- The built deck must stay self-contained: if you need an asset, commit it
  next to `slides.html` and let the build inline it.

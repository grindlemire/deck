# Themes

A theme is everything about how a talk looks and moves: colors, type,
the components its slides are built from, how a build arrives, how one
slide becomes the next. The engine (`engine.css`, `engine.ts`) supplies
the slide model, the keys, the presenter window, the follow-along and
the checks; a theme decides the rest. `deck` ships three:

| Theme | Look |
| --- | --- |
| `house` | GitStack's console palette, dark by default, Inter Tight and IBM Plex, one blue accent |
| `paper` | Editorial: warm paper, Source Serif headlines, a red-orange accent, light by default |
| `poster` | Bold type on full-bleed color, no boxes, its own motion and a theme script |

Each one's components are in its `CATALOG.md`.

## Using one

```
bun deck new my-talk --theme paper    # or "theme": "paper" in deck.config.json
```

A talk links its theme's `theme.css` after `engine.css`, then its own
`theme.css`, which can override any token below for that talk alone.

## Making one

```
bun deck theme acme --from paper      # copies paper to themes/acme/ in your talks folder
bun deck new try-acme --theme acme
bun deck dev try-acme                 # t switches light and dark
bun deck check try-acme               # contrast, sizes, overflow, in both modes
```

`deck` looks for themes, in order, in the talks folder's `themes/`, in
the folders `"themes"` lists in `deck.config.json` (relative to that
file), then in `deck/themes/`. The first folder with the name wins,
so a repo theme can replace a built-in one. Keep themes inside the
talks folder: the dev server serves files from there.

### The folder

```
themes/acme/
  theme.css       tokens, @font-face, components (required)
  template/       the starter deck new copies into deck/ (required):
    slides.html     one slide per beat of outline.md
    outline.md      the beats (copy house's to keep the standard 13)
    theme.css       the talk-level file: comments on what to override
  fonts/          woff2 files and their licenses
  theme.ts        optional: the theme's script (see Scripts)
  CATALOG.md      its components and their markup
```

`new` fills these in the template's files: `{{TITLE}}`,
`{{TITLE_LINE_1}}`, `{{TITLE_LINE_2}}` (the title split for a two-line
cover), `{{SPEAKER}}`, `{{HANDLE}}`, `{{INITIAL}}`, `{{TALK}}` (the
talk's folder), `{{DECK}}` and `{{THEME}}` (paths from the deck to
`deck` and to the theme). The starter deck links
`{{DECK}}/engine.css`, `{{THEME}}/theme.css`, `theme.css`, then
`{{DECK}}/engine.ts` and the theme's script if it has one.

A good starter deck shows each of the theme's components once, has one
slide per beat (`data-beat`) so the outline check passes, and leaves
only `data-placeholder`s for what the speaker must supply: `bun deck
check` on a fresh talk should report nothing else.

### Fonts

Font files go in the theme's `fonts/`, with their license (OFL, or one
you hold), and `@font-face` rules point at them (`url("fonts/x.woff2")`).
The build inlines them; it refuses a font, stylesheet or script from a
URL, so the built deck works offline. Fontsource's npm packages are a
handy source of OFL woff2 files.

## Tokens

Set on `:root` for the default mode and under `:root[data-theme="dark"]`
(or `"light"`) for the other; `t` and the sun/moon button switch between
them. The engine tells which mode is showing from `--paper`, so a light
`--paper` reads as light whichever mode the theme starts in. The engine
draws everything through these:

| Token | What it is |
| --- | --- |
| `--paper`, `--ink` | the slide's background and text |
| `--muted` | secondary text |
| `--accent` | the accent (links, the anchor slide, the selected overview tile) |
| `--on-accent` | text on the accent: the anchor slide, the phone buttons, the presenter's main button (default white; set it dark for a light accent) |
| `--dark`, `--muted-dark` | wall and demo slides' background and secondary text (the engine's default for `.mode-wall`/`.mode-demo`) |
| `--letterbox` | the bands around the slide when the window is not 16:9; usually `var(--paper)` |
| `--font-display`, `--font-sans`, `--font-mono` | headlines, text, code and labels |
| `--code-bg`, `--code-fg`, `--code-head-bg`, `--code-head-fg`, `--code-line` | code frames |
| `--tok-keyword`, `--tok-string`, `--tok-function`, `--tok-tag`, `--tok-attr`, `--tok-punct` | hand-highlighted code |
| `--delta-add`, `--delta-del`, `--delta-chg` | code that changes (`.dl-add`, `.dl-del`, `.dl-chg`) |

A theme adds its own tokens freely (paper's `--paper-deep`, `--rule`,
`--accent-fill`); list them in its `CATALOG.md`.

## Motion

**Keep it smooth.** Animate `transform` and `opacity`: the browser runs
those on the GPU, so they hold 60 frames a second on a projector laptop.
A `clip-path` wipe repaints every frame on the main thread; it is fine on
a line of text, but on a whole slide or poster-sized type it stutters and
flickers. Pick a curve that moves at once and lands softly, like
`cubic-bezier(0.22, 1, 0.36, 1)`; a strong ease-in-out (`0.77, 0, 0.18,
1`) sits still for the first half and then snaps, which reads as a
flicker. And a slide arrives with its builds hidden, so a transition that
reveals the new slide a strip at a time shows mostly empty paper.

### Builds

How a `data-build` element arrives on its click.

| Token | Default | What it is |
| --- | --- | --- |
| `--dk-build-duration` | `0.45s` | how long the arrival takes |
| `--dk-build-easing` | `ease` | its timing function |
| `--dk-build-from` | `translateY(0.9rem)` | the transform it starts from |
| `--dk-build-opacity` | `0` | its opacity before it arrives |
| `--dk-build-clip` | `none` | its clip-path before it arrives |
| `--dk-build-clip-to` | `none` | its clip-path once it has |

| Preset | Set |
| --- | --- |
| rise (the default) | nothing |
| fade | `--dk-build-from: none` |
| scale | `--dk-build-from: scale(0.96)` |
| slide in from the left | `--dk-build-from: translateX(-2rem)` |
| wipe left to right (small elements only; see above) | `--dk-build-from: none; --dk-build-opacity: 1; --dk-build-clip: inset(0 100% 0 0); --dk-build-clip-to: inset(0)` |
| wipe up | as wipe, with `--dk-build-clip: inset(100% 0 0 0)` |
| none | `--dk-build-duration: 0s` |

### Slide changes

The browser's View Transitions: the old slide animates out while the
new one animates in, both named keyframes.

| Token | Default | What it is |
| --- | --- | --- |
| `--dk-slide-out`, `--dk-slide-out-back` | `dk-mm-out`, `dk-mm-out-back` | the old slide's keyframes, going forward and back |
| `--dk-slide-in`, `--dk-slide-in-back` | `dk-mm-in`, `dk-mm-in-back` | the new slide's |
| `--dk-slide-out-duration` | `0.2s` | |
| `--dk-slide-duration` | `0.45s` | the new slide's |
| `--dk-slide-delay` | `0.1s` | before the new slide starts |
| `--dk-slide-easing` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | |
| `--dk-divider-in`, `--dk-divider-in-back`, `--dk-divider-duration` | `dk-mm-wipe`, `dk-mm-wipe-back`, `0.6s` | a `.divider` slide's arrival |
| `--dk-hold` | `headline footer` | what holds still while the rest changes: `headline`, `footer`, both, or `none` |

| Preset | Set |
| --- | --- |
| magic move (the default: sideways, headline and footer hold) | nothing |
| crossfade | `--dk-slide-out: dk-fade-out; --dk-slide-in: dk-fade-in; --dk-slide-out-back: dk-fade-out; --dk-slide-in-back: dk-fade-in` |
| push up (back pushes down) | `--dk-slide-out: dk-push-up-out; --dk-slide-in: dk-push-up-in; --dk-slide-out-back: dk-push-down-out; --dk-slide-in-back: dk-push-down-in; --dk-slide-delay: 0s; --dk-slide-out-duration: 0.45s` |
| zoom | `--dk-slide-out: dk-zoom-out; --dk-slide-in: dk-zoom-in; --dk-slide-out-back: dk-zoom-out; --dk-slide-in-back: dk-zoom-in` |
| cut | `--dk-slide-duration: 0s; --dk-slide-out-duration: 0s; --dk-slide-delay: 0s; --dk-divider-duration: 0s` |

Your own `@keyframes` work too: define them in `theme.css` and name
them in the tokens. Elements that share a `data-morph` name on two
slides in a row glide between them whatever the preset.

### Anything else

A slide with `data-phases="N"` gets `data-phase="1"`..`N` as the
speaker clicks; any CSS keyed on it is choreography (house's walls work
this way). Reduced motion turns builds and slide changes into instant
changes; respect it in your own keyframes and scripts too.

## Scripts

A theme (or a talk) can ship a script: `theme.ts` (or `.js`) beside its
`theme.css`, linked after `engine.ts`. The build inlines it with the
types stripped, like the engine; it runs in every view of the deck (the
audience window, the presenter window, phones following along, the
dev server), so keep it small and safe to run anywhere.

The engine announces moves on `document`:

| Event | `detail` | When |
| --- | --- | --- |
| `deck:slide` | `{ index, from, slide, dir }` | the current slide changed (`from` is -1 at the start, `dir` is `"fwd"` or `"back"`) |
| `deck:phase` | `{ index, slide, phase, phases }` | the current slide's build step changed, or a slide was arrived on |
| `deck:insert` | `{ index, slide }` | a signed-out follower's deck received a slide it started without (its content was empty until now) |

```ts
window.deck.on("phase", ({ slide, phase, phases }) => {
  slide.style.setProperty("--progress", String(phase / phases));
});
```

`window.deck` also has `goTo(n)`, `next()`, `prev()`, `state()` and
`slides`. Useful classes on `body`: `dk-presenter` (the presenter
window), `dk-overview` (Esc's grid), `dk-following` (a phone following
the speaker). Scripts take no imports and must not fetch anything: the
built deck is one offline file.

## What stays the engine's

- The slide model: a 16:9 slide designed at 1920x1080, rem-scaled.
- Builds arrive one click at a time, in document order or by
  `data-build="N"`.
- The chrome around the slides: the counter, the overview grid, the
  presenter window, the key help, toasts and the phone controls keep
  the engine's neutral look.

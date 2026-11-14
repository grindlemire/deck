/* ============================================================
 * deck / check.ts
 * deck check: everything a deck must pass before it is done.
 *
 *   bun deck check my-talk [--mode dark|light|both] [--size 1280x720] [--out dir]
 *   bun deck check my-talk --outline     only the outline and sources, no browser
 *
 * Builds the deck (dist/index.html, which opens offline from file://),
 * screenshots every slide at its final build step in both themes,
 * writes contact sheets, and runs lint.ts in each theme: overflow,
 * em-dashes, text too small for the back row, low contrast,
 * placeholders still to fill, filler writing, and, when the deck has
 * outline.md and sources/digest.md, slides that drifted from the
 * outline and claims with no source. Writes the headline readout
 * (story.ts) to snapshots/story.md.
 *
 * It also renders the deck's share images into <deck>/share/ for
 * publish.ts: og.png (the title slide, for link previews), favicon.png
 * and apple-touch-icon.png (the title's first letter); and, when
 * slides.html shows media/qr-follow.svg, rewrites that from the site
 * in deck.config.json (qr.ts; without a site it draws one only if
 * it is missing). Commit them.
 *
 * Needs Playwright's Chromium, once: bun install, then
 * bunx playwright install chromium. Screenshots use reduced motion,
 * so nothing is caught mid-transition. Contact sheets need
 * ImageMagick (`magick`) on PATH; without it you still get one PNG
 * per slide. Exits 1 on any finding.
 * ============================================================ */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fail, findDeck, parseArgs } from "./args.ts";
import { browserScript } from "./browser.ts";
import { buildDeck } from "./build.ts";
import { readConfig } from "./config.ts";
import { jsonTag, readStory } from "./outline.ts";
import { localOrigin, writeFollowQr } from "./qr.ts";

/* What the deck's scripts put on window (engine.ts, lint.ts, story.ts),
   as the page.evaluate callbacks below read it in the browser. */
type DeckWindow = typeof window & {
  deck: { slides: HTMLElement[]; goTo(n: number, opts?: { atLastPhase?: boolean }): void };
  deckLint: { deck(): { slide: number; issues: string[] }[]; story(): string[] };
  deckStory: { markdown(): string };
};

/* The outline and digest on their own: what --outline prints. */
const checkOutline = (deckDir: string): boolean => {
  const story = readStory(deckDir);
  const { outline, sources } = story;
  if (!outline && !sources) {
    console.log(`no outline.md or sources/digest.md in ${deckDir}`);
    return true;
  }
  if (outline) console.log(`${outline.title || "(untitled)"}: ${outline.sections.length} sections, ${outline.beats.length} beats`);
  if (sources) console.log(`sources: ${Object.keys(sources).length}`);
  if (story.issues.length) {
    console.log(story.issues.map((t) => `  - ${t}`).join("\n"));
    return false;
  }
  console.log("  no issues");
  return true;
};

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["out", "size", "mode"]);
  const deckDir = findDeck(args.positional[0]);
  if (args.flag("outline")) {
    if (!checkOutline(deckDir)) process.exitCode = 1;
    return;
  }
  const out = path.resolve(args.opt("out") ?? path.join(deckDir, "snapshots"));
  const [vw, vh] = (args.opt("size") ?? "1280x720").split("x").map(Number);
  const themeOpt = args.opt("mode") ?? "both";
  const themes = themeOpt === "both" ? ["dark", "light"] : [themeOpt];

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return fail("deck check needs Playwright: bun install, then bunx playwright install chromium");
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  // With a site, the QR follows it. Without one, an existing QR stays
  // (deck serve swaps in one for the network it is on), and a
  // missing one is drawn for this machine so the deck still builds.
  const qrFile = path.join(deckDir, "media", "qr-follow.svg");
  if (fs.readFileSync(path.join(deckDir, "slides.html"), "utf8").includes("media/qr-follow.svg")) {
    const { site } = readConfig(deckDir);
    const origin = site ? undefined : fs.existsSync(qrFile) ? null : localOrigin();
    const url = origin === null ? null : await writeFollowQr(deckDir, qrFile, origin);
    if (url) console.log(`follow-along QR -> media/qr-follow.svg (${url})`);
    if (!site) console.log("follow-along QR: no site in deck.config.json, so bun deck serve draws it for the network you are on");
  }
  buildDeck(deckDir);
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, reducedMotion: "reduce" });
  await page.goto(pathToFileURL(path.join(deckDir, "dist", "index.html")).href);
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  await page.reload();
  await page.waitForTimeout(800);
  // What dev.ts gives the page: the outline and digest, for lint.ts
  // and story.ts. (The build already carries the credits.)
  const story = readStory(deckDir);
  if (story.outline || story.sources) {
    await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), jsonTag("dk-story", story));
  }
  await page.addScriptTag({ content: browserScript(path.join(here, "lint.ts")) });
  await page.addScriptTag({ content: browserScript(path.join(here, "story.ts")) });
  await page.addStyleTag({
    // No motion, and no toasts (the demo-server warning) in the shots.
    content:
      "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;animation-delay:0s!important}.dk-toast{display:none!important}",
  });

  const n = await page.evaluate(() => (window as DeckWindow).deck.slides.length);
  const problems: string[] = [];
  const shots: Record<string, string[]> = Object.fromEntries(themes.map((t) => [t, []]));

  for (const theme of themes) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    for (let i = 0; i < n; i++) {
      await page.evaluate((i) => (window as DeckWindow).deck.goTo(i, { atLastPhase: true }), i);
      await page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()));
      await page.waitForTimeout(150);
      const file = path.join(out, `${theme}-${String(i + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: file });
      shots[theme].push(file);
    }
    for (const { slide, issues } of await page.evaluate(() => (window as DeckWindow).deckLint.deck())) {
      for (const t of issues) {
        // Only size, contrast and overflow change with the theme.
        const same = /^(placeholder|em-dash|writing|outline|source)/.test(t);
        if (same && theme !== themes[0]) continue;
        problems.push(`slide ${slide}: ${t}${same ? "" : ` (${theme})`}`);
      }
    }
  }
  for (const t of await page.evaluate(() => (window as DeckWindow).deckLint.story())) problems.push(t);
  fs.writeFileSync(path.join(out, "story.md"), await page.evaluate(() => (window as DeckWindow).deckStory.markdown()) + "\n");

  // Share images, for publish.ts: the title slide as the link preview
  // (og.png, 1200x630) and a monogram of the title's first letter as the
  // tab icon, in the title's own font. Both in the theme's default look
  // (light or dark, as the theme opens). They go next to the deck, to
  // commit.
  const share = path.join(deckDir, "share");
  fs.mkdirSync(share, { recursive: true });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
    (window as DeckWindow).deck.goTo(0, { atLastPhase: true });
    document.querySelectorAll("video").forEach((v) => v.pause());
  });
  await page.addStyleTag({ content: ".dk-counter{display:none!important}" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(share, "og.png") });
  const mark = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const title = (window as DeckWindow).deck.slides[0].querySelector("h1");
    const first = (title || document.querySelector("title"))?.textContent.trim() || "";
    const font = getComputedStyle(title || document.body);
    // The deck's @font-face rules (inlined by the build), so the icon
    // page has the theme's fonts too.
    const faces: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText);
      } catch {}
    }
    return {
      faces: faces.join("\n"),
      family: font.fontFamily,
      weight: font.fontWeight,
      letter: [...first].find((c) => /\p{L}|\p{N}/u.test(c)) || "?",
      // The title slide's own background, so the icon matches the preview.
      bg: getComputedStyle((window as DeckWindow).deck.slides[0]).backgroundColor,
      fg: root.getPropertyValue("--accent").trim() || "#5aa0ff",
    };
  });
  const iconPage = await browser.newPage();
  // iOS rounds apple-touch-icon's corners itself, and fills transparent ones black.
  for (const [size, radius, file] of [
    [64, 14, "favicon.png"],
    [180, 0, "apple-touch-icon.png"],
  ] as const) {
    await iconPage.setViewportSize({ width: size, height: size });
    await iconPage.setContent(`<style>
      ${mark.faces}
      html, body { margin: 0; background: transparent; }
      div { width: ${size}px; height: ${size}px; border-radius: ${radius}px; background: ${mark.bg}; color: ${mark.fg};
        display: grid; place-items: center; font-family: ${mark.family}; font-weight: ${mark.weight};
        font-size: ${Math.round(size * 0.72)}px; line-height: 1; letter-spacing: -0.04em; }
    </style><div>${mark.letter.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</div>`);
    await iconPage.evaluate(() => document.fonts.ready);
    await iconPage.screenshot({ path: path.join(share, file), omitBackground: true });
  }
  await browser.close();
  console.log(`share images -> ${path.relative(process.cwd(), share)}/ (og.png, favicon.png, apple-touch-icon.png): commit them`);

  let magick = true;
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
  } catch {
    magick = false;
  }
  if (magick) {
    for (const theme of themes) {
      const files = shots[theme];
      for (let s = 0; s < files.length; s += 9) {
        const sheet = path.join(out, `sheet-${theme}-${String(s / 9 + 1).padStart(2, "0")}.png`);
        execFileSync("magick", ["montage", ...files.slice(s, s + 9), "-tile", "3x3", "-geometry", "853x480+6+6", "-background", "#333", sheet], {
          stdio: "ignore",
        });
      }
    }
  }

  console.log(`${n} slides x ${themes.length} mode(s) -> ${path.relative(process.cwd(), out)}${magick ? " (with contact sheets)" : ""}`);
  console.log(`headline readout -> ${path.relative(process.cwd(), path.join(out, "story.md"))}`);
  if (problems.length) {
    console.log(`\n${problems.length} thing(s) to look at:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log("lint clean: no overflow, small or low-contrast text, placeholders, filler writing, outline drift or unsourced claims");
  }
}

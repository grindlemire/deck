/* ============================================================
 * deck / build.ts
 * Single-file deck assembler, zero npm deps. deck check and
 * deck publish run it: buildDeck(<talk-deck-dir>).
 *
 * Reads <talk-deck-dir>/slides.html, inlines every local
 * stylesheet (including deck/engine.css and the talk's
 * theme.css), every local script (engine.ts, its types stripped
 * by browser.ts), and every local
 * image and video (as data: URIs), and writes one self-contained
 * <talk-deck-dir>/dist/index.html that makes zero network
 * requests and opens from file://.
 *
 * External (http/https) stylesheets, scripts, and images are a
 * hard error: self-contained is the contract, not a suggestion.
 * ============================================================ */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { browserScript } from "./browser.ts";
import { configTag, readConfig } from "./config.ts";
import { creditsOf, jsonTag, readStory } from "./outline.ts";

const MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const die = (msg: string) => {
  console.error(`deck build: ${msg}`);
  process.exit(1);
};

/* A slide's speaker notes: an <aside> whose class includes notes, whatever
   else it carries (data-lint-off and the like). The notes' HTML is group 1. */
export const NOTES = /<aside\b[^>]*\bclass="(?:[^"]*\s)?notes(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/aside>/;

export type BuildOptions = {
  /* Media to inline in place of a file: its absolute path, and the
     data: URI to use instead (publish.ts swaps in a follow-along QR). */
  media?: Record<string, string>;
};

/* Build the deck in dir; returns the path of dist/index.html. */
export function buildDeck(dir: string, opts: BuildOptions = {}): string {
  const deckDir = resolve(dir);
  const slidesPath = join(deckDir, "slides.html");
  if (!existsSync(slidesPath)) die(`no slides.html in ${deckDir}`);

  const source = readFileSync(slidesPath, "utf8");
  let html = source;

  const isExternal = (ref: string) => /^https?:\/\//i.test(ref);
  const isInlineable = (ref: string) => !isExternal(ref) && !ref.startsWith("data:") && !ref.startsWith("#");

  const toDataUri = (path: string) => {
    if (!existsSync(path)) die(`missing asset: ${path}`);
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) die(`no known MIME type for asset: ${path}`);
    return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
  };

  /* Inline url(...) references inside a stylesheet (images, fonts). */
  const inlineCssUrls = (css: string, baseDir: string) =>
    css.replace(/url\((['"]?)([^'")]+)\1\)/g, (all: string, _q: string, ref: string) => {
      if (isExternal(ref)) die(`external url() in CSS: ${ref}`);
      if (!isInlineable(ref)) return all;
      return `url(${toDataUri(resolve(baseDir, ref))})`;
    });

  /* Only rewrite markup outside HTML comments, so a commented-out example
     (say, a <video> for a clip not recorded yet) is left alone. */
  const outsideComments = (fn: (html: string) => string) => {
    html = html
      .split(/(<!--[\s\S]*?-->)/)
      .map((part, i) => (i % 2 ? part : fn(part)))
      .join("");
  };

  /* ---------- media: <img|video|source src="..."> ----------
   * First, while the page is still only markup: once stylesheets and
   * scripts are inlined, code that mentions a tag would match too. */
  outsideComments((html) => html.replace(/(<(?:img|video|source)\b[^>]*\ssrc=["'])([^"']+)(["'])/g, (all: string, pre: string, src: string, post: string) => {
    if (isExternal(src)) die(`external media: ${src}`);
    if (!isInlineable(src)) return all;
    const file = resolve(deckDir, src);
    return pre + (opts.media?.[file] ?? toDataUri(file)) + post;
  }));

  /* ---------- stylesheets: <link rel="stylesheet" href="..."> ---------- */
  outsideComments((html) => html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/g, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/);
    if (!m) return tag;
    const href = m[1];
    if (isExternal(href)) die(`external stylesheet: ${href}`);
    const path = resolve(deckDir, href);
    let css = inlineCssUrls(readFileSync(path, "utf8"), dirname(path));
    css = css.replace(/<\/style/gi, "<\\/style");
    return `<style>\n/* ---- inlined: ${href} ---- */\n${css}</style>`;
  }));

  /* ---------- scripts: <script src="..."></script> ---------- */
  outsideComments((html) => html.replace(/<script\b[^>]*\ssrc=["']([^"']+)["'][^>]*>\s*<\/script>/g, (tag: string, src: string) => {
    if (isExternal(src)) die(`external script: ${src}`);
    let js = browserScript(resolve(deckDir, src));
    js = js.replace(/<\/script/gi, "<\\/script");
    return `<script>\n/* ---- inlined: ${src} ---- */\n${js}</script>`;
  }));

  /* ---------- rehearsals: <deck>/rehearsals.json, for the presenter's plan ---------- */
  const rehearsals = join(deckDir, "rehearsals.json");
  if (existsSync(rehearsals)) {
    const json = readFileSync(rehearsals, "utf8").replace(/<\//g, "<\\/");
    html = html.replace(/<\/body>/i, `<script type="application/json" id="dk-rehearsals">${json}</script>\n</body>`);
  }

  /* ---------- credits: <deck>/sources/digest.md, for source lines ----------
   * Only who to credit goes in the build, never the digest's facts.
   * In <head>, so engine.ts has it as it boots. */
  const story = readStory(deckDir);
  if (story.sources) html = html.replace(/<head>/i, `<head>\n${jsonTag("dk-sources", creditsOf(story.sources))}`);
  /* ---------- settings: deck.config.json, for where the deck goes live ---------- */
  html = html.replace(/<head>/i, `<head>\n${configTag(readConfig(deckDir))}`);
  if (story.issues.length) console.warn(`warning: outline and sources:\n${story.issues.map((t) => `  - ${t}`).join("\n")}`);

  /* ---------- verify: nothing external may remain ----------
   * Plain <a href> links are navigation, not loads, so they are allowed. */
  const leftovers = html.match(/<(?!a\b)[a-z][a-z0-9-]*\b[^>]*\s(?:src|href)=["']https?:\/\/[^"']*["']/gi);
  if (leftovers) die(`external references remain after inlining:\n  ${leftovers.join("\n  ")}`);

  /* ---------- warn: em-dashes on screen ----------
   * A quick text check that needs no browser. The full check (overflow,
   * small text, contrast) is lint.ts, run by dev.ts and check.ts. */
  source
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<section\b[^>]*class="[^"]*\bslide\b/)
    .slice(1)
    .forEach((src, i) => {
      const onScreen = src.replace(new RegExp(NOTES.source, "g"), "").replace(/<[^>]+>/g, "");
      if (/\u2014|&mdash;|&#8212;/.test(onScreen)) console.warn(`warning: slide ${i + 1} has an em-dash on screen`);
    });

  /* ---------- write ---------- */
  const distDir = join(deckDir, "dist");
  mkdirSync(distDir, { recursive: true });
  const outPath = join(distDir, "index.html");
  writeFileSync(outPath, html);

  const slideCount = (html.match(/class="[^"]*\bslide\b/g) || []).length;
  console.log(`built ${outPath}`);
  console.log(`  slides: ${slideCount}`);
  console.log(`  size:   ${(html.length / 1024).toFixed(1)} KiB, fully self-contained`);
  return outPath;
}

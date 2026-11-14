/* ============================================================
 * deck / export.ts
 * What deck pdf and deck md share: the built deck open in Chromium,
 * with a way to show any slide at its last build step.
 *
 * Builds the deck first (dist/index.html, as check does), so the
 * export is what the room sees. Needs Playwright's Chromium, once:
 * bun install, then bunx playwright install chromium.
 * ============================================================ */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import { fail } from "./args.ts";
import { buildDeck } from "./build.ts";

/* What the engine puts on window, as page.evaluate callbacks read it. */
export type DeckWindow = typeof window & {
  deck: { slides: HTMLElement[]; goTo(n: number, opts?: { atLastPhase?: boolean }): void };
};

export type OpenDeck = {
  browser: Browser;
  page: Page;
  /* How many slides. */
  count: number;
  /* The talk's title (the deck's <title>). */
  title: string;
  /* Shows slide i (from 0) at its last build step, videos paused. */
  show(i: number): Promise<void>;
};

export const openDeck = async (deckDir: string, opts: { width: number; height: number; mode?: string }): Promise<OpenDeck> => {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return fail("this needs Playwright: bun install, then bunx playwright install chromium");
  }
  // The build's report goes to stderr, so deck md --out - prints only
  // the Markdown.
  const log = console.log;
  console.log = console.error;
  try {
    buildDeck(deckDir);
  } finally {
    console.log = log;
  }
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch {
    return fail("Chromium did not start: bunx playwright install chromium");
  }
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, reducedMotion: "reduce" });
  await page.goto(pathToFileURL(path.join(deckDir, "dist", "index.html")).href);
  // A clean start: nothing remembered from an earlier visit (the theme,
  // builds off, the slide).
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.reload();
  await page.waitForTimeout(800);
  // No motion, and none of the engine's own controls on the slides.
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;animation-delay:0s!important}" +
      ".dk-toast,.dk-counter,.dk-goto,.dk-fs,.dk-help,.dk-notes,.dk-laser,.dk-keytest{display:none!important}",
  });
  if (opts.mode) await page.evaluate((t) => (document.documentElement.dataset.theme = t), opts.mode);
  await page.evaluate(() => document.fonts.ready);
  const count = await page.evaluate(() => (window as DeckWindow).deck.slides.length);
  const title = await page.title();
  const show = async (i: number) => {
    await page.evaluate((i) => (window as DeckWindow).deck.goTo(i, { atLastPhase: true }), i);
    await page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()));
    await page.waitForTimeout(150);
  };
  return { browser, page, count, title, show };
};

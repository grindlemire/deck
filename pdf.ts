/* ============================================================
 * deck / pdf.ts
 * deck pdf: the talk as a PDF, one slide to a page.
 *
 *   bun deck pdf [talk] [--mode dark|light] [--notes] [--out file.pdf]
 *
 * Each page is the slide at its last build step, as the room sees it
 * (a 1920x1080 picture of it, so the theme's fonts and scripts come out
 * exactly; the text is not selectable). --notes makes a handout
 * instead: a Letter page per slide, the slide on top and its speaker
 * notes under it. Writes <deck>/dist/<talk>.pdf (<talk>-notes.pdf with
 * --notes) unless --out says where.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fail, findDeck, parseArgs, talkName } from "./args.ts";
import { type DeckWindow, openDeck } from "./export.ts";

const W = 1920;
const H = 1080;

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["out", "mode"]);
  const deckDir = findDeck(args.positional[0]);
  const mode = args.opt("mode");
  if (mode && mode !== "dark" && mode !== "light") fail("--mode is dark or light");
  const withNotes = args.flag("notes");
  const out = path.resolve(args.opt("out") ?? path.join(deckDir, "dist", `${talkName(deckDir)}${withNotes ? "-notes" : ""}.pdf`));

  const { browser, page, count, title, show } = await openDeck(deckDir, { width: W, height: H, mode });
  const slides: { src: string; notes: string }[] = [];
  for (let i = 0; i < count; i++) {
    await show(i);
    // PNG keeps text sharp; a slide full of photos is far smaller as JPEG.
    let shot = await page.screenshot({ type: "png" });
    let type = "png";
    if (shot.length > 600_000) {
      shot = await page.screenshot({ type: "jpeg", quality: 90 });
      type = "jpeg";
    }
    const notes = withNotes
      ? await page.evaluate((i) => (window as DeckWindow).deck.slides[i].querySelector(":scope > .notes")?.innerHTML.trim() ?? "", i)
      : "";
    slides.push({ src: `data:image/${type};base64,${shot.toString("base64")}`, notes });
    if (process.stderr.isTTY) process.stderr.write(`\rslide ${i + 1} / ${count}`);
  }
  if (process.stderr.isTTY) process.stderr.write("\n");

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = withNotes
    ? slides
        .map(
          (s, i) => `<section>
  <img src="${s.src}" alt="">
  <div class="notes">${s.notes || '<p class="none">No notes for this slide.</p>'}</div>
  <footer>${esc(title)} · ${i + 1} / ${count}</footer>
</section>`,
        )
        .join("\n")
    : slides.map((s) => `<img src="${s.src}" alt="">`).join("\n");
  const style = withNotes
    ? `@page { size: letter portrait; margin: 0.5in; }
  body { margin: 0; font: 11pt/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c2128; }
  section { break-after: page; }
  section:last-child { break-after: auto; }
  img { display: block; width: 100%; border: 1px solid #d0d7de; }
  .notes { margin-top: 0.3in; }
  .notes p { margin: 0 0 0.6em; }
  .none { color: #6e7781; font-style: italic; }
  footer { margin-top: 0.3in; color: #6e7781; font-size: 9pt; }`
    : `@page { size: ${W}px ${H}px; margin: 0; }
  body { margin: 0; }
  img { display: block; width: ${W}px; height: ${H}px; break-after: page; }
  img:last-child { break-after: auto; }`;

  const doc = await browser.newPage();
  await doc.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style></head><body>${body}</body></html>`, {
    waitUntil: "load",
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await doc.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
  await browser.close();
  const mb = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`${count} slides -> ${path.relative(process.cwd(), out)} (${mb} MB)`);
}

/* ============================================================
 * deck / md.ts
 * deck md: the talk as Markdown, a section per slide.
 *
 *   bun deck md [talk] [--no-notes] [--out file.md | --out -]
 *
 * Each slide becomes "## <n>. <headline>", then what is on it, fully
 * built: paragraphs, lists, quotes, code (a diff when the slide shows
 * one), tables, and a line for each picture, video or diagram; then its
 * speaker notes as a quote. It reads the slide as the browser lays it
 * out, so whatever the theme hides (.only-dark in light mode, an
 * element faded out by the last build step) stays out, and the engine's
 * own pieces (the credits list) come in. Writes <deck>/dist/<talk>.md
 * unless --out says where; --out - prints it.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { findDeck, parseArgs, talkName } from "./args.ts";
import { type DeckWindow, openDeck } from "./export.ts";

type Slide = { headline: string; body: string[]; notes: string[] };

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["out"]);
  const deckDir = findDeck(args.positional[0]);
  const withNotes = !args.flag("no-notes");
  const toStdout = args.opt("out") === "-";
  const out = toStdout ? "" : path.resolve(args.opt("out") ?? path.join(deckDir, "dist", `${talkName(deckDir)}.md`));

  const { browser, page, count, title, show } = await openDeck(deckDir, { width: 1920, height: 1080 });
  const slides: Slide[] = [];
  for (let i = 0; i < count; i++) {
    await show(i);
    slides.push(await page.evaluate(convert, i));
  }
  await browser.close();

  const parts = [`# ${title}`];
  slides.forEach((s, i) => {
    parts.push(`## ${i + 1}. ${s.headline || `Slide ${i + 1}`}`);
    parts.push(...s.body);
    if (withNotes && s.notes.length) parts.push(s.notes.map((b) => b.replace(/^/gm, "> ")).join("\n>\n").replace(/^> /, "> **Notes:** "));
  });
  const md = parts.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";

  if (toStdout) return void process.stdout.write(md);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  console.log(`${count} slides -> ${path.relative(process.cwd(), out)}`);
}

/* Runs in the page: slide i as Markdown blocks. Everything it needs is
   inside it, since page.evaluate sends only the function's source. */
function convert(i: number): Slide {
  const slide = (window as DeckWindow).deck.slides[i];

  // Kept out: notes (handled apart), footers, scripts, and anything
  // marked decorative. (The engine's own controls are outside the slides.)
  const SKIP = ".notes, .corner-tag, script, style, template, noscript, [aria-hidden='true']";
  const shown = (el: Element, inNotes: boolean): boolean => {
    if (inNotes) return true; // notes are hidden on screen; keep them all
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  const isInline = (el: Element, inNotes: boolean): boolean => {
    if (inNotes) return /^(A|B|STRONG|EM|I|CODE|SPAN|BR|SUP|SUB|SMALL|MARK|KBD|S|DEL|INS|U|Q|ABBR|CITE)$/.test(el.tagName);
    return getComputedStyle(el).display.startsWith("inline");
  };
  // Inside a skipped piece, up to the slide (the engine puts its own
  // dk- classes on the slide itself).
  const skipped = (el: Element): boolean => {
    for (let e: Element | null = el; e && e !== slide; e = e.parentElement) if (e.matches(SKIP)) return true;
    return false;
  };
  const clean = (t: string) => t.replace(/\s+/g, " ");
  // Short pieces as sentences: a period between them where none is.
  const sentences = (parts: string[]): string =>
    parts
      .map((p, k) => (k < parts.length - 1 && !/[.!?:;,)"”'’…]$/.test(p) && !/^\d{1,3}$/.test(p) ? `${p}.` : p))
      .join(" ");
  const escText = (t: string) => t.replace(/([\\`*_[\]])/g, "\\$1");

  // Text with bold, italics, code and links.
  const inline = (node: Node, inNotes: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE) return escText(clean(node.textContent || ""));
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    if (el.matches(SKIP.replace(".notes, ", "")) || !shown(el, inNotes)) return "";
    if (el.matches(".chip-old")) return "";
    if (el.tagName === "BR") return " ";
    if (el.tagName === "IMG") return picture(el as HTMLImageElement);
    if (el.tagName === "svg" || el.tagName === "SVG") return diagram(el);
    const inner = [...el.childNodes].map((c) => inline(c, inNotes)).join("");
    const t = inner.trim();
    if (!t) return inner;
    const pad = (s: string) => (inner.startsWith(" ") ? " " : "") + s + (inner.endsWith(" ") ? " " : "");
    if (/^(B|STRONG)$/.test(el.tagName)) return pad(`**${t}**`);
    if (/^(EM|I)$/.test(el.tagName)) return pad(`*${t}*`);
    if (/^(S|DEL)$/.test(el.tagName)) return pad(`~~${t}~~`);
    if (el.tagName === "CODE" || el.matches(".ic")) return pad("`" + (el.textContent || "").trim() + "`");
    if (el.tagName === "A") {
      const href = el.getAttribute("href") || "";
      return /^(https?:|mailto:)/.test(href) ? pad(`[${t}](${href})`) : inner;
    }
    return inner;
  };

  const picture = (img: HTMLImageElement): string => {
    const alt = clean(img.alt || "").trim();
    const src = img.getAttribute("src") || "";
    if (/^https?:/.test(src)) return `![${escText(alt)}](${src})`;
    return alt ? `*[Image: ${escText(alt)}]*` : "";
  };
  const diagram = (svg: Element): string => {
    const label = svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "";
    return label ? `*[Diagram: ${escText(clean(label).trim())}]*` : "";
  };

  // A code frame: plain, or a diff when the slide shows lines added,
  // removed or changed (the delta grammar).
  const code = (frame: Element): string => {
    const file = frame.getAttribute("data-file");
    const lines = frame.querySelectorAll(".dl");
    let fence: string;
    if (lines.length) {
      const diff = frame.querySelector(".dl-add, .dl-del, .dl-chg");
      const text = [...lines]
        .filter((l) => getComputedStyle(l).display !== "none" || l.matches(".dl-add, .dl-del"))
        .map((l) => {
          const copy = l.cloneNode(true) as Element;
          copy.querySelectorAll(".chip-old").forEach((c) => c.remove());
          const t = (copy.textContent || "").replace(/\n/g, "");
          if (!diff) return t;
          return (l.matches(".dl-add") ? "+" : l.matches(".dl-del") ? "-" : l.matches(".dl-chg") ? "~" : " ") + " " + t;
        });
      fence = "```" + (diff ? "diff" : "") + "\n" + text.join("\n") + "\n```";
    } else {
      const pre = frame.matches("pre") ? frame : frame.querySelector("pre");
      fence = "```\n" + (pre?.textContent || frame.textContent || "").replace(/^\n+|\s+$/g, "") + "\n```";
    }
    return file ? `\`${file}\`\n\n${fence}` : fence;
  };

  const list = (el: Element, depth: number, inNotes: boolean): string => {
    const items = [...el.children]
      .filter((li) => li.tagName === "LI" && shown(li, inNotes))
      .map((li) => {
        const nested = [...li.children].filter((c) => /^(UL|OL)$/.test(c.tagName));
        const own = [...li.childNodes].filter((c) => !nested.includes(c as Element));
        return { lead: sentences(flow(own, inNotes)).trim(), sub: nested.map((c) => list(c, depth + 1, inNotes)).join("\n") };
      });
    // Items that show their own numbers (01, 02...) are a numbered list
    // with the numbers taken off, so they do not show twice.
    const NUM = /^\d{1,3}\.?\s+/;
    const ordered = el.tagName === "OL" || (items.length > 1 && items.every((it) => NUM.test(it.lead)));
    return items
      .map((it, n) => {
        const lead = ordered ? it.lead.replace(NUM, "") : it.lead;
        return "  ".repeat(depth) + `${ordered ? `${n + 1}.` : "-"} ${lead}` + (it.sub ? "\n" + it.sub : "");
      })
      .join("\n");
  };

  const table = (el: Element): string => {
    const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => inline(c, false).trim().replace(/\|/g, "\\|")));
    if (!rows.length) return "";
    const w = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) => `| ${Array.from({ length: w }, (_, k) => r[k] ?? "").join(" | ")} |`;
    return [line(rows[0]), line(Array(w).fill("---")), ...rows.slice(1).map(line)].join("\n");
  };

  // Whether an element only holds a line of text (no blocks inside).
  // (An empty element, a colored dot or a rule, does not count.)
  const empty = (el: Element) => !el.textContent?.trim() && !el.querySelector("img, svg, video");
  const leaf = (el: Element, inNotes: boolean): boolean =>
    [...el.children].every(
      (c) => !shown(c, inNotes) || c.matches(SKIP) || empty(c) || (isInline(c, inNotes) && leaf(c, inNotes)) || /^(IMG|svg|SVG|BR)$/.test(c.tagName),
    );

  // A run of nodes as blocks: text and inline elements gather into one
  // paragraph, block elements become blocks of their own.
  const flow = (nodes: Node[], inNotes: boolean): string[] => {
    const out: string[] = [];
    let para = "";
    const flush = () => {
      if (para.trim()) out.push(para.trim());
      para = "";
    };
    for (const n of nodes) {
      if (n.nodeType === Node.ELEMENT_NODE && !isInline(n as Element, inNotes)) {
        flush();
        out.push(...block(n as Element, inNotes));
      } else para += inline(n, inNotes);
    }
    flush();
    return out;
  };

  const block = (el: Element, inNotes: boolean): string[] => {
    if (el.matches(inNotes ? "script, style" : SKIP) || !shown(el, inNotes)) return [];
    if (el.matches("[data-placeholder]")) return [`*[To come: ${escText(el.getAttribute("data-placeholder") || "")}]*`];
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag) || el.matches(".headline")) {
      const t = inline(el, inNotes).trim();
      return t ? [`### ${t}`] : [];
    }
    if (tag === "UL" || tag === "OL") return [list(el, 0, inNotes)];
    if (tag === "PRE" || el.matches(".code-frame")) return [code(el)];
    if (tag === "TABLE") return [table(el)];
    if (tag === "BLOCKQUOTE") return [flow([...el.childNodes], inNotes).join("\n\n").replace(/^/gm, "> ")];
    if (tag === "IMG") return [picture(el as HTMLImageElement)].filter(Boolean);
    if (tag === "svg" || tag === "SVG") return [diagram(el)].filter(Boolean);
    if (tag === "VIDEO") return ["*[Video]*"];
    if (tag === "HR") return [];
    if (!inNotes) {
      const kids = [...el.children].filter((c) => shown(c, false) && !c.matches(SKIP) && !empty(c));
      const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const kind = (k: Element) => `${k.tagName}.${k.className}`;
      const STRUCT = "p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, pre, table, figure, .headline, .code-frame";
      // A table built from divs: a header row unlike the rows under it,
      // and every row the same number of cells.
      const cells = (row: Element) => [...row.children].filter((c) => shown(c, false) && !c.matches(SKIP) && !empty(c));
      if (
        !text &&
        kids.length > 2 &&
        kids.slice(1).every((k) => kind(k) === kind(kids[1])) &&
        kind(kids[0]) !== kind(kids[1]) &&
        kids.every((k) => cells(k).length >= 2 && cells(k).length === cells(kids[0]).length && cells(k).every((c) => leaf(c, false)))
      ) {
        const rows = kids.map((k) => cells(k).map((c) => inline(c, false).trim().replace(/\|/g, "\\|")));
        const line = (r: string[]) => `| ${r.join(" | ")} |`;
        return [[line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n")];
      }
      // Siblings of one kind, a line each (three cards, a row of pills):
      // a list. Paragraphs stay paragraphs.
      if (!text && kids.length > 1 && kids.every((k) => kind(k) === kind(kids[0])) && !/^(P|H[1-6])$/.test(kids[0].tagName)) {
        const items = kids.map((k) => block(k, false));
        if (items.every((b) => b.length >= 1 && b.every((x) => !/^(###|```|>|\||- |\d+\. )/.test(x)))) return [items.map((b) => `- ${sentences(b)}`).join("\n")];
      }
      // Short pieces with no paragraphs, lists or headings among them (a
      // number and its label, a name and a caption): one line.
      if (kids.length && kids.every((k) => leaf(k, false)) && !el.querySelector(STRUCT)) {
        const parts = flow([...el.childNodes], false);
        if (parts.length > 1 && parts.every((x) => x.length <= 160 && !/^(\*\[)/.test(x))) return [sentences(parts)];
        return parts;
      }
    }
    return flow([...el.childNodes], inNotes);
  };

  // The headline: the slide's .headline, else its first heading.
  const head = [...slide.querySelectorAll(".headline, h1, h2, h3")].find((h) => !skipped(h) && shown(h, false) && h.textContent?.trim());
  const headline = head ? inline(head, false).trim() : "";
  const body = [...slide.childNodes].flatMap((n) =>
    n.nodeType === Node.ELEMENT_NODE ? block(n as Element, false) : inline(n, false).trim() ? [inline(n, false).trim()] : [],
  );
  // The headline is the section's title, so it does not repeat as a heading.
  if (head) {
    const asHeading = `### ${headline}`;
    const at = body.indexOf(asHeading);
    if (at >= 0) body.splice(at, 1);
  }
  const notesEl = slide.querySelector(":scope > .notes");
  const notes = notesEl ? flow([...notesEl.childNodes], true) : [];
  return { headline, body: body.filter((b) => b.trim()), notes };
}

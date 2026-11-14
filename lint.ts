/* ============================================================
 * deck / lint.ts
 * Checks every slide, fully built, for things that hurt in the room:
 *   - content running past the slide's edges
 *   - em-dashes in on-screen text
 *   - text too small to read from the back (measured at 1080p)
 *   - text without enough contrast against its background (WCAG AA)
 *   - placeholders still to fill (data-placeholder)
 *   - filler writing, on screen and in the notes: "No X, Y" lines,
 *     "X did. Y didn't." flourishes, "isn't just", buzzwords,
 *     intensifiers, dashes
 *
 * Loaded by dev.ts (red badges on slides while you author) and by
 * check.ts (the before-you-present check); never part of a
 * build. Needs engine.ts (window.deck.probe).
 *
 * Opt out per element with data-lint-ok (say, a deliberately faint
 * watermark). Footers (.corner-tag) and placeholders are not checked
 * for size or contrast. <main class="deck" data-lint-min="20"> raises
 * the smallest text size allowed. data-lint-off="buzzword intensifier"
 * on the deck, a slide or an element switches writing rules off there.
 * ============================================================ */
(() => {
  "use strict";

  // Smallest text, in px at 1080p, that reads from the back of a room
  // (a slide's body text is 28px; the house theme's labels are 18px).
  const minPx = () => Number(document.querySelector<HTMLElement>(".deck")?.dataset.lintMin) || 18;
  const SKIP = ".notes, [data-lint-ok], .dk-lint-badge, .dk-time";
  const SMALL_OK = ".corner-tag, .src-line, [data-placeholder]";
  // Made by engine.ts from sources/digest.md: credits, not copy.
  const CREDITS = ".src-line, .credits";

  /* ---------- color ---------- */

  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });

  const luminance = ({ r, g, b }) => {
    const ch = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };

  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // The solid color behind el, blending translucent layers on the way
  // up. Null when an image or gradient is in the way (cannot judge).
  // An ancestor whose box is not under the text (a label floated beside
  // a diagram arrow, say) is skipped: its paint is not behind it.
  const backgroundOf = (el, slide) => {
    const layers = [];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let a = el; a; a = a.parentElement) {
      const ar = a.getBoundingClientRect();
      if (a !== el && (cx < ar.left || cx > ar.right || cy < ar.top || cy > ar.bottom)) continue;
      const cs = getComputedStyle(a);
      if (cs.backgroundImage !== "none") return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
      if (a === slide) break;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };

  /* ---------- writing ----------
   * Patterns that read as filler. Each rule has an id that
   * data-lint-off can name. Code (pre, code, kbd) is never checked. */

  const BUZZ = [
    "seamless(?:ly)?", "leverag(?:e|es|ed|ing)", "robust", "unlock(?:s|ed|ing)?", "supercharg(?:e|es|ed|ing)",
    "game[- ]chang(?:er|ers|ing)", "delv(?:e|es|ing)", "elevat(?:e|es|ing)", "empower(?:s|ed|ing)?",
    "cutting[- ]edge", "best[- ]in[- ]class", "world[- ]class", "next[- ]level", "revolutioni[sz](?:e|es|ed|ing)",
    "harness(?:es|ed|ing)?", "streamlin(?:e|es|ed|ing)", "effortless(?:ly)?", "blazing(?:ly)?[- ]fast",
    "synerg(?:y|ies)", "paradigm", "holistic", "pivotal", "tapestry", "embark(?:s|ed|ing)?",
    "deep[- ]dive", "dive (?:in|into)", "let's dive", "it's worth noting", "at the end of the day",
    "in today's", "the power of", "a testament to",
  ];
  const NEG = "didn't|doesn't|don't|isn't|wasn't|aren't|weren't|hasn't|haven't|can't|won't|couldn't|wouldn't";

  const WRITING = [
    {
      id: "no-x-y",
      re: /(?:^|[.!?:]\s+)(No\s+[a-z][^,.;:!?]{0,40},\s+\w+)/i,
      say: (m) => `"${m[1]}...": a "No X, Y" line; say the positive thing plainly`,
    },
    {
      id: "did-didnt",
      re: new RegExp(`[.!?]\\s+([A-Z][\\w'-]*(?:\\s+[\\w'-]+){0,5}\\s+(?:${NEG}))[.!](?=\\s|$)`),
      say: (m) => `"${m[1]}.": an "X did. Y didn't." flourish`,
    },
    {
      id: "not-just",
      re: /\b((?:isn't|is not|aren't|are not|wasn't|not)\s+just|more than just|not only\b[^.]{0,80}\bbut also)\b/i,
      say: (m) => `"${m[1]}": say what it is, not what it isn't just`,
    },
    {
      id: "buzzword",
      re: new RegExp(`\\b(${BUZZ.join("|")})\\b`, "i"),
      say: (m) => `"${m[1]}" is filler; say what it does`,
    },
    {
      id: "intensifier",
      re: /\b(incredibly|insanely|massively|dramatically|hugely|truly|literally)\b/i,
      say: (m) => `"${m[1]}" adds volume, not meaning`,
    },
    {
      id: "dash",
      re: /(\s\u2013\s|\s--\s)/,
      say: () => "a dash between words; use a period, comma or colon",
    },
  ];

  // Rule ids switched off for el: every data-lint-off from el up.
  const offFor = (el) => {
    const off = new Set();
    for (let a = el; a; a = a.parentElement) a.dataset?.lintOff?.split(/[\s,]+/).forEach((id) => off.add(id));
    return off;
  };

  // Apostrophes and quotes come in curly and straight forms.
  const plain = (t) => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();

  const writingIssues = (text, off, where) => {
    const out = [];
    for (const rule of WRITING) {
      if (off.has(rule.id)) continue;
      const m = plain(text).match(rule.re);
      if (m) out.push(`writing${where}: ${rule.say(m)}`);
    }
    return out;
  };

  const CODE = "pre, code, kbd";

  // On-screen text blocks (each element that holds text of its own, with
  // its inline children) and the notes, paragraph by paragraph.
  const writingOf = (slide) => {
    const issues = [];
    for (const el of slide.querySelectorAll("*")) {
      if (el.closest(SKIP) || el.closest(CODE) || el.closest(CREDITS) || !hasOwnText(el)) continue;
      const copy = el.cloneNode(true);
      copy.querySelectorAll(CODE).forEach((c) => c.replaceWith(" "));
      issues.push(...writingIssues(copy.textContent, offFor(el), ""));
    }
    const notes = slide.querySelector(".notes");
    if (notes) {
      const off = offFor(notes);
      const blocks = notes.querySelectorAll("p, li").length ? notes.querySelectorAll("p, li") : [notes];
      for (const b of blocks) {
        const copy = b.cloneNode(true);
        copy.querySelectorAll(CODE).forEach((c) => c.replaceWith(" "));
        issues.push(...writingIssues(copy.textContent, off, " (notes)"));
      }
    }
    return issues;
  };

  /* ---------- the story: outline.md and sources/digest.md ----------
   * dev.ts passes both in as #dk-story (outline.ts parses them). A
   * slide names its beat with data-beat="2.3", or says it has none with
   * data-custom. What the outline says wins: the slide's headline, the
   * Screen lines and the Say text (its notes) must match it. Custom
   * content beside them is fine. With a digest, every number and quote
   * on screen needs a source: data-src on it or its slide, or Sources:
   * on its beat. */

  const story = (() => {
    try {
      return JSON.parse(document.getElementById("dk-story")?.textContent || "null");
    } catch {
      return null;
    }
  })();
  const outline = story?.outline || null;
  const sources = story?.sources || null;
  const beats = new Map<string, { headline: string; screen: string; say: string; sources: string[]; order: number }>((outline?.beats || []).map((b, i) => [b.id, { ...b, order: i }]));

  // Text for comparing: case, punctuation and spacing do not count.
  const norm = (t) =>
    plain(t)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();

  // Markdown down to its words: no fences, heading or list markers, links.
  const unmark = (t) =>
    t
      .replace(/^\s*```.*$/gm, "")
      .replace(/^\s*#+\s*/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

  // An element's words with a space between every text node (so <li>s
  // and highlighted code tokens never run together), minus some parts.
  const wordsOf = (el, minus) => {
    const copy = el.isConnected ? el.cloneNode(true) : el;
    copy.querySelectorAll(minus).forEach((n) => n.remove());
    copy.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
    const parts = [];
    const walk = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) parts.push(walk.currentNode.textContent);
    return parts.join(" ");
  };
  // A code frame's file name shows through data-file: it counts too.
  const screenOf = (slide) => {
    const copy = slide.cloneNode(true);
    copy.querySelectorAll("[data-file]").forEach((el) => el.prepend(`${el.dataset.file} `));
    return wordsOf(copy, ".notes, .dk-lint-badge, .src-line, .dk-time");
  };

  // The pieces of a Screen block to look for on the slide. A slide lays
  // text out in its own order (a table as cards, a label beside its
  // value), so each table cell, and each run of a line between
  // punctuation, is looked for on its own. Lines drawn with box
  // characters are sketches of a layout, not text.
  const screenPieces = (screen) => {
    const pieces = [];
    for (const line of unmark(screen).split("\n")) {
      if (/[\u2500-\u257f]/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
      const parts = line.includes("|") ? line.split("|") : line.split(/[:();\u2192\u00b7\u2022]|\s[-\u2013]\s/);
      for (const p of parts) if (norm(p).length >= 3) pieces.push(p.replace(/\*\*?|`/g, "").trim());
    }
    return pieces;
  };
  const notesOf = (slide) => {
    const n = slide.querySelector(".notes");
    return n ? wordsOf(n, ".dk-lint-badge") : "";
  };

  // The first few words where two texts part ways, for the message.
  const firstDiff = (want, got) => {
    const a = norm(want).split(" ");
    const b = norm(got).split(" ");
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return { at: i, want: a.slice(i, i + 6).join(" "), got: b.slice(i, i + 6).join(" ") };
  };

  const short = (t, n = 48) => (t.length > n ? t.slice(0, n) + "..." : t);

  const outlineIssues = (slide) => {
    if (!outline) return [];
    const all = window.deck.slides;
    const id = slide.dataset.beat;
    if (!id) return "custom" in slide.dataset ? [] : ["outline: no data-beat; tie the slide to a beat, or mark it data-custom"];
    const beat = beats.get(id);
    if (!beat) return [`outline: data-beat="${id}" is not a beat in outline.md`];

    const issues = [];
    const mine = all.filter((s) => s.dataset.beat === id);
    const i = all.indexOf(slide);

    // In outline order: no earlier slide may carry a later beat.
    const later = all.slice(0, i).find((s) => (beats.get(s.dataset.beat)?.order ?? -1) > beat.order);
    if (later) issues.push(`outline: beat ${id} comes before beat ${later.dataset.beat} in the outline, but after it here`);

    // A beat may span slides; it is checked once, on its first slide.
    if (mine[0] !== slide) return issues;

    if (norm(window.deck.titleOf(slide)) !== norm(beat.headline)) {
      issues.push(`outline: headline differs from beat ${id}: "${short(beat.headline)}"`);
    }

    const screen = ` ${norm(mine.map(screenOf).join(" "))} `;
    const missing = screenPieces(beat.screen).filter((p) => !screen.includes(` ${norm(p)} `));
    missing.slice(0, 3).forEach((l) => issues.push(`outline: on screen in beat ${id} but not here: "${short(l)}"`));
    if (missing.length > 3) issues.push(`outline: ...and ${missing.length - 3} more Screen lines of beat ${id}`);

    if (beat.say) {
      const notes = mine.map(notesOf).join(" ");
      if (norm(notes) !== norm(unmark(beat.say))) {
        const d = firstDiff(unmark(beat.say), notes);
        issues.push(
          d.want
            ? `outline: notes differ from beat ${id}'s Say at "${d.want}"${d.got ? ` (notes have "${d.got}")` : " (missing)"}`
            : `outline: notes say more than beat ${id}'s Say: "${d.got}..."`,
        );
      }
    }
    return issues;
  };

  // Numbers that are claims: with a unit (16 kB, 40%, 3x, 200 ms), or
  // plain and 1,000 and up (not a year). A bare small number is usually
  // a line number, a status code or a count you can see. Quotes:
  // anything in quotation marks of three words or more.
  const UNIT = "%|x\\b|\\u00d7|ms\\b|s\\b|sec\\b|seconds?\\b|min(?:utes)?\\b|hours?\\b|kB\\b|KB\\b|MB\\b|GB\\b|k\\b|K\\b|M\\b|times\\b";
  const CLAIM_NUM = new RegExp(`(?<![\\w.\\/-])(\\d+(?:[.,]\\d+)*)(\\s?(?:${UNIT}))?`, "g");
  const CLAIM_QUOTE = /["\u201c]([^"\u201d]*\s[^"\u201d]*\s[^"\u201d]*)["\u201d]/;

  const claimsIn = (text) => {
    const out = [];
    for (const m of text.matchAll(CLAIM_NUM)) {
      const n = Number(m[1].replace(/,/g, ""));
      const year = /^(19|20)\d\d$/.test(m[1]) && !m[2];
      if (!year && (m[2] || n >= 1000)) out.push(m[0].trim());
    }
    const q = text.match(CLAIM_QUOTE);
    if (q) out.push(`"${short(q[1], 32)}"`);
    return out;
  };

  const sourceIssues = (slide) => {
    if (!sources) return [];
    const issues = [];
    for (const el of [slide, ...slide.querySelectorAll("[data-src]")]) {
      for (const ref of (el.dataset.src || "").match(/S\d+(?:\.\d+)?/g) || []) {
        const [sid, n] = ref.split(".");
        if (!sources[sid] || (n && !(n in sources[sid].items))) issues.push(`source: ${ref} is not in sources/digest.md`);
      }
    }
    const beat = beats.get(slide.dataset.beat);
    if (slide.dataset.src || beat?.sources.length) return issues;
    for (const el of slide.querySelectorAll("*")) {
      if (el.closest(SKIP) || el.closest(CODE) || el.closest(CREDITS) || el.closest(".corner-tag, [data-src]")) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
      for (const c of claimsIn(plain(own))) {
        issues.push(`source: ${c} has no source (data-src="S1.2" on it, or Sources: on its beat)`);
      }
    }
    return issues;
  };

  // Problems with the story as a whole, for the deck badge and check.ts.
  const lintStory = () => {
    if (!story) return [];
    const issues = [...(story.issues || [])];
    if (outline) {
      const used = new Set(window.deck.slides.map((s) => s.dataset.beat).filter(Boolean));
      for (const b of outline.beats) if (!used.has(b.id)) issues.push(`outline: beat ${b.id} "${short(b.headline)}" has no slide`);
    }
    return issues;
  };

  /* ---------- one slide ---------- */

  const hasOwnText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);

  const nameOf = (el) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "";
    const text = el.textContent.trim().replace(/\s+/g, " ");
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text.slice(0, 28)}${text.length > 28 ? "..." : ""}"` : ""}`;
  };

  const lintSlide = (slide) => {
    const issues = [];
    const box = slide.getBoundingClientRect();
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const at1080 = (px) => (px / rootPx) * 16;
    const tol = 2;
    const min = minPx();

    slide.querySelectorAll("[data-placeholder]").forEach((el) => {
      if (!el.closest(SKIP)) issues.push(`placeholder still to fill: ${el.dataset.placeholder}`);
    });

    for (const el of slide.querySelectorAll("*")) {
      if (el.closest(SKIP)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;

      // What is actually visible: clip by any scrolling or clipping
      // ancestor inside the slide, and skip anything faded to nothing.
      let r = el.getBoundingClientRect();
      let hidden = cs.opacity === "0";
      for (let a = el.parentElement; a && a !== slide && !hidden; a = a.parentElement) {
        const acs = getComputedStyle(a);
        // Inside something pinned to the window (the current slide's
        // footer): it is placed on the screen, not on the slide.
        if (acs.opacity === "0" || acs.visibility === "hidden" || acs.position === "fixed") hidden = true;
        else if (acs.overflow !== "visible") {
          const c = a.getBoundingClientRect();
          r = {
            left: Math.max(r.left, c.left),
            top: Math.max(r.top, c.top),
            right: Math.min(r.right, c.right),
            bottom: Math.min(r.bottom, c.bottom),
          };
        }
      }
      if (hidden || r.right - r.left <= 0 || r.bottom - r.top <= 0) continue;

      const past = Math.max(r.right - box.right, r.bottom - box.bottom, box.left - r.left, box.top - r.top);
      if (past > tol) issues.push(`${nameOf(el)} runs ${Math.round(at1080(past))}px past the slide edge`);

      if (!hasOwnText(el)) continue;

      const size = at1080(parseFloat(cs.fontSize));
      if (el.closest(SMALL_OK)) continue;
      if (size < min - 0.5) issues.push(`${nameOf(el)} is ${Math.round(size)}px text (at 1080p; use ${min}px or more)`);

      const fg = parse(cs.color);
      const bg = backgroundOf(el, slide);
      if (fg && bg) {
        const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
        const got = ratio(over(fg, bg), bg);
        if (got < need) issues.push(`${nameOf(el)} has contrast ${got.toFixed(1)}:1 (needs ${need}:1)`);
      }
    }

    const text = [...slide.querySelectorAll("*")]
      .filter((el) => !el.closest(SKIP) && hasOwnText(el))
      .map((el) => el.textContent)
      .join(" ");
    if (text.includes("—")) issues.push("em-dash in on-screen text");

    issues.push(...writingOf(slide), ...outlineIssues(slide), ...sourceIssues(slide));

    return [...new Set(issues)];
  };

  /* ---------- the deck ---------- */

  // Every slide, each fully built: [{ slide: 1-based, issues: [...] }].
  const lintDeck = () =>
    window.deck.slides
      .map((_, i) => ({ slide: i + 1, issues: window.deck.probe(i, lintSlide) }))
      .filter((r) => r.issues.length);

  /* ---------- dev badges ---------- */

  // A red badge on each slide with issues; click it for the list.
  // The last badge run, for the headline readout (story.ts).
  let last = null;
  const results = () => last || { slides: lintDeck(), deck: lintStory() };

  const badge = () => {
    document.querySelectorAll(".dk-lint-badge").forEach((b) => b.remove());
    const theme = document.documentElement.dataset.theme || "default";
    const results = lintDeck();
    const whole = lintStory();
    if (whole.length) {
      // The story's own problems (a beat with no slide, a bad citation)
      // belong to no slide: one badge for the whole deck.
      const el = document.createElement("div");
      el.className = "dk-lint-badge dk-lint-deck";
      el.innerHTML = `<button type="button">outline: ${whole.length}</button><ul>${whole
        .map((t) => `<li>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`)
        .join("")}</ul>`;
      el.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        el.classList.toggle("open");
      });
      document.body.appendChild(el);
      console.warn(`deck outline and sources:\n${whole.map((t) => `  - ${t}`).join("\n")}`);
    }
    for (const { slide, issues } of results) {
      const el = document.createElement("div");
      el.className = "dk-lint-badge";
      el.innerHTML = `<button type="button">${issues.length} issue${issues.length > 1 ? "s" : ""}</button><ul>${issues
        .map((t) => `<li>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`)
        .join("")}</ul>`;
      el.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        el.classList.toggle("open");
      });
      window.deck.slides[slide - 1].appendChild(el);
    }
    if (results.length) {
      console.warn(
        `deck lint (${theme} theme): ${results.length} slide(s) with issues\n` +
          results.map((r) => `  slide ${r.slide}:\n${r.issues.map((t) => `    - ${t}`).join("\n")}`).join("\n"),
      );
    } else {
      console.info(`deck lint (${theme} theme): no issues`);
    }
    last = { slides: results, deck: whole };
    return results;
  };

  window.deckLint = { slide: lintSlide, deck: lintDeck, story: lintStory, badge, results, claimsIn, norm };

  if (window.DECK_DEV && window.deck) {
    // Fonts change text metrics; lint once they are in.
    document.fonts.ready.then(badge);
    // The other theme has other colors: lint again when it flips.
    new MutationObserver(badge).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
})();

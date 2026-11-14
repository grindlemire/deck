/* ============================================================
 * deck / story.ts
 * The headline readout: every slide's headline in order, grouped by
 * the outline's sections, with each section's question, its planned
 * minutes against the slides' estimated minutes, and soft hints:
 *   - a headline that names a topic instead of saying the point
 *   - a crowded slide (words on screen, builds, lines of code)
 *   - the same layout four slides in a row
 *   - a slide with no notes
 * Read the headlines alone, top to bottom: if they tell the story,
 * the talk flows. Hints (yellow) are for judgment. lint.ts's findings
 * (red: the same as the slides' badges) show beside them when it is
 * loaded, so one view has everything.
 *
 * Loaded by dev.ts ("h" opens it) and check.ts (writes it
 * to snapshots/story.md). Never part of a build. Needs engine.ts; reads
 * the outline from #dk-story when the deck has one (outline.ts).
 * ============================================================ */
(() => {
  "use strict";

  const deck = window.deck;
  if (!deck) return;

  const story = (() => {
    try {
      return JSON.parse(document.getElementById("dk-story")?.textContent || "null");
    } catch {
      return null;
    }
  })();
  const outline = story?.outline || null;

  // Slides that carry the structure, not an argument: no headline or
  // layout hints for them.
  const STRUCTURAL = ["title-slide", "divider", "mode-anchor", "mode-wall", "mode-demo", "close-slide", "credits-slide"];
  // The catalog's main components (AUTHORING.md), for "same layout".
  const LAYOUTS = [
    "code-frame", "ways", "cost-list", "lead-list", "num-list", "stats", "rf", "seq",
    "attr-grid", "shot", "mock-browser", "about", "placeholder",
  ];
  const CHROME = ".notes, .corner-tag, .src-line, .dk-lint-badge, .dk-time";

  const kindOf = (slide) => STRUCTURAL.find((c) => slide.classList.contains(c)) || null;

  const layoutOf = (slide) => {
    const kind = kindOf(slide);
    if (kind) return kind;
    for (const el of slide.querySelectorAll("*")) {
      if (el.closest(CHROME)) continue;
      const hit = LAYOUTS.find((c) => el.classList.contains(c));
      if (hit) return hit;
    }
    return "text";
  };

  const wordsOnScreen = (slide) => {
    const copy = slide.cloneNode(true);
    copy.querySelectorAll(`${CHROME}, pre, code`).forEach((n) => n.remove());
    copy.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
    const parts = [];
    const walk = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) parts.push(walk.currentNode.textContent);
    return (parts.join(" ").match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).length;
  };

  const codeLines = (slide) =>
    Math.max(0, ...[...slide.querySelectorAll("pre")].map((p) => p.textContent.replace(/\n+$/, "").split("\n").length));

  // data-story-words on .deck changes it.
  const MAX_WORDS = () => Number(document.querySelector<HTMLElement>(".deck")?.dataset.storyWords) || 70;

  const hintsFor = (slide, i, layouts) => {
    const hints = [];
    const kind = kindOf(slide);
    const title = deck.titleOf(slide);
    const words = title.split(/\s+/).filter(Boolean).length;
    if (!kind && words && words <= 3) hints.push("short headline: does it say the point?");
    if (!kind) {
      const n = wordsOnScreen(slide);
      if (n > MAX_WORDS()) hints.push(`${n} words on screen`);
    }
    const builds = slide.querySelectorAll("[data-build]").length;
    if (builds > 5) hints.push(`${builds} builds; two slides?`);
    const lines = codeLines(slide);
    if (lines > 16) hints.push(`${lines} lines of code`);
    const run = layouts.slice(0, i + 1).reverse();
    let same = 0;
    while (same < run.length && run[same] === layouts[i]) same++;
    if (!kind && layouts[i] !== "text" && same >= 4) hints.push(`${same} ${layouts[i]} slides in a row`);
    if (!slide.querySelector(".notes")?.textContent.trim()) hints.push("no notes");
    return hints;
  };

  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

  // Sections from the outline when there is one; otherwise every
  // divider slide starts a new section.
  const read = () => {
    const slides = deck.slides;
    const layouts = slides.map(layoutOf);
    const lint = window.deckLint?.results() || { slides: [], deck: [] };
    const issuesOf = new Map(lint.slides.map((r) => [r.slide, r.issues]));
    const rows = slides.map((slide, i) => ({
      issues: issuesOf.get(i + 1) || [],
      n: i + 1,
      beat: slide.dataset.beat || ("custom" in slide.dataset ? "custom" : ""),
      title: deck.titleOf(slide),
      seconds: deck.estimate(slide),
      hints: hintsFor(slide, i, layouts),
    }));

    let sections = [];
    if (outline?.sections.length) {
      const sectionOf = new Map(outline.beats.map((b) => [b.id, b.section]));
      let at = null;
      for (const row of rows) {
        const sid = sectionOf.get(row.beat) ?? at;
        at = sid;
        let sec = sections.find((s) => s.id === sid);
        if (!sec) {
          const o = outline.sections.find((s) => s.id === sid);
          sec = { id: sid, title: o?.title || "Before the first section", minutes: o?.minutes ?? null, question: o?.question || "", rows: [] };
          sections.push(sec);
        }
        sec.rows.push(row);
      }
    } else {
      let sec = { id: "", title: "Opening", minutes: null, question: "", rows: [] };
      sections.push(sec);
      slides.forEach((slide, i) => {
        if (slide.classList.contains("divider") && i > 0) {
          sec = { id: "", title: rows[i].title, minutes: null, question: "", rows: [] };
          sections.push(sec);
        }
        sec.rows.push(rows[i]);
      });
    }
    sections.forEach((s) => (s.seconds = s.rows.reduce((n, r) => n + r.seconds, 0)));
    // The plan: the outline's Duration, else data-duration on .deck.
    const set = document.querySelector<HTMLElement>(".deck")?.dataset.duration?.match(/^(\d+)(?::(\d\d))?/);
    const duration = outline?.duration ?? (set ? Number(set[1]) + Number(set[2] || 0) / 60 : null);
    const issues = lint.deck.length + rows.reduce((n, r) => n + r.issues.length, 0);
    return { title: outline?.title || document.title, outline, duration, sections, deckIssues: lint.deck, issues, total: rows.reduce((n, r) => n + r.seconds, 0) };
  };

  /* ---------- as markdown (check.ts) ---------- */

  const markdown = () => {
    const r = read();
    const out = [`# ${r.title}: headline readout`, ""];
    if (r.outline) {
      if (r.outline.point) out.push(`**Point:** ${r.outline.point}`);
      if (r.outline.before) out.push(`**Before:** ${r.outline.before}`);
      if (r.outline.after) out.push(`**After:** ${r.outline.after}`);
      out.push("");
    }
    out.push(`Estimated ${fmt(r.total)}${r.duration ? ` against ${Math.round(r.duration)} min planned` : ""}. ${r.issues || "No"} issue${r.issues === 1 ? "" : "s"}.`, "");
    if (r.deckIssues.length) out.push(...r.deckIssues.map((t) => `- **${t}**`), "");
    for (const s of r.sections) {
      out.push(`## ${s.id ? `${s.id} · ` : ""}${s.title} (${fmt(s.seconds)}${s.minutes != null ? ` of ${s.minutes} min` : ""})`);
      if (s.question) out.push(`*${s.question}*`);
      out.push("");
      for (const row of s.rows) {
        out.push(`${row.n}. ${row.title || "(no headline)"}${row.beat ? ` [${row.beat}]` : ""}${row.hints.length ? `  _(${row.hints.join("; ")})_` : ""}`);
        for (const t of row.issues) out.push(`   - **${t}**`);
      }
      out.push("");
    }
    return out.join("\n");
  };

  /* ---------- the panel ("h", dev server only) ---------- */

  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let panel = null;

  const render = () => {
    const r = read();
    const head = r.outline
      ? `<p class="dk-story-point">${esc(r.outline.point || "No Point in outline.md yet")}</p>` +
        (r.outline.before || r.outline.after
          ? `<p class="dk-story-aud"><b>Before</b> ${esc(r.outline.before)}<br><b>After</b> ${esc(r.outline.after)}</p>`
          : "")
      : `<p class="dk-story-aud">No outline.md: sections follow the divider slides.</p>`;
    const sections = r.sections
      .map((s) => {
        const over = s.minutes != null && s.seconds > s.minutes * 60 * 1.1;
        return `<section><h3>${esc(s.id ? `${s.id} · ` : "")}${esc(s.title)} <span class="${over ? "dk-story-over" : ""}">${fmt(
          s.seconds,
        )}${s.minutes != null ? ` / ${s.minutes} min` : ""}</span></h3>${s.question ? `<p class="dk-story-q">${esc(s.question)}</p>` : ""}<ol>${s.rows
          .map(
            (row) =>
              `<li data-n="${row.n}" value="${row.n}"><span class="dk-story-t">${esc(row.title || "(no headline)")}</span>${
                row.beat ? `<span class="dk-story-b">${esc(row.beat)}</span>` : ""
              }${row.hints.map((h) => `<span class="dk-story-h">${esc(h)}</span>`).join("")}${
                row.issues.length ? `<ul class="dk-story-i">${row.issues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""
              }</li>`,
          )
          .join("")}</ol></section>`;
      })
      .join("");
    const count = `<b class="${r.issues ? "dk-story-bad" : "dk-story-ok"}">${r.issues || "no"} issue${r.issues === 1 ? "" : "s"}</b>`;
    const whole = r.deckIssues.length ? `<ul class="dk-story-i dk-story-whole">${r.deckIssues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
    panel.innerHTML = `<header><h2>${esc(r.title)}</h2><span>${fmt(r.total)}${
      r.duration ? ` / ${Math.round(r.duration)} min` : ""
    } · ${count} · h or Esc to close</span></header>${head}${whole}${sections}`;
  };

  const close = () => {
    panel?.remove();
    panel = null;
  };

  const open = () => {
    panel = document.createElement("div");
    panel.className = "dk-story";
    render();
    panel.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-n]");
      if (!li) return;
      close();
      deck.goTo(Number(li.dataset.n) - 1);
    });
    document.body.appendChild(panel);
  };

  window.deckStory = { read, markdown };

  if (window.DECK_DEV) {
    // Capture phase, so Esc closes this panel instead of opening the
    // overview, and arrows scroll it instead of moving the deck.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.("input, textarea")) return;
        if (e.key === "h" || e.key === "H") {
          e.preventDefault();
          e.stopImmediatePropagation();
          panel ? close() : open();
        } else if (panel) {
          if (e.key === "Escape") close();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }
})();

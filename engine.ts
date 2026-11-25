/* ============================================================
 * deck / engine.ts
 * Slide lifecycle, keyboard nav, build phases, hash routing,
 * speaker notes, overview grid. Zero dependencies, no talk
 * content. See REFERENCE.md for the authoring contract.
 *
 * Keys:
 *   ArrowRight / Space / PageDown / ArrowDown   advance (phase-aware)
 *   ArrowLeft / PageUp / ArrowUp                back (phase-aware)
 *   Home / End                                  first / last slide
 *   n                                           toggle speaker notes
 *   Shift + ArrowRight / Shift + Space          finish the slide's builds, then advance
 *   b                                           toggle builds (off = every slide arrives complete)
 *   t                                           toggle light / dark theme
 *   f                                           toggle full screen (or the corner button)
 *   F5                                          enter full screen (a clicker's "start" button)
 *   . / w (or ,)                                black / white screen; any key brings it back
 *   k                                           clicker test: shows what each key press does
 *   v                                           blow the slide's clip up to full size (demo fallback)
 *   d                                           check every data-demo server answers
 *   p                                           open the presenter window (notes, next, timer)
 *   s (presenter window)                        start / pause the timer
 *   l                                           laser pointer (from either window, shown on both);
 *                                               drag to draw ink, which stays until c or the next slide
 *   c                                           clear the ink
 *   Shift + l                                   next laser color (or the swatches in the presenter bar)
 *   e                                           show / hide the audience's emoji reactions
 *   g                                           go live: phones follow (the presenter window asks
 *                                               for the follow-along key the first time)
 *   ?                                           show / hide every key (or the corner "?" button)
 *   swipe left / right (touch)                  advance / back
 *
 * Follow-along (deck/server): going live makes the audience window
 * post every move, and the laser and ink, to the talk on the server (the
 * one serving this deck, else the site in deck.config.json; ?lead=<url>
 * overrides), and show the audience's emoji reactions; the server's follow page
 * (<prefix>/<talk>/live, /talks by default, or any deck opened with
 * ?follow=<its events URL>)
 * follows those moves until the viewer moves on their own, offers a
 * button back to the live slide, and a row of reactions to send.
 *   0-9 then Enter                              jump to that slide (or click the counter)
 *   Esc                                         zoom out to the overview grid / back in
 *   in the overview: arrows move, Enter zooms into the selected slide
 *
 * Phases: a slide may declare data-phases="N". Advancing steps
 * data-phase from 1..N before moving to the next slide; the CSS
 * does the rest. Stepping back walks phases in reverse.
 *
 * Hash routing: the URL hash is the 1-based slide number (#12),
 * so every slide is addressable and reload-safe.
 *
 * Builds: elements marked data-build appear one advance at a time,
 * in document order; data-build="2" puts several elements on the same
 * step. A slide with N build steps behaves like data-phases="N+1"
 * (phase 1 shows only the unmarked content). Built elements carry
 * .dk-built; the CSS fades them in. Slides that declare data-phases
 * keep their own choreography and ignore data-build.
 *
 * Media: a <video data-autoplay> plays from the start when its
 * slide becomes current; every video on other slides is paused.
 *
 * Theme: "t" or the sun/moon corner button flips data-theme on <html>
 * between "light" and "dark" and remembers the choice; the theme's CSS
 * does the rest. Which one is showing comes from the theme's --paper, so
 * a theme that starts light flips to dark on the first press.
 * ============================================================ */
(() => {
  "use strict";

  const deck = document.querySelector<HTMLElement>(".deck");
  if (!deck) return;

  const slides = Array.from(deck.querySelectorAll<HTMLElement>(".slide"));
  if (slides.length === 0) return;

  // Each slide sits in a .dk-tile wrapper. It has no box in normal
  // viewing (display: contents); in the overview it becomes the grid
  // cell, and the slide inside is scaled down with a transform. A
  // transform keeps the slide's real layout (CSS zoom would hit the
  // browser's minimum font size and reflow the text), so the tile and
  // the full slide match exactly while the zoom morphs between them.
  slides.forEach((slide) => {
    const tile = document.createElement("div");
    tile.className = "dk-tile";
    slide.before(tile);
    tile.appendChild(slide);
  });
  const tileOf = (slide) => slide.parentElement;

  /* ---------- sources: source lines and the credits slide ----------
   * <deck>/sources/digest.md names each source "own" (your post, your
   * notes) or "other" (someone else's work); dev.ts and build.ts pass
   * the credits in as #dk-sources. data-src="S2.1" on a slide, or on
   * anything in it, cites a source. A slide that cites someone else's
   * work gets a small source line, and a section.credits-slide lists
   * every such source in the order the talk first uses them. */

  const credits = (() => {
    try {
      return JSON.parse(document.getElementById("dk-sources")?.textContent || "{}");
    } catch {
      return {};
    }
  })();

  const othersCitedBy = (slide) => {
    const ids = [];
    for (const el of [slide, ...slide.querySelectorAll("[data-src]")]) {
      for (const id of (el.dataset.src || "").match(/S\d+/g) || []) if (!ids.includes(id)) ids.push(id);
    }
    return ids.filter((id) => credits[id]?.kind === "other");
  };

  const creditOf = (id) => credits[id].credit || credits[id].title;

  const addSourceLine = (slide) => {
    const ids = othersCitedBy(slide);
    if (!ids.length || slide.querySelector(".src-line")) return;
    const line = document.createElement("p");
    line.className = "src-line";
    line.textContent = `Source: ${ids.map(creditOf).join("; ")}`;
    slide.appendChild(line);
  };
  slides.forEach(addSourceLine);

  // The credits list: every source cited, in the order of first use. A
  // signed-out follower's deck fills in as slides arrive, so it can run
  // again; it only replaces a list it made itself.
  const fillCredits = () => {
    const cited = [];
    slides.forEach((slide) => othersCitedBy(slide).forEach((id) => cited.includes(id) || cited.push(id)));
    slides.filter((s) => s.classList.contains("credits-slide")).forEach((slide) => {
      const made = slide.querySelector(".credits[data-dk-credits]");
      if (slide.querySelector(".credits") && !made) return;
      made?.remove();
      const list = document.createElement("ol");
      list.className = "credits";
      list.dataset.dkCredits = "";
      for (const id of cited) {
        const li = document.createElement("li");
        li.textContent = creditOf(id);
        const from = credits[id].from;
        if (/^https?:\/\//.test(from)) {
          const a = document.createElement("a");
          a.href = from;
          a.textContent = from.replace(/^https?:\/\//, "").replace(/\/$/, "");
          li.append(" ", a);
        }
        list.appendChild(li);
      }
      (slide.querySelector("[data-credits]") || slide).appendChild(list);
    });
  };
  fillCredits();

  // A short name for a slide: its headline, or failing that its big
  // line (walls, dividers, anchors), or its footer. Line breaks count
  // as spaces.
  const titleOf = (slide) => {
    const el =
      slide.querySelector(".headline, h1, h2, .wp-slam, .divider-title, .anchor-line") ||
      slide.querySelector(".corner-tag");
    if (!el) return "";
    const copy = el.cloneNode(true);
    copy.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
    return copy.textContent.trim().replace(/\s+/g, " ");
  };

  // The overview captions each tile with its number and name.
  const labelTile = (slide, i) => {
    tileOf(slide).dataset.label = `${i + 1} \u00b7 ${titleOf(slide)}`;
  };
  slides.forEach(labelTile);

  let current = -1;
  let notesOpen = false;
  let overview = false;

  // "?presenter" in the URL: this window is the presenter view (see
  // "presenter window" below), driving the audience window that opened it.
  // Never for a signed-out follower's deck (window.DECK_ANON), which has
  // no slides of its own to present.
  const presenterMode = new URLSearchParams(location.search).has("presenter") && !window.DECK_ANON;

  // A copy on this machine (file:// or a local server), as opposed to the
  // hosted deck that anyone can open.
  const localPage = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  // A follower (the live page, on someone's phone) only moves and looks
  // back: no shortcut keys and no presenter buttons (see "following" below).
  const following = !presenterMode && !!(window.DECK_FOLLOW || new URLSearchParams(location.search).get("follow"));
  if (following) document.body.classList.add("dk-following");

  // Called after anything that moves the deck; the presenter-window sync
  // replaces it once it is set up.
  let changed = () => {};

  // Events for theme and talk scripts (THEMES.md, "Scripts"):
  // deck:slide when the current slide changes, deck:phase when its
  // step does (arriving on a slide included). Sent a moment later and
  // only for what actually changed, so measuring a slide off screen
  // (probe, for the lint) never sends one.
  let announced = { index: -1, phase: 0 };
  let announceQueued = false;
  const announce = () => {
    if (announceQueued) return;
    announceQueued = true;
    queueMicrotask(() => {
      announceQueued = false;
      if (current < 0) return;
      const slide = slides[current];
      const phase = phaseOf(slide);
      const from = announced.index;
      if (current !== from) {
        const dir = from < 0 || current > from ? "fwd" : "back";
        document.dispatchEvent(new CustomEvent("deck:slide", { detail: { index: current, from, slide, dir } }));
      }
      if (current !== from || phase !== announced.phase) {
        document.dispatchEvent(new CustomEvent("deck:phase", { detail: { index: current, slide, phase, phases: phasesOf(slide) } }));
      }
      announced = { index: current, phase };
    });
  };
  // A follower moving on their own stops following (see follow-along).
  let detachFollow = () => {};
  // A follower's move to (slide, phase): true when it was held back at the
  // live slide (see follow-along), so the move does not happen.
  let followGate: (slide: number, phase: number) => boolean = () => false;

  /* ---------- shared: what a talk's scripts keep in step ----------
   * deck.share(key, value) keeps a small JSON value the same in every
   * view of the talk: the other window (slides or presenter) and, while
   * live, the phones following. null clears it. With { slide: true } the
   * value belongs to the current slide: a slide change clears it in
   * every view, with no "shared" event (each hears its own deck:slide).
   * The other views hear a change as a "shared" event, { key, value },
   * after any slide change that came with it; the view that shared it
   * does not. deck.shared(key) reads one (null when unset). A phone takes
   * the speaker's values while it follows, and only as they change, so
   * someone looking around on their own keeps their view until the
   * speaker moves; coming back to the live slide brings the speaker's
   * values back. Each entry is { v, s }: the value, and its slide. */
  type Shared = { v: unknown; s?: number };
  const SHARED_MAX = 4000; // bytes; the server takes 4096 (server/live.go)
  let shared: Record<string, Shared> = {};
  let sharesHeld: any[] | null = null; // window messages that came while a move was running
  const entryJson = (e) => (e ? JSON.stringify(e) : "null");
  const validEntry = (e): e is Shared =>
    !!e && typeof e === "object" && "v" in e && e.v != null && (e.s == null || Number.isInteger(e.s));
  // An entry for another slide is stale (a slide change crossed it).
  const liveEntry = (e) => (validEntry(e) && (e.s == null || e.s === current) ? e : null);
  // Tell the scripts, after the deck:slide of any slide change that came
  // with it (those are sent from a microtask too, queued first).
  const tellShared = (keys: string[]) =>
    queueMicrotask(() => {
      for (const key of keys) document.dispatchEvent(new CustomEvent("deck:shared", { detail: { key, value: shared[key]?.v ?? null } }));
    });

  const share = (key: string, value: unknown, { slide = false } = {}) => {
    if (typeof key !== "string" || !key) return false;
    let entry: Shared | null = null;
    if (value != null) {
      try {
        const json = JSON.stringify(value);
        if (json === undefined) return false;
        entry = slide ? { v: JSON.parse(json), s: current } : { v: JSON.parse(json) };
      } catch {
        return false;
      }
    }
    if (entryJson(entry) === entryJson(shared[key])) return true;
    const next = { ...shared };
    if (entry) next[key] = entry;
    else delete next[key];
    if (new TextEncoder().encode(JSON.stringify(next)).length > SHARED_MAX) {
      console.warn(`deck.share("${key}"): over ${SHARED_MAX} bytes shared in all, so not shared`);
      return false;
    }
    shared = next;
    post({ type: "share", key, entry });
    lead();
    return true;
  };
  const sharedValue = (key: string) => liveEntry(shared[key])?.v ?? null;
  // What goes to the server. share() keeps each window under the cap, but
  // the two windows' values merged can pass it; the server would refuse
  // the whole post (slide, laser and all), so then phones get none.
  let sharedOverWarned = false;
  const sharedForServer = () => {
    if (new TextEncoder().encode(JSON.stringify(shared)).length <= SHARED_MAX) return shared;
    if (!sharedOverWarned) console.warn(`deck.share: over ${SHARED_MAX} bytes shared in all, so phones get none of it`);
    sharedOverWarned = true;
    return {};
  };

  // Take what another view shares: next replaces the values here, and the
  // scripts hear of each that differs from base (the values here, or for
  // a phone the speaker's last) and from what is here now.
  const adoptShared = (next, base: Record<string, unknown> = shared) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) next = {};
    const changed: string[] = [];
    for (const key of new Set([...Object.keys(next), ...Object.keys(base)])) {
      if (entryJson(next[key]) === entryJson(base[key])) continue;
      // For another slide: stale (it crossed a slide change), so it neither
      // sets nor clears what is here.
      if (validEntry(next[key]) && !liveEntry(next[key])) continue;
      const e = liveEntry(next[key]);
      if (entryJson(e) === entryJson(shared[key])) continue;
      if (e) shared[key] = { ...e };
      else delete shared[key];
      changed.push(key);
    }
    if (!changed.length) return;
    tellShared(changed);
    lead(); // the slides window passes a change from the presenter on to phones
  };
  // The other window's one change.
  const takeShare = (m) => {
    if (busy) return void (sharesHeld ||= []).push(m);
    adoptShared({ ...shared, [m.key]: m.entry }, shared);
  };
  // A slide change drops the values that belonged to the old slide.
  const dropSlideShared = () => {
    for (const [key, e] of Object.entries(shared)) if (e.s != null && e.s !== current) delete shared[key];
  };

  /* ---------- phases ---------- */

  const phasesOf = (slide) => {
    const n = parseInt(slide.dataset.phases || "1", 10);
    return Number.isFinite(n) && n > 1 ? n : 1;
  };

  const phaseOf = (slide) => {
    const n = parseInt(slide.dataset.phase || "1", 10);
    return Number.isFinite(n) && n > 1 ? n : 1;
  };

  const setPhase = (slide, p) => {
    if (phasesOf(slide) > 1) slide.dataset.phase = String(p);
  };

  /* ---------- builds: data-build elements become extra phases ---------- */

  const buildsOf = new Map();
  const prepareBuilds = (slide: HTMLElement) => {
    if (slide.dataset.phases) return;
    const els = Array.from(slide.querySelectorAll<HTMLElement>("[data-build]"));
    if (els.length === 0) return;
    let auto = 0;
    const steps = els.map((el) => {
      const n = parseInt(el.dataset.build, 10);
      auto = Number.isFinite(n) && n > 0 ? n : auto + 1;
      return { el, step: auto };
    });
    buildsOf.set(slide, steps);
    slide.dataset.phases = String(Math.max(...steps.map((s) => s.step)) + 1);
  };
  slides.forEach(prepareBuilds);

  const applyBuilds = (slide) => {
    const steps = buildsOf.get(slide);
    if (!steps) return;
    const shown = phaseOf(slide) - 1;
    steps.forEach(({ el, step }) => el.classList.toggle("dk-built", step <= shown));
  };

  const _setPhase = setPhase;
  const setPhaseAndBuild = (slide, p) => {
    _setPhase(slide, p);
    applyBuilds(slide);
    changed();
    announce();
  };

  // Every phased slide starts at phase 1 so initial CSS states apply.
  slides.forEach((s) => setPhaseAndBuild(s, 1));

  /* ---------- timing ----------
   * How long each slide takes, in seconds. data-time on the slide
   * ("45s", "1:30", "2m") wins. Otherwise it is the words in its notes
   * at 140 a minute, plus 2s per build step, and at least 10s. When the
   * notes quote what you will say ("..."), only the quoted words count,
   * so stage directions and shot lists do not. */

  const WPM = 140;

  const parseTime = (t) => {
    if (!t) return null;
    const m = String(t).trim().match(/^(?:(\d+):(\d{1,2})|(\d+(?:\.\d+)?)\s*(s|m|min)?)$/);
    if (!m) return null;
    if (m[1]) return Number(m[1]) * 60 + Number(m[2]);
    return Math.round(Number(m[3]) * (m[4] && m[4] !== "s" ? 60 : 1));
  };

  const fmtTime = (sec) => {
    sec = Math.round(Math.abs(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  const estimate = (slide) => {
    const set = parseTime(slide.dataset.time);
    if (set != null) return set;
    const notes = slide.querySelector(".notes")?.textContent || "";
    const quoted = notes.match(/["\u201c][^"\u201d]+["\u201d]/g);
    const words = ((quoted ? quoted.join(" ") : notes).match(/\S+/g) || []).length;
    return Math.max(10, Math.round((words / WPM) * 60 + 2 * (phasesOf(slide) - 1)));
  };

  /* ---------- all-at-once mode ("b") ---------- */

  const BUILDS_KEY = "deck-builds";
  let buildsOff = false;
  try {
    buildsOff = localStorage.getItem(BUILDS_KEY) === "off";
  } catch {}

  const toast = document.createElement("div");
  toast.className = "dk-toast";
  document.body.appendChild(toast);
  let toastTimer = 0;
  const flash = (text, ms = 1400) => {
    toast.textContent = text;
    toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("on"), ms);
  };

  /* ---------- chrome the engine owns: counter + notes panel ---------- */

  // The counter doubles as a "go to slide" field: click it or type digits.
  const counter = document.createElement("div");
  counter.className = "dk-counter";
  const gotoInput = document.createElement("input");
  gotoInput.className = "dk-goto";
  gotoInput.type = "text";
  gotoInput.inputMode = "numeric";
  gotoInput.autocomplete = "off";
  gotoInput.spellcheck = false;
  gotoInput.setAttribute("aria-label", "Go to slide");
  gotoInput.style.width = `${String(slides.length).length + 0.6}ch`;
  const total = document.createElement("span");
  total.className = "dk-total";
  total.textContent = ` / ${slides.length}`;
  counter.append(gotoInput, total);
  document.body.appendChild(counter);

  const notesPanel = document.createElement("aside");
  notesPanel.className = "dk-notes";
  notesPanel.hidden = true;
  document.body.appendChild(notesPanel);

  const renderNotes = () => {
    const src = slides[current].querySelector(".notes");
    notesPanel.innerHTML = src
      ? src.innerHTML
      : "<p><em>No notes for this slide.</em></p>";
    notesPanel.scrollTop = 0;
  };

  const toggleNotes = () => {
    notesOpen = !notesOpen;
    notesPanel.hidden = !notesOpen;
    if (notesOpen) renderNotes();
  };

  /* ---------- media ---------- */

  const syncMedia = () => {
    slides.forEach((slide, i) => {
      slide.querySelectorAll("video").forEach((v) => {
        if (i === current && v.hasAttribute("data-autoplay")) {
          v.currentTime = 0;
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      });
    });
  };

  /* ---------- demo safety ----------
   * "v" blows the current slide's video (the fallback clip on a demo
   * slide) up to fill the slide and plays it from the start; "v" again,
   * or leaving the slide, puts it back.
   *
   * A slide with data-demo="http://localhost:8080/" names the server its
   * live demo needs. Arriving on that slide, or on the one before it,
   * checks the server answers. The presenter window shows the result in
   * its bar; without one, the audience screen warns once per server
   * until it comes back. "d" checks every demo slide at once. */

  let clipFull = null;

  const setClipFull = (on) => {
    const slide = slides[current];
    const video = on ? slide.querySelector("video") : clipFull;
    if (on && !video) return flash("No clip on this slide");
    const swap = () => {
      if (on) {
        clipFull = video;
        video.parentElement.classList.add("dk-clip-target");
        slide.classList.add("dk-clip-full");
        video.currentTime = 0;
        video.play().catch(() => {});
      } else if (clipFull) {
        clipFull.parentElement.classList.remove("dk-clip-target");
        clipFull.closest(".slide").classList.remove("dk-clip-full");
        clipFull = null;
      }
      changed();
    };
    if (!canAnimate()) return swap();
    video.parentElement.style.viewTransitionName = "dk-clip";
    const vt = document.startViewTransition(swap);
    vt.ready.catch(() => {});
    vt.finished.finally(() => (video.parentElement.style.viewTransitionName = ""));
  };

  // Resolves true when anything answers at url. An opaque no-cors
  // response is enough: only a refused connection or a timeout fails.
  const answers = async (url) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctl.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const demoStatus = new Map(); // url -> true | false
  const hostOf = (url) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Servers already warned about, kept for the session so the dev
  // server's reloads do not repeat the warning.
  const WARNED_KEY = "deck-demo-warned";
  let warnedDown = new Set();
  try {
    warnedDown = new Set(JSON.parse(sessionStorage.getItem(WARNED_KEY) || "[]"));
  } catch {}
  const setWarned = (url, on) => {
    if (on) warnedDown.add(url);
    else warnedDown.delete(url);
    try {
      sessionStorage.setItem(WARNED_KEY, JSON.stringify([...warnedDown]));
    } catch {}
  };

  const checkDemo = async (slide, warn) => {
    const url = slide.dataset.demo;
    if (!url) return;
    const ok = await answers(url);
    demoStatus.set(url, ok);
    if (ok && warnedDown.has(url)) setWarned(url, false);
    if (ok || !warn || presenterMode || peer || warnedDown.has(url)) return;
    setWarned(url, true);
    flash(`Demo server not answering at ${hostOf(url)}`, 4000);
  };

  const checkAllDemos = async () => {
    const demos = slides.filter((s) => s.dataset.demo);
    if (!demos.length) return flash("No slide names a demo server (data-demo)");
    const urls = [...new Set(demos.map((s) => s.dataset.demo))];
    const results = await Promise.all(urls.map(async (u) => [u, await answers(u)]));
    results.forEach(([u, ok]) => demoStatus.set(u, ok));
    const down = results.filter(([, ok]) => !ok).map(([u]) => hostOf(u));
    const all = urls.length === 1 ? "Demo server answering" : `All ${urls.length} demo servers answering`;
    flash(down.length ? `Not answering: ${down.join(", ")}` : all, 4000);
  };

  /* ---------- theme ---------- */

  const THEME_KEY = "deck-theme";
  const root = document.documentElement;

  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {}

  // Which mode is showing: a theme's default can be either (house starts
  // dark, paper light), so read the slide background, --paper, rather than
  // data-theme. Kept on <html> as data-dk-mode for the button's icon.
  const modeProbe = document.createElement("i");
  modeProbe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;background:var(--paper, #fff)";
  const modeNow = (): "light" | "dark" => {
    if (!modeProbe.isConnected) document.body.appendChild(modeProbe);
    const m = getComputedStyle(modeProbe).backgroundColor.match(/[\d.]+/g);
    if (!m || m.length < 3) return root.dataset.theme === "light" ? "light" : "dark";
    const [r, g, b] = m.slice(0, 3).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "light" : "dark";
  };
  let themeButton: HTMLButtonElement | null = null;
  const syncMode = () => {
    const mode = modeNow();
    root.dataset.dkMode = mode;
    if (themeButton) {
      const label = `Switch to ${mode === "dark" ? "light" : "dark"} (t)`;
      themeButton.title = label;
      themeButton.setAttribute("aria-label", label);
    }
  };

  // To dark, the dark deck grows as a circle out of the theme button over
  // a snapshot of the light one; to light, the dark snapshot shrinks back
  // into it. One symmetric curve both ways. --dk-reveal-x/y let engine.css
  // hide the growing circle from its first frame, before the animation
  // attaches. Without view transitions, or with reduced motion, it just
  // switches.
  let themeRun = null; // the latest switch; a quick second press skips the first
  const toggleTheme = () => {
    const t = modeNow() === "light" ? "dark" : "light";
    const apply = () => {
      root.dataset.theme = t;
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {}
      syncMode();
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => any };
    if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) return apply();
    const r = themeButton?.getBoundingClientRect();
    const x = r && r.width ? r.left + r.width / 2 : innerWidth - 24;
    const y = r && r.height ? r.top + r.height / 2 : 24;
    const toDark = t === "dark";
    root.style.setProperty("--dk-reveal-x", `${x}px`);
    root.style.setProperty("--dk-reveal-y", `${y}px`);
    root.classList.add("dk-theme-vt");
    root.classList.toggle("dk-theme-unreveal", !toDark);
    const vt = (themeRun = doc.startViewTransition(apply));
    let circle = null;
    vt.ready.then(
      () => {
        const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        const small = `circle(0px at ${x}px ${y}px)`;
        const big = `circle(${end}px at ${x}px ${y}px)`;
        circle = root.animate(
          { clipPath: toDark ? [small, big] : [big, small] },
          {
            duration: 650,
            easing: "cubic-bezier(.65,0,.35,1)",
            fill: "forwards",
            pseudoElement: toDark ? "::view-transition-new(root)" : "::view-transition-old(root)",
          },
        );
      },
      () => {},
    );
    // The circle holds its end until the transition is over, then goes:
    // left on <html>, it would clip the next transition's snapshots too.
    vt.finished.finally(() => {
      circle?.cancel();
      if (themeRun !== vt) return;
      root.classList.remove("dk-theme-vt", "dk-theme-unreveal");
      root.style.removeProperty("--dk-reveal-x");
      root.style.removeProperty("--dk-reveal-y");
    });
  };

  /* ---------- full screen ----------
   * "f" or a corner button. The button appears when the mouse moves and
   * fades after a short idle, so it never shows while presenting with
   * the keyboard. */

  const canFullscreen = !!document.documentElement.requestFullscreen;
  const fsButton = document.createElement("button");
  fsButton.className = "dk-fs";
  fsButton.type = "button";
  fsButton.hidden = !canFullscreen;
  const FS_ENTER =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const FS_EXIT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  const syncFsButton = () => {
    const on = !!document.fullscreenElement;
    fsButton.innerHTML = on ? FS_EXIT : FS_ENTER;
    const label = on ? "Exit full screen (f)" : "Full screen (f)";
    fsButton.title = label;
    fsButton.setAttribute("aria-label", label);
  };
  syncFsButton();
  document.body.appendChild(fsButton);

  /* ---------- key help ("?") ----------
   * A small, dim panel with every key, out of the slide's way in the
   * bottom-left corner. Keys keep working while it is open, so you can
   * try them; "?" or Esc closes it. A "?" button sits beside the
   * full-screen button and shows on mouse move the same way. */

  const HELP: [string, string[][]][] = [
    ["Move", [
      ["\u2192 / Space", "next"],
      ["\u2190", "back"],
      ["\u21e7\u2192", "finish slide"],
      ["12 \u21b5", "go to slide"],
      ["Esc", "overview"],
    ]],
    ["Present", [
      ["p", "presenter window"],
      ["g", "go live (phones follow)"],
      ["s", "timer (presenter)"],
      ["f", "full screen"],
      [". w", "black / white"],
      ["b", "builds off"],
      ["n", "notes here"],
      ["t", "light / dark"],
    ]],
    ["Point", [
      ["l", "laser"],
      ["drag", "draw (laser on)"],
      ["c", "clear drawing"],
      ["\u21e7l", "laser color"],
      ["e", "audience emojis"],
    ]],
    ["Check", [
      ["v", "clip full size"],
      ["d", "demo servers"],
      ["k", "clicker test"],
      // story.ts, which only the dev server loads.
      ...(window.DECK_DEV ? [["h", "headline readout"]] : []),
    ]],
  ];

  const help = document.createElement("aside");
  help.className = "dk-help";
  help.hidden = true;
  help.innerHTML =
    HELP.map(
      ([group, keys]) =>
        `<section><h3>${group}</h3>${keys.map(([k, what]) => `<kbd>${k}</kbd><span>${what}</span>`).join("")}</section>`,
    ).join("") + '<p class="dk-help-foot">? or Esc closes</p>';
  document.body.appendChild(help);

  const helpButton = document.createElement("button");
  helpButton.className = "dk-fs dk-help-btn";
  helpButton.type = "button";
  helpButton.textContent = "?";
  helpButton.title = "Keys (?)";
  helpButton.setAttribute("aria-label", "Show keys (?)");
  document.body.appendChild(helpButton);

  // Light and dark: a sun that turns into a moon, beside "?".
  themeButton = document.createElement("button");
  themeButton.className = "dk-fs dk-theme-btn";
  themeButton.type = "button";
  themeButton.innerHTML =
    '<svg class="dk-sunmoon" viewBox="0 0 24 24" aria-hidden="true"><mask id="dk-sm-mask"><rect x="0" y="0" width="24" height="24" fill="#fff"/><circle class="dk-sm-moon" cx="24" cy="10" r="6" fill="#000"/></mask><circle class="dk-sm-sun" cx="12" cy="12" r="6" mask="url(#dk-sm-mask)" fill="currentColor"/><g class="dk-sm-beams" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></g></svg>';
  document.body.appendChild(themeButton);
  themeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTheme();
    themeButton.blur();
  });
  syncMode();
  // The theme's fonts and styles can settle after start-up.
  addEventListener("load", syncMode);

  const toggleHelp = () => {
    help.hidden = !help.hidden;
  };
  helpButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHelp();
    helpButton.blur();
  });

  const toggleFullscreen = () => {
    if (!canFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else
      document.documentElement
        .requestFullscreen()
        .catch(() => flash("This browser blocked full screen"));
  };
  fsButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
    fsButton.blur();
  });
  document.addEventListener("fullscreenchange", syncFsButton);

  /* ---------- blank screen ----------
   * "." goes black and "w" or "," goes white, as in PowerPoint (where
   * "b" also blanks; here "b" stays the builds toggle). Any key brings
   * the slide back without also acting on it. */

  const blank = document.createElement("div");
  blank.className = "dk-blank";
  document.body.appendChild(blank);
  let blanked = "";

  const setBlank = (color) => {
    blanked = color;
    blank.dataset.color = color;
    blank.classList.toggle("on", !!color);
    changed();
  };

  /* ---------- clicker test ("k") ----------
   * Lists the keys a presentation clicker usually sends and lights each
   * one as it arrives, so a new clicker can be checked before the talk.
   * Any other key is named, so you learn what the clicker really sends. */

  const KEY_ROLES = [
    { role: "Next", keys: ["ArrowRight", "ArrowDown", "PageDown", " "] },
    { role: "Back", keys: ["ArrowLeft", "ArrowUp", "PageUp"] },
    { role: "Black screen", keys: ["."] },
    { role: "White screen", keys: ["w", "W", ","] },
    { role: "Full screen", keys: ["f", "F", "F5"] },
    { role: "Overview", keys: ["Escape"] },
  ];
  const keyName = (k) => ({ " ": "Space", Escape: "Esc" })[k] || k.replace(/^Arrow/, "");

  const keyTest = document.createElement("div");
  keyTest.className = "dk-keytest";
  keyTest.hidden = true;
  keyTest.innerHTML =
    '<div class="dk-keytest-head">Clicker test<span>press each button; k closes</span></div>' +
    KEY_ROLES.map(
      (r, i) =>
        `<div class="dk-keytest-row" data-row="${i}"><b>${r.role}</b><span>${[...new Set(r.keys.map(keyName))].join(" / ")}</span></div>`,
    ).join("") +
    '<div class="dk-keytest-last">Waiting for a key</div>';
  document.body.appendChild(keyTest);
  const keyTestLast = keyTest.querySelector(".dk-keytest-last");

  const toggleKeyTest = () => {
    keyTest.hidden = !keyTest.hidden;
    keyTest.querySelectorAll(".dk-keytest-row").forEach((r) => r.classList.remove("hit"));
    keyTestLast.textContent = "Waiting for a key";
  };

  const recordKeyTest = (e) => {
    const i = KEY_ROLES.findIndex((r) => r.keys.includes(e.key));
    if (i >= 0) keyTest.querySelector(`[data-row="${i}"]`).classList.add("hit");
    keyTestLast.textContent =
      `Last key: ${keyName(e.key)} (${e.code || "no code"})` + (i >= 0 ? ` = ${KEY_ROLES[i].role}` : " is not bound");
  };

  let idleTimer = 0;
  document.addEventListener("mousemove", () => {
    document.body.classList.add("dk-mouse");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.remove("dk-mouse"), 2000);
  });

  /* ---------- navigation ---------- */

  // Magic move: name the parts of a slide that should be captured on
  // their own for the slide-to-slide View Transition (see engine.css).
  const morphNames = (slide, on) => {
    const set = (el, name, cls = "") => {
      if (!el) return;
      if (on) {
        el.style.viewTransitionName = name;
        el.style.viewTransitionClass = cls;
      } else if (el.style.viewTransitionName === name) {
        // Only clear our own name: a zoom may have renamed it meanwhile.
        el.style.viewTransitionName = "";
        el.style.viewTransitionClass = "";
      }
    };
    set(slide, "dk-body");
    // What holds still while the slide changes: the theme's --dk-hold
    // ("headline footer" by default; "none" moves the whole slide).
    const hold = getComputedStyle(root).getPropertyValue("--dk-hold").trim() || "headline footer";
    if (hold.includes("headline")) set(slide.querySelector(":scope > .headline"), "dk-headline");
    if (hold.includes("footer")) set(slide.querySelector(":scope > .corner-tag"), "dk-footer");
    slide.querySelectorAll("[data-morph]").forEach((el) => set(el, `dk-m-${el.dataset.morph}`, "dk-morph"));
  };

  let moveToken = 0;

  const goTo = (n, { atLastPhase = false } = {}) => {
    n = Math.max(0, Math.min(slides.length - 1, n));
    const from = current;
    const zooming = document.body.classList.contains("dk-zooming");
    const animate =
      from >= 0 &&
      n !== from &&
      !zooming &&
      !overview &&
      typeof document.startViewTransition === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;

    // State moves now, so rapid key presses chain from the right slide;
    // only the visible swap waits for the transition's DOM update. The
    // incoming slide is still hidden here, so setting its phase is safe.
    if (n !== from) clearInk(false);
    if (clipFull && n !== from) {
      // Leaving a slide puts its blown-up clip back, without a morph.
      clipFull.parentElement.classList.remove("dk-clip-target");
      clipFull.closest(".slide").classList.remove("dk-clip-full");
      clipFull = null;
    }
    current = n;
    if (n !== from) dropSlideShared();
    if (n !== from && localPage && !presenterMode && !document.body.classList.contains("dk-following")) {
      // Warn about a demo server on the demo slide, or one slide ahead.
      // Only on a copy you present from (file:// or localhost): a visitor
      // flipping through the hosted deck has no demo server, and the
      // presenter window shows the hosted deck's demo status itself.
      if (slides[n].dataset.demo) checkDemo(slides[n], true);
      else if (slides[n + 1]?.dataset.demo) checkDemo(slides[n + 1], true);
    }
    setPhaseAndBuild(slides[n], atLastPhase || buildsOff ? phasesOf(slides[n]) : 1);
    history.replaceState(null, "", "#" + (n + 1));
    if (document.activeElement !== gotoInput) gotoInput.value = String(n + 1);
    if (notesOpen) renderNotes();
    changed();
    announce();

    if (!animate) {
      show(from, n, from >= 0 && !zooming);
      return;
    }
    const token = ++moveToken;
    root.dataset.dkDir = n > from ? "fwd" : "back";
    root.dataset.dkKind = slides[n].classList.contains("divider") ? "divider" : "slide";
    morphNames(slides[from], true);
    const vt = document.startViewTransition(() => {
      morphNames(slides[from], false);
      show(from, n, false);
      morphNames(slides[n], true);
    });
    // A newer transition skips this one; that is expected, not an error.
    vt.ready.catch(() => {});
    vt.finished.finally(() => {
      morphNames(slides[n], false);
      if (token === moveToken) {
        delete root.dataset.dkDir;
        delete root.dataset.dkKind;
      }
    });
  };

  // The visible half of goTo. `fade` adds the plain slide-change fade,
  // used when the magic move is unavailable (old browser, reduced motion).
  const show = (from, n, fade) => {
    if (from >= 0 && from !== n) slides[from].classList.remove("current", "dk-enter");
    slides[n].classList.add("current");
    if (fade) slides[n].classList.add("dk-enter");
    syncMedia();
    // Ink that arrived while the slide was still hidden (a follower
    // joining, or the presenter drawing mid-move) drew at zero size.
    redraw();
  };

  // Where a move lands: [slide, phase].
  const landing = (n): [number, number] => [n, buildsOff ? phasesOf(slides[n]) : 1];

  const next = () => {
    const slide = slides[current];
    const p = phaseOf(slide);
    if (p < phasesOf(slide)) {
      if (!followGate(current, p + 1)) setPhaseAndBuild(slide, p + 1);
    } else if (current < slides.length - 1 && !followGate(...landing(current + 1))) goTo(current + 1);
  };

  const prev = () => {
    const slide = slides[current];
    const p = phaseOf(slide);
    if (p > 1 && !buildsOff) setPhaseAndBuild(slide, p - 1);
    else if (current > 0) goTo(current - 1, { atLastPhase: true });
  };

  // Shift+advance: show the rest of this slide at once, or move on.
  const finish = () => {
    const slide = slides[current];
    if (phaseOf(slide) < phasesOf(slide)) {
      if (!followGate(current, phasesOf(slide))) setPhaseAndBuild(slide, phasesOf(slide));
    } else if (current < slides.length - 1 && !followGate(...landing(current + 1))) goTo(current + 1);
  };

  const toggleBuilds = () => {
    buildsOff = !buildsOff;
    try {
      localStorage.setItem(BUILDS_KEY, buildsOff ? "off" : "on");
    } catch {}
    if (buildsOff) setPhaseAndBuild(slides[current], phasesOf(slides[current]));
    flash(buildsOff ? "Builds off: slides arrive complete" : "Builds on: content appears step by step");
  };

  /* ---------- overview grid, with a zoom in and out ----------
   * The zoom is a View Transition: the slide being left (or entered)
   * carries view-transition-name "dk-active" on both sides of the DOM
   * change, so the browser morphs it between full size and its tile.
   * Browsers without View Transitions, or with reduced motion, switch
   * instantly. */

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let busy = false;
  let sel = 0;

  const canAnimate = () =>
    typeof document.startViewTransition === "function" &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Name the one slide that morphs, and hold its build state (see
  // .dk-hold in engine.css) so tile and full slide match.
  const nameOnly = (el) => {
    slides.forEach((s) => {
      s.style.viewTransitionName = "";
      s.classList.remove("dk-hold");
    });
    if (el) {
      el.style.viewTransitionName = "dk-active";
      el.classList.add("dk-hold");
    }
  };

  const transition = (change) => {
    if (!canAnimate()) {
      change();
      document.body.classList.remove("dk-zooming");
      nameOnly(null);
      return Promise.resolve();
    }
    document.body.classList.add("dk-zooming");
    const vt = document.startViewTransition(change);
    vt.ready.catch(() => {});
    return vt.finished.finally(() => {
      document.body.classList.remove("dk-zooming");
      nameOnly(null);
    });
  };

  const select = (i, smooth = false) => {
    sel = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, j) => s.classList.toggle("dk-selected", j === sel));
    tileOf(slides[sel]).scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  };

  const openOverview = () => {
    if (overview) return Promise.resolve();
    nameOnly(slides[current]);
    return transition(() => {
      overview = true;
      // Drop the slide-change fade, or leaving the grid would replay it.
      slides.forEach((s) => s.classList.remove("dk-enter"));
      document.body.classList.add("dk-overview");
      select(current);
    });
  };

  const closeOverview = (i = sel) => {
    if (!overview) return Promise.resolve();
    // Put the tile in the state the slide will open in before the
    // "old" snapshot is taken, so nothing appears or vanishes mid-zoom.
    document.body.classList.add("dk-zooming");
    if (i !== current) setPhaseAndBuild(slides[i], buildsOff ? phasesOf(slides[i]) : 1);
    nameOnly(slides[i]);
    return transition(() => {
      overview = false;
      document.body.classList.remove("dk-overview");
      slides.forEach((s) => s.classList.remove("dk-selected"));
      if (i === current) {
        // Back to where we were: keep the slide's build state.
        slides[i].classList.add("current");
      } else {
        goTo(i);
      }
    });
  };

  // Tiles per row in the grid, read from the layout.
  const columns = () => {
    const top = tileOf(slides[0]).offsetTop;
    const n = slides.filter((s) => tileOf(s).offsetTop === top).length;
    return Math.max(1, n);
  };

  const run = async (job) => {
    if (busy) return;
    busy = true;
    try {
      await job();
    } finally {
      busy = false;
      afterBusy();
    }
  };

  // A move that arrived from the other window while busy waits here.
  let afterBusy = () => {};
  // Set by jumpTo, so the other window zooms to the slide too.
  let jumpNext = false;

  // Jump with context: zoom out, show where we are going, zoom in.
  const jumpTo = (n) =>
    run(async () => {
      n = Math.max(0, Math.min(slides.length - 1, n));
      if (followGate(...landing(n))) return;
      jumpNext = true;
      if (overview) {
        select(n, true);
        await wait(300);
        return closeOverview(n);
      }
      if (n === current) return;
      if (!canAnimate() || presenterMode) return goTo(n);
      await openOverview();
      await wait(200);
      select(n, true);
      await wait(550);
      await closeOverview(n);
    });

  slides.forEach((slide, i) => {
    slide.addEventListener("click", () => {
      if (overview) run(() => closeOverview(i));
    });
  });

  /* ---------- the "go to slide" field ---------- */

  gotoInput.addEventListener("focus", () => gotoInput.select());
  gotoInput.addEventListener("blur", () => {
    gotoInput.value = String(current + 1);
  });
  gotoInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const n = parseInt(gotoInput.value, 10);
      gotoInput.blur();
      if (Number.isFinite(n)) {
        detachFollow();
        jumpTo(n - 1);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      gotoInput.blur();
    } else if (e.key.length === 1 && !/[0-9]/.test(e.key)) {
      e.preventDefault();
    }
  });

  /* ---------- hash routing ---------- */

  const slideFromHash = () => {
    const m = location.hash.match(/^#(\d+)$/);
    if (!m) return 0;
    return Math.max(0, Math.min(slides.length - 1, parseInt(m[1], 10) - 1));
  };

  // replaceState (used by goTo) does not fire hashchange, so this
  // only reacts to hashes the user edits by hand.
  window.addEventListener("hashchange", () => {
    const n = slideFromHash();
    if (n !== current && !followGate(...landing(n))) goTo(n);
  });

  /* ---------- keyboard ---------- */

  const MOVE_KEYS = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "PageUp", "PageDown", " ", "Home", "End", "Escape"];

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (following && (!MOVE_KEYS.includes(e.key) || e.key === "Escape")) return;
    if (MOVE_KEYS.includes(e.key) || /^[0-9]$/.test(e.key)) detachFollow();

    if (e.key === "?") {
      e.preventDefault();
      toggleHelp();
      return;
    }
    if (e.key === "Escape" && !help.hidden) {
      help.hidden = true;
      return;
    }

    // The clicker test swallows every key except its own toggle.
    if (!keyTest.hidden) {
      e.preventDefault();
      if (e.key === "k" || e.key === "K") toggleKeyTest();
      else recordKeyTest(e);
      return;
    }

    // A blanked screen comes back on any key, which does nothing else.
    if (blanked) {
      e.preventDefault();
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) setBlank("");
      return;
    }

    if (busy) {
      e.preventDefault();
      return;
    }

    // Typing a number starts the "go to slide" field.
    if (/^[0-9]$/.test(e.key) && !overview) {
      e.preventDefault();
      gotoInput.focus();
      gotoInput.value = e.key;
      gotoInput.setSelectionRange(1, 1);
      return;
    }

    if (overview) {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() }[e.key];
      if (step) {
        e.preventDefault();
        select(sel + step, true);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        run(() => closeOverview(sel));
      } else if (e.key === "Escape") {
        run(() => closeOverview(current));
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        select(e.key === "Home" ? 0 : slides.length - 1, true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
        e.preventDefault();
        if (e.shiftKey) finish();
        else next();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        e.preventDefault();
        prev();
        break;
      case "Home":
        e.preventDefault();
        jumpTo(0);
        break;
      case "End":
        e.preventDefault();
        jumpTo(slides.length - 1);
        break;
      case "n":
      case "N":
        toggleNotes();
        break;
      case "b":
      case "B":
        toggleBuilds();
        break;
      case "t":
      case "T":
        toggleTheme();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "F5":
        // Clickers' "start" button. Never let it reload the deck.
        e.preventDefault();
        if (!document.fullscreenElement) toggleFullscreen();
        break;
      case ".":
        setBlank("black");
        break;
      case "w":
      case "W":
      case ",":
        setBlank("white");
        break;
      case "k":
      case "K":
        toggleKeyTest();
        break;
      case "l":
      case "L":
        if (e.shiftKey) cycleLaserColor();
        else toggleLaser();
        break;
      case "c":
      case "C":
        clearInk(true);
        break;
      case "e":
      case "E":
        toggleReactions();
        break;
      case "g":
      case "G":
        // Not typed into the key box, when this opens it.
        e.preventDefault();
        toggleLive();
        break;
      case "v":
      case "V":
        setClipFull(!clipFull);
        break;
      case "d":
      case "D":
        checkAllDemos();
        break;
      case "p":
      case "P":
        if (!presenterMode) openPresenter();
        break;
      case "s":
      case "S":
        toggleTimer();
        break;
      case "Escape":
        // The presenter window has no overview; jump by number there.
        if (!presenterMode) run(openOverview);
        break;
    }
  });

  /* ---------- state, for the dev server's reload and the presenter ----------
   * state() says where the deck is; apply() puts it there. With
   * instant, builds snap instead of fading in. */

  const state = () => ({ slide: current, phase: phaseOf(slides[current]), blank: blanked, clip: !!clipFull });

  const apply = (s, { instant = false } = {}) => {
    if (!s || !Number.isInteger(s.slide)) return;
    if (instant) document.body.classList.add("dk-instant");
    if (s.slide !== current) goTo(s.slide);
    if (Number.isInteger(s.phase)) setPhaseAndBuild(slides[current], Math.min(s.phase, phasesOf(slides[current])));
    if (typeof s.blank === "string" && s.blank !== blanked) setBlank(s.blank);
    if (typeof s.clip === "boolean" && s.clip !== !!clipFull) setClipFull(s.clip);
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("dk-instant")));
  };

  // Run fn(slide) with slide i laid out at its last build step, with
  // every transition off; a slide that is not current is laid out off
  // screen. Everything is put back before the browser paints. Used by
  // lint.ts to measure slides the presenter is not looking at.
  const probe = (i, fn) => {
    const slide = slides[i];
    const was = phaseOf(slide);
    slide.classList.add("dk-still");
    if (i !== current) slide.classList.add("dk-probe");
    setPhaseAndBuild(slide, phasesOf(slide));
    try {
      return fn(slide);
    } finally {
      setPhaseAndBuild(slide, was);
      slide.classList.remove("dk-probe");
      // Restore without fading back, then let transitions run again.
      void slide.offsetWidth;
      slide.classList.remove("dk-still");
    }
  };

  /* ---------- the plan: rehearsals and pacing ----------
   * A rehearsal run records the seconds you spent on each slide. Runs
   * are kept in this browser (localStorage) and, through the dev server,
   * in the deck's rehearsals.json, which the build inlines. A slide's
   * planned length is the median of its last three rehearsed times, or
   * its estimate. data-at="20:00" on a slide pins when you should reach
   * it, and data-duration="50:00" on .deck when you should finish; the
   * slides between pins share the time in proportion to their lengths. */

  const RUNS_KEY = `deck-rehearsals:${document.title}`;

  // Names that survive edits to the deck: data-id, else the headline.
  const slideKeys = (() => {
    const seen = new Map();
    return slides.map((s, i) => {
      const h = s.querySelector(".headline, h1, h2")?.cloneNode(true) as Element;
      h?.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
      const head = h?.textContent || "";
      const base = s.dataset.id || head.trim().replace(/\s+/g, " ").slice(0, 60) || `slide ${i + 1}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n > 1 ? `${base} (${n})` : base;
    });
  })();

  const loadRuns = () => {
    let all = [];
    try {
      all = JSON.parse(document.getElementById("dk-rehearsals")?.textContent || "{}").runs || [];
    } catch {}
    try {
      all = all.concat(JSON.parse(localStorage.getItem(RUNS_KEY) || "[]"));
    } catch {}
    const byDate = new Map(all.filter((r) => r && r.date && r.times).map((r) => [r.date, r]));
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  };
  let runs = loadRuns();

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const rehearsedLength = (i) => {
    const seen = runs
      .slice(-3)
      .map((r) => r.times[slideKeys[i]])
      .filter((x) => typeof x === "number" && x > 0);
    return seen.length ? median(seen) : null;
  };

  const lengthOf = (i) => rehearsedLength(i) ?? estimate(slides[i]);

  // When you should reach each slide, in seconds; [n] is the end.
  let planCache = null;
  const plan = () => {
    if (planCache) return planCache;
    const n = slides.length;
    const len = slides.map((_, i) => lengthOf(i));
    const pins = [[0, 0]];
    slides.forEach((s, i) => {
      const t = parseTime(s.dataset.at);
      if (i > 0 && t != null && t > pins.at(-1)[1]) pins.push([i, t]);
    });
    const end = parseTime(deck.dataset.duration);
    if (end != null && end > pins.at(-1)[1]) pins.push([n, end]);
    const start = new Array(n + 1).fill(0);
    pins.forEach(([a, ta], k) => {
      const pin = pins[k + 1];
      const b = pin ? pin[0] : n;
      const sum = len.slice(a, b).reduce((x, y) => x + y, 0) || 1;
      const scale = pin ? (pin[1] - ta) / sum : 1;
      let t = ta;
      for (let i = a; i < b; i++) {
        start[i] = t;
        t += len[i] * scale;
      }
      start[b] = pin ? pin[1] : t;
    });
    planCache = start;
    return start;
  };

  /* Time estimates in the overview (dev server only). */
  if (window.DECK_DEV) {
    document.body.classList.add("dk-dev");
    const start = plan();
    slides.forEach((slide, i) => {
      const tag = document.createElement("div");
      tag.className = "dk-time";
      const sure = slide.dataset.time || rehearsedLength(i) != null;
      tag.textContent = `${sure ? "" : "~"}${fmtTime(lengthOf(i))}`;
      slide.appendChild(tag);
    });
    const sum = document.createElement("div");
    sum.className = "dk-time-total";
    const from = runs.length ? `${runs.length} rehearsal${runs.length > 1 ? "s" : ""}, notes and data-time` : "notes and data-time";
    const total = slides.reduce((t, _, i) => t + lengthOf(i), 0);
    const planned = start[slides.length];
    sum.textContent =
      `${slides.length} slides, about ${Math.round(total / 60)} min (from ${from})` +
      (Math.abs(planned - total) > 30 ? `; planned ${fmtTime(planned)}` : "");
    document.body.appendChild(sum);
  }

  /* ---------- presenter window ----------
   * "p" opens this same deck with ?presenter in a second window: the
   * current slide, the next slide (or the next build step), the notes,
   * a timer and the clock. Drive the talk from either window; the other
   * follows. The two talk over a BroadcastChannel named for the deck, so
   * any slides window and presenter window of it in this browser find
   * each other however they were opened (a reopened tab included); from
   * file:// they use postMessage to the window that opened the other.
   * Whichever window loaded last takes the other's place in the talk, so
   * reloading either one is safe. */

  const born = Date.now();
  let presenterWin = null; // the window "p" opened (audience side)
  const myId = `${born}.${Math.random().toString(36).slice(2, 8)}`;
  const channel = (() => {
    if (following || location.protocol === "file:" || typeof BroadcastChannel !== "function") return null;
    try {
      return new BroadcastChannel(`deck:${location.pathname}`);
    } catch {
      return null;
    }
  })();
  // The slides window that opened this presenter window (?with=<its id>):
  // preferred over any other slides window of the deck in this browser.
  const opener = presenterMode ? new URLSearchParams(location.search).get("with") : null;
  const openerWait = Date.now() + 3000; // how long to wait for it before taking another
  let peer = null; // the other window once it has said hello: its id on the channel, else the window
  let peerBorn = 0;
  let peerSeen = 0;
  let lastSent = "";
  let applying = false;
  let queued = false;
  let pendingRemote = null;

  const envelope = (msg, to) => ({ deck: msg.type, born, id: myId, to, with: opener, role: presenterMode ? "presenter" : "audience", ...msg });
  const send = (win, m) => {
    if (channel) return channel.postMessage(m);
    try {
      win.postMessage(m, "*");
    } catch {
      if (win === peer) peer = null;
    }
  };
  const post = (msg) => {
    if (peer) send(peer, envelope(msg, channel ? peer : null));
  };
  // Hello to any window of this deck on the channel, else to one window.
  const greet = (win) => {
    if (channel || win) send(win, envelope({ type: "hello", state: state(), shared }, null));
  };

  const sync = () => {
    const jump = jumpNext;
    jumpNext = false;
    if (!peer || applying) return;
    const key = JSON.stringify(state());
    if (key === lastSent) return;
    lastSent = key;
    post({ type: "state", state: state(), jump });
  };

  changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sync();
      lead();
      if (presenterMode) renderPresenter();
    });
  };

  // Take a move from the other window (with its shared values, on a
  // hello or welcome). A jump zooms here too.
  const receive = (s, jump, sh = null) => {
    if (busy) {
      // A later plain move must not drop a held hello's or welcome's values.
      pendingRemote = [s, jump, sh ?? pendingRemote?.[2] ?? null];
      return;
    }
    applying = true;
    const done = () => {
      lastSent = JSON.stringify(state());
      applying = false;
      if (sh) adoptShared(sh);
      if (presenterMode) renderPresenter();
    };
    if (jump && s.slide !== current && !presenterMode && canAnimate()) {
      jumpTo(s.slide).then(() => {
        apply(s);
        done();
      });
    } else {
      if (overview) {
        overview = false;
        document.body.classList.remove("dk-overview");
        slides.forEach((x) => x.classList.remove("dk-selected"));
        slides[current].classList.add("current");
      }
      apply(s);
      done();
    }
  };

  afterBusy = () => {
    if (pendingRemote) {
      const [s, jump, sh] = pendingRemote;
      pendingRemote = null;
      receive(s, jump, sh);
    }
    const held = sharesHeld || [];
    sharesHeld = null;
    held.forEach(takeShare);
  };

  const onMessage = (m, source) => {
    if (!m || typeof m !== "object" || typeof m.deck !== "string") return;
    if (m.id === myId || (m.to && m.to !== myId)) return;
    // Presenter and slides windows talk to each other, not to their own kind.
    if ((m.role === "presenter") === presenterMode) return;
    const from = channel ? m.id : source;
    const connected = peer && Date.now() - peerSeen < 5000;
    const known = from === peer || (!channel && (source === window.opener || (presenterWin && source === presenterWin)));
    // A new other window: a slides window takes the newest presenter's
    // hello; a presenter window takes a slides window (its hello, or its
    // answer to ours) while it has none.
    const fresh = presenterMode
      ? (m.deck === "hello" || m.to === myId) &&
        ((m.id === opener && peer !== opener) || (!connected && (!opener || Date.now() > openerWait)))
      : m.deck === "hello" && (!connected || (m.born >= peerBorn && (!m.with || m.with === myId)));
    if (m.deck === "bye") {
      // The other window is closing or reloading: let go of it now.
      if (known) peer = null;
      return;
    }
    if (!known && !fresh) return;
    peer = from;
    peerBorn = m.born;
    peerSeen = Date.now();
    if (m.deck === "hello") {
      // A (re)connection: the window that loaded last adopts the other's
      // place; the older one says where it is.
      if (born > m.born && m.state) receive(m.state, false, m.shared || {});
      else {
        lastSent = "";
        post({ type: "welcome", state: state(), shared });
      }
      // Either way the presenter learns at once that this window is here,
      // and whether it is live.
      if (!presenterMode) livePong();
    } else if ((m.deck === "welcome" || m.deck === "state") && m.state) {
      receive(m.state, !!m.jump, m.deck === "welcome" ? m.shared || {} : null);
    } else if (m.deck === "share" && typeof m.key === "string") {
      takeShare(m);
    } else if (m.deck === "laser") {
      laserPoint(m.x, m.y);
    } else if (m.deck === "ink") {
      inkPoint(m.x, m.y, !!m.start);
    } else if (m.deck === "laser-color" && typeof m.color === "string") {
      setLaserColor(m.color, false);
    } else if (m.deck === "ink-clear") {
      clearInk(false);
    } else if (m.deck === "pong") {
      relay = { live: !!m.lead, followers: m.followers, error: m.liveError || "", can: !!m.canLead };
    } else if (m.deck === "react" && presenterMode) {
      showReactions(m.counts);
    } else if (m.deck === "go-live" && !presenterMode) {
      setLive(!!m.on);
      livePong();
    } else if (m.deck === "ping" && !presenterMode) {
      // The audience window answers pings, so the presenter can tell it
      // is there. They also keep the posts coming when this window is
      // hidden and its own timers are slowed: the server ends a talk that
      // goes quiet for 30s.
      livePong();
      if (isLive && Date.now() - lastPost > 8000) lead();
    }
  };
  if (channel) channel.addEventListener("message", (e) => onMessage(e.data, null));
  else window.addEventListener("message", (e) => onMessage(e.data, e.source));
  window.addEventListener("pagehide", () => post({ type: "bye" }));
  // A slides window that just loaded (a reload, say) says so at once.
  if (channel && !presenterMode && !following) setTimeout(() => greet(null), 0);

  // The presenter window's hello: on the channel, or to the window that
  // opened it.
  const presenterHello = () => {
    if (channel) return greet(null);
    if (!window.opener || window.opener.closed) return;
    peer = window.opener;
    greet(peer);
  };

  const openPresenter = () => {
    if (presenterWin && !presenterWin.closed) {
      presenterWin.focus();
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set("presenter", "");
    url.searchParams.set("with", myId);
    url.hash = String(current + 1);
    presenterWin = window.open(url.href.replace("presenter=", "presenter"), "deck-presenter", "popup,width=1400,height=860");
    if (!presenterWin) flash("The browser blocked the presenter window; allow pop-ups for this page");
  };

  // Without the channel, the slides window greets the presenter window it
  // opened too: a window the browser reused or restored has no opener.
  if (!presenterMode && !channel)
    setInterval(() => {
      if (!presenterWin || presenterWin.closed) return;
      if (peer === presenterWin && Date.now() - peerSeen < 2500) return;
      peer = presenterWin;
      greet(peer);
    }, 1000);

  /* The presenter view itself. */

  let renderPresenter = () => {};
  // The hosted deck has no speaker notes in it: the presenter window
  // fetches them with the key ("locked" until it has them).
  let notesState = "";
  let onNotesLoaded = () => {};
  let toggleTimer = () => {};

  if (presenterMode) {
    document.body.classList.add("dk-presenter");
    document.title = `Presenter: ${document.title}`;

    const pv = document.createElement("div");
    pv.className = "dk-pv";
    pv.innerHTML = `
      <header class="dk-pv-bar">
        <div class="dk-pv-timer">
          <span class="dk-pv-elapsed">0:00</span>
          <button type="button" data-act="timer">Start</button>
        </div>
        <div class="dk-pv-pace"></div>
        <div class="dk-pv-where"></div>
        <div class="dk-pv-link" hidden></div>
        <div class="dk-pv-demo" hidden></div>
        <div class="dk-pv-live">
          <span class="dk-pv-live-state" hidden></span>
          <span class="dk-pv-share" hidden>
            <button type="button" data-act="copy-link" title="Copy the link phones open to follow">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>
              <span>Copy link</span>
            </button>
          </span>
          <button type="button" data-act="live">Go live</button>
        </div>
        <div class="dk-pv-clock"></div>
      </header>
      <section class="dk-pv-cur"></section>
      <div class="dk-pv-notes"></div>
      <aside class="dk-pv-side">
        <div class="dk-pv-label"></div>
        <div class="dk-pv-next"><div class="dk-pv-next-stage"></div></div>
        <div class="dk-pv-label">Coming up</div>
        <ol class="dk-pv-up"></ol>
        <div class="dk-pv-tools">
          <div class="dk-pv-runs">
            <button type="button" data-act="save">Save run</button>
            <button type="button" data-act="reset">Reset timer</button>
            <span></span>
          </div>
        </div>
      </aside>
      <footer class="dk-pv-strip"><i class="dk-pv-strip-now"></i></footer>
      <form class="dk-pv-key" hidden>
        <div class="dk-pv-key-box">
          <h2>Go live</h2>
          <p>Paste the follow-along key. This browser keeps it, so you only do this once.</p>
          <input type="password" placeholder="Follow-along key" autocomplete="off" spellcheck="false" aria-label="Follow-along key">
          <div class="dk-pv-key-actions">
            <button type="button" data-act="cancel">Cancel</button>
            <button type="submit" class="dk-primary">Go live</button>
          </div>
        </div>
      </form>`;
    document.body.prepend(pv);
    const $ = (sel) => pv.querySelector(sel);
    const cur = $(".dk-pv-cur");
    const nextBox = $(".dk-pv-next");
    const stage = $(".dk-pv-next-stage");
    cur.appendChild(deck);
    $(".dk-pv-where").appendChild(counter);

    // Size rem so the slide fits its box; the presenter chrome is in px.
    const fit = () => {
      const r = cur.getBoundingClientRect();
      const px = Math.min(r.width / 120, r.height / 67.5);
      root.style.fontSize = `${px}px`;
      const scale = nextBox.getBoundingClientRect().width / (120 * px);
      stage.style.transform = `scale(${scale})`;
    };
    new ResizeObserver(fit).observe(cur);
    new ResizeObserver(fit).observe(nextBox);

    /* the timer: starts on the first move, "s" or the button pauses.
       It survives a reload of this window (sessionStorage). */
    const TIMER_KEY = "deck-presenter-timer";
    let running = false;
    let startedAt = 0;
    let banked = 0; // ms timed before the last start
    let times: Record<string, number> = {}; // seconds per slide key in this run, for "Save run"
    try {
      ({ running, startedAt, banked, times } = {
        running,
        startedAt,
        banked,
        times,
        ...JSON.parse(sessionStorage.getItem(TIMER_KEY)),
      });
    } catch {}
    const elapsed = () => banked + (running ? Date.now() - startedAt : 0);
    const timerButton = $('[data-act="timer"]');
    const saveTimer = () => {
      timerButton.textContent = running ? "Pause" : banked ? "Resume" : "Start";
      try {
        sessionStorage.setItem(TIMER_KEY, JSON.stringify({ running, startedAt, banked, times }));
      } catch {}
    };
    saveTimer();
    const setRunning = (on) => {
      if (on === running) return;
      if (on) startedAt = Date.now();
      else banked += Date.now() - startedAt;
      running = on;
      saveTimer();
    };
    const resetTimer = () => {
      running = false;
      banked = 0;
      times = {};
      saveTimer();
    };

    // Keep this run as a rehearsal: per-slide times feed the plan.
    const saveRun = async () => {
      const total = Math.round(elapsed() / 1000);
      if (total < 60) return flash("Time at least a minute of the talk before saving a run");
      const run = {
        date: new Date().toISOString(),
        total,
        times: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v)])),
      };
      try {
        const mine = JSON.parse(localStorage.getItem(RUNS_KEY) || "[]");
        mine.push(run);
        localStorage.setItem(RUNS_KEY, JSON.stringify(mine.slice(-20)));
      } catch {}
      let where = "this browser";
      if (window.DECK_DEV) {
        try {
          const r = await fetch("/__deck/rehearsals", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(run),
          });
          if (r.ok) where = "rehearsals.json";
        } catch {}
      }
      runs = loadRuns();
      planCache = null;
      renderStrip();
      flash(`Run saved to ${where} (${fmtTime(total)})`, 3000);
    };
    $('[data-act="save"]').addEventListener("click", saveRun);

    // Go live, asking for the key the first time. It stays in this browser.
    const keyForm = $(".dk-pv-key");
    const keyInput = keyForm.querySelector("input");
    // While live: a button that copies the link phones open to follow, to
    // paste into a chat. The bar shows only the button; the link is long.
    const copyButton = $('[data-act="copy-link"]');
    const copyLabel = copyButton.querySelector("span");
    let copyTimer = 0;
    copyButton.addEventListener("click", async (e) => {
      e.currentTarget.blur();
      const url = followLink();
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
        // No clipboard API (a page that is not https): the old way.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        try {
          ok = document.execCommand("copy");
        } catch {}
        ta.remove();
      }
      copyLabel.textContent = ok ? "Copied" : "Copy failed";
      copyButton.dataset.state = ok ? "done" : "fail";
      // The bar shows no link (it is too long to be useful there), so a
      // failed copy shows it, to copy by hand.
      if (!ok) flash(`Could not copy. The link: ${url}`, 8000);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyLabel.textContent = "Copy link";
        delete copyButton.dataset.state;
      }, 2000);
    });
    $('[data-act="live"]').addEventListener("click", (e) => {
      e.currentTarget.blur();
      toggleLive();
    });
    const closeKey = () => {
      keyForm.hidden = true;
      keyInput.value = "";
      keyInput.blur();
    };
    keyInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") closeKey();
    });
    keyForm.querySelector('[data-act="cancel"]').addEventListener("click", closeKey);
    keyForm.addEventListener("click", (e) => {
      if (e.target === keyForm) closeKey();
    });
    keyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = keyInput.value.trim();
      closeKey();
      if (!key) return;
      write(localStorage, LEAD_KEY, key);
      afterKey();
      if (notesState === "locked") loadPrivateNotes();
    });
    $(".dk-pv-notes").addEventListener("click", (e) => {
      if (!e.target.closest('[data-act="notes-key"]')) return;
      // Behind the gate there is no key: the fetch failed, so try again.
      if (gateAuth) loadPrivateNotes();
      else askKey("Show my notes", () => {});
    });
    onNotesLoaded = () => {
      planCache = null;
      renderStrip();
      $(".dk-pv-notes").dataset.slide = "";
      renderPresenter();
    };
    timerButton.addEventListener("click", () => setRunning(!running));
    $('[data-act="reset"]').addEventListener("click", resetTimer);
    toggleTimer = () => setRunning(!running);

    /* pace: where you are against the plan */
    let onSlide = 0; // seconds timed on the current slide
    let lastTick = Date.now();
    let lastSlide = -1;

    let demoCheckedAt = 0;
    const strip = $(".dk-pv-strip");
    const stripNow = $(".dk-pv-strip-now");
    const renderStrip = () => {
      const start = plan();
      const total = start[slides.length] || 1;
      strip.querySelectorAll("b").forEach((el) => el.remove());
      slides.forEach((s, i) => {
        const seg = document.createElement("b");
        seg.style.flexGrow = String(Math.max(0.001, start[i + 1] - start[i]));
        seg.title = `${i + 1}. ${slideKeys[i]}: ${fmtTime(start[i + 1] - start[i])}, at ${fmtTime(start[i])}`;
        if (s.classList.contains("divider") || s.dataset.at) seg.classList.add("pin");
        seg.addEventListener("click", () => jumpTo(i));
        strip.insertBefore(seg, stripNow);
      });
      strip.dataset.total = String(total);
      paintStrip();
    };
    const paintStrip = () => {
      strip.querySelectorAll("b").forEach((seg, i) => {
        seg.classList.toggle("done", i < current);
        seg.classList.toggle("now", i === current);
      });
      // The next few slides, with when the plan has you reach them.
      const start = plan();
      $(".dk-pv-up").replaceChildren(
        ...slides.slice(current + 1, current + 7).map((s, k) => {
          const i = current + 1 + k;
          const li = document.createElement("li");
          li.innerHTML = `<span></span><time>${fmtTime(start[i])}</time>`;
          li.firstChild.textContent = `${i + 1}. ${slideKeys[i]}`;
          if (s.classList.contains("divider")) li.classList.add("pin");
          return li;
        }),
      );
    };

    const tick = () => {
      const now = Date.now();
      if (current !== lastSlide) {
        lastSlide = current;
        onSlide = 0;
        paintStrip();
      }
      if (running) {
        const dt = (now - lastTick) / 1000;
        const k = slideKeys[current];
        times[k] = (times[k] || 0) + dt;
        onSlide += dt;
      }
      lastTick = now;

      const sec = elapsed() / 1000;
      const start = plan();
      const total = start[slides.length] || 1;
      stripNow.style.left = `${Math.min(100, (sec / total) * 100)}%`;
      const paceEl = $(".dk-pv-pace");
      if (!running && !banked) {
        paceEl.textContent = `Plan ${fmtTime(total)}`;
        paceEl.dataset.state = "";
      } else {
        const expected = start[current] + Math.min(onSlide, start[current + 1] - start[current]);
        const d = sec - expected;
        paceEl.textContent = Math.abs(d) < 20 ? "On pace" : `${fmtTime(d)} ${d > 0 ? "behind" : "ahead"}`;
        paceEl.dataset.state = Math.abs(d) < 20 ? "on" : d > 90 ? "late" : d > 0 ? "behind" : "ahead";
      }
      $(".dk-pv-runs span").textContent = runs.length ? `${runs.length} run${runs.length > 1 ? "s" : ""} saved` : "No runs yet";

      $(".dk-pv-elapsed").textContent = fmtTime(elapsed() / 1000);
      $(".dk-pv-clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const live = peer && Date.now() - peerSeen < 5000;
      // The audience window only shows up here when something is wrong.
      const link = $(".dk-pv-link");
      const problem = !live ? "Not connected to the slides window" : blanked ? `Audience sees a ${blanked} screen (any key brings it back)` : "";
      link.hidden = !problem;
      link.textContent = problem;
      link.title = problem;
      link.dataset.state = !live ? "off" : "blank";

      // Follow-along: Go live, or how many are following and Stop.
      const r = live ? relay : null;
      const on = !!r?.live;
      const liveButton = $('[data-act="live"]');
      liveButton.textContent = on ? "Stop" : "Go live";
      liveButton.classList.toggle("dk-primary", !on);
      // Shown once the audience window says it has a server to go live
      // on: a static site, or a local copy with no site, has none.
      liveButton.hidden = !on && !r?.can;
      const share = $(".dk-pv-share");
      share.hidden = !on || !liveUrl;
      const liveState = $(".dk-pv-live-state");
      liveState.textContent = on
        ? r.followers == null
          ? "Live, reconnecting"
          : `Live, ${r.followers} following`
        : r?.error === "key"
          ? "Key rejected"
          : r?.error === "owner"
            ? OWNER_ONLY
            : "";
      liveState.hidden = !liveState.textContent;
      liveState.dataset.state = on && r.followers != null ? "on" : "warn";

      // The demo server for this slide or the next, rechecked every few
      // seconds, so starting it turns the bar green.
      const demo = slides[current].dataset.demo ? slides[current] : slides[current + 1]?.dataset.demo ? slides[current + 1] : null;
      const demoEl = $(".dk-pv-demo");
      demoEl.hidden = !demo;
      if (demo) {
        const url = demo.dataset.demo;
        if (now - demoCheckedAt > 3000) {
          demoCheckedAt = now;
          checkDemo(demo, false);
        }
        const ok = demoStatus.get(url);
        // Two words in the bar; the details are in the tooltip.
        const which = demo === slides[current] ? "This slide's" : "The next slide's";
        demoEl.textContent = ok === undefined ? "Demo …" : ok ? "Demo ready" : "Demo down";
        demoEl.title = `${which} demo server, ${url}: ${ok === undefined ? "checking" : ok ? "running" : "not running; start it, or play the clip with v"}`;
        demoEl.dataset.state = ok === undefined ? "" : ok ? "on" : "off";
      }
    };
    setInterval(tick, 250);
    // Persist the run's slide times now and then, for a reload.
    setInterval(() => running && saveTimer(), 5000);
    renderStrip();

    // A copy of slide i, built to step `phase`, for the "next" preview.
    const copyOf = (i, phase) => {
      const src = slides[i];
      const copy = src.cloneNode(true) as HTMLElement;
      copy.classList.add("current");
      copy.classList.remove("dk-enter", "dk-clip-full", "dk-selected", "dk-hold", "dk-probe", "dk-still");
      for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("[style]")]) el.style.viewTransitionName = "";
      copy.querySelectorAll(".dk-clip-target").forEach((el) => el.classList.remove("dk-clip-target"));
      copy.querySelectorAll(".dk-lint-badge, .dk-time").forEach((el) => el.remove());
      if (phasesOf(src) > 1) copy.dataset.phase = String(phase);
      const steps = buildsOf.get(src);
      if (steps) copy.querySelectorAll("[data-build]").forEach((el, k) => el.classList.toggle("dk-built", steps[k].step <= phase - 1));
      copy.querySelectorAll("video").forEach((v) => {
        v.removeAttribute("data-autoplay");
        v.removeAttribute("autoplay");
        v.preload = "metadata";
      });
      return copy;
    };

    let shownNext = "";
    let firstState = "";
    renderPresenter = () => {
      const slide = slides[current];
      const p = phaseOf(slide);
      const n = phasesOf(slide);
      let label = "End of the deck";
      let target: [number, number] = null;
      if (p < n && !buildsOff) {
        label = `Next: build ${p} of ${n - 1} on this slide`;
        target = [current, p + 1];
      } else if (current < slides.length - 1) {
        label = `Next: slide ${current + 2}`;
        target = [current + 1, buildsOff ? phasesOf(slides[current + 1]) : 1];
      }
      $(".dk-pv-label").textContent = label;
      const key = String(target);
      if (key !== shownNext) {
        shownNext = key;
        stage.replaceChildren(...(target ? [copyOf(...target)] : []));
      }
      const src = slide.querySelector(".notes");
      const notes = $(".dk-pv-notes");
      if (notes.dataset.slide !== String(current)) {
        notes.dataset.slide = String(current);
        notes.innerHTML = src
          ? src.innerHTML
          : notesState === "locked"
            ? '<p><em>Your notes are private on this site.</em></p><p><button type="button" data-act="notes-key">Show my notes</button></p>'
            : notesState === "owner"
              ? "<p><em>Only the owner can see the notes for this deck.</em></p>"
              : "<p><em>No notes for this slide.</em></p>";
        notes.scrollTop = 0;
      }
      // The timer starts on the first move away from where you opened.
      const where = `${current}:${p}`;
      if (!firstState) firstState = where;
      else if (!running && !banked && where !== firstState) setRunning(true);
    };

    // Say hello until the audience window answers, then keep it warm.
    setTimeout(presenterHello, 0);
    setInterval(() => {
      if (!peer || Date.now() - peerSeen > 2500) presenterHello();
      else post({ type: "ping" });
    }, 2000);
  }

  /* ---------- laser pointer ("l") ----------
   * The mouse becomes a red dot with a short fading tail, drawn on a
   * canvas over everything. Dragging draws ink that stays until "c" or
   * the next slide. Points travel as fractions of the slide, so pointing
   * or drawing in the presenter window shows at the same spot on the
   * audience screen (and the other way round). */

  const LASER_TAIL_MS = 380;
  const LASER_COLORS = [
    ["red", "#ff2d2d"],
    ["amber", "#ffb020"],
    ["green", "#2fd26b"],
    ["blue", "#3d8bff"],
    ["pink", "#ff3dd8"],
  ];
  const COLOR_KEY = "deck-laser-color";
  let laserColor = LASER_COLORS[0][1];
  try {
    const saved = localStorage.getItem(COLOR_KEY);
    if (LASER_COLORS.some(([, c]) => c === saved)) laserColor = saved;
  } catch {}

  const laserCanvas = document.createElement("canvas");
  laserCanvas.className = "dk-laser";
  document.body.appendChild(laserCanvas);
  const lctx = laserCanvas.getContext("2d");
  // The tail is drawn solid here first, then laid over at one alpha.
  const tailCanvas = document.createElement("canvas");
  const tctx = tailCanvas.getContext("2d");
  let laserOn = false;
  let trail = []; // { x, y, t }: slide fractions; x null = pointer lifted
  let ink: { color: string; points: { x: number; y: number }[] }[] = []; // strokes: { color, points: [{ x, y }] } in slide fractions
  let drawing = false;
  let laserFrame = 0;
  let laserSent = 0;
  const redraw = () => {
    if (!laserFrame) laserFrame = requestAnimationFrame(drawLaser);
  };
  window.addEventListener("resize", redraw);

  const drawLaser = () => {
    laserFrame = 0;
    const dpr = window.devicePixelRatio || 1;
    const w = innerWidth;
    const h = innerHeight;
    for (const c of [laserCanvas, tailCanvas]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
    }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, w, h);
    if (overview) return;

    const now = performance.now();
    // Keep the newest point (the dot) however old; drop faded tail.
    while (trail.length > 1 && now - trail[0].t > LASER_TAIL_MS) trail.shift();
    const r = slides[current].getBoundingClientRect();
    const size = r.width / 120; // 1rem of the slide
    const at = (p): [number, number] => [r.left + p.x * r.width, r.top + p.y * r.height];

    const mid = (a, b): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    // Ink: one smoothed path per stroke (curves through the midpoints).
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    lctx.lineWidth = size * 0.45;
    lctx.globalAlpha = 0.9;
    for (const stroke of ink) {
      const q = stroke.points.map(at);
      lctx.strokeStyle = stroke.color;
      lctx.beginPath();
      lctx.moveTo(...q[0]);
      if (q.length === 1) lctx.lineTo(...q[0]);
      for (let i = 1; i < q.length - 1; i++) lctx.quadraticCurveTo(...q[i], ...mid(q[i], q[i + 1]));
      if (q.length > 1) lctx.lineTo(...q.at(-1));
      lctx.stroke();
    }
    lctx.globalAlpha = 1;

    // The tail: smoothed the same way and thinning with age. Drawn solid
    // on its own canvas, then laid over at one alpha, so the overlapping
    // pieces never show as darker dots.
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, w, h);
    tctx.lineCap = "round";
    tctx.strokeStyle = laserColor;
    let run = [];
    const flushRun = () => {
      const q = run.map((p) => ({ xy: at(p), life: Math.max(0, 1 - (now - p.t) / LASER_TAIL_MS) }));
      for (let i = 1; i < q.length; i++) {
        const from = i === 1 ? q[0].xy : mid(q[i - 1].xy, q[i].xy);
        const to = i === q.length - 1 ? q[i].xy : mid(q[i].xy, q[i + 1].xy);
        const life = q[i].life;
        if (life <= 0) continue;
        tctx.lineWidth = size * 0.9 * life;
        tctx.beginPath();
        tctx.moveTo(...from);
        if (i === q.length - 1) tctx.lineTo(...to);
        else tctx.quadraticCurveTo(...q[i].xy, ...to);
        tctx.stroke();
      }
      run = [];
    };
    for (const p of trail) {
      if (p.x == null) flushRun();
      else run.push(p);
    }
    flushRun();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalAlpha = 0.7;
    lctx.drawImage(tailCanvas, 0, 0);
    lctx.globalAlpha = 1;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const last = trail.at(-1);
    if (last && last.x != null) {
      const [x, y] = at(last);
      const glow = lctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
      glow.addColorStop(0, `${laserColor}8c`);
      glow.addColorStop(1, `${laserColor}00`);
      lctx.fillStyle = glow;
      lctx.beginPath();
      lctx.arc(x, y, size * 2.2, 0, Math.PI * 2);
      lctx.fill();
      lctx.fillStyle = laserColor;
      lctx.beginPath();
      lctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
      lctx.fill();
    }
    // Keep drawing while a tail is left to fade (old points are trimmed
    // above, so a lone point is a dot at rest).
    if (trail.length > 1) laserFrame = requestAnimationFrame(drawLaser);
  };

  // A point in slide fractions, or (null, null) to lift the pointer.
  function laserPoint(x, y) {
    const p = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: null, y: null };
    const last = trail.at(-1);
    if (p.x == null && (!last || last.x == null)) return;
    trail.push({ ...p, t: performance.now() });
    shareFx({ t: "laser", x: p.x, y: p.y, c: laserColor });
    if (trail.length > 200) trail = trail.slice(-200);
    redraw();
  }

  function inkPoint(x, y, start) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (start || !ink.length) {
      ink.push({ color: laserColor, points: [] });
      shareFx({ t: "ink", x, y, s: true, c: laserColor });
    } else shareFx({ t: "ink", x, y });
    ink.at(-1).points.push({ x, y });
    redraw();
  }

  // Pick the laser and ink color; send = tell the other window too.
  let onLaserColor = () => {};
  function setLaserColor(color, send) {
    if (!LASER_COLORS.some(([, c]) => c === color)) return;
    laserColor = color;
    try {
      localStorage.setItem(COLOR_KEY, color);
    } catch {}
    redraw();
    onLaserColor();
    if (send) post({ type: "laser-color", color });
  }

  const cycleLaserColor = () => {
    const i = LASER_COLORS.findIndex(([, c]) => c === laserColor);
    const [name, color] = LASER_COLORS[(i + 1) % LASER_COLORS.length];
    setLaserColor(color, true);
    flash(`Laser color: ${name}`);
  };

  // Wipe the ink; send = also tell the other window ("c"). A slide
  // change clears it in both windows on its own.
  function clearInk(send) {
    if (!ink.length) return;
    ink = [];
    drawing = false;
    redraw();
    shareFx({ t: "clear" });
    if (send) post({ type: "ink-clear" });
  }

  // The presenter bar: a laser toggle and one swatch per color.
  if (presenterMode) {
    const box = document.createElement("div");
    box.className = "dk-pv-laser";
    box.innerHTML =
      '<button type="button" data-act="laser">Laser</button>' +
      LASER_COLORS.map(([name, c]) => `<button type="button" class="dk-swatch" data-color="${c}" title="${name}" style="--sw:${c}"></button>`).join("");
    document.querySelector(".dk-pv-tools").prepend(box);
    box.querySelector('[data-act="laser"]').addEventListener("click", (e) => {
      toggleLaser();
      (e.currentTarget as HTMLElement).blur();
    });
    box.querySelectorAll<HTMLElement>(".dk-swatch").forEach((b) =>
      b.addEventListener("click", () => {
        setLaserColor(b.dataset.color, true);
        if (!laserOn) toggleLaser();
        b.blur();
      }),
    );
    onLaserColor = () => {
      box.querySelectorAll<HTMLElement>(".dk-swatch").forEach((b) => b.classList.toggle("on", b.dataset.color === laserColor));
      box.querySelector('[data-act="laser"]').classList.toggle("on", laserOn);
    };
    onLaserColor();
  }

  const toggleLaser = () => {
    laserOn = !laserOn;
    onLaserColor();
    document.body.classList.toggle("dk-laser-on", laserOn);
    if (!laserOn) {
      laserPoint(null, null);
      post({ type: "laser", x: null, y: null });
    }
    flash(laserOn ? "Laser on (l to turn off)" : "Laser off");
  };

  document.addEventListener("mousemove", (e) => {
    if (!laserOn || overview) return;
    const r = slides[current].getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width;
    let y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) x = y = null;
    laserPoint(x, y);
    if (drawing && !(e.buttons & 1)) drawing = false; // released outside the window
    if (drawing && x != null) {
      // Every ink point goes across, so both windows draw the same line.
      inkPoint(x, y, false);
      post({ type: "ink", x, y });
    }
    // At most one laser message a frame to the other window.
    const now = performance.now();
    if (now - laserSent > 14) {
      laserSent = now;
      post({ type: "laser", x, y });
    }
  });

  // Press and drag with the laser on to draw. Never selects text.
  document.addEventListener("mousedown", (e) => {
    if (!laserOn || overview || e.button !== 0) return;
    const r = slides[current].getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    e.preventDefault();
    drawing = true;
    inkPoint(x, y, true);
    post({ type: "ink", x, y, start: true });
  });
  document.addEventListener("mouseup", () => {
    drawing = false;
  });
  document.addEventListener("mouseleave", () => {
    if (!laserOn) return;
    laserPoint(null, null);
    post({ type: "laser", x: null, y: null });
  });

  /* ---------- follow-along (deck/server) ---------- */

  const params = new URLSearchParams(location.search);
  const followUrl = following && (window.DECK_FOLLOW || params.get("follow"));

  // Going live: "Go live" in the presenter window (or g) makes the audience
  // window post each move, and the laser and ink, to the talk's live URL;
  // phones on <prefix>/<talk>/live follow. The key is pasted once in the
  // presenter window and kept in this browser, never in a URL. The live URL
  // is <prefix>/<talk> on the server serving a published deck (publish.ts
  // names the talk in #dk-config), else on the site in deck.config.json (a
  // local copy, named from its <talk>/deck/ folder; none without a site);
  // ?lead=<url> overrides it. Never blocks the talk; whatever happens while
  // a post is in flight goes out when it lands.
  const config = (() => {
    try {
      return JSON.parse(document.getElementById("dk-config")?.textContent || "{}");
    } catch {
      return {};
    }
  })();
  // "auth": "gate": the deck is in a private space behind alethi.dev's
  // gate, which tells the server who is asking. The owner leads and gets
  // the notes with no key, and nobody is asked for one.
  const gateAuth = config.auth === "gate";
  const LEAD_KEY = "deck:lead-key";
  const LIVE_KEY = "deck:live"; // per window, so a reload stays live
  const leadHeaders = (): Record<string, string> =>
    gateAuth
      ? { "content-type": "application/json" }
      : { authorization: `Bearer ${read(localStorage, LEAD_KEY)}`, "content-type": "application/json" };
  const OWNER_ONLY = "Only the owner can lead this deck";
  const read = (store, k) => {
    try {
      return store.getItem(k);
    } catch {
      return null;
    }
  };
  const write = (store, k, v) => {
    try {
      if (v == null) store.removeItem(k);
      else store.setItem(k, v);
    } catch {}
  };
  const liveUrl = (() => {
    if (params.get("lead")) return params.get("lead");
    const prefix = typeof config.prefix === "string" ? config.prefix : "/talks";
    const http = /^https?:$/.test(location.protocol);
    if (config.talk) {
      const origin = http ? location.origin : config.site;
      return origin ? `${origin}${prefix}/${config.talk}` : null;
    }
    const local = decodeURIComponent(location.pathname).match(/\/([^/]+)\/deck\/(?:dist\/)?[^/]*$/);
    return local && config.site ? `${config.site}${prefix}/${local[1]}` : null;
  })();
  const canLead = !presenterMode && !followUrl && !!liveUrl;
  // What phones open to follow: the talk's live page.
  const followLink = () => new URL("live", liveUrl.replace(/\/*$/, "/")).href;
  const leadAt = (name) => new URL(name, liveUrl.replace(/\/*$/, "/"));
  let isLive = false;
  let liveError = ""; // "key" once the server turns the key down
  let followers = null; // the server's count, null when unreachable
  let relay = null; // presenter side: what the audience window reports
  let reactStream = null;
  let leadBusy = false;
  let leadDirty = false;
  let lastPost = 0; // when the last post went out
  let fxQueue = []; // laser and ink since the last post
  let fxStart = 0;
  let fxTimer = 0;

  async function lead() {
    if (!isLive) return;
    clearTimeout(fxTimer);
    fxTimer = 0;
    if (leadBusy) {
      leadDirty = true;
      return;
    }
    leadBusy = true;
    lastPost = Date.now();
    const events = fxQueue;
    fxQueue = [];
    try {
      const r = await fetch(leadAt("state"), {
        method: "POST",
        headers: leadHeaders(),
        body: JSON.stringify({ slide: current, phase: phaseOf(slides[current]), live: true, clip: !!clipFull, shared: sharedForServer(), events }),
      });
      if (r.status === 403 && gateAuth) {
        // Signed in, but not as the owner: there is no key to ask for.
        setLive(false);
        liveError = "owner";
        flash(OWNER_ONLY, 3000);
      } else if (r.status === 403) {
        // Forget it, so the next "Go live" asks for it again.
        write(localStorage, LEAD_KEY, null);
        setLive(false);
        liveError = "key";
        flash("Follow-along key rejected; enter it again in the presenter window", 3000);
      } else followers = r.ok ? (await r.json()).followers : null;
    } catch {
      followers = null;
    }
    livePong();
    leadBusy = false;
    if (leadDirty || fxQueue.length) {
      leadDirty = false;
      lead();
    }
  }
  // Now and then too, so a restarted server catches up and the count stays fresh.
  setInterval(lead, 10000);

  // Start or stop leading (audience window). Needs a saved key to start,
  // unless the gate vouches for the speaker.
  function setLive(on) {
    if (on && !(canLead && (gateAuth || read(localStorage, LEAD_KEY)))) return;
    // Stopping tells the server, so phones may roam the whole deck.
    if (isLive && !on)
      fetch(leadAt("state"), {
        method: "POST",
        headers: leadHeaders(),
        body: JSON.stringify({ slide: current, phase: phaseOf(slides[current]), live: false }),
      }).catch(() => {});
    isLive = on;
    liveError = "";
    followers = null;
    write(sessionStorage, LIVE_KEY, on ? "1" : null);
    reactStream?.close();
    reactStream = null;
    fxQueue = [];
    if (on) {
      // The leading deck listens too, for the reactions.
      const url = leadAt("events");
      url.search = "lead";
      reactStream = new EventSource(url);
      reactStream.addEventListener("react", onReact);
      lead();
    }
  }

  // The audience window's answer to the presenter's ping: is it live.
  function livePong() {
    post({ type: "pong", lead: isLive, followers, liveError, canLead });
  }

  // "g" or the presenter's button. The presenter window asks for the key
  // the first time and tells the audience window to go live.
  // The key dialog (presenter window): what to do once the key is in.
  let afterKey = () => {};
  function askKey(title, then) {
    const form = document.querySelector<HTMLFormElement>(".dk-pv-key");
    const input = form.querySelector("input");
    form.querySelector("h2").textContent = title;
    form.querySelector('[type="submit"]').textContent = title;
    afterKey = then;
    form.hidden = false;
    input.value = "";
    input.focus();
  }
  // The presenter window has heard from the audience window lately.
  const audienceHere = () => !!relay && !!peer && Date.now() - peerSeen < 5000;

  async function toggleLive() {
    if (presenterMode) {
      // Just opened: give the audience window a moment to answer.
      for (let i = 0; i < 30 && !audienceHere(); i++) {
        if (i % 10 === 0) presenterHello();
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!audienceHere()) return flash("No slides window for this deck is open in this browser. Open the deck, then press p there", 5000);
      if (!relay.can) return flash("This deck has no follow-along address", 3000);
      if (relay.live) return post({ type: "go-live", on: false });
      if (!gateAuth && !read(localStorage, LEAD_KEY)) return askKey("Go live", () => post({ type: "go-live", on: true }));
      return post({ type: "go-live", on: true });
    }
    if (!canLead) return flash("This deck has no follow-along address");
    if (!isLive && !gateAuth && !read(localStorage, LEAD_KEY)) return flash("Go live from the presenter window (p) the first time, to enter the key", 2600);
    setLive(!isLive);
    flash(isLive ? "Live: phones follow this deck" : "Follow-along stopped");
  }

  // Laser and ink go out in small batches. Each event carries its offset
  // into the batch, so followers replay it at the pace it was drawn.
  function shareFx(ev) {
    if (!isLive) return;
    const now = performance.now();
    if (!fxQueue.length) fxStart = now;
    else if (fxQueue.length >= 480 && ev.t !== "clear") return; // the server takes 500 a post
    const round = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
    fxQueue.push({ ...ev, d: Math.min(10000, Math.round(now - fxStart)), x: round(ev.x), y: round(ev.y) });
    if (!fxTimer) fxTimer = setTimeout(lead, 50);
  }

  /* ---------- reactions: emojis rising up the screen ---------- */

  const reactLayer = document.createElement("div");
  reactLayer.className = "dk-reactions";
  reactLayer.setAttribute("aria-hidden", "true");
  document.body.appendChild(reactLayer);
  let reactionsShown = true;

  const floatEmoji = (emoji) => {
    if (!reactionsShown || reactLayer.childElementCount >= 40) return;
    const el = document.createElement("span");
    el.textContent = emoji;
    el.style.setProperty("--x", `${(Math.random() * 10).toFixed(1)}vw`);
    el.style.setProperty("--drift", `${(Math.random() * 8 - 4).toFixed(1)}vw`);
    el.style.setProperty("--dur", `${(2.6 + Math.random() * 1.4).toFixed(2)}s`);
    el.addEventListener("animationend", () => el.remove());
    reactLayer.appendChild(el);
  };

  // counts: { emoji: n } from the server, spread out a little in time.
  const showReactions = (counts: Record<string, number>) => {
    let i = 0;
    for (const [emoji, n] of Object.entries(counts || {})) {
      if (emoji.length > 8 || !Number.isInteger(n)) continue;
      for (let k = 0; k < Math.min(n, 12); k++) setTimeout(() => floatEmoji(emoji), i++ * 60 + Math.random() * 200);
    }
  };
  const onReact = (e) => {
    let counts;
    try {
      counts = JSON.parse(e.data).counts;
    } catch {
      return;
    }
    showReactions(counts);
    // The leading deck passes them on to the presenter window.
    if (isLive) post({ type: "react", counts });
  };

  function toggleReactions() {
    reactionsShown = !reactionsShown;
    if (!reactionsShown) reactLayer.replaceChildren();
    flash(reactionsShown ? "Audience emojis on" : "Audience emojis hidden (e to show)");
  }

  // The presenter window on the hosted deck: fetch the speaker notes with
  // the key (behind the gate, as the owner) and put them back into the
  // slides, so the notes, the pace and the strip work as they do from a
  // local copy (which keeps its notes).
  async function loadPrivateNotes() {
    if (!presenterMode || !liveUrl || document.querySelector(".slide .notes")) return;
    notesState = "locked";
    const key = read(localStorage, LEAD_KEY);
    if (gateAuth) {
      try {
        const r = await fetch(leadAt("notes"), { cache: "no-store" });
        if (r.status === 403) notesState = "owner";
        else if (r.ok) {
          putBackNotes(await r.json());
          notesState = "";
        }
      } catch {}
    } else if (key) {
      try {
        const r = await fetch(leadAt("notes"), { headers: { authorization: `Bearer ${key}` }, cache: "no-store" });
        if (r.status === 403) {
          write(localStorage, LEAD_KEY, null);
          flash("That key was rejected", 3000);
        } else if (r.ok) {
          putBackNotes(await r.json());
          notesState = "";
        }
      } catch {}
    }
    onNotesLoaded();
  }
  function putBackNotes(notes) {
    slides.forEach((slide, i) => {
      if (typeof notes[i] !== "string" || !notes[i]) return;
      const aside = document.createElement("aside");
      aside.className = "notes";
      aside.innerHTML = notes[i];
      slide.appendChild(aside);
    });
  }
  // After start-up, once the presenter view is built.
  if (presenterMode) setTimeout(loadPrivateNotes, 0);

  // A reload of a live audience window stays live.
  if (read(sessionStorage, LIVE_KEY)) setLive(true);

  /* A signed-out follower's deck (window.DECK_ANON) arrives empty: one
   * placeholder per slide, and the slides themselves only as far as the
   * speaker has gone, from <talk>/slides. hydrate fills a placeholder
   * in place (same element, so its tile, listeners and the theme's
   * attributes stay) and sets the slide up as start-up does: source
   * line, builds, label. When the talk ends, wipe empties them again. */
  const anonUrl = following ? window.DECK_ANON : "";
  const hydrate = (i, html) => {
    const slide = slides[i];
    const t = document.createElement("template");
    t.innerHTML = html;
    const from = t.content.firstElementChild;
    if (!slide || !from) return;
    for (const a of Array.from(from.attributes)) {
      if (a.name === "class") slide.classList.add(...a.value.split(/\s+/).filter(Boolean));
      else if (a.name === "style") slide.style.cssText += `;${a.value}`;
      else slide.setAttribute(a.name, a.value);
    }
    slide.replaceChildren(...Array.from(from.childNodes));
    addSourceLine(slide);
    prepareBuilds(slide);
    _setPhase(slide, 1);
    applyBuilds(slide);
    labelTile(slide, i);
    document.dispatchEvent(new CustomEvent("deck:insert", { detail: { index: i, slide } }));
  };
  const wipe = () => {
    clearInk(false);
    slides.forEach((slide) => {
      const now = slide.classList.contains("current");
      for (const a of Array.from(slide.attributes)) slide.removeAttribute(a.name);
      slide.className = now ? "slide current" : "slide";
      slide.replaceChildren();
      buildsOf.delete(slide);
      tileOf(slide).dataset.label = "";
    });
  };

  // Following: take the server's moves until the viewer moves themselves.
  if (followUrl) {
    let live = true;
    let latest = null;
    let liveInk = []; // the ink on the live slide, to redraw on coming back
    const back = document.createElement("button");
    back.type = "button";
    back.className = "dk-follow";
    back.hidden = true;
    document.body.appendChild(back);
    const waiting = document.createElement("div");
    waiting.className = "dk-follow-wait";
    waiting.textContent = "Waiting for the talk to start";
    document.body.appendChild(waiting);

    // The speaker's shared values this phone last took (see "shared").
    let leadShared = {};
    // rejoining: take all the speaker's values, not just the ones that changed.
    const follow = (s, rejoining = false) => {
      if (!s || !Number.isInteger(s.slide)) return;
      if (overview) return;
      if (anonUrl && s.slide > have) return; // not here yet: ensure brings it
      apply({ slide: Math.min(s.slide, slides.length - 1), phase: s.phase, clip: !!s.clip });
      const next = s.shared && typeof s.shared === "object" ? s.shared : {};
      adoptShared(next, rejoining ? shared : leadShared);
      leadShared = next;
    };

    // Signed out: the slides so far, fetched as the speaker reaches them.
    let have = -1; // the last slide this page has
    let ended = false;
    let fetching = null;
    const ensure = async (n) => {
      while (!ended && n > have) {
        if (!fetching) {
          fetching = (async () => {
            const url = new URL(anonUrl, location.href);
            url.searchParams.set("upto", String(n));
            const r = await fetch(url, { cache: "no-store" });
            if (!r.ok) throw new Error(`slides: ${r.status}`);
            const got = await r.json();
            Object.assign(credits, got.sources || {});
            const list = Array.isArray(got.slides) ? got.slides : [];
            for (let i = have + 1; i < list.length && i < slides.length; i++) hydrate(i, list[i]);
            const before = have;
            have = Math.max(have, Math.min(list.length, slides.length) - 1);
            if (have > before) fillCredits();
            if (have < n) throw new Error("slides: not that far yet");
          })().finally(() => (fetching = null));
        }
        try {
          await fetching;
        } catch {
          return false;
        }
      }
      return !ended;
    };
    const endTalk = (text) => {
      if (ended) return;
      ended = true;
      es.close();
      live = false;
      laserPoint(null, null);
      adoptShared({});
      leadShared = {};
      wipe();
      back.hidden = true;
      bar.hidden = true;
      waiting.textContent = text;
      waiting.hidden = false;
    };
    const showBack = () => {
      back.hidden = live || !latest?.live;
      if (latest) back.textContent = `Back to the live slide (${latest.slide + 1})`;
    };
    // One laser or ink event, drawn only while on the live slide.
    const playFx = (ev) => {
      if (!live || overview || !latest || current !== latest.slide) return;
      if (LASER_COLORS.some(([, c]) => c === ev.c)) laserColor = ev.c;
      if (ev.t === "laser") laserPoint(ev.x, ev.y);
      else if (ev.t === "ink") inkPoint(ev.x, ev.y, !!ev.s);
      else if (ev.t === "clear") clearInk(false);
    };
    const redrawInk = () => {
      clearInk(false);
      liveInk.forEach(playFx);
    };
    detachFollow = () => {
      if (!live) return;
      live = false;
      laserPoint(null, null);
      showBack();
    };
    const rejoin = () => {
      live = true;
      showBack();
      follow(latest, true);
      redrawInk();
    };
    back.addEventListener("click", (e) => {
      e.stopPropagation();
      rejoin();
    });
    // While the talk is live, a follower can look back but not ahead:
    // moving to the live slide (or past it) rejoins it. Before the talk
    // they stay at the start; once it stops, the whole deck is theirs.
    followGate = (slide, phase) => {
      // Signed out: nothing to move to once the talk has ended, and
      // nothing past the slides that have arrived.
      if (anonUrl && (ended || !latest?.live || slide > have)) {
        if (!ended && latest?.live && slide > have) rejoin();
        return true;
      }
      if (!latest) {
        flash("The talk hasn't started yet", 2000);
        return true;
      }
      if (!latest.live) return false;
      const ahead = slide - latest.slide || phase - latest.phase;
      if (ahead < 0) return false;
      rejoin();
      if (ahead > 0) flash("You're on the live slide", 1600);
      return true;
    };

    const es = new EventSource(followUrl);
    es.addEventListener("state", (e) => {
      let s;
      try {
        s = JSON.parse(e.data);
      } catch {
        return;
      }
      if (latest && s.slide !== latest.slide) liveInk = [];
      // Going live brings everyone along, wherever they had wandered, with
      // all of the speaker's shared values (as Back to the live slide does).
      const brought = s.live && !latest?.live;
      if (brought) live = true;
      latest = s;
      if (ended) return;
      waiting.hidden = true;
      if (anonUrl && s.live && s.slide > have) {
        ensure(s.slide).then(() => {
          if (live) follow(latest, brought);
          else showBack();
        });
        return;
      }
      if (live) follow(latest, brought);
      else showBack();
    });
    // The server ends a signed-out follower's stream when the talk stops;
    // a stream it refuses (the talk is not live) closes for good.
    es.addEventListener("ended", () => endTalk("The talk has ended"));
    es.addEventListener("error", () => {
      if (anonUrl && es.readyState === EventSource.CLOSED) endTalk(latest ? "The talk has ended" : "This talk isn't live right now");
    });
    es.addEventListener("fx", (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!latest || m.slide !== latest.slide || !Array.isArray(m.events)) return;
      // A replay (on joining, or after a reconnect) is the whole slide's ink.
      if (m.replay) {
        liveInk = [];
        if (live) clearInk(false);
      }
      for (const ev of m.events) {
        if (ev.t === "clear") liveInk = [];
        else if (ev.t === "ink") liveInk.push(ev);
        if (m.replay) playFx(ev);
        else setTimeout(() => playFx(ev), ev.d || 0);
      }
    });
    es.addEventListener("react", onReact);

    // Keep the phone awake while following, where the browser allows it.
    // Some (iPhone Safari) grant it only during a tap, so until it holds, a
    // button asks for one. The lock drops when the page is hidden, so it
    // is taken again on the way back.
    const awake = document.createElement("button");
    awake.type = "button";
    awake.className = "dk-awake";
    awake.textContent = "Tap to keep your screen on";
    awake.hidden = true;
    document.body.appendChild(awake);
    let wakeLock = null;
    const keepAwake = async () => {
      if (wakeLock || !navigator.wakeLock || document.visibilityState !== "visible") return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (wakeLock) lock.release().catch(() => {});
        else {
          wakeLock = lock;
          lock.addEventListener("release", () => {
            if (wakeLock === lock) wakeLock = null;
          });
        }
      } catch {}
      awake.hidden = !!wakeLock;
    };
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    for (const type of ["pointerdown", "touchend", "click"]) document.addEventListener(type, keepAwake, true);

    // An overlay row at the bottom: the reactions the server offers, and
    // full screen where the browser has it (not on iPhone).
    const emojis = Array.isArray(window.DECK_REACTIONS) ? window.DECK_REACTIONS : [];
    // Which phone a reaction came from, for the server's per-phone limit.
    const phoneId = Math.random().toString(36).slice(2, 14);
    const bar = document.createElement("div");
    bar.className = "dk-react-bar";
    if (emojis.length) {
      const reactUrl = new URL("react", new URL(followUrl, location.href));
      for (const emoji of emojis) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = emoji;
        b.setAttribute("aria-label", `Send ${emoji}`);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          b.blur();
          b.classList.remove("dk-pop");
          void b.offsetWidth;
          b.classList.add("dk-pop");
          fetch(reactUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ e: emoji, p: phoneId }),
          }).catch(() => {});
        });
        bar.appendChild(b);
      }
    }
    if (canFullscreen) {
      const fs = document.createElement("button");
      fs.type = "button";
      fs.className = "dk-react-fs";
      const sync = () => {
        const on = !!document.fullscreenElement;
        fs.innerHTML = on ? FS_EXIT : FS_ENTER;
        fs.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
      };
      sync();
      document.addEventListener("fullscreenchange", sync);
      fs.addEventListener("click", (e) => {
        e.stopPropagation();
        fs.blur();
        toggleFullscreen();
      });
      bar.appendChild(fs);
    }
    if (bar.childElementCount) document.body.appendChild(bar);
  }

  /* ---------- touch: swipe to move ---------- */

  let touch = null;
  window.addEventListener(
    "touchstart",
    (e) => {
      touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    { passive: true },
  );
  window.addEventListener(
    "touchend",
    (e) => {
      if (!touch || overview || busy) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      detachFollow();
      if (dx < 0) next();
      else prev();
    },
    { passive: true },
  );

  /* ---------- boot ---------- */

  goTo(slideFromHash());

  // Tiny debugging/automation surface (not part of the authoring contract).
  // on("slide" | "phase", fn): the events above, with their detail.
  const on = (type, fn) => document.addEventListener(`deck:${type}`, (e) => fn((e as CustomEvent).detail));
  window.deck = { goTo, next, prev, finish, jumpTo, slides, state, apply, probe, estimate, titleOf, on, share, shared: sharedValue };
})();

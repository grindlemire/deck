/* ============================================================
 * deck / outline.ts
 * Reads a deck's story files and checks them, with no browser:
 *
 *     <deck>/outline.md          the talk's point, sections and beats
 *     <deck>/sources/digest.md   numbered facts from the source material
 *
 *     bun deck check my-talk --outline     # check, print issues
 *
 * The outline is the authority for what it says; slides.html stays
 * hand-built. lint.ts (in dev.ts and check.ts) compares the two slide
 * by slide. Formats: deck/AUTHORING.md, "The story".
 *
 * Imported by dev.ts, build.ts and check.ts (readStory); zero npm deps.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";

/* ---------- outline.md ----------
 *
 *   # Talk title
 *   Point: the one sentence the audience should leave with
 *   Before: what they know walking in
 *   After: what they can do walking out
 *   Duration: 50 min
 *
 *   ## 1 · Page load · 8 min
 *   Question: the question this section answers
 *
 *   ### 1.2 · The headline, as it reads on the slide
 *   Plan:
 *   What the slide shows or does: a diagram, a demo's shot list, the
 *   fallback. For you and Claude; never compared with the slide.
 *   Screen:
 *   > text that must appear on the slide
 *   Say:
 *   What you say (the slide's notes).
 *   Sources: S1.3, S2
 *
 * Anything else (prose, other headings) is free text the tools skip.
 * Plan, Screen and Say run until the next field, heading or --- rule;
 * the one-line fields (Point, Question, Sources...) end at a blank line.
 */

const FIELD = /^(Point|Before|After|Duration|Question|Plan|Screen|Say|Sources|Time):\s?(.*)$/;
const LONG = new Set(["plan", "screen", "say"]);
const SECTION = /^##\s+(\d+)\s*[·.:-]\s*(.+?)(?:\s*[·]\s*(\d+(?:\.\d+)?)\s*min)?\s*$/;
const BEAT = /^###\s+(\d+\.\d+[a-z]?)\s*[·:-]\s*(.+?)\s*$/;

export type Section = { id: string; title: string; minutes: number | null; question: string; beats: string[] };
export type Beat = {
  id: string;
  headline: string;
  section: string | null;
  plan: string;
  screen: string;
  say: string;
  sources: string[];
  time: string;
};
export type Outline = {
  title: string;
  point: string;
  before: string;
  after: string;
  duration: number | null;
  sections: Section[];
  beats: Beat[];
};

// While a file is read, its fields are text by name (Duration and
// Sources too, until they are parsed at the end).
type Fields = Record<string, string>;
const asFields = (o: object) => o as Fields;

export const parseOutline = (text: string): Outline => {
  const out: Outline = { title: "", point: "", before: "", after: "", duration: null, sections: [], beats: [] };
  let section: Section | null = null;
  let beat: Beat | null = null;
  let field: string | null = null;
  let fence = false;

  const target = () => asFields(beat || section || out);
  const append = (line: string) => {
    const t = target();
    if (!field || !(field in t)) return;
    t[field] = t[field] ? `${t[field]}\n${line}` : line;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    // Inside a fenced block (Screen code), nothing is a heading or field.
    const unquoted = line.replace(/^>\s?/, "");
    if (/^```/.test(unquoted)) fence = !fence;
    if (fence || /^```/.test(unquoted)) {
      append(field === "screen" ? unquoted : line);
      continue;
    }

    let m;
    if (!out.title && (m = line.match(/^#\s+(.+)$/))) {
      out.title = m[1].trim();
      field = null;
    } else if ((m = line.match(SECTION))) {
      section = { id: m[1], title: m[2].trim(), minutes: m[3] ? Number(m[3]) : null, question: "", beats: [] };
      out.sections.push(section);
      beat = null;
      field = null;
    } else if ((m = line.match(BEAT))) {
      beat = { id: m[1], headline: m[2].trim(), section: section?.id ?? null, plan: "", screen: "", say: "", sources: [], time: "" };
      out.beats.push(beat);
      section?.beats.push(beat.id);
      field = null;
    } else if ((m = line.match(/^(#{1,6})\s/))) {
      // A heading the outline does not know (notes, running threads):
      // what follows is free text, not part of the beat or section.
      if (m[1].length <= 2) section = null;
      beat = null;
      field = null;
    } else if (/^-{3,}\s*$/.test(line) || (!line.trim() && field && !LONG.has(field))) {
      field = null;
    } else if ((m = line.match(FIELD))) {
      field = m[1].toLowerCase();
      // A field only counts where it belongs (Question on a section,
      // Screen on a beat...); anywhere else the line is plain text.
      const t = target();
      if (field in t) {
        t[field] = "";
        if (m[2]) append(field === "screen" ? m[2].replace(/^>\s?/, "") : m[2]);
      } else {
        field = null;
      }
    } else if (field) {
      append(field === "screen" ? unquoted : line);
    }
  }

  const trim = (o: object, keys: string[]) => keys.forEach((k) => (asFields(o)[k] = (asFields(o)[k] || "").trim()));
  trim(out, ["point", "before", "after"]);
  out.duration = parseMinutes(asFields(out).duration);
  out.sections.forEach((s) => trim(s, ["question"]));
  out.beats.forEach((b) => {
    trim(b, ["plan", "screen", "say", "time"]);
    b.sources = refsOf(asFields(b).sources);
  });
  return out;
};

const parseMinutes = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const m = String(v).trim().match(/^(\d+)(?::(\d{2}))?\s*(?:min|m)?$/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) : null;
};

const refsOf = (v: unknown): string[] => (String(v || "").match(/S\d+(?:\.\d+)?/g) || []);

/* ---------- sources/digest.md ----------
 *
 *   ## S2 · Hypermedia Systems
 *   Kind: other
 *   From: https://hypermedia.systems
 *   Credit: Carson Gross, Adam Stepinski, Deniz Akşimşek, Hypermedia Systems (2023)
 *
 *   1. A fact, number or quote, as the source says it. (where: chapter 4)
 *   2. ...
 *
 * Kind is "own" (your post, your notes: no credit on screen) or
 * "other" (someone else's work: credited on the slide that uses it
 * and on the credits slide). */

const SOURCE = /^##\s+(S\d+)\s*[·:-]\s*(.+?)\s*$/;
const SFIELD = /^(Kind|From|Credit):\s*(.*)$/;

export type Source = { id: string; title: string; kind: string; from: string; credit: string; items: Record<string, string> };
/* Sources by id (S1, S2...). */
export type Sources = Record<string, Source>;

export const parseDigest = (text: string): Sources => {
  const sources: Sources = {};
  let src: Source | null = null;
  let item: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if ((m = line.match(SOURCE))) {
      src = { id: m[1], title: m[2], kind: "", from: "", credit: "", items: {} };
      sources[src.id] = src;
      item = null;
    } else if (!src) {
      continue;
    } else if ((m = line.match(SFIELD))) {
      asFields(src)[m[1].toLowerCase()] = m[2].trim();
      item = null;
    } else if ((m = line.match(/^(\d+)\.\s+(.*)$/))) {
      item = m[1];
      src.items[item] = m[2];
    } else if (item && /^\s+\S/.test(raw)) {
      src.items[item] += " " + line.trim();
    } else if (!line.trim()) {
      item = null;
    }
  }
  return sources;
};

/* ---------- checks ---------- */

/* Everything the dev tools need: null where a file is missing, and
   what checkStory found. */
export type Story = { outline: Outline | null; sources: Sources | null; issues: string[] };

export const checkStory = ({ outline, sources }: Pick<Story, "outline" | "sources">): string[] => {
  const issues: string[] = [];
  if (outline) {
    if (!outline.point) issues.push("outline: no Point (the one sentence the talk exists to say)");
    if (!outline.before || !outline.after) issues.push("outline: say who the audience is Before and what they can do After");
    if (!outline.sections.length) issues.push("outline: no sections (## 1 · Title · 8 min)");

    const seen = new Set<string>();
    for (const s of outline.sections) {
      if (!s.question) issues.push(`outline: section ${s.id} has no Question`);
      if (s.minutes == null) issues.push(`outline: section ${s.id} has no minutes (## ${s.id} · ${s.title} · 8 min)`);
      if (!s.beats.length) issues.push(`outline: section ${s.id} has no beats`);
    }
    for (const b of outline.beats) {
      if (seen.has(b.id)) issues.push(`outline: beat ${b.id} appears twice`);
      seen.add(b.id);
      if (b.section && !b.id.startsWith(b.section + ".")) issues.push(`outline: beat ${b.id} sits in section ${b.section}`);
    }
    const planned = outline.sections.reduce((n, s) => n + (s.minutes || 0), 0);
    if (outline.duration && planned && Math.abs(planned - outline.duration) > Math.max(1, outline.duration * 0.05)) {
      issues.push(`outline: sections add up to ${planned} min, but Duration is ${Math.round(outline.duration)} min`);
    }
  }

  for (const s of Object.values(sources || {})) {
    if (!/^(own|other)$/.test(s.kind)) issues.push(`sources: ${s.id} needs Kind: own or other`);
    if (s.kind === "other" && !s.credit) issues.push(`sources: ${s.id} is someone else's work; give it a Credit line`);
    if (!Object.keys(s.items).length) issues.push(`sources: ${s.id} has no numbered items`);
  }

  if (outline && sources) {
    for (const b of outline.beats) {
      for (const ref of b.sources) {
        if (!resolves(ref, sources)) issues.push(`outline: beat ${b.id} cites ${ref}, which is not in sources/digest.md`);
      }
    }
  }
  return issues;
};

export const resolves = (ref: string, sources: Sources): boolean => {
  const [id, n] = ref.split(".");
  return !!sources[id] && (!n || n in sources[id].items);
};

/* ---------- loading ---------- */

export const storyPaths = (deckDir: string) => ({
  outline: path.join(deckDir, "outline.md"),
  digest: path.join(deckDir, "sources", "digest.md"),
});

// Everything the dev tools need; null where a file is missing.
export const readStory = (deckDir: string): Story => {
  const p = storyPaths(deckDir);
  const outline = fs.existsSync(p.outline) ? parseOutline(fs.readFileSync(p.outline, "utf8")) : null;
  const sources = fs.existsSync(p.digest) ? parseDigest(fs.readFileSync(p.digest, "utf8")) : null;
  const story = { outline, sources } as Story;
  story.issues = checkStory(story);
  return story;
};

// What a built deck needs at run time: who to credit, never the facts.
export type Credit = Pick<Source, "kind" | "title" | "credit" | "from">;
export const creditsOf = (sources: Sources | null): Record<string, Credit> =>
  Object.fromEntries(
    Object.values(sources || {}).map((s) => [s.id, { kind: s.kind, title: s.title, credit: s.credit, from: s.from }]),
  );

// As a <script> tag; JSON that cannot close the tag early.
export const jsonTag = (id: string, value: unknown): string =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/<\//g, "<\\/")}</script>`;

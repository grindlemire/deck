/* ============================================================
 * deck / publish.ts
 * deck publish: every talk's deck as one static site, for hosting.
 *
 *     bun deck publish [--out site] [--base https://example.com] [--static]
 *
 * Finds each <talk>/deck/slides.html beside deck.config.json (else in the
 * current directory), builds it (build.ts), and writes
 *
 *     site/talks/<talk>/index.html   the deck (one self-contained file),
 *                                    without its speaker notes
 *     site/talks/<talk>/notes.json   the notes, one per slide: deck/server
 *                                    hands them only to the speaker's key
 *     site/talks/<talk>/og.png,      the link preview and tab icons, copied
 *       favicon.png,                 from <talk>/deck/share/ (deck check
 *       apple-touch-icon.png         renders them; commit them)
 *     site/talks/index.html          a list of every talk, with
 *     site/talks/favicon.svg         deck/favicon.svg as its icon
 *     site/index.html                a pointer to /talks
 *     site/deck-site.json         the prefix, for deck/server
 *
 * talks/ is the prefix in deck.config.json (config.ts); with an empty
 * prefix the talks are at the site's root and the list is its index.
 *
 * Needs no npm installs, so a bare bun image can run it. Serve the
 * site with deck/server (deck serve), which adds the live
 * follow-along, or any static host without it. deck serve also
 * hands publishSite the origin phones reach it on, and each deck that
 * shows media/qr-follow.svg gets a QR for that instead (that one
 * needs the qrcode package).
 *
 * --static is for a host with no deck/server (GitHub Pages, any static
 * host): no notes.json, so the speaker notes are not published at all;
 * decks that know no server, so they show no Go live and ask for no key;
 * relative links, so the site works under any path (you.github.io/repo/);
 * and a .nojekyll, so GitHub Pages serves the files as they are.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTalks, parseArgs, talksRoot } from "./args.ts";
import { buildDeck } from "./build.ts";
import { configTag, readConfig } from "./config.ts";
import { followUrl, qrSvg } from "./qr.ts";

export type PublishOptions = {
  /* Where the site goes, from the talks folder (default site). */
  out?: string;
  /* The origin for link previews (default $SITE_URL, else the site). */
  base?: string;
  /* The origin each deck's follow-along QR points at instead. */
  follow?: string;
  /* For a static host: no notes, no follow-along, relative links. */
  static?: boolean;
};

export async function run(argv: string[]): Promise<string> {
  const args = parseArgs(argv, ["out", "base"]);
  return publishSite({ out: args.opt("out"), base: args.opt("base"), static: args.flag("static") });
}

/* Publishes the site; returns where it went. */
export async function publishSite(opts: PublishOptions = {}): Promise<string> {
  const tool = path.dirname(fileURLToPath(import.meta.url));
  const root = talksRoot();
  const config = readConfig(root);
  const out = path.resolve(root, opts.out ?? "site");
  // Link previews need absolute URLs: on --base, else $SITE_URL, else the
  // site in deck.config.json. Without one, decks publish without them.
  const base = (opts.base ?? (process.env.SITE_URL || config.site)).replace(/\/+$/, "");
  const prefix = config.prefix;
  const still = !!opts.static;
  // Where the talk list and each deck link to. The server serves a deck
  // at <prefix>/<talk>, without a trailing slash, so its links are from
  // the site's root; a static host serves the folder at <talk>/, so
  // links relative to the page work under any path.
  const listHref = (name: string) => (still ? `${name}/` : `${prefix}/${name}`);
  const deckHref = (name: string, file: string) => (still ? file : `${prefix}/${name}/${file}`);
  const talksDir = path.join(out, ...prefix.split("/").filter(Boolean));
  if (!base && !opts.follow) console.warn('warning: no site in deck.config.json (or --base): link previews will have no URL or image');
  const SHARE = ["og.png", "favicon.png", "apple-touch-icon.png"];

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const text = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

  // Every top-level directory with a deck, except deck's own template.
  const talks = listTalks(root).filter((name) => name !== path.basename(out));

  if (!talks.length) {
    console.error("deck publish: no <talk>/deck/slides.html found");
    process.exit(1);
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(talksDir, { recursive: true });

  const listed = [];
  for (const name of talks) {
    const deck = path.join(root, name, "deck");
    const qr = path.join(deck, "media", "qr-follow.svg");
    const follow = opts.follow && fs.readFileSync(path.join(deck, "slides.html"), "utf8").includes("media/qr-follow.svg") && followUrl(deck, opts.follow);
    const media = follow ? { [qr]: `data:image/svg+xml;base64,${Buffer.from(await qrSvg(follow)).toString("base64")}` } : {};
    buildDeck(deck, { media });
    const dest = path.join(talksDir, name);
    fs.mkdirSync(dest, { recursive: true });

    const src = fs.readFileSync(path.join(deck, "slides.html"), "utf8");
    const title = text(src.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || name);
    const tagline = text(src.match(/class="title-tagline"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    listed.push({ name, title, tagline });

    const share = SHARE.filter((f) => fs.existsSync(path.join(deck, "share", f)));
    for (const f of share) fs.copyFileSync(path.join(deck, "share", f), path.join(dest, f));
    if (share.length < SHARE.length) console.warn(`warning: ${name} has no share images: run bun deck check ${name}`);
    if (still && src.includes("media/qr-follow.svg"))
      console.warn(`warning: ${name} shows a follow-along QR code, and a static site has no follow-along`);
    const url = base && `${base}${prefix}/${name}${still ? "/" : ""}`;
    const head = [
      share.includes("favicon.png") && `<link rel="icon" type="image/png" href="${deckHref(name, "favicon.png")}">`,
      share.includes("apple-touch-icon.png") && `<link rel="apple-touch-icon" href="${deckHref(name, "apple-touch-icon.png")}">`,
      tagline && `<meta name="description" content="${esc(tagline)}">`,
      `<meta property="og:type" content="website">`,
      url && `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      tagline && `<meta property="og:description" content="${esc(tagline)}">`,
      ...(url && share.includes("og.png")
        ? [
            `<meta property="og:image" content="${esc(url.replace(/\/$/, ""))}/og.png">`,
            `<meta property="og:image:width" content="1200">`,
            `<meta property="og:image:height" content="630">`,
            `<meta name="twitter:card" content="summary_large_image">`,
          ]
        : []),
    ].filter(Boolean);

    // The notes come out of the public deck (each slide has at most one
    // aside.notes; slides do not nest) into notes.json, in slide order.
    const notes: string[] = [];
    const built = fs
      .readFileSync(path.join(deck, "dist", "index.html"), "utf8")
      .replace(/<\/title>/i, (t) => `${t}\n${head.join("\n")}`)
      // Naming the talk marks the deck as published, so it goes live on
      // the server that serves it. On a static host there is none: no
      // site and no talk, so the deck has nowhere to go live.
      .replace(/<script type="application\/json" id="dk-config">.*?<\/script>/, () =>
        still ? configTag({ site: "", prefix: "" }) : configTag(config, name),
      )
      .replace(/<section\b[^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*>[\s\S]*?<\/section>/g, (slide) => {
        let note = "";
        const bare = slide.replace(/\s*<aside class="notes">([\s\S]*?)<\/aside>/, (_, html) => {
          note = html.trim();
          return "";
        });
        notes.push(note);
        return bare;
      });
    fs.writeFileSync(path.join(dest, "index.html"), built);
    if (!still) fs.writeFileSync(path.join(dest, "notes.json"), JSON.stringify(notes));
  }

  const page = (title: string, body: string, head = "") => `<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  ${head}<style>
    :root { color-scheme: light dark; --bg: #0e1116; --ink: #e8eaed; --muted: #9ba1ac; --line: rgba(255,255,255,0.1); --accent: #5aa0ff; }
    @media (prefers-color-scheme: light) { :root { --bg: #ffffff; --ink: #1c2128; --muted: #47505a; --line: rgba(20,24,31,0.12); --accent: #0868d1; } }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 64px 16px; }
    h1 { margin: 0 0 32px; font-size: 32px; letter-spacing: -0.02em; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { border-top: 1px solid var(--line); }
    a { display: block; padding: 18px 0; color: inherit; text-decoration: none; }
    a b { display: block; font-size: 20px; color: var(--accent); }
    a span { color: var(--muted); }
    a:hover b { text-decoration: underline; }
  </style>
  </head>
  <body>
  <main>
  ${body}
  </main>
  </body>
  </html>
  `;

  fs.writeFileSync(
    path.join(talksDir, "index.html"),
    page(
      "Talks",
      `<h1>Talks</h1>\n<ul>\n${listed
        .map((t) => `  <li><a href="${esc(listHref(t.name))}"><b>${esc(t.title)}</b>${t.tagline ? `<span>${esc(t.tagline)}</span>` : ""}</a></li>`)
        .join("\n")}\n</ul>`,
      `<link rel="icon" type="image/svg+xml" href="${still ? "favicon.svg" : esc(prefix) + "/favicon.svg"}">\n<meta property="og:title" content="Talks">\n${base ? `<meta property="og:url" content="${esc(base + (prefix || "/") + (still && prefix ? "/" : ""))}">\n` : ""}`,
    ),
  );
  fs.copyFileSync(path.join(tool, "favicon.svg"), path.join(talksDir, "favicon.svg"));
  if (prefix) {
    const to = still ? `${prefix.replace(/^\/+/, "")}/` : prefix;
    fs.writeFileSync(
      path.join(out, "index.html"),
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${esc(to)}"><a href="${esc(to)}">Talks</a>\n`,
    );
  }
  if (still) fs.writeFileSync(path.join(out, ".nojekyll"), "");
  else fs.writeFileSync(path.join(out, "deck-site.json"), JSON.stringify({ prefix }) + "\n");

  console.log(`published ${listed.length} talk(s) to ${path.relative(process.cwd(), out) || "."}`);
  for (const t of listed) console.log(`  ${prefix}/${t.name}${still ? "/" : ""}  ${t.title}`);
  if (still) console.log("static: no speaker notes and no follow-along; the links work under any path");
  return out;
}

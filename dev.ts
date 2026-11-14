/* ============================================================
 * deck / dev.ts
 * deck dev: a live-reloading dev server for a deck, zero npm deps:
 *
 *     bun deck dev [my-talk] [--port 4000] [--no-open]
 *
 * Opens the deck in the browser (--no-open to skip it), on the first
 * free port from 4000 (or --port). With no talk named, the only talk.
 *
 * Serves slides.html straight from the checkout (no build step) and
 * watches the deck and deck. A stylesheet change swaps in place,
 * so the slide you are on does not even reload; any other change
 * reloads the page on the same slide and build step.
 *
 * The presenter window's "Save run" posts here, and the run is added
 * to <deck>/rehearsals.json (commit it; the build inlines it).
 *
 * When the deck has an outline.md or sources/digest.md (outline.ts),
 * the page gets them too, so lint.ts can check the slides against the
 * outline and story.ts can show the headline readout ("h").
 *
 * Listens on 127.0.0.1 only and serves only files under the talks
 * folder (args.ts, talksRoot), plus deck's own dev scripts.
 * ============================================================ */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, findDeck, isUnder, parseArgs, talksRoot } from "./args.ts";
import { browserScript } from "./browser.ts";
import { type Config, configTag, readConfig, SettingsError } from "./config.ts";
import { creditsOf, jsonTag, readStory } from "./outline.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["port"]);
  const tool = path.dirname(fileURLToPath(import.meta.url));
  const root = talksRoot();
  const deckDir = findDeck(args.positional[0]);
  const port = Number(args.opt("port") ?? "4000");
  if (!isUnder(deckDir, root)) fail(`${deckDir} is not under ${root}`);

  const deckUrl = "/" + path.relative(root, deckDir).split(path.sep).join("/") + "/slides.html";

  const MIME: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".mjs": "text/javascript; charset=utf-8",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webm": "video/webm",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
  };

  // Scripts the dev server adds to the deck page, after engine.ts,
  // served from deck wherever it is installed.
  const DEV_SRC = "/__deck/src/";
  const DEV_SCRIPTS = ["lint.ts", "story.ts", "dev-client.ts"].map((f) => DEV_SRC + f);

  /* ---------- live reload: server-sent events ---------- */

  const clients = new Set<ReadableStreamDefaultController<string>>();
  const send = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) {
      try {
        c.enqueue(msg);
      } catch {
        clients.delete(c);
      }
    }
  };

  // rehearsals.json changes when you save a run: no reload for that.
  // rel is the path inside the folder being watched, so deck in
  // node_modules still counts.
  const ignored = (rel: string) =>
    /(^|\/)(dist|snapshots|node_modules|\.[^/]+)(\/|$)/.test(rel) || rel.endsWith("~") || rel.endsWith("/rehearsals.json");

  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | number = 0;
  const changed = (dir: string) => (_event: fs.WatchEventType, file: string | null) => {
    if (!file) return;
    if (ignored(file.split(path.sep).join("/"))) return;
    const rel = path.relative(root, path.join(dir, file)).split(path.sep).join("/");
    pending.add(rel);
    clearTimeout(timer);
    // Editors write in bursts (temp file, rename); wait for the dust.
    timer = setTimeout(() => {
      const files = [...pending];
      pending = new Set();
      if (files.every((f) => f.endsWith(".css"))) {
        send("css", files.map((f) => "/" + f));
        console.log(`css   ${files.join(", ")}`);
      } else {
        send("reload", files);
        console.log(`reload ${files.join(", ")}`);
      }
    }, 80);
  };
  fs.watch(deckDir, { recursive: true }, changed(deckDir));
  fs.watch(tool, { recursive: true }, changed(tool));

  /* ---------- static files ---------- */

  const fileResponse = (file: string, req: Request) => {
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    // Read into memory rather than handing Bun the file to send: a
    // sandboxed process (an agent's dev server) cannot send files
    // straight from disk, and the browser would wait forever.
    const blob = new Blob([fs.readFileSync(file)]);
    const size = blob.size;
    // Video seeking needs byte ranges.
    const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      return new Response(blob.slice(start, end + 1), {
        status: 206,
        headers: {
          "content-type": type,
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
          "cache-control": "no-store",
        },
      });
    }
    return new Response(blob, { headers: { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" } });
  };

  const rehearsalsPath = path.join(deckDir, "rehearsals.json");

  // The deck's saved rehearsal runs, as the tag engine.ts reads them.
  const rehearsalsTag = (file: string) => {
    if (!fs.existsSync(file)) return "";
    const json = fs.readFileSync(file, "utf8").replace(/<\//g, "<\\/");
    return `<script type="application/json" id="dk-rehearsals">${json}</script>`;
  };

  // A rehearsal run, as the presenter window posts it.
  type Run = { date: string; total: number; times: Record<string, number> };
  const validRun = (r: Partial<Run> | null) =>
    r &&
    typeof r.date === "string" &&
    !Number.isNaN(Date.parse(r.date)) &&
    Number.isFinite(r.total) &&
    r.times &&
    typeof r.times === "object" &&
    Object.values(r.times).every((v) => Number.isFinite(v) && v >= 0);

  const saveRun = async (req: Request) => {
    let run: Run;
    try {
      run = await req.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!validRun(run)) return new Response("not a rehearsal run", { status: 400 });
    let doc: { runs?: Run[] } = { runs: [] };
    try {
      doc = JSON.parse(fs.readFileSync(rehearsalsPath, "utf8"));
    } catch {}
    doc.runs = (doc.runs || []).filter((r) => r.date !== run.date).concat([{ date: run.date, total: run.total, times: run.times }]);
    fs.writeFileSync(rehearsalsPath, JSON.stringify(doc, null, 2) + "\n");
    console.log(`saved a ${Math.round(run.total / 60)} min rehearsal to ${path.relative(root, rehearsalsPath)}`);
    return new Response(null, { status: 204 });
  };

  // The settings, reread on each page load. A mistake in
  // deck.config.json is reported and the last good settings stay.
  let settings: Config = readConfig(deckDir);
  let settingsError = "";
  const currentSettings = (): Config => {
    try {
      settings = readConfig(deckDir);
      settingsError = "";
    } catch (err) {
      if (!(err instanceof SettingsError)) throw err;
      if (err.message !== settingsError) console.log(`settings: ${err.message} (keeping the last good settings)`);
      settingsError = err.message;
    }
    return settings;
  };

  const deckPage = (file: string) => {
    const story = readStory(deckDir);
    const tags = [
      rehearsalsTag(rehearsalsPath),
      story.outline || story.sources ? jsonTag("dk-story", story) : "",
      ...DEV_SCRIPTS.map((src) => `<script src="${src}"></script>`),
    ].join("\n");
    // The flag goes in <head> so engine.ts sees it as it boots, and so
    // do the settings and the credits, which engine.ts turns into source
    // lines.
    const head = [
      "<script>window.DECK_DEV = true;</script>",
      configTag(currentSettings()),
      story.sources ? jsonTag("dk-sources", creditsOf(story.sources)) : "",
    ];
    const html = fs
      .readFileSync(file, "utf8")
      .replace(/<head>/i, `<head>\n${head.join("\n")}`)
      .replace(/<\/body>/i, `${tags}\n</body>`);
    return new Response(html, { headers: { "content-type": MIME[".html"], "cache-control": "no-store" } });
  };

  // The first free port from the one asked for, so a second deck (or
  // anything else on 4000) is no reason to stop.
  const serve = (p: number) =>
    Bun.serve({
    hostname: "127.0.0.1",
    port: p,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") return Response.redirect(deckUrl, 302);
      if (url.pathname === "/__deck/rehearsals" && req.method === "POST") return saveRun(req);

      if (url.pathname === "/__deck/events") {
        let ctl: ReadableStreamDefaultController<string>;
        const stream = new ReadableStream<string>({
          start(c) {
            ctl = c;
            clients.add(c);
            c.enqueue(": connected\n\n");
          },
          cancel() {
            clients.delete(ctl);
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
        });
      }

      let rel;
      try {
        rel = decodeURIComponent(url.pathname);
      } catch {
        return new Response("bad path", { status: 400 });
      }
      const dev = rel.startsWith(DEV_SRC);
      const base = dev ? tool : root;
      const file = path.resolve(base, "." + (dev ? rel.slice(DEV_SRC.length - 1) : rel));
      if (!isUnder(file, base) || file === base) return new Response("not found", { status: 404 });
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        return new Response("not found", { status: 404 });
      }
      if (!stat.isFile()) return new Response("not found", { status: 404 });
      if (file === path.join(deckDir, "slides.html")) return deckPage(file);
      // The deck's TypeScript (engine.ts and the dev scripts), types stripped.
      if (file.endsWith(".ts")) return new Response(browserScript(file), { headers: { "content-type": MIME[".js"], "cache-control": "no-store" } });
      return fileResponse(file, req);
    },
  });
  let server: ReturnType<typeof serve> | undefined;
  for (let p = port; !server; p++) {
    try {
      server = serve(p);
    } catch (err) {
      if ((err as { code?: string }).code !== "EADDRINUSE" || p >= port + 20) throw err;
    }
  }

  // Comments keep the connection from idling out between edits.
  setInterval(() => send("ping", Date.now()), 20000);

  const link = `http://127.0.0.1:${server.port}${deckUrl}`;
  console.log(`deck dev server: ${link}`);
  const startStory = readStory(deckDir);
  if (startStory.issues.length) console.log(`outline and sources:\n${startStory.issues.map((t) => `  - ${t}`).join("\n")}`);
  console.log("watching the deck and deck itself; css swaps in place, anything else reloads");
  if (!args.flag("no-open")) execFile(process.platform === "darwin" ? "open" : "xdg-open", [link], () => {});
}

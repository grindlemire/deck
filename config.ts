/* ============================================================
 * deck / config.ts
 * The talks site's settings, from a deck.config.json in the deck's
 * directory or any directory above it (the talks folder):
 *
 *     { "site": "https://example.com", "prefix": "/talks" }
 *
 *   site   where the talks are hosted, with the deck server.
 *          A local copy of a deck (dist/index.html from file://,
 *          or the dev server) goes live on <site><prefix>/<talk>,
 *          and publish.ts makes link previews absolute on it.
 *          Without it, a local copy goes live only with ?lead=.
 *   prefix the path the talks are under (default /talks; "" for
 *          the site's root). publish.ts writes the site there and
 *          notes it in deck-site.json for deck/server.
 *   auth   "gate" for decks served from a private space behind
 *          alethi.dev's gate (deck/server's spaces mode): the gate
 *          says who you are, so the deck leads and fetches its notes
 *          with no key. Left out, the deck uses the lead key.
 *   speaker, handle   who gives the talks, for new.ts's title slide.
 *   theme  the theme new.ts starts a talk with (default house).
 *   themes more folders of themes, relative to this file. The talks
 *          repo's own themes/ folder is always searched first, and
 *          deck/themes last (args.ts, themeDirs).
 *
 * DECK_SITE and DECK_PREFIX in the environment override the
 * file.
 * build.ts and dev.ts hand the settings to engine.ts as
 * <script id="dk-config">.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";

const FILE = "deck.config.json";

export type Config = {
  file: string | null;
  site: string;
  prefix: string;
  auth: "gate" | undefined;
  speaker: string | undefined;
  handle: string | undefined;
  theme: string | undefined;
  themes: string[];
};

/* A problem in deck.config.json: the CLI prints the message alone,
   and the dev server keeps running on the last good settings. */
export class SettingsError extends Error {}

const die = (msg: string): never => {
  throw new SettingsError(msg);
};


/* The nearest deck.config.json at or above dir, or null. */
export const findConfig = (dir: string): string | null => {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    const file = path.join(at, FILE);
    if (fs.existsSync(file)) return file;
    if (path.dirname(at) === at) return null;
  }
};

export const readConfig = (dir: string): Config => {
  const file = findConfig(dir);
  let raw: { site?: string; prefix?: string; auth?: unknown; speaker?: unknown; handle?: unknown; theme?: unknown; themes?: unknown } = {};
  if (file) {
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      die(`${file}: ${(err as Error).message}`);
    }
  }
  const site = (process.env.DECK_SITE ?? raw.site ?? "").replace(/\/+$/, "");
  if (site && !/^https?:\/\/[^/]+$/.test(site)) die(`site must be an origin like https://example.com, not ${JSON.stringify(site)}`);
  const prefix = (process.env.DECK_PREFIX ?? raw.prefix ?? "/talks").replace(/\/+$/, "");
  if (prefix && !/^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/.test(prefix)) die(`prefix must be a path like /talks (or ""), not ${JSON.stringify(prefix)}`);
  if (raw.auth !== undefined && raw.auth !== "gate") die(`auth must be "gate" (or left out), not ${JSON.stringify(raw.auth)}`);
  const auth = raw.auth === "gate" ? "gate" : undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (raw.themes !== undefined && !(Array.isArray(raw.themes) && raw.themes.every((t) => typeof t === "string"))) die(`themes must be a list of folders, like ["design/themes"]`);
  const themes = ((raw.themes as string[] | undefined) ?? []).map((t) => path.resolve(path.dirname(file!), t));
  return { file, site, prefix, auth, speaker: str(raw.speaker), handle: str(raw.handle), theme: str(raw.theme), themes };
};

/* What engine.ts needs, as a tag for <head>. publish.ts adds the
   talk's name, which marks the deck as published. */
export const configTag = (config: Pick<Config, "site" | "prefix"> & Partial<Pick<Config, "auth">>, talk?: string): string =>
  `<script type="application/json" id="dk-config">${JSON.stringify({ site: config.site, prefix: config.prefix, ...(config.auth && { auth: config.auth }), ...(talk && { talk }) }).replace(/<\//g, "<\\/")}</script>`;

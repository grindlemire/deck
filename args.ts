/* ============================================================
 * deck / args.ts
 * What every command shares: options, and finding talks and themes.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.ts";

const tool = path.dirname(fileURLToPath(import.meta.url));

export type Args = {
  /* The words that are not options or option values. */
  positional: string[];
  /* --name value */
  opt(name: string): string | undefined;
  /* --name on its own */
  flag(name: string): boolean;
};

/* valued names the options that take a value (--port 4000). */
export const parseArgs = (argv: string[], valued: string[] = []): Args => {
  const positional: string[] = [];
  const opts = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (valued.includes(name)) {
      const v = argv[++i];
      if (v === undefined) fail(`--${name} needs a value`);
      opts.set(name, v);
    } else flags.add(name);
  }
  return { positional, opt: (n) => opts.get(n), flag: (n) => flags.has(n) };
};

export const fail = (msg: string): never => {
  console.error(`deck: ${msg}`);
  process.exit(1);
};

/* The talks folder: where deck.config.json is, else the nearest
   folder with a package.json (where deck is installed), else here. */
export const talksRoot = (): string => {
  const { file } = readConfig(process.cwd());
  if (file) return path.dirname(file);
  for (let at = process.cwd(); ; at = path.dirname(at)) {
    if (fs.existsSync(path.join(at, "package.json"))) return at;
    if (path.dirname(at) === at) return process.cwd();
  }
};

/* Whether file is dir or inside it. */
export const isUnder = (file: string, dir: string): boolean => file === dir || file.startsWith(dir + path.sep);

/* Every talk in root: a folder with deck/slides.html. */
export const listTalks = (root: string): string[] =>
  fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "deck" && d.name !== "node_modules")
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(root, name, "deck", "slides.html")))
    .sort();

/* Where themes live, searched in order: the talks folder's themes/, the
   folders deck.config.json lists, then deck's own. A theme is a
   folder with theme.css and a starter deck (template/slides.html). */
export const themeDirs = (): string[] => {
  const root = talksRoot();
  return [path.join(root, "themes"), ...readConfig(root).themes, path.join(tool, "themes")];
};

const isTheme = (dir: string): boolean =>
  fs.existsSync(path.join(dir, "theme.css")) && fs.existsSync(path.join(dir, "template", "slides.html"));

/* The theme's folder, or null: the first one with that name. */
export const findTheme = (name: string): string | null => {
  for (const d of themeDirs()) if (isTheme(path.join(d, name))) return path.join(d, name);
  return null;
};

export const listThemes = (): string[] => {
  const names = new Set<string>();
  for (const d of themeDirs()) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && isTheme(path.join(d, e.name))) names.add(e.name);
  }
  return [...names].sort();
};

/* A talk's deck: my-talk or my-talk/deck, either way. With no talk
   named, the only talk in the repo, if there is just one. */
export const findDeck = (arg: string | undefined): string => {
  if (!arg) {
    const root = talksRoot();
    const talks = listTalks(root);
    if (talks.length === 1) return path.join(root, talks[0], "deck");
    if (!talks.length) return fail("no talks here yet: bun deck new my-talk");
    return fail(`which talk? ${talks.join(", ")}`);
  }
  const dir = path.resolve(arg);
  for (const d of [path.join(dir, "deck"), dir]) {
    if (fs.existsSync(path.join(d, "slides.html"))) return d;
  }
  let talks: string[] = [];
  try {
    talks = listTalks(talksRoot());
  } catch {}
  return fail(`no talk at ${arg} (no slides.html in it or its deck/)${talks.length ? `; the talks are ${talks.join(", ")}` : ""}`);
};

/* The talk's name: the folder that holds its deck/. */
export const talkName = (deckDir: string): string => path.basename(path.dirname(deckDir));

/* ============================================================
 * deck / new.ts
 * deck new: start a talk from deck/template and a theme's
 * starter deck (deck/themes/<theme>/template).
 *
 *   bun deck new <talk> --title "One page, three speeds" \
 *     [--theme house] [--speaker "Your Name"] [--handle "@you"]
 *
 * The theme, speaker and handle default to the ones in
 * deck.config.json (the theme else house; the speaker else git's
 * user.name). Writes <talk>/deck/{slides.html,
 * theme.css,outline.md,sources/,media/} and <talk>/clips/{common.ts,
 * demo-1.ts}, wired to this deck by relative paths. Refuses to
 * overwrite an existing deck.
 *
 * Run from outside the talks folder (bunx @grindlemire/deck new my-talk in an
 * empty folder), it first makes the folder a talks folder: a
 * package.json and .gitignore if there are none, and deck installed
 * into node_modules (this package at ^<this version>, or DECK_SPEC: a git
 * URL, a tarball, a checkout). Then that copy starts the talk.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, findTheme, isUnder, listThemes, parseArgs, talksRoot } from "./args.ts";
import { readConfig } from "./config.ts";

// git's user.name, for the title slide when nothing else names the speaker.
const gitName = (): string => {
  try {
    return Bun.spawnSync(["git", "config", "user.name"]).stdout.toString().trim();
  } catch {
    return "";
  }
};

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["title", "speaker", "handle", "theme"]);
  const dir = args.positional[0];
  if (!dir) fail('usage: bun deck new <talk> --title "Talk title" [--theme house] [--speaker "Name"] [--handle "@you"]');

  const talk = path.resolve(dir);
  const tool = path.dirname(fileURLToPath(import.meta.url));
  if (!isUnder(tool, talksRoot()) && !process.env.DECK_INSTALLED) return startFolder(argv);
  const tpl = path.join(tool, "template");
  const themes = listThemes();
  const deck = path.join(talk, "deck");
  if (fs.existsSync(path.join(deck, "slides.html"))) fail(`${deck}/slides.html already exists; not overwriting`);

  const config = readConfig(talk);
  const theme = args.opt("theme") ?? config.theme ?? "house";
  const themeDir = findTheme(theme) ?? fail(`no theme "${theme}"; the themes are ${themes.join(", ")}`);
  const title = args.opt("title") ?? path.basename(talk).replace(/[-_]+/g, " ");
  const speaker = args.opt("speaker") ?? config.speaker ?? (gitName() || "Your Name");
  const handle = args.opt("handle") ?? config.handle ?? "";
  // Split the title for the two-line title slide: first half plain,
  // second half in the accent color ("One page," / "three speeds").
  const words = title.split(" ");
  const cut = Math.ceil(words.length / 2);
  const rel = (from: string, to: string) => path.relative(from, to).split(path.sep).join("/") || ".";

  const vars: Record<string, string> = {
    TITLE: title,
    TITLE_LINE_1: words.slice(0, cut).join(" "),
    TITLE_LINE_2: words.slice(cut).join(" "),
    SPEAKER: speaker,
    HANDLE: handle,
    INITIAL: speaker.trim()[0]?.toUpperCase() ?? "?",
    TALK: rel(process.cwd(), talk),
    DECK: rel(deck, tool),
    THEME: rel(deck, themeDir),
    DECK_FROM_CLIPS: rel(path.join(talk, "clips"), tool),
    DECK_FROM_ROOT: rel(process.cwd(), tool),
  };
  const fill = (s: string) => s.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

  const copy = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      const src = path.join(from, name);
      const dst = path.join(to, name);
      if (fs.statSync(src).isDirectory()) copy(src, dst);
      else fs.writeFileSync(dst, fill(fs.readFileSync(src, "utf8")));
    }
  };
  // What every talk starts with, then the theme's own slides, outline
  // and talk-level theme.css.
  copy(path.join(tpl, "deck"), deck);
  copy(path.join(tpl, "clips"), path.join(talk, "clips"));
  copy(path.join(themeDir, "template"), deck);
  fs.mkdirSync(path.join(deck, "media"), { recursive: true });

  const r = rel(process.cwd(), talk);
  console.log(`created ${r}/deck and ${r}/clips, with the ${theme} theme

next:
  1. put your raw material in ${r}/deck/sources/ and write sources/digest.md
  2. write ${r}/deck/outline.md (the point, the audience, sections, beats);
     bun deck check ${r} --outline checks it
  3. make the slides: bun deck dev ${r}
     (live reload, lint badges, h for the headline readout)
  4. bun deck check ${r}: every slide, both themes, before you call it done

Read ${vars.DECK_FROM_ROOT}/AUTHORING.md before writing slides.`);
}

/* A talks folder for someone with no deck installed: what it needs,
   then deck itself, whose copy then starts the talk. The talk's
   paths point into node_modules, so they hold wherever the folder
   goes. */
async function startFolder(argv: string[]): Promise<void> {
  const root = talksRoot();
  const write = (name: string, text: string) => {
    if (!fs.existsSync(path.join(root, name))) fs.writeFileSync(path.join(root, name), text);
  };
  write("package.json", JSON.stringify({ private: true }, null, 2) + "\n");
  write(".gitignore", "node_modules/\nsite/\n*/deck/dist/\n*/deck/snapshots/\n");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { name, version } = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
  const installed = path.join(root, "node_modules", ...name.split("/"));
  if (!fs.existsSync(path.join(installed, "package.json"))) {
    const spec = process.env.DECK_SPEC || `${name}@^${version}`;
    console.log(`installing ${spec} into ${root}`);
    const add = Bun.spawnSync(["bun", "add", spec], { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    if (add.exitCode) fail(`could not install ${spec}`);
  }
  const proc = Bun.spawn(["bun", path.join(installed, "index.ts"), "new", ...argv], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, DECK_INSTALLED: "1" },
  });
  process.exitCode = await proc.exited;
}
